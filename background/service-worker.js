/**
 * Background service worker — the brain of the extension.
 * Coordinates communication between popup, content scripts, and the API.
 *
 * "Listen for messages from the popup, do the right thing, and send results back.
 *  Never let an error go unhandled."
 */

import { generateCoverLetter } from '../api/claude.js';
import { getResume, hasResume, getApiKey } from '../utils/storage.js';
import { sanitizeText } from '../utils/sanitize.js';
import { latexToPlainText } from '../utils/latex-preview.js';
import { AppError, Errors, createError } from '../utils/errors.js';

/** Cloudflare Worker proxy URL — update after deployment */
const PROXY_URL = 'https://covercraft-proxy.chaydav4.workers.dev';

/** URL patterns for supported job boards */
const SITE_PATTERNS = [
  { pattern: /linkedin\.com\/jobs/i, file: 'content/scrapers/linkedin.js' },
  { pattern: /greenhouse\.io/i, file: 'content/scrapers/greenhouse.js' },
  { pattern: /lever\.co/i, file: 'content/scrapers/lever.js' },
  { pattern: /myworkdayjobs\.com/i, file: 'content/scrapers/workday.js' },
];

/**
 * Main message handler. All popup messages come through here.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  handleMessage(message)
    .then(sendResponse)
    .catch(err => {
      if (err instanceof AppError) {
        sendResponse({ success: false, error: { code: err.code, message: err.userMessage } });
      } else {
        sendResponse({
          success: false,
          error: {
            code: 'UNKNOWN',
            message: 'Something unexpected happened. Try again, and if it persists, try reloading the extension.',
          },
        });
      }
    });

  // Return true to indicate we'll respond asynchronously
  return true;
});

/**
 * Routes messages to the appropriate handler.
 * @param {{type: string, payload?: any}} message
 * @returns {Promise<{success: boolean, data?: any, error?: {code: string, message: string}}>}
 */
async function handleMessage(message) {
  switch (message.type) {
    case 'CHECK_RESUME':
      return handleCheckResume();
    case 'SCRAPE_PAGE':
      return handleScrapePage();
    case 'GENERATE':
      return handleGenerate(message.payload);
    case 'GET_PDF':
      return handleGetPDF(message.payload);
    default:
      // Silently ignore unknown message types
      return { success: false, error: { code: 'UNKNOWN_TYPE', message: 'Unknown request.' } };
  }
}

/**
 * Checks if a resume is stored.
 */
async function handleCheckResume() {
  const exists = await hasResume();
  return { success: true, data: { hasResume: exists } };
}

/**
 * Injects content script into the active tab and scrapes job data.
 * All returned strings are sanitized before sending to the popup.
 */
async function handleScrapePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url) {
    throw createError(Errors.SCRAPE_FAILED, 'No active tab found');
  }

  // Determine which scraper files to inject
  const scraperFiles = ['content/scrapers/fallback.js'];
  for (const site of SITE_PATTERNS) {
    if (site.pattern.test(tab.url)) {
      scraperFiles.unshift(site.file);
      break;
    }
  }
  scraperFiles.unshift('content/scraper.js');

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePageInContext,
    });

    if (!results || results.length === 0 || !results[0].result) {
      throw createError(Errors.SCRAPE_NO_JOB_DATA);
    }

    const data = results[0].result;

    // Sanitize all strings from the scraped page
    return {
      success: true,
      data: {
        title: sanitizeText(data.title || ''),
        company: sanitizeText(data.company || ''),
        description: sanitizeText(data.description || ''),
        location: sanitizeText(data.location || ''),
        source: sanitizeText(data.source || 'Web'),
        url: tab.url,
        confidence: data.confidence || 0,
      },
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw createError(Errors.SCRAPE_FAILED, err.message);
  }
}

/**
 * Function injected into the page context to run the scraper.
 * This runs in the page's world, not the extension's.
 */
function scrapePageInContext() {
  // Inline simplified fallback scraper for injection
  const JOB_KEYWORDS = /\b(engineer|developer|manager|designer|analyst|director|lead|senior|junior|intern|architect)\b/i;

  // Try JSON-LD first
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const posting = data['@type'] === 'JobPosting' ? data : null;
      if (posting) {
        const parser = new DOMParser();
        const descDoc = parser.parseFromString(posting.description || '', 'text/html');
        return {
          title: posting.title || '',
          company: posting.hiringOrganization?.name || '',
          description: descDoc.body.textContent.trim(),
          location: posting.jobLocation?.address?.addressLocality || '',
          source: 'Structured Data',
          confidence: 0.95,
        };
      }
    } catch { /* skip */ }
  }

  // Semantic scraping
  const h1 = document.querySelector('h1');
  const title = h1 ? h1.textContent.trim() : '';

  // Company from title
  let company = '';
  const titleParts = document.title.split(/\s*[-|–—]\s*/);
  if (titleParts.length >= 2) {
    const sorted = [...titleParts].sort((a, b) => a.length - b.length);
    company = sorted[0].trim();
  }
  const ogSite = document.querySelector('meta[property="og:site_name"]');
  if (ogSite?.content) company = ogSite.content;

  // Description: longest text block
  let description = '';
  const containers = document.querySelectorAll('main, article, [role="main"], [class*="description"]');
  for (const el of containers) {
    const text = el.textContent.trim();
    if (text.length > description.length) description = text;
  }
  if (!description) description = document.body.textContent.trim().substring(0, 10000);

  // Location
  const locPattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b|(?:Remote|Hybrid)/i;
  const locMatch = document.body.textContent.match(locPattern);
  const location = locMatch ? locMatch[0] : '';

  const fieldCount = [title, company, description].filter(Boolean).length;
  const confidence = fieldCount >= 3 ? 0.7 : fieldCount >= 2 ? 0.5 : 0.3;

  return { title, company, description: description.substring(0, 15000), location, source: 'Web', confidence };
}

/**
 * Orchestrates cover letter generation.
 * Loads resume, calls API, compiles PDF.
 */
async function handleGenerate(payload) {
  if (!payload || !payload.jobData) {
    throw createError(Errors.INVALID_INPUT, 'Missing job data');
  }

  const resume = await getResume();
  if (!resume) {
    throw createError(Errors.RESUME_NOT_FOUND);
  }

  const apiKey = await getApiKey();
  const { tone = 'professional', length = 'medium', font = 'default' } = payload;

  const result = await generateCoverLetter({
    resume: resume.text,
    jobData: payload.jobData,
    tone,
    length,
    font,
    proxyUrl: PROXY_URL,
    apiKey: apiKey || undefined,
    onChunk: undefined,
  });

  const plainText = latexToPlainText(result.latex);

  return {
    success: true,
    data: {
      latex: result.latex,
      plainText,
      usage: result.usage,
    },
  };
}

/**
 * Compiles LaTeX to PDF via the proxy worker.
 */
async function handleGetPDF(payload) {
  if (!payload || !payload.latex) {
    throw createError(Errors.INVALID_INPUT, 'Missing LaTeX source');
  }

  try {
    const response = await fetch(`${PROXY_URL}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex: payload.latex }),
    });

    if (!response.ok) {
      throw createError(Errors.PDF_COMPILATION_FAILED, `HTTP ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type');

    if (contentType?.includes('application/pdf')) {
      const arrayBuffer = await response.arrayBuffer();
      // Send raw bytes to popup — popup creates and revokes blob URL in its own context
      const bytes = Array.from(new Uint8Array(arrayBuffer));
      return { success: true, data: { pdfBytes: bytes } };
    }

    // Fallback response from proxy (compilation failed, raw text returned)
    const data = await response.json();
    if (data.fallback) {
      return {
        success: true,
        data: {
          fallback: true,
          latex: data.latex,
          plainText: data.plainText,
        },
      };
    }

    throw createError(Errors.PDF_COMPILATION_FAILED);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw createError(Errors.PDF_COMPILATION_FAILED, err.message);
  }
}
