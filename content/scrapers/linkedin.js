/**
 * LinkedIn-specific job scraper.
 * Layers LinkedIn-specific enhancements on top of semantic heuristics.
 *
 * "On LinkedIn, the job title is in a big heading at the top, the company name
 *  links to the company page, and the description has a 'show more' button."
 */

import { scrapeFallback } from './fallback.js';

/**
 * Scrapes a LinkedIn job posting page.
 * @returns {Promise<{title: string, company: string, description: string, location: string, confidence: number}>}
 */
export async function scrapeLinkedIn() {
  // Check for login wall
  if (document.querySelector('.join-form') || document.querySelector('[data-test-id="join-form"]')) {
    return { title: '', company: '', description: '', location: '', confidence: 0 };
  }

  const title = findTitle();
  const company = findCompany();
  const description = await findDescription();
  const location = findLocation();

  const fieldCount = [title, company, description].filter(Boolean).length;

  if (fieldCount < 2) {
    // Low yield — let fallback try
    return scrapeFallback();
  }

  const confidence = fieldCount === 3 ? 0.9 : fieldCount === 2 ? 0.7 : 0.4;

  return { title, company, description, location, confidence };
}

/**
 * Finds the job title on LinkedIn.
 * Tries: h1 headings, elements with job-title-related attributes, then highest-scoring heading.
 * @returns {string}
 */
function findTitle() {
  // Try known semantic patterns (not brittle class names)
  const candidates = [
    ...document.querySelectorAll('h1'),
    ...document.querySelectorAll('h2[class*="title"], h2[class*="heading"]'),
    ...document.querySelectorAll('[data-test-id*="title"], [aria-label*="title"]'),
  ];

  let best = '';
  let bestScore = -1;

  for (const el of candidates) {
    const text = el.textContent.trim();
    if (text.length < 3 || text.length > 200) continue;

    let score = 0;
    if (el.tagName === 'H1') score += 3;
    if (el.tagName === 'H2') score += 2;

    const rect = el.getBoundingClientRect();
    if (rect.top < 400) score += 2;

    // Boost if contains job-related words
    if (/\b(engineer|developer|manager|designer|analyst|lead|senior|director)\b/i.test(text)) {
      score += 2;
    }

    // Penalize navigation/generic
    if (el.closest('nav, header, footer')) score -= 5;
    if (/^(sign|log|join|apply now)/i.test(text)) score -= 3;

    if (score > bestScore) {
      bestScore = score;
      best = text;
    }
  }

  return best;
}

/**
 * Finds the company name on LinkedIn.
 * Looks for links to /company/ pages, then falls back to subtitle text.
 * @returns {string}
 */
function findCompany() {
  // Links to company pages
  const companyLinks = document.querySelectorAll('a[href*="/company/"]');
  for (const link of companyLinks) {
    const text = link.textContent.trim();
    if (text.length > 2 && text.length < 100 && !text.includes('LinkedIn')) {
      return text;
    }
  }

  // Try elements near the top with smaller font (subtitle pattern)
  const subtitles = document.querySelectorAll('h2, h3, [class*="company"], [class*="subtitle"]');
  for (const el of subtitles) {
    const text = el.textContent.trim();
    const rect = el.getBoundingClientRect();
    if (rect.top < 500 && text.length > 2 && text.length < 100) {
      // If it doesn't look like a job title, it might be the company
      if (!/\b(engineer|developer|manager|designer)\b/i.test(text)) {
        return text;
      }
    }
  }

  return '';
}

/**
 * Finds the job description on LinkedIn.
 * Tries to expand "show more" truncated content, then extracts the longest text block.
 * @returns {Promise<string>}
 */
async function findDescription() {
  // Try to expand "show more" buttons
  const showMoreButtons = document.querySelectorAll(
    'button[aria-label*="show more"], button[aria-label*="Show more"]'
  );
  for (const btn of showMoreButtons) {
    try {
      btn.click();
      // Wait a tick for DOM update
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      // Ignore click failures
    }
  }

  // Look for the description container — usually the largest text block
  const containers = document.querySelectorAll(
    '[class*="description"], [class*="details"], article, section'
  );

  let bestText = '';
  let bestLength = 0;

  for (const el of containers) {
    const text = el.textContent.trim();
    if (text.length > bestLength && text.length > 200) {
      bestLength = text.length;
      bestText = text;
    }
  }

  // Check shadow DOM roots (LinkedIn uses them in some views)
  const shadowHosts = document.querySelectorAll('[class*="description"]');
  for (const host of shadowHosts) {
    if (host.shadowRoot) {
      const text = host.shadowRoot.textContent.trim();
      if (text.length > bestLength) {
        bestLength = text.length;
        bestText = text;
      }
    }
  }

  if (bestText.length > 15000) {
    bestText = bestText.substring(0, 15000) + '...';
  }

  return bestText;
}

/**
 * Finds the location on LinkedIn.
 * @returns {string}
 */
function findLocation() {
  // LinkedIn often has location in a span near the title
  const locationPattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b|(?:Remote|Hybrid|On-?site)/i;

  // Check elements near the top of the page
  const topElements = document.querySelectorAll(
    '[class*="location"], [class*="workplace"], span, div'
  );

  for (const el of topElements) {
    const rect = el.getBoundingClientRect();
    if (rect.top > 500) continue;

    const text = el.textContent.trim();
    if (text.length > 100) continue;

    const match = text.match(locationPattern);
    if (match) return match[0];
  }

  return '';
}
