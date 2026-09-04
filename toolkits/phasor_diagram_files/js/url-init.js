// ====================================================
// URL INIT — initFromURL() + loadFromText()
// Source: phasor_diagram.html lines 4962–5083
// Exports: loadFromText, initFromURL, registerRedrawCallback
// Imports:
//   sets, setIdCounter, setSetIdCounter from ./state.js
//   PRESETS from ./presets.js
//   createSet, removeSet from ./set-dom.js
//   decompressB64 from ./import-export.js
// ====================================================

import { sets, setIdCounter, setSetIdCounter, setBatchLoading } from './state.js';
import { PRESETS } from './presets.js';
import { createSet, removeSet } from './set-dom.js';
import { decompressB64 } from './import-export.js';

// Callback injection — set by main.js at startup to avoid circular deps
let _redrawCallback = null;
export function registerRedrawCallback(fn) { _redrawCallback = fn; }

// ====================================================
// Helper: load sets from decoded text (plain eq or JSON array)
// ====================================================
export function loadFromText(text) {
  setBatchLoading(true);
  // Remove any existing sets
  while (sets.length > 0) {
    const s = sets[0];
    if (s.animFrameId) cancelAnimationFrame(s.animFrameId);
    s.container.remove();
    sets.splice(0, 1);
  }
  document.getElementById('setsContainer').innerHTML = '';
  setSetIdCounter(0);

  let created = [];
  if (text.startsWith('[')) {
    try {
      const setsData = JSON.parse(text);
      for (const sd of setsData) {
        const setObj = createSet(null);
        setObj.eqInput.value = sd.eq || '';
        if (sd.title) setObj.container.querySelector('.set-title-input').value = sd.title;
        created.push(setObj);
      }
    } catch(e) {}
  }
  if (created.length === 0) {
    const setObj = createSet(null);
    setObj.eqInput.value = text;
    created.push(setObj);
  }
  setBatchLoading(false);

  // Trigger input event on each to sync line numbers
  for (const s of created) {
    s.eqInput.dispatchEvent(new Event('input'));
  }
  // Double draw to ensure scopes are built then rendered
  if (_redrawCallback) _redrawCallback();
  requestAnimationFrame(() => { if (_redrawCallback) _redrawCallback(); });
}

// ====================================================
// INIT — load from URL params or default preset
// ====================================================
export function initFromURL() {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;

  // ?preset=phasedist  — load a named preset
  if (params.has('preset')) {
    const presetKey = params.get('preset');
    if (PRESETS[presetKey]) {
      createSet(presetKey);
      return;
    }
  }

  // ?eq=...  — single set with URL-encoded equations
  if (params.has('eq')) {
    setBatchLoading(true);
    while (sets.length > 0) removeSet(sets[0].id);
    document.getElementById('setsContainer').innerHTML = '';
    const eqText = params.get('eq');
    const title = params.get('title') || 'Set 1';
    const setObj = createSet(null);
    setObj.eqInput.value = eqText;
    setObj.container.querySelector('.set-title-input').value = title;
    setBatchLoading(false);
    if (_redrawCallback) _redrawCallback();
    requestAnimationFrame(() => { if (_redrawCallback) _redrawCallback(); });
    return;
  }

  // ?z= — compressed query param (survives HTTP redirects / LinkedIn lnkd.in)
  if (params.has('z')) {
    decompressB64(params.get('z')).then(text => {
      loadFromText(text);
    }).catch(() => { createSet('lag'); });
    return;
  }

  // #z=... — compressed hash (deflate + base64url)
  // #... — uncompressed hash (plain or JSON)
  if (hash && hash.length > 1) {
    const raw = hash.substring(1);
    if (raw.startsWith('z=')) {
      // Compressed
      decompressB64(raw.substring(2)).then(text => {
        loadFromText(text);
      }).catch(() => { createSet('lag'); });
      return;
    }
    // Uncompressed
    try {
      const decoded = decodeURIComponent(raw);
      loadFromText(decoded);
      return;
    } catch(e) { /* fall through */ }
  }

  // ?sets=...  — JSON-encoded multi-set
  if (params.has('sets')) {
    try {
      setBatchLoading(true);
      while (sets.length > 0) removeSet(sets[0].id);
      document.getElementById('setsContainer').innerHTML = '';
      const setsData = JSON.parse(params.get('sets'));
      for (const sd of setsData) {
        const setObj = createSet(null);
        setObj.eqInput.value = sd.eq || '';
        if (sd.title) setObj.container.querySelector('.set-title-input').value = sd.title;
      }
      setBatchLoading(false);
      if (_redrawCallback) _redrawCallback();
      requestAnimationFrame(() => { if (_redrawCallback) _redrawCallback(); });
      return;
    } catch(e) { setBatchLoading(false); /* fall through */ }
  }

  // Default
  createSet('lag');
}
