// ====================================================
// DRAW PHASOR — phasor diagram canvas renderer
// Source: phasor_diagram.html lines 4369–4729
// Exports: drawPhasorCanvas, drawTriplePhasorCanvases
// Imports:
//   Phasor from ./phasor.js
//   drawArrow, drawLabel, drawDashed, measureText, placeLabel,
//   arrowCandidates, isInAnyScope from ./draw-helpers.js
// ====================================================

import { Phasor } from './phasor.js';
import {
  drawArrow, drawLabel, drawDashed, measureText,
  placeLabel, arrowCandidates, isInAnyScope
} from './draw-helpers.js';

export function drawPhasorCanvas(setObj, vars, order, assignments, colorMap, targetCanvas) {
  const canvas = targetCanvas || setObj.phasorCanvas;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  const showSumArrows = true;
  const showProjections = true;

  let placedLabels = [];
  let lineSegs = [];

  function getOrigin(name, visited) {
    visited = visited || new Set();
    if (visited.has(name)) return new Phasor(0, 0);
    visited.add(name);
    const asgn = assignments.find(a => a.name === name);
    if (!asgn || !asgn.tailOn) return new Phasor(0, 0);
    return getAbsTip(asgn.tailOn, visited);
  }
  function getAbsTip(name, visited) {
    visited = visited || new Set();
    const origin = getOrigin(name, visited);
    const val = vars.get(name);
    return val ? origin.add(val) : origin;
  }

  // Auto-scale
  let SCALE, viewCx, viewCy, rangeRe, rangeIm;

  if (setObj.animRunning) {
    // Compute maxR for this frame
    let maxR = 0.001;
    for (const name of order) {
      const asgn = assignments.find(a => a.name === name);
      if (asgn && asgn.hidden) {
        const isAnchor = assignments.some(a2 => a2.tailOn === name && !a2.hidden && isInAnyScope(setObj, a2.name));
        if (!isAnchor) continue;
      }
      if (!(asgn && asgn.hidden) && !isInAnyScope(setObj, name)) continue;
      if (asgn && asgn.fixed && asgn.tailOn) {
        const anchorTip = getAbsTip(asgn.tailOn);
        const val = vars.get(name);
        if (val) maxR = Math.max(maxR, anchorTip.mag + val.mag);
      }
      maxR = Math.max(maxR, getOrigin(name).mag, getAbsTip(name).mag);
    }
    maxR *= 1.15;
    // Only zoom out (increase maxR), never zoom back in
    if (!setObj.animMaxR || maxR > setObj.animMaxR) {
      setObj.animMaxR = maxR;
    }
    maxR = setObj.animMaxR;
    rangeRe = maxR * 2; rangeIm = maxR * 2;
    const MARGIN = Math.max(45, Math.min(W, H) * 0.06);
    SCALE = (Math.min(W, H) - 2 * MARGIN) / (maxR * 2);
    SCALE = Math.max(SCALE, 2);
    viewCx = W / 2; viewCy = H / 2;
  } else {
    let minRe = Infinity, maxRe = -Infinity, minIm = Infinity, maxIm = -Infinity;
    let hasPoints = false;
    function expandBounds(p) {
      if (!isFinite(p.re) || !isFinite(p.im)) return;
      minRe = Math.min(minRe, p.re); maxRe = Math.max(maxRe, p.re);
      minIm = Math.min(minIm, p.im); maxIm = Math.max(maxIm, p.im);
      hasPoints = true;
    }
    expandBounds(new Phasor(0, 0));
    for (const name of order) {
      const asgn = assignments.find(a => a.name === name);
      if (!asgn || !asgn.hidden) {
        if (!isInAnyScope(setObj, name)) continue;
        expandBounds(getOrigin(name));
        expandBounds(getAbsTip(name));
      }
      if (asgn && asgn.hidden) {
        const isAnchor = assignments.some(a => a.tailOn === name && !a.hidden && isInAnyScope(setObj, a.name));
        if (isAnchor) expandBounds(getAbsTip(name));
      }
    }
    if (showSumArrows) {
      for (const asgn of assignments) {
        if (asgn.tailOn || asgn.hidden) continue;
        if ((asgn.opType === 'add' || asgn.opType === 'sub') && asgn.deps.length === 2) {
          const [dA, dB] = asgn.deps;
          expandBounds(getAbsTip(dA));
          const pB = vars.get(dB);
          if (pB) {
            if (asgn.opType === 'add') expandBounds(getAbsTip(dA).add(pB));
            else expandBounds(getAbsTip(dA).sub(pB));
          }
        }
      }
    }
    if (!hasPoints) { minRe = -1; maxRe = 1; minIm = -1; maxIm = 1; }
    // Expand bounds for circles
    for (const asgn of assignments) {
      if (!asgn._circle) continue;
      if (asgn.hidden && !assignments.some(a => a.tailOn === asgn.name && !a.hidden)) continue;
      if (!isInAnyScope(setObj, asgn.name)) continue;
      const cc = asgn._circle;
      expandBounds(new Phasor(cc.cx - cc.r, cc.cy - cc.r));
      expandBounds(new Phasor(cc.cx + cc.r, cc.cy + cc.r));
    }
    const padFrac = 0.08;
    const padRe = Math.max((maxRe - minRe) * padFrac, 0.01);
    const padIm = Math.max((maxIm - minIm) * padFrac, 0.01);
    minRe -= padRe; maxRe += padRe; minIm -= padIm; maxIm += padIm;
    rangeRe = maxRe - minRe; rangeIm = maxIm - minIm;
    const centerRe = (minRe + maxRe) / 2, centerIm = (minIm + maxIm) / 2;
    const MARGIN = Math.max(45, Math.min(W, H) * 0.06);
    const availW = W - 2 * MARGIN, availH = H - 2 * MARGIN;
    if (rangeRe < 0.0001 && rangeIm < 0.0001) SCALE = 200;
    else if (rangeRe < 0.0001) SCALE = availH / rangeIm;
    else if (rangeIm < 0.0001) SCALE = availW / rangeRe;
    else SCALE = Math.min(availW / rangeRe, availH / rangeIm);
    SCALE = Math.max(SCALE, 2);
    viewCx = W / 2 - centerRe * SCALE;
    viewCy = H / 2 + centerIm * SCALE;
  }

  // Store auto-computed view for reset reference
  const autoScale = SCALE, autoCx = viewCx, autoCy = viewCy;

  // Apply manual zoom/pan override if set (fullscreen mode)
  if (setObj._fsManualView) {
    const mv = setObj._fsManualView;
    SCALE = autoScale * mv.zoom;
    viewCx = autoCx * mv.zoom + mv.panX;
    viewCy = autoCy * mv.zoom + mv.panY;
  }

  // Determine if this draw is targeting the main (interactive) canvas
  // We only track tip positions and store view state for drag hit-testing on the main canvas
  const isMainCanvas = !targetCanvas || targetCanvas === setObj.phasorCanvas;
  if (isMainCanvas) {
    setObj._viewState = { SCALE, viewCx, viewCy };
    setObj._tipMap = new Map();
  }

  ctx.clearRect(0, 0, W, H);

  // Scale UI elements based on canvas size (larger in fullscreen)
  const fontScale = Math.max(1, Math.min(W, H) / 580);
  const axFontSize = Math.round(10 * fontScale);
  const scaleFontSize = Math.round(9 * fontScale);
  const arrowLw = 2.4 * fontScale;
  const tailArrowLw = 2.0 * fontScale;

  // Grid
  const gridStep = SCALE / 5;
  if (gridStep > 3) {
    ctx.strokeStyle = 'rgba(148,163,184,0.10)'; ctx.lineWidth = 0.5;
    const gStartX = ((viewCx % gridStep) + gridStep) % gridStep;
    for (let x = gStartX; x < W; x += gridStep) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    const gStartY = ((viewCy % gridStep) + gridStep) % gridStep;
    for (let y = gStartY; y < H; y += gridStep) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  }

  // Axes
  ctx.strokeStyle = 'rgba(100,116,139,0.3)'; ctx.lineWidth = 1;
  if (viewCy > 0 && viewCy < H) { ctx.beginPath(); ctx.moveTo(0, viewCy); ctx.lineTo(W, viewCy); ctx.stroke(); lineSegs.push({x1:0,y1:viewCy,x2:W,y2:viewCy}); }
  if (viewCx > 0 && viewCx < W) { ctx.beginPath(); ctx.moveTo(viewCx, 0); ctx.lineTo(viewCx, H); ctx.stroke(); lineSegs.push({x1:viewCx,y1:0,x2:viewCx,y2:H}); }

  ctx.fillStyle = 'rgba(100,116,139,0.4)'; ctx.font = `400 ${axFontSize}px "IBM Plex Mono", monospace`;
  if (viewCy > 10 && viewCy < H - 10) { ctx.textAlign = 'left'; ctx.fillText('Re', W - 25, Math.min(viewCy - 8, H - 14)); }
  if (viewCx > 10 && viewCx < W - 10) { ctx.textAlign = 'center'; ctx.fillText('Im', Math.max(viewCx + 16, 20), 14); }

  // Scale indicator
  const maxRange = Math.max(rangeRe, rangeIm, 0.001);
  const scaleUnit = maxRange > 4 ? Math.round(maxRange / 4) : parseFloat((maxRange / 4).toPrecision(2));
  if (scaleUnit > 0) {
    const scalePx = scaleUnit * SCALE;
    ctx.fillStyle = 'rgba(100,116,139,0.35)'; ctx.font = `400 ${scaleFontSize}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'left'; ctx.fillText(scaleUnit.toPrecision(3) + ' pu', 14 + scalePx + 6, H - 16);
    ctx.strokeStyle = 'rgba(100,116,139,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(14, H-16); ctx.lineTo(14 + scalePx, H-16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14, H-19); ctx.lineTo(14, H-13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14+scalePx, H-19); ctx.lineTo(14+scalePx, H-13); ctx.stroke();
  }

  function toCanvas(p) { return { x: viewCx + p.re * SCALE, y: viewCy - p.im * SCALE }; }

  // Draw circles (mho characteristics, zone boundaries)
  for (const asgn of assignments) {
    if (!asgn._circle) continue;
    if (asgn.hidden && !assignments.some(a => a.tailOn === asgn.name && !a.hidden)) continue;
    if (!isInAnyScope(setObj, asgn.name)) continue;
    const cc = asgn._circle;
    const cx = viewCx + cc.cx * SCALE;
    const cy = viewCy - cc.cy * SCALE;
    const cr = cc.r * SCALE;
    if (cr < 0.5) continue;
    const c = colorMap.get(asgn.name) || '#64748b';
    // Filled background
    ctx.save();
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.06;
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Stroke
    ctx.save();
    ctx.strokeStyle = c;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.8 * fontScale;
    ctx.setLineDash([6 * fontScale, 4 * fontScale]);
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Label at top of circle
    const labelX = cx, labelY = cy - cr - 8 * fontScale;
    ctx.save();
    ctx.fillStyle = c; ctx.globalAlpha = 0.8;
    ctx.font = `500 ${Math.round(11 * fontScale)}px "IBM Plex Mono", monospace`; ctx.textAlign = 'center';
    ctx.fillText(asgn.name, labelX, labelY);
    ctx.restore();
  }

  // Sum chain arrows
  if (showSumArrows) {
    for (const asgn of assignments) {
      if (asgn.tailOn) continue;
      if (!isInAnyScope(setObj, asgn.name)) continue;
      if (asgn.opType === 'add' && asgn.deps.length === 2) {
        const [dA, dB] = asgn.deps;
        const tipA = toCanvas(getAbsTip(dA));
        const tipAB = toCanvas(getAbsTip(dA).add(vars.get(dB)));
        drawArrow(ctx, tipA.x, tipA.y, tipAB.x, tipAB.y, colorMap.get(dB), 1.5, true, lineSegs);
      }
      if (asgn.opType === 'sub' && asgn.deps.length === 2) {
        const [dA, dB] = asgn.deps;
        const tipA = toCanvas(getAbsTip(dA));
        const result = toCanvas(getAbsTip(dA).sub(vars.get(dB)));
        drawArrow(ctx, tipA.x, tipA.y, result.x, result.y, colorMap.get(dB), 1.5, true, lineSegs);
      }
    }
  }

  // Projections
  if (showProjections) {
    for (const asgn of assignments) {
      if (asgn.tailOn) continue;
      if (!isInAnyScope(setObj, asgn.name)) continue;
      if (asgn.opType === 'sub' && asgn.deps.length === 2) {
        const [dA, dB] = asgn.deps;
        const pA = vars.get(dA), pB = vars.get(dB);
        if (pA && pB && pA.mag > 0.001 && pB.mag > 0.001) {
          const tipA = toCanvas(getAbsTip(dA));
          const tipR = toCanvas(getAbsTip(dA).sub(pB));
          const dropRe = -pB.re, dropIm = -pB.im;
          const aAng = pA.ang;
          const cosA = Math.cos(aAng), sinA = Math.sin(aAng);
          const inPhase = dropRe * cosA + dropIm * sinA;
          const ipEnd = { x: tipA.x + inPhase * SCALE * cosA, y: tipA.y - inPhase * SCALE * sinA };
          drawDashed(ctx, tipA.x, tipA.y, ipEnd.x, ipEnd.y, colorMap.get(dB), 0.35, lineSegs);
          drawDashed(ctx, ipEnd.x, ipEnd.y, tipR.x, tipR.y, colorMap.get(dB), 0.2, lineSegs);
        }
      }
    }
  }

  // Draw phasor arrows
  const fontSize = Math.round(11 * fontScale);
  const FONT = `600 ${fontSize}px "IBM Plex Mono", monospace`;

  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const p = vars.get(name);
    const c = colorMap.get(name);
    const asgn = assignments.find(a => a.name === name);
    if (asgn && asgn.hidden) continue;
    if (!isInAnyScope(setObj, name)) continue;

    const originPhasor = getOrigin(name);
    const originPt = toCanvas(originPhasor);
    const tipPhasor = originPhasor.add(p);
    const tipPt = toCanvas(tipPhasor);
    const len = Math.hypot(tipPt.x - originPt.x, tipPt.y - originPt.y);

    if (asgn && asgn.isDot) {
      // Draw as a filled dot at the tip position
      const dotR = 5 * fontScale;
      ctx.save();
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(tipPt.x, tipPt.y, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * fontScale;
      ctx.beginPath(); ctx.arc(tipPt.x, tipPt.y, dotR, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else {
      if (len < 2) continue;

      // Record tip for drag interaction (base variables only, main canvas only)
      if (isMainCanvas && asgn && asgn.deps.length === 0) {
        setObj._tipMap.set(name, { tipX: tipPt.x, tipY: tipPt.y, originX: originPt.x, originY: originPt.y });
      }

      const lw = (asgn && asgn.tailOn) ? tailArrowLw : arrowLw;
      drawArrow(ctx, originPt.x, originPt.y, tipPt.x, tipPt.y, c, lw, false, lineSegs);

      if (asgn && asgn.tailOn) {
        ctx.save(); ctx.fillStyle = c; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(originPt.x, originPt.y, 3 * fontScale, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Drag handle: white-filled circle at tip for base variables (hidden during animation)
      if (isMainCanvas && !setObj.animRunning && asgn && asgn.deps.length === 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.8 * fontScale;
        ctx.beginPath();
        ctx.arc(tipPt.x, tipPt.y, 5.5 * fontScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    let labelText = name;
    if (setObj.showValues) {
      labelText = name + ' = ' + p.mag.toFixed(2) + '∠' + p.angDeg.toFixed(1) + '°';
    }

    if (asgn && asgn.isDot) {
      // Label near the dot
      drawLabel(ctx, labelText, tipPt.x + 10 * fontScale, tipPt.y - 10 * fontScale, c, FONT);
    } else if (setObj.animRunning) {
      const mx = (originPt.x + tipPt.x) / 2, my = (originPt.y + tipPt.y) / 2;
      const adx = tipPt.x - originPt.x, ady = tipPt.y - originPt.y;
      const alen = Math.hypot(adx, ady) || 1;
      const perpX = -ady / alen, perpY = adx / alen;
      const side = p.im >= 0 ? -1 : 1;
      const lx = mx + perpX * 20 * fontScale * side, ly = my + perpY * 20 * fontScale * side;
      drawLabel(ctx, labelText, lx, ly, c, FONT);
    } else {
      const side = p.im >= 0 ? -1 : 1;
      const cands = arrowCandidates(originPt.x, originPt.y, tipPt.x, tipPt.y, side);
      const pos = placeLabel(labelText, cands, FONT, 6, placedLabels, lineSegs, ctx, W, H);
      if (pos) drawLabel(ctx, labelText, pos.x, pos.y, c, FONT);
    }
  }
}

// ====================================================
// TRIPLE PHASOR CANVAS DRAW
// ====================================================
export function drawTriplePhasorCanvases(setObj, vars, order, assignments, colorMap) {
  for (let d = 1; d <= 3; d++) {
    const canvas = setObj.tripleCanvases[d - 1];
    // Filter: include phasors assigned to this diagram (d1/d2/d3) or unassigned (diagram=0)
    const filteredAssignments = assignments.filter(a => a.diagram === d || a.diagram === 0);
    const filteredOrder = order.filter(name => {
      const asgn = filteredAssignments.find(a => a.name === name);
      return asgn !== undefined || !assignments.find(a => a.name === name); // keep built-in vars
    });
    drawPhasorCanvas(setObj, vars, filteredOrder, filteredAssignments, colorMap, canvas);
  }
}
