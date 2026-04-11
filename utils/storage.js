/**
 * Async wrapper around chrome.storage.local.
 * This is the ONLY module that touches chrome.storage — all other files go through here.
 */

import { AppError, Errors, createError } from './errors.js';

const KEYS = {
  RESUME: 'covercraft_resume',
  PREFERENCES: 'covercraft_prefs',
  API_KEY: 'covercraft_apikey',
};

const VALID_TONES = ['professional', 'conversational', 'technical'];
const VALID_LENGTHS = ['short', 'medium', 'long'];
const MAX_RESUME_CHARS = 15000;

/**
 * Saves resume text to local storage after validation.
 * @param {string} text - The resume text to store
 * @returns {Promise<void>}
 */
export async function saveResume(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw createError(Errors.INVALID_INPUT, 'Resume text is empty or not a string');
  }
  if (text.length > MAX_RESUME_CHARS) {
    throw createError(Errors.RESUME_TOO_LARGE, `Resume is ${text.length} chars, max is ${MAX_RESUME_CHARS}`);
  }

  await chrome.storage.local.set({
    [KEYS.RESUME]: { text: text.trim(), savedAt: Date.now() },
  });
}

/**
 * Retrieves the stored resume.
 * @returns {Promise<{text: string, savedAt: number} | null>}
 */
export async function getResume() {
  const result = await chrome.storage.local.get(KEYS.RESUME);
  return result[KEYS.RESUME] || null;
}

/**
 * Quick check if a resume exists without loading the full text.
 * @returns {Promise<boolean>}
 */
export async function hasResume() {
  const result = await chrome.storage.local.get(KEYS.RESUME);
  return result[KEYS.RESUME] != null;
}

/**
 * Deletes the stored resume.
 * @returns {Promise<void>}
 */
export async function deleteResume() {
  await chrome.storage.local.remove(KEYS.RESUME);
}

/**
 * Saves user preferences for tone and length.
 * @param {{tone?: string, length?: string}} prefs
 * @returns {Promise<void>}
 */
export async function savePreferences(prefs) {
  if (typeof prefs !== 'object' || prefs === null) {
    throw createError(Errors.INVALID_INPUT, 'Preferences must be an object');
  }

  const validated = {};

  if (prefs.tone !== undefined) {
    if (!VALID_TONES.includes(prefs.tone)) {
      throw createError(Errors.INVALID_INPUT, `Invalid tone: ${prefs.tone}. Must be one of: ${VALID_TONES.join(', ')}`);
    }
    validated.tone = prefs.tone;
  }

  if (prefs.length !== undefined) {
    if (!VALID_LENGTHS.includes(prefs.length)) {
      throw createError(Errors.INVALID_INPUT, `Invalid length: ${prefs.length}. Must be one of: ${VALID_LENGTHS.join(', ')}`);
    }
    validated.length = prefs.length;
  }

  const current = await getPreferences();
  await chrome.storage.local.set({
    [KEYS.PREFERENCES]: { ...current, ...validated },
  });
}

/**
 * Retrieves user preferences or returns defaults.
 * @returns {Promise<{tone: string, length: string}>}
 */
export async function getPreferences() {
  const result = await chrome.storage.local.get(KEYS.PREFERENCES);
  return {
    tone: 'professional',
    length: 'medium',
    ...(result[KEYS.PREFERENCES] || {}),
  };
}

/**
 * Saves a BYOK (Bring Your Own Key) API key.
 * Stored with basic base64 obfuscation — not encryption, but prevents casual inspection.
 * @param {string} key - The Anthropic API key
 * @returns {Promise<void>}
 */
export async function saveApiKey(key) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw createError(Errors.INVALID_INPUT, 'API key is empty');
  }

  const obfuscated = btoa(key.trim());
  await chrome.storage.local.set({ [KEYS.API_KEY]: obfuscated });
}

/**
 * Retrieves the stored API key, or null if none.
 * @returns {Promise<string | null>}
 */
export async function getApiKey() {
  const result = await chrome.storage.local.get(KEYS.API_KEY);
  if (!result[KEYS.API_KEY]) return null;

  try {
    return atob(result[KEYS.API_KEY]);
  } catch {
    return null;
  }
}

/**
 * Returns current storage usage in bytes.
 * @returns {Promise<{used: number, quota: number}>}
 */
export async function getStorageUsage() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  return {
    used: bytesInUse,
    quota: 5 * 1024 * 1024, // chrome.storage.local default is 5MB
  };
}

/**
 * Wipes all Pave data from storage.
 * @returns {Promise<void>}
 */
export async function clearAll() {
  await chrome.storage.local.remove(Object.values(KEYS));
}
