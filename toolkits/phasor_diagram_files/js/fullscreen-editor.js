// ====================================================
// FULLSCREEN EDITOR — equation editor fullscreen modal
// Source: phasor_diagram.html lines 5143–5199
// Exports: openFullscreenEditor, closeFullscreenEditor, registerRedrawCallback
// Imports: none (operates on DOM elements by ID)
// ====================================================

// Callback injection — set by main.js at startup to avoid circular deps
let _redrawCallback = null;
export function registerRedrawCallback(fn) { _redrawCallback = fn; }

// Module-level state
export let fullscreenSetObj = null;
const fsOverlay = document.getElementById('eqFullscreenOverlay');
const fsEditor = document.getElementById('eqFullscreenEditor');
const fsLineNums = document.getElementById('eqFullscreenLineNums');
const fsTitle = document.getElementById('eqFullscreenTitle');
const fsClose = document.getElementById('eqFullscreenClose');

function syncFullscreenLineNumbers() {
  const lines = fsEditor.value.split('\n');
  const count = lines.length;
  // Only rebuild if line count changed
  if (fsLineNums.childElementCount !== count) {
    fsLineNums.innerHTML = '';
    for (let i = 1; i <= count; i++) {
      const d = document.createElement('div');
      d.textContent = i;
      fsLineNums.appendChild(d);
    }
  }
  fsLineNums.scrollTop = fsEditor.scrollTop;
}

export function openFullscreenEditor(setObj) {
  fullscreenSetObj = setObj;
  const title = setObj.container.querySelector('.set-title-input').value || setObj.title;
  fsTitle.textContent = `Editing: ${title}`;
  fsEditor.value = setObj.eqInput.value;
  fsOverlay.classList.add('active');
  syncFullscreenLineNumbers();
  fsEditor.focus();
}

export function closeFullscreenEditor() {
  if (!fullscreenSetObj) return;
  // Copy content back to the set's editor
  fullscreenSetObj.eqInput.value = fsEditor.value;
  fullscreenSetObj.eqInput.dispatchEvent(new Event('input'));
  fsOverlay.classList.remove('active');
  if (_redrawCallback) _redrawCallback();
  fullscreenSetObj = null;
}

// Event wiring
fsClose.addEventListener('click', closeFullscreenEditor);

fsOverlay.addEventListener('click', (e) => {
  // Close if clicking the backdrop (not the modal itself)
  if (e.target === fsOverlay) closeFullscreenEditor();
});

fsEditor.addEventListener('input', syncFullscreenLineNumbers);

fsEditor.addEventListener('scroll', () => {
  fsLineNums.scrollTop = fsEditor.scrollTop;
});

// Tab key support in fullscreen editor
fsEditor.addEventListener('keydown', function(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = this.selectionStart;
    this.value = this.value.substring(0, start) + '  ' + this.value.substring(this.selectionEnd);
    this.selectionStart = this.selectionEnd = start + 2;
    syncFullscreenLineNumbers();
  }
});
