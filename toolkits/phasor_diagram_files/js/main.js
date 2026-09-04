// ====================================================
// MAIN — composition root; wires all modules, boots app
// Source: phasor_diagram.html lines 4838–4917, 5134–5141, 5417–5424
// Exports: none (entry point)
// Imports: everything
// ====================================================

import { drawAllSets } from './draw-set.js';
import { createSet, registerRedrawCallback as setDomReg } from './set-dom.js';
import { registerRedrawCallback as animReg } from './animation.js';
import { registerRedrawCallback as adjReg } from './adjustments.js';
import { registerRedrawCallback as drawUiReg } from './draw-ui.js';
import { registerRedrawCallback as fsCvReg, cvsFsSource, closeCanvasFullscreen } from './fullscreen-canvas.js';
import { registerRedrawCallback as fsEdReg, fullscreenSetObj, closeFullscreenEditor } from './fullscreen-editor.js';
import { registerRedrawCallback as impExpReg } from './import-export.js';
import { registerRedrawCallback as urlReg, initFromURL } from './url-init.js';
import { sets } from './state.js';
import { anyAdjActive } from './adjustments.js';

// ─── Register the single drawAllSets callback everywhere it's needed ──────────
setDomReg(drawAllSets);
animReg(drawAllSets);
adjReg(drawAllSets);
drawUiReg(drawAllSets);
fsCvReg(drawAllSets);
fsEdReg(drawAllSets);
impExpReg(drawAllSets);
urlReg(drawAllSets);

// ─── Top toolbar ──────────────────────────────────────────────────────────────
document.getElementById('btnAddSet').addEventListener('click', () => createSet('lag'));

document.getElementById('btnCollapseAll').addEventListener('click', () => {
  for (const setObj of sets) {
    setObj.collapsed = true;
    setObj.container.classList.add('collapsed');
    setObj.container.querySelector('[data-action="collapse"]').textContent = '▸ Expand';
  }
});

document.getElementById('btnExpandAll').addEventListener('click', () => {
  for (const setObj of sets) {
    setObj.collapsed = false;
    setObj.container.classList.remove('collapsed');
    setObj.container.querySelector('[data-action="collapse"]').textContent = '▾ Collapse';
  }
  drawAllSets();
});

// ─── Apply Slider Values (bake slider adjustments permanently into equations) ─
// Uses data-action="applySliders" instead of id="btnApplySliders" to avoid
// duplicate IDs when multiple sets exist (§7.2 in the refactor plan).
document.addEventListener('click', (e) => {
  if (!e.target.matches('[data-action="applySliders"]')) return;

  // Find which set contains the clicked button
  const container = e.target.closest('.set-container');
  if (!container) return;
  const setId = parseInt(container.dataset.setId);
  const setObj = sets.find(s => s.id === setId);
  if (!setObj) return;

  if (!anyAdjActive(setObj)) return;
  if (!setObj._lastVars) return;

  const eqLines = setObj.eqInput.value.split('\n');
  let setChanged = false;

  for (const [varName, adj] of setObj.adjustments.entries()) {
    if (!adj || (Math.abs(adj.angleDelta) < 0.001 && Math.abs(adj.magScale - 1) < 0.001)) continue;

    // Get the already-adjusted phasor value from the last render pass
    const adjustedVal = setObj._lastVars.get(varName);
    if (!adjustedVal) continue;

    // Find and rewrite the variable's defining line in the equations
    for (let i = 0; i < eqLines.length; i++) {
      const line = eqLines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      // Separate the core expression from any :: directive
      const colonIdx = trimmed.indexOf('::');
      const corePart = colonIdx >= 0 ? trimmed.substring(0, colonIdx).trim() : trimmed;
      const directivePart = colonIdx >= 0 ? ' ' + trimmed.substring(colonIdx) : '';

      const eqIdx = corePart.indexOf('=');
      if (eqIdx < 1) continue;
      const lhs = corePart.substring(0, eqIdx).trim();
      if (lhs !== varName) continue;

      // Write the adjusted value as a polar literal, preserving leading whitespace
      const newMag = parseFloat(adjustedVal.mag.toPrecision(6));
      const newAngle = parseFloat(adjustedVal.angDeg.toPrecision(6));
      const leadWs = line.match(/^(\s*)/)[1];
      eqLines[i] = `${leadWs}${varName} = ${newMag} < ${newAngle}${directivePart}`;
      setChanged = true;
      break;
    }
  }

  if (setChanged) {
    // Clear all adjustments — sliders return to zero / 1× baseline
    setObj.adjustments.clear();
    // Write the updated equations back to the textarea
    setObj.eqInput.value = eqLines.join('\n');
    // Force the adjustment slider panel to rebuild at the new baseline
    const adjList = setObj.container.querySelector('.adj-list');
    if (adjList) adjList.dataset.varKey = '';
    // Sync line numbers
    setObj.eqInput.dispatchEvent(new Event('input'));
  }
  drawAllSets();
});

// ─── Instructions section collapse/expand ─────────────────────────────────────
const instrToggle = document.getElementById('instructionsToggle');
const instrBody = document.getElementById('instructionsBody');
instrToggle.addEventListener('click', () => {
  const hidden = instrBody.style.display === 'none';
  instrBody.style.display = hidden ? '' : 'none';
  instrToggle.textContent = (hidden ? '▾' : '▸') + ' How to Use This Toolkit';
});

// ─── Global ESC key handler ───────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (cvsFsSource) closeCanvasFullscreen();
    else if (fullscreenSetObj) closeFullscreenEditor();
  }
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
initFromURL();
