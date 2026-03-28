/**
 * Sanitization utilities for CoverCraft.
 * All external content passes through these before rendering or processing.
 */

/** Tags allowed in sanitized HTML output */
const ALLOWED_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'em']);

/**
 * Strips all HTML tags except a safe allowlist using DOMParser + TreeWalker.
 * "Walk through every element in the HTML tree. If it's on the safe list, keep it.
 * If not, replace it with just its text content."
 *
 * @param {string} rawHTML - Untrusted HTML string
 * @returns {string} Sanitized HTML with only allowed tags
 */
export function sanitizeHTML(rawHTML) {
  if (typeof rawHTML !== 'string') return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHTML, 'text/html');
  const output = document.createElement('div');

  processNode(doc.body, output);

  return output.innerHTML;
}

/**
 * Recursively processes DOM nodes, keeping only allowed tags.
 * @param {Node} source - The source node to process
 * @param {Node} target - The target node to append safe content to
 */
function processNode(source, target) {
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent));
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tagName = child.tagName.toLowerCase();

    if (ALLOWED_TAGS.has(tagName)) {
      const safeElement = document.createElement(tagName);
      processNode(child, safeElement);
      target.appendChild(safeElement);
    } else {
      // Not allowed — flatten to text, keep children
      processNode(child, target);
    }
  }
}

/**
 * Escapes HTML entities in a string so it can be safely inserted as text content.
 * "Replace characters that HTML treats as special with their safe versions."
 *
 * @param {string} raw - Untrusted string
 * @returns {string} Escaped string safe for text display
 */
export function sanitizeText(raw) {
  if (typeof raw !== 'string') return '';

  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Escapes LaTeX special characters so user-provided text doesn't break compilation.
 * LaTeX has 10 special characters: & % $ # _ { } ~ ^ \
 *
 * @param {string} text - Raw text that may contain LaTeX special chars
 * @returns {string} Text safe for inclusion in a LaTeX document
 */
export function sanitizeForLatex(text) {
  if (typeof text !== 'string') return '';

  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}
