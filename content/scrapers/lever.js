/**
 * Lever job posting scraper (jobs.lever.co).
 * Clean, consistent HTML structure with sections for each part of the posting.
 *
 * "Lever pages are organized: title in the headline, description split into
 *  sections (about the role, requirements), metadata bar with location."
 */

import { scrapeFallback } from './fallback.js';

/**
 * Scrapes a Lever job posting page.
 * @returns {Promise<{title: string, company: string, description: string, location: string, confidence: number}>}
 */
export async function scrapeLever() {
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
 * Finds the job title from the posting headline.
 * @returns {string}
 */
function findTitle() {
  // Lever uses a prominent heading for the job title
  const headline = document.querySelector(
    'h2[class*="posting-headline"], h1, [class*="posting-headline"] h2'
  );
  if (headline) {
    const text = headline.textContent.trim();
    if (text.length > 2 && text.length < 200) return text;
  }

  const h1 = document.querySelector('h1');
  if (h1) return h1.textContent.trim();

  return '';
}

/**
 * Finds the company name. Lever pages often show it in the header.
 * @returns {string}
 */
function findCompany() {
  // Lever URL structure: jobs.lever.co/company-name/...
  const urlMatch = window.location.pathname.match(/^\/([^/]+)/);
  if (urlMatch) {
    const slug = urlMatch[1];
    // Convert slug to readable name (kebab-case to Title Case)
    const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (name.length > 1) return name;
  }

  // Try page title
  const titleMatch = document.title.match(/^(.+?)\s*[-–—]/);
  if (titleMatch) return titleMatch[1].trim();

  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName?.content) return ogSiteName.content;

  return '';
}

/**
 * Finds the job description by concatenating all posting sections.
 * Lever splits descriptions into multiple divs (about, requirements, benefits, etc.).
 * @returns {string}
 */
function findDescription() {
  // Try to find all content sections
  const sections = document.querySelectorAll(
    '[class*="posting-section"], [class*="section-wrapper"], .content'
  );

  if (sections.length > 0) {
    const texts = Array.from(sections)
      .map(s => s.textContent.trim())
      .filter(t => t.length > 50);

    if (texts.length > 0) {
      const combined = texts.join('\n\n');
      return combined.length > 15000 ? combined.substring(0, 15000) + '...' : combined;
    }
  }

  // Fallback: grab the main content area
  const main = document.querySelector('main, [class*="posting"], [class*="content"]');
  if (main) {
    const text = main.textContent.trim();
    return text.length > 15000 ? text.substring(0, 15000) + '...' : text;
  }

  return '';
}

/**
 * Finds location from the metadata bar below the title.
 * @returns {string}
 */
function findLocation() {
  // Lever has a metadata bar with location, department, etc.
  const metaItems = document.querySelectorAll(
    '[class*="posting-categories"] [class*="location"], [class*="workplaceTypes"], [class*="location"]'
  );

  for (const el of metaItems) {
    const text = el.textContent.trim();
    if (text.length > 1 && text.length < 100) return text;
  }

  const pattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b|(?:Remote|Hybrid)/i;
  const bodyText = document.body.textContent.substring(0, 5000);
  const match = bodyText.match(pattern);
  return match ? match[0] : '';
}
