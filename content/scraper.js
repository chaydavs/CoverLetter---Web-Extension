/**
 * Main content script entry point for job page scraping.
 * Detects the current site, runs the appropriate scraper, falls back to universal scraper.
 *
 * "Look at the URL to figure out which job board we're on, then use the best method
 *  to find the job title, company, and description on the page."
 */

import { scrapeLinkedIn } from './scrapers/linkedin.js';
import { scrapeGreenhouse } from './scrapers/greenhouse.js';
import { scrapeLever } from './scrapers/lever.js';
import { scrapeWorkday } from './scrapers/workday.js';
import { scrapeFallback } from './scrapers/fallback.js';

/**
 * Detects the job board from the current URL and returns the appropriate scraper.
 * @param {string} url - Current page URL
 * @returns {{ name: string, scrape: Function } | null}
 */
function detectSite(url) {
  const sites = [
    { pattern: /linkedin\.com\/jobs\/view/i, name: 'LinkedIn', scrape: scrapeLinkedIn },
    { pattern: /greenhouse\.io/i, name: 'Greenhouse', scrape: scrapeGreenhouse },
    { pattern: /lever\.co/i, name: 'Lever', scrape: scrapeLever },
    { pattern: /myworkdayjobs\.com/i, name: 'Workday', scrape: scrapeWorkday },
  ];

  for (const site of sites) {
    if (site.pattern.test(url)) {
      return { name: site.name, scrape: site.scrape };
    }
  }
  return null;
}

/**
 * Scrapes job data from the current page.
 * Tries site-specific scraper first, falls back to universal scraper.
 *
 * @returns {Promise<{title: string, company: string, description: string, location: string, source: string, url: string, confidence: number}>}
 */
export async function scrapePage() {
  const url = window.location.href;
  const site = detectSite(url);

  let siteResult = null;
  let fallbackResult = null;

  // Try site-specific scraper
  if (site) {
    try {
      siteResult = await site.scrape();
      siteResult.source = site.name;
      siteResult.url = url;

      // If high confidence, return directly
      if (siteResult.confidence >= 0.5) {
        return siteResult;
      }
    } catch {
      siteResult = null;
    }
  }

  // Run fallback scraper
  try {
    fallbackResult = await scrapeFallback();
    fallbackResult.source = site ? site.name : 'Web';
    fallbackResult.url = url;
  } catch {
    fallbackResult = null;
  }

  // Merge results: prefer site-specific fields with higher confidence
  if (siteResult && fallbackResult) {
    return mergeResults(siteResult, fallbackResult);
  }

  if (siteResult) return siteResult;
  if (fallbackResult) return fallbackResult;

  return {
    title: '',
    company: '',
    description: '',
    location: '',
    source: 'Unknown',
    url,
    confidence: 0,
  };
}

/**
 * Merges results from site-specific and fallback scrapers.
 * For each field, takes the non-empty value with higher confidence.
 *
 * @param {Object} primary - Site-specific result
 * @param {Object} fallback - Universal fallback result
 * @returns {Object} Merged result
 */
function mergeResults(primary, fallback) {
  return {
    title: primary.title || fallback.title,
    company: primary.company || fallback.company,
    description: primary.description || fallback.description,
    location: primary.location || fallback.location,
    source: primary.source,
    url: primary.url,
    confidence: Math.max(primary.confidence, fallback.confidence),
  };
}
