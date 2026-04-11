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

const SYSTEM_PROMPT = `You are a professional cover letter writer. You produce cover letters as LaTeX documents. Your letters sound like a confident, articulate human — never robotic, never generic.

OUTPUT FORMAT:
You MUST output ONLY valid LaTeX source code. No explanation, no markdown, no commentary. Just the LaTeX document from \\documentclass to \\end{document}.

Use this exact template structure:
\\documentclass[11pt,letterpaper]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{parskip}
\\usepackage{microtype}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\pagestyle{empty}

\\begin{document}

\\begin{flushright}
[TODAY'S DATE - e.g., March 28, 2026]
\\end{flushright}

\\vspace{0.3em}

Dear Hiring Manager,

[2-4 PARAGRAPHS]

Sincerely,\\\\
[CANDIDATE NAME - extract from resume]

\\end{document}

WRITING RULES:
1. NEVER open with "I am writing to express my interest" or "I am excited to apply" — start with something specific about the company, the role, or a relevant achievement.
2. NEVER write "I believe I would be a great fit" — show fit through specific evidence.
3. Pull 2-3 concrete achievements from the resume that directly map to job requirements. Use numbers when the resume provides them.
4. Mention the company by name. Reference something specific from the job description (a technology, a mission, a product).
5. Close with a confident forward-looking statement, not a desperate plea.
6. Match the requested tone exactly:
   - "professional": polished, formal, third-person-feeling even though it's first person
   - "conversational": warm, personable, shows personality while staying appropriate
   - "technical": leads with skills and technologies, uses industry terminology
7. Match the requested length:
   - "short": 150-200 words, 2 tight paragraphs
   - "medium": 250-300 words, 3 paragraphs
   - "long": 350-400 words, 4 paragraphs
8. NEVER fabricate experience. Only reference skills, companies, and achievements present in the resume.
9. NEVER add LaTeX comments. No % comment lines and never use hypens, underscores, or other special characters in LaTeX commands or environments. Only use plain text in the content.
10. Escape all LaTeX special characters in names, companies, and text: & % $ # _ { } ~ ^
11. If the resume contains a name, use it in the signature. If no name is found, use "[Your Name]".`;


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
export async function generateCoverLetter({ resume, jobData, tone, length, proxyUrl, apiKey, onChunk }) {
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
<date>${today}</date>
</preferences>

Generate a cover letter as a complete LaTeX document.`;

  if (apiKey) {
    return callDirectAPI(apiKey, userMessage, onChunk);
  }

  return callProxy(proxyUrl, resume, jobData, tone, length, onChunk);
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
async function callProxy(proxyUrl, resume, jobData, tone, length, onChunk) {
  let response;
  try {
    response = await fetch(`${proxyUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume, jobData, tone, length }),
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
