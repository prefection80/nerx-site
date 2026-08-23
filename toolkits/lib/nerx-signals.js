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

    /* ---------- log scale (for TCC / spectrum axes) ---------- */
    const logScale = (min, max, px0, px1) => {
      const l0 = Math.log10(min), l1 = Math.log10(max), span = (l1 - l0) || 1;
      return {
        min, max,
        toPx: v => px0 + (Math.log10(v) - l0) / span * (px1 - px0),
        fromPx: x => Math.pow(10, l0 + (x - px0) / (px1 - px0) * span),
        ticks() { const out = []; for (let d = Math.floor(l0); d <= Math.ceil(l1); d++) for (let m = 1; m <= 9; m++) { const v = m * Math.pow(10, d); if (v >= min * 0.999 && v <= max * 1.001) out.push({ v, major: m === 1 }); } return out; },
      };
    };

    /* ---------- overcurrent time-current curves ---------- */
    // IEEE C37.112: t = TD·(A/(Mᵖ−1) + B).  IEC 60255: t = TD·A/(Mᵖ−1) (B=0).  M = I/Ipickup.
    const OC_CURVES = {
      'IEEE-MI': { A: 0.0515, B: 0.1140, p: 0.02 }, 'IEEE-VI': { A: 19.61, B: 0.491, p: 2.0 }, 'IEEE-EI': { A: 28.2, B: 0.1217, p: 2.0 },
      'IEC-SI': { A: 0.14, B: 0, p: 0.02 }, 'IEC-VI': { A: 13.5, B: 0, p: 1.0 }, 'IEC-EI': { A: 80, B: 0, p: 2.0 },
    };
    const ocTime = (curve, M, TD) => { const k = OC_CURVES[curve] || OC_CURVES['IEEE-MI']; return M <= 1.0001 ? Infinity : (TD == null ? 1 : TD) * (k.A / (Math.pow(M, k.p) - 1) + k.B); };

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
      logScale, ocTime, OC_CURVES,
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

  const D = NS.draw;          // shorthand for the plot components below

  /* ======================================================================
   *  Impedance — R–X plane with distance zones + a live impedance point
   * ==================================================================== */
  NS.Impedance = function (canvas, cfg) {
    cfg = cfg || {}; const cal = C, TAU = C.TAU, D2R = C.D2R;
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const ox = cfg.origin ? cfg.origin[0] : W * 0.44;
      const oy = cfg.origin ? cfg.origin[1] : H * 0.62;
      const s = cfg.scale || (Math.min(W, H) * 0.34 / (cfg.range || 1));   // px per pu/ohm
      const grid = cfg.grid || '#c9d4dd', mut = cfg.muted || '#5a6b78';
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(16, oy); ctx.lineTo(W - 12, oy); ctx.moveTo(ox, 12); ctx.lineTo(ox, H - 12); ctx.stroke();
      D.label(ctx, 'R', W - 20, oy + 13, mut, 13, true); D.label(ctx, 'X', ox + 11, 18, mut, 13, true);
      const zones = typeof cfg.zones === 'function' ? cfg.zones() : (cfg.zones || []);
      zones.forEach(z => {
        const col = z.color || cal.SEQ.pos, mta = (z.angle == null ? 75 : z.angle) * D2R;
        ctx.strokeStyle = col; ctx.lineWidth = z.w || 2; ctx.setLineDash(z.dash || []); ctx.globalAlpha = z.alpha || 1;
        if (z.type === 'quad') {
          const X = z.reach * s, Rr = (z.rRight != null ? z.rRight : z.reach * 0.8) * s, Rl = (z.rLeft != null ? z.rLeft : -z.reach * 0.2) * s;
          const tilt = Math.tan((90 - (z.angle == null ? 75 : z.angle)) * D2R);
          ctx.beginPath(); ctx.moveTo(ox + Rl, oy); ctx.lineTo(ox + Rr, oy);
          ctx.lineTo(ox + Rr - X * tilt, oy - X); ctx.lineTo(ox + Rl - X * tilt, oy - X); ctx.closePath(); ctx.stroke();
        } else {   // mho circle through the origin, diameter along the MTA
          const d = z.reach * s, ccx = ox + Math.cos(mta) * d / 2, ccy = oy - Math.sin(mta) * d / 2;
          ctx.beginPath(); ctx.arc(ccx, ccy, d / 2, 0, TAU); ctx.stroke();
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (z.label) D.label(ctx, z.label, ox + Math.cos(mta) * z.reach * s * 0.62, oy - Math.sin(mta) * z.reach * s * 0.62, col, 12, true);
      });
      const pt = typeof cfg.point === 'function' ? cfg.point(t) : cfg.point;
      if (pt) {
        const r = pt.re != null ? pt.re : pt.r, x = pt.im != null ? pt.im : pt.x;
        const px = ox + r * s, py = oy - x * s;
        if (cfg.trail) { cfg._tr = cfg._tr || []; cfg._tr.push([px, py]); if (cfg._tr.length > (cfg.trailLen || 140)) cfg._tr.shift();
          ctx.strokeStyle = cfg.trailColor || cal.SEQ.neg; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.6; ctx.beginPath(); cfg._tr.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.globalAlpha = 1; }
        ctx.strokeStyle = mut; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = cfg.pointColor || cal.SEQ.neg; ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fill();
        if (cfg.pointLabel) D.label(ctx, cfg.pointLabel, px + 9, py - 3, cfg.pointColor || cal.SEQ.neg, 13, true);
      }
    }
    return { draw, config: cfg };
  };

  /* ======================================================================
   *  Coordination — log-log time-current curves with a fault sweep
   * ==================================================================== */
  NS.Coordination = function (canvas, cfg) {
    cfg = cfg || {}; const cal = C;
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height, x0 = 56, x1 = W - 14, y0 = 14, y1 = H - 34;
      const Ix = cal.logScale(cfg.iMin || 100, cfg.iMax || 100000, x0, x1);
      const Ty = cal.logScale(cfg.tMin || 0.01, cfg.tMax || 100, y1, y0);   // t grows upward
      const grid = cfg.grid || '#dbe3ea', mut = cfg.muted || '#5a6b78';
      ctx.lineWidth = 1;
      Ix.ticks().forEach(tk => { const x = Ix.toPx(tk.v); ctx.strokeStyle = grid; ctx.globalAlpha = tk.major ? 0.9 : 0.3; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); if (tk.major) { ctx.globalAlpha = 1; D.label(ctx, tk.v >= 1000 ? (tk.v / 1000) + 'k' : '' + tk.v, x, y1 + 12, mut, 10.5, false, 'center'); } });
      Ty.ticks().forEach(tk => { const y = Ty.toPx(tk.v); ctx.strokeStyle = grid; ctx.globalAlpha = tk.major ? 0.9 : 0.3; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); if (tk.major) { ctx.globalAlpha = 1; D.label(ctx, tk.v < 1 ? tk.v.toFixed(2) : '' + tk.v, x0 - 6, y, mut, 10.5, false, 'right'); } });
      ctx.globalAlpha = 1;
      D.label(ctx, 'Current (A)', (x0 + x1) / 2, H - 6, mut, 12, true, 'center');
      const devs = typeof cfg.devices === 'function' ? cfg.devices() : (cfg.devices || []);
      devs.forEach(dv => {
        ctx.strokeStyle = dv.color || cal.SEQ.pos; ctx.lineWidth = dv.w || 2.4; ctx.beginPath(); let go = false, lastPx = 0, lastPy = 0;
        for (let px = x0; px <= x1; px += 2) { const I = Ix.fromPx(px), tt = dv.curve(I); if (tt == null || !isFinite(tt) || tt > (cfg.tMax || 100) || tt < (cfg.tMin || 0.01)) { go = false; continue; } const py = Ty.toPx(tt); go ? ctx.lineTo(px, py) : ctx.moveTo(px, py); go = true; lastPx = px; lastPy = py; }
        ctx.stroke(); if (dv.label && lastPy) D.label(ctx, dv.label, Math.min(lastPx + 6, x1 - 40), lastPy, dv.color || cal.SEQ.pos, 12, true);
      });
      if (cfg.faultCurrent) { const If = typeof cfg.faultCurrent === 'function' ? cfg.faultCurrent(t) : cfg.faultCurrent; const x = Ix.toPx(If);
        ctx.strokeStyle = cfg.faultColor || cal.SEQ.neg; ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]);
        D.label(ctx, 'fault ' + (If >= 1000 ? (If / 1000).toFixed(1) + ' kA' : If + ' A'), x + 6, y0 + 9, cfg.faultColor || cal.SEQ.neg, 12, true); }
    }
    return { draw, config: cfg };
  };

  /* ======================================================================
   *  Stability — power-angle curve + equal-area criterion
   * ==================================================================== */
  NS.Stability = function (canvas, cfg) {
    cfg = cfg || {}; const cal = C, TAU = C.TAU;
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height, x0 = 40, x1 = W - 14, y0 = 16, y1 = H - 32;
      const dmax = Math.PI, Pmax = cfg.pmax || 1.8, Pf = cfg.pmaxFault != null ? cfg.pmaxFault : 0.5, Pp = cfg.pmaxPost != null ? cfg.pmaxPost : 1.5, Pm = cfg.pm || 1.0;
      const px = d => x0 + d / dmax * (x1 - x0), py = p => y1 - p / (Pmax * 1.05) * (y1 - y0);
      const grid = cfg.grid || '#dbe3ea', mut = cfg.muted || '#5a6b78';
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
      [0, 45, 90, 135, 180].forEach(deg => { const x = px(deg * C.D2R); D.label(ctx, deg + '°', x, y1 + 12, mut, 10.5, false, 'center'); });
      D.label(ctx, 'P', x0 - 2, y0 + 4, mut, 13, true, 'right'); D.label(ctx, 'δ', x1, y1 + 12, mut, 13, true, 'right');
      const d0 = Math.asin(Math.min(0.999, Pm / Pmax));
      const dc = cfg.clearAngle != null ? cfg.clearAngle : 1.15;              // clearing angle (rad)
      const dmx = Math.PI - Math.asin(Math.min(0.999, Pm / Pp));              // far post-fault crossing
      // accelerating area: Pm above the fault curve, δ0→δc
      ctx.fillStyle = cal.SEQ.neg; ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.moveTo(px(d0), py(Pm));
      for (let d = d0; d <= dc; d += 0.01) ctx.lineTo(px(d), py(Pm)); for (let d = dc; d >= d0; d -= 0.01) ctx.lineTo(px(d), py(Pf * Math.sin(d))); ctx.closePath(); ctx.fill();
      // decelerating area: post curve above Pm, δc→δmax
      ctx.fillStyle = cal.SEQ.zero; ctx.beginPath(); ctx.moveTo(px(dc), py(Pm));
      for (let d = dc; d <= dmx; d += 0.01) ctx.lineTo(px(d), py(Pp * Math.sin(d))); for (let d = dmx; d >= dc; d -= 0.01) ctx.lineTo(px(d), py(Pm)); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      const curve = (Pk, col, dash) => { ctx.strokeStyle = col; ctx.setLineDash(dash || []); ctx.lineWidth = 2.2; ctx.beginPath(); for (let d = 0; d <= dmax; d += 0.02) { const X = px(d), Y = py(Pk * Math.sin(d)); d ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke(); ctx.setLineDash([]); };
      curve(Pmax, cal.SEQ.pos); curve(Pf, cal.SEQ.neg, [6, 4]); curve(Pp, cal.SEQ.zero, [2, 4]);
      ctx.strokeStyle = mut; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, py(Pm)); ctx.lineTo(x1, py(Pm)); ctx.stroke(); ctx.setLineDash([]);
      D.label(ctx, 'Pₘ', x1 - 6, py(Pm) - 9, mut, 12, true, 'right');
      // swinging operating point: δ0 → δc (fault) → δmx → back, looping
      const swing = typeof cfg.swing === 'function' ? cfg.swing(t) : (function () { const T = cfg.period || 4, u = (t % T) / T; return u < 0.5 ? d0 + (dmx - d0) * (u * 2) : dmx - (dmx - d0) * ((u - 0.5) * 2); })();
      const onCurve = swing < dc ? Pf * Math.sin(swing) : Pp * Math.sin(swing);
      ctx.fillStyle = '#0f1c26'; ctx.beginPath(); ctx.arc(px(swing), py(onCurve), 5, 0, TAU); ctx.fill();
      D.label(ctx, 'accel', px((d0 + dc) / 2), py(Pm) + 12, cal.SEQ.neg, 11, true, 'center');
      D.label(ctx, 'decel', px((dc + dmx) / 2), py(Pm) - 14, cal.SEQ.zero, 11, true, 'center');
    }
    return { draw, config: cfg };
  };

  /* ======================================================================
   *  Spectrum — harmonic bar chart, optionally linked to its waveform
   * ==================================================================== */
  NS.Spectrum = function (canvas, cfg) {
    cfg = cfg || {}; const cal = C, TAU = C.TAU, D2R = C.D2R;
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const harm = typeof cfg.harmonics === 'function' ? cfg.harmonics() : (cfg.harmonics || []);
      const grid = cfg.grid || '#dbe3ea', mut = cfg.muted || '#5a6b78';
      const splitY = cfg.showWave === false ? 0 : Math.round(H * 0.44);
      const fund = harm.find(h => h.n === 1), base = fund ? Math.abs(fund.mag) : (Math.max(1e-9, ...harm.map(h => Math.abs(h.mag || 0))));
      if (cfg.showWave !== false) {
        const wx0 = 12, wx1 = W - 12, midY = splitY * 0.5 + 6, amp = splitY * 0.5 - 14, cyc = cfg.cycles || 2;
        ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(wx0, midY); ctx.lineTo(wx1, midY); ctx.stroke();
        const norm = harm.reduce((s, h) => s + Math.abs(h.mag || 0), 0) || 1;
        const scroll = cfg.scroll === false ? 0 : t * TAU * 0.25;
        ctx.strokeStyle = cfg.waveColor || cal.SEQ.pos; ctx.lineWidth = 2.3; ctx.beginPath();
        for (let x = wx0; x <= wx1; x += 2) { const ph = (x - wx0) / (wx1 - wx0) * cyc * TAU; let v = 0; harm.forEach(h => v += (h.mag || 0) * Math.sin((h.n || 1) * (ph + scroll) + (h.ang || 0) * D2R)); const y = midY - v / norm * amp; x === wx0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.stroke();
      }
      const bx0 = 44, bx1 = W - 14, by0 = splitY + 16, by1 = H - 26, maxN = cfg.maxOrder || Math.max(9, ...harm.map(h => h.n || 1));
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx0, by1); ctx.lineTo(bx1, by1); ctx.moveTo(bx0, by0); ctx.lineTo(bx0, by1); ctx.stroke();
      const bw = (bx1 - bx0) / (maxN + 0.5), full = cfg.fullScalePct || 100;
      for (let n = 1; n <= maxN; n++) {
        const h = harm.find(x => x.n === n), pctv = h ? Math.abs(h.mag) / base * 100 : 0, x = bx0 + (n - 0.5) * bw;
        const barH = Math.max(0, Math.min(1, pctv / full)) * (by1 - by0);
        ctx.fillStyle = n === 1 ? (cfg.fundColor || cal.SEQ.pos) : (cfg.harmColor || cal.SEQ.neg);
        ctx.fillRect(x - bw * 0.32, by1 - barH, bw * 0.64, barH);
        D.label(ctx, '' + n, x, by1 + 12, mut, 10.5, false, 'center');
      }
      const mags = []; harm.forEach(h => (mags[h.n] = cal.cx(Math.abs(h.mag || 0), 0))); for (let i = 0; i <= maxN; i++) mags[i] = mags[i] || cal.cx(0, 0);
      D.label(ctx, 'THD = ' + cal.thd(mags).toFixed(1) + '%', bx1, by0 + 4, mut, 13, true, 'right');
      D.label(ctx, 'harmonic order', (bx0 + bx1) / 2, H - 6, mut, 12, true, 'center');
    }
    return { draw, config: cfg };
  };

  /* ======================================================================
   *  OneLine — schematic one-line with animated power/current flow
   * ==================================================================== */
  NS.OneLine = function (canvas, cfg) {
    cfg = cfg || {}; const cal = C, TAU = C.TAU;
    function sym(ctx, n, ink, mut) {
      ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 2;
      if (n.type === 'bus') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(n.x - (n.w || 40), n.y); ctx.lineTo(n.x + (n.w || 40), n.y); ctx.stroke(); }
      else if (n.type === 'source') { ctx.beginPath(); ctx.arc(n.x, n.y, 15, 0, TAU); ctx.stroke(); D.label(ctx, '∼', n.x, n.y, ink, 20, true, 'center'); }
      else if (n.type === 'xfmr') { ctx.beginPath(); ctx.arc(n.x, n.y - 9, 12, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(n.x, n.y + 9, 12, 0, TAU); ctx.stroke(); }
      else if (n.type === 'load') { ctx.beginPath(); ctx.moveTo(n.x - 10, n.y); ctx.lineTo(n.x + 10, n.y); ctx.lineTo(n.x, n.y + 17); ctx.closePath(); ctx.stroke(); }
      else if (n.type === 'breaker') { ctx.strokeRect(n.x - 7, n.y - 7, 14, 14); }
      if (n.label) D.label(ctx, n.label, n.x + (n.lx != null ? n.lx : 24), n.y + (n.ly || 0), mut, 12.5, true);
    }
    function draw(ctx, t) {
      const nodes = cfg.nodes || {}, edges = typeof cfg.edges === 'function' ? cfg.edges() : (cfg.edges || []);
      const ink = cfg.ink || '#0f1c26', mut = cfg.muted || '#5a6b78';
      edges.forEach(e => {
        const a = nodes[e.from], b = nodes[e.to]; if (!a || !b) return;
        ctx.strokeStyle = e.color || ink; ctx.lineWidth = e.w || (2 + Math.min(4, Math.abs(e.flow || 0) * 1.4));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const flow = e.flow || 0;
        if (flow !== 0) {
          const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, dir = Math.sign(flow);
          const spacing = 22, off = ((t * (cfg.flowSpeed || 46)) % spacing);
          ctx.fillStyle = e.flowColor || cal.SEQ.pos;
          for (let d = off; d < len - 4; d += spacing) { const dd = dir > 0 ? d : (len - d); const x = a.x + ux * dd, y = a.y + uy * dd; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill(); }
        }
      });
      Object.keys(nodes).forEach(id => sym(ctx, nodes[id], ink, mut));
    }
    return { draw, config: cfg };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
  root.NS = NS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
