/**
 * Centralized error system for Pave.
 * Every error has a machine-readable code and a human-friendly message.
 */

export class AppError extends Error {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} userMessage - Friendly message shown to the user
   * @param {string} [technicalDetail] - Debug info (never shown to user)
   */
  constructor(code, userMessage, technicalDetail = '') {
    super(userMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.technicalDetail = technicalDetail;
  }
}

/** Pre-defined error constants with user-friendly messages */
export const Errors = Object.freeze({
  RESUME_NOT_FOUND: {
    code: 'RESUME_NOT_FOUND',
    message: 'No resume found. Please upload your resume first.',
  },
  RESUME_TOO_LARGE: {
    code: 'RESUME_TOO_LARGE',
    message: 'Your resume is too long. Please shorten it to under 15,000 characters.',
  },
  RESUME_PARSE_FAILED: {
    code: 'RESUME_PARSE_FAILED',
    message: 'Couldn\'t read your resume file. Try pasting the text instead.',
  },
  RESUME_SCANNED_PDF: {
    code: 'RESUME_SCANNED_PDF',
    message: 'This PDF appears to be a scanned image. Please paste your resume text instead.',
  },
  RESUME_WRONG_FORMAT: {
    code: 'RESUME_WRONG_FORMAT',
    message: 'We support PDF files. Save your resume as PDF first, or paste the text directly.',
  },
  SCRAPE_FAILED: {
    code: 'SCRAPE_FAILED',
    message: 'Couldn\'t read this page. Try pasting the job description below.',
  },
  SCRAPE_NO_JOB_DATA: {
    code: 'SCRAPE_NO_JOB_DATA',
    message: 'No job posting found on this page. Navigate to a specific job listing and try again.',
  },
  SCRAPE_LOGIN_REQUIRED: {
    code: 'SCRAPE_LOGIN_REQUIRED',
    message: 'Please sign in to view this job first, then try Pave again.',
  },
  SCRAPE_LISTING_PAGE: {
    code: 'SCRAPE_LISTING_PAGE',
    message: 'This looks like a job listing page. Please open a specific job posting.',
  },
  API_NETWORK_ERROR: {
    code: 'API_NETWORK_ERROR',
    message: 'Couldn\'t reach the server. Check your internet connection.',
  },
  API_RATE_LIMITED: {
    code: 'API_RATE_LIMITED',
    message: 'You\'ve generated a lot of letters! Try again in a few minutes.',
  },
  API_INVALID_KEY: {
    code: 'API_INVALID_KEY',
    message: 'Invalid API key. Check your settings.',
  },
  API_SERVER_ERROR: {
    code: 'API_SERVER_ERROR',
    message: 'Something went wrong on our end. Try again.',
  },
  API_INVALID_RESPONSE: {
    code: 'API_INVALID_RESPONSE',
    message: 'Got an unexpected response. Try regenerating.',
  },
  PDF_COMPILATION_FAILED: {
    code: 'PDF_COMPILATION_FAILED',
    message: 'Couldn\'t create the PDF. You can copy the text or download the raw file.',
  },
  STORAGE_FULL: {
    code: 'STORAGE_FULL',
    message: 'Browser storage is full. Try clearing some data in settings.',
  },
  INVALID_INPUT: {
    code: 'INVALID_INPUT',
    message: 'Please check your input and try again.',
  },
});

/**
 * Creates an AppError from a pre-defined error constant.
 * @param {Object} errorDef - One of the Errors.* constants
 * @param {string} [technicalDetail] - Optional debug info
 * @returns {AppError}
 */
export function createError(errorDef, technicalDetail = '') {
  return new AppError(errorDef.code, errorDef.message, technicalDetail);
}
