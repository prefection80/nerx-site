// ====================================================
// STATE — shared mutable application state
// Source: phasor_diagram.html lines 2374–2383, 3264–3271, 2729 (_batchLoading)
// Exports: all state vars + setter functions
// Imports: none
//
// ES module `let` exports are live read-only bindings in importers;
// only this module can reassign primitives — use the setter functions.
// Arrays and Maps are objects; mutations propagate through the reference.
// ====================================================

// ─── Set registry ───────────────────────────────────────────────────────────
export let sets = [];
export let setIdCounter = 0;

// Global variable pool (union of all sets' evaluated variables)
export let globalVars = new Map();
// Track which set owns which variable: varName → setId
export let varOwnership = new Map();

// ─── Batch-loading flag ──────────────────────────────────────────────────────
// Prevents drawAllSets() firing during bulk set creation (import, URL load)
export let _batchLoading = false;

// ─── Global animation state ──────────────────────────────────────────────────
export let globalAnimRunning = false;
export let globalAnimAngle = 0;
export let globalAnimLastTime = 0;
export let globalAnimFrameId = null;
export let globalAnimFreqHz = 0.2;

// ─── Setters for primitive values ────────────────────────────────────────────
// (Importers cannot reassign primitives exported by let; they must call these.)

export function setSetIdCounter(v)       { setIdCounter = v; }
export function setBatchLoading(v)       { _batchLoading = v; }

export function setGlobalAnimRunning(v)  { globalAnimRunning = v; }
export function setGlobalAnimAngle(v)    { globalAnimAngle = v; }
export function setGlobalAnimLastTime(v) { globalAnimLastTime = v; }
export function setGlobalAnimFrameId(v)  { globalAnimFrameId = v; }
export function setGlobalAnimFreqHz(v)   { globalAnimFreqHz = v; }
