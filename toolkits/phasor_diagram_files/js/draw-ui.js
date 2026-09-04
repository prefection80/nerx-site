// ====================================================
// DRAW UI — DOM panel update functions
// Source: phasor_diagram.html lines 4202–4367
// Exports: updateScopeTraces, updateAdjustmentSliders, updateVarsTable,
//          registerRedrawCallback
// Imports:
//   getAdj, hasAdj, anyAdjActive from ./adjustments.js
//   varOwnership, sets from ./state.js
// ====================================================

import { getAdj, hasAdj, anyAdjActive } from './adjustments.js';
import { varOwnership, sets } from './state.js';

// Callback injection — set by main.js at startup to avoid circular deps
let _redrawCallback = null;
export function registerRedrawCallback(fn) { _redrawCallback = fn; }

export function updateScopeTraces(setObj, order, colorMap, assignments) {
  // Determine how many scope groups exist
  const groups = new Map(); // groupNum -> [{name, color}]
  for (const name of order) {
    const asgn = assignments.find(a => a.name === name);
    if (asgn && asgn.hidden) continue;
    const g = (asgn && asgn.oscGroup) ? asgn.oscGroup : 1;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ name, color: colorMap.get(name) });
  }
  // If no groups specified, put everything in group 1
  if (groups.size === 0) groups.set(1, []);

  const sortedKeys = [...groups.keys()].sort((a, b) => a - b);
  const key = sortedKeys.map(k => k + ':' + groups.get(k).map(e => e.name).join(',')).join('|');
  if (key === setObj._prevScopesKey) return;
  setObj._prevScopesKey = key;

  // Rebuild scope sections
  setObj.scopeContainer.innerHTML = '';
  setObj.scopes = [];

  for (const gKey of sortedKeys) {
    const items = groups.get(gKey);
    const section = document.createElement('div');
    section.className = 'scope-section';

    const header = document.createElement('div');
    header.className = 'scope-header';
    const label = document.createElement('div');
    label.className = 'section-label';
    label.style.margin = '0';
    label.textContent = `Oscilloscope ${gKey}`;
    header.appendChild(label);
    const tracesEl = document.createElement('div');
    tracesEl.className = 'scope-traces';
    header.appendChild(tracesEl);
    section.appendChild(header);

    const canvas = document.createElement('canvas');
    canvas.className = 'scope-canvas';
    canvas.width = 580;
    canvas.height = 160;
    canvas.style.background = 'var(--bg2)';
    canvas.style.border = '1px solid var(--border)';
    canvas.style.borderRadius = '8px';
    canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)';
    section.appendChild(canvas);

    const scopeExpandBtn = document.createElement('button');
    scopeExpandBtn.className = 'canvas-expand-btn';
    scopeExpandBtn.title = 'Fullscreen';
    scopeExpandBtn.textContent = '⛶';
    scopeExpandBtn.dataset.action = 'expandScope';
    scopeExpandBtn.dataset.scopeKey = gKey;
    section.appendChild(scopeExpandBtn);

    setObj.scopeContainer.appendChild(section);

    const traceSet = new Set();
    for (const item of items) {
      traceSet.add(item.name);
      const lbl = document.createElement('label');
      lbl.className = 'scope-trace';
      lbl.innerHTML = `<input type="checkbox" data-name="${item.name}" data-scope="${gKey}" checked><span class="trace-swatch" style="background:${item.color}"></span>${item.name}`;
      tracesEl.appendChild(lbl);
    }

    setObj.scopes.push({ groupKey: gKey, canvas, tracesEl, traceSet });
  }

  // Add note below all scopes
  const note = document.createElement('div');
  note.style.cssText = 'font-size:0.62rem;color:var(--text-dim);font-style:italic;margin-top:2px;';
  note.textContent = '*** Phasor diagram is RMS — Oscilloscope is instantaneous (√2 × RMS)';
  setObj.scopeContainer.appendChild(note);

  // Wire checkbox events for all scope sections
  setObj.scopeContainer.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox' && e.target.dataset.name) {
      const scopeIdx = parseInt(e.target.dataset.scope);
      const scope = setObj.scopes.find(s => s.groupKey === scopeIdx);
      if (!scope) return;
      const name = e.target.dataset.name;
      if (e.target.checked) scope.traceSet.add(name);
      else scope.traceSet.delete(name);
      if (_redrawCallback) _redrawCallback();
    }
  });
}

export function updateAdjustmentSliders(setObj, order, colorMap, assignments) {
  const adjList = setObj.container.querySelector('.adj-list');
  const baseVars = order.filter(name => {
    const asgn = assignments.find(a => a.name === name);
    return asgn && asgn.deps.length === 0;
  });
  for (const k of setObj.adjustments.keys()) {
    if (!baseVars.includes(k)) setObj.adjustments.delete(k);
  }
  const prevVarKey = adjList.dataset.varKey || '';
  const curVarKey = baseVars.join(',');

  if (prevVarKey !== curVarKey) {
    adjList.dataset.varKey = curVarKey;
    adjList.innerHTML = '';
    for (const name of baseVars) {
      const a = getAdj(setObj, name);
      const c = colorMap.get(name);
      const modified = hasAdj(setObj, name);
      const div = document.createElement('div');
      div.className = 'adj-var' + (modified ? ' modified' : '');
      div.dataset.varName = name;
      div.innerHTML = `
        <div class="adj-var-header">
          <span class="var-swatch" style="background:${c}"></span>
          <span class="adj-var-name" style="color:${c}">${name}</span>
          <span class="adj-var-reset" data-name="${name}">reset</span>
        </div>
        <div class="adj-row">
          <label>∠</label>
          <input type="range" min="-180" max="180" step="1" value="${a.angleDelta}" data-name="${name}" data-param="angle">
          <span class="adj-val">${a.angleDelta > 0 ? '+' : ''}${a.angleDelta.toFixed(0)}°</span>
        </div>
        <div class="adj-row">
          <label>×</label>
          <input type="range" min="-2" max="1" step="0.01" value="${a.magScale === 0 ? -2 : Math.log10(a.magScale).toFixed(2)}" data-name="${name}" data-param="mag">
          <span class="adj-val">${a.magScale.toFixed(2)}×</span>
        </div>`;
      adjList.appendChild(div);
    }
  }
  const adjNote = setObj.container.querySelector('.adj-note');
  if (adjNote) adjNote.textContent = anyAdjActive(setObj) ? '⚡ Values reflect slider adjustments' : '';
}

export function updateVarsTable(setObj, order, vars, colorMap, assignments, localNames) {
  const tbody = setObj.container.querySelector('.vars-body');
  tbody.innerHTML = '';
  for (const name of order) {
    const p = vars.get(name);
    const c = colorMap.get(name);
    const asgn = assignments.find(a => a.name === name);
    const tailNote = (asgn && asgn.tailOn) ? ` <span style="color:var(--text-dim);font-size:0.58rem">:: ${asgn.tailOn}</span>` : '';
    const hiddenNote = (asgn && asgn.hidden) ? ` <span style="color:var(--text-dim);font-size:0.58rem;opacity:0.6">ds</span>` : '';
    const adjMark = hasAdj(setObj, name) ? ' <span style="color:var(--accent);font-size:0.53rem" title="Adjusted">⚡</span>' : '';

    // Cross-set reference indicator
    let xrefNote = '';
    if (!localNames.has(name)) {
      const srcSetId = varOwnership.get(name);
      if (srcSetId !== undefined) {
        const srcSet = sets.find(s => s.id === srcSetId);
        const srcLabel = srcSet ? srcSet.title : `Set ${srcSetId + 1}`;
        xrefNote = ` <span class="xref-badge">← ${srcLabel}</span>`;
      }
    }

    const tr = document.createElement('tr');
    if (asgn && asgn.hidden) tr.style.opacity = '0.4';
    tr.innerHTML = `<td><span class="var-swatch" style="background:${c}"></span><span class="var-name">${name}</span>${adjMark}${tailNote}${hiddenNote}${xrefNote}</td>` +
      `<td>${p.mag.toFixed(4)} ∠ ${p.angDeg.toFixed(1)}°</td>` +
      `<td>${p.re.toFixed(4)} ${p.im>=0?'+':'-'} j${Math.abs(p.im).toFixed(4)}</td>`;
    tbody.appendChild(tr);
  }
}
