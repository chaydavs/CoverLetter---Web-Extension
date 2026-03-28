/**
 * Universal fallback scraper. Works on ANY website with a job posting.
 *
 * "Ignore the navigation bar, footer, and sidebars. Look at the main content.
 *  Find the biggest heading (job title) and longest chunk of text (description).
 *  Check the page title for the company name."
 */

/** Words that commonly appear in job titles */
const JOB_KEYWORDS = /\b(engineer|developer|manager|designer|analyst|director|lead|senior|junior|intern|architect|coordinator|specialist|consultant|associate|vp|head of|principal)\b/i;

/** Pattern for location strings like "San Francisco, CA" or "Remote" */
const LOCATION_PATTERN = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b|(?:Remote|Hybrid|On-?site)/i;

/**
 * Scrapes job data from any page using semantic and heuristic analysis.
 * @returns {Promise<{title: string, company: string, description: string, location: string, confidence: number}>}
 */
export async function scrapeFallback() {
  // First try JSON-LD structured data — the goldmine
  const jsonLD = extractJsonLD();
  if (jsonLD) {
    return {
      title: jsonLD.title || '',
      company: jsonLD.company || '',
      description: jsonLD.description || '',
      location: jsonLD.location || '',
      confidence: 0.95,
    };
  }

  // Clone the document and strip noise
  const cleanDoc = document.cloneNode(true);
  removeNoiseElements(cleanDoc);

  const mainContent = findMainContent(cleanDoc);
  const title = findJobTitle(mainContent);
  const description = findDescription(mainContent);
  const company = findCompanyName();
  const location = findLocation(mainContent);

  const fieldCount = [title, company, description, location].filter(Boolean).length;
  const confidence = fieldCount >= 3 ? 0.7 : fieldCount >= 2 ? 0.5 : fieldCount >= 1 ? 0.3 : 0.1;

  return { title, company, description, location, confidence };
}

/**
 * Checks for JSON-LD structured data (schema.org/JobPosting).
 * @returns {{title: string, company: string, description: string, location: string} | null}
 */
function extractJsonLD() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const posting = findJobPosting(data);
      if (!posting) continue;

      const description = posting.description
        ? stripHTMLSafe(posting.description)
        : '';

      return {
        title: posting.title || posting.name || '',
        company: posting.hiringOrganization?.name || '',
        description,
        location: extractLocationFromLD(posting.jobLocation),
      };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Recursively finds a JobPosting object in JSON-LD data (may be nested or in an array).
 * @param {*} data
 * @returns {Object | null}
 */
function findJobPosting(data) {
  if (!data) return null;

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }

  if (data['@type'] === 'JobPosting') return data;

  if (data['@graph']) {
    return findJobPosting(data['@graph']);
  }

  return null;
}

/**
 * Extracts a readable location string from JSON-LD jobLocation.
 * @param {*} jobLocation
 * @returns {string}
 */
function extractLocationFromLD(jobLocation) {
  if (!jobLocation) return '';

  const loc = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const address = loc.address;

  if (!address) return loc.name || '';

  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .filter(Boolean);

  return parts.join(', ');
}

/**
 * Removes navigation, footer, header, sidebar, and ad elements from a document clone.
 * @param {Document} doc
 */
function removeNoiseElements(doc) {
  const selectors = [
    'nav', 'footer', 'header', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[aria-label="navigation"]',
    '.nav', '.footer', '.header', '.sidebar',
    '#nav', '#footer', '#header', '#sidebar',
  ];

  for (const selector of selectors) {
    for (const el of doc.querySelectorAll(selector)) {
      el.remove();
    }
  }
}

/**
 * Finds the main content area of the page.
 * Tries semantic elements first, then the largest div by text length.
 *
 * @param {Document} doc
 * @returns {Element}
 */
function findMainContent(doc) {
  const candidates = [
    doc.querySelector('main'),
    doc.querySelector('[role="main"]'),
    doc.querySelector('article'),
  ].filter(Boolean);

  if (candidates.length > 0) return candidates[0];

  // Fall back to the div with the most text content
  const divs = Array.from(doc.querySelectorAll('div'));
  let bestDiv = doc.body;
  let bestLength = 0;

  for (const div of divs) {
    const textLength = div.textContent.trim().length;
    if (textLength > bestLength && textLength < doc.body.textContent.length * 0.9) {
      bestDiv = div;
      bestLength = textLength;
    }
  }

  return bestDiv;
}

/**
 * Finds the job title by scoring heading elements.
 * Higher-level headings near the top of the page score higher.
 * Headings containing job-related keywords get bonus points.
 *
 * @param {Element} container
 * @returns {string}
 */
function findJobTitle(container) {
  const headings = container.querySelectorAll('h1, h2, h3');
  if (headings.length === 0) return '';

  let bestHeading = '';
  let bestScore = -Infinity;

  for (const heading of headings) {
    const text = heading.textContent.trim();
    if (text.length < 3 || text.length > 200) continue;

    let score = 0;

    // Heading level: h1 = 3 points, h2 = 2, h3 = 1
    const level = parseInt(heading.tagName[1], 10);
    score += 4 - level;

    // Position: higher on page = more points
    const rect = heading.getBoundingClientRect?.();
    if (rect && rect.top < 500) score += 2;
    if (rect && rect.top < 200) score += 1;

    // Job keywords boost
    if (JOB_KEYWORDS.test(text)) score += 2;

    // Penalize generic text
    if (/^(apply|sign|log|create|home|menu|about)/i.test(text)) score -= 3;

    // Penalize if it's inside nav/footer that survived cleanup
    const parent = heading.closest('nav, footer, header');
    if (parent) score -= 5;

    if (score > bestScore) {
      bestScore = score;
      bestHeading = text;
    }
  }

  return bestHeading;
}

/**
 * Finds the job description — the longest block of structured text content.
 * "Find the container with the most paragraphs and bullet points."
 *
 * @param {Element} container
 * @returns {string}
 */
function findDescription(container) {
  const candidates = container.querySelectorAll('div, section, article');
  let bestText = '';
  let bestScore = 0;

  for (const el of candidates) {
    const paragraphs = el.querySelectorAll(':scope > p, :scope > ul, :scope > ol');
    const directText = el.textContent.trim();

    const structureScore = paragraphs.length * 100 + el.querySelectorAll('li').length * 50;
    const lengthScore = Math.min(directText.length, 10000);
    const score = structureScore + lengthScore;

    if (directText.length < 200) continue;
    if (directText.length > container.textContent.length * 0.95) continue;

    if (score > bestScore) {
      bestScore = score;
      bestText = directText;
    }
  }

  if (!bestText) {
    bestText = container.textContent.trim();
  }

  if (bestText.length > 15000) {
    bestText = bestText.substring(0, 15000) + '...';
  }

  return bestText;
}

/**
 * Finds the company name from page metadata and title.
 * Parses common title formats: "Title at Company", "Title - Company", "Company: Title"
 *
 * @returns {string}
 */
function findCompanyName() {
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName?.content) return ogSiteName.content;

  const title = document.title;

  const atMatch = title.match(/\bat\s+(.+?)(?:\s*[-|]|$)/i);
  if (atMatch) return atMatch[1].trim();

  const parts = title.split(/\s*[-|–—]\s*/);
  if (parts.length >= 2) {
    const sorted = [...parts].sort((a, b) => a.length - b.length);
    return sorted[0].trim();
  }

  const colonMatch = title.match(/^(.+?):\s/);
  if (colonMatch) return colonMatch[1].trim();

  return '';
}

/**
 * Finds location information by looking for city/state patterns or "Remote".
 *
 * @param {Element} container
 * @returns {string}
 */
function findLocation(container) {
  const text = container.textContent;
  const match = text.match(LOCATION_PATTERN);
  return match ? match[0] : '';
}

/**
 * Strips HTML tags from a string safely using DOMParser + textContent.
 * Never uses innerHTML with untrusted content.
 * @param {string} html
 * @returns {string}
 */
function stripHTMLSafe(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.textContent.trim();
}
