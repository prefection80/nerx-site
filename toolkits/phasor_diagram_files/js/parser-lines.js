// ====================================================
// PARSER-LINES — parseAllLines() + evaluateAllSets()
// Source: phasor_diagram.html lines 3434–3889
// Exports: parseAllLines, evaluateAllSets
// Imports:
//   Phasor from ./phasor.js
//   tokenize, evalExpression from ./parser-expr.js
//   evaluateCondition from ./parser-condition.js
//   sets, globalVars, varOwnership from ./state.js
//   applyAdj from ./adjustments.js
// ====================================================

import { Phasor } from './phasor.js';
import { tokenize, evalExpression } from './parser-expr.js';
import { evaluateCondition } from './parser-condition.js';
import { sets, globalVars, varOwnership } from './state.js';
import { applyAdj } from './adjustments.js';

// ====================================================
// PARSE ALL LINES (for one set, with global vars as fallback)
// ====================================================
export function parseAllLines(text, setObj, externalVars) {
  const lines = text.split('\n');
  const vars = new Map();
  // Built-in constants
  vars.set('pi', new Phasor(Math.PI, 0));
  vars.set('PI', new Phasor(Math.PI, 0));
  vars.set('e', new Phasor(Math.E, 0));
  vars.set('sqrt3', new Phasor(Math.sqrt(3), 0));
  // Seed with external vars so references resolve
  if (externalVars) {
    for (const [k, v] of externalVars) vars.set(k, v);
  }
  const order = [];
  const assignments = [];
  const errors = [];
  const localNames = new Set(); // names defined in THIS set
  const referencedExternals = new Set();
  const condStack = [];              // stack of { active, sawElse, skipAll } frames
  const isExecuting = () => condStack.every(f => f.active);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // ── IF / ELSE / ENDIF keyword detection ──────────────────────────────────
    // Safe: only triggers when the trimmed line is exactly 'IF', or starts with
    // 'IF ' / 'IF\t' — variable names like 'IFault' or 'ElseCase' are never matched.
    const lineUpper = line.toUpperCase();
    if (lineUpper === 'IF' || lineUpper.startsWith('IF ') || lineUpper.startsWith('IF\t')) {
      const ifCondStr = line.slice(2).trim();
      if (!ifCondStr && isExecuting()) errors.push(`Line ${i+1}: IF without condition`);
      const cond = ifCondStr && isExecuting() ? evaluateCondition(ifCondStr, vars, errors) : false;
      condStack.push({ active: cond, sawElse: false, skipAll: !isExecuting() });
      continue;
    }
    if (/^ELSE\s*$/i.test(line)) {
      if (condStack.length === 0) { errors.push(`Line ${i+1}: ELSE without IF`); continue; }
      const frame = condStack[condStack.length - 1];
      if (frame.sawElse) { errors.push(`Line ${i+1}: duplicate ELSE`); continue; }
      frame.sawElse = true;
      if (!frame.skipAll) frame.active = !frame.active;
      continue;
    }
    if (/^ENDIF\s*$/i.test(line)) {
      if (condStack.length === 0) { errors.push(`Line ${i+1}: ENDIF without IF`); continue; }
      condStack.pop();
      continue;
    }
    // Skip lines inside an inactive branch (structural keywords already handled above)
    if (!isExecuting()) continue;

    let tailOn = null;
    let hidden = false;
    let fixed = false;
    let isDot = false;
    let diagram = 0;
    let oscGroup = 0; // 0 = default (osc1), 1/2/3... = specific oscilloscope
    const colonIdx = line.indexOf('::');
    if (colonIdx >= 0) {
      const directive = line.substring(colonIdx + 2).trim();
      line = line.substring(0, colonIdx).trim();

      const segments = directive.split('::');
      const tailNames = [];
      for (const seg of segments) {
        const parts = seg.trim().split(/\s+/);
        for (const part of parts) {
          if (!part) continue;
          if (part.toLowerCase() === 'ds') hidden = true;
          else if (part.toLowerCase() === 'fixed') fixed = true;
          else if (part.toLowerCase() === 'dot') isDot = true;
          else if (part.toLowerCase() === 'd1') diagram = 1;
          else if (part.toLowerCase() === 'd2') diagram = 2;
          else if (part.toLowerCase() === 'd3') diagram = 3;
          else if (/^osc(\d+)$/i.test(part)) oscGroup = parseInt(part.match(/^osc(\d+)$/i)[1]);
          else if (part.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) tailNames.push(part);
        }
      }
      if (tailNames.length > 0) {
        tailOn = tailNames[0];
        for (let ti = 0; ti < tailNames.length - 1; ti++) {
          const childName = tailNames[ti];
          const parentName = tailNames[ti + 1];
          const existingAsgn = assignments.find(a => a.name === childName ||
            a.name.toLowerCase() === childName.toLowerCase());
          if (existingAsgn && !existingAsgn.tailOn) existingAsgn.tailOn = parentName;
        }
      }
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) { errors.push(`Line ${i+1}: Missing '=' in assignment`); continue; }

    const lhs = line.substring(0, eqIdx).trim();
    const expr = line.substring(eqIdx + 1).trim();

    // Check for multi-assignment: V0, V1, V2 = seq(Va, Vb, Vc)
    const lhsParts = lhs.split(',').map(s => s.trim());
    if (lhsParts.length === 3) {
      const exprLower = expr.toLowerCase().trim();
      const isSeq = exprLower.startsWith('seq(') || exprLower.startsWith('toseq(') || exprLower.startsWith('abc2seq(');
      const isPhase = exprLower.startsWith('phase(') || exprLower.startsWith('tophase(') || exprLower.startsWith('seq2abc(');
      const isLnToLl = exprLower.startsWith('lntoll(');
      const isLlToLn = exprLower.startsWith('lltoln(');
      const isLgToLl = exprLower.startsWith('lgtoll(');
      const isLlToLg = exprLower.startsWith('lltolg(');
      const isLgToLn = exprLower.startsWith('lgtoln(');
      const isLnToLg = exprLower.startsWith('lntolg(');
      const isMultiFunc = isSeq || isPhase || isLnToLl || isLlToLn || isLgToLl || isLlToLg || isLgToLn || isLnToLg;
      if (isMultiFunc) {
        // Validate all three names
        let namesValid = true;
        for (const n of lhsParts) {
          if (!n.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
            errors.push(`Line ${i+1}: Invalid variable name '${n}'`);
            namesValid = false;
          } else if (localNames.has(n)) {
            errors.push(`Line ${i+1}: Variable '${n}' is already defined in this set`);
            namesValid = false;
          } else if (externalVars && externalVars.has(n)) {
            errors.push(`Line ${i+1}: Variable '${n}' is already defined in another set`);
            namesValid = false;
          }
        }
        if (!namesValid) continue;

        // Parse the three arguments inside parentheses
        const parenStart = expr.indexOf('(');
        const parenEnd = expr.lastIndexOf(')');
        const funcLabel = isSeq ? 'seq' : isPhase ? 'phase' : isLnToLl ? 'lntoll' : isLlToLn ? 'lltoln' : isLgToLl ? 'lgtoll' : isLlToLg ? 'lltolg' : isLgToLn ? 'lgtoln' : 'lntolg';
        if (parenStart < 0 || parenEnd < 0) {
          errors.push(`Line ${i+1}: Missing parentheses in ${funcLabel}()`);
          continue;
        }
        const argsStr = expr.substring(parenStart + 1, parenEnd).trim();
        const argNames = argsStr.split(',').map(s => s.trim());
        const needs4 = isLlToLg || isLnToLg;
        const expectedArgs = needs4 ? 4 : 3;
        if (argNames.length !== expectedArgs) {
          if (needs4) {
            errors.push(`Line ${i+1}: ${funcLabel}() requires 4 arguments — ${funcLabel}(${isLlToLg ? 'Vab, Vbc, Vca' : 'Van, Vbn, Vcn'}, V0)`);
          } else {
            errors.push(`Line ${i+1}: ${funcLabel}() requires exactly 3 arguments`);
          }
          continue;
        }

        try {
          const arg1 = evalExpression(argNames[0], vars);
          const arg2 = evalExpression(argNames[1], vars);
          const arg3 = evalExpression(argNames[2], vars);
          if (!arg1 || !arg2 || !arg3) throw new Error('Could not evaluate arguments');
          let arg4 = null;
          if (needs4) {
            arg4 = evalExpression(argNames[3], vars);
            if (!arg4) throw new Error('Could not evaluate V0 (4th argument)');
          }

          const aOp = Phasor.polar(1, 120);
          const a2Op = Phasor.polar(1, 240);
          const third = new Phasor(1/3, 0);
          let r1, r2, r3;

          if (isSeq) {
            r1 = arg1.add(arg2).add(arg3).mul(third);                          // V0
            r2 = arg1.add(aOp.mul(arg2)).add(a2Op.mul(arg3)).mul(third);       // V1
            r3 = arg1.add(a2Op.mul(arg2)).add(aOp.mul(arg3)).mul(third);       // V2
          } else if (isPhase) {
            r1 = arg1.add(arg2).add(arg3);                                     // Va
            r2 = arg1.add(a2Op.mul(arg2)).add(aOp.mul(arg3));                  // Vb
            r3 = arg1.add(aOp.mul(arg2)).add(a2Op.mul(arg3));                  // Vc
          } else if (isLnToLl) {
            // Line-neutral → Line-line
            // Vab = Va - Vb, Vbc = Vb - Vc, Vca = Vc - Va
            r1 = arg1.sub(arg2);   // Vab
            r2 = arg2.sub(arg3);   // Vbc
            r3 = arg3.sub(arg1);   // Vca
          } else if (isLlToLn) {
            // Line-line → Line-neutral
            // Va = (1/3)(Vab - Vca), Vb = (1/3)(Vbc - Vab), Vc = (1/3)(Vca - Vbc)
            r1 = arg1.sub(arg3).mul(third);   // Va
            r2 = arg2.sub(arg1).mul(third);   // Vb
            r3 = arg3.sub(arg2).mul(third);   // Vc
          } else if (isLgToLl) {
            // Line-to-ground → Line-line
            // Vab = Vag - Vbg, Vbc = Vbg - Vcg, Vca = Vcg - Vag
            // (same as lntoll — V0 cancels in the subtraction)
            r1 = arg1.sub(arg2);   // Vab
            r2 = arg2.sub(arg3);   // Vbc
            r3 = arg3.sub(arg1);   // Vca
          } else if (isLlToLg) {
            // Line-line → Line-to-ground
            // Requires V0 as 4th argument: lltolg(Vab, Vbc, Vca, V0)
            // First get LN: Va = (1/3)(Vab - Vca), then add V0
            const vn1 = arg1.sub(arg3).mul(third);   // Van
            const vn2 = arg2.sub(arg1).mul(third);   // Vbn
            const vn3 = arg3.sub(arg2).mul(third);   // Vcn
            r1 = vn1.add(arg4);   // Vag = Van + V0
            r2 = vn2.add(arg4);   // Vbg = Vbn + V0
            r3 = vn3.add(arg4);   // Vcg = Vcn + V0
          } else if (isLgToLn) {
            // Line-to-ground → Line-neutral
            // V0 = (1/3)(Vag + Vbg + Vcg)
            // Van = Vag - V0, Vbn = Vbg - V0, Vcn = Vcg - V0
            const v0 = arg1.add(arg2).add(arg3).mul(third);
            r1 = arg1.sub(v0);   // Van
            r2 = arg2.sub(v0);   // Vbn
            r3 = arg3.sub(v0);   // Vcn
          } else if (isLnToLg) {
            // Line-neutral → Line-to-ground
            // Requires V0 as 4th argument: lntolg(Van, Vbn, Vcn, V0)
            // Vag = Van + V0, Vbg = Vbn + V0, Vcg = Vcn + V0
            r1 = arg1.add(arg4);   // Vag
            r2 = arg2.add(arg4);   // Vbg
            r3 = arg3.add(arg4);   // Vcg
          }

          // Apply adjustments and store all three
          const results = [r1, r2, r3];
          for (let k = 0; k < 3; k++) {
            const vName = lhsParts[k];
            let result = applyAdj(results[k], setObj, vName);
            vars.set(vName, result);
            order.push(vName);
            localNames.add(vName);

            const deps = [];
            for (const an of argNames) {
              const anTrim = an.trim();
              if (vars.has(anTrim)) {
                deps.push(anTrim);
                if (externalVars && externalVars.has(anTrim)) referencedExternals.add(anTrim);
              } else {
                for (const vk of vars.keys()) {
                  if (vk.toLowerCase() === anTrim.toLowerCase()) {
                    deps.push(vk);
                    if (externalVars && externalVars.has(vk)) referencedExternals.add(vk);
                    break;
                  }
                }
              }
            }
            assignments.push({
              name: vName,
              expr: `${funcLabel}[${k}](${argsStr})`,
              deps, opType: 'direct', tailOn, hidden, fixed, isDot, diagram, oscGroup,
              lineNum: i + 1,
              _multiExpr: expr,
              _multiIdx: k
            });
          }
        } catch (e) {
          errors.push(`Line ${i+1}: ${e.message}`);
        }
        continue;
      }
    }

    const name = lhs;

    if (!name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
      errors.push(`Line ${i+1}: Invalid variable name '${name}'`);
      continue;
    }

    if (localNames.has(name)) {
      errors.push(`Line ${i+1}: Variable '${name}' is already defined in this set`);
      continue;
    }

    if (externalVars && externalVars.has(name)) {
      errors.push(`Line ${i+1}: Variable '${name}' is already defined in another set`);
      continue;
    }

    if (tailOn) {
      let found = false;
      if (vars.has(tailOn)) found = true;
      else {
        for (const k of vars.keys()) {
          if (k.toLowerCase() === tailOn.toLowerCase()) { tailOn = k; found = true; break; }
        }
      }
      if (!found) { errors.push(`Line ${i+1}: Tail reference '${tailOn}' not defined yet`); tailOn = null; }
    }

    try {
      // Check for circle() function: Name = circle(center, radius) or circle(Z1, Z2)
      const circleMatch = expr.match(/^circle\s*\(\s*(.+)\s*\)$/i);
      let circleData = null;
      if (circleMatch) {
        const cArgsStr = circleMatch[1];
        // Split on commas not inside parentheses
        let depth = 0, splitIdx = -1;
        for (let ci = 0; ci < cArgsStr.length; ci++) {
          if (cArgsStr[ci] === '(') depth++;
          else if (cArgsStr[ci] === ')') depth--;
          else if (cArgsStr[ci] === ',' && depth === 0) { splitIdx = ci; break; }
        }
        if (splitIdx < 0) {
          errors.push(`Line ${i+1}: circle() requires 2 arguments — circle(center, radius) or circle(Zfar, Znear)`);
          continue;
        }
        const cArg1 = evalExpression(cArgsStr.substring(0, splitIdx).trim(), vars);
        const cArg2 = evalExpression(cArgsStr.substring(splitIdx + 1).trim(), vars);
        if (!cArg1 || !cArg2) { errors.push(`Line ${i+1}: Could not evaluate circle arguments`); continue; }

        let cCenter, cRadius;
        if (Math.abs(cArg2.im) < 1e-12 && cArg2.re >= 0) {
          // circle(center, radius) — arg2 is a non-negative real scalar
          cCenter = cArg1;
          cRadius = cArg2.re;
        } else {
          // circle(Z1, Z2) — diameter endpoints (mho circle)
          cCenter = cArg1.add(cArg2).mul(new Phasor(0.5, 0));
          cRadius = cArg1.sub(cArg2).mag / 2;
        }
        circleData = { cx: cCenter.re, cy: cCenter.im, r: cRadius };

        // Store center phasor as the variable value
        let result = applyAdj(cCenter, setObj, name);
        vars.set(name, result);
        order.push(name);
        localNames.add(name);

        const deps = [];
        const toks = tokenize(cArgsStr, new Set(vars.keys()));
        for (const tok of toks) {
          if (tok.type === 'ID') {
            const refName = tok.value;
            if (vars.has(refName)) {
              deps.push(refName);
              if (externalVars && externalVars.has(refName)) referencedExternals.add(refName);
            } else {
              for (const k of vars.keys()) {
                if (k.toLowerCase() === refName.toLowerCase()) {
                  deps.push(k);
                  if (externalVars && externalVars.has(k)) referencedExternals.add(k);
                  break;
                }
              }
            }
          }
        }
        assignments.push({ name, expr, deps, opType: 'direct', tailOn, hidden, fixed, isDot, diagram, oscGroup, lineNum: i + 1, _circle: circleData, _circleExpr: expr });
        continue;
      }

      let result = evalExpression(expr, vars);
      if (result) {
        result = applyAdj(result, setObj, name);
        vars.set(name, result);
        order.push(name);
        localNames.add(name);

        const deps = [];
        const toks = tokenize(expr, new Set(vars.keys()));
        for (const tok of toks) {
          if (tok.type === 'ID') {
            const refName = tok.value;
            if (vars.has(refName)) {
              deps.push(refName);
              if (externalVars && externalVars.has(refName)) referencedExternals.add(refName);
            } else {
              for (const k of vars.keys()) {
                if (k.toLowerCase() === refName.toLowerCase()) {
                  deps.push(k);
                  if (externalVars && externalVars.has(k)) referencedExternals.add(k);
                  break;
                }
              }
            }
          }
        }

        let opType = 'direct';
        const plusCount = toks.filter(t => t.type === 'PLUS').length;
        const minusCount = toks.filter(t => t.type === 'MINUS').length;
        const mulCount = toks.filter(t => t.type === 'MUL').length;
        if (deps.length === 2 && (plusCount + minusCount) === 1 && mulCount === 0) {
          opType = plusCount === 1 ? 'add' : 'sub';
        }
        if (deps.length === 2 && mulCount === 1 && plusCount === 0) opType = 'mul';

        assignments.push({ name, expr, deps, opType, tailOn, hidden, fixed, isDot, diagram, oscGroup, lineNum: i + 1 });
      }
    } catch (e) {
      errors.push(`Line ${i+1}: ${e.message}`);
    }
  }

  // Check for unclosed IF blocks
  if (condStack.length > 0) {
    errors.push(`Unclosed IF block (${condStack.length} block${condStack.length > 1 ? 's' : ''} not closed with ENDIF)`);
  }

  // Append referenced external variables to order so they appear in the table
  for (const extName of referencedExternals) {
    // Only add if not already in order (though externals shouldn't be local)
    if (!localNames.has(extName) && !order.includes(extName)) {
      order.push(extName);
    }
  }

  return { vars, order, assignments, errors, localNames };
}

// ====================================================
// GLOBAL EVAL: Two-pass to resolve cross-set references
// ====================================================
export function evaluateAllSets() {
  globalVars.clear();
  varOwnership.clear();
  const results = new Map();

  // Pass 1: evaluate each set with whatever globals exist from prior sets
  for (const setObj of sets) {
    const externalVars = new Map(globalVars);
    const r = parseAllLines(setObj.eqInput.value, setObj, externalVars);
    results.set(setObj.id, r);
    // Add this set's local vars to global pool
    for (const name of r.localNames) {
      const val = r.vars.get(name);
      if (val) {
        globalVars.set(name, val);
        varOwnership.set(name, setObj.id);
      }
    }
  }

  // Pass 2: re-evaluate with full global pool (resolves forward cross-references)
  const finalResults = new Map();
  for (const setObj of sets) {
    const externalVars = new Map();
    // Provide all global vars EXCEPT this set's own (they'll be recomputed)
    for (const [k, v] of globalVars) {
      if (varOwnership.get(k) !== setObj.id) externalVars.set(k, v);
    }
    const r = parseAllLines(setObj.eqInput.value, setObj, externalVars);
    finalResults.set(setObj.id, r);
    // Update globals with refined values
    for (const name of r.localNames) {
      const val = r.vars.get(name);
      if (val) {
        globalVars.set(name, val);
        varOwnership.set(name, setObj.id);
      }
    }
  }

  return finalResults;
}
