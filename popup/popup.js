/**
 * Popup UI controller — the face of CoverCraft.
 * State machine with 4 states: SETUP → READY → GENERATING → RESULT
 *
 * "Check if we have a resume. If not, show upload. If yes, scrape the page
 *  and show the generate button. After generating, show the cover letter."
 */

import { saveResume, getResume, hasResume, deleteResume, getPreferences, savePreferences, saveApiKey, getApiKey, getStorageUsage, clearAll } from '../utils/storage.js';
import { parseResumeFile, parseResumeText } from '../utils/parser.js';
import { latexToPlainText } from '../utils/latex-preview.js';
import { AppError } from '../utils/errors.js';

// ===== STATE =====
let state = 'SETUP'; // SETUP | READY | GENERATING | RESULT
let currentJobData = null;
let currentResult = null;

const DRAFT_KEY = 'covercraft_draft';
const RESULT_KEY = 'covercraft_result';
const GENERATING_KEY = 'covercraft_generating';

// ===== DOM REFS =====
const $ = (sel) => document.querySelector(sel);
const views = {
  setup: $('#view-setup'),
  ready: $('#view-ready'),
  result: $('#view-result'),
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupEventListeners();

  const resumeExists = await hasResume();
  if (!resumeExists) {
    showView('setup');
    return;
  }

  // Check if we have a pending/completed generation result to restore
  const restored = await restoreResult();
  if (restored) return;

  showView('ready');
  loadPreferences();
  await restoreDraft();
  startScraping();
}

// ===== VIEW MANAGEMENT =====

/**
 * Shows one view, hides others with fade transition.
 * @param {'setup' | 'ready' | 'result'} name
 */
function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    if (key === name) {
      el.hidden = false;
      el.classList.add('fade-in');
    } else {
      el.hidden = true;
      el.classList.remove('fade-in');
    }
  }

  state = name === 'setup' ? 'SETUP' : name === 'ready' ? 'READY' : 'RESULT';
}

// ===== EVENT LISTENERS =====

function setupEventListeners() {
  // Drop zone
  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  dropZone.addEventListener('dragenter', handleDragEnter);
  dropZone.addEventListener('dragover', (e) => e.preventDefault());
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);
  fileInput.addEventListener('change', handleFileSelect);

  // Paste section
  const pasteArea = $('#paste-area');
  const savePasteBtn = $('#save-paste-btn');
  pasteArea.addEventListener('input', () => {
    savePasteBtn.disabled = pasteArea.value.trim().length === 0;
  });
  savePasteBtn.addEventListener('click', handlePasteSave);

  // Dropdown selects (tone, length, font)
  document.querySelectorAll('.select').forEach(select => {
    select.addEventListener('change', (e) => {
      const pref = e.target.dataset.pref;
      const value = e.target.value;
      savePreferences({ [pref]: value });
    });
  });

  // Generate
  $('#generate-btn').addEventListener('click', handleGenerate);

  // Result view
  $('#back-btn').addEventListener('click', () => { clearResult(); showView('ready'); });
  $('#copy-btn').addEventListener('click', handleCopy);
  $('#download-btn').addEventListener('click', async () => {
    // If button says "Recompile PDF", compile first
    if ($('#download-btn').textContent === 'Recompile PDF' && currentResult?.latex) {
      $('#download-btn').disabled = true;
      $('#download-btn').textContent = 'Compiling...';
      const pdfResponse = await chrome.runtime.sendMessage({
        type: 'GET_PDF',
        payload: { latex: currentResult.latex },
      });
      if (pdfResponse.success && pdfResponse.data.pdfBytes) {
        const bytes = new Uint8Array(pdfResponse.data.pdfBytes);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        currentResult.pdfBlobUrl = URL.createObjectURL(blob);
        $('#download-btn').textContent = 'Download PDF';
        $('#download-btn').disabled = false;
      }
      handleDownload();
    } else {
      handleDownload();
    }
  });
  $('#regenerate-btn').addEventListener('click', handleGenerate);
  $('#edit-toggle').addEventListener('click', toggleEdit);

  // Newsletter signup
  const newsletterBtn = $('#newsletter-btn');
  if (newsletterBtn) {
    newsletterBtn.addEventListener('click', () => {
      const email = $('#newsletter-email')?.value?.trim();
      if (!email || !email.includes('@')) return;
      // Store email locally for now — connect to a real service later
      chrome.storage.local.set({ covercraft_newsletter: email });
      $('#newsletter-form').hidden = true;
      $('#newsletter-success').hidden = false;
    });
  }

  // Settings
  $('#settings-btn').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', closeSettings);
  $('#settings-overlay').addEventListener('click', (e) => {
    if (e.target === $('#settings-overlay')) closeSettings();
  });
  $('#replace-resume-btn').addEventListener('click', () => { closeSettings(); showView('setup'); });
  $('#delete-resume-btn').addEventListener('click', () => showConfirm('Delete your resume? This can\'t be undone.', async () => {
    await deleteResume();
    closeSettings();
    showView('setup');
  }));
  $('#save-key-btn').addEventListener('click', handleSaveApiKey);
  $('#clear-all-btn').addEventListener('click', () => showConfirm('Delete all CoverCraft data?', async () => {
    await clearAll();
    closeSettings();
    showView('setup');
  }));

  // Warning bar (make job fields editable)
  $('#job-warning').addEventListener('click', showManualInput);

  // Auto-save manual inputs on every keystroke so they survive popup close
  for (const id of ['#manual-title', '#manual-company', '#manual-description']) {
    const el = $(id);
    if (el) el.addEventListener('input', saveDraft);
  }
}

// ===== FILE UPLOAD =====

function handleDragEnter(e) {
  e.preventDefault();
  const dropZone = $('#drop-zone');
  dropZone.classList.add('active');
  showDropState('active');
}

function handleDragLeave(e) {
  // Prevent false triggers from child elements
  if (e.relatedTarget && $('#drop-zone').contains(e.relatedTarget)) return;
  const dropZone = $('#drop-zone');
  dropZone.classList.remove('active');
  showDropState('default');
}

async function handleDrop(e) {
  e.preventDefault();
  const dropZone = $('#drop-zone');
  dropZone.classList.remove('active');

  const file = e.dataTransfer.files[0];
  if (!file) return;

  await processFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  processFile(file);
}

async function processFile(file) {
  showDropState('parsing', file.name);

  try {
    const text = await parseResumeFile(file);
    await saveResume(text);
    showDropState('success');

    // Transition to ready after a moment
    setTimeout(() => {
      showView('ready');
      loadPreferences();
      startScraping();
    }, 1200);
  } catch (err) {
    const message = err instanceof AppError ? err.userMessage : 'Couldn\'t read this file. Try a different format.';
    showDropState('error', message);
  }
}

async function handlePasteSave() {
  const text = $('#paste-area').value.trim();
  if (!text) return;

  try {
    const cleaned = parseResumeText(text);
    await saveResume(cleaned);
    showView('ready');
    loadPreferences();
    startScraping();
  } catch (err) {
    const message = err instanceof AppError ? err.userMessage : 'Couldn\'t save resume.';
    showDropState('error', message);
  }
}

function showDropState(state, detail = '') {
  const states = ['content', 'active', 'parsing', 'success', 'error'];
  const dropZone = $('#drop-zone');

  dropZone.classList.remove('error', 'success');

  for (const s of states) {
    const el = dropZone.querySelector(`.drop-zone-${s}`);
    if (el) el.hidden = s !== state;
  }

  if (state === 'parsing') {
    $('.parsing-filename').textContent = detail;
  }
  if (state === 'error') {
    dropZone.classList.add('error');
    $('.error-text').textContent = detail;
  }
  if (state === 'success') {
    dropZone.classList.add('success');
  }
}

// ===== DRAFT PERSISTENCE =====
// Saves manual input fields to chrome.storage.session so they survive popup close/reopen

function saveDraft() {
  const draft = {
    title: $('#manual-title')?.value || '',
    company: $('#manual-company')?.value || '',
    description: $('#manual-description')?.value || '',
    timestamp: Date.now(),
  };
  chrome.storage.session.set({ [DRAFT_KEY]: draft });
}

async function restoreDraft() {
  try {
    const result = await chrome.storage.session.get(DRAFT_KEY);
    const draft = result[DRAFT_KEY];
    if (!draft || !draft.title && !draft.description) return;

    // Only restore if draft is less than 30 minutes old
    if (Date.now() - draft.timestamp > 30 * 60 * 1000) return;

    currentJobData = {
      title: draft.title,
      company: draft.company,
      description: draft.description,
      location: '',
      source: 'Manual',
      confidence: 0.8,
    };

    showManualInput();
    if (draft.title || draft.description) {
      displayJobData(currentJobData);
    }
  } catch {
    // chrome.storage.session may not be available in all contexts
  }
}

function clearDraft() {
  chrome.storage.session.remove(DRAFT_KEY);
}

// ===== RESULT PERSISTENCE =====
// Saves generation results so they survive popup close/reopen

function saveResult(result, jobData) {
  chrome.storage.session.set({
    [RESULT_KEY]: {
      ...result,
      pdfBlobUrl: undefined, // Can't persist blob URLs
      jobData,
      timestamp: Date.now(),
    },
  });
}

function saveGeneratingState(jobData, tone, length, font) {
  chrome.storage.session.set({
    [GENERATING_KEY]: { jobData, tone, length, font, timestamp: Date.now() },
  });
}

function clearGeneratingState() {
  chrome.storage.session.remove(GENERATING_KEY);
}

function clearResult() {
  chrome.storage.session.remove(RESULT_KEY);
}

async function restoreResult() {
  try {
    const data = await chrome.storage.session.get([RESULT_KEY, GENERATING_KEY]);

    // If we have a completed result (less than 30 min old), show it
    const result = data[RESULT_KEY];
    if (result && Date.now() - result.timestamp < 30 * 60 * 1000) {
      currentResult = result;
      currentJobData = result.jobData;
      showView('result');
      $('#letter-text').textContent = result.plainText || '';
      // No PDF blob to restore, but user can re-compile or copy text
      $('#download-btn').disabled = true;
      $('#download-btn').textContent = 'Recompile PDF';
      state = 'RESULT';
      return true;
    }

    // If we were mid-generation, restart it
    const generating = data[GENERATING_KEY];
    if (generating && Date.now() - generating.timestamp < 5 * 60 * 1000) {
      currentJobData = generating.jobData;
      showView('ready');
      loadPreferences();
      showManualInput();
      displayJobData(generating.jobData);
      // Auto-restart generation
      state = 'READY';
      return false; // Let user re-click generate
    }
  } catch {
    // Session storage may not be available
  }
  return false;
}

// ===== SCRAPING =====

async function startScraping() {
  // If we already have a draft with content, don't override it with scraping
  const manualTitle = $('#manual-title')?.value?.trim();
  const manualDesc = $('#manual-description')?.value?.trim();
  if (manualTitle || manualDesc) {
    // Draft was restored — keep showing manual input, skip scraping
    return;
  }

  // Show skeleton loading
  $('#job-skeleton').hidden = false;
  $('#job-data').hidden = true;
  $('#no-job').hidden = true;
  $('#manual-input').hidden = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'SCRAPE_PAGE' });

    if (!response.success || !response.data) {
      showNoJob();
      return;
    }

    currentJobData = response.data;

    if (!currentJobData.title && !currentJobData.description) {
      showNoJob();
      return;
    }

    displayJobData(currentJobData);

    // If scraper got data, also show it in manual inputs for easy editing
    showManualInput();
  } catch {
    showNoJob();
  }
}

function displayJobData(data) {
  $('#job-skeleton').hidden = true;
  $('#job-data').hidden = false;
  $('#no-job').hidden = true;

  $('#job-title').textContent = data.title || 'Unknown Position';
  $('#job-company').textContent = data.company || 'Unknown Company';
  $('#job-source').textContent = data.source || 'Web';
  $('#job-location').textContent = data.location || '';

  // Always show manual input alongside scraped data — user can edit
  $('#job-warning').hidden = data.confidence >= 0.5;
}

function showNoJob() {
  $('#job-skeleton').hidden = true;
  $('#job-data').hidden = true;
  $('#no-job').hidden = false;
  showManualInput();
}

function showManualInput() {
  $('#manual-input').hidden = false;
  if (currentJobData) {
    $('#manual-title').value = currentJobData.title || '';
    $('#manual-company').value = currentJobData.company || '';
    $('#manual-description').value = currentJobData.description || '';
  }
}

// ===== PREFERENCES =====

async function loadPreferences() {
  const prefs = await getPreferences();

  document.querySelectorAll('.select').forEach(select => {
    const pref = select.dataset.pref;
    const value = prefs[pref];
    if (value) select.value = value;
  });
}


// ===== GENERATION =====

async function handleGenerate() {
  const generateBtn = $('#generate-btn');
  generateBtn.disabled = true;
  generateBtn.classList.add('loading');

  // Gather job data (from scrape or manual input)
  const jobData = gatherJobData();
  if (!jobData.title || !jobData.description) {
    generateBtn.disabled = false;
    generateBtn.classList.remove('loading');
    return;
  }

  // Gather preferences
  const tone = $('#pref-tone')?.value || 'professional';
  const length = $('#pref-length')?.value || 'medium';
  const font = $('#pref-font')?.value || 'default';

  state = 'GENERATING';
  saveGeneratingState(jobData, tone, length, font);
  showView('result');

  // Show streaming area
  const letterText = $('#letter-text');
  letterText.textContent = '';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  letterText.appendChild(cursor);

  $('#letter-compiling').hidden = true;
  $('#download-btn').disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE',
      payload: { jobData, tone, length, font },
    });

    if (!response.success) {
      letterText.textContent = response.error?.message || 'Something went wrong. Try again.';
      cursor.remove();
      generateBtn.disabled = false;
      generateBtn.classList.remove('loading');
      return;
    }

    currentResult = response.data;
    clearGeneratingState();
    saveResult(currentResult, jobData);

    // Display the result with typewriter effect
    await typewriterEffect(letterText, currentResult.plainText, cursor);
    cursor.remove();

    // Compile PDF
    $('#letter-compiling').hidden = false;
    const pdfResponse = await chrome.runtime.sendMessage({
      type: 'GET_PDF',
      payload: { latex: currentResult.latex },
    });

    $('#letter-compiling').hidden = true;

    if (pdfResponse.success && pdfResponse.data.pdfBytes) {
      // Create blob URL in popup context — will be revoked after download
      const bytes = new Uint8Array(pdfResponse.data.pdfBytes);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      currentResult.pdfBlobUrl = URL.createObjectURL(blob);
      $('#download-btn').disabled = false;
    } else if (pdfResponse.success && pdfResponse.data.fallback) {
      // Fallback: no PDF, but we have text
      $('#download-btn').textContent = 'Download .tex';
      $('#download-btn').disabled = false;
    }
  } catch (err) {
    letterText.textContent = 'Something went wrong. Try again.';
    cursor.remove();
  }

  generateBtn.disabled = false;
  generateBtn.classList.remove('loading');
  state = 'RESULT';
}

function gatherJobData() {
  // Check manual input first
  const manualTitle = $('#manual-title')?.value.trim();
  const manualCompany = $('#manual-company')?.value.trim();
  const manualDesc = $('#manual-description')?.value.trim();

  if (manualTitle && manualDesc) {
    return {
      title: manualTitle,
      company: manualCompany || 'the company',
      description: manualDesc,
      location: currentJobData?.location || '',
    };
  }

  return currentJobData || { title: '', company: '', description: '', location: '' };
}

/**
 * Displays text with a smooth typewriter effect (~30 words/sec).
 */
async function typewriterEffect(container, text, cursor) {
  const words = text.split(/(\s+)/);
  const WORDS_PER_SEC = 30;
  const DELAY_MS = 1000 / WORDS_PER_SEC;

  for (const word of words) {
    container.insertBefore(document.createTextNode(word), cursor);
    container.scrollTop = container.scrollHeight;
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, DELAY_MS)));
  }
}

// ===== RESULT ACTIONS =====

async function handleCopy() {
  if (!currentResult?.plainText) return;

  const btn = $('#copy-btn');
  try {
    await navigator.clipboard.writeText(currentResult.plainText);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Text'; }, 2000);
  } catch {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Copy Text'; }, 2000);
  }
}

function handleDownload() {
  if (!currentResult) return;

  const btn = $('#download-btn');
  const company = (currentJobData?.company || 'Company').replace(/[^a-zA-Z0-9]/g, '');
  const title = (currentJobData?.title || 'Position').replace(/[^a-zA-Z0-9]/g, '');

  if (currentResult.pdfBlobUrl) {
    const a = document.createElement('a');
    a.href = currentResult.pdfBlobUrl;
    a.download = `CoverLetter_${company}_${title}.pdf`;
    a.click();
    // Revoke blob URL after download to free memory
    setTimeout(() => URL.revokeObjectURL(currentResult.pdfBlobUrl), 1000);
  } else if (currentResult.latex) {
    // Fallback: download .tex file
    const blob = new Blob([currentResult.latex], { type: 'application/x-tex' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CoverLetter_${company}_${title}.tex`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    URL.revokeObjectURL(url);
  }

  btn.textContent = 'Downloaded!';
  setTimeout(() => { btn.textContent = 'Download PDF'; }, 2000);
}

function toggleEdit() {
  const preview = $('#letter-preview');
  const editSection = $('#letter-edit');
  const editArea = $('#edit-area');
  const toggle = $('#edit-toggle');

  if (editSection.hidden) {
    editArea.value = currentResult?.plainText || '';
    editSection.hidden = false;
    preview.hidden = true;
    toggle.textContent = 'Preview';
  } else {
    currentResult.plainText = editArea.value;
    editSection.hidden = true;
    preview.hidden = false;
    toggle.textContent = 'Edit';
    $('#letter-text').textContent = editArea.value;
  }
}

// ===== SETTINGS =====

async function openSettings() {
  const overlay = $('#settings-overlay');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Populate resume info as a clean file widget
  const resume = await getResume();
  if (resume) {
    const date = new Date(resume.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const charCount = resume.text.length;
    const sizeLabel = charCount > 1000 ? `${(charCount / 1000).toFixed(1)}k chars` : `${charCount} chars`;
    $('#resume-info').textContent = `Resume · ${sizeLabel} · Saved ${date}`;
  }

  // Populate storage usage
  const usage = await getStorageUsage();
  const usedKB = (usage.used / 1024).toFixed(1);
  const quotaMB = (usage.quota / 1024 / 1024).toFixed(0);
  $('#storage-usage').textContent = `Using ${usedKB}KB of ${quotaMB}MB`;

  // API key
  const key = await getApiKey();
  if (key) {
    $('#api-key-input').value = '••••••••••••' + key.slice(-4);
  }
}

function closeSettings() {
  const overlay = $('#settings-overlay');
  overlay.classList.remove('visible');
  setTimeout(() => { overlay.hidden = true; }, 250);
}

async function handleSaveApiKey() {
  const input = $('#api-key-input');
  const key = input.value.trim();
  if (!key || key.startsWith('••')) return;

  await saveApiKey(key);
  input.value = '••••••••••••' + key.slice(-4);
}

// ===== CONFIRMATION DIALOG =====

function showConfirm(message, onConfirm) {
  const dialog = $('#confirm-dialog');
  $('#confirm-message').textContent = message;
  dialog.hidden = false;

  const yesBtn = $('#confirm-yes');
  const noBtn = $('#confirm-no');

  const cleanup = () => {
    dialog.hidden = true;
    yesBtn.removeEventListener('click', handleYes);
    noBtn.removeEventListener('click', handleNo);
  };

  const handleYes = () => { cleanup(); onConfirm(); };
  const handleNo = () => cleanup();

  yesBtn.addEventListener('click', handleYes);
  noBtn.addEventListener('click', handleNo);
}
