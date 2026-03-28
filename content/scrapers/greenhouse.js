/**
 * Greenhouse job board scraper (boards.greenhouse.io).
 * Simpler HTML structure — mostly server-rendered.
 *
 * "Greenhouse pages are clean: job title is the first big heading,
 *  description is in the main content area, company name is in the header."
 */

import { scrapeFallback } from './fallback.js';

/**
 * Scrapes a Greenhouse job posting page.
 * @returns {Promise<{title: string, company: string, description: string, location: string, confidence: number}>}
 */
export async function scrapeGreenhouse() {
  const title = findTitle();
  const company = findCompany();
  const description = findDescription();
  const location = findLocation();

  const fieldCount = [title, company, description].filter(Boolean).length;

  if (fieldCount < 2) {
    return scrapeFallback();
  }

  const confidence = fieldCount === 3 ? 0.85 : 0.6;

  return { title, company, description, location, confidence };
}

/**
 * Finds the job title. On Greenhouse, it's almost always the first h1.
 * @returns {string}
 */
function findTitle() {
  const h1 = document.querySelector('h1');
  if (h1) {
    const text = h1.textContent.trim();
    if (text.length > 2 && text.length < 200) return text;
  }

  // Fallback to first h2
  const h2 = document.querySelector('h2');
  if (h2) {
    const text = h2.textContent.trim();
    if (text.length > 2 && text.length < 200) return text;
  }

  return '';
}

/**
 * Finds the company name from the header or page title.
 * @returns {string}
 */
function findCompany() {
  // Greenhouse often has company in the page title as "Job at Company"
  const titleMatch = document.title.match(/\bat\s+(.+?)(?:\s*[-|]|$)/i);
  if (titleMatch) return titleMatch[1].trim();

  // Try og:site_name
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName?.content) return ogSiteName.content;

  // Try the header area
  const header = document.querySelector('header, .company-name, [class*="company"]');
  if (header) {
    const text = header.textContent.trim();
    if (text.length > 1 && text.length < 100) return text;
  }

  return '';
}

/**
 * Finds the job description. Usually in a div with id="content" or class *description*.
 * @returns {string}
 */
function findDescription() {
  const candidates = [
    document.querySelector('#content'),
    document.querySelector('[class*="description"]'),
    document.querySelector('[class*="posting"]'),
    document.querySelector('main'),
  ].filter(Boolean);

  let bestText = '';
  let bestLength = 0;

  for (const el of candidates) {
    const text = el.textContent.trim();
    if (text.length > bestLength) {
      bestLength = text.length;
      bestText = text;
    }
  }

  if (bestText.length > 15000) {
    bestText = bestText.substring(0, 15000) + '...';
  }

  return bestText;
}

/**
 * Finds location from metadata or content.
 * @returns {string}
 */
function findLocation() {
  const locationEl = document.querySelector(
    '[class*="location"], [class*="metadata"] span'
  );
  if (locationEl) {
    const text = locationEl.textContent.trim();
    if (text.length < 100) return text;
  }

  const pattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b|(?:Remote|Hybrid)/i;
  const bodyText = document.body.textContent;
  const match = bodyText.match(pattern);
  return match ? match[0] : '';
}
