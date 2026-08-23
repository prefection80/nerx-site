/* ============================================================================
 * nerx-signals.js — common power-engineering calculations, phasor animation,
 * and oscillography for NERX training toolkits.
 *
 * One global: NS = { calc, draw, Phasor, Scope, mount }.  No dependencies.
 * Works as a browser <script> (window.NS) or a Node module (require).
 *
 * calc  — complex math, symmetrical components, per-unit, three-phase power,
 *         fault currents & duty, impedance/lines, transformers, signal analysis.
 * draw  — stateless one-frame canvas primitives (ported from lib/power.js).
 * Phasor/Scope — animated components.   mount — a tiny RAF + controls runtime.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = {};

  /* ======================================================================
   *  calc — the background calculations
   * ==================================================================== */
  NS.calc = (function () {
    const TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI;

    /* ---------- complex (a bare number is a pure reactance: 5 → j5) ---------- */
    const cx = (re, im) => ({ re: re || 0, im: im || 0 });
    const j = x => ({ re: 0, im: x || 0 });
    const polar = (mag, deg) => ({ re: mag * Math.cos(deg * D2R), im: mag * Math.sin(deg * D2R) });
    const Z = z => (typeof z === 'number' ? j(z) : (z || cx(0, 0)));
    const add = (...v) => v.reduce((s, z) => cx(s.re + Z(z).re, s.im + Z(z).im), cx(0, 0));
    const sub = (a, b) => cx(Z(a).re - Z(b).re, Z(a).im - Z(b).im);
    const mul = (a, b) => { const x = Z(a), y = Z(b); return cx(x.re * y.re - x.im * y.im, x.re * y.im + x.im * y.re); };
    const div = (a, b) => { const x = Z(a), y = Z(b), d = y.re * y.re + y.im * y.im || 1e-12; return cx((x.re * y.re + x.im * y.im) / d, (x.im * y.re - x.re * y.im) / d); };
    const neg = a => cx(-Z(a).re, -Z(a).im);
    const conj = a => cx(Z(a).re, -Z(a).im);
    const scale = (a, k) => cx(Z(a).re * k, Z(a).im * k);
    const abs = a => Math.hypot(Z(a).re, Z(a).im);
    const ang = a => Math.atan2(Z(a).im, Z(a).re) * R2D;                 // degrees, −180…180
    const rot = (a, deg) => mul(a, polar(1, deg));                       // rotate a phasor
    const par = (a, b) => div(mul(a, b), add(a, b));                     // two impedances in parallel

    /* ---------- symmetrical components ---------- */
    const A = polar(1, 120), A2 = polar(1, 240);
    const toSeq = (a, b, c) => [                                          // [zero, positive, negative]
      scale(add(a, b, c), 1 / 3),
      scale(add(a, mul(A, b), mul(A2, c)), 1 / 3),
      scale(add(a, mul(A2, b), mul(A, c)), 1 / 3),
    ];
    const toPhase = (v0, v1, v2) => [                                     // [a, b, c]
      add(v0, v1, v2),
      add(v0, mul(A2, v1), mul(A, v2)),
      add(v0, mul(A, v1), mul(A2, v2)),
    ];
    /** Unbalance: negative- and zero-sequence as a % of positive (V₂/V₁, V₀/V₁). */
    const unbalance = (a, b, c) => { const s = toSeq(a, b, c), p = abs(s[1]) || 1e-12;
      return { neg: abs(s[2]) / p * 100, zero: abs(s[0]) / p * 100 }; };

    /* ---------- per-unit & base ---------- */
    const base = (mva, kvLL) => ({ ib: (mva * 1e6) / (Math.sqrt(3) * kvLL * 1e3), zb: (kvLL * kvLL) / mva });
    const amps = (pu, ib) => pu * ib;
    const toPu = (ohms, zb) => scale(ohms, 1 / zb);
    const toOhms = (pu, zb) => scale(pu, zb);
    const pctZtoPu = pct => pct / 100;                                    // %Z is already pu×100 on the device base
    /** Move a pu impedance from an old MVA/kV base to a new one. */
    const changeBase = (zpu, mvaOld, kvOld, mvaNew, kvNew) =>
      scale(zpu, (mvaNew / mvaOld) * (kvOld * kvOld) / (kvNew * kvNew));

    /* ---------- three-phase power ---------- */
    const complexPower = (v, i) => mul(v, conj(i));                       // S = V·I*  (per-phase or per-unit)
    /** Three-phase power from line-to-line volts, line amps and power factor. */
    const power3ph = (vll, il, pf) => {
      const s = Math.sqrt(3) * vll * il, p = s * pf, q = Math.sqrt(Math.max(0, s * s - p * p));
      return { s, p, q, pf };
    };
    const pf = s => Math.abs(Z(s).re) / (abs(s) || 1e-12);

    /* ---------- shunt faults (Thevenin sequence impedances at a bus) ----------
       opts { z1, z2, z0, zf, zn, e, mva, kv | ib }.  Reference: z1=z2=j0.1, z0=j0.05
       → threePhase 10.0 · ll 8.66 · slg 12.0 pu. */
    function faults(opts) {
      const o = opts || {};
      const z1 = Z(o.z1 == null ? 0.1 : o.z1), z2 = Z(o.z2 == null ? o.z1 : o.z2), z0 = Z(o.z0 == null ? 0.05 : o.z0);
      const zf = Z(o.zf || 0), zn = Z(o.zn || 0), e = o.e == null ? cx(1, 0) : Z(o.e);
      const ib = o.mva && o.kv ? base(o.mva, o.kv).ib : (o.ib || 0);
      const z0g = add(z0, scale(zn, 3));
      const wrap = (i0, i1, i2) => {
        const p = toPhase(i0, i1, i2), mag = Math.max(abs(p[0]), abs(p[1]), abs(p[2]));
        return { seq: { i0, i1, i2 }, phase: { a: p[0], b: p[1], c: p[2] }, ig: scale(i0, 3), mag, amps: ib ? mag * ib : null };
      };
      const i1_3p = div(e, add(z1, zf));
      const i_slg = div(e, add(z1, z2, z0g, scale(zf, 3)));
      const i1_ll = div(e, add(z1, z2, zf));
      const zsum = add(z2, zf), zgnd = add(z0g, zf);
      const i1_2lg = div(e, add(z1, zf, par(zsum, zgnd)));
      const i2_2lg = neg(mul(i1_2lg, div(zgnd, add(zsum, zgnd))));
      const i0_2lg = neg(mul(i1_2lg, div(zsum, add(zsum, zgnd))));
      return {
        base: ib ? { ib } : null,
        threePhase: wrap(cx(0, 0), i1_3p, cx(0, 0)),
        slg: wrap(i_slg, i_slg, i_slg),
        ll: wrap(cx(0, 0), i1_ll, neg(i1_ll)),
        llg: wrap(i0_2lg, i1_2lg, i2_2lg),
      };
    }
    const faultMVA = (ipu, mva) => ipu * mva;                            // short-circuit MVA on a base

    /* ---------- short-circuit duty (DC offset / asymmetry) ---------- */
    const xr = z => Math.abs(Z(z).im) / (Math.abs(Z(z).re) || 1e-9);     // X/R
    const dcDecay = (xrr, cycles) => Math.exp(-TAU * cycles / xrr);       // DC component at t cycles
    const peakFactor = xrr => Math.SQRT2 * (1 + Math.exp(-Math.PI / xrr));// first-peak crest multiplier
    const rmsAsymFactor = xrr => Math.sqrt(1 + 2 * Math.exp(-TAU / xrr)); // first-cycle rms multiplier

    /* ---------- impedance & lines ---------- */
    const series = (...zs) => add(...zs);
    const parallel = (...zs) => zs.reduce((acc, z) => acc == null ? Z(z) : par(acc, z), null);
    /** A line segment: series Z = R+jX, total shunt admittance Y = jB (charging). */
    const line = ({ r = 0, x = 0, b = 0 }) => ({ z: cx(r, x), y: cx(0, b) });

    /* ---------- transformers ---------- */
    const vectorShift = hour => -30 * hour;                              // positive-seq clock-hour shift, degrees
    /** Zero-sequence path of a two-winding bank for an LG fault on the LV bus.
        Returns the verdict the bank-decides toolkit reads off I₀. */
    function xfmrZeroSeq(hv, lv, zn, core) {
      let passes = false, sourcesLV = false;
      if (lv === 'Wye-G') {
        if (hv === 'Wye-G') { passes = true; sourcesLV = true; }
        else if (hv === 'Delta') sourcesLV = true;                       // delta grounds it locally
        else if (core === '3-Legged') sourcesLV = true;                  // phantom via the tank
      }
      const i0hv = passes, i0lv = sourcesLV;
      let verdict = 'BLOCKS';
      if (i0hv && i0lv) verdict = 'PASSES';
      else if (i0lv) verdict = (hv === 'Wye' && core === '3-Legged') ? 'PHANTOM SOURCE' : 'GROUND SOURCE';
      else if (hv === 'Wye-G' && lv === 'Delta') verdict = 'BLOCKS HERE · SOURCES HV';
      return { passesToHV: i0hv, sourcesGroundLV: i0lv, verdict };
    }

    /* ---------- signal analysis ---------- */
    /** Single-frequency phasor from evenly-spaced samples (one-bin DFT). fs = sample rate. */
    function phasorOf(samples, f, fs) {
      const N = samples.length; let re = 0, im = 0;
      for (let n = 0; n < N; n++) { const th = TAU * f * n / fs; re += samples[n] * Math.cos(th); im -= samples[n] * Math.sin(th); }
      return cx((2 / N) * re, (2 / N) * im);
    }
    /** A time-domain waveform (t → value): sinusoid + optional decaying DC + harmonics. */
    function waveform({ mag = 1, ang = 0, f = 60, dc = 0, tau = 0.05, harmonics = [] }) {
      return t => {
        let v = mag * Math.sin(TAU * f * t + ang * D2R) + dc * Math.exp(-t / tau);
        for (const h of harmonics) v += (h.mag || 0) * Math.sin(TAU * f * (h.n || 1) * t + (h.ang || 0) * D2R);
        return v;
      };
    }
    const rms = samples => Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / (samples.length || 1));
    const thd = harmonics => { const h1 = abs(harmonics[1]) || 1e-12; let s = 0;
      for (let n = 2; n < harmonics.length; n++) s += abs(harmonics[n]) ** 2; return Math.sqrt(s) / h1 * 100; };

    /* ---------- formatting & palette ---------- */
    const fmt = (v, d) => (+v).toFixed(d == null ? 2 : d);
    const fmtC = (z, d) => fmt(abs(z), d) + ' ∠ ' + (Math.round(ang(z) * 10) / 10) + '°';
    const fmtA = a => Math.round(a).toLocaleString('en-US') + ' A';
    const fmtPu = (v, d) => fmt(v, d == null ? 2 : d) + ' pu';
    const fmtDeg = a => (Math.round(a * 10) / 10) + '°';
    const SEQ = { pos: '#2e7dd1', neg: '#c9482f', zero: '#6a8f2f', ref: '#9aa8b4', a: '#2e7dd1', b: '#c9482f', c: '#6a8f2f' };
    const seqColor = k => SEQ[k] || SEQ.ref;

    return {
      TAU, D2R, R2D,
      cx, j, polar, Z, add, sub, mul, div, neg, conj, scale, abs, ang, rot, par,
      A, A2, toSeq, toPhase, unbalance,
      base, amps, toPu, toOhms, pctZtoPu, changeBase,
      complexPower, power3ph, pf,
      faults, faultMVA,
      xr, dcDecay, peakFactor, rmsAsymFactor,
      series, parallel, line,
      vectorShift, xfmrZeroSeq,
      phasorOf, waveform, rms, thd,
      fmt, fmtC, fmtA, fmtPu, fmtDeg, SEQ, seqColor,
    };
  })();

  const C = NS.calc;

  /* ======================================================================
   *  draw — stateless one-frame canvas primitives (ported from power.js)
   * ==================================================================== */
  NS.draw = (function () {
    const D2R = C.D2R, TAU = C.TAU, SEQ = C.SEQ, abs = C.abs, ang = C.ang;

    /** Arrow from (ox,oy) to a point mag·scale away at `deg` (screen y flipped: 0°→right, 90°→up). */
    function phasor(ctx, ox, oy, mag, deg, opt) {
      const o = opt || {}, s = o.scale == null ? 1 : o.scale, w = o.w || 3, col = o.color || SEQ.pos;
      const x = ox + mag * s * Math.cos(deg * D2R), y = oy - mag * s * Math.sin(deg * D2R);
      const len = Math.hypot(x - ox, y - oy), head = Math.min(o.head || 13, len * 0.4);
      ctx.save();
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
      if (o.dash) ctx.setLineDash(o.dash);
      if (len > 0.5) {
        const ux = (x - ox) / len, uy = (y - oy) / len;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(x - ux * head * 0.85, y - uy * head * 0.85); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x - ux * head + uy * head * 0.42, y - uy * head - ux * head * 0.42);
        ctx.lineTo(x - ux * head - uy * head * 0.42, y - uy * head + ux * head * 0.42);
        ctx.closePath(); ctx.fill();
      }
      if (o.label) {
        const gap = o.labelGap || 17, dx = x - ox, dy = y - oy, dl = Math.hypot(dx, dy) || 1;
        ctx.setLineDash([]); ctx.font = (o.labelSize || 15) + 'px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(o.label, x + (dx / dl) * gap, y + (dy / dl) * gap);
      }
      ctx.restore();
      return { x, y };
    }

    /** Three phasors from three complex values. */
    function triad(ctx, ox, oy, v, opt) {
      const o = opt || {}, names = o.names || ['a', 'b', 'c'], cols = o.colors || [SEQ.a, SEQ.b, SEQ.c];
      v.forEach((z, i) => phasor(ctx, ox, oy, abs(z), ang(z) + (o.rotate || 0), {
        scale: o.scale, color: cols[i % cols.length], w: o.w, label: o.labels === false ? null : names[i], labelSize: o.labelSize,
      }));
    }

    /** Faint reference circle + axes. */
    function refCircle(ctx, ox, oy, r, opt) {
      const o = opt || {};
      ctx.save();
      ctx.strokeStyle = o.color || SEQ.ref; ctx.globalAlpha = o.alpha == null ? 0.35 : o.alpha; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(ox - r, oy); ctx.lineTo(ox + r, oy); ctx.moveTo(ox, oy - r); ctx.lineTo(ox, oy + r); ctx.stroke();
      ctx.restore();
    }

    /** One cycle-locked sine trace: the waveform a rotating phasor projects. */
    function wave(ctx, x, y, w, h, mag, deg, opt) {
      const o = opt || {}, cyc = o.cycles || 2;
      ctx.save();
      ctx.strokeStyle = o.color || SEQ.pos; ctx.lineWidth = o.w || 2.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const th = (i / w) * cyc * 360 + deg, py = y + h / 2 - Math.sin(th * D2R) * mag * (h / 2);
        i ? ctx.lineTo(x + i, py) : ctx.moveTo(x + i, py);
      }
      ctx.stroke();
      if (o.axis !== false) { ctx.globalAlpha = 0.3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke(); }
      ctx.restore();
    }

    function label(ctx, txt, x, y, col, size, bold, align) {
      ctx.save(); ctx.fillStyle = col || '#5a6b78';
      ctx.font = (bold ? '600 ' : '') + (size || 14) + 'px "Segoe UI",system-ui,sans-serif';
      ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y); ctx.restore();
    }

    /** The ground symbol every sequence-network drawing needs. */
    function ground(ctx, x, y, opt) {
      const o = opt || {}, w = o.w || 26;
      ctx.save();
      ctx.strokeStyle = o.color || '#7d8da0'; ctx.lineWidth = o.lw || 2; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) { const k = w * (1 - i * 0.32); ctx.beginPath(); ctx.moveTo(x - k / 2, y + i * 5); ctx.lineTo(x + k / 2, y + i * 5); ctx.stroke(); }
      ctx.restore();
    }

    return { phasor, triad, refCircle, wave, label, ground };
  })();

  /* ======================================================================
   *  Phasor — animated phasor diagram, with optional waveform projection
   * ==================================================================== */
  NS.Phasor = function (canvas, cfg) {
    cfg = cfg || {};
    const D = NS.draw, cal = C, TAU = C.TAU, D2R = C.D2R;
    const state = { locus: [] };
    const resolve = () => (typeof cfg.phasors === 'function' ? cfg.phasors() : (cfg.phasors || []));
    function draw(ctx, t) {
      const ph = resolve();
      const ox = (cfg.origin && cfg.origin[0]) || 150;
      const oy = (cfg.origin && cfg.origin[1]) || (ctx.canvas.height / 2);
      const R = cfg.radius || 100;
      const maxMag = Math.max(1e-6, ...ph.map(p => (p.mag != null ? p.mag : cal.abs(p)) || 0));
      const s = (cfg.scale == null || cfg.scale === 'fit') ? R / maxMag : cfg.scale;
      let rotDeg = 0;
      if (cfg.rotate) rotDeg = (cfg.rotate === 'cw' ? -1 : 1) * (cfg.freq || 0.25) * 360 * t;

      if (cfg.refCircle !== false) D.refCircle(ctx, ox, oy, R, { alpha: 0.3 });

      const wf = cfg.waveform, grid = cfg.grid || '#c9d4dd';
      let wx0, wxR, kx;
      if (wf === 'right' || wf === true) {
        wx0 = ox + R + 42; wxR = ctx.canvas.width - 18; kx = TAU / (cfg.wavePixels || 150);
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(wx0, oy); ctx.lineTo(wxR, oy); ctx.stroke();
        for (let x = wx0 + (cfg.wavePixels || 150); x < wxR; x += (cfg.wavePixels || 150)) { ctx.beginPath(); ctx.moveTo(x, oy - R - 6); ctx.lineTo(x, oy + R + 6); ctx.stroke(); }
      }

      ph.forEach((p, i) => {
        const mag = p.mag != null ? p.mag : cal.abs(p);
        const deg = (p.ang != null ? p.ang : cal.ang(p)) + rotDeg;
        const col = p.color || cal.seqColor(['a', 'b', 'c'][i] || 'pos');
        const th = deg * D2R;
        if (wf) {
          ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath();
          for (let x = wx0; x <= wxR; x += 2) { const y = oy - mag * s * Math.cos(th - (x - wx0) * kx); x === wx0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
          ctx.stroke();
          const tipx = ox + mag * s * Math.cos(th), tipy = oy - mag * s * Math.sin(th), py = oy - mag * s * Math.cos(th);
          ctx.setLineDash([4, 4]); ctx.lineWidth = 1.1; ctx.strokeStyle = col;
          ctx.beginPath(); ctx.moveTo(tipx, tipy); ctx.lineTo(wx0, py); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(wx0, py, 3.2, 0, TAU); ctx.fill();
        }
        D.phasor(ctx, ox, oy, mag, deg, { scale: s, color: col, label: p.label, w: p.w || 3 });
      });

      if (cfg.locus && ph[0]) {
        const p0 = ph[0], mag = p0.mag != null ? p0.mag : cal.abs(p0), deg = (p0.ang != null ? p0.ang : cal.ang(p0)) + rotDeg;
        state.locus.push([ox + mag * s * Math.cos(deg * D2R), oy - mag * s * Math.sin(deg * D2R)]);
        if (state.locus.length > 90) state.locus.shift();
        ctx.strokeStyle = p0.color || cal.SEQ.pos; ctx.globalAlpha = 0.25; ctx.lineWidth = 1.5; ctx.beginPath();
        state.locus.forEach((pt, k) => k ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    return { draw, config: cfg };
  };

  /* ======================================================================
   *  Scope — multi-channel oscillography strip
   * ==================================================================== */
  NS.Scope = function (canvas, cfg) {
    cfg = cfg || {};
    const D = NS.draw;
    const resolveCh = () => (typeof cfg.channels === 'function' ? cfg.channels() : (cfg.channels || []));
    function draw(ctx, t) {
      const chans = resolveCh();
      const X = (cfg.rect && cfg.rect[0]) || 0, Y = (cfg.rect && cfg.rect[1]) || 0;
      const W = (cfg.rect && cfg.rect[2]) || ctx.canvas.width, H = (cfg.rect && cfg.rect[3]) || ctx.canvas.height;
      const xL = X + 74, xR = X + W - 18, top = Y + 20, bot = Y + H - 26;
      const win = cfg.window || 0.25, f = cfg.freq || 60, n = chans.length || 1, rowH = (bot - top) / n;
      const grid = cfg.grid || '#c9d4dd', mut = cfg.muted || '#5a6b78';
      const t0 = cfg.motion === 'scroll' ? Math.max(0, t - win) : 0;
      const timeAt = x => t0 + (x - xL) / (xR - xL) * win;
      const xAt = tt => xL + (tt - t0) / win * (xR - xL);

      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      for (let k = 0; k / f <= win + 1e-9; k++) { const x = xAt(t0 + Math.ceil(t0 * f) / f + k / f); if (x >= xL - 0.5 && x <= xR + 0.5) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke(); } }

      const phaseSignals = chans.filter(c => !c.derived && c.signal).map(c => c.signal);
      const sigOf = c => c.derived === 'residual' ? (tt => phaseSignals.reduce((s, fn) => s + fn(tt), 0)) : c.signal;

      let sweepX = xR;
      if (cfg.motion === 'sweep') { const period = cfg.sweepPeriod || win * 5; sweepX = xL + (xR - xL) * Math.min(1, (t % period) / (period * 0.82)); }

      if (cfg.trigger != null && cfg.trigger !== false) {
        const xf = xAt(cfg.trigger);
        if (xf >= xL && xf <= xR) { ctx.setLineDash([6, 5]); ctx.strokeStyle = '#b06e00'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(xf, top - 2); ctx.lineTo(xf, bot + 2); ctx.stroke(); ctx.setLineDash([]); D.label(ctx, 'fault', xf + 6, top + 7, '#b06e00', 12.5); }
      }

      chans.forEach((c, i) => {
        const y0 = top + rowH * (i + 0.5);
        ctx.strokeStyle = '#dfe6ec'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xL, y0); ctx.lineTo(xR, y0); ctx.stroke();
        D.label(ctx, c.name || ('ch' + i), xL - 12, y0, c.color || C.SEQ.pos, 15, true, 'right');
        const fn = sigOf(c); if (!fn) return;
        const amp = rowH * 0.42 * (cfg.gain || 1);
        ctx.strokeStyle = c.color || C.SEQ.pos; ctx.lineWidth = 2.3; ctx.beginPath(); let first = true;
        for (let x = xL; x <= Math.min(sweepX, xR); x += 2) { const yy = y0 - amp * fn(timeAt(x)); first ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); first = false; }
        ctx.stroke();
        if (cfg.markers) { ctx.fillStyle = c.color || C.SEQ.pos; for (let k = 0; k / (cfg.sampleRate || 16) <= win; k++) { const tt = t0 + k / (cfg.sampleRate || 16); const x = xAt(tt); if (x <= Math.min(sweepX, xR)) { ctx.beginPath(); ctx.arc(x, y0 - amp * fn(tt), 1.8, 0, C.TAU); ctx.fill(); } } }
      });

      if (cfg.motion === 'sweep') { ctx.strokeStyle = '#e8930c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sweepX, top - 2); ctx.lineTo(sweepX, bot + 2); ctx.stroke(); }
      D.label(ctx, (win * 1000).toFixed(0) + ' ms · ' + f + ' Hz · grid = 1 cycle', xR, bot + 15, mut, 12.5, false, 'right');
    }
    return { draw, config: cfg };
  };

  /* ======================================================================
   *  mount — a tiny standalone runtime: RAF loop, canvas fit, controls
   * ==================================================================== */
  NS.mount = function (canvasSel, controlsSel, cfg) {
    cfg = cfg || {};
    const canvas = typeof canvasSel === 'string' ? document.querySelector(canvasSel) : canvasSel;
    const controls = controlsSel ? (typeof controlsSel === 'string' ? document.querySelector(controlsSel) : controlsSel) : null;
    const ctx = canvas.getContext('2d');
    const p = {}, params = cfg.params || {};

    if (controls && Object.keys(params).length) {
      controls.innerHTML = '';
      Object.keys(params).forEach(key => {
        const spec = params[key]; p[key] = spec.value;
        const wrap = document.createElement('label'); wrap.className = 'ns-ctrl';
        const lab = document.createElement('span'); lab.className = 'ns-lab'; lab.textContent = spec.label || key; wrap.appendChild(lab);
        if (spec.choices) {
          const sel = document.createElement('select');
          spec.choices.forEach(ch => { const o = document.createElement('option'); o.value = o.textContent = ch; sel.appendChild(o); });
          sel.value = spec.value; sel.onchange = () => { p[key] = sel.value; }; wrap.appendChild(sel);
        } else {
          const inp = document.createElement('input'); inp.type = 'range';
          inp.min = spec.min; inp.max = spec.max; inp.step = spec.step || 0.01; inp.value = spec.value;
          const out = document.createElement('span'); out.className = 'ns-val'; out.textContent = spec.value;
          inp.oninput = () => { p[key] = parseFloat(inp.value); out.textContent = inp.value; };
          wrap.appendChild(inp); wrap.appendChild(out);
        }
        controls.appendChild(wrap);
      });
    } else { Object.keys(params).forEach(k => (p[k] = params[k].value)); }

    function fit() {
      const cssW = canvas.clientWidth || cfg.width || 900;
      const aspect = cfg.aspect || 0.4;
      canvas.width = Math.round(cssW); canvas.height = Math.round(cssW * aspect);
    }
    fit(); addEventListener('resize', fit);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t0 = null; const speed = cfg.speed || 1;
    function frame(ts) {
      if (t0 == null) t0 = ts; const t = (ts - t0) / 1000 * speed;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      try { cfg.view(ctx, reduce ? 1.0 : t, p, canvas.width, canvas.height); } catch (e) { console.error(e); }
      if (!reduce) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return { p, canvas, ctx, fit };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
  root.NS = NS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
