// ====================================================
// FULLSCREEN CANVAS — canvas fullscreen zoom/pan modal
// Source: phasor_diagram.html lines 2386–2728
// Exports: openCanvasFullscreen, renderCanvasFullscreen, closeCanvasFullscreen,
//          cvsFsSource, cvsFsOverlay, registerRedrawCallback
// Imports:
//   sets, globalAnimRunning, globalAnimFreqHz, setters from ./state.js
//   startGlobalAnim, stopGlobalAnim from ./animation.js
//   drawPhasorCanvas from ./draw-phasor.js
//   drawSingleScope from ./draw-scope.js
//   isInAnyScope from ./draw-helpers.js
// ====================================================

import { sets, globalAnimRunning, globalAnimFreqHz, setGlobalAnimFreqHz } from './state.js';
import { startGlobalAnim, stopGlobalAnim } from './animation.js';
import { drawPhasorCanvas } from './draw-phasor.js';
import { drawSingleScope } from './draw-scope.js';
import { isInAnyScope } from './draw-helpers.js';

// Callback injection — set by main.js at startup to avoid circular deps
let _redrawCallback = null;
export function registerRedrawCallback(fn) { _redrawCallback = fn; }

// Module-level DOM refs
export const cvsFsOverlay = document.getElementById('canvasFullscreenOverlay');
const cvsFsCanvas = document.getElementById('canvasFullscreenCanvas');
const cvsFsTitle = document.getElementById('canvasFullscreenTitle');
const cvsFsClose = document.getElementById('canvasFullscreenClose');

// Module-level state
export let cvsFsSource = null;
let cvsFsDragging = false;
let cvsFsDragStart = { x: 0, y: 0 };
let cvsFsDragPanStart = { x: 0, y: 0 };

export function openCanvasFullscreen(setObj, type, scopeKey) {
  cvsFsSource = { setObj, type, scopeKey };
  const title = setObj.container.querySelector('.set-title-input').value || setObj.title;
  if (type === 'phasor') {
    cvsFsTitle.textContent = `${title} — Phasor Diagram`;
  } else {
    cvsFsTitle.textContent = `${title} — Oscilloscope ${scopeKey}`;
  }

  // Populate trace checkboxes
  const tracesEl = document.getElementById('cvsFsTraces');
  tracesEl.innerHTML = '';
  const colorMap = setObj._lastColorMap;
  const order = setObj._lastOrder;
  const assignments = setObj._lastAssignments;
  if (colorMap && order && assignments) {
    if (type === 'phasor') {
      // Show all visible (non-hidden) phasors
      for (const name of order) {
        const asgn = assignments.find(a => a.name === name);
        if (asgn && asgn.hidden) continue;
        const checked = isInAnyScope(setObj, name);
        const c = colorMap.get(name) || '#888';
        const lbl = document.createElement('label');
        lbl.className = 'cvs-fs-trace';
        lbl.innerHTML = `<input type="checkbox" data-fsname="${name}" ${checked ? 'checked' : ''}><span class="cvs-fs-trace-swatch" style="background:${c}"></span>${name}`;
        tracesEl.appendChild(lbl);
      }
    } else {
      // Show traces for this specific scope
      const scope = setObj.scopes.find(s => s.groupKey == scopeKey);
      if (scope) {
        for (const name of order) {
          const asgn = assignments.find(a => a.name === name);
          if (asgn && asgn.hidden) continue;
          const g = (asgn && asgn.oscGroup) ? asgn.oscGroup : 1;
          if (g != scopeKey) continue;
          const checked = scope.traceSet.has(name);
          const c = colorMap.get(name) || '#888';
          const lbl = document.createElement('label');
          lbl.className = 'cvs-fs-trace';
          lbl.innerHTML = `<input type="checkbox" data-fsname="${name}" data-fsscope="${scopeKey}" ${checked ? 'checked' : ''}><span class="cvs-fs-trace-swatch" style="background:${c}"></span>${name}`;
          tracesEl.appendChild(lbl);
        }
      }
    }
  }

  // Sync animation button state
  const animBtn = document.getElementById('cvsFsAnimBtn');
  animBtn.classList.toggle('active', !!globalAnimRunning);
  animBtn.textContent = globalAnimRunning ? '⏸ Stop' : '▶ Animate';

  // Sync show values button
  const svBtn = document.getElementById('cvsFsShowValues');
  svBtn.classList.toggle('active', !!setObj.showValues);

  // Sync speed slider
  const speedSlider = document.getElementById('cvsFsSpeedSlider');
  speedSlider.value = globalAnimFreqHz;
  document.getElementById('cvsFsSpeedVal').textContent = globalAnimFreqHz.toFixed(1) + ' Hz';

  // Show/hide zoom hint and show-values (phasor only)
  const hint = document.getElementById('canvasFullscreenHint');
  if (hint) hint.style.display = type === 'phasor' ? '' : 'none';
  svBtn.style.display = type === 'phasor' ? '' : 'none';

  cvsFsOverlay.classList.add('active');
  renderCanvasFullscreen();
}

export function renderCanvasFullscreen() {
  if (!cvsFsSource) return;
  const { setObj, type, scopeKey } = cvsFsSource;
  const body = cvsFsOverlay.querySelector('.canvas-fullscreen-body');
  const availW = body.clientWidth - 24;
  const availH = body.clientHeight - 24;

  if (type === 'phasor') {
    const isTriple = setObj.viewMode === 'triple';
    if (isTriple) {
      // Use full width, each panel is square
      const cW = Math.min(Math.floor(availW / 3), availH);
      cvsFsCanvas.width = cW * 3;
      cvsFsCanvas.height = cW;
      cvsFsCanvas.style.width = (cW * 3) + 'px';
      cvsFsCanvas.style.height = cW + 'px';
      const vars = setObj._lastVars, order = setObj._lastOrder;
      const assignments = setObj._lastAssignments, colorMap = setObj._lastColorMap;
      if (vars && order && assignments && colorMap) {
        for (let d = 1; d <= 3; d++) {
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = cW; tmpCanvas.height = cW;
          const filteredAssignments = assignments.filter(a => a.diagram === d || a.diagram === 0);
          const filteredOrder = order.filter(name => {
            const a = filteredAssignments.find(fa => fa.name === name);
            return !!a;
          });
          drawPhasorCanvas(setObj, vars, filteredOrder, filteredAssignments, colorMap, tmpCanvas);
          cvsFsCanvas.getContext('2d').drawImage(tmpCanvas, (d - 1) * cW, 0);
        }
      }
    } else {
      // Use full available area — auto-scale handles non-square
      cvsFsCanvas.width = availW;
      cvsFsCanvas.height = availH;
      cvsFsCanvas.style.width = availW + 'px';
      cvsFsCanvas.style.height = availH + 'px';
      const vars = setObj._lastVars, order = setObj._lastOrder;
      const assignments = setObj._lastAssignments, colorMap = setObj._lastColorMap;
      if (vars && order && assignments && colorMap) {
        drawPhasorCanvas(setObj, vars, order, assignments, colorMap, cvsFsCanvas);
      }
    }
  } else {
    // Scope — use full available width and height
    const scope = setObj.scopes.find(s => s.groupKey == scopeKey);
    if (scope) {
      const w = availW;
      const h = availH;
      cvsFsCanvas.width = w;
      cvsFsCanvas.height = h;
      cvsFsCanvas.style.width = w + 'px';
      cvsFsCanvas.style.height = h + 'px';
      const vars = setObj._lastVars, colorMap = setObj._lastColorMap;
      if (vars && colorMap) {
        drawSingleScope(scope, vars, colorMap, cvsFsCanvas);
      }
    }
  }
}

export function closeCanvasFullscreen() {
  if (cvsFsSource && cvsFsSource.setObj) {
    cvsFsSource.setObj._fsManualView = null;
  }
  cvsFsOverlay.classList.remove('active');
  cvsFsSource = null;
}

// ─── Event wiring ────────────────────────────────────────────────────────────

cvsFsClose.addEventListener('click', closeCanvasFullscreen);
cvsFsOverlay.addEventListener('click', (e) => {
  if (e.target === cvsFsOverlay) closeCanvasFullscreen();
});

// Fullscreen phasor zoom/pan — wheel
cvsFsCanvas.addEventListener('wheel', (e) => {
  if (!cvsFsSource || cvsFsSource.type !== 'phasor') return;
  e.preventDefault();
  const setObj = cvsFsSource.setObj;
  if (!setObj._fsManualView) {
    setObj._fsManualView = { zoom: 1, panX: 0, panY: 0 };
  }
  const mv = setObj._fsManualView;
  const rect = cvsFsCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const newZoom = mv.zoom * zoomFactor;

  // Zoom toward mouse position
  mv.panX = mouseX - (mouseX - mv.panX) * zoomFactor;
  mv.panY = mouseY - (mouseY - mv.panY) * zoomFactor;
  mv.zoom = newZoom;

  renderCanvasFullscreen();
}, { passive: false });

// Mouse drag pan
cvsFsCanvas.addEventListener('mousedown', (e) => {
  if (!cvsFsSource || cvsFsSource.type !== 'phasor') return;
  cvsFsDragging = true;
  const setObj = cvsFsSource.setObj;
  if (!setObj._fsManualView) {
    setObj._fsManualView = { zoom: 1, panX: 0, panY: 0 };
  }
  cvsFsDragStart = { x: e.clientX, y: e.clientY };
  cvsFsDragPanStart = { x: setObj._fsManualView.panX, y: setObj._fsManualView.panY };
  cvsFsCanvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (!cvsFsDragging || !cvsFsSource) return;
  const setObj = cvsFsSource.setObj;
  const mv = setObj._fsManualView;
  if (!mv) return;
  mv.panX = cvsFsDragPanStart.x + (e.clientX - cvsFsDragStart.x);
  mv.panY = cvsFsDragPanStart.y + (e.clientY - cvsFsDragStart.y);
  renderCanvasFullscreen();
});

window.addEventListener('mouseup', () => {
  if (cvsFsDragging) {
    cvsFsDragging = false;
    cvsFsCanvas.style.cursor = '';
  }
});

// Double-click to reset zoom/pan
cvsFsCanvas.addEventListener('dblclick', (e) => {
  if (!cvsFsSource || cvsFsSource.type !== 'phasor') return;
  cvsFsSource.setObj._fsManualView = null;
  renderCanvasFullscreen();
});

// Keyboard zoom/pan in fullscreen
document.addEventListener('keydown', (e) => {
  if (!cvsFsSource || cvsFsSource.type !== 'phasor') return;
  if (!cvsFsOverlay.classList.contains('active')) return;
  const setObj = cvsFsSource.setObj;
  if (!setObj._fsManualView) {
    setObj._fsManualView = { zoom: 1, panX: 0, panY: 0 };
  }
  const mv = setObj._fsManualView;
  const panStep = 40;
  let handled = false;

  if (e.key === 'ArrowLeft') { mv.panX += panStep; handled = true; }
  else if (e.key === 'ArrowRight') { mv.panX -= panStep; handled = true; }
  else if (e.key === 'ArrowUp') { mv.panY += panStep; handled = true; }
  else if (e.key === 'ArrowDown') { mv.panY -= panStep; handled = true; }
  else if (e.key === '+' || e.key === '=') {
    const cx = cvsFsCanvas.width / 2, cy = cvsFsCanvas.height / 2;
    const zf = 1.15;
    mv.panX = cx - (cx - mv.panX) * zf;
    mv.panY = cy - (cy - mv.panY) * zf;
    mv.zoom *= zf;
    handled = true;
  }
  else if (e.key === '-' || e.key === '_') {
    const cx = cvsFsCanvas.width / 2, cy = cvsFsCanvas.height / 2;
    const zf = 1 / 1.15;
    mv.panX = cx - (cx - mv.panX) * zf;
    mv.panY = cy - (cy - mv.panY) * zf;
    mv.zoom *= zf;
    handled = true;
  }

  if (handled) {
    e.preventDefault();
    renderCanvasFullscreen();
  }
});

// Fullscreen animation button
document.getElementById('cvsFsAnimBtn').addEventListener('click', () => {
  if (!cvsFsSource) return;
  // Toggle global animation using the same mechanism as the set's animate button
  if (globalAnimRunning) {
    stopGlobalAnim();
  } else {
    startGlobalAnim();
  }
  const animBtn = document.getElementById('cvsFsAnimBtn');
  animBtn.classList.toggle('active', !!globalAnimRunning);
  animBtn.textContent = globalAnimRunning ? '⏸ Stop' : '▶ Animate';
  // Also sync the set's own animate button
  if (cvsFsSource) {
    const setBtn = cvsFsSource.setObj.container.querySelector('.anim-btn');
    if (setBtn) {
      setBtn.classList.toggle('active', !!globalAnimRunning);
      setBtn.textContent = globalAnimRunning ? '⏸ Stop' : '▶ Animate';
    }
  }
  if (globalAnimRunning) renderCanvasFullscreen();
});

// Fullscreen show values toggle
document.getElementById('cvsFsShowValues').addEventListener('click', () => {
  if (!cvsFsSource) return;
  const setObj = cvsFsSource.setObj;
  setObj.showValues = !setObj.showValues;
  const svBtn = document.getElementById('cvsFsShowValues');
  svBtn.classList.toggle('active', setObj.showValues);
  // Sync the set's own show values button
  const setBtn = setObj.container.querySelector('[data-action="showValues"]');
  if (setBtn) setBtn.classList.toggle('active', setObj.showValues);
  if (_redrawCallback) _redrawCallback();
});

// Fullscreen speed slider
document.getElementById('cvsFsSpeedSlider').addEventListener('input', (e) => {
  setGlobalAnimFreqHz(parseFloat(e.target.value));
  document.getElementById('cvsFsSpeedVal').textContent = globalAnimFreqHz.toFixed(1) + ' Hz';
  // Sync the set's speed slider
  if (cvsFsSource) {
    const setSpeedInput = cvsFsSource.setObj.container.querySelector('[data-action="speed"]');
    if (setSpeedInput) {
      setSpeedInput.value = globalAnimFreqHz;
      const setSpeedVal = cvsFsSource.setObj.container.querySelector('.anim-speed-val');
      if (setSpeedVal) setSpeedVal.textContent = globalAnimFreqHz.toFixed(1) + ' Hz';
    }
  }
});

// Fullscreen trace checkboxes
document.getElementById('cvsFsTraces').addEventListener('change', (e) => {
  if (!e.target.dataset.fsname || !cvsFsSource) return;
  const name = e.target.dataset.fsname;
  const checked = e.target.checked;
  const { setObj, type, scopeKey } = cvsFsSource;

  if (type === 'scope') {
    // Toggle in the specific scope's traceSet
    const scope = setObj.scopes.find(s => s.groupKey == scopeKey);
    if (scope) {
      if (checked) scope.traceSet.add(name);
      else scope.traceSet.delete(name);
      // Sync the set's checkbox
      const setCheck = setObj.scopeContainer.querySelector(`input[data-name="${name}"][data-scope="${scopeKey}"]`);
      if (setCheck) setCheck.checked = checked;
    }
  } else {
    // For phasor view, toggle in ALL scopes that contain this variable
    for (const scope of setObj.scopes) {
      if (checked) scope.traceSet.add(name);
      else scope.traceSet.delete(name);
      const setCheck = setObj.scopeContainer.querySelector(`input[data-name="${name}"]`);
      if (setCheck) setCheck.checked = checked;
    }
  }
  if (_redrawCallback) _redrawCallback();
});
