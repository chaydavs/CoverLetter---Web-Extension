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

const SYSTEM_PROMPT = `You write cover letters as LaTeX documents. You sound like a real person, not a template.

OUTPUT: Only valid LaTeX. Nothing before \\documentclass. Nothing after \\end{document}. No markdown, no commentary.

TEMPLATE (use exactly):
\\documentclass[11pt,letterpaper]{article}
\\usepackage[top=0.7in,bottom=0.7in,left=0.85in,right=0.85in]{geometry}
\\usepackage{parskip}
\\usepackage{microtype}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\pagestyle{empty}
\\raggedbottom
\\setlength{\\parskip}{0.5em}
\\setlength{\\parindent}{0pt}
\\begin{document}
\\begin{flushright}
[DATE]
\\end{flushright}
\\vspace{-0.5em}
Hi there,

[BODY: 2-3 paragraphs, under 220 words total]

Best,\\\\
[NAME from resume, or "Your Name" if not found]
\\end{document}

STRUCTURE (research-backed):
Paragraph 1: Lead with your value. What specific thing from your background connects to what they need? Reference the company by name and something specific from the job description. Do NOT say "I am excited to apply" or "I am writing to express interest."
Paragraph 2: Pick 2 concrete wins from the resume that map directly to job requirements. Use the STAR approach: briefly describe what you did and the measurable result. Include numbers when available. Do NOT just list skills or rehash the resume.
Paragraph 3 (optional, only if "medium" or "long" length): Connect to the company mission or explain why this role specifically. End with a confident, forward looking sentence. Not "I look forward to hearing from you" but something specific about what you want to contribute.

STYLE RULES:
- Simple language. Short sentences. Write like you talk. A hiring manager should be able to read this at a glance.
- Never use hyphens, em dashes, or en dashes for style. No "results-driven", "cross-functional", "world-class".
- Never use excessive adverbs like "absolutely thrilled" or "very excitedly". Genuine beats polished.
- Never fabricate experience. Only reference what is in the resume.
- Never apologize for missing experience. Emphasize what transfers.
- No LaTeX comments (no % lines).
- Escape LaTeX special characters: & % $ # _ { } ~ ^

TONE:
- "professional": clean, direct, confident. Not stiff.
- "conversational": warm, personality shows. Like emailing someone you respect but don't know well.
- "technical": lead with technologies and systems. Industry terminology. Still human.

LENGTH:
- "short": 120-160 words, 2 paragraphs
- "medium": 180-220 words, 3 paragraphs
- "long": 220-280 words, 3-4 paragraphs

All lengths MUST fit one page.`;

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
<font>${font || 'default'}</font>
<date>${today}</date>
</preferences>

Generate a cover letter as a complete LaTeX document. Use the specified font:
- "default" = lmodern (Latin Modern, the default)
- "garamond" = add \\usepackage{ebgaramond} and remove lmodern
- "helvetica" = add \\usepackage{helvet}\\renewcommand{\\familydefault}{\\sfdefault} and remove lmodern
- "palatino" = add \\usepackage{palatino} and remove lmodern

The ENTIRE letter must fit on ONE page. Do not exceed 300 words.`;

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

  return { latex: fullText.trim(), usage };
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
