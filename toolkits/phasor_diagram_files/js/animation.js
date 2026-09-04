// ====================================================
// ANIMATION — global synchronized animation loop
// Source: phasor_diagram.html lines 3264–3340
// Exports: startGlobalAnim, stopGlobalAnim, startSetAnim, stopSetAnim,
//          registerRedrawCallback
// Imports: sets, globalAnimRunning, globalAnimAngle, globalAnimLastTime,
//          globalAnimFrameId, globalAnimFreqHz, setters from ./state.js
// ====================================================

import {
  sets,
  globalAnimRunning,
  globalAnimAngle,
  globalAnimLastTime,
  globalAnimFrameId,
  globalAnimFreqHz,
  setGlobalAnimRunning,
  setGlobalAnimAngle,
  setGlobalAnimLastTime,
  setGlobalAnimFrameId
} from './state.js';

// Callback injection — set by main.js at startup to avoid circular deps
let _redrawCallback = null;
export function registerRedrawCallback(fn) { _redrawCallback = fn; }

function globalAnimFrame(timestamp) {
  if (!globalAnimRunning) return;
  if (!globalAnimLastTime) setGlobalAnimLastTime(timestamp);
  const dt = (timestamp - globalAnimLastTime) / 1000;
  setGlobalAnimLastTime(timestamp);
  setGlobalAnimAngle(globalAnimAngle + globalAnimFreqHz * 360 * dt);

  // Push the global angle into every set
  for (const setObj of sets) {
    setObj.animRunning = true;
    setObj.animAngle = globalAnimAngle;
  }
  if (_redrawCallback) _redrawCallback();
  setGlobalAnimFrameId(requestAnimationFrame(globalAnimFrame));
}

export function startGlobalAnim() {
  if (globalAnimRunning) return;
  setGlobalAnimRunning(true);
  setGlobalAnimLastTime(0);
  setGlobalAnimAngle(0);
  for (const setObj of sets) {
    setObj.animRunning = true;
    setObj.animAngle = 0;
    setObj.animMaxR = 0;
    setObj.animScaleLocked = false;
    const btn = setObj.container.querySelector('[data-action="animate"]');
    if (btn) { btn.classList.add('running'); btn.textContent = '⏸ Pause'; }
  }
  // Sync fullscreen button
  const fsBtn = document.getElementById('cvsFsAnimBtn');
  if (fsBtn) { fsBtn.classList.add('active'); fsBtn.textContent = '⏸ Stop'; }
  setGlobalAnimFrameId(requestAnimationFrame(globalAnimFrame));
}

export function stopGlobalAnim() {
  setGlobalAnimRunning(false);
  if (globalAnimFrameId) cancelAnimationFrame(globalAnimFrameId);
  setGlobalAnimFrameId(null);
  for (const setObj of sets) {
    setObj.animRunning = false;
    setObj.animAngle = 0;
    setObj.animMaxR = 0;
    setObj.animScaleLocked = false;
    const btn = setObj.container.querySelector('[data-action="animate"]');
    if (btn) { btn.classList.remove('running'); btn.textContent = '▶ Animate'; }
  }
  // Sync fullscreen button
  const fsBtn = document.getElementById('cvsFsAnimBtn');
  if (fsBtn) { fsBtn.classList.remove('active'); fsBtn.textContent = '▶ Animate'; }
  if (_redrawCallback) _redrawCallback();
}

export function startSetAnim(setObj) {
  // Any set's animate button controls global animation
  if (globalAnimRunning) {
    stopGlobalAnim();
  } else {
    startGlobalAnim();
  }
}

export function stopSetAnim(setObj) {
  stopGlobalAnim();
}
