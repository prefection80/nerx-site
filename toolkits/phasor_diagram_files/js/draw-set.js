// ====================================================
// DRAW SET — drawSet() + drawAllSets()
// Source: phasor_diagram.html lines 4008–4200, 4824–4836
// Exports: drawSet, drawAllSets
// Imports:
//   Phasor from ./phasor.js
//   sets from ./state.js
//   evaluateAllSets from ./parser-lines.js
//   updateScopeTraces, updateAdjustmentSliders, updateVarsTable from ./draw-ui.js
//   drawPhasorCanvas, drawTriplePhasorCanvases from ./draw-phasor.js
//   drawScopeCanvas from ./draw-scope.js
//   getColor from ./colors.js
//   cvsFsSource, cvsFsOverlay, renderCanvasFullscreen from ./fullscreen-canvas.js
// ====================================================

import { Phasor } from './phasor.js';
import { sets } from './state.js';
import { evaluateAllSets } from './parser-lines.js';
import { updateScopeTraces, updateAdjustmentSliders, updateVarsTable } from './draw-ui.js';
import { drawPhasorCanvas, drawTriplePhasorCanvases } from './draw-phasor.js';
import { drawScopeCanvas } from './draw-scope.js';
import { getColor } from './colors.js';
import { cvsFsSource, cvsFsOverlay, renderCanvasFullscreen } from './fullscreen-canvas.js';
import { evalExpression } from './parser-expr.js';

export function drawSet(setObj, parsedResult) {
  if (setObj.collapsed) return;

  const result = parsedResult || evaluateAllSets().get(setObj.id);
  if (!result) return;

  const { vars, order, assignments, errors, localNames } = result;
  const errEl = setObj.container.querySelector('.error-msg');
  errEl.textContent = errors.length ? errors[0] : '';

  // Highlight error lines in line numbers
  if (setObj.lineNumbers) {
    const errorLines = new Set();
    for (const err of errors) {
      const m = err.match(/^Line (\d+):/);
      if (m) errorLines.add(parseInt(m[1]));
    }
    const divs = setObj.lineNumbers.children;
    for (let i = 0; i < divs.length; i++) {
      divs[i].classList.toggle('has-error', errorLines.has(i + 1));
    }
  }

  const colorMap = new Map();
  order.forEach((name, idx) => colorMap.set(name, getColor(idx)));

  // Update scope traces
  updateScopeTraces(setObj, order, colorMap, assignments);

  // Update adjustment sliders
  updateAdjustmentSliders(setObj, order, colorMap, assignments);

  // Update vars table
  updateVarsTable(setObj, order, vars, colorMap, assignments, localNames);

  // Apply animation rotation, then re-evaluate fixed phasors
  if (setObj.animRunning && Math.abs(setObj.animAngle) > 0.001) {
    const rotRad = setObj.animAngle * Math.PI / 180;
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const fixedAssignments = assignments.filter(a => a.fixed);
    const fixedNames = new Set(fixedAssignments.map(a => a.name));

    // Step 1: Rotate all non-fixed phasors
    for (const name of order) {
      if (fixedNames.has(name)) continue;
      const p = vars.get(name);
      vars.set(name, new Phasor(p.re * cosR - p.im * sinR, p.re * sinR + p.im * cosR));
    }

    // Helper to re-evaluate a single assignment (handles multi-assignment entries)
    function reEvalAssignment(asgn) {
      if (asgn._multiExpr) {
        // This is part of a seq()/phase() multi-assignment — re-evaluate all three at once
        // Find sibling assignments
        const siblings = assignments.filter(a => a._multiExpr === asgn._multiExpr);
        if (siblings.length !== 3) return;
        // Only re-eval once (when we hit index 0)
        if (asgn._multiIdx !== 0) return;
        try {
          const parenStart = asgn._multiExpr.indexOf('(');
          const parenEnd = asgn._multiExpr.lastIndexOf(')');
          const funcName = asgn._multiExpr.substring(0, parenStart).trim().toLowerCase();
          const argsStr = asgn._multiExpr.substring(parenStart + 1, parenEnd);
          const argNames = argsStr.split(',').map(s => s.trim());
          const arg1 = evalExpression(argNames[0], vars);
          const arg2 = evalExpression(argNames[1], vars);
          const arg3 = evalExpression(argNames[2], vars);
          let arg4 = null;
          if (argNames.length >= 4) arg4 = evalExpression(argNames[3], vars);
          const aOp = Phasor.polar(1, 120);
          const a2Op = Phasor.polar(1, 240);
          const third = new Phasor(1/3, 0);
          const isSeq = funcName === 'seq' || funcName === 'toseq' || funcName === 'abc2seq';
          const isPhase = funcName === 'phase' || funcName === 'tophase' || funcName === 'seq2abc';
          const isLnToLl = funcName === 'lntoll';
          const isLlToLn = funcName === 'lltoln';
          const isLgToLl = funcName === 'lgtoll';
          const isLlToLg = funcName === 'lltolg';
          const isLgToLn = funcName === 'lgtoln';
          const isLnToLg = funcName === 'lntolg';
          let r1, r2, r3;
          if (isSeq) {
            r1 = arg1.add(arg2).add(arg3).mul(third);
            r2 = arg1.add(aOp.mul(arg2)).add(a2Op.mul(arg3)).mul(third);
            r3 = arg1.add(a2Op.mul(arg2)).add(aOp.mul(arg3)).mul(third);
          } else if (isLnToLl || isLgToLl) {
            r1 = arg1.sub(arg2);
            r2 = arg2.sub(arg3);
            r3 = arg3.sub(arg1);
          } else if (isLlToLn) {
            r1 = arg1.sub(arg3).mul(third);
            r2 = arg2.sub(arg1).mul(third);
            r3 = arg3.sub(arg2).mul(third);
          } else if (isLgToLn) {
            const v0 = arg1.add(arg2).add(arg3).mul(third);
            r1 = arg1.sub(v0);
            r2 = arg2.sub(v0);
            r3 = arg3.sub(v0);
          } else if (isLlToLg) {
            // 4th arg is V0
            const vn1 = arg1.sub(arg3).mul(third);
            const vn2 = arg2.sub(arg1).mul(third);
            const vn3 = arg3.sub(arg2).mul(third);
            r1 = vn1.add(arg4);
            r2 = vn2.add(arg4);
            r3 = vn3.add(arg4);
          } else if (isLnToLg) {
            // 4th arg is V0
            r1 = arg1.add(arg4);
            r2 = arg2.add(arg4);
            r3 = arg3.add(arg4);
          } else {
            r1 = arg1.add(arg2).add(arg3);
            r2 = arg1.add(a2Op.mul(arg2)).add(aOp.mul(arg3));
            r3 = arg1.add(aOp.mul(arg2)).add(a2Op.mul(arg3));
          }
          vars.set(siblings[0].name, r1);
          vars.set(siblings[1].name, r2);
          vars.set(siblings[2].name, r3);
        } catch(e) { /* keep existing */ }
      } else if (asgn._circleExpr) {
        try {
          const cMatch = asgn._circleExpr.match(/^circle\s*\(\s*(.+)\s*\)$/i);
          if (cMatch) {
            const cArgsStr = cMatch[1];
            let depth = 0, splitIdx = -1;
            for (let ci = 0; ci < cArgsStr.length; ci++) {
              if (cArgsStr[ci] === '(') depth++;
              else if (cArgsStr[ci] === ')') depth--;
              else if (cArgsStr[ci] === ',' && depth === 0) { splitIdx = ci; break; }
            }
            if (splitIdx >= 0) {
              const cArg1 = evalExpression(cArgsStr.substring(0, splitIdx).trim(), vars);
              const cArg2 = evalExpression(cArgsStr.substring(splitIdx + 1).trim(), vars);
              if (cArg1 && cArg2) {
                let cCenter, cRadius;
                if (Math.abs(cArg2.im) < 1e-12 && cArg2.re >= 0) {
                  cCenter = cArg1; cRadius = cArg2.re;
                } else {
                  cCenter = cArg1.add(cArg2).mul(new Phasor(0.5, 0));
                  cRadius = cArg1.sub(cArg2).mag / 2;
                }
                asgn._circle = { cx: cCenter.re, cy: cCenter.im, r: cRadius };
                vars.set(asgn.name, cCenter);
              }
            }
          }
        } catch(e) { /* keep existing */ }
      } else {
        try {
          const result = evalExpression(asgn.expr, vars);
          if (result) vars.set(asgn.name, result);
        } catch(e) { /* keep existing */ }
      }
    }

    // Step 2: Re-evaluate fixed phasors using the rotated dependency values
    // This gives them updated magnitudes but their natural (unrotated) direction
    for (const fa of fixedAssignments) {
      reEvalAssignment(fa);
    }

    // Step 3: Re-evaluate non-fixed phasors that depend on any fixed phasor
    // This ensures Bnet = Ba + Bb + Bc gets the correct updated fixed values
    for (const asgn of assignments) {
      if (asgn.fixed || asgn.hidden) continue;
      const dependsOnFixed = asgn.deps.some(dep => fixedNames.has(dep));
      if (dependsOnFixed) {
        reEvalAssignment(asgn);
      }
    }
  }

  // Store state for fullscreen rendering
  setObj._lastVars = vars;
  setObj._lastOrder = order;
  setObj._lastAssignments = assignments;
  setObj._lastColorMap = colorMap;

  // Skip drawing to small canvases when fullscreen is active (it's behind the overlay)
  const fsActive = cvsFsSource && cvsFsSource.setObj === setObj && cvsFsOverlay.classList.contains('active');
  if (!fsActive) {
    if (setObj.viewMode === 'triple') {
      drawTriplePhasorCanvases(setObj, vars, order, assignments, colorMap);
    } else {
      drawPhasorCanvas(setObj, vars, order, assignments, colorMap);
    }
    drawScopeCanvas(setObj, vars, order, assignments, colorMap);
  }
}

export function drawAllSets() {
  const results = evaluateAllSets();
  for (const setObj of sets) {
    drawSet(setObj, results.get(setObj.id));
  }
  // Update fullscreen canvas if open
  if (cvsFsSource && cvsFsOverlay.classList.contains('active')) {
    renderCanvasFullscreen();
  }
}
