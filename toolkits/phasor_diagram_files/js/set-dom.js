// ====================================================
// SET DOM — set lifecycle + DOM builder
// Source: phasor_diagram.html lines 2729–3090, 4919–4958
// Exports: createSet, removeSet, buildSetDOM, isInAnyScope, loadMultiPreset,
//          registerRedrawCallback
// Imports:
//   sets, setIdCounter, setSetIdCounter, globalVars, varOwnership,
//   globalAnimRunning, globalAnimAngle, globalAnimFreqHz,
//   _batchLoading, setBatchLoading from ./state.js
//   PRESETS, MULTI_PRESETS from ./presets.js
//   startGlobalAnim, stopGlobalAnim, startSetAnim, stopSetAnim from ./animation.js
//   getAdj, addPhasorDragInteraction from ./adjustments.js
//   openFullscreenEditor from ./fullscreen-editor.js
//   openCanvasFullscreen from ./fullscreen-canvas.js
//   setGlobalAnimFreqHz from ./state.js
// ====================================================

import {
  sets, setIdCounter, setSetIdCounter,
  globalVars, varOwnership,
  globalAnimRunning, globalAnimAngle, globalAnimFreqHz,
  _batchLoading, setBatchLoading, setGlobalAnimFreqHz
} from './state.js';
import { PRESETS, MULTI_PRESETS } from './presets.js';
import { startGlobalAnim, stopGlobalAnim, startSetAnim, stopSetAnim } from './animation.js';
import { getAdj, addPhasorDragInteraction } from './adjustments.js';
import { openFullscreenEditor } from './fullscreen-editor.js';
import { openCanvasFullscreen } from './fullscreen-canvas.js';

// Callback injection — set by main.js at startup to avoid circular deps
let _redrawCallback = null;
export function registerRedrawCallback(fn) { _redrawCallback = fn; }

// Helper: check if name is visible in any scope traceSet on a setObj
// (also exported from draw-helpers.js; defined here for set-dom.js internal use
//  without needing to import draw-helpers.js to avoid dep chain confusion)
export function isInAnyScope(setObj, name) {
  for (const scope of setObj.scopes) {
    if (scope.traceSet.has(name)) return true;
  }
  return false;
}

export function createSet(presetName) {
  const id = setIdCounter;
  setSetIdCounter(setIdCounter + 1);
  const setObj = {
    id,
    title: `Set ${id + 1}`,
    adjustments: new Map(),
    animRunning: false,
    animAngle: 0,
    animLastTime: 0,
    animFrameId: null,
    animFreqHz: 0.2,
    showValues: true,
    scopes: [], // array of {title, canvas, tracesEl, traceSet, prevKey}
    adjOpen: true,
    collapsed: false,
    // DOM refs set after building
    container: null,
    phasorCanvas: null,
    eqInput: null,
    offscreen: null,
  };
  sets.push(setObj);
  buildSetDOM(setObj, presetName);

  // If global animation is running, sync the new set
  if (globalAnimRunning) {
    setObj.animRunning = true;
    setObj.animAngle = globalAnimAngle;
    const btn = setObj.container.querySelector('[data-action="animate"]');
    if (btn) { btn.classList.add('running'); btn.textContent = '⏸ Pause'; }
  }

  if (!_batchLoading && _redrawCallback) _redrawCallback();
  return setObj;
}

export function removeSet(id) {
  const idx = sets.findIndex(s => s.id === id);
  if (idx < 0) return;
  const setObj = sets[idx];
  if (setObj.animFrameId) cancelAnimationFrame(setObj.animFrameId);
  setObj.container.remove();
  sets.splice(idx, 1);
  if (!_batchLoading && _redrawCallback) _redrawCallback();
}

export function buildSetDOM(setObj, presetName) {
  const container = document.createElement('div');
  container.className = 'set-container';
  container.dataset.setId = setObj.id;

  const eqText = presetName === undefined ? PRESETS.lag : (presetName ? (PRESETS[presetName] || '') : '');

  container.innerHTML = `
    <div class="set-header">
      <input class="set-title-input" value="${setObj.title}" data-action="title">
      <span class="set-badge">SET ${setObj.id + 1}</span>
      <div class="set-actions">
        <button class="set-btn" data-action="collapse">▾ Collapse</button>
        <button class="set-btn" data-action="duplicate">⧉ Duplicate</button>
        <button class="set-btn danger" data-action="delete">✕ Delete</button>
      </div>
    </div>
    <div class="set-body">
      <div class="left-col">
        <div class="view-toggle">
          <button class="active" data-action="viewSingle">Single Diagram</button>
          <button data-action="viewTriple">Triple Diagram</button>
        </div>
        <div class="canvas-wrap" style="width:580px">
          <canvas class="phasor-canvas" width="580" height="580"></canvas>
          <div class="triple-canvas-wrap">
            <canvas class="triple-canvas-1" width="190" height="190"></canvas>
            <canvas class="triple-canvas-2" width="190" height="190"></canvas>
            <canvas class="triple-canvas-3" width="190" height="190"></canvas>
          </div>
          <button class="canvas-expand-btn" data-action="expandPhasor" title="Fullscreen">⛶</button>
        </div>
        <div class="anim-bar">
          <button class="anim-btn" data-action="animate">▶ Animate</button>
          <div class="anim-speed">
            <label>Speed</label>
            <input type="range" min="0.1" max="0.5" step="0.05" value="0.2" data-action="speed">
            <span class="anim-speed-val">0.2 Hz</span>
          </div>
        </div>
        <div class="scope-container"></div>
      </div>
      <div class="panel">
        <h3>Equations</h3>
        <div class="eq-editor-wrap">
          <div class="eq-line-numbers"></div>
          <textarea class="eq-editor" spellcheck="false">${eqText}</textarea>
          <button class="eq-expand-btn" data-action="expandEditor" title="Toggle fullscreen editor">⛶</button>
        </div>
        <div class="eq-hint" style="font-size:0.75em; color:#888; margin-top:4px;"><b>Conditionals:</b> IF &lt;cond&gt; … ELSE … ENDIF &nbsp;|&nbsp; Operators: &gt; &lt; &gt;= &lt;= == != &amp;&amp; || ! &nbsp;|&nbsp; Functions: mag() ang() re() im()</div>
        <div class="error-msg"></div>
        <div class="section-label">Presets</div>
        <div class="preset-row">
          <button class="preset-btn" data-preset="clear" style="color:var(--err);border-color:rgba(220,38,38,0.3)">✕ Clear</button>
          <button class="preset-btn" data-preset="lag">Lagging Load</button>
          <button class="preset-btn" data-preset="lead">Leading Load</button>
          <button class="preset-btn" data-preset="threephase">3φ System</button>
          <button class="preset-btn" data-preset="vdrop">Voltage Drop</button>
          <button class="preset-btn" data-preset="cap">PF Correction</button>
          <button class="preset-btn" data-preset="symcomp">Seq Components</button>
          <button class="preset-btn" data-preset="fault">SLG Fault</button>
          <button class="preset-btn" data-preset="kvl">KVL Loop</button>
          <button class="preset-btn" data-preset="shuntcap">Shunt Cap</button>
          <button class="preset-btn" data-preset="shuntreactor">Shunt Reactor</button>
          <button class="preset-btn" data-preset="llfault">LL Fault</button>
          <button class="preset-btn" data-preset="seqtrip">Seq↔Phase</button>
          <button class="preset-btn" data-preset="powertri">Power Triangle</button>
          <button class="preset-btn" data-preset="phasedist">Phase Distance</button>
          <button class="preset-btn" data-preset="grounddist">Ground Distance</button>
        </div>
        <div class="section-label">Multi-Set Presets</div>
        <div class="preset-row">
          <button class="preset-btn" data-multipreset="motor_field" style="background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none">⚡ Motor Field</button>
        </div>
        <div class="toggle-row">
          <button class="toggle-btn active" data-action="showValues">Show values</button>
        </div>
        <div class="adj-section">
          <div class="adj-header" data-action="adjToggle">
            <div class="section-label" style="margin:0;cursor:pointer">▾ Adjustments</div>
            <button class="top-btn secondary" data-action="applySliders">Apply Slider Values</button>
            <button class="adj-reset-btn" data-action="adjResetAll" title="Reset all">Reset All</button>
          </div>
          <div class="adj-list"></div>
          <div class="drag-hint" style="font-size:0.62rem;color:var(--text-dim);margin-top:8px;display:flex;align-items:center;gap:6px;background:rgba(37,99,235,0.04);padding:6px 8px;border-radius:6px;border:1px dashed rgba(37,99,235,0.2);">
            <span style="font-size:0.8rem;line-height:1">🖱️</span>
            <span style="line-height:1.4"><b>Tip:</b> Phasors with circle heads can be clicked and dragged directly on the diagram.</span>
          </div>
        </div>
        <div class="section-label" style="margin-top:8px">Computed Values</div>
        <div style="font-size:0.56rem;color:var(--text-dim);margin-bottom:3px" class="adj-note"></div>
        <table class="vars-table">
          <thead><tr><th>Name</th><th>Polar</th><th>Rectangular</th></tr></thead>
          <tbody class="vars-body"></tbody>
        </table>
        <div class="help-section">
          <h4>Quick Reference</h4>
          <p>
            <b>Polar:</b> <code>X = 1.0 ∠ 30</code> or <code>X = d &lt; 30</code> &nbsp;
            <b>Rect:</b> <code>X = 3 + j4</code> &nbsp;
            <b>Ops:</b> <code>+ - * / ^</code> &nbsp;
            <b>Tail:</b> <code>:: VarName</code> &nbsp;
            <b>Hide:</b> <code>:: ds</code> &nbsp;
            <b>Fixed:</b> <code>:: fixed</code> &nbsp;
            <b>Dot:</b> <code>:: dot</code> &nbsp;
            <b>Triple:</b> <code>:: d1</code> <code>:: d2</code> <code>:: d3</code> &nbsp;
            <b>Scope:</b> <code>:: osc1</code> <code>:: osc2</code> …<br>
            <b>Phasor:</b> <code>|A|</code> <code>abs()</code> <code>ang()</code> <code>conj()</code> <code>re()</code> <code>im()</code> <code>sqrt()</code> <code>pow(A,n)</code> <code>proj(A,deg)</code><br>
            <b>Seq↔Phase:</b> <code>V0,V1,V2 = seq(Vag,Vbg,Vcg)</code> &nbsp; <code>Vag,Vbg,Vcg = phase(V0,V1,V2)</code><br>
            <b>V convert:</b> <code>lntoll()</code> <code>lltoln()</code> <code>lgtoll()</code> <code>lltolg(…,V0)</code> <code>lgtoln()</code> <code>lntolg(…,V0)</code><br>
            <b>Single:</b> <code>seq0()</code> <code>seq1()</code> <code>seq2()</code> <code>pha()</code> <code>phb()</code> <code>phc()</code><br>
            <b>Power:</b> <code>pf(V,I)</code> <code>power(V,I)</code> <code>preal(V,I)</code> <code>qreactive(V,I)</code> <code>s3p(Vln,I)</code><br>
            <b>Per-unit:</b> <code>pu(act,base)</code> <code>frompu(pu,base)</code> <code>zbase(V,S)</code><br>
            <b>Circle:</b> <code>circle(Zfar,Znear)</code> mho &nbsp; <code>circle(Zcenter,radius)</code> offset<br>
            <b>Trig (degrees):</b> <code>sin()</code> <code>cos()</code> <code>tan()</code> <code>asin()</code> <code>acos()</code> <code>atan()</code> <code>atan2(y,x)</code><br>
            <b>Other:</b> <code>ln()</code> <code>log()</code> <code>exp()</code> &nbsp;
            <b>Constants:</b> <code>pi</code> <code>e</code> <code>sqrt3</code> <code>j</code><br>
            <b>Cross-set:</b> Variables from other sets available by name.<br>
            <b>Fullscreen:</b> Click ⛶ on any plot. Scroll/+/− zoom, drag/arrows pan, dbl-click reset. &nbsp;
            <b>Share:</b> 🔗 Copy Shareable Link encodes equations in URL.
          </p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('setsContainer').appendChild(container);

  // Store DOM refs
  setObj.container = container;
  setObj.phasorCanvas = container.querySelector('.phasor-canvas');
  setObj.scopeContainer = container.querySelector('.scope-container');
  setObj.tripleCanvases = [
    container.querySelector('.triple-canvas-1'),
    container.querySelector('.triple-canvas-2'),
    container.querySelector('.triple-canvas-3')
  ];
  setObj.tripleWrap = container.querySelector('.triple-canvas-wrap');
  setObj.viewMode = 'single'; // 'single' or 'triple'
  setObj.eqInput = container.querySelector('.eq-editor');
  setObj.lineNumbers = container.querySelector('.eq-line-numbers');
  setObj.editorWrap = container.querySelector('.eq-editor-wrap');

  const W = setObj.phasorCanvas.width, H = setObj.phasorCanvas.height;
  setObj.offscreen = document.createElement('canvas');
  setObj.offscreen.width = W;
  setObj.offscreen.height = H;

  // Line number sync function
  function syncLineNumbers() {
    const lines = setObj.eqInput.value.split('\n');
    const count = lines.length;
    const ln = setObj.lineNumbers;
    // Rebuild if count changed
    if (ln.children.length !== count) {
      ln.innerHTML = '';
      for (let i = 1; i <= count; i++) {
        const div = document.createElement('div');
        div.textContent = i;
        ln.appendChild(div);
      }
    }
    // Sync scroll position
    ln.style.paddingTop = (8 - setObj.eqInput.scrollTop) + 'px';
  }

  // Initial line numbers
  syncLineNumbers();

  // Focus styling for wrap
  setObj.eqInput.addEventListener('focus', () => setObj.editorWrap.classList.add('focused'));
  setObj.eqInput.addEventListener('blur', () => setObj.editorWrap.classList.remove('focused'));

  // Wire events
  setObj.eqInput.addEventListener('input', () => { syncLineNumbers(); if (_redrawCallback) _redrawCallback(); });
  setObj.eqInput.addEventListener('scroll', () => syncLineNumbers());
  setObj.eqInput.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = this.selectionStart;
      this.value = this.value.substring(0, start) + '  ' + this.value.substring(this.selectionEnd);
      this.selectionStart = this.selectionEnd = start + 2;
      syncLineNumbers();
      if (_redrawCallback) _redrawCallback();
    }
  });

  // Delegated event handling
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      // Check for multi-set preset buttons
      const multiPresetBtn = e.target.closest('[data-multipreset]');
      if (multiPresetBtn) {
        loadMultiPreset(multiPresetBtn.dataset.multipreset);
        return;
      }
      // Check for preset buttons
      const presetBtn = e.target.closest('[data-preset]');
      if (presetBtn) {
        const p = presetBtn.dataset.preset;
        if (p === 'clear') {
          setObj.eqInput.value = '';
        } else {
          setObj.eqInput.value = PRESETS[p] || '';
        }
        setObj.adjustments.clear();
        if (setObj.animRunning) stopSetAnim(setObj);
        setObj._prevScopesKey = '';
        syncLineNumbers();
        if (_redrawCallback) _redrawCallback();
      }
      // Check for adj var reset
      if (e.target.classList.contains('adj-var-reset')) {
        setObj.adjustments.delete(e.target.dataset.name);
        if (_redrawCallback) _redrawCallback();
      }
      return;
    }

    const action = btn.dataset.action;
    if (action === 'delete') {
      if (sets.length <= 1) return; // Don't delete last set
      removeSet(setObj.id);
    } else if (action === 'duplicate') {
      createSet(null);
      const newSet = sets[sets.length - 1];
      newSet.eqInput.value = setObj.eqInput.value;
      if (_redrawCallback) _redrawCallback();
    } else if (action === 'collapse') {
      setObj.collapsed = !setObj.collapsed;
      container.classList.toggle('collapsed', setObj.collapsed);
      btn.textContent = setObj.collapsed ? '▸ Expand' : '▾ Collapse';
    } else if (action === 'animate') {
      if (setObj.animRunning) stopSetAnim(setObj);
      else startSetAnim(setObj);
    } else if (action === 'showValues') {
      setObj.showValues = !setObj.showValues;
      btn.classList.toggle('active', setObj.showValues);
      if (_redrawCallback) _redrawCallback();
    } else if (action === 'adjToggle') {
      if (e.target.dataset.action === 'adjResetAll') return;
      setObj.adjOpen = !setObj.adjOpen;
      container.querySelector('.adj-list').style.display = setObj.adjOpen ? 'block' : 'none';
      const hint = container.querySelector('.drag-hint');
      if (hint) hint.style.display = setObj.adjOpen ? 'flex' : 'none';
      const lbl = btn.querySelector('.section-label');
      if (lbl) lbl.textContent = (setObj.adjOpen ? '▾' : '▸') + ' Adjustments';
    } else if (action === 'adjResetAll') {
      setObj.adjustments.clear();
      if (_redrawCallback) _redrawCallback();
    } else if (action === 'expandEditor') {
      openFullscreenEditor(setObj);
    } else if (action === 'expandPhasor') {
      openCanvasFullscreen(setObj, 'phasor', null);
    } else if (action === 'expandScope') {
      const scopeKey = btn.dataset.scopeKey;
      openCanvasFullscreen(setObj, 'scope', scopeKey);
    } else if (action === 'viewSingle') {
      setObj.viewMode = 'single';
      setObj.phasorCanvas.style.display = '';
      setObj.tripleWrap.classList.remove('active');
      container.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (_redrawCallback) _redrawCallback();
    } else if (action === 'viewTriple') {
      setObj.viewMode = 'triple';
      setObj.phasorCanvas.style.display = 'none';
      setObj.tripleWrap.classList.add('active');
      container.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (_redrawCallback) _redrawCallback();
    }
  });

  container.addEventListener('input', (e) => {
    if (e.target.dataset.action === 'title') {
      setObj.title = e.target.value || `Set ${setObj.id + 1}`;
    }
    if (e.target.dataset.action === 'speed') {
      setGlobalAnimFreqHz(parseFloat(e.target.value));
      // Sync all speed displays
      for (const s of sets) {
        const speedVal = s.container.querySelector('.anim-speed-val');
        const speedSlider = s.container.querySelector('[data-action="speed"]');
        if (speedVal) speedVal.textContent = globalAnimFreqHz.toFixed(1) + ' Hz';
        if (speedSlider && speedSlider !== e.target) speedSlider.value = globalAnimFreqHz;
      }
    }
    // Slider input for adjustments
    if (e.target.tagName === 'INPUT' && e.target.type === 'range' && e.target.dataset.name) {
      const name = e.target.dataset.name;
      const param = e.target.dataset.param;
      const a = getAdj(setObj, name);
      if (param === 'angle') {
        a.angleDelta = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (a.angleDelta > 0 ? '+' : '') + a.angleDelta.toFixed(0) + '°';
      } else if (param === 'mag') {
        const rawVal = parseFloat(e.target.value);
        a.magScale = rawVal <= -2 ? 0 : Math.pow(10, rawVal);
        e.target.nextElementSibling.textContent = a.magScale.toFixed(2) + '×';
      }
      if (_redrawCallback) _redrawCallback();
    }
  });

  // Enable interactive drag-to-adjust on phasor tip heads
  // Wrapped in try-catch so a drag-setup failure never breaks rendering
  try { addPhasorDragInteraction(setObj); } catch(e) { console.warn('addPhasorDragInteraction failed:', e); }
}

// Multi-set preset loader
export function loadMultiPreset(presetKey) {
  const preset = MULTI_PRESETS[presetKey];
  if (!preset) return;

  // Stop any running animation
  if (globalAnimRunning) stopGlobalAnim();

  // Remove all existing sets
  const containerEl = document.getElementById('setsContainer');
  containerEl.innerHTML = '';
  sets.length = 0;
  setSetIdCounter(0);
  globalVars.clear();
  varOwnership.clear();

  // Create each set from the preset
  for (const setDef of preset.sets) {
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
    // Set the equations and title
    setObj.eqInput.value = setDef.equations;
    // Sync line numbers
    const syncEvt = new Event('input');
    setObj.eqInput.dispatchEvent(syncEvt);
  }
  if (_redrawCallback) _redrawCallback();
}
