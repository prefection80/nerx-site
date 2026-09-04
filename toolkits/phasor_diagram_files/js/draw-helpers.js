// ====================================================
// DRAW HELPERS — stateless canvas drawing primitives
// Source: phasor_diagram.html lines 3891–3909, 3925–4006, 3092–3098
// Exports: drawArrow, drawLabel, drawDashed, measureText, placeLabel, arrowCandidates,
//          isInAnyScope
// Imports: none
// Note: isInAnyScope lives here (not set-dom.js) to break the circular dependency
//       set-dom.js → fullscreen-canvas.js → set-dom.js.
// ====================================================

// Helper: check if name is visible in any scope traceSet on a setObj
export function isInAnyScope(setObj, name) {
  for (const scope of setObj.scopes) {
    if (scope.traceSet.has(name)) return true;
  }
  return false;
}


export function drawArrow(ctx, fx, fy, tx, ty, color, lw, dashed, segs) {
  const dx=tx-fx, dy=ty-fy, len=Math.hypot(dx,dy);
  if(len<1) return;
  ctx.save();
  ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=lw; ctx.lineCap='round';
  if(dashed) ctx.setLineDash([6,4]);
  ctx.beginPath(); ctx.moveTo(fx,fy); ctx.lineTo(tx,ty); ctx.stroke();
  ctx.setLineDash([]);
  const hl=Math.min(11,len*0.3), a=Math.atan2(dy,dx);
  ctx.beginPath(); ctx.moveTo(tx,ty);
  ctx.lineTo(tx-hl*Math.cos(a-0.35),ty-hl*Math.sin(a-0.35));
  ctx.lineTo(tx-hl*Math.cos(a+0.35),ty-hl*Math.sin(a+0.35));
  ctx.closePath(); ctx.fill();
  ctx.restore();
  if(segs) segs.push({x1:fx,y1:fy,x2:tx,y2:ty});
}

export function drawLabel(ctx, text, x, y, color, font) {
  ctx.save(); ctx.fillStyle=color; ctx.font=font;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text,x,y); ctx.restore();
}

export function drawDashed(ctx, x1,y1,x2,y2,color,alpha,segs) {
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=1;
  ctx.setLineDash([4,4]); ctx.globalAlpha=alpha||0.3;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.restore();
  if(segs) segs.push({x1,y1,x2,y2});
}

export function measureText(ctx, text, font) {
  ctx.save(); ctx.font = font;
  const m = ctx.measureText(text);
  ctx.restore();
  const sizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
  const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 11;
  return { w: m.width + 4, h: fontSize * 1.3 };
}

export function placeLabel(text, candidates, font, lineMargin, placedLabels, lineSegs, ctx, W, H) {
  const LPAD = 5;
  const sz = measureText(ctx, text, font);
  lineMargin = lineMargin || 8;

  function rectsOverlap(a, b) {
    return !(a.x+a.w < b.x-LPAD || b.x+b.w < a.x-LPAD || a.y+a.h < b.y-LPAD || b.y+b.h < a.y-LPAD);
  }
  function ptSegDist(px,py,x1,y1,x2,y2) {
    const dx=x2-x1,dy=y2-y1,lsq=dx*dx+dy*dy;
    if(!lsq) return Math.hypot(px-x1,py-y1);
    let t=((px-x1)*dx+(py-y1)*dy)/lsq;
    t=Math.max(0,Math.min(1,t));
    return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
  }
  function oob(r) { return r.x<4||r.y<4||r.x+r.w>W-4||r.y+r.h>H-4; }

  function scorePos(c) {
    const r = { x:c.x-sz.w/2, y:c.y-sz.h/2, w:sz.w, h:sz.h };
    if (oob(r)) return 99999;
    if (placedLabels.some(p => rectsOverlap(r,p))) return 99998;
    let score = 0;
    for (const p of placedLabels) {
      const dist = Math.hypot(r.x+r.w/2-p.x-p.w/2, r.y+r.h/2-p.y-p.h/2);
      if (dist < 60) score += (60 - dist) * 2;
    }
    for (const s of lineSegs) {
      const d = ptSegDist(r.x+r.w/2, r.y+r.h/2, s.x1, s.y1, s.x2, s.y2);
      if (d < lineMargin) score += (lineMargin - d) * 10;
      else if (d < lineMargin * 2) score += (lineMargin * 2 - d) * 2;
    }
    score += (c.priority || 0);
    return score;
  }

  let bestC = null, bestScore = Infinity;
  for (const c of candidates) {
    const s = scorePos(c);
    if (s < bestScore) { bestScore = s; bestC = c; }
  }
  if (bestC && bestScore < 99998) {
    placedLabels.push({ x:bestC.x-sz.w/2, y:bestC.y-sz.h/2, w:sz.w, h:sz.h });
    return bestC;
  }
  // Fallback
  if (candidates.length > 0) {
    const fb = candidates[0];
    placedLabels.push({ x:fb.x-sz.w/2, y:fb.y-sz.h/2, w:sz.w, h:sz.h });
    return fb;
  }
  return null;
}

export function arrowCandidates(fx, fy, tx, ty, side) {
  const dx=tx-fx, dy=ty-fy, len=Math.hypot(dx,dy);
  if (len<1) return [{x:tx+14,y:ty-10,priority:0}];
  const ux=dx/len, uy=dy/len, px=-uy, py=ux;
  const s = side||1;
  const cands = [];
  for (const frac of [0.5, 0.65, 0.35, 0.8, 0.2]) {
    const mx = fx+dx*frac, my = fy+dy*frac;
    for (const d of [16, 22, 30, 40]) {
      cands.push({ x: mx+px*d*s, y: my+py*d*s, priority: d*0.3 + Math.abs(frac-0.5)*20 });
      cands.push({ x: mx-px*d*s, y: my-py*d*s, priority: d*0.3 + 10 + Math.abs(frac-0.5)*20 });
    }
  }
  for (const d of [14, 20, 28]) {
    cands.push({ x: tx+ux*d+px*6*s, y: ty+uy*d+py*6*s, priority: 5 });
    cands.push({ x: tx+ux*d, y: ty+uy*d, priority: 3 });
  }
  return cands;
}
