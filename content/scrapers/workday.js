/**
 * Workday job posting scraper (*.myworkdayjobs.com).
 * Single-page app with React rendering — content loads dynamically.
 *
 * "Workday pages are slow: content appears after JavaScript loads.
 *  We wait for it, then check for structured data. If that fails,
 *  we read the visible headings and text."
 */

import { scrapeFallback } from './fallback.js';

const LOAD_TIMEOUT_MS = 5000;

/**
 * Scrapes a Workday job posting page.
 * Waits for dynamic content to load before extracting.
 * @returns {Promise<{title: string, company: string, description: string, location: string, confidence: number}>}
 */
export async function scrapeWorkday() {
  // Wait for content to appear in the DOM
  await waitForContent();

  // Try JSON-LD first — Workday sometimes includes structured data
  const jsonLD = extractJsonLD();
  if (jsonLD) {
    return { ...jsonLD, confidence: 0.9 };
  }

  const title = findTitle();
  const company = findCompany();
  const description = findDescription();
  const location = findLocation();

  const fieldCount = [title, company, description].filter(Boolean).length;

  if (fieldCount < 2) {
    return scrapeFallback();
  }

  const confidence = fieldCount === 3 ? 0.8 : 0.5;

  return { title, company, description, location, confidence };
}

/**
 * Waits for Workday's dynamic content to render.
 * Uses MutationObserver to detect when job content appears.
 * Times out after 5 seconds.
 * @returns {Promise<void>}
 */
function waitForContent() {
  return new Promise(resolve => {
    // Check if content already loaded
    if (document.querySelector('h1, h2, [data-automation-id]')) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, LOAD_TIMEOUT_MS);

    const observer = new MutationObserver(() => {
      if (document.querySelector('h1, h2, [data-automation-id]')) {
        observer.disconnect();
        clearTimeout(timeout);
        resolve();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * Checks for JSON-LD structured data.
 * @returns {{title: string, company: string, description: string, location: string} | null}
 */
function extractJsonLD() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (data['@type'] !== 'JobPosting' && !data['@graph']) continue;

      const posting = data['@type'] === 'JobPosting'
        ? data
        : data['@graph']?.find(item => item['@type'] === 'JobPosting');

      if (!posting) continue;

      return {
        title: posting.title || '',
        company: posting.hiringOrganization?.name || '',
        description: posting.description
          ? stripHTMLSafe(posting.description)
          : '',
        location: posting.jobLocation?.address?.addressLocality || '',
      };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Finds the job title. Workday uses data-automation-id attributes.
 * @returns {string}
 */
function findTitle() {
  const candidates = [
    document.querySelector('[data-automation-id="jobPostingHeader"] h2'),
    document.querySelector('[data-automation-id*="title"]'),
    document.querySelector('h1'),
    document.querySelector('h2'),
  ].filter(Boolean);

  for (const el of candidates) {
    const text = el.textContent.trim();
    if (text.length > 2 && text.length < 200) return text;
  }

  return '';
}

/**
 * Finds the company name.
 * @returns {string}
 */
function findCompany() {
  // Workday URLs often contain the company: company.myworkdayjobs.com
  const hostMatch = window.location.hostname.match(/^([^.]+)\.myworkdayjobs/);
  if (hostMatch) {
    const slug = hostMatch[1];
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName?.content) return ogSiteName.content;

  return '';
}

/**
 * Finds the job description from the page content.
 * @returns {string}
 */
function findDescription() {
  const candidates = [
    document.querySelector('[data-automation-id="jobPostingDescription"]'),
    document.querySelector('[class*="description"]'),
    document.querySelector('main'),
  ].filter(Boolean);

  let bestText = '';

  for (const el of candidates) {
    const text = el.textContent.trim();
    if (text.length > bestText.length) {
      bestText = text;
    }
  }

  if (bestText.length > 15000) {
    bestText = bestText.substring(0, 15000) + '...';
  }

  return bestText;
}

/**
 * Finds location information.
 * @returns {string}
 */
function findLocation() {
  const locEl = document.querySelector(
    '[data-automation-id*="location"], [class*="location"]'
  );
  if (locEl) {
    const text = locEl.textContent.trim();
    if (text.length < 100) return text;
  }

  const pattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b|(?:Remote|Hybrid)/i;
  const bodyText = document.body.textContent.substring(0, 5000);
  const match = bodyText.match(pattern);
  return match ? match[0] : '';
}

/**
 * Strips HTML safely using DOMParser.
 * @param {string} html
 * @returns {string}
 */
function stripHTMLSafe(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.textContent.trim();
}
