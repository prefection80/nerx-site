// ====================================================
// CONDITION EVALUATOR — evaluateCondition() for IF/ELSE/ENDIF
// Source: phasor_diagram.html lines 3342–3431
// Exports: evaluateCondition
// Imports: evalExpression from ./parser-expr.js
// ====================================================

import { evalExpression } from './parser-expr.js';

export function evaluateCondition(condStr, variables, errors) {
  condStr = condStr.trim();
  if (!condStr) { errors.push('Empty condition'); return false; }

  // Helper: find first index of 'token' at paren depth 0 in 'str'
  function splitAtDepth0(str, token) {
    let depth = 0;
    const tlen = token.length;
    for (let i = 0; i <= str.length - tlen; i++) {
      const ch = str[i];
      if (ch === '(') { depth++; continue; }
      if (ch === ')') { depth--; continue; }
      if (depth === 0 && str.slice(i, i + tlen) === token) return i;
    }
    return -1;
  }

  // Handle || at zero depth (lowest precedence, left-to-right)
  const orIdx = splitAtDepth0(condStr, '||');
  if (orIdx >= 0) {
    const left = condStr.slice(0, orIdx).trim();
    const right = condStr.slice(orIdx + 2).trim();
    return evaluateCondition(left, variables, errors) || evaluateCondition(right, variables, errors);
  }

  // Handle && at zero depth
  const andIdx = splitAtDepth0(condStr, '&&');
  if (andIdx >= 0) {
    const left = condStr.slice(0, andIdx).trim();
    const right = condStr.slice(andIdx + 2).trim();
    return evaluateCondition(left, variables, errors) && evaluateCondition(right, variables, errors);
  }

  // Handle ! prefix (NOT) — guard against != operator
  if (condStr.startsWith('!') && !condStr.startsWith('!=')) {
    return !evaluateCondition(condStr.slice(1).trim(), variables, errors);
  }

  // Handle parenthesized group wrapping the entire expression
  if (condStr.startsWith('(') && condStr.endsWith(')')) {
    let depth = 0, outerBalanced = true;
    for (let i = 0; i < condStr.length - 1; i++) {
      if (condStr[i] === '(') depth++;
      else if (condStr[i] === ')') depth--;
      if (depth === 0) { outerBalanced = false; break; }
    }
    if (outerBalanced) return evaluateCondition(condStr.slice(1, -1).trim(), variables, errors);
  }

  // Handle comparison operators — multi-char checked first to avoid prefix conflicts
  const ops = ['>=', '<=', '==', '!=', '>', '<'];
  for (const op of ops) {
    const idx = splitAtDepth0(condStr, op);
    if (idx >= 0) {
      const lhsStr = condStr.slice(0, idx).trim();
      const rhsStr = condStr.slice(idx + op.length).trim();
      try {
        const lhsVal = evalExpression(lhsStr, variables);
        const rhsVal = evalExpression(rhsStr, variables);
        if (!lhsVal || !rhsVal) {
          errors.push(`Condition: could not evaluate '${condStr}'`);
          return false;
        }
        const lv = lhsVal.re;
        const rv = rhsVal.re;
        if (op === '>')  return lv > rv;
        if (op === '<')  return lv < rv;
        if (op === '>=') return lv >= rv;
        if (op === '<=') return lv <= rv;
        if (op === '==') return Math.abs(lv - rv) < 1e-9;
        if (op === '!=') return Math.abs(lv - rv) >= 1e-9;
      } catch (e) {
        errors.push(`Condition: ${e.message} in '${condStr}'`);
        return false;
      }
    }
  }

  // Fall back: evaluate as expression and treat non-zero as truthy
  try {
    const val = evalExpression(condStr, variables);
    if (!val) { errors.push(`Condition: could not evaluate '${condStr}'`); return false; }
    return Math.abs(val.re) > 1e-9 || Math.abs(val.im) > 1e-9;
  } catch (e) {
    errors.push(`Condition: ${e.message} in '${condStr}'`);
    return false;
  }
}
