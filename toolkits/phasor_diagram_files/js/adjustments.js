// ====================================================
// ADJUSTMENTS — slider helpers + phasor drag interaction
// Source: phasor_diagram.html lines 3100–3143, 3145–3262, 3258–3262
// Exports: getAdj, hasAdj, anyAdjActive, updateSliderUI, applyAdj,
//          addPhasorDragInteraction, registerRedrawCallback
// Imports: Phasor from ./phasor.js
//          globalAnimRunning from ./state.js
// ====================================================

import { Phasor } from './phasor.js';
import { globalAnimRunning } from './state.js';

// Callback injection — set by main.js at startup to avoid circular deps
let _redrawCallback = null;
export function registerRedrawCallback(fn) { _redrawCallback = fn; }

// ====================================================
// ADJUSTMENT HELPERS (per-set)
// ====================================================
export function getAdj(setObj, name) {
  if (!setObj.adjustments.has(name)) setObj.adjustments.set(name, { angleDelta: 0, magScale: 1 });
  return setObj.adjustments.get(name);
}

export function hasAdj(setObj, name) {
  const a = setObj.adjustments.get(name);
  return a && (Math.abs(a.angleDelta) > 0.01 || Math.abs(a.magScale - 1) > 0.001);
}

export function anyAdjActive(setObj) {
  for (const [, a] of setObj.adjustments) {
    if (Math.abs(a.angleDelta) > 0.01 || Math.abs(a.magScale - 1) > 0.001) return true;
  }
  return false;
}

// ====================================================
// SLIDER UI UPDATE (called by drag handler)
// ====================================================
export function updateSliderUI(setObj, name, adj) {
  const adjList = setObj.container ? setObj.container.querySelector('.adj-list') : null;
  if (!adjList) return;
  const varDiv = adjList.querySelector(`[data-var-name="${name}"]`);
  if (!varDiv) return;

  const angleSlider = varDiv.querySelector('input[data-param="angle"]');
  if (angleSlider) {
    angleSlider.value = adj.angleDelta;
    const av = angleSlider.nextElementSibling;
    if (av) av.textContent = (adj.angleDelta > 0 ? '+' : '') + adj.angleDelta.toFixed(0) + '°';
  }

  const magSlider = varDiv.querySelector('input[data-param="mag"]');
  if (magSlider) {
    const logVal = adj.magScale <= 0 ? -2 : Math.log10(adj.magScale);
    magSlider.value = Math.max(-2, Math.min(1, logVal));
    const mv = magSlider.nextElementSibling;
    if (mv) mv.textContent = adj.magScale.toFixed(2) + '×';
  }

  varDiv.classList.toggle('modified', hasAdj(setObj, name));
}

// ====================================================
// APPLY ADJUSTMENT to a Phasor value
// ====================================================
export function applyAdj(phasor, setObj, name) {
  const a = setObj.adjustments.get(name);
  if (!a || (Math.abs(a.angleDelta) < 0.01 && Math.abs(a.magScale - 1) < 0.001)) return phasor;
  return Phasor.polar(phasor.mag * a.magScale, phasor.angDeg + a.angleDelta);
}

// ====================================================
// PHASOR HEAD DRAG INTERACTION
// Users click the small circle at a base-variable's
// tip and drag to interactively set angle + magnitude.
// The corresponding Adjustment sliders update in sync.
// ====================================================
export function addPhasorDragInteraction(setObj) {
  const canvas = setObj.phasorCanvas;
  if (!canvas) { console.warn('addPhasorDragInteraction: phasorCanvas not set'); return; }
  let dragging = null; // { name, rawMag, rawAngDeg, originX, originY }

  function getCanvasPt(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
  }

  function nearestTip(mx, my, threshold) {
    const tm = setObj._tipMap;
    if (!tm) return null;
    let best = null, bd = threshold;
    for (const [n, p] of tm) {
      const d = Math.hypot(mx - p.tipX, my - p.tipY);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  function startDrag(e, threshold) {
    if (globalAnimRunning) return;
    const pt = getCanvasPt(e);
    const name = nearestTip(pt.x, pt.y, threshold);
    if (!name) return;

    const adj = setObj.adjustments.get(name) || { angleDelta: 0, magScale: 1 };
    const ap = setObj._lastVars ? setObj._lastVars.get(name) : null;
    if (!ap) return;

    // Back-compute the "raw" (pre-adjustment) magnitude and angle
    const rawMag = (adj.magScale > 1e-6) ? ap.mag / adj.magScale : 0.001;
    const rawAngDeg = ap.angDeg - adj.angleDelta;
    const tp = setObj._tipMap.get(name);
    dragging = { name, rawMag, rawAngDeg, originX: tp.originX, originY: tp.originY };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function applyDragMove(e) {
    if (!dragging) return;
    const vs = setObj._viewState;
    if (!vs) return;
    const { SCALE, viewCx, viewCy } = vs;
    const pt = getCanvasPt(e);

    // Convert canvas coords to phasor-space, relative to this phasor's tail origin
    const oRe = (dragging.originX - viewCx) / SCALE;
    const oIm = (viewCy - dragging.originY) / SCALE;
    const tRe = (pt.x - viewCx) / SCALE - oRe;
    const tIm = (viewCy - pt.y) / SCALE - oIm;

    const newMag = Math.hypot(tRe, tIm);
    const newAngDeg = Math.atan2(tIm, tRe) * 180 / Math.PI;

    let newMagScale = dragging.rawMag > 1e-9 ? newMag / dragging.rawMag : newMag / 0.001;
    let newAngDelta = newAngDeg - dragging.rawAngDeg;
    // Wrap angle delta to [-180, 180]
    while (newAngDelta > 180) newAngDelta -= 360;
    while (newAngDelta < -180) newAngDelta += 360;
    newMagScale = Math.max(0, newMagScale);

    const a = getAdj(setObj, dragging.name);
    a.angleDelta = newAngDelta;
    a.magScale = newMagScale;
    updateSliderUI(setObj, dragging.name, a);
    if (_redrawCallback) _redrawCallback();
  }

  // Mouse events
  canvas.addEventListener('mousedown', (e) => startDrag(e, 18));

  canvas.addEventListener('mousemove', (e) => {
    if (dragging) return; // handled by window listener while dragging
    if (!globalAnimRunning) {
      const pt = getCanvasPt(e);
      canvas.style.cursor = nearestTip(pt.x, pt.y, 20) ? 'grab' : '';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (dragging) applyDragMove(e);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = null;
    canvas.style.cursor = '';
  });

  // Touch events
  canvas.addEventListener('touchstart', (e) => startDrag(e, 26), { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    applyDragMove(e);
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    dragging = null;
  });
}
