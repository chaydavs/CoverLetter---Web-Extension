/**
 * Claude API client for cover letter generation.
 * Constructs the prompt, calls the API, and validates the LaTeX response.
 *
 * "Send the resume and job details to Claude, ask for a cover letter as LaTeX,
 *  stream the response back as it's generated."
 */

import { Errors, createError } from '../utils/errors.js';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1200;
const TEMPERATURE = 0.7;

const VALID_TONES = ['professional', 'conversational', 'technical'];
const VALID_LENGTHS = ['short', 'medium', 'long'];

const SYSTEM_PROMPT = `You are a professional cover letter writer. You produce cover letters as LaTeX documents that look like they were written by a confident, articulate human who did their research.

=== OUTPUT FORMAT ===
Output ONLY valid LaTeX source code. No explanations, no markdown, no commentary before or after. The document must start with \\documentclass and end with \\end{document}.

Use this exact LaTeX template:

\\documentclass[11pt,letterpaper]{article}
\\usepackage[top=0.7in,bottom=0.7in,left=0.9in,right=0.9in]{geometry}
\\usepackage{parskip}
\\usepackage{microtype}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\pagestyle{empty}
\\setlength{\\parskip}{0.5em}

\\begin{document}
\\noindent\\hfill {\\small [DATE]}

\\noindent Dear Hiring Manager,

[PARAGRAPH 1: THE HOOK — 2-3 sentences]

[PARAGRAPH 2: THE PROOF — 3-5 sentences]

[PARAGRAPH 3: THE CONNECTION + CLOSE — 2-3 sentences]

\\medskip
\\noindent Sincerely,\\\\
[CANDIDATE NAME]
\\end{document}

IMPORTANT: Output ONLY the LaTeX document. No markdown fences, no backticks, no commentary before or after the LaTeX.

=== THE THREE PARAGRAPHS ===

PARAGRAPH 1 — THE HOOK
Purpose: Grab attention in under 5 seconds. Show you know the company.
Rules:
- NEVER open with "I am writing to express my interest," "I am excited to apply," "I am writing to apply," "With great interest," "I saw your posting on," or any variation. These are the most common reason recruiters stop reading.
- NEVER open with your name. The signature has it.
- DO open with one of these proven patterns:
  a) Your strongest relevant achievement: "After scaling [Company]'s email pipeline from 10K to 200K subscribers, I'm looking to bring that growth expertise to [Target Company]'s expanding marketing team."
  b) Specific company knowledge: "[Company]'s recent move into [initiative] caught my attention — it aligns directly with the [specific work] I led at [Previous Company]."
  c) Bold value connection: "I've spent [N] years solving exactly the kind of [challenge type] described in your [role title] posting."
- Name the company within the first 2 sentences.
- Keep it to 40-60 words maximum.

PARAGRAPH 2 — THE PROOF
Purpose: Demonstrate you can solve their problems with hard evidence.
Rules:
- Read the job description carefully. Identify 2-3 key requirements or responsibilities.
- For each requirement, provide a SPECIFIC example from the resume that maps to it.
- Use numbers whenever the resume provides them: percentages, dollar amounts, team sizes, user counts, timeframes.
- Mirror the language of the job description. If they say "cross-functional collaboration," use that phrase.
- If the job lists specific technologies, tools, or methodologies that appear in the resume, name them explicitly.
- This is NOT a resume summary. It is a curated argument: [their need] → [your evidence] → [the result].
- Keep it to 80-120 words.

PARAGRAPH 3 — THE CONNECTION + CLOSE
Purpose: Show mission fit. State your value. Invite the next step.
Rules:
- Reference something specific about the company (mission, product, recent news, culture).
- State the value you would bring on day one in one concrete sentence.
- Close with a confident call to action: "I'd welcome the chance to discuss..." or "I look forward to exploring how..."
- Thank them briefly. One line, not a paragraph.
- Do NOT re-summarize your qualifications. Do NOT say "I believe I would be a great fit."
- Keep it to 40-60 words.

=== TONE MATCHING ===
"professional" — Polished and crisp. Formal sentence structure but not stuffy. Confident without being arrogant. No contractions.
"conversational" — Warm and personable. Natural sentence flow. Contractions are fine. Shows personality while staying appropriate.
"technical" — Skills-forward. Leads with technologies, methodologies, and metrics. Uses industry jargon accurately. Specificity over personality.

=== LENGTH MATCHING ===
"short" — 150-180 words total. 2 tight paragraphs (merge hook + proof, then close).
"medium" — 220-280 words total. 3 paragraphs as described above. The default.
"long" — 300-380 words total. 3-4 paragraphs. Proof paragraph expands.

=== HARD RULES ===
1. NEVER fabricate experience, skills, companies, metrics, or achievements. Only reference what appears in the provided resume.
2. NEVER include LaTeX comments (% lines).
3. ALWAYS escape LaTeX special characters: & → \\& , % → \\% , $ → \\$ , # → \\# , _ → \\_ , { → \\{ , } → \\} , ~ → \\textasciitilde , ^ → \\textasciicircum
4. If the resume contains a full name, use it in the signature. If no name is found, use "[Your Name]".
5. Total word count MUST stay within the requested length range.
6. NEVER use bullet points or numbered lists. The cover letter is a narrative.
7. NEVER use bold or italic formatting in the letter body.
8. Use the DATE provided in preferences, formatted as "Month Day, Year".
9. If a JD requirement has no match in the resume, skip it. Focus only on intersections.
10. Do NOT include a subject line, reference line, or "RE:" line.
11. NEVER use hyphens to connect words for style. No "self-motivated", "detail-oriented", "infrastructure-as-code", "cross-functional", "results-driven", "data-driven", "well-versed", "fast-paced". Rewrite without the hyphen: "I pay attention to detail" not "I am detail-oriented". "I start things on my own" not "I am self-motivated".
12. NEVER use em dashes or en dashes. No "skills that translate — directly" or "my work with LLMs—building pipelines". Use periods or commas instead.
13. Write like a human. Short sentences. Simple words. No corporate buzzwords. No "synergy", "leverage", "spearhead", "passionate about". Just say what you did and why it matters.

=== QUALITY CHECKLIST (verify before outputting) ===
[ ] Opening line is NOT a cliche
[ ] Company name appears in paragraph 1
[ ] Paragraph 2 contains at least 2 specific, resume-backed examples
[ ] At least 1 number/metric from the resume is included (if any exist)
[ ] Paragraph 3 references something specific about the company
[ ] Total word count is within the requested length range
[ ] All LaTeX special characters are properly escaped
[ ] No bullet points, no bold, no italic in body text
[ ] Tone matches the requested setting
[ ] ZERO hyphens connecting words (no compound adjectives)
[ ] ZERO em dashes or en dashes
[ ] Reads like a real person wrote it, not a template`;

/**
 * Generates a cover letter by calling the Claude API (via proxy or direct).
 *
 * @param {Object} params
 * @param {string} params.resume - Resume text
 * @param {Object} params.jobData - { title, company, description, location }
 * @param {string} params.tone - professional | conversational | technical
 * @param {string} params.length - short | medium | long
 * @param {string} params.proxyUrl - URL of the Cloudflare Worker proxy
 * @param {string} [params.apiKey] - Optional BYOK API key
 * @param {Function} [params.onChunk] - Callback for streaming chunks
 * @returns {Promise<{latex: string, usage: {inputTokens: number, outputTokens: number}}>}
 */
export async function generateCoverLetter({ resume, jobData, tone, length, font, proxyUrl, apiKey, onChunk }) {
  // Validate inputs
  validateInputs(resume, jobData, tone, length);

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const fontInstructions = {
    default: '',
    garamond: 'Replace \\\\usepackage{lmodern} with \\\\usepackage{ebgaramond}.',
    helvetica: 'Replace \\\\usepackage{lmodern} with \\\\usepackage{helvet}\\\\renewcommand{\\\\familydefault}{\\\\sfdefault}.',
    palatino: 'Replace \\\\usepackage{lmodern} with \\\\usepackage{palatino}.',
  };

  const userMessage = `<resume>
${resume}
</resume>

<job>
<title>${jobData.title}</title>
<company>${jobData.company}</company>
<location>${jobData.location || 'Not specified'}</location>
<description>
${jobData.description}
</description>
</job>

<preferences>
<tone>${tone}</tone>
<length>${length}</length>
<date>${today}</date>
</preferences>

Generate a cover letter as a complete LaTeX document following your instructions exactly.${fontInstructions[font || 'default'] ? ' Font: ' + fontInstructions[font || 'default'] : ''}`;

  if (apiKey) {
    return callDirectAPI(apiKey, userMessage, onChunk);
  }

  return callProxy(proxyUrl, resume, jobData, tone, length, font, onChunk);
}

/**
 * Validates all inputs before making the API call.
 */
function validateInputs(resume, jobData, tone, length) {
  if (typeof resume !== 'string' || resume.trim().length === 0) {
    throw createError(Errors.RESUME_NOT_FOUND);
  }
  if (!jobData || typeof jobData.title !== 'string' || !jobData.title.trim()) {
    throw createError(Errors.INVALID_INPUT, 'Job title is required');
  }
  if (typeof jobData.company !== 'string' || !jobData.company.trim()) {
    throw createError(Errors.INVALID_INPUT, 'Company name is required');
  }
  if (typeof jobData.description !== 'string' || jobData.description.trim().length < 50) {
    throw createError(Errors.INVALID_INPUT, 'Job description is too short');
  }
  if (!VALID_TONES.includes(tone)) {
    throw createError(Errors.INVALID_INPUT, `Invalid tone: ${tone}`);
  }
  if (!VALID_LENGTHS.includes(length)) {
    throw createError(Errors.INVALID_INPUT, `Invalid length: ${length}`);
  }
}

/**
 * Calls the Cloudflare Worker proxy for generation.
 */
async function callProxy(proxyUrl, resume, jobData, tone, length, font, onChunk) {
  let response;
  try {
    response = await fetch(`${proxyUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume, jobData, tone, length, font }),
    });
  } catch {
    throw createError(Errors.API_NETWORK_ERROR);
  }

  if (!response.ok) {
    handleHTTPError(response.status);
  }

  return readStream(response, onChunk);
}

/**
 * Calls the Claude API directly (BYOK mode).
 */
async function callDirectAPI(apiKey, userMessage, onChunk) {
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        stream: true,
      }),
    });
  } catch {
    throw createError(Errors.API_NETWORK_ERROR);
  }

  if (!response.ok) {
    handleHTTPError(response.status);
  }

  return readStream(response, onChunk);
}

/**
 * Reads an SSE response and collects the full LaTeX response.
 * Works in both service worker and regular contexts by reading the full text first.
 */
async function readStream(response, onChunk) {
  let fullText = '';
  let usage = { inputTokens: 0, outputTokens: 0 };

  // Try streaming with getReader first, fall back to reading full text
  try {
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          parseSSELine(line, (text) => {
            fullText += text;
            if (onChunk) onChunk(text);
          }, usage);
        }
      }
      // Parse any remaining buffer
      if (buffer.trim()) {
        parseSSELine(buffer, (text) => { fullText += text; }, usage);
      }
    } else {
      throw new Error('No streaming support');
    }
  } catch {
    // Fallback: read entire response as text and parse SSE events
    const rawText = await response.text();
    const lines = rawText.split('\n');

    for (const line of lines) {
      parseSSELine(line, (text) => { fullText += text; }, usage);
    }
  }

  if (!fullText.includes('\\documentclass') || !fullText.includes('\\end{document}')) {
    throw createError(Errors.API_INVALID_RESPONSE, 'Response is not valid LaTeX');
  }

  // Strip anything before \documentclass and after \end{document}
  // Claude sometimes adds markdown fences (```) or commentary
  const docStart = fullText.indexOf('\\documentclass');
  const docEnd = fullText.indexOf('\\end{document}') + '\\end{document}'.length;
  const cleanLatex = fullText.substring(docStart, docEnd);

  return { latex: cleanLatex.trim(), usage };
}

/**
 * Parses a single SSE line and extracts text deltas.
 */
function parseSSELine(line, onText, usage) {
  if (!line.startsWith('data:')) return;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return;

  try {
    const parsed = JSON.parse(data);

    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
      onText(parsed.delta.text);
    }
    if (parsed.type === 'message_delta' && parsed.usage) {
      usage.outputTokens = parsed.usage.output_tokens || 0;
    }
    if (parsed.type === 'message_start' && parsed.message?.usage) {
      usage.inputTokens = parsed.message.usage.input_tokens || 0;
    }
  } catch {
    // Skip malformed lines
  }
}

/**
 * Maps HTTP status codes to user-friendly errors.
 */
function handleHTTPError(status) {
  if (status === 429) throw createError(Errors.API_RATE_LIMITED);
  if (status === 401) throw createError(Errors.API_INVALID_KEY);
  if (status >= 500) throw createError(Errors.API_SERVER_ERROR);
  throw createError(Errors.API_NETWORK_ERROR, `HTTP ${status}`);
}
