// ====================================================
// DRAW SCOPE — oscilloscope canvas renderer
// Source: phasor_diagram.html lines 4731–4822
// Exports: drawScopeCanvas, drawSingleScope
// Imports: none (all context passed as parameters)
// ====================================================

export function drawScopeCanvas(setObj, vars, order, assignments, colorMap) {
  for (const scope of setObj.scopes) {
    drawSingleScope(scope, vars, colorMap);
  }
}

export function drawSingleScope(scope, vars, colorMap, targetCanvas) {
  const sCanvas = targetCanvas || scope.canvas;
  const sCtx = sCanvas.getContext('2d');
  const SW = sCanvas.width, SH = sCanvas.height;

  sCtx.clearRect(0, 0, SW, SH);
  sCtx.fillStyle = '#ffffff'; sCtx.fillRect(0, 0, SW, SH);

  const scopeScale = Math.max(1, Math.min(SW, SH) / 580);
  const padL = Math.round(50 * scopeScale), padR = Math.round(16 * scopeScale);
  const padT = Math.round(14 * scopeScale), padB = Math.round(22 * scopeScale);
  const plotW = SW - padL - padR, plotH = SH - padT - padB;
  const SQRT2 = Math.SQRT2;
  const scopeFontSm = Math.round(9 * scopeScale);

  let yMax = 0;
  for (const name of scope.traceSet) {
    const p = vars.get(name);
    if (p) yMax = Math.max(yMax, p.mag * SQRT2);
  }
  if (yMax < 0.001) yMax = 1;
  yMax *= 1.15;

  // Grid
  sCtx.strokeStyle = 'rgba(148,163,184,0.15)'; sCtx.lineWidth = 0.5 * scopeScale;
  for (let i = -4; i <= 4; i++) {
    const y = padT + plotH / 2 - (i / 4) * (plotH / 2);
    sCtx.beginPath(); sCtx.moveTo(padL, y); sCtx.lineTo(padL + plotW, y); sCtx.stroke();
  }
  for (let deg = 0; deg <= 360; deg += 45) {
    const x = padL + (deg / 360) * plotW;
    sCtx.beginPath(); sCtx.moveTo(x, padT); sCtx.lineTo(x, padT + plotH); sCtx.stroke();
  }

  const zeroY = padT + plotH / 2;
  sCtx.strokeStyle = 'rgba(100,116,139,0.35)'; sCtx.lineWidth = 1 * scopeScale;
  sCtx.beginPath(); sCtx.moveTo(padL, zeroY); sCtx.lineTo(padL + plotW, zeroY); sCtx.stroke();

  sCtx.fillStyle = 'rgba(100,116,139,0.5)'; sCtx.font = `400 ${scopeFontSm}px "IBM Plex Mono", monospace`;
  sCtx.textAlign = 'right'; sCtx.textBaseline = 'middle';
  sCtx.fillText('+' + yMax.toPrecision(2) + 'pk', padL - 4, padT + 4);
  sCtx.fillText('0', padL - 4, zeroY);
  sCtx.fillText('-' + yMax.toPrecision(2) + 'pk', padL - 4, padT + plotH - 4);

  sCtx.textAlign = 'center'; sCtx.textBaseline = 'top';
  for (let deg = 0; deg <= 360; deg += 90) {
    sCtx.fillText(deg + '°', padL + (deg / 360) * plotW, padT + plotH + 4);
  }

  const NPTS = 400;
  for (const name of scope.traceSet) {
    const p = vars.get(name);
    if (!p) continue;
    const c = colorMap.get(name);
    const peak = p.mag * SQRT2;
    const phi = p.ang;
    sCtx.save(); sCtx.strokeStyle = c; sCtx.lineWidth = 1.8 * scopeScale; sCtx.lineJoin = 'round';
    sCtx.beginPath();
    for (let i = 0; i <= NPTS; i++) {
      const t = (i / NPTS) * 2 * Math.PI;
      const val = peak * Math.cos(t + phi);
      const x = padL + (i / NPTS) * plotW;
      const y = zeroY - (val / yMax) * (plotH / 2);
      if (i === 0) sCtx.moveTo(x, y); else sCtx.lineTo(x, y);
    }
    sCtx.stroke(); sCtx.restore();
  }

  // Sweep line
  sCtx.strokeStyle = 'rgba(220,38,38,0.4)'; sCtx.lineWidth = 1 * scopeScale;
  sCtx.setLineDash([3 * scopeScale, 3 * scopeScale]);
  sCtx.beginPath(); sCtx.moveTo(padL, padT); sCtx.lineTo(padL, padT + plotH); sCtx.stroke();
  sCtx.setLineDash([]);

  for (const name of scope.traceSet) {
    const p = vars.get(name);
    if (!p) continue;
    const val = p.re * SQRT2;
    const y = zeroY - (val / yMax) * (plotH / 2);
    sCtx.fillStyle = colorMap.get(name);
    sCtx.beginPath(); sCtx.arc(padL, y, 4 * scopeScale, 0, Math.PI * 2); sCtx.fill();
  }
}
