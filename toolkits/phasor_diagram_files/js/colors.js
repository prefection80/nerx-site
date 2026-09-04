// ====================================================
// COLORS — phasor color palette
// Source: phasor_diagram.html lines 1913–1922
// Exports: PHASOR_COLORS, getColor
// Imports: none
// ====================================================

export const PHASOR_COLORS = [
  '#059669', '#2563eb', '#dc2626', '#d97706', '#7c3aed',
  '#0891b2', '#be185d', '#4f46e5', '#b45309', '#0d9488',
  '#9333ea', '#c026d3', '#065f46', '#9f1239', '#1d4ed8',
  '#ea580c', '#4338ca', '#0e7490', '#a21caf', '#15803d'
];

export function getColor(idx) { return PHASOR_COLORS[idx % PHASOR_COLORS.length]; }
