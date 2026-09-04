// ====================================================
// IMPORT-EXPORT — export/import files + compression + shareable links
// Source: phasor_diagram.html lines 5085–5132, 5200–5415
// Exports: exportAllSets, importSetsFromText, compressB64, decompressB64,
//          registerRedrawCallback
// Imports:
//   sets, setIdCounter, setSetIdCounter, globalVars, varOwnership from ./state.js
//   globalAnimRunning, stopGlobalAnim from ./animation.js (via state + anim)
//   buildSetDOM from ./set-dom.js
// ====================================================

import {
  sets, setIdCounter, setSetIdCounter,
  globalVars, varOwnership, globalAnimRunning, globalAnimFreqHz
} from './state.js';
import { stopGlobalAnim } from './animation.js';
import { buildSetDOM } from './set-dom.js';

// Callback injection — set by main.js at startup to avoid circular deps
let _redrawCallback = null;
export function registerRedrawCallback(fn) { _redrawCallback = fn; }

const SET_DELIMITER = '===SET:';
const SET_DELIMITER_END = '===';

// ====================================================
// Compress string → base64url using DeflateRaw
// ====================================================
export async function compressB64(str) {
  const bytes = new TextEncoder().encode(str);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  // base64url encode (URL-safe, no padding)
  let b64 = btoa(String.fromCharCode(...result));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ====================================================
// Decompress base64url → string
// ====================================================
export async function decompressB64(b64url) {
  // Restore standard base64
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(result);
}

// ====================================================
// Export all sets to a .txt file
// ====================================================
export function exportAllSets() {
  const parts = [];
  for (const setObj of sets) {
    const title = setObj.container.querySelector('.set-title-input').value || setObj.title;
    parts.push(`${SET_DELIMITER} ${title} ${SET_DELIMITER_END}`);
    parts.push(setObj.eqInput.value);
    parts.push('');
  }
  const text = parts.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '').replace('T', '_');
  a.download = `phasor_sets_${timestamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const status = document.getElementById('importExportStatus');
  status.textContent = `Exported ${sets.length} set${sets.length > 1 ? 's' : ''} to file.`;
  setTimeout(() => status.textContent = '', 4000);
}

// ====================================================
// Import sets from a text string
// ====================================================
export function importSetsFromText(text) {
  // Parse the file into set blocks
  const lines = text.split('\n');
  const parsedSets = [];
  let currentTitle = null;
  let currentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(SET_DELIMITER)) {
      // Save previous set if exists
      if (currentTitle !== null) {
        parsedSets.push({ title: currentTitle, equations: currentLines.join('\n').trim() });
      }
      // Extract title between ===SET: and ===
      let title = trimmed.substring(SET_DELIMITER.length);
      const endIdx = title.lastIndexOf(SET_DELIMITER_END);
      if (endIdx > 0) title = title.substring(0, endIdx);
      currentTitle = title.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  // Save last set
  if (currentTitle !== null) {
    parsedSets.push({ title: currentTitle, equations: currentLines.join('\n').trim() });
  }

  // If no delimiters found, treat the whole file as a single set
  if (parsedSets.length === 0) {
    parsedSets.push({ title: 'Imported Set', equations: text.trim() });
  }

  // Stop animation
  if (globalAnimRunning) stopGlobalAnim();

  // Remove all existing sets
  const container = document.getElementById('setsContainer');
  container.innerHTML = '';
  sets.length = 0;
  setSetIdCounter(0);
  globalVars.clear();
  varOwnership.clear();

  // Create each set
  for (const setDef of parsedSets) {
    const id = setIdCounter;            // capture BEFORE increment (matches createSet() pattern)
    setSetIdCounter(setIdCounter + 1);
    const setObj = {
      id,
      title: setDef.title,
      adjustments: new Map(),
      scopes: [],
      animRunning: false,
      animAngle: 0,
      animLastTime: 0,
      animFrameId: null,
      animFreqHz: globalAnimFreqHz,
      collapsed: false,
      showValues: true,   // match createSet() default so phasor values are shown
      adjOpen: true,      // match createSet() default so adjustment panel is open
    };
    sets.push(setObj);
    buildSetDOM(setObj);
    setObj.eqInput.value = setDef.equations;
    // Trigger line number sync
    setObj.eqInput.dispatchEvent(new Event('input'));
  }
  if (_redrawCallback) _redrawCallback();

  const status = document.getElementById('importExportStatus');
  status.textContent = `Imported ${parsedSets.length} set${parsedSets.length > 1 ? 's' : ''}: ${parsedSets.map(s => s.title).join(', ')}`;
  setTimeout(() => status.textContent = '', 6000);
}

// ====================================================
// Event wiring for export/import/copy-link buttons
// ====================================================
document.getElementById('btnExport').addEventListener('click', exportAllSets);

document.getElementById('btnImport').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    importSetsFromText(evt.target.result);
    e.target.value = ''; // reset so same file can be re-imported
  };
  reader.readAsText(file);
});

document.getElementById('btnCopyLink').addEventListener('click', async () => {
  const status = document.getElementById('importExportStatus');
  const linkBox = document.getElementById('shareableLinkBox');
  const linkText = document.getElementById('shareableLinkText');
  const linkInfo = document.getElementById('shareableLinkInfo');
  try {
    const stripComments = document.getElementById('chkStripComments').checked;

    function stripEqComments(eq) {
      if (!stripComments) return eq;
      return eq.split('\n')
        .filter(line => {
          const t = line.trim();
          return t !== '' && !t.startsWith('#');
        })
        .map(line => {
          // Remove inline comments (# not inside strings)
          const ci = line.indexOf(' #');
          return ci >= 0 ? line.substring(0, ci).trimEnd() : line;
        })
        .join('\n');
    }

    let content;
    if (sets.length === 1) {
      content = stripEqComments(sets[0].eqInput.value);
    } else {
      const setsData = sets.map(s => ({
        title: s.container.querySelector('.set-title-input').value || s.title,
        eq: stripEqComments(s.eqInput.value)
      }));
      content = JSON.stringify(setsData);
    }

    // Try compressed first
    let hashStr;
    const uncompressed = encodeURIComponent(content);
    try {
      const compressed = await compressB64(content);
      if (compressed.length + 2 < uncompressed.length) {
        hashStr = 'z=' + compressed;
      } else {
        hashStr = uncompressed;
      }
    } catch(e) {
      hashStr = uncompressed;
    }

    let base = window.location.href.split('#')[0].split('?')[0];
    let url;
    if (hashStr.startsWith('z=')) {
      // Use query param so the state survives HTTP redirects (e.g. LinkedIn lnkd.in)
      url = base + '?' + hashStr;
      window.history.replaceState(null, '', url);
    } else {
      url = base + '#' + hashStr;
      window.location.hash = hashStr;
    }

    // Show the link box
    linkBox.style.display = '';
    linkText.value = url;

    const ratio = Math.round((1 - hashStr.length / uncompressed.length) * 100);
    const charCount = url.length;
    let info = `${charCount.toLocaleString()} characters`;
    if (ratio > 0) info += ` · ${ratio}% compressed`;
    info += ` · ${sets.length} set${sets.length > 1 ? 's' : ''}`;
    linkInfo.textContent = info;

    // Also copy to clipboard
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);

    status.textContent = copied ? 'Link copied to clipboard!' : 'Link generated below — select and copy.';
    setTimeout(() => status.textContent = '', 6000);
  } catch(e) {
    status.textContent = 'Error generating link: ' + e.message;
  }
});

// Copy button inside the link box
document.getElementById('btnCopyLinkBox').addEventListener('click', () => {
  const linkText = document.getElementById('shareableLinkText');
  linkText.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch(e) {}
  const status = document.getElementById('importExportStatus');
  status.textContent = copied ? 'Link copied to clipboard!' : 'Select the text and copy manually.';
  setTimeout(() => status.textContent = '', 4000);
});
