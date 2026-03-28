/**
 * Strips LaTeX commands to produce readable plain text for the popup preview.
 * "Go through the text. Remove backslash-commands and braces. Keep all the actual words."
 *
 * This is NOT a full LaTeX parser — it targets the specific template our system prompt generates.
 */

/**
 * Converts LaTeX source to readable plain text.
 * @param {string} latexSource - Full LaTeX document source
 * @returns {string} Human-readable plain text
 */
export function latexToPlainText(latexSource) {
  if (typeof latexSource !== 'string') return '';

  let text = latexSource;

  // 1. Remove preamble (everything from \documentclass to \begin{document})
  const beginDoc = text.indexOf('\\begin{document}');
  if (beginDoc !== -1) {
    text = text.substring(beginDoc + '\\begin{document}'.length);
  }

  // 2. Remove \end{document}
  text = text.replace(/\\end\{document\}/g, '');

  // 3. Remove \begin{...} and \end{...} environment markers
  text = text.replace(/\\begin\{[^}]*\}/g, '');
  text = text.replace(/\\end\{[^}]*\}/g, '');

  // 4. Remove spacing commands: \vspace{...}, \hspace{...}
  text = text.replace(/\\[vh]space\{[^}]*\}/g, '');

  // 5. Convert \\ to newline
  text = text.replace(/\\\\/g, '\n');

  // 6. Convert \today to readable date
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  text = text.replace(/\\today/g, dateStr);

  // 7. Handle text-style commands: \textbf{...} → content, \textit{...} → content
  text = text.replace(/\\text\w+\{([^}]*)\}/g, '$1');

  // 8. Remove remaining \commandname patterns (no arguments)
  text = text.replace(/\\[a-zA-Z]+/g, '');

  // 9. Remove remaining braces
  text = text.replace(/[{}]/g, '');

  // 10. Clean up multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  // 11. Trim whitespace
  return text.trim();
}
