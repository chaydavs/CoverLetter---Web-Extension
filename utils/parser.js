/**
 * Resume text extraction from PDF files and pasted text.
 * "Open the file, find all the pages, read the words off each page in order."
 */

import { createError, Errors } from './errors.js';

/** PDF magic bytes: %PDF */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_PAGES = 50;

/**
 * Parses a resume from an uploaded File object.
 * Detects file type by magic bytes and delegates to the right parser.
 *
 * @param {File} file - The uploaded file
 * @returns {Promise<string>} Extracted text
 */
export async function parseResumeFile(file) {
  if (!file || !(file instanceof File)) {
    throw createError(Errors.INVALID_INPUT, 'No file provided');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw createError(Errors.RESUME_TOO_LARGE, `File is ${(file.size / 1024 / 1024).toFixed(1)}MB, max is 5MB`);
  }

  if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
    const text = await file.text();
    return parseResumeText(text);
  }

  // Check magic bytes for PDF
  const buffer = await file.arrayBuffer();
  const header = new Uint8Array(buffer.slice(0, 4));
  const isPDF = PDF_MAGIC.every((byte, i) => header[i] === byte);

  if (!isPDF) {
    if (file.name.endsWith('.doc') || file.name.endsWith('.docx')) {
      throw createError(Errors.RESUME_WRONG_FORMAT);
    }
    throw createError(Errors.RESUME_PARSE_FAILED, `Unrecognized file type: ${file.type}`);
  }

  return extractTextFromPDF(buffer);
}

/**
 * Cleans up pasted resume text: normalizes whitespace and line breaks.
 *
 * @param {string} text - Raw pasted text
 * @returns {string} Cleaned text
 */
export function parseResumeText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw createError(Errors.INVALID_INPUT, 'Resume text is empty');
  }

  return text
    .replace(/\r\n/g, '\n')        // Normalize Windows line breaks
    .replace(/\r/g, '\n')          // Normalize old Mac line breaks
    .replace(/\t/g, '  ')          // Tabs to spaces
    .replace(/ {3,}/g, '  ')       // Collapse excessive spaces
    .replace(/\n{4,}/g, '\n\n\n')  // Max 3 consecutive newlines
    .trim();
}

/**
 * Extracts text from a PDF binary using pdf.js with spatial awareness.
 * "Go through each page one at a time. On each page, read all the words
 *  from top to bottom, left to right. Put spaces between words."
 *
 * @param {ArrayBuffer} buffer - PDF file as ArrayBuffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPDF(buffer) {
  // pdf.js is vendored in lib/ — loaded as a global by the popup
  if (typeof pdfjsLib === 'undefined') {
    throw createError(Errors.RESUME_PARSE_FAILED, 'PDF library not loaded');
  }

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  } catch (err) {
    throw createError(Errors.RESUME_PARSE_FAILED, `PDF load failed: ${err.message}`);
  }

  const totalPages = Math.min(pdf.numPages, MAX_PAGES);
  if (totalPages === 0) {
    throw createError(Errors.RESUME_PARSE_FAILED, 'This PDF has no pages.');
  }

  const pageTexts = [];
  const headerFooterCandidates = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    if (content.items.length === 0) continue;

    const lines = groupItemsIntoLines(content.items);
    const text = lines.map(line => line.join(' ')).join('\n');

    if (text.trim().length > 0) {
      pageTexts.push(text);

      // Track first and last lines for header/footer detection
      if (lines.length > 0) {
        headerFooterCandidates.push({
          first: lines[0].join(' '),
          last: lines[lines.length - 1].join(' '),
        });
      }
    }
  }

  if (pageTexts.length === 0) {
    throw createError(Errors.RESUME_SCANNED_PDF);
  }

  let fullText = pageTexts.join('\n\n');

  // Remove repeated headers/footers across pages
  if (headerFooterCandidates.length >= 3) {
    fullText = removeRepeatedHeadersFooters(fullText, headerFooterCandidates);
  }

  if (totalPages >= MAX_PAGES) {
    fullText = fullText + '\n\n[Resume truncated — only first 50 pages extracted]';
  }

  return parseResumeText(fullText);
}

/**
 * Groups text items into lines based on vertical position.
 * Items sharing a similar y-position (within 2px) are on the same line.
 * Within each line, items are sorted left-to-right by x-position.
 *
 * @param {Array} items - Text content items from pdf.js
 * @returns {Array<Array<string>>} Lines of text strings
 */
function groupItemsIntoLines(items) {
  const Y_TOLERANCE = 2;

  // Extract position from transform matrix: [scaleX, skewX, skewY, scaleY, translateX, translateY]
  const positioned = items
    .filter(item => item.str.trim().length > 0)
    .map(item => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
    }));

  if (positioned.length === 0) return [];

  // Sort by y descending (top of page first), then x ascending (left to right)
  positioned.sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > Y_TOLERANCE) return yDiff;
    return a.x - b.x;
  });

  // Group into lines
  const lines = [];
  let currentLine = [positioned[0]];

  for (let i = 1; i < positioned.length; i++) {
    const prev = currentLine[0];
    const curr = positioned[i];

    if (Math.abs(curr.y - prev.y) <= Y_TOLERANCE) {
      currentLine.push(curr);
    } else {
      // Sort current line left-to-right and extract text
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine.map(item => item.text));
      currentLine = [curr];
    }
  }

  // Don't forget the last line
  currentLine.sort((a, b) => a.x - b.x);
  lines.push(currentLine.map(item => item.text));

  return lines;
}

/**
 * Detects and removes headers/footers that repeat across pages.
 * If the same text appears as the first or last line on 3+ pages, it's likely a header/footer.
 *
 * @param {string} fullText - Combined text from all pages
 * @param {Array} candidates - First/last lines from each page
 * @returns {string} Text with repeated headers/footers removed
 */
function removeRepeatedHeadersFooters(fullText, candidates) {
  const firstLines = candidates.map(c => c.first);
  const lastLines = candidates.map(c => c.last);

  const repeatedFirst = findRepeated(firstLines);
  const repeatedLast = findRepeated(lastLines);

  let cleaned = fullText;

  for (const header of repeatedFirst) {
    // Remove lines that exactly match the repeated header
    cleaned = cleaned.split('\n').filter(line => line.trim() !== header.trim()).join('\n');
  }
  for (const footer of repeatedLast) {
    cleaned = cleaned.split('\n').filter(line => line.trim() !== footer.trim()).join('\n');
  }

  return cleaned;
}

/**
 * Finds strings that appear 3 or more times in an array.
 * @param {string[]} arr
 * @returns {string[]} Strings appearing 3+ times
 */
function findRepeated(arr) {
  const counts = {};
  for (const item of arr) {
    const key = item.trim();
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, count]) => count >= 3)
    .map(([text]) => text);
}
