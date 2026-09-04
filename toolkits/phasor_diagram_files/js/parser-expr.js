// ====================================================
// EXPRESSION PARSER — tokenize() + recursive-descent evaluator
// Source: phasor_diagram.html lines 1522–1912
// Exports: tokenize, evalExpression
// Imports: Phasor from ./phasor.js
// ====================================================

import { Phasor } from './phasor.js';

export function tokenize(expr, knownVars) {
  const varNames = knownVars || new Set();
  const tokens = [];
  let i = 0;
  const s = expr.trim();
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s[i] === '∠' || s[i] === '<') { tokens.push({ type: 'ANG' }); i++; continue; }
    if (s[i] === '+') { tokens.push({ type: 'PLUS' }); i++; continue; }
    if (s[i] === '-') { tokens.push({ type: 'MINUS' }); i++; continue; }
    if (s[i] === '*') { tokens.push({ type: 'MUL' }); i++; continue; }
    if (s[i] === '/') { tokens.push({ type: 'DIV' }); i++; continue; }
    if (s[i] === '^') { tokens.push({ type: 'POW' }); i++; continue; }
    if (s[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (s[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    if (s[i] === ',') { tokens.push({ type: 'COMMA' }); i++; continue; }
    if (s[i] === '|') { tokens.push({ type: 'PIPE' }); i++; continue; }

    if (/[\d.]/.test(s[i])) {
      let num = '';
      while (i < s.length) {
        const c = s[i];
        if (/[\d.eE]/.test(c)) {
          num += c;
          i++;
          // If we just consumed 'e' or 'E', check for optional sign
          if ((c === 'e' || c === 'E') && i < s.length && (s[i] === '+' || s[i] === '-')) {
            num += s[i];
            i++;
          }
        } else {
          break;
        }
      }
      if (i < s.length && s[i] === 'j' && (i + 1 >= s.length || !/[a-zA-Z_]/.test(s[i+1]))) {
        tokens.push({ type: 'JNUM', value: parseFloat(num) }); i++; continue;
      }
      tokens.push({ type: 'NUM', value: parseFloat(num) }); continue;
    }

    if (/[a-zA-Z_]/.test(s[i])) {
      let id = '';
      const startI = i;
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) { id += s[i]; i++; }

      let isKnownVar = false;
      for (const v of varNames) {
        if (v === id || v.toLowerCase() === id.toLowerCase()) { isKnownVar = true; break; }
      }
      if (isKnownVar) { tokens.push({ type: 'ID', value: id }); continue; }

      if (id === 'j') {
        if (i < s.length && /[\d.]/.test(s[i])) {
          let num = '';
          while (i < s.length && /[\d.eE]/.test(s[i])) { num += s[i]; i++; }
          tokens.push({ type: 'JNUM', value: parseFloat(num) });
        } else {
          tokens.push({ type: 'JNUM', value: 1 });
        }
        continue;
      }

      if (id.length > 1 && id[0] === 'j' && /^\d/.test(id.substring(1))) {
        i = startI + 1;
        let num = '';
        while (i < s.length && /[\d.eE]/.test(s[i])) { num += s[i]; i++; }
        tokens.push({ type: 'JNUM', value: parseFloat(num) }); continue;
      }

      tokens.push({ type: 'ID', value: id }); continue;
    }
    throw new Error(`Unexpected character '${s[i]}'`);
  }
  return tokens;
}

function parseExpr(tokens, pos, vars) {
  let [left, p] = parseTerm(tokens, pos, vars);
  while (p < tokens.length && (tokens[p].type === 'PLUS' || tokens[p].type === 'MINUS')) {
    const op = tokens[p].type; p++;
    let [right, p2] = parseTerm(tokens, p, vars);
    left = op === 'PLUS' ? left.add(right) : left.sub(right);
    p = p2;
  }
  return [left, p];
}

function parseTerm(tokens, pos, vars) {
  let [left, p] = parseUnary(tokens, pos, vars);
  while (p < tokens.length && (tokens[p].type === 'MUL' || tokens[p].type === 'DIV')) {
    const op = tokens[p].type; p++;
    let [right, p2] = parseUnary(tokens, p, vars);
    left = op === 'MUL' ? left.mul(right) : left.div(right);
    p = p2;
  }
  return [left, p];
}

function parseUnary(tokens, pos, vars) {
  if (pos < tokens.length && tokens[pos].type === 'MINUS') {
    let [val, p] = parseUnary(tokens, pos + 1, vars);
    return [val.neg(), p];
  }
  if (pos < tokens.length && tokens[pos].type === 'PLUS') return parseUnary(tokens, pos + 1, vars);
  return parsePower(tokens, pos, vars);
}

function parsePower(tokens, pos, vars) {
  let [left, p] = parseAtom(tokens, pos, vars);
  if (p < tokens.length && tokens[p].type === 'POW') {
    p++;
    let [right, p2] = parseUnary(tokens, p, vars); // right-associative
    const n = right.re;
    const newMag = Math.pow(left.mag, n);
    const newAng = left.ang * n;
    left = Phasor.polar(newMag, newAng * 180 / Math.PI);
    p = p2;
  }
  return [left, p];
}

function parseAtom(tokens, pos, vars) {
  if (pos >= tokens.length) throw new Error('Unexpected end of expression');
  const t = tokens[pos];

  if (t.type === 'NUM') {
    let p = pos + 1;
    if (p < tokens.length && tokens[p].type === 'ANG') {
      p++;
      let [angVal, p2] = parseExpr(tokens, p, vars);
      return [Phasor.polar(t.value, angVal.re), p2];
    }
    return [new Phasor(t.value, 0), p];
  }

  if (t.type === 'JNUM') return [new Phasor(0, t.value), pos + 1];

  if (t.type === 'ID') {
    const name = t.value.toLowerCase();
    if (pos + 1 < tokens.length && tokens[pos + 1].type === 'LPAREN') {
      // Two-argument functions
      if (name === 'proj') {
        let p = pos + 2;
        let [phasorArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`proj() requires two arguments: proj(phasor, axis_degrees)`);
        p2++;
        let [axisArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after proj()`);
        p3++;
        const axisRad = axisArg.re * Math.PI / 180;
        const projected = phasorArg.mag * Math.cos(phasorArg.ang - axisRad);
        return [new Phasor(projected, 0), p3];
      }
      if (name === 'pow') {
        let p = pos + 2;
        let [baseArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`pow() requires two arguments: pow(base, exponent)`);
        p2++;
        let [expArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after pow()`);
        p3++;
        // Complex power: |z|^n at angle n*theta
        const n = expArg.re;
        const newMag = Math.pow(baseArg.mag, n);
        const newAng = baseArg.ang * n;
        return [Phasor.polar(newMag, newAng * 180 / Math.PI), p3];
      }
      if (name === 'atan2') {
        let p = pos + 2;
        let [yArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`atan2() requires two arguments: atan2(y, x)`);
        p2++;
        let [xArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after atan2()`);
        p3++;
        return [new Phasor(Math.atan2(yArg.re, xArg.re) * 180 / Math.PI, 0), p3];
      }
      // Two-argument power engineering functions
      if (name === 'pf') {
        // Power factor = cos(angle_V - angle_I), positive = lagging
        let p = pos + 2;
        let [vArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`pf() requires two arguments: pf(V, I)`);
        p2++;
        let [iArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after pf()`);
        p3++;
        const theta = vArg.ang - iArg.ang;
        // Apply sign: Positive = lagging (theta > 0), Negative = leading (theta < 0)
        const sign = Math.sin(theta) >= 0 ? 1 : -1;
        return [new Phasor(Math.abs(Math.cos(theta)) * sign, 0), p3];
      }
      if (name === 'power' || name === 'spower') {
        // Complex power S = V * conj(I) → P + jQ
        let p = pos + 2;
        let [vArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`power() requires two arguments: power(V, I)`);
        p2++;
        let [iArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after power()`);
        p3++;
        return [vArg.mul(iArg.conj()), p3];
      }
      if (name === 'preal') {
        // Real power P = |V|·|I|·cos(θ)
        let p = pos + 2;
        let [vArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`preal() requires two arguments: preal(V, I)`);
        p2++;
        let [iArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after preal()`);
        p3++;
        const theta = vArg.ang - iArg.ang;
        return [new Phasor(vArg.mag * iArg.mag * Math.cos(theta), 0), p3];
      }
      if (name === 'qreactive') {
        // Reactive power Q = |V|·|I|·sin(θ), positive = lagging/inductive
        let p = pos + 2;
        let [vArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`qreactive() requires two arguments: qreactive(V, I)`);
        p2++;
        let [iArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after qreactive()`);
        p3++;
        const theta = vArg.ang - iArg.ang;
        return [new Phasor(vArg.mag * iArg.mag * Math.sin(theta), 0), p3];
      }
      if (name === 's3p') {
        // Three-phase complex power = 3 × Vln × conj(I)
        let p = pos + 2;
        let [vArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`s3p() requires two arguments: s3p(Vln, I)`);
        p2++;
        let [iArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after s3p()`);
        p3++;
        return [vArg.mul(iArg.conj()).mul(new Phasor(3, 0)), p3];
      }
      if (name === 'pu') {
        // Per-unit: actual / base
        let p = pos + 2;
        let [actArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`pu() requires two arguments: pu(actual, base)`);
        p2++;
        let [baseArg2, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after pu()`);
        p3++;
        return [actArg.div(baseArg2), p3];
      }
      if (name === 'frompu') {
        // From per-unit to actual: pu_val × base
        let p = pos + 2;
        let [puArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`frompu() requires two arguments: frompu(pu_val, base)`);
        p2++;
        let [baseArg2, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after frompu()`);
        p3++;
        return [puArg.mul(baseArg2), p3];
      }
      if (name === 'zbase') {
        // Impedance base = Vbase² / Sbase
        let p = pos + 2;
        let [vbArg, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`zbase() requires two arguments: zbase(Vbase, Sbase)`);
        p2++;
        let [sbArg, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'RPAREN') throw new Error(`Missing ')' after zbase()`);
        p3++;
        const vb = vbArg.re;
        const sb = sbArg.re;
        return [new Phasor(vb * vb / sb, 0), p3];
      }
      // Three-argument functions: sequence/phase transforms
      // seq0(Va, Vb, Vc) = (1/3)(Va + Vb + Vc)
      // seq1(Va, Vb, Vc) = (1/3)(Va + a*Vb + a²*Vc)
      // seq2(Va, Vb, Vc) = (1/3)(Va + a²*Vb + a*Vc)
      // pha(V0, V1, V2) = V0 + V1 + V2
      // phb(V0, V1, V2) = V0 + a²*V1 + a*V2
      // phc(V0, V1, V2) = V0 + a*V1 + a²*V2
      if (name === 'seq0' || name === 'seq1' || name === 'seq2' ||
          name === 'pha' || name === 'phb' || name === 'phc') {
        let p = pos + 2;
        let [arg1, p2] = parseExpr(tokens, p, vars);
        if (p2 >= tokens.length || tokens[p2].type !== 'COMMA') throw new Error(`${t.value}() requires three arguments`);
        p2++;
        let [arg2, p3] = parseExpr(tokens, p2, vars);
        if (p3 >= tokens.length || tokens[p3].type !== 'COMMA') throw new Error(`${t.value}() requires three arguments`);
        p3++;
        let [arg3, p4] = parseExpr(tokens, p3, vars);
        if (p4 >= tokens.length || tokens[p4].type !== 'RPAREN') throw new Error(`Missing ')' after ${t.value}()`);
        p4++;
        // a = 1∠120°, a² = 1∠240°
        const aOp = Phasor.polar(1, 120);
        const a2Op = Phasor.polar(1, 240);
        const third = new Phasor(1/3, 0);
        let result;
        if (name === 'seq0') {
          // V0 = (1/3)(Va + Vb + Vc)
          result = arg1.add(arg2).add(arg3).mul(third);
        } else if (name === 'seq1') {
          // V1 = (1/3)(Va + a*Vb + a²*Vc)
          result = arg1.add(aOp.mul(arg2)).add(a2Op.mul(arg3)).mul(third);
        } else if (name === 'seq2') {
          // V2 = (1/3)(Va + a²*Vb + a*Vc)
          result = arg1.add(a2Op.mul(arg2)).add(aOp.mul(arg3)).mul(third);
        } else if (name === 'pha') {
          // Va = V0 + V1 + V2
          result = arg1.add(arg2).add(arg3);
        } else if (name === 'phb') {
          // Vb = V0 + a²*V1 + a*V2
          result = arg1.add(a2Op.mul(arg2)).add(aOp.mul(arg3));
        } else if (name === 'phc') {
          // Vc = V0 + a*V1 + a²*V2
          result = arg1.add(aOp.mul(arg2)).add(a2Op.mul(arg3));
        }
        return [result, p4];
      }
      // Single-argument functions
      let p = pos + 2;
      let [arg, p2] = parseExpr(tokens, p, vars);
      if (p2 >= tokens.length || tokens[p2].type !== 'RPAREN') throw new Error(`Missing ')' after ${t.value}()`);
      p2++;
      if (name === 'conj' || name === 'conjugate') return [arg.conj(), p2];
      if (name === 'mag' || name === 'abs') return [new Phasor(arg.mag, 0), p2];
      if (name === 'ang' || name === 'angle') return [new Phasor(arg.angDeg, 0), p2];
      if (name === 're' || name === 'real') return [new Phasor(arg.re, 0), p2];
      if (name === 'im' || name === 'imag') return [new Phasor(arg.im, 0), p2];
      if (name === 'sqrt') {
        // Complex sqrt: sqrt(|z|) at angle theta/2
        const newMag = Math.sqrt(arg.mag);
        const newAng = arg.ang / 2;
        return [Phasor.polar(newMag, newAng * 180 / Math.PI), p2];
      }
      if (name === 'sin') return [new Phasor(Math.sin(arg.re * Math.PI / 180), 0), p2];
      if (name === 'cos') return [new Phasor(Math.cos(arg.re * Math.PI / 180), 0), p2];
      if (name === 'tan') return [new Phasor(Math.tan(arg.re * Math.PI / 180), 0), p2];
      if (name === 'asin' || name === 'arcsin') return [new Phasor(Math.asin(arg.re) * 180 / Math.PI, 0), p2];
      if (name === 'acos' || name === 'arccos') return [new Phasor(Math.acos(arg.re) * 180 / Math.PI, 0), p2];
      if (name === 'atan' || name === 'arctan') return [new Phasor(Math.atan(arg.re) * 180 / Math.PI, 0), p2];
      if (name === 'ln') return [new Phasor(Math.log(arg.re), 0), p2];
      if (name === 'log' || name === 'log10') return [new Phasor(Math.log10(arg.re), 0), p2];
      if (name === 'exp') return [new Phasor(Math.exp(arg.re), 0), p2];
      throw new Error(`Unknown function '${t.value}'`);
    }
    const varName = t.value;
    let resolved = null;
    if (vars.has(varName)) resolved = vars.get(varName);
    else {
      for (const [k, v] of vars) {
        if (k.toLowerCase() === name) { resolved = v; break; }
      }
    }
    if (!resolved) throw new Error(`Undefined variable '${t.value}'`);
    // Support: variable ∠ angle (use variable magnitude with new angle)
    let p = pos + 1;
    if (p < tokens.length && tokens[p].type === 'ANG') {
      p++;
      let [angVal, p2] = parseExpr(tokens, p, vars);
      return [Phasor.polar(resolved.mag, angVal.re), p2];
    }
    return [resolved, pos + 1];
  }

  if (t.type === 'LPAREN') {
    let [val, p] = parseExpr(tokens, pos + 1, vars);
    if (p >= tokens.length || tokens[p].type !== 'RPAREN') throw new Error("Missing ')'");
    return [val, p + 1];
  }

  if (t.type === 'PIPE') {
    let [val, p] = parseExpr(tokens, pos + 1, vars);
    if (p >= tokens.length || tokens[p].type !== 'PIPE') throw new Error("Missing closing '|'");
    return [new Phasor(val.mag, 0), p + 1];
  }

  throw new Error(`Unexpected token '${t.type}'`);
}

export function evalExpression(expr, vars) {
  const knownVars = new Set(vars.keys());
  const tokens = tokenize(expr, knownVars);
  if (tokens.length === 0) return null;
  const [result, pos] = parseExpr(tokens, 0, vars);
  if (pos < tokens.length) throw new Error(`Unexpected content after expression`);
  return result;
}
