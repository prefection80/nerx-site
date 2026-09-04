/* ============================================================================
 * nerx-signals.js — common power-engineering calculations, phasor animation,
 * and oscillography for NERX training toolkits.
 *
 * One global, no dependencies.  Browser <script> (window.NS) or Node require().
 *
 *   NS = { calc, draw, mount,
 *          Phasor, Scope, Impedance, Coordination, Stability, Spectrum, OneLine }
 *
 * calc  — complex math, symmetrical components, per-unit, three-phase power,
 *         fault currents & duty, impedance/lines, transformers, signal analysis,
 *         time-current curves.
 * draw  — stateless one-frame canvas primitives (ported from lib/power.js).
 * The seven components are NS.Xxx(cfg) → { draw(ctx, t), config }.
 * mount — a tiny RAF + canvas-fit + controls runtime.
 *
 * Tests: node test-nerx-signals.js
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
    /** P, Q, S and the angle from magnitudes and a power factor. `lead` flips the sign of Q. */
    const pqs = (v, i, pfv, lead) => {
      const c = Math.min(1, Math.abs(pfv == null ? 1 : pfv));
      const phi = Math.acos(c) * (lead ? -1 : 1), s = (v == null ? 1 : v) * (i == null ? 1 : i);
      return { s, p: s * Math.cos(phi), q: s * Math.sin(phi), phi: phi * R2D, pf: c, lead: !!lead };
    };
    /** p(t) = v(t)·i(t) for a sinusoidal pair given as rms magnitudes.
        Averages to P, ripples at 2f, and goes negative for part of every cycle whenever pf < 1. */
    const instPower = o => {
      const c = o || {}, v = c.v == null ? 1 : c.v, i = c.i == null ? 1 : c.i, f = c.f || 60;
      const ph = pqs(v, i, c.pf, c.lead).phi * D2R;
      return t => 2 * v * i * Math.sin(TAU * f * t) * Math.sin(TAU * f * t - ph);
    };

    /* ---------- shunt faults (Thevenin sequence impedances at a bus) ----------
       opts { z1, z2, z0, zf, zn, e, mva, kv | ib }.  Reference: z1=z2=j0.1, z0=j0.05
       → threePhase 10.0 · ll 8.66 · slg 12.0 pu. */
    function faults(opts) {
      const o = opts || {};
      const z1 = Z(o.z1 == null ? 0.1 : o.z1);
      const z2 = Z(o.z2 == null ? z1 : o.z2);                            // default Z₂ to the *resolved* Z₁
      const z0 = Z(o.z0 == null ? 0.05 : o.z0);
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
    const peakFactor = xrr => Math.SQRT2 * (1 + Math.exp(-Math.PI / xrr));// crest multiplier at the ½-cycle peak
    const rmsAsymFactor = xrr => Math.sqrt(1 + 2 * Math.exp(-TAU / xrr)); // ANSI rms asymmetry multiplier at ½ cycle

    /* ---------- impedance & lines ---------- */
    const series = (...zs) => add(...zs);
    const parallel = (...zs) => zs.reduce((acc, z) => acc == null ? Z(z) : par(acc, z), null);
    /** A line segment: series Z = R+jX, total shunt admittance Y = jB (charging). */
    const line = ({ r = 0, x = 0, b = 0 }) => ({ z: cx(r, x), y: cx(0, b) });

    /* ---------- transformers ---------- */
    const vectorShift = hour => -30 * hour;                              // positive-seq clock-hour shift, degrees
    /** Zero-sequence path of a two-winding bank for an LG fault on the LV bus.
        Returns the verdict the bank-decides toolkit reads off I₀. */
    function xfmrZeroSeq(hv, lv, core) {
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

    /* ---------- CTs, relays & protection ---------- */
    /** CT turns ratio from the nameplate: ctRatio(1200, 5) = 240. */
    const ctRatio = (pri, sec) => pri / (sec || 5);
    /** Secondary amps for a primary current. */
    const ctSecondary = (ipri, ratio) => ipri / (ratio || 1);
    /** ANSI accuracy class → terminal volts and the standard burden it implies.
        The class is defined at 20× rated secondary, so 'C400' on a 5 A CT is 400 V into 4 Ω. */
    const ctClass = (cls, sec) => {
      const volts = parseFloat(String(cls).replace(/[^\d.]/g, '')) || 0, at = 20 * (sec || 5);
      return { volts, at, burden: at ? volts / at : 0 };
    };
    /** Secondary volts the CT must develop: Vs = Is·(Rct + Rlead + Zrelay). */
    const ctBurdenVolts = (isec, b) => { const o = b || {}; return isec * ((o.rct || 0) + (o.rlead || 0) + (o.zrelay || 0)); };
    /** Will the CT ride through the fault?  IEEE C37.110 saturation factor and time to saturation.
        opts { ifault | isec, ratio, rct, rlead, zrelay, vk, xr, remanence, freq }.
        tSat = Infinity means it never saturates; 0 means it saturates on the symmetrical wave alone. */
    function ctSaturation(opts) {
      const o = opts || {}, f = o.freq || 60, ratio = o.ratio || 1;
      const isec = o.isec != null ? o.isec : (o.ifault || 0) / ratio;
      const vs = ctBurdenVolts(isec, o);
      const vk = (o.vk || 0) * (1 - (o.remanence || 0));                // remanent flux eats the knee
      const ks = vs > 0 ? vk / vs : Infinity;                           // saturation factor
      const T1 = (o.xr || 0) / (TAU * f);                               // dc time constant, seconds
      let tSat = Infinity;
      if (ks <= 1) tSat = 0;
      else if (o.xr > 0) { const q = (ks - 1) / o.xr; if (q < 1) tSat = -T1 * Math.log(1 - q); }
      return { isec, vs, vk, ks, T1, tSat, cycles: isFinite(tSat) ? tSat * f : Infinity, saturates: isFinite(tSat) };
    }

    /** Primary ohms → relay secondary ohms: Zsec = Zpri · CTratio / PTratio. */
    const zSecondary = (zpri, ct, pt) => scale(Z(zpri), (ct || 1) / (pt || 1));
    const zPrimary = (zsec, ct, pt) => scale(Z(zsec), (pt || 1) / (ct || 1));
    /** Residual compensation factor k₀ = (Z₀ − Z₁) / 3Z₁. */
    const k0 = (z1, z0) => div(sub(Z(z0), Z(z1)), scale(Z(z1), 3));
    /** Ground-distance loop: Z = Va / (Ia + k₀·3I₀). */
    const apparentZground = (va, ia, k, ig) => div(Z(va), add(Z(ia), mul(Z(k), Z(ig))));
    /** Phase-distance loop: Z = (Va − Vb) / (Ia − Ib). */
    const apparentZphase = (va, vb, ia, ib) => div(sub(Z(va), Z(vb)), sub(Z(ia), Z(ib)));
    /** Directional element: torque ∝ |V|·|I|·cos(∠V − ∠I − MTA); forward when positive. */
    const directional = (v, i, mta) => {
      const th = ang(v) - ang(i) - (mta == null ? 60 : mta);
      const wrapped = ((th % 360) + 540) % 360 - 180;
      const torque = abs(v) * abs(i) * Math.cos(th * D2R);
      return { angle: wrapped, torque, forward: torque > 0 };
    };

    /* ---------- signal analysis ---------- */
    /** Single-frequency phasor from evenly-spaced samples (one-bin DFT). fs = sample rate.
        Sine reference, so it round-trips with waveform(): x = M·sin(ωt+φ) → M∠φ. */
    function phasorOf(samples, f, fs) {
      const N = samples.length; let re = 0, im = 0;
      for (let n = 0; n < N; n++) { const th = TAU * f * n / fs; re += samples[n] * Math.sin(th); im += samples[n] * Math.cos(th); }
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
    /** THD as a % of the fundamental.  Accepts either shape:
          order-indexed  [ , V₁, V₂, V₃ … ]  (complex or number)
          component list [ {n:1,mag:1}, {n:5,mag:0.15} … ]  — what Spectrum takes. */
    const thd = harmonics => {
      const h = harmonics || [];
      const list = h.some(x => x && x.n != null);
      const magOf = n => { if (!list) return abs(h[n]); const e = h.find(x => x && x.n === n); return e ? Math.abs(e.mag || 0) : 0; };
      const orders = list ? h.map(x => x.n) : h.map((_, i) => i);
      const h1 = magOf(1) || 1e-12; let s = 0;
      for (const n of orders) if (n >= 2) s += magOf(n) ** 2;
      return Math.sqrt(s) / h1 * 100;
    };

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
    // IEEE C37.112: t = (TD/7)·(A/(Mᵖ−1) + B), TD 0.5…15.  IEC 60255: t = TMS·A/(Mᵖ−1), B = 0.
    // `d` is the standard's dial divisor — 7 for the IEEE curves, 1 for IEC.  M = I / Ipickup.
    const OC_CURVES = {
      'IEEE-MI': { A: 0.0515, B: 0.1140, p: 0.02, d: 7 }, 'IEEE-VI': { A: 19.61, B: 0.491, p: 2.0, d: 7 }, 'IEEE-EI': { A: 28.2, B: 0.1217, p: 2.0, d: 7 },
      'IEC-SI': { A: 0.14, B: 0, p: 0.02, d: 1 }, 'IEC-VI': { A: 13.5, B: 0, p: 1.0, d: 1 }, 'IEC-EI': { A: 80, B: 0, p: 2.0, d: 1 },
    };
    const ocTime = (curve, M, TD) => { const k = OC_CURVES[curve] || OC_CURVES['IEEE-MI']; return M <= 1.0001 ? Infinity : ((TD == null ? 1 : TD) / (k.d || 1)) * (k.A / (Math.pow(M, k.p) - 1) + k.B); };

    return {
      TAU, D2R, R2D,
      cx, j, polar, Z, add, sub, mul, div, neg, conj, scale, abs, ang, rot, par,
      A, A2, toSeq, toPhase, unbalance,
      base, amps, toPu, toOhms, pctZtoPu, changeBase,
      complexPower, power3ph, pf, pqs, instPower,
      faults, faultMVA,
      xr, dcDecay, peakFactor, rmsAsymFactor,
      series, parallel, line,
      vectorShift, xfmrZeroSeq,
      ctRatio, ctSecondary, ctClass, ctBurdenVolts, ctSaturation,
      zSecondary, zPrimary, k0, apparentZground, apparentZphase, directional,
      phasorOf, waveform, rms, thd,
      logScale, ocTime, OC_CURVES,
      fmt, fmtC, fmtA, fmtPu, fmtDeg, SEQ, seqColor,
    };
  })();

  const C = NS.calc;

  /* Every component is NS.Xxx(cfg) — or NS.Xxx(canvas, cfg) if you want it bound to a canvas,
     in which case draw(t) works as well as draw(ctx, t). */
  const isCanvas = v => !!v && typeof v.getContext === 'function';
  const isCtx = v => !!v && typeof v.beginPath === 'function';
  const bindDraw = (canvas, cfg, drawFn, extra) => Object.assign({
    draw: (a, b) => (isCtx(a) ? drawFn(a, b || 0) : drawFn(canvas && canvas.getContext('2d'), a || 0)),
    config: cfg, canvas: canvas || null,
  }, extra || {});

  /* Components that plot in a meaningful coordinate space publish the transform they already
     computed, so a Callout can anchor to {r, x} or a bus name instead of to pixels. The mapping
     is captured on every draw; toPx returns null until the figure has been drawn once. */
  const mapper = state => arg => (state.map ? state.map(arg) : null);

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
      if (o.label && len > 0.5) {                                        // a collapsed phasor has nothing to label
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

    /** A labelled box for a sequence network — the building block of the connection diagrams. */
    function netBox(ctx, x, y, w, h, label, opt) {
      const o = opt || {}, col = o.color || SEQ.pos;
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = o.w || 2;
      ctx.fillStyle = o.fill || 'rgba(46,125,209,.07)';
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.font = '600 ' + (o.size || 16) + 'px "Segoe UI",system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w / 2, y + h / 2);
      ctx.restore();
    }

    /** The ground symbol every sequence-network drawing needs. */
    function ground(ctx, x, y, opt) {
      const o = opt || {}, w = o.w || 26;
      ctx.save();
      ctx.strokeStyle = o.color || '#7d8da0'; ctx.lineWidth = o.lw || 2; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) { const k = w * (1 - i * 0.32); ctx.beginPath(); ctx.moveTo(x - k / 2, y + i * 5); ctx.lineTo(x + k / 2, y + i * 5); ctx.stroke(); }
      ctx.restore();
    }

    return { phasor, triad, refCircle, wave, label, netBox, ground };
  })();

  /* ======================================================================
   *  Phasor — animated phasor diagram, with optional waveform projection
   * ==================================================================== */
  NS.Phasor = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {};
    const D = NS.draw, cal = C, TAU = C.TAU, D2R = C.D2R;
    const state = { locus: [], map: null };
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

      state.map = v => {                                                  // {mag,ang} or a complex
        const m = v.mag != null ? v.mag : cal.abs(v), d = (v.ang != null ? v.ang : cal.ang(v)) + rotDeg;
        return [ox + m * s * Math.cos(d * D2R), oy - m * s * Math.sin(d * D2R)];
      };
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
          // sine reference, so the trace starts at the arrow tip's height and the tie-line is horizontal
          for (let x = wx0; x <= wxR; x += 2) { const y = oy - mag * s * Math.sin(th - (x - wx0) * kx); x === wx0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
          ctx.stroke();
          const tipx = ox + mag * s * Math.cos(th), tipy = oy - mag * s * Math.sin(th), py = tipy;
          ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.strokeStyle = col; ctx.globalAlpha = 0.32;
          ctx.beginPath(); ctx.moveTo(tipx, tipy); ctx.lineTo(wx0, py); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(wx0, py, 3.4, 0, TAU); ctx.fill();
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
    return bindDraw(canvas, cfg, draw, { toPx: mapper(state) });
  };

  /* ======================================================================
   *  Scope — multi-channel oscillography strip
   * ==================================================================== */
  NS.Scope = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {};
    const D = NS.draw;
    const state = { peak: 0, map: null };
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
      // Auto-scale so the tallest channel fills ~80% of a row, unless an explicit gain (px per
      // unit, relative to the row) is given.  The peak is sampled finely enough not to alias the
      // carrier, and released slowly so a scrolling window doesn't make the gain breathe.
      let _peak = 1e-6; const NSAMP = 400;
      for (const c of chans) { const fn = sigOf(c); if (!fn) continue; for (let k = 0; k <= NSAMP; k++) { const v = Math.abs(fn(t0 + k / NSAMP * win)); if (v > _peak) _peak = v; } }
      state.peak = _peak > state.peak ? _peak : state.peak * 0.94 + _peak * 0.06;
      const _amp = (rowH * 0.40) * (cfg.gain != null ? cfg.gain : 1 / (state.peak || 1e-6));
      const _clip = rowH * 0.46;                                         // a mis-set gain flat-tops, it never smears across the plot

      state.map = v => {                                                  // {t, ch, v} — ch = channel index
        const row = top + rowH * ((v.ch || 0) + 0.5);
        return [xAt(v.t || 0), row - Math.max(-_clip, Math.min(_clip, _amp * (v.v || 0)))];
      };
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
        const at = tt => y0 - Math.max(-_clip, Math.min(_clip, _amp * fn(tt)));
        ctx.strokeStyle = c.color || C.SEQ.pos; ctx.lineWidth = 2.3; ctx.beginPath(); let first = true;
        for (let x = xL; x <= Math.min(sweepX, xR); x += 2) { const yy = at(timeAt(x)); first ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); first = false; }
        ctx.stroke();
        if (cfg.markers) { ctx.fillStyle = c.color || C.SEQ.pos; for (let k = 0; k / (cfg.sampleRate || 16) <= win; k++) { const tt = t0 + k / (cfg.sampleRate || 16); const x = xAt(tt); if (x <= Math.min(sweepX, xR)) { ctx.beginPath(); ctx.arc(x, at(tt), 1.8, 0, C.TAU); ctx.fill(); } } }
      });

      if (cfg.motion === 'sweep') { ctx.strokeStyle = '#e8930c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sweepX, top - 2); ctx.lineTo(sweepX, bot + 2); ctx.stroke(); }
      D.label(ctx, (win * 1000).toFixed(0) + ' ms · ' + f + ' Hz · grid = 1 cycle', xR, bot + 15, mut, 12.5, false, 'right');
    }
    return bindDraw(canvas, cfg, draw, { toPx: mapper(state) });
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
          sel.value = spec.value; sel.onchange = () => { p[key] = sel.value; redraw(); }; wrap.appendChild(sel);
        } else {
          const inp = document.createElement('input'); inp.type = 'range';
          inp.min = spec.min; inp.max = spec.max; inp.step = spec.step || 0.01; inp.value = spec.value;
          const out = document.createElement('span'); out.className = 'ns-val'; out.textContent = spec.value;
          inp.oninput = () => { p[key] = parseFloat(inp.value); out.textContent = inp.value; redraw(); };
          wrap.appendChild(inp); wrap.appendChild(out);
        }
        controls.appendChild(wrap);
      });
    } else { Object.keys(params).forEach(k => (p[k] = params[k].value)); }

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t0 = null, tNow = reduce ? 1.0 : 0; const speed = cfg.speed || 1;

    function paint() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      try { cfg.view(ctx, tNow, p, canvas.width, canvas.height); } catch (e) { console.error(e); }
    }
    // Reduced motion stops the clock, not the toolkit: controls and resizes still repaint.
    function redraw() { if (reduce) paint(); }
    function fit() {
      const cssW = canvas.clientWidth || cfg.width || 900;
      const aspect = cfg.aspect || 0.4;
      canvas.width = Math.round(cssW); canvas.height = Math.round(cssW * aspect);
      redraw();                                                          // a resize clears the canvas
    }
    function frame(ts) {
      if (t0 == null) t0 = ts; tNow = (ts - t0) / 1000 * speed;
      paint(); requestAnimationFrame(frame);
    }
    fit(); addEventListener('resize', fit);
    if (reduce) paint(); else requestAnimationFrame(frame);
    return { p, canvas, ctx, fit, redraw: paint };
  };

  const D = NS.draw;          // shorthand for the plot components below

  /* ======================================================================
   *  Impedance — R–X plane with distance zones + a live impedance point
   * ==================================================================== */
  NS.Impedance = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {}; const cal = C, TAU = C.TAU, D2R = C.D2R;
    const state = { trail: [], map: null };                               // kept here, never on the caller's config
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const zones = typeof cfg.zones === 'function' ? cfg.zones() : (cfg.zones || []);
      const pt = typeof cfg.point === 'function' ? cfg.point(t) : cfg.point;
      const _pr = pt ? (pt.re != null ? pt.re : pt.r) : 0, _px = pt ? (pt.im != null ? pt.im : pt.x) : 0;
      const maxR = Math.max(0.5, ...zones.map(z => z.reach || 0), pt ? Math.hypot(_pr, _px) * 1.05 : 0);
      const ox = cfg.origin ? cfg.origin[0] : W * 0.36;
      const oy = cfg.origin ? cfg.origin[1] : H * 0.70;
      const s = cfg.scale || (Math.min(W, H) * 0.40 / maxR);              // auto-fit the largest reach
      const grid = cfg.grid || '#c9d4dd', mut = cfg.muted || '#5a6b78';
      state.map = v => {                                                  // {r,x} or {re,im}, per unit or ohms
        const r = v.re != null ? v.re : v.r, xx = v.im != null ? v.im : v.x;
        return [ox + (r || 0) * s, oy - (xx || 0) * s];
      };
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(16, oy); ctx.lineTo(W - 12, oy); ctx.moveTo(ox, 12); ctx.lineTo(ox, H - 12); ctx.stroke();
      D.label(ctx, 'R', W - 20, oy + 14, mut, 13, true); D.label(ctx, 'X', ox + 12, 18, mut, 13, true);
      // draw largest zone first so smaller ones sit on top; shade zone 1 (smallest) faintly
      const sorted = zones.map((z, i) => ({ z, i })).sort((a, b) => (b.z.reach || 0) - (a.z.reach || 0));
      sorted.forEach(({ z }, order) => {
        const col = z.color || cal.SEQ.pos, mta = (z.angle == null ? 75 : z.angle) * D2R;
        ctx.lineWidth = z.w || 2.2; ctx.setLineDash(z.dash || []); ctx.globalAlpha = z.alpha || 1;
        if (z.type === 'quad') {
          const X = z.reach * s, Rr = (z.rRight != null ? z.rRight : z.reach * 0.8) * s, Rl = (z.rLeft != null ? z.rLeft : -z.reach * 0.2) * s;
          const tilt = Math.tan((90 - (z.angle == null ? 75 : z.angle)) * D2R);
          ctx.beginPath(); ctx.moveTo(ox + Rl, oy); ctx.lineTo(ox + Rr, oy); ctx.lineTo(ox + Rr - X * tilt, oy - X); ctx.lineTo(ox + Rl - X * tilt, oy - X); ctx.closePath();
          if (order === sorted.length - 1) { ctx.fillStyle = col; ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = z.alpha || 1; }
          ctx.strokeStyle = col; ctx.stroke();
        } else {
          const d = z.reach * s, ccx = ox + Math.cos(mta) * d / 2, ccy = oy - Math.sin(mta) * d / 2;
          ctx.beginPath(); ctx.arc(ccx, ccy, d / 2, 0, TAU);
          if (order === sorted.length - 1) { ctx.fillStyle = col; ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = z.alpha || 1; }
          ctx.strokeStyle = col; ctx.stroke();
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (z.label) { const lx = ox + Math.cos(mta) * z.reach * s, ly = oy - Math.sin(mta) * z.reach * s; D.label(ctx, z.label, lx + 4, ly - 6, col, 12.5, true); }
      });
      if (pt) {
        const px = ox + _pr * s, py = oy - _px * s;
        if (cfg.trail) { const tr = state.trail; tr.push([px, py]); if (tr.length > (cfg.trailLen || 160)) tr.shift();
          const tc = cfg.trailColor || cal.SEQ.neg;
          ctx.strokeStyle = tc; ctx.lineWidth = 2.4; ctx.lineJoin = 'round';
          tr.forEach((p, k) => { if (!k) return; ctx.globalAlpha = 0.08 + 0.5 * (k / tr.length); ctx.beginPath(); ctx.moveTo(tr[k - 1][0], tr[k - 1][1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); }); ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = mut; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
        const pc = cfg.pointColor || cal.SEQ.neg;
        ctx.fillStyle = pc; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(px, py, 9, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fill();
        if (cfg.pointLabel) D.label(ctx, cfg.pointLabel, px + 10, py - 4, pc, 13, true);
      }
    }
    return bindDraw(canvas, cfg, draw, { toPx: mapper(state) });
  };

  /* ======================================================================
   *  Coordination — log-log time-current curves with a fault sweep
   * ==================================================================== */
  NS.Coordination = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {}; const cal = C;
    const state = { map: null };
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height, x0 = 56, x1 = W - 14, y0 = 14, y1 = H - 34;
      const Ix = cal.logScale(cfg.iMin || 100, cfg.iMax || 100000, x0, x1);
      const Ty = cal.logScale(cfg.tMin || 0.01, cfg.tMax || 100, y1, y0);   // t grows upward
      state.map = v => [Ix.toPx(v.i != null ? v.i : v.current), Ty.toPx(v.t != null ? v.t : v.seconds)];
      const grid = cfg.grid || '#dbe3ea', mut = cfg.muted || '#5a6b78';
      ctx.lineWidth = 1;
      Ix.ticks().forEach(tk => { const x = Ix.toPx(tk.v); ctx.strokeStyle = grid; ctx.globalAlpha = tk.major ? 0.9 : 0.3; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); if (tk.major) { ctx.globalAlpha = 1; D.label(ctx, tk.v >= 1000 ? (tk.v / 1000) + 'k' : '' + tk.v, x, y1 + 12, mut, 10.5, false, 'center'); } });
      Ty.ticks().forEach(tk => { const y = Ty.toPx(tk.v); ctx.strokeStyle = grid; ctx.globalAlpha = tk.major ? 0.9 : 0.3; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); if (tk.major) { ctx.globalAlpha = 1; D.label(ctx, tk.v < 1 ? tk.v.toFixed(2) : '' + tk.v, x0 - 6, y, mut, 10.5, false, 'right'); } });
      ctx.globalAlpha = 1;
      D.label(ctx, 'Current (A)', (x0 + x1) / 2, H - 6, mut, 12, true, 'center');
      ctx.save(); ctx.translate(13, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); D.label(ctx, 'Time (s)', 0, 0, mut, 12, true, 'center'); ctx.restore();
      const devs = typeof cfg.devices === 'function' ? cfg.devices() : (cfg.devices || []);
      devs.forEach(dv => {
        const col = dv.color || cal.SEQ.pos;
        ctx.strokeStyle = col; ctx.lineWidth = dv.w || 2.6; ctx.beginPath(); let go = false, firstPx = 0, firstPy = 0;
        for (let px = x0; px <= x1; px += 2) { const I = Ix.fromPx(px), tt = dv.curve(I); if (tt == null || !isFinite(tt) || tt > (cfg.tMax || 100) || tt < (cfg.tMin || 0.01)) { go = false; continue; } const py = Ty.toPx(tt); go ? ctx.lineTo(px, py) : ctx.moveTo(px, py); if (!go) { firstPx = px; firstPy = py; } go = true; }
        ctx.stroke();
        const name = dv.label || dv.name;                                   // label where the curve enters the plot (low-current end)
        if (name && firstPy) {
          const lx = firstPx + 8, ly = Math.max(y0 + 8, firstPy - 8);
          ctx.font = '600 12px "Segoe UI",system-ui,sans-serif';
          const tw = ctx.measureText(name).width;
          ctx.fillStyle = cfg.halo || 'rgba(255,255,255,.72)'; ctx.fillRect(lx - 3, ly - 9, tw + 6, 18);
          D.label(ctx, name, lx, ly, col, 12, true);
        }
      });
      if (cfg.faultCurrent) { const If = typeof cfg.faultCurrent === 'function' ? cfg.faultCurrent(t) : cfg.faultCurrent; const x = Ix.toPx(If);
        ctx.strokeStyle = cfg.faultColor || cal.SEQ.neg; ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]);
        D.label(ctx, 'fault ' + (If >= 1000 ? (If / 1000).toFixed(1) + ' kA' : If + ' A'), x + 6, y0 + 9, cfg.faultColor || cal.SEQ.neg, 12, true); }
    }
    return bindDraw(canvas, cfg, draw, { toPx: mapper(state) });
  };

  /* ======================================================================
   *  Stability — power-angle curve + equal-area criterion
   * ==================================================================== */
  NS.Stability = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {}; const cal = C, TAU = C.TAU;
    const state = { map: null };
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height, x0 = 40, x1 = W - 14, y0 = 16, y1 = H - 32;
      const dmax = Math.PI, Pmax = cfg.pmax || 1.8, Pf = cfg.pmaxFault != null ? cfg.pmaxFault : 0.5, Pp = cfg.pmaxPost != null ? cfg.pmaxPost : 1.5, Pm = cfg.pm || 1.0;
      const px = d => x0 + d / dmax * (x1 - x0), py = p => y1 - p / (Pmax * 1.05) * (y1 - y0);
      state.map = v => [px(v.delta != null ? v.delta : (v.deg || 0) * C.D2R), py(v.p || 0)];
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
      // equal-area criterion: A₁ = ∫(Pm − Pf·sinδ)dδ over δ₀…δc,  A₂ = ∫(Pp·sinδ − Pm)dδ over δc…δmax
      if (cfg.areas !== false) {
        const area = (fn, a, b) => { const n = 400, h = (b - a) / n; let s = 0; for (let i = 0; i < n; i++) s += fn(a + (i + 0.5) * h) * h; return s; };
        const A1 = Math.max(0, area(d => Pm - Pf * Math.sin(d), d0, dc));
        const A2 = Math.max(0, area(d => Pp * Math.sin(d) - Pm, dc, dmx));
        D.label(ctx, 'A₁ = ' + A1.toFixed(2) + '   A₂ = ' + A2.toFixed(2) + '   ' + (A2 >= A1 ? 'stable' : 'unstable'),
          x1 - 4, y0 + 6, A2 >= A1 ? cal.SEQ.zero : cal.SEQ.neg, 12.5, true, 'right');
      }
    }
    return bindDraw(canvas, cfg, draw, { toPx: mapper(state) });
  };

  /* ======================================================================
   *  Spectrum — harmonic bar chart, optionally linked to its waveform
   * ==================================================================== */
  NS.Spectrum = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {}; const cal = C, TAU = C.TAU, D2R = C.D2R;
    const state = { map: null };
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
      const full = cfg.fullScalePct || 100;
      const _bw = (bx1 - bx0) / (maxN + 0.5);
      state.map = v => [bx0 + ((v.n || 1) - 0.5) * _bw, by1 - Math.max(0, Math.min(1, (v.pct || 0) / full)) * (by1 - by0)];
      // faint % reference lines
      ctx.lineWidth = 1;
      [25, 50, 75, 100].forEach(pc => { const y = by1 - (pc / full) * (by1 - by0); ctx.strokeStyle = grid; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(bx0, y); ctx.lineTo(bx1, y); ctx.stroke(); ctx.globalAlpha = 1; D.label(ctx, pc + '%', bx0 - 5, y, mut, 9.5, false, 'right'); });
      ctx.strokeStyle = grid; ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(bx0, by1); ctx.lineTo(bx1, by1); ctx.moveTo(bx0, by0); ctx.lineTo(bx0, by1); ctx.stroke();
      const bw = (bx1 - bx0) / (maxN + 0.5);
      for (let n = 1; n <= maxN; n++) {
        const h = harm.find(x => x.n === n), pctv = h ? Math.abs(h.mag) / base * 100 : 0, x = bx0 + (n - 0.5) * bw;
        const barH = Math.max(0, Math.min(1, pctv / full)) * (by1 - by0);
        ctx.fillStyle = n === 1 ? (cfg.fundColor || cal.SEQ.pos) : (cfg.harmColor || cal.SEQ.neg);
        ctx.fillRect(x - bw * 0.32, by1 - barH, bw * 0.64, barH);
        D.label(ctx, '' + n, x, by1 + 12, mut, 10.5, false, 'center');
      }
      D.label(ctx, 'THD = ' + cal.thd(harm).toFixed(1) + '%', bx1, by0 + 4, mut, 13, true, 'right');
      D.label(ctx, 'harmonic order', (bx0 + bx1) / 2, H - 6, mut, 12, true, 'center');
    }
    return bindDraw(canvas, cfg, draw, { toPx: mapper(state) });
  };

  /* ======================================================================
   *  drag — make a figure's symbols grabbable, like the PFAS one-line canvas.
   *
   *      const stop = NS.drag(api.inst.el, one);      // in a slide's mountDeck
   *
   *  Pointer coordinates arrive in CSS pixels of an element the deck has scaled
   *  (the whole stage is transformed to fit the window), so every position is
   *  mapped back through the canvas's own bounding box before it is used —
   *  otherwise a drag drifts away from the cursor the moment the deck is resized.
   *  The component turns that into a MODEL-space offset and re-routes, so the
   *  conductors stay attached wherever a symbol is dropped.
   * ==================================================================== */
  NS.drag = function (canvas, comp, opts) {
    opts = opts || {};
    if (!canvas || !comp || typeof comp.hitTest !== 'function') return function () {};
    const canZoom = opts.zoom !== false && typeof comp.zoomAt === 'function';
    const canPan = opts.pan !== false && typeof comp.panBy === 'function';
    const canReshape = opts.reshape !== false && typeof comp.hitConductor === 'function';
    const pannable = () => canPan && (!comp.pannable || comp.pannable());

    /* One pointer does three different jobs depending on what is under it and how many fingers
       are down: move a symbol, push the view around, or pinch it. `pts` is the live pointer set,
       which is the only way to tell the third case from the first two. */
    const pts = new Map();
    let held = null, mode = null, lastX = 0, lastY = 0, moved = false, pinch = null;

    const toCanvas = ev => {
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * (canvas.width / (r.width || 1)),
               y: (ev.clientY - r.top) * (canvas.height / (r.height || 1)) };
    };
    const on = () => !opts.enabled || opts.enabled();
    const grab = id => { if (canvas.setPointerCapture && id != null) { try { canvas.setPointerCapture(id); } catch (e) {} } };
    const drop = id => { if (canvas.releasePointerCapture && id != null) { try { canvas.releasePointerCapture(id); } catch (e) {} } };
    const midOf = () => {
      const a = Array.from(pts.values());
      return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1,
               cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2 };
    };

    const down = ev => {
      if (!on()) return;
      const p = toCanvas(ev);
      pts.set(ev.pointerId, p);
      if (pts.size === 2 && canZoom) {                    // a second finger takes over as a pinch
        held = null; mode = 'pinch'; pinch = midOf();
        ev.preventDefault(); ev.stopPropagation();
        return;
      }
      if (pts.size > 1) return;
      /* Priority is smallest-target-first, so nothing is unreachable: a bend handle (tiny) beats
         a symbol, a symbol beats the wire it sits on, and only bare canvas pans. Grabbing a wire
         where there is no handle PULLS A NEW BEND out of it and drags that — "reshape it like in
         PFAS", made a single gesture instead of a double-click-then-drag. */
      const wpHit = canReshape && comp.hitWaypoint && comp.hitWaypoint(p.x, p.y);
      const id = comp.hitTest(p.x, p.y);
      if (wpHit) { held = wpHit; mode = 'waypoint'; }
      else if (id) { held = id; mode = 'symbol'; }
      else if (canReshape) {
        const seg = comp.hitConductor(p.x, p.y);
        if (seg) { const idx = comp.addWaypoint(seg.key, seg.seg, p.x, p.y); held = { key: seg.key, index: idx }; mode = 'waypoint'; }
        else if (pannable()) { mode = 'pan'; } else return;
      }
      else if (pannable()) { mode = 'pan'; }
      else return;                     // nothing here to grab — leave the gesture to the deck
      canvas.style.cursor = 'grabbing';
      lastX = p.x; lastY = p.y; moved = false;
      grab(ev.pointerId);
      ev.preventDefault(); ev.stopPropagation();          // the deck must not read this as a swipe
    };

    const move = ev => {
      const p = toCanvas(ev);
      if (pts.has(ev.pointerId)) pts.set(ev.pointerId, p);
      if (mode === 'pinch') {
        if (pts.size < 2) return;
        const m = midOf();
        comp.zoomAt(m.d / pinch.d, m.cx, m.cy);
        comp.panBy(m.cx - pinch.cx, m.cy - pinch.cy);      // two fingers pan as well as pinch
        pinch = m;
        ev.preventDefault();
        return;
      }
      if (!mode) {                                        // hover: say what this spot will do
        if (!on()) return;
        const overWp = canReshape && comp.hitWaypoint && comp.hitWaypoint(p.x, p.y);
        const overWire = !overWp && canReshape && !comp.hitTest(p.x, p.y) && comp.hitConductor(p.x, p.y);
        canvas.style.cursor = comp.hitTest(p.x, p.y) || overWp ? 'grab'
          : overWire ? 'crosshair' : (pannable() ? 'move' : '');
        return;
      }
      if (mode === 'symbol') comp.nudge(held, p.x - lastX, p.y - lastY);
      else if (mode === 'waypoint') comp.moveWaypoint(held.key, held.index, p.x - lastX, p.y - lastY);
      else comp.panBy(p.x - lastX, p.y - lastY);
      lastX = p.x; lastY = p.y; moved = true;
      if (mode === 'symbol' && opts.onMove) opts.onMove(held, comp.positions());
      if (mode === 'waypoint' && opts.onReshape) opts.onReshape(comp.waypoints());
      if (mode === 'pan' && opts.onView) opts.onView(comp.view());
      ev.preventDefault();
    };

    const up = ev => {
      if (ev && ev.pointerId != null) pts.delete(ev.pointerId);
      if (mode === 'pinch') {
        if (pts.size < 2) { mode = null; pinch = null; canvas.style.cursor = ''; }
        if (opts.onView) opts.onView(comp.view());
        return;
      }
      if (!mode) return;
      const id = held, was = mode;
      held = null; mode = null; canvas.style.cursor = '';
      drop(ev && ev.pointerId);
      if (was === 'symbol' && moved && opts.onDrop) opts.onDrop(id, comp.positions());
      if (was === 'waypoint' && opts.onReshape) opts.onReshape(comp.waypoints());
      if (was === 'pan' && moved && opts.onView) opts.onView(comp.view());
    };

    /* Wheel zooms about the cursor — and so does a trackpad pinch, which browsers deliver as
       ctrl+wheel. deltaMode 1 is lines rather than pixels; without that a mouse wheel on Firefox
       would zoom about thirty times too slowly. */
    const wheel = ev => {
      if (!canZoom || !on()) return;
      const p = toCanvas(ev);
      const step = ev.deltaMode === 1 ? ev.deltaY * 16 : (ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY);
      comp.zoomAt(Math.exp(-step * 0.0022), p.x, p.y);
      ev.preventDefault(); ev.stopPropagation();
      if (opts.onView) opts.onView(comp.view());
    };
    /* Double-click: on a bend point it REMOVES it (the run relaxes back toward its auto-route as
       the bends run out); otherwise it zooms in on what you pointed at, or back out to the fit.
       Removing a bend is more specific than zoom-anywhere, so it is tried first — and its target
       is tiny, so zoom is unaffected everywhere else. */
    const dbl = ev => {
      if (!on()) return;
      const p = toCanvas(ev);
      if (canReshape && comp.hitWaypoint) {
        const w = comp.hitWaypoint(p.x, p.y);
        if (w) { comp.removeWaypoint(w.key, w.index); ev.preventDefault(); ev.stopPropagation();
                 if (opts.onReshape) opts.onReshape(comp.waypoints()); return; }
      }
      if (!canZoom) return;
      if (comp.view().z > 1.001) comp.resetView(); else comp.zoomAt(2.4, p.x, p.y);
      ev.preventDefault(); ev.stopPropagation();
      if (opts.onView) opts.onView(comp.view());
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);
    if (canZoom) canvas.addEventListener('wheel', wheel, { passive: false });   // passive:false or the page scrolls instead
    if (canZoom || canReshape) canvas.addEventListener('dblclick', dbl);        // zoom, and/or remove a bend
    return function stop() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', dbl);
      canvas.style.cursor = '';
    };
  };

  /* ======================================================================
   *  reroute — taps slide, bars resize, conductors stay orthogonal.
   *  Split out of autoLayout because a diagram you can DRAG has to redo exactly
   *  this every time a symbol moves: the tap slides along the bar to meet the new
   *  position, the bar grows or shrinks to cover its taps, and the run is drawn
   *  again as a drop or a Z. Pure — nodes and pairs in, routed edges out (each
   *  bus node's bar width is updated in place).
   * ==================================================================== */
  /* PFAS routeOrthogonal.ts constants, kept at their source values so the routes come out the
     same shape. W_OVERLAP is PER PIXEL of collinear run shared with an already-placed conductor:
     two runs drawn on top of each other are the one defect a one-line must not have, because the
     room cannot tell which flow is which. It sits just under a crossing per unit length, so the
     router will take an extra bend to separate two parallel runs but won't invent a crossing to
     save a short shared stub. */
  const RT = { ALIGN: 2, OVERSHOOT: 90, LANES: 6, OVER_EPS: 6,
               W_CROSS: 100000, W_PIERCE: 150000, W_BEND: 1000, W_LEN: 0.01, W_OVERLAP: 600 };
  const ccw = (p, q, r) => (r.y - p.y) * (q.x - p.x) - (q.y - p.y) * (r.x - p.x);
  /** Squared distance from a point to a segment — for finding which conductor a click landed on. */
  function segDist2(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return (px - cx) * (px - cx) + (py - cy) * (py - cy);
  }
  function properIntersect(a, b, c, d) {
    const d1 = ccw(c, d, a), d2 = ccw(c, d, b), d3 = ccw(a, b, c), d4 = ccw(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  /** Length of the run two axis-aligned segments would draw on top of each other (0 if they don't). */
  function collinearOverlap(a, b, c, d) {
    const E = RT.ALIGN, O = RT.OVER_EPS;
    if (Math.abs(a.y - b.y) <= E && Math.abs(c.y - d.y) <= E && Math.abs(a.y - c.y) <= O)
      return Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
    if (Math.abs(a.x - b.x) <= E && Math.abs(c.x - d.x) <= E && Math.abs(a.x - c.x) <= O)
      return Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
    return 0;
  }
  /** Does a→b cross the interior of an axis-aligned box? (Liang–Barsky, as PFAS does it.) */
  function segHitsBox(a, b, box) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, a.x - (box.cx - box.hw)) && clip(dx, (box.cx + box.hw) - a.x) &&
           clip(-dy, a.y - (box.cy - box.hh)) && clip(dy, (box.cy + box.hh) - a.y) && t0 <= t1;
  }

  NS.reroute = function (nodes, pairs, opts) {
    opts = opts || {};
    const TAP_MAX = opts.tapSpan || 150;
    /* Where a conductor attaches. A bus tap SLIDES along the bar to meet whatever arrives —
       that is also what sets the bar's length. Everything else attaches at its centre, and the
       symbol is painted over the conductor with an opaque body afterwards, so the run reads as
       entering the terminal exactly the way PFAS draws it. */
    /* A bar may not grow into the next bus on the same row. Left uncapped, two buses tied to each
       other each slide a tap all the way to the other, both bars stretch to meet, and they FUSE
       into one continuous blue bar with the tie hidden inside it — the diagram then shows one bus
       where the model has two. Cap each bar at half the gap to its nearest same-row neighbour. */
    const busIds = Object.keys(nodes).filter(id => nodes[id].type === 'bus');
    busIds.forEach(id => {
      let cap = TAP_MAX;
      busIds.forEach(o => {
        if (o === id || Math.abs(nodes[o].y - nodes[id].y) > 12) return;
        cap = Math.min(cap, Math.max(22, Math.abs(nodes[o].x - nodes[id].x) / 2 - 24));
      });
      nodes[id].tap = cap;
    });
    const port = (self, other) => {
      if (self.type !== 'bus') return { x: self.x, y: self.y };
      const m = self.tap == null ? TAP_MAX : self.tap;
      return { x: Math.max(self.x - m, Math.min(self.x + m, other.x)), y: self.y };
    };
    const edges = pairs.map(p => {
      const A = nodes[p.from], B = nodes[p.to];
      if (!A || !B) return null;
      // A user-reshaped conductor carries fixed bend points (`wp`, model space). A bus tap then
      // slides to meet the FIRST bend rather than the far element, so the run leaves the bar
      // heading toward where the user pulled it — exactly like dragging a waypoint in PFAS.
      const wp = p.wp && p.wp.length ? p.wp.map(w => ({ x: w.x, y: w.y })) : null;
      return { from: p.from, to: p.to, decor: p.decor || null, wp: wp,
               fromPt: port(A, wp ? wp[0] : B), toPt: port(B, wp ? wp[wp.length - 1] : A) };
    }).filter(Boolean);

    /* ---- fan a bus's taps into one lane per conductor (PFAS fanOutBusTaps) ----
       Each tap above slides independently to meet its far node, so two conductors whose far
       nodes sit at the same x land on the SAME point on the bar and drop on top of each other —
       coincident runs you cannot tell apart. A meshed bus (five lines sharing one node) shows
       this worst. So per bus: order the incident taps left→right (by where each wants to land,
       which keeps the fan from self-crossing), spread them to at least TAP_GAP apart, then shift
       the whole fan back onto its own centre — straight drops stay straight, only genuine
       collisions move. */
    const TAP_GAP = opts.tapGap || 22;
    Object.keys(nodes).forEach(busId => {
      if (nodes[busId].type !== 'bus') return;
      const inc = [];
      edges.forEach(e => {
        if (e.from === busId) inc.push({ pt: e.fromPt });
        if (e.to === busId) inc.push({ pt: e.toPt });
      });
      if (inc.length < 2) return;
      inc.sort((p, q) => p.pt.x - q.pt.x);
      const before = inc.reduce((s, it) => s + it.pt.x, 0) / inc.length;
      for (let i = 1; i < inc.length; i++) {
        const need = inc[i - 1].pt.x + TAP_GAP;
        if (inc[i].pt.x < need) inc[i].pt.x = need;
      }
      const after = inc.reduce((s, it) => s + it.pt.x, 0) / inc.length;
      const shift = before - after;                       // re-centre the fan on the bus
      if (shift) inc.forEach(it => (it.pt.x += shift));
    });

    Object.keys(nodes).forEach(id => {
      if (nodes[id].type !== 'bus') return;
      let span = 40;
      edges.forEach(e => {
        if (e.from === id) span = Math.max(span, Math.abs(e.fromPt.x - nodes[id].x));
        if (e.to === id) span = Math.max(span, Math.abs(e.toPt.x - nodes[id].x));
      });
      // and the drawn bar is capped the same way, so the 40-unit minimum can't reintroduce the fusion
      let room = Infinity;
      busIds.forEach(o => {
        if (o === id || Math.abs(nodes[o].y - nodes[id].y) > 12) return;
        room = Math.min(room, Math.abs(nodes[o].x - nodes[id].x) / 2 - 7);
      });
      nodes[id].w = Math.round(Math.max(20, Math.min(span + 14, room)));
    });

    /* ---- PFAS's position-driven orthogonal router ----
       Per conductor: a straight run when the endpoints already line up, the two L-bends, and a
       family of Z-bends whose middle lane slides across the gap — plus an overshoot band, so a
       lane may go AROUND an obstacle instead of through it. Longest-first (most crossing
       potential, least freedom), each seeing what has already been committed, so the greedy
       choice is crossing- and symbol-avoiding. Cost order: crossings, pierced symbols,
       overlapping parallel runs, bends, then a shorter run. */
    const boxes = Object.keys(nodes).map(id => {
      const n = nodes[id];
      return n.type === 'bus'
        ? { id: id, cx: n.x, cy: n.y, hw: Math.max(54, (n.w || 40)), hh: 12 }
        : { id: id, cx: n.x, cy: n.y, hw: 28, hh: 24 };
    });
    const order = edges.slice().sort((p, q) => {
      const lp = Math.abs(p.fromPt.x - p.toPt.x) + Math.abs(p.fromPt.y - p.toPt.y);
      const lq = Math.abs(q.fromPt.x - q.toPt.x) + Math.abs(q.fromPt.y - q.toPt.y);
      return lq - lp || (p.from + p.to < q.from + q.to ? -1 : 1);
    });
    const candidates = (a, b) => {
      const routes = [[{ x: a.x, y: b.y }], [{ x: b.x, y: a.y }]];      // the two L-bends
      const O = RT.OVERSHOOT, N = RT.LANES;
      const yLo = Math.min(a.y, b.y) - O, yHi = Math.max(a.y, b.y) + O;
      const xLo = Math.min(a.x, b.x) - O, xHi = Math.max(a.x, b.x) + O;
      for (let i = 0; i <= N; i++) {
        const my = yLo + ((yHi - yLo) * i) / N;
        routes.push([{ x: a.x, y: my }, { x: b.x, y: my }]);            // Z on a horizontal lane
        const mx = xLo + ((xHi - xLo) * i) / N;
        routes.push([{ x: mx, y: a.y }, { x: mx, y: b.y }]);            // Z on a vertical lane
      }
      return routes;
    };
    const placed = [];
    /* A user-pinned path is laid down FIRST and as-is — the bends the user placed are honored
       exactly, not re-optimised — and it becomes a fixed obstacle the auto-router threads its
       other conductors around. This is the whole of "change the path like in PFAS": the run is
       whatever polyline the user's bend points describe, diagonal segments included. */
    edges.filter(e => e.wp).forEach(e => {
      e.points = [e.fromPt].concat(e.wp, [e.toPt]);
      for (let i = 0; i < e.points.length - 1; i++) placed.push({ a: e.points[i], b: e.points[i + 1], cid: e });
    });
    order.filter(e => !e.wp).forEach(e => {
      const a = e.fromPt, b = e.toPt;
      const aligned = Math.abs(a.x - b.x) < RT.ALIGN || Math.abs(a.y - b.y) < RT.ALIGN;
      const routes = aligned ? [[]] : candidates(a, b);
      let bestWp = [], bestCost = Infinity;
      routes.forEach(wp => {
        const pts = [a].concat(wp, [b]);
        let cross = 0, pierce = 0, overlap = 0, len = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          len += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
          for (let j = 0; j < placed.length; j++) {
            const o = placed[j];
            if (o.cid === e) continue;
            if (properIntersect(pts[i], pts[i + 1], o.a, o.b)) cross++;
            else overlap += collinearOverlap(pts[i], pts[i + 1], o.a, o.b);
          }
          for (let j = 0; j < boxes.length; j++) {
            const bx = boxes[j];
            if (bx.id !== e.from && bx.id !== e.to && segHitsBox(pts[i], pts[i + 1], bx)) pierce++;
          }
        }
        const cost = cross * RT.W_CROSS + pierce * RT.W_PIERCE + overlap * RT.W_OVERLAP +
                     wp.length * RT.W_BEND + len * RT.W_LEN;
        if (cost < bestCost) { bestCost = cost; bestWp = wp; }
      });
      e.points = [a].concat(bestWp, [b]);
      for (let i = 0; i < e.points.length - 1; i++) placed.push({ a: e.points[i], b: e.points[i + 1], cid: e });
    });
    return edges;
  };

  /* ======================================================================
   *  autoLayout — a network model becomes a drawable one-line.
   *
   *  A compact port of the PFAS layout method (C:\PFAS AUTO_LAYOUT_DESIGN.md):
   *
   *    1. BANDS. A 0-1 BFS from the infeeds where an edge costs 1 only when
   *       LEAVING a transformer. The band index is the galvanic level, so
   *       sources sit on top and every transformer steps one level down —
   *       and it needs no kV data at all.
   *    2. RELAX. Fruchterman-Reingold inside each band with y HARD-CLAMPED to
   *       the band. That clamp is the whole trick: stratification is structural,
   *       and a meshed level still has a second degree of freedom to untangle.
   *    3. MULTI-START. Seeded, deterministic; keep the arrangement that scores
   *       best (crossings first, then symbol overlaps, then total length).
   *    4. TAPS SLIDE. A conductor landing on a bus attaches where it arrives,
   *       along the bar — which is also what sets the bar's length.
   *    5. ORTHOGONAL. Conductors run as straight drops or Z-bends, never
   *       diagonals.
   *
   *  In: { elements, connections } — a PFAS project export.
   *  Out: { nodes, edges, bands, crossings } ready for NS.OneLine.
   * ==================================================================== */
  /** Half-extents of each symbol at symScale 1 — [across the drawing, down it]. Used for hit
   *  boxes, for the margin the fitter has to reserve (fixed symbols do not shrink), and by the
   *  layout when it looks for a clear spot to put a relay. */
  const SYM_BOX = { source: [21, 21], gen: [21, 21], xfmr: [24, 34], load: [16, 17],
                    breaker: [20, 14], fuse: [22, 12], ct: [20, 14], line: [23, 12],
                    cap: [14, 18], reactor: [14, 18], bus: [40, 14],
                    relay: [15, 15], pt: [11, 12] };
  /** Half-length of just the BODY along the conductor. The stubs either side are the conductor
   *  itself, so they cost no room — this, not the full footprint, is what a run has to hold. */
  const SYM_BODY = { breaker: 11, fuse: 16, ct: 12, line: 17, cap: 14, reactor: 14 };
  const SYMBOL_OF = {
    Bus: 'bus', Source: 'source', Generator: 'gen', Transformer: 'xfmr', Transformer3W: 'xfmr',
    Load: 'load', Breaker: 'breaker', Fuse: 'fuse', CT: 'ct', PT: 'ct', Impedance: 'line',
    ShuntCapacitor: 'cap', ShuntReactor: 'reactor',
  };
  const isInfeed = e => e.type === 'Source' ||
    (e.type === 'Generator' && (!e.machineType || e.machineType === 'generator' || e.machineType === 'utility'));

  NS.autoLayout = function (model, opts) {
    opts = opts || {};
    const W = opts.width || 900, starts = opts.starts || 60, iters = opts.iterations || 240;
    // Nothing is thrown away by default. A CT is not clutter on a protection deck — it is the
    // thing the relay sees the fault through — so instrument transformers stay in the drawing
    // and stay clickable. `collapse: ['CT']` puts the old behaviour back.
    const collapse = opts.collapse === false ? [] : (opts.collapse || []);
    let els = ((model && model.elements) || []).slice();
    let cons = ((model && model.connections) || []).map(c => ({ a: c.fromElementId, b: c.toElementId }));

    /* ---- junction buses are wire corners, not symbols ----
       A bus named "… Jct/Junction" with exactly two connections exists to give the drawing a
       corner; on a one-line it is just the conductor. Off by default for anything else, because
       a two-connection bus can still be a real bus worth naming (a generator bus, say). */
    if (opts.collapseJunctions !== false) {
      const pattern = opts.junctionPattern || /\b(jct|junction)\b/i;
      els.filter(e => e.type === 'Bus' && pattern.test(e.name || '')).forEach(e => {
        const touch = cons.filter(c => c.a === e.id || c.b === e.id);
        if (touch.length !== 2) return;
        const far = touch.map(c => (c.a === e.id ? c.b : c.a));
        if (far[0] === far[1]) return;
        cons = cons.filter(c => c.a !== e.id && c.b !== e.id);
        cons.push({ a: far[0], b: far[1] });
        els = els.filter(x => x.id !== e.id);
      });
    }

    /* ---- collapse metering devices: splice an in-line one out, drop a tap ---- */
    collapse.forEach(type => {
      els.filter(e => e.type === type).forEach(e => {
        const touch = cons.filter(c => c.a === e.id || c.b === e.id);
        const far = touch.map(c => (c.a === e.id ? c.b : c.a));
        cons = cons.filter(c => c.a !== e.id && c.b !== e.id);
        if (far.length === 2 && far[0] !== far[1]) cons.push({ a: far[0], b: far[1] });
      });
      els = els.filter(e => e.type !== type);
    });
    /* ---- in-line devices belong ON the conductor, not beside it ----
       A breaker between a bus and a feeder is not a third PLACE in the diagram — it is a symbol
       on the drop. So the layout is solved for the places only (buses, machines, transformers,
       loads), which is what gives a one-line its shape and stops a chain of pass-through hardware
       stretching the tree into a ladder of near-empty rows.

       The devices are not lost: each is remembered against the conductor that replaced it, and
       step 5 puts it back as a REAL NODE sitting on that conductor — so it is drawn, hit-tested,
       labelled and dragged like anything else, and the conductor re-routes through it when it
       moves. Layout without them, topology with them. */
    const INLINE = opts.inline === false ? [] : (opts.inline || ['Breaker', 'Fuse', 'Impedance', 'CT', 'PT']);
    const decor = {};                                   // "a|b" → [{id, type, name}] in run order
    const keyOf = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    if (INLINE.length) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const e of els.slice()) {
          if (INLINE.indexOf(e.type) < 0) continue;
          const touch = cons.filter(c => c.a === e.id || c.b === e.id);
          if (touch.length !== 2) continue;              // a stub device keeps its place
          const far = touch.map(c => (c.a === e.id ? c.b : c.a));
          if (far[0] === far[1]) continue;
          const carried = touch.reduce((acc, c) => acc.concat(decor[keyOf(c.a, c.b)] || []), []);
          touch.forEach(c => delete decor[keyOf(c.a, c.b)]);
          cons = cons.filter(c => c.a !== e.id && c.b !== e.id);
          cons.push({ a: far[0], b: far[1] });
          decor[keyOf(far[0], far[1])] = carried.concat([{ id: e.id, type: SYMBOL_OF[e.type] || 'line',
            name: e.name, status: e.status, ratio: e.ratio, from: far[0], to: far[1] }]);
          els = els.filter(x => x.id !== e.id);
          moved = true;
        }
      }
    }

    if (!els.length) return { nodes: {}, edges: [], bands: 0, crossings: 0 };

    const byId = {}; els.forEach(e => (byId[e.id] = e));
    cons = cons.filter(c => byId[c.a] && byId[c.b] && c.a !== c.b);
    const adj = {}; els.forEach(e => (adj[e.id] = []));
    cons.forEach(c => { adj[c.a].push(c.b); adj[c.b].push(c.a); });

    /* ---- 1. bands: 0-1 BFS, cost 1 only when leaving a transformer ---- */
    // Root selection (PFAS computeAutoLayout): Sources always root. A Generator roots only if it
    // injects at the SAME galvanic level as a Source — reachable without crossing a transformer.
    // An on-site generator BEHIND the transformer must NOT root, or its 480 V bus is pinned to
    // band 0 and the hierarchy inverts. With no Source at all, every injecting generator roots.
    const level = {};
    const sources = els.filter(e => e.type === 'Source').map(e => e.id);
    let seeds;
    if (sources.length) {
      const flat = {}; const q = sources.slice();
      sources.forEach(id => (flat[id] = 1));
      while (q.length) {
        const u = q.shift();
        if (/^Transformer/.test(byId[u].type) && !flat.__root) continue;   // do not traverse through a transformer
        adj[u].forEach(v => { if (!flat[v]) { flat[v] = 1; if (!/^Transformer/.test(byId[v].type)) q.push(v); } });
      }
      seeds = sources.concat(els.filter(e => e.type === 'Generator' && isInfeed(e) && flat[e.id]).map(e => e.id));
    } else {
      seeds = els.filter(isInfeed).map(e => e.id);
    }
    if (!seeds.length) seeds = [els.slice().sort((p, q) => adj[q.id].length - adj[p.id].length)[0].id];
    const dq = []; seeds.forEach(s => { level[s] = 0; dq.push(s); });
    while (dq.length) {
      const u = dq.shift(), lu = level[u];
      const step = /^Transformer/.test(byId[u].type) ? 1 : 0;
      adj[u].forEach(v => {
        const lv = lu + step;
        if (level[v] === undefined || lv < level[v]) { level[v] = lv; step ? dq.push(v) : dq.unshift(v); }
      });
    }
    els.forEach(e => { if (level[e.id] === undefined) level[e.id] = 0; });
    const bandIdx = Array.from(new Set(els.map(e => level[e.id]))).sort((a, b) => a - b);
    const bandNo = {}; bandIdx.forEach((b, i) => (bandNo[b] = i));

    /* ---- band geometry: a meshed band gets head room, a thin one stays thin ---- */
    const yTop = {}, yBot = {};
    let cursor = 40;
    bandIdx.forEach(b => {
      const inBand = els.filter(e => level[e.id] === b).map(e => e.id);
      const set = {}; inBand.forEach(id => (set[id] = 1));
      // Band height must fit the band's mesh: a thin band collapses the 2-D relaxation back to
      // 1-D and the crossings come straight back (AUTO_LAYOUT_DESIGN.md rule 4).
      const intra = cons.filter(c => set[c.a] && set[c.b]).length;
      const h = Math.max(opts.bandMin || 70, Math.min(opts.bandMax || 220, 40 + intra * 18));
      yTop[b] = cursor; yBot[b] = cursor + h; cursor = yBot[b] + (opts.bandGap || 130);
    });

    /* ---- 2-3. constrained relaxation, multi-start, keep the best ---- */
    const lcg = s => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const ids = els.map(e => e.id);
    const cross = pos => {
      let n = 0;
      for (let i = 0; i < cons.length; i++) for (let j = i + 1; j < cons.length; j++) {
        const p = cons[i], q = cons[j];
        if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue;
        const A = pos[p.a], B = pos[p.b], Cc = pos[q.a], D = pos[q.b];
        const cw = (m, o, r) => (r.y - m.y) * (o.x - m.x) - (o.y - m.y) * (r.x - m.x);
        const d1 = cw(Cc, D, A), d2 = cw(Cc, D, B), d3 = cw(A, B, Cc), d4 = cw(A, B, D);
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) n++;
      }
      return n;
    };
    const overlaps = pos => {
      let n = 0;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const p = pos[ids[i]], q = pos[ids[j]];
        if (Math.abs(p.x - q.x) < 62 && Math.abs(p.y - q.y) < 34) n++;
      }
      return n;
    };
    const relax = seed => {
      const rnd = lcg(seed), pos = {};
      ids.forEach(id => { const b = level[id]; pos[id] = { x: rnd() * W, y: yTop[b] + rnd() * (yBot[b] - yTop[b]) }; });
      const k = Math.sqrt((W * W) / ids.length);
      let temp = W / 10;
      for (let it = 0; it < iters; it++) {
        const d = {}; ids.forEach(id => (d[id] = { x: 0, y: 0 }));
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i], b = ids[j], pa = pos[a], pb = pos[b];
          let dx = pa.x - pb.x, dy = pa.y - pb.y;
          const dist = Math.hypot(dx, dy) || 0.01, f = (k * k) / dist;
          dx /= dist; dy /= dist;
          d[a].x += dx * f; d[a].y += dy * f; d[b].x -= dx * f; d[b].y -= dy * f;
        }
        cons.forEach(c => {
          const pa = pos[c.a], pb = pos[c.b];
          let dx = pa.x - pb.x, dy = pa.y - pb.y;
          const dist = Math.hypot(dx, dy) || 0.01, f = (dist * dist) / k;
          dx /= dist; dy /= dist;
          d[c.a].x -= dx * f; d[c.a].y -= dy * f; d[c.b].x += dx * f; d[c.b].y += dy * f;
        });
        ids.forEach(id => {
          const p = pos[id], dd = d[id], len = Math.hypot(dd.x, dd.y) || 1e-6;
          p.x += (dd.x / len) * Math.min(len, temp);
          p.y += (dd.y / len) * Math.min(len, temp);
          p.x = Math.max(20, Math.min(W - 20, p.x));
          p.y = Math.max(yTop[level[id]], Math.min(yBot[level[id]], p.y));   // the hard band clamp
        });
        temp *= 0.96;
      }
      return pos;
    };
    const costOf = pos => {
      const x = cross(pos), o = overlaps(pos);
      let len = 0; cons.forEach(c => (len += Math.hypot(pos[c.a].x - pos[c.b].x, pos[c.a].y - pos[c.b].y)));
      return { cost: x * 1000 + o * 500 + len * 0.01, x };
    };

    /* ---- a TIDY TREE, for the radial networks that most one-lines are ----
       The relaxation is built for meshes; on a tree it scatters what should be a clean hierarchy.
       So: rows inside each band, children ordered by barycentre to unpick crossings, parents
       centred over the children they feed, and siblings spread but never overlapping. PFAS runs
       its layered engine first for the same reason and only refines a mesh. */
    const treeLayout = () => {
      const parent = {}, kids = {}, seen = {};
      ids.forEach(id => (kids[id] = []));
      const q = seeds.slice(); seeds.forEach(s => (seen[s] = 1));
      while (q.length) {
        const u = q.shift();
        adj[u].forEach(v => { if (!seen[v]) { seen[v] = 1; parent[v] = u; kids[u].push(v); q.push(v); } });
      }
      const roots = ids.filter(id => parent[id] === undefined);
      // row within the band: hops from wherever the band is entered
      const sub = {};
      bandIdx.forEach(b => {
        const entry = ids.filter(id => level[id] === b && (parent[id] === undefined || level[parent[id]] !== b));
        const qq = entry.slice(); entry.forEach(id => (sub[id] = 0));
        while (qq.length) {
          const u = qq.shift();
          adj[u].forEach(v => { if (level[v] === b && sub[v] === undefined) { sub[v] = sub[u] + 1; qq.push(v); } });
        }
        ids.filter(id => level[id] === b && sub[id] === undefined).forEach(id => (sub[id] = 0));
      });
      const rowGap = opts.rowGap || 92, colGap = opts.colGap || 132;
      /* Rows are NOT all the same height. A run carrying in-line hardware has to hold it: a
         breaker and a CT between two buses need roughly three symbol-lengths of drop, while a
         bare feeder needs one. Uniform rows squeeze the first case until the symbols sit on the
         bar and neither can be read — so each row boundary is stretched by what crosses it. */
      const rowLoad = {}, bandLoad = {};
      cons.forEach(c => {
        const d = decor[keyOf(c.a, c.b)];
        if (!d || !d.length) return;
        if (level[c.a] !== level[c.b]) {                    // crossing bands: widen the band gap
          const b2 = Math.max(level[c.a], level[c.b]);
          bandLoad[b2] = Math.max(bandLoad[b2] || 0, d.length);
          return;
        }
        const lo = Math.min(sub[c.a], sub[c.b]), hi = Math.max(sub[c.a], sub[c.b]);
        for (let r = lo; r < hi; r++) {
          const k3 = level[c.a] + '|' + r;
          rowLoad[k3] = Math.max(rowLoad[k3] || 0, d.length);
        }
      });
      const bandTop = {}, rowY = {};
      let yy = 0;
      bandIdx.forEach(b => {
        bandTop[b] = yy + (opts.bandGap || 40) * 0.35 * (bandLoad[b] || 0);
        const rows = Math.max(0, ...ids.filter(id => level[id] === b).map(id => sub[id]));
        /* REDISTRIBUTE, don't add. Growing the band would only make the whole drawing taller,
           the fit would scale it down to compensate, and every row — device-carrying or not —
           would end up tighter on screen than before. So the band keeps its height and the rows
           inside it trade: a drop with a breaker and a CT takes room from the bare ones. */
        const hs = [];
        let want = 0;
        for (let r = 0; r <= rows; r++) { const h2 = rowGap * (1 + 0.8 * (rowLoad[b + '|' + r] || 0)); hs.push(h2); want += h2; }
        const norm = want > 0 ? ((rows + 1) * rowGap) / want : 1;
        let acc = 0;
        for (let r = 0; r <= rows; r++) { rowY[b + '|' + r] = acc; acc += hs[r] * norm; }
        yy = bandTop[b] + acc + (opts.bandGap || 40);
      });
      const yOf = id => bandTop[level[id]] + rowY[level[id] + '|' + sub[id]];

      // order siblings by the barycentre of their own subtrees, a couple of sweeps
      const leafCount = {};
      const countLeaves = id => (leafCount[id] = kids[id].length ? kids[id].reduce((s2, k2) => s2 + countLeaves(k2), 0) : 1);
      roots.forEach(countLeaves);
      const pos = {};
      let slot = 0;
      const place = id => {
        if (!kids[id].length) { pos[id] = { x: slot * colGap, y: yOf(id) }; slot++; return pos[id].x; }
        const xs = kids[id].map(place);
        pos[id] = { x: xs.reduce((a2, b2) => a2 + b2, 0) / xs.length, y: yOf(id) };
        return pos[id].x;
      };
      roots.forEach(r => { place(r); slot += 1; });
      // a row must not stack: push right when two symbols land too close together
      bandIdx.forEach(b => {
        const rows = {};
        ids.filter(id => level[id] === b).forEach(id => ((rows[sub[id]] = rows[sub[id]] || []).push(id)));
        Object.keys(rows).forEach(r => {
          const line = rows[r].sort((p, q2) => pos[p].x - pos[q2].x);
          for (let i = 1; i < line.length; i++) {
            const need = pos[line[i - 1]].x + (opts.minGap || 108);
            if (pos[line[i]].x < need) pos[line[i]].x = need;
          }
        });
      });
      // A first pass at filling the shape we are drawing into. Symbols are a fixed size, so
      // stretching x only changes spacing. The FINAL normalisation happens at the end of
      // autoLayout, once the devices and the protection layer are also on the drawing — they
      // change the extent, and normalising before they exist leaves the canvas half empty.
      if (opts.aspect) {
        const xs = ids.map(id => pos[id].x), ys = ids.map(id => pos[id].y);
        const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
        if (bw > 1 && bh > 1) {
          const f = Math.max(0.45, Math.min(3, (opts.aspect * bh) / bw));
          ids.forEach(id => (pos[id].x *= f));
        }
      }
      return pos;
    };

    let best = null, bestCost = Infinity, bestCross = 0, how = 'relaxed';
    // a tree has exactly V-1 edges; anything more is a mesh and wants the relaxation
    const meshy = cons.length > ids.length - 1;
    if (opts.layout !== 'relaxed') {
      const tp = treeLayout(), tc = costOf(tp);
      best = tp; bestCost = tc.cost; bestCross = tc.x; how = 'tree';
    }
    if (opts.layout !== 'tree' && (meshy || !best)) {
      for (let s = 0; s < starts; s++) {
        const pos = relax((opts.seed || 1) + s * 7919);
        const c = costOf(pos);
        if (c.cost < bestCost) { bestCost = c.cost; best = pos; bestCross = c.x; how = 'relaxed'; }
      }
    }

    /* ---- 4. taps slide along the bar; the bar's length follows from them ---- */
    // A one-line on a slide cannot carry 31 names. Label what the room reads — buses, infeeds
    // and transformers — and let the symbols speak for the breakers, cables and loads.
    const labelTypes = opts.labels === false ? []
      : (opts.labelTypes || ['bus', 'source', 'gen', 'xfmr', 'load']);
    const nodes = {};
    els.forEach(e => {
      const p = best[e.id], type = SYMBOL_OF[e.type] || 'line';
      // cp/cs/status are what the PFAS symbols read: the winding connections decide whether a
      // transformer draws Y or Δ (and a ground rake), and an open breaker draws red with a gap.
      nodes[e.id] = { x: Math.round(p.x), y: Math.round(p.y), type, kv: e.nominalKv || e.kv,
                      cp: e.connectionPrimary, cs: e.connectionSecondary, status: e.status,
                      label: labelTypes.indexOf(type) >= 0 ? e.name : undefined };
    });
    let pairs = cons.map(c => ({ from: c.a, to: c.b, decor: decor[keyOf(c.a, c.b)] || null }));
    let edges = NS.reroute(nodes, pairs, opts);

    /* ---- 5. put the in-line devices back, as nodes ON their conductor ----
       The layout above is solved for places. Now every device that was spliced out is given a
       position along the route that replaced it and becomes a first-class node: drawn, named,
       hit-tested, dragged. Its conductor is replaced by the chain through it, so when the room
       drags a CT the two runs either side follow it instead of it sliding off its own wire.

       They go on the route's LONGEST STRAIGHT SEGMENT — usually the drop — because a device
       parked on a bend would have its body swallow the corner. */
    const devices = [];
    edges.forEach(e => {
      if (!e.decor || !e.decor.length) return;
      const pts = e.points;
      let sa = pts[0], sb = pts[pts.length - 1], best2 = -1;
      for (let i = 1; i < pts.length; i++) {
        const l2 = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (l2 > best2) { best2 = l2; sa = pts[i - 1]; sb = pts[i]; }
      }
      const m = e.decor.length;
      // Devices sit in the middle 60% of the segment, so neither end lands on a bus bar.
      e.decor.forEach((dv, i) => {
        const f = 0.5 + (m === 1 ? 0 : (i / (m - 1) - 0.5) * 0.6);
        devices.push({ dv: dv, x: sa.x + (sb.x - sa.x) * f, y: sa.y + (sb.y - sa.y) * f, edge: e });
      });
    });
    if (devices.length) {
      const chainOf = {};                                   // "a|b" → the devices on that run, in order
      devices.forEach(d => {
        nodes[d.dv.id] = { x: Math.round(d.x), y: Math.round(d.y), type: d.dv.type,
                           status: d.dv.status, ratio: d.dv.ratio, device: true,
                           label: labelTypes.indexOf(d.dv.type) >= 0 ? d.dv.name : undefined };
        const key = keyOf(d.edge.from, d.edge.to);
        (chainOf[key] = chainOf[key] || []).push(d.dv.id);
      });
      pairs = [];
      edges.forEach(e => {
        const chain = chainOf[keyOf(e.from, e.to)];
        if (!chain || !chain.length) { pairs.push({ from: e.from, to: e.to }); return; }
        const seq = [e.from].concat(chain, [e.to]);
        for (let i = 1; i < seq.length; i++) pairs.push({ from: seq[i - 1], to: seq[i] });
      });
      edges = NS.reroute(nodes, pairs, opts);
    }

    /* ---- 6. the protection layer: relays and PTs ----
       Neither is a power element and neither carries load current, so neither is in the
       topology: a PT is shunt-connected to a bus and a relay lives on the SECONDARY side of a
       CT or PT. PFAS keeps them in their own collections and draws the wiring as dotted
       secondary-circuit lines (SecondaryCircuitLines.tsx / PTTapLines.tsx) — same here, as
       `links` rather than `edges`, so nothing about the power network is implied by them. */
    const links = [];
    const spread = (opts.minGap || 108) * 0.55;
    /* Where a relay goes is the whole difference between a protection layer you can read and a
       pile of discs on top of the switchgear. Each one is offered a ring of spots around the
       device it watches and takes the emptiest — the same trick the name tags use, in model
       space, against everything already placed (including the aux symbols placed before it).
       A nominal symbol size in layout units, since the screen scale is not known until the fit. */
    const unit = (opts.minGap || 108) * 0.2, uf = unit / 20;   // SYM_BOX is in px at scale 1
    const taken = Object.keys(nodes).map(id => {
      const n2 = nodes[id], b = SYM_BOX[n2.type] || [20, 20];
      return { x: n2.x, y: n2.y, hw: n2.type === 'bus' ? (n2.w || b[0] * uf) : b[0] * uf, hh: b[1] * uf };
    });
    const mid = (() => {                                     // centre of mass of the network
      const ids = Object.keys(nodes);
      return { x: ids.reduce((t, i2) => t + nodes[i2].x, 0) / (ids.length || 1),
               y: ids.reduce((t, i2) => t + nodes[i2].y, 0) / (ids.length || 1) };
    })();
    const place = anchorId => {
      const a = nodes[anchorId];
      if (!a) return null;
      const r0 = spread + (a.w || 0) * 0.8;
      const cands = [];
      [r0, r0 * 1.45, r0 * 2, r0 * 2.7].forEach(r => {
        for (let k2 = 0; k2 < 12; k2++) {
          const th = (k2 / 12) * Math.PI * 2;
          cands.push({ x: a.x + Math.cos(th) * r, y: a.y + Math.sin(th) * r * 0.7 });
        }
      });
      let bestC = cands[0], bestScore = Infinity;
      cands.forEach(c => {
        // cost = how deep it sits inside anything already there — overlap dominates everything,
        // then stay near the anchor, and among equals lean OUTWARD, into the white space around
        // the network rather than into the middle of the switchgear.
        let cost = 0;
        taken.forEach(t => {
          const ox = Math.max(0, t.hw + unit - Math.abs(t.x - c.x));
          const oy = Math.max(0, t.hh + unit - Math.abs(t.y - c.y));
          cost += ox * oy;
        });
        cost += Math.hypot(c.x - a.x, c.y - a.y) * 0.6;
        cost -= Math.hypot(c.x - mid.x, c.y - mid.y) * 0.25;
        if (cost < bestScore) { bestScore = cost; bestC = c; }
      });
      taken.push({ x: bestC.x, y: bestC.y, hw: unit, hh: unit });
      return { x: Math.round(bestC.x), y: Math.round(bestC.y) };
    };
    const its = ((model && model.instrumentTransformers) || []).filter(t => (t.type || 'PT') === 'PT');
    its.forEach(t => {
      const host = t.attachedTo && t.attachedTo.elementId;
      const at = place(host);
      if (!at) return;
      nodes[t.id] = { x: at.x, y: at.y, type: 'pt', ratio: t.ratio, label: t.label, aux: true };
      links.push({ from: t.id, to: host, kind: 'pt' });
    });
    ((model && model.ansiRelays) || []).forEach(r => {
      const a = (r.itAssignment && (r.itAssignment.ctIds || []).concat(r.itAssignment.ptIds || [])) || [];
      const anchors = a.filter(id => nodes[id]);
      if (!anchors.length) return;
      const at = place(anchors[0]);
      if (!at) return;
      nodes[r.id] = { x: at.x, y: at.y, type: 'relay', ansi: r.ansiNumber,
                      label: r.label, enabled: r.enabled !== false, aux: true };
      anchors.forEach(id => links.push({ from: r.id, to: id, kind: nodes[id].type === 'pt' ? 'pt' : 'ct' }));
    });

    /* ---- 7. fill the canvas ----
       Everything is on the drawing now — places, in-line hardware, relays, PTs — so this is the
       first moment the real extent is known. Stretch x until the drawing has the shape of the
       box it has to live in. The earlier pass in treeLayout could only see the places, and the
       protection layer sits OUTSIDE the network's hull, so it changed the answer: on the demo
       plant the tree came out at 2.2 : 1 for a 2.6 : 1 box, and the fit then had to shrink the
       whole thing to fit the taller shape. Symbols keep their screen size, so stretching x buys
       spacing and costs nothing.

       Then route once more — the conductors have to follow the positions they actually end up at. */
    if (opts.aspect) {
      const ids2 = Object.keys(nodes);
      const xs2 = ids2.map(i2 => nodes[i2].x), ys2 = ids2.map(i2 => nodes[i2].y);
      const bw2 = Math.max.apply(null, xs2) - Math.min.apply(null, xs2);
      const bh2 = Math.max.apply(null, ys2) - Math.min.apply(null, ys2);
      if (bw2 > 1 && bh2 > 1) {
        const f2 = Math.max(0.4, Math.min(4, (opts.aspect * bh2) / bw2));
        if (Math.abs(f2 - 1) > 0.02) {
          ids2.forEach(i2 => (nodes[i2].x = Math.round(nodes[i2].x * f2)));
          edges = NS.reroute(nodes, pairs, opts);
        }
      }
    }

    /* Hops from the infeed — the order you would draw the thing on a whiteboard, and what a
       slide reveals against so the network grows outward from the utility. Devices, relays and
       PTs inherit the depth of what they sit on, so a reveal never shows a relay before the
       feeder it protects. */
    const depth = {};
    const q2 = seeds.slice(); seeds.forEach(s => (depth[s] = 0));
    while (q2.length) {
      const u = q2.shift();
      adj[u].forEach(v => { if (depth[v] === undefined) { depth[v] = depth[u] + 1; q2.push(v); } });
    }
    els.forEach(e => { if (depth[e.id] === undefined) depth[e.id] = 0; });
    devices.forEach(d => { depth[d.dv.id] = Math.max(depth[d.dv.from] || 0, depth[d.dv.to] || 0); });
    links.forEach(l => { if (depth[l.from] === undefined) depth[l.from] = depth[l.to] || 0; });
    links.forEach(l => { depth[l.from] = Math.max(depth[l.from] || 0, depth[l.to] || 0); });
    Object.keys(nodes).forEach(id => { if (depth[id] === undefined) depth[id] = 0; });
    Object.keys(nodes).forEach(id => { if (level[id] === undefined) {
      // a device/relay takes the band of whatever it hangs on, so band colouring stays honest
      const near = pairs.concat(links).find(p => p.from === id || p.to === id);
      const other = near && (near.from === id ? near.to : near.from);
      level[id] = (other && level[other]) || 0;
    } });

    return { nodes, edges, links: links, bands: bandIdx.length, crossings: bestCross, how: how,
             level: level, depth: depth,
             maxDepth: Math.max.apply(null, Object.keys(depth).map(k => depth[k])),
             elements: Object.keys(nodes).length, conductors: edges.length };
  };

  /* ======================================================================
   *  OneLine — schematic one-line with animated power/current flow
   * ==================================================================== */
  NS.OneLine = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {}; const cal = C, TAU = C.TAU;
    const state = { map: null, view: { z: 1, ox: 0, oy: 0 } };
    // A conductor's identity for keying user waypoints. Direction matters — the bend order runs
    // from→to — so this is NOT sorted like the decoration key; it mirrors L.edges' own from/to.
    const ekeyOf = (a, b) => a + '~>' + b;
    /* ---- viewport: zoom and pan on top of the auto-fit -----------------------------------
       The fit already sizes the whole network to the canvas. This is the magnifier the room
       asks for the moment someone says "what's on that 480 V feeder?" — and it sits OUTSIDE
       the fit, so symbols, name tags and conductor weights all grow together instead of the
       drawing merely getting denser.

       Pan is CLAMPED so the scaled drawing always covers the canvas: at zoom 1 there is
       nowhere to pan to, and at any zoom you cannot drag the diagram off an edge and be left
       staring at blank canvas in front of an audience.

       Zoom is DAMPED, and that is the whole design. On an auto-laid-out model, positions scale
       with the full zoom while symbols and name tags scale with z^zoomDamp — so magnifying a
       one-line SPREADS THE CROWDED SECTION OUT rather than just making two symbols enormous.
       Which is the actual reason anyone zooms into a one-line: at 3x, a 480 V section that was
       too tight to hold its breakers has room for them, and they come back. `zoomDamp: 1` gives
       plain uniform magnification if that is what you want; a hand-authored diagram (no model)
       is always uniform, because there is no layout to spread. */
    function clampView(W, H) {
      const v = state.view;
      v.z = Math.max(cfg.minZoom == null ? 0.35 : cfg.minZoom,
                     Math.min(cfg.maxZoom == null ? 16 : cfg.maxZoom, v.z));
      /* One rule for both directions. Zoomed IN the drawing is bigger than the canvas, so it may
         be pushed around but never off an edge: the offset lives in [W(1−z), 0]. Zoomed OUT it is
         smaller than the canvas, so the same interval flips and becomes [0, W(1−z)] — anywhere
         from flush-left to flush-right, still never off an edge. Taking the min and max of the
         two ends covers both without a special case. */
      const rx = W * (1 - v.z), ry = H * (1 - v.z);
      v.ox = Math.max(Math.min(0, rx), Math.min(Math.max(0, rx), v.ox));
      v.oy = Math.max(Math.min(0, ry), Math.min(Math.max(0, ry), v.oy));
      return v;
    }
    /* ---- symbol vocabulary --------------------------------------------------------------
       These are the PFAS one-line symbols at their source proportions (see
       C:\PFAS src/components/oneLineDiagram/ElementRenderers.tsx), so an engineer who works in
       PFAS reads this diagram without re-learning it. Two families:

         · things that ARE a node — bus bar, source, generator, load — drawn as a FILLED shape
           in the element's category colour, outlined in ink.
         · things that sit IN a conductor — transformer, breaker, fuse, CT, series impedance —
           drawn as a stroked outline over an OPAQUE body, so the conductor passes behind them
           and the run reads as entering the terminal. That opacity is what lets the router aim
           every conductor at a symbol's centre and still look like it lands on a terminal.

       `ang` is the axis between the element's two terminals, snapped to a cardinal direction.
       PFAS orients every in-line device along it, so a breaker in a vertical drop draws
       vertically and one in a horizontal tie draws horizontally. Pass null for the default
       (vertical for a transformer or a shunt, horizontal otherwise). */
    const PFAS_INK = { bus: '#1976d2', source: '#e07000', gen: '#2f8f34', xfmr: '#8e24aa',
                       load: '#d32f2f', breaker: '#2f8f34', fuse: '#e07000', ct: '#0097a7',
                       line: '#546e7a', cap: '#0f6e56', reactor: '#b45309',
                       relay: '#546e7a', pt: '#2E7D32' };
    /* PFAS colours a relay by what it DOES, not by what it is — the same grouping an engineer
       already carries around (RelayRenderer.tsx getRelayColor). */
    const ANSI_INK = { '50': '#1976d2', '50N': '#1976d2', '51': '#1976d2', '51N': '#1976d2',
                       '27': '#e07000', '47': '#e07000', '59': '#e07000', '60': '#e07000',
                       '21': '#8e24aa', '87': '#d32f2f', '87T': '#d32f2f', '87B': '#d32f2f',
                       '87L': '#d32f2f', '32': '#795548', '67': '#795548', '67N': '#795548' };
    // the two sensing circuits, as PFAS colours them: current blue, voltage green
    const SENSE = { ct: '#0091EA', pt: '#2E7D32' };
    const symInk = (type, ink) => (cfg.palette === 'ink' ? ink : (PFAS_INK[type] || ink));
    /* A bus bar that is wide enough carries its own name, in white, inside the bar. It reads
       better than a tag hanging off the end, and it costs the fitter NOTHING: the widest bus on
       a plant is also the one with the longest name, and between them the bar and the tag were
       eating a third of the canvas width as reserved margin. */
    const nameInBar = (n, tw) => n.type === 'bus' && tw > 0 && (n.w || 0) * 2 >= tw + 22;
    /** Snap a direction to the nearest cardinal — a one-line is orthogonal, and it keeps the
     *  winding glyphs upright instead of tilting them a few degrees off. */
    function cardinal(dx, dy) {
      if (!dx && !dy) return null;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : Math.PI) : (dy > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    function sym(ctx, n, ink, mut, ang) {
      // state.symK is the zoom's damped share — 1 at rest, and the only thing that changes here
      const s = (cfg.symScale || 1) * (state.symK || 1), bg = cfg.bg || '#ffffff';
      const col = symInk(n.type, ink);
      const vertDefault = n.type === 'xfmr' || n.type === 'cap' || n.type === 'reactor';
      const a = ang == null ? (vertDefault ? Math.PI / 2 : 0) : ang;
      const ux = Math.cos(a), uy = Math.sin(a);      // primary → secondary / from → to
      const qx = -uy, qy = ux;                       // perpendicular
      // (u along the axis, v across it) → canvas point. Every symbol below is written in those
      // coordinates, exactly as PFAS writes them relative to its element origin.
      const P = (u, v) => ({ x: n.x + (ux * u + qx * v) * s, y: n.y + (uy * u + qy * v) * s });
      const path = (pts, close) => {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (close) ctx.closePath();
      };
      const run = (u0, v0, u1, v1) => { path([P(u0, v0), P(u1, v1)]); ctx.stroke(); };
      const disc = (u, v, r, fill) => {
        const c = P(u, v);
        ctx.beginPath(); ctx.arc(c.x, c.y, r * s, 0, TAU);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        ctx.stroke();
      };
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2 * s;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';

      if (n.type === 'bus') {
        // PFAS: a bar spanning its tap nodes, min half-width 40, +14 margin. n.w already carries
        // that span (in screen units on the fixed-symbol path), so it is NOT scaled again.
        const w = n.w || 40, h = 5 * s;
        ctx.fillStyle = col; ctx.fillRect(n.x - w, n.y - h, w * 2, h * 2);
        ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(n.x - w, n.y - h, w * 2, h * 2);

      } else if (n.type === 'source' || n.type === 'gen') {
        // PFAS: a filled circle radius 20 carrying a white glyph — "~" for the utility, "G" on site.
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
        disc(0, 0, 20, col);
        D.label(ctx, n.type === 'source' ? '∼' : 'G', n.x, n.y + (n.type === 'source' ? 1 : 0) * s,
                '#fff', (n.type === 'source' ? 22 : 17) * s, true, 'center');

      } else if (n.type === 'xfmr') {
        // PFAS: two windings overlapping by 6, each carrying its connection glyph — a triangle
        // for delta, a three-legged Y for wye — plus a ground rake for wye-grounded, and P/S
        // designations on the side opposite the ground. Primary sits toward the upstream terminal.
        const r = 18, d = r - 3;                                          // centres at ∓15
        ctx.fillStyle = bg;
        ctx.strokeStyle = col; ctx.lineWidth = 2 * s;
        disc(-d, 0, r, bg); disc(d, 0, r, bg);                            // secondary drawn last, covers the lap
        // The winding glyph stays UPRIGHT however the transformer is oriented — as PFAS does it —
        // so a delta reads as a triangle and a wye as a Y instead of tipping onto its side.
        const winding = (u, isDelta) => {
          const c = P(u, 0);
          const seg = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(c.x + x0 * s, c.y + y0 * s); ctx.lineTo(c.x + x1 * s, c.y + y1 * s); ctx.stroke(); };
          if (isDelta) {
            ctx.beginPath();
            ctx.moveTo(c.x, c.y - 10 * s); ctx.lineTo(c.x - 8.7 * s, c.y + 5 * s); ctx.lineTo(c.x + 8.7 * s, c.y + 5 * s);
            ctx.closePath(); ctx.stroke();
          } else { seg(0, 0, 0, 8); seg(0, 0, -6, -8); seg(0, 0, 6, -8); }
        };
        const ground = u => {
          run(u, r + 2, u, r + 8);                                        // lead out along +perp
          [[0, 6], [3, 4], [6, 2]].forEach((b, i) => {
            ctx.lineWidth = (2 - i * 0.5) * s;
            run(u - b[1], r + 8 + b[0], u + b[1], r + 8 + b[0]);
          });
          ctx.lineWidth = 2 * s;
        };
        const isD = c => c === 'Delta', isG = c => c === 'Wye-G';
        const cp = n.cp || 'Wye', cs = n.cs || 'Wye';
        winding(-d, isD(cp)); if (isG(cp)) ground(-d);
        winding(d, isD(cs)); if (isG(cs)) ground(d);
        const pl = P(-d, -(r + 10)), sl = P(d, -(r + 10));
        D.label(ctx, 'P', pl.x, pl.y, mut, 10 * s, true, 'center');
        D.label(ctx, 'S', sl.x, sl.y, mut, 10 * s, true, 'center');

      } else if (n.type === 'load') {
        // PFAS: a filled ▽ centred on the node, so the feeder drops into the middle of it.
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
        path([P(-14, -16), P(-14, 16), P(14, 0)], true);
        ctx.fillStyle = col; ctx.fill(); ctx.stroke();

      } else if (n.type === 'breaker') {
        // PFAS: a square body on the conductor, green closed / red open, with stubs to the terminals.
        const sq = 11;
        if (n.status === 'open') { ctx.strokeStyle = '#d32f2f'; ctx.fillStyle = '#d32f2f'; }
        ctx.lineWidth = 1.9 * s;
        run(-sq - 9, 0, -sq, 0); run(sq, 0, sq + 9, 0);
        path([P(-sq, -sq), P(sq, -sq), P(sq, sq), P(-sq, sq)], true);
        ctx.fillStyle = bg; ctx.fill(); ctx.stroke();
        if (n.status === 'open') { run(-sq + 3, 0, -3, 0); run(3, 0, sq - 3, 0); }

      } else if (n.type === 'fuse') {
        // PFAS: a cartridge — stadium body with a filament through it — and stubs.
        const hw = 16, hh = 7;
        ctx.lineWidth = 1.9 * s;
        run(-hw - 6, 0, -hw, 0); run(hw, 0, hw + 6, 0);
        const c1 = P(-hw + hh, 0), c2 = P(hw - hh, 0), t1 = P(-hw + hh, -hh);
        ctx.beginPath();
        ctx.moveTo(t1.x, t1.y);
        ctx.lineTo(P(hw - hh, -hh).x, P(hw - hh, -hh).y);
        ctx.arc(c2.x, c2.y, hh * s, a - Math.PI / 2, a + Math.PI / 2);     // right cap
        ctx.lineTo(P(-hw + hh, hh).x, P(-hw + hh, hh).y);
        ctx.arc(c1.x, c1.y, hh * s, a + Math.PI / 2, a + Math.PI * 1.5);   // left cap
        ctx.closePath(); ctx.fillStyle = bg; ctx.fill(); ctx.stroke();
        run(-hw + 3, 0, hw - 3, 0);                                        // filament

      } else if (n.type === 'ct') {
        // PFAS: a toroid on the primary conductor, with the secondary winding tick to one side.
        const r = 12;
        ctx.lineWidth = 1.6 * s;
        run(-(r + 8), 0, r + 8, 0);                                        // primary bar through the core
        disc(0, 0, r, 'rgba(0,0,0,0)');
        run(-6, 4, 6, 4);                                                  // secondary tick

      } else if (n.type === 'line') {
        // PFAS: a series-impedance zigzag drawn along the terminal axis, with stubs to the nodes.
        const zz = 16, sf = zz / 25;
        ctx.lineWidth = 2 * s;
        path([[-25, 0], [-20, -10], [-10, 10], [0, -10], [10, 10], [20, -10], [25, 0]]
          .map(p => P(p[0] * sf, p[1] * sf)));
        ctx.stroke();
        run(-zz, 0, -zz - 7, 0); run(zz, 0, zz + 7, 0);

      } else if (n.type === 'relay') {
        // PFAS: a filled disc of radius 14 carrying its ANSI number in white. A disabled relay
        // greys out rather than disappearing — "it is here and it is off" is the useful reading.
        const rc = n.enabled === false ? '#9e9e9e' : (ANSI_INK[n.ansi] || col);
        ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
        disc(0, 0, 14, rc);
        D.label(ctx, n.ansi || 'R', n.x, n.y, '#fff', 11 * s, true, 'center');

      } else if (n.type === 'pt') {
        // PFAS: a small upright body with the winding diagonal through it. Shunt-connected, so
        // its attachment to the bus is a dotted tap rather than a conductor.
        ctx.lineWidth = 1.6 * s;
        ctx.beginPath();
        const c0 = P(-10, -8), c1 = P(10, -8), c2 = P(10, 8), c3 = P(-10, 8);
        ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y);
        ctx.closePath(); ctx.fillStyle = bg; ctx.fill(); ctx.stroke();
        ctx.lineWidth = 1.2 * s; run(-5, -4, 5, 4);

      } else if (n.type === 'cap' || n.type === 'reactor') {
        // PFAS: a shunt hangs off its single terminal into a ground stub. PFAS puts that terminal
        // 18 above the element origin; here the conductor lands ON the node, so the whole glyph
        // is written below it — the drop enters the top lead and the rake closes it to earth.
        ctx.lineWidth = 1.6 * s;
        if (n.type === 'cap') {
          run(0, 0, 12, 0);
          ctx.lineWidth = 3 * s; run(12, -12, 12, 12); run(18, -12, 18, 12);
          ctx.lineWidth = 1.6 * s; run(18, 0, 28, 0);
        } else {
          run(0, 0, 8, 0);
          [-6, 0, 6].forEach(v => disc(13, v, 4, 'rgba(0,0,0,0)'));
          run(17, 0, 28, 0);
        }
        run(28, -7, 28, 7);                                                // ground
      }
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      // labels are placed in a second pass (drawLabels) so they can dodge each other
    }
    /* A name tag nobody can read is worse than no name tag. Each label tries its natural spot
       first, then a short list of alternatives, and takes the first that collides with nothing
       already placed — the cheap version of the layout scorer's label-overlap term. */
    function drawLabels(ctx, list, mut, obstacles) {
      const fs = (cfg.labelSize || 12.5) * (state.symK || 1);
      /* The symbols themselves are obstacles, not just the other labels. Bus bars are wide,
         solid and often the nearest thing to a neighbour's name — without this a feeder name
         lands squarely on the next switchboard's bar and neither can be read. */
      const placed = (obstacles || []).slice();
      /* A candidate that falls off the canvas is not a candidate. Without this the fitter has to
         reserve a full name-height above the top row and below the bottom one against the chance
         a label goes there — 48 px of a 370 px canvas spent on something that almost never
         happens. Rule it out here instead and the margin can be honest. */
      const CW = ctx.canvas.width, CH = ctx.canvas.height;
      const onCanvas = b => b.cx - b.hw > -2 && b.cx + b.hw < CW + 2 && b.cy - b.hh > -2 && b.cy + b.hh < CH + 2;
      const clear = b => onCanvas(b) &&
        !placed.some(p => Math.abs(p.cx - b.cx) < p.hw + b.hw && Math.abs(p.cy - b.cy) < p.hh + b.hh);
      ctx.font = '600 ' + fs + 'px "Segoe UI",system-ui,sans-serif';
      list.forEach(n => {
        if (!n.label) return;
        const tw = ctx.measureText(n.label).width, hh = fs * 0.9;
        if (nameInBar(n, tw)) {
          /* A tag ON the bar, in the bar's own colour, so it reads as the bar swelling to carry
             its name. Plain white text would be illegible: a PFAS bus bar is 10 px tall and the
             name is 14 px, so it would spill onto the background above and below it. */
          const th = fs * 0.86;
          ctx.save();
          ctx.fillStyle = symInk('bus', mut);
          if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(n.x - tw / 2 - 9, n.y - th, tw + 18, th * 2, 4); ctx.fill(); }
          else ctx.fillRect(n.x - tw / 2 - 9, n.y - th, tw + 18, th * 2);
          ctx.restore();
          D.label(ctx, n.label, n.x, n.y + 0.5, cfg.barInk || '#fff', fs, true, 'center');
          return;
        }
        // clear the symbol itself — these are the PFAS footprints, not a fixed 22 px
        const sb = SYM_BOX[n.type] || [18, 18], ss = (cfg.symScale || 1) * (state.symK || 1);
        const gap = (n.type === 'bus' ? (n.w || 40) : sb[0] * ss) + 8;
        const vgap = sb[1] * ss + fs * 0.9;
        const cands = n.lx != null
          ? [{ x: n.x + n.lx, y: n.y + (n.ly || 0), a: n.lx < 0 ? 'right' : 'left' }]
          : [{ x: n.x + gap, y: n.y, a: 'left' },
             { x: n.x - gap, y: n.y, a: 'right' },
             { x: n.x, y: n.y - vgap, a: 'center' },
             { x: n.x, y: n.y + vgap, a: 'center' },
             { x: n.x + gap, y: n.y - fs * 1.6, a: 'left' },
             { x: n.x + gap, y: n.y + fs * 1.6, a: 'left' },
             { x: n.x - gap, y: n.y - fs * 1.6, a: 'right' },
             { x: n.x - gap, y: n.y + fs * 1.6, a: 'right' },
             // last resorts: clear of the bar entirely, one or two lines off
             { x: n.x, y: n.y - vgap - fs * 1.5, a: 'center' },
             { x: n.x, y: n.y + vgap + fs * 1.5, a: 'center' }];
        /* First candidate that collides with nothing wins. If EVERY spot is taken — a crowded
           480 V section, say — take the least-bad one rather than the first, so the name that has
           to overlap something overlaps as little of it as possible instead of landing squarely
           on a neighbour's bar. */
        let pick = null, bestOv = Infinity, fallback = cands[0];
        for (const c of cands) {
          const cx = c.a === 'right' ? c.x - tw / 2 : c.a === 'center' ? c.x : c.x + tw / 2;
          const b = { cx, cy: c.y, hw: tw / 2 + 6, hh };
          if (clear(b)) { pick = c; break; }
          let ov = placed.reduce((acc, p) => acc +
            Math.max(0, p.hw + b.hw - Math.abs(p.cx - b.cx)) * Math.max(0, p.hh + b.hh - Math.abs(p.cy - b.cy)), 0);
          if (!onCanvas(b)) ov += 1e6;              // off the edge is worse than any overlap
          if (ov < bestOv) { bestOv = ov; fallback = c; }
        }
        if (!pick) pick = fallback;
        const cx = pick.a === 'right' ? pick.x - tw / 2 : pick.a === 'center' ? pick.x : pick.x + tw / 2;
        placed.push({ cx, cy: pick.y, hw: tw / 2 + 6, hh });
        ctx.fillStyle = cfg.halo || 'rgba(247,250,252,.88)';
        ctx.fillRect(cx - tw / 2 - 3, pick.y - hh, tw + 6, hh * 2);
        D.label(ctx, n.label, pick.x, pick.y, n.labelColor || mut, fs, true, pick.a);
      });
    }
    /** Bounding box of a node's symbol, including its label box. */
    function extents(ctx, n) {
      const ss = cfg.symScale || 1, b = SYM_BOX[n.type] || [12, 12];
      let x0 = n.x - b[0] * ss, x1 = n.x + b[0] * ss, y0 = n.y - b[1] * ss, y1 = n.y + b[1] * ss;
      if (n.type === 'bus') { const w = n.w || 40; x0 = n.x - w; x1 = n.x + w; y0 = n.y - 6 * ss; y1 = n.y + 6 * ss; }
      else if (n.type === 'cap' || n.type === 'reactor') { y0 = n.y - 4 * ss; y1 = n.y + 34 * ss; }
      if (n.label) {
        ctx.font = '600 12.5px "Segoe UI",system-ui,sans-serif';
        const tw = ctx.measureText(n.label).width, lx = n.x + (n.lx != null ? n.lx : 24), ly = n.y + (n.ly || 0);
        const a = n.lx < 0 ? lx - tw : lx;
        x0 = Math.min(x0, a - 4); x1 = Math.max(x1, a + tw + 4); y0 = Math.min(y0, ly - 10); y1 = Math.max(y1, ly + 10);
      }
      return [x0, y0, x1, y1];
    }
    /* A `model` ({elements, connections}) is laid out once by NS.autoLayout and cached —
       the relaxation is a multi-start search, far too expensive to run per frame. */
    function laidOut() {
      const m = typeof cfg.model === 'function' ? cfg.model() : cfg.model;
      if (!m || !m.elements) return null;
      const aspect = state.aspect || 2.6;
      const sig = m.elements.length + ':' + ((m.connections || []).length) + ':' + JSON.stringify(cfg.layout || {});
      /* The target aspect is only known after the labels have been measured, which needs a layout
         first — so the second frame refines the first. Bus bars resize with their taps, so an
         undamped loop could re-solve on EVERY frame; only a materially different shape (>12%)
         re-runs the search, and it settles after one refinement. */
      const settled = state.laidAspect != null && Math.abs(aspect - state.laidAspect) / state.laidAspect < 0.12;
      if (!state.laid || state.sig !== sig || !settled) {
        const opt = Object.assign({ aspect: aspect }, cfg.layout || {});
        // relayout({reseed}) bumps the seed so a fresh solve gives a DIFFERENT arrangement —
        // otherwise the same seed just recomputes the same picture.
        if (state.seedBump) opt.seed = (opt.seed || 1) + state.seedBump;
        state.laid = NS.autoLayout(m, opt);
        state.sig = sig; state.laidAspect = aspect; state.laidN = (state.laidN || 0) + 1;
      }
      return state.laid;
    }
    function draw(ctx, t) {
      if (state.aspect == null) state.aspect = Math.round((ctx.canvas.width / Math.max(1, ctx.canvas.height)) * 100) / 100;
      const L = laidOut();
      let nodes = L ? L.nodes : (cfg.nodes || {});
      let edges;
      if (L) {
        /* Dragged symbols are stored as offsets in MODEL space, so the arrangement survives a
           resize and the whole run is re-routed from the new position — taps slide, bars resize,
           conductors stay orthogonal. Exactly what a one-line editor has to do. */
        const moved = state.moved || null, wp = state.wp || null;
        const anyMoved = moved && Object.keys(moved).length;
        const anyWp = wp && Object.keys(wp).length;
        if (anyMoved || anyWp) {
          /* The router searches ~15 candidate paths per conductor against everything already
             placed, so it is not something to run 60 times a second while a symbol or a bend is
             held. The arrangement only changes when something actually moves — cache on a
             signature of both the dragged symbols and the user's bend points. */
          const wsig = anyWp ? Object.keys(wp).sort().map(kk =>
            kk + ':' + wp[kk].map(p => Math.round(p.x) + ',' + Math.round(p.y)).join('|')).join(';') : '';
          const msig = (state.laidN || 0) + '#' + (anyMoved ? Object.keys(moved).sort().map(id =>
            id + ':' + Math.round(moved[id].dx) + ',' + Math.round(moved[id].dy)).join(';') : '') + '#' + wsig;
          if (state.msig !== msig || !state.mnodes) {
            const n2 = {};
            Object.keys(nodes).forEach(id => {
              const m = moved && moved[id];
              n2[id] = m ? Object.assign({}, nodes[id], { x: nodes[id].x + m.dx, y: nodes[id].y + m.dy }) : Object.assign({}, nodes[id]);
            });
            state.medges = NS.reroute(n2, L.edges.map(e => ({ from: e.from, to: e.to, decor: e.decor,
              wp: wp && wp[ekeyOf(e.from, e.to)] })), cfg.layout || {});
            state.mnodes = n2; state.msig = msig;
          }
          nodes = state.mnodes;
          edges = state.medges;
        } else {
          edges = L.edges;
        }
        edges = edges.map(e => Object.assign({}, e, typeof cfg.flow === 'function' ? (cfg.flow(e, nodes) || {}) : {}));
      } else {
        edges = typeof cfg.edges === 'function' ? cfg.edges() : (cfg.edges || []);
      }
      const ink = cfg.ink || '#0f1c26', mut = cfg.muted || '#5a6b78';
      // Nodes are authored in their own pixel space; fit that drawing to whatever canvas we get.
      const W = ctx.canvas.width, H = ctx.canvas.height, pad = cfg.pad == null ? 16 : cfg.pad;
      state.W = W; state.H = H;
      const V = clampView(W, H);
      const fixedSyms = cfg.symbols ? cfg.symbols === 'fixed' : !!L;
      let k = 1, tx = 0, ty = 0;
      if (cfg.fit !== false) {
        const rs = cfg.reserve || {};
        const boxW = Math.max(40, W - 2 * pad - (rs.l || 0) - (rs.r || 0));
        const boxH = Math.max(40, H - 2 * pad - (rs.t || 0) - (rs.b || 0));
        const originX = pad + (rs.l || 0), originY = pad + (rs.t || 0);

        if (fixedSyms) {
          /* ---- exact fit for fixed-size symbols ----------------------------------------
             Positions scale with k; symbols and name tags do NOT. So the drawing's width is
             not `extent * k` — it is `max(x*k + reachRight) - min(x*k - reachLeft)`, where the
             reach of each symbol is a constant number of pixels. Solving that properly is what
             stops the fitter reserving the longest name in the model along the whole right-hand
             edge: a long bus name on a bus that sits well inside the drawing is paid for by the
             positions to its right, not by the margin. On the demo plant the old estimate spent
             a third of the width and 42% of the height on margin.

             Monotone in k, so bisect it — exact, and it settles inside one frame instead of
             chasing the previous frame's answer. */
          const ss0 = cfg.symScale || 1, fs0 = cfg.labelSize || 12.5;
          ctx.font = '600 ' + fs0 + 'px "Segoe UI",system-ui,sans-serif';
          const ids0 = Object.keys(nodes), reach = {};
          ids0.forEach(id => {
            const n = nodes[id], b = SYM_BOX[n.type] || [18, 18];
            const hw = n.type === 'bus' ? (n.w || 40) : b[0] * ss0, hh = b[1] * ss0;
            let tw = n.label ? ctx.measureText(n.label).width : 0;
            if (nameInBar(n, tw)) tw = 0;              // it lives inside the bar; costs no margin
            const drop = (n.type === 'cap' || n.type === 'reactor') ? 30 * ss0 : 0;
            reach[id] = {
              r: hw + (tw ? 8 + tw + 6 : 2),
              // a name tag prefers the right; budget a share of it on the left for the ones that dodge
              l: hw + (tw ? Math.min(tw, 46) * 0.4 : 2),
              t: hh + (tw ? fs0 * 0.8 : 4),
              b: hh + drop + (tw ? fs0 * 0.8 : 4),
            };
          });
          const spanOf = (kk, ax) => {
            let lo = Infinity, hi = -Infinity;
            ids0.forEach(id => {
              const v = (ax === 'x' ? nodes[id].x : nodes[id].y) * kk, r2 = reach[id];
              lo = Math.min(lo, v - (ax === 'x' ? r2.l : r2.t));
              hi = Math.max(hi, v + (ax === 'x' ? r2.r : r2.b));
            });
            return { lo: lo, hi: hi, size: hi - lo };
          };
          const fits = kk => spanOf(kk, 'x').size <= boxW && spanOf(kk, 'y').size <= boxH;
          let lo2 = 0, hi2 = cfg.maxScale || 2.4;
          if (!fits(hi2)) { for (let i = 0; i < 34; i++) { const mid = (lo2 + hi2) / 2; if (fits(mid)) lo2 = mid; else hi2 = mid; } k = lo2; }
          else k = hi2;
          if (cfg.minScale != null) k = Math.max(cfg.minScale, k);
          const sx2 = spanOf(k, 'x'), sy2 = spanOf(k, 'y');
          tx = originX - sx2.lo + (boxW - sx2.size) / 2;
          ty = originY - sy2.lo + (boxH - sy2.size) / 2;
          /* Ask the layout for the shape of the box the POSITIONS get — the canvas box less the
             fixed pixels the symbols and name tags eat out of it. Handing it the raw canvas
             aspect makes it lay out a shape that cannot fit, and the fitter then shrinks
             everything to compensate: the drawing ends up using two thirds of the width it was
             given. Both are known now, so the target is exact. */
          const p0 = spanOf(0, 'x'), q0 = spanOf(0, 'y');
          const freeW = Math.max(40, boxW - p0.size), freeH = Math.max(40, boxH - q0.size);
          state.aspect = Math.round((freeW / freeH) * 100) / 100;
        } else {
          let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
          Object.keys(nodes).forEach(id => { const e = extents(ctx, nodes[id]); X0 = Math.min(X0, e[0]); Y0 = Math.min(Y0, e[1]); X1 = Math.max(X1, e[2]); Y1 = Math.max(Y1, e[3]); });
          const bw = X1 - X0, bh = Y1 - Y0;
          if (isFinite(bw) && bw > 0 && bh > 0) {
            k = Math.min(boxW / bw, boxH / bh);
            k = Math.max(cfg.minScale != null ? cfg.minScale : 0.4, Math.min(cfg.maxScale || 2.4, k));
            tx = originX + (boxW - bw * k) / 2 - X0 * k;
            ty = originY + (boxH - bh * k) / 2 - Y0 * k;
          }
        }
      }
      state.kPrev = k;
      state.map = v => {                                                  // a node id, or authored {x,y}
        const n = typeof v === 'string' ? nodes[v] : v;
        return n ? [V.ox + (tx + n.x * k) * V.z, V.oy + (ty + n.y * k) * V.z] : null;
      };

      /* Symbol scale. A hand-authored diagram scales as a whole (unchanged). An auto-laid-out
         model must NOT: a plant with thirty symbols would shrink each one to an illegible speck.
         So positions are mapped but symbols and labels keep their size on screen — the drawing
         gets denser, never smaller. */
      const fixed = cfg.symbols ? cfg.symbols === 'fixed' : !!L;
      let drawNodes = nodes, drawEdges = edges;
      if (fixed) {
        const P = p => ({ x: V.ox + (tx + p.x * k) * V.z, y: V.oy + (ty + p.y * k) * V.z });
        // the inverse, so a click on the canvas becomes a model-space point for a new bend
        state.toModel = (px, py) => ({ x: ((px - V.ox) / V.z - tx) / k, y: ((py - V.oy) / V.z - ty) / k });
        state.editable = L && cfg.reshape !== false;
        drawNodes = {};
        Object.keys(nodes).forEach(id => { const n = nodes[id], m = P(n); drawNodes[id] = Object.assign({}, n, { x: m.x, y: m.y }); });
        drawEdges = edges.map(e => Object.assign({}, e, {
          points: (e.points || []).map(P),
          fromPt: e.fromPt && P(e.fromPt), toPt: e.toPt && P(e.toPt),
        }));
        // a bus bar spans its taps — in screen units now, so it still meets every dropper, and
        // still capped short of the next bus on the row so two bars never read as one
        const busIds2 = Object.keys(drawNodes).filter(id => drawNodes[id].type === 'bus');
        busIds2.forEach(id => {
          let span = 26, room = Infinity;
          drawEdges.forEach(e => {
            if (e.from === id && e.fromPt) span = Math.max(span, Math.abs(e.fromPt.x - drawNodes[id].x));
            if (e.to === id && e.toPt) span = Math.max(span, Math.abs(e.toPt.x - drawNodes[id].x));
          });
          busIds2.forEach(o => {
            if (o === id || Math.abs(drawNodes[o].y - drawNodes[id].y) > 12) return;
            room = Math.min(room, Math.abs(drawNodes[o].x - drawNodes[id].x) / 2 - 9);
          });
          drawNodes[id].w = Math.round(Math.max(14, Math.min(span + 10, room)));
        });
      }
      /* symK: how much the SYMBOLS grow for this zoom. Positions always take the full z (they
         are baked into the mapped points below); symbols and labels take the damped share. */
      /* Damping applies to magnifying only. Zooming OUT uniformly is what you want — "the whole
         thing, smaller" — whereas a damped shrink would leave the symbols relatively LARGER than
         the spacing and pile them on top of each other, the opposite of the point. */
      const zDamp = cfg.zoomDamp == null ? 0.5 : cfg.zoomDamp;
      const symK = fixed ? (V.z >= 1 ? Math.pow(V.z, zDamp) : V.z) : 1;
      state.symK = symK;
      ctx.save();
      // A hand-authored diagram has no layout to spread, so it zooms as one piece.
      if (!fixed) { ctx.translate(V.ox, V.oy); ctx.scale(V.z, V.z); ctx.translate(tx, ty); ctx.scale(k, k); }
      /* Progressive reveal: `show(id)` decides whether an element is on this build step, and
         `dim(id)` fades what is not the point yet. A one-line is explained by growing it out
         from the infeed, which is exactly what fragments drive. */
      const showFn = typeof cfg.show === 'function' ? cfg.show : null;
      const dimFn = typeof cfg.dim === 'function' ? cfg.dim : null;
      const visible = id => (showFn ? showFn(id, drawNodes[id], L) !== false : true);
      const alphaOf = id => (dimFn && dimFn(id, drawNodes[id], L) ? (cfg.dimAlpha == null ? 0.22 : cfg.dimAlpha) : 1);

      /* Secondary circuits first, so the power conductors and the symbols draw over them.
         Dotted and thin on purpose: a relay's connection to its CT is a signal path, and it must
         not read as another wire carrying fault current. PFAS colours them the same way —
         current sensing blue, voltage sensing green. */
      const links = L && L.links ? L.links : (cfg.links || []);
      if (links.length) {
        ctx.save();
        ctx.setLineDash([2 * (state.symK || 1) + 1, 4 * (state.symK || 1)]);
        ctx.lineWidth = 1.8 * (state.symK || 1);
        links.forEach(lk => {
          const a = drawNodes[lk.from], b = drawNodes[lk.to];
          if (!a || !b || !visible(lk.from) || !visible(lk.to)) return;
          ctx.globalAlpha = Math.min(alphaOf(lk.from), alphaOf(lk.to)) * 0.9;
          ctx.strokeStyle = SENSE[lk.kind] || SENSE.ct;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
        ctx.restore();
      }

      state.hidden = 0;
      drawEdges.forEach(e => {
        const a = drawNodes[e.from], b = drawNodes[e.to]; if (!a || !b) return;
        if (!visible(e.from) || !visible(e.to)) return;
        const ea = Math.min(alphaOf(e.from), alphaOf(e.to));
        ctx.save(); ctx.globalAlpha = ea;
        // autoLayout supplies an orthogonal polyline; a hand-authored edge is a straight run
        const pts = e.points && e.points.length > 1 ? e.points : [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
        ctx.strokeStyle = e.color || ink; ctx.lineWidth = e.w || (2 + Math.min(4, Math.abs(e.flow || 0) * 1.4));
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        const flow = e.flow || 0;
        if (flow !== 0) {
          const seg = [];                                  // cumulative lengths, so dots follow the bends
          let total = 0;
          for (let i = 1; i < pts.length; i++) {
            const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            seg.push({ a: pts[i - 1], b: pts[i], at: total, len: L }); total += L;
          }
          const at = d => {
            for (const s of seg) if (d <= s.at + s.len) {
              const f = s.len ? (d - s.at) / s.len : 0;
              return { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f };
            }
            return pts[pts.length - 1];
          };
          const dir = Math.sign(flow), spacing = 22, off = ((t * (cfg.flowSpeed || 46)) % spacing);
          ctx.fillStyle = e.flowColor || cal.SEQ.pos;
          for (let d = off; d < total - 4; d += spacing) {
            const p = at(dir > 0 ? d : total - d);
            ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, TAU); ctx.fill();
          }
        }
        // devices spliced out of the graph are drawn ON the run they belong to
        /* Devices spliced out of the graph are drawn ON the run they belong to, strung along its
           LONGEST straight segment and oriented along it — the way PFAS shows a breaker in a
           drop. Putting them at fractions of the whole polyline instead would drop a symbol onto
           a corner, where the body would swallow the bend. */
        if (e.decor && e.decor.length) {
          let sa = pts[0], sb = pts[1], best = -1;
          for (let i = 1; i < pts.length; i++) {
            const L2 = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            if (L2 > best) { best = L2; sa = pts[i - 1]; sb = pts[i]; }
          }
          const dvx = sb.x - sa.x, dvy = sb.y - sa.y;
          const ang = cardinal(dvx, dvy);
          /* A device needs room on the run. Draw as many as fit, longest-lived first: the
             switching device is the one the room is looking for, so a short drop keeps its
             breaker and gives up its instrument transformer rather than stacking both into an
             illegible blob on the bar. Whatever is left out is counted, not silently dropped. */
          const ss2 = (cfg.symScale || 1) * (state.symK || 1);
          const RANK = { breaker: 0, fuse: 1, line: 2, cap: 3, reactor: 4, ct: 5 };
          const room = best - 10, show2 = [];
          let used = 0;
          e.decor.slice()
            .map((dv, i) => ({ dv: dv, i: i }))
            .sort((p, q) => (RANK[p.dv.type] == null ? 9 : RANK[p.dv.type]) - (RANK[q.dv.type] == null ? 9 : RANK[q.dv.type]))
            .forEach(x => {
              const w2 = (SYM_BODY[x.dv.type] || 12) * 2 * ss2;
              if (used + w2 <= room) { used += w2; show2.push(x); }
            });
          state.hidden = (state.hidden || 0) + (e.decor.length - show2.length);
          show2.sort((p, q) => p.i - q.i);                       // back into the order along the run
          const m2 = show2.length;
          // keep the outermost device clear of each end, but never invert on a short run
          const inset = Math.min(0.42, 26 / Math.max(1, best));
          show2.forEach((x, i) => {
            const f = m2 === 1 ? 0.5 : inset + ((1 - 2 * inset) * i) / (m2 - 1);
            sym(ctx, { x: sa.x + dvx * f, y: sa.y + dvy * f, type: x.dv.type, status: x.dv.status },
                ink, mut, ang);
          });
        }
        ctx.restore();
      });
      const shownIds = Object.keys(drawNodes).filter(visible);
      // Symbol boxes, sized to the PFAS footprints. Two coordinate systems, and they are not the
      // same one: labels are drawn INSIDE the current transform, while a pointer arrives in final
      // canvas pixels — so the boxes are computed once and then mapped for hit-testing.
      const ss = (cfg.symScale || 1) * symK;
      const boxesLocal = shownIds.map(id => {
        const n = drawNodes[id];
        const b = SYM_BOX[n.type] || [18, 18];
        const hw = n.type === 'bus' ? (n.w || 40) : b[0] * ss;
        return { id, cx: n.x, cy: n.y, hw: hw, hh: (n.type === 'bus' ? 14 : b[1] * ss) };
      });
      // On the model path the boxes are already in canvas pixels (positions went through the
      // view, sizes through symK); a hand-authored diagram is still in its own space.
      state.boxes = fixed ? boxesLocal : boxesLocal.map(q => ({
        id: q.id, cx: V.ox + (tx + q.cx * k) * V.z, cy: V.oy + (ty + q.cy * k) * V.z,
        hw: q.hw * k * V.z, hh: q.hh * k * V.z,
      }));
      state.k = k * V.z;                                  // what nudge() divides a pixel drag by
      /* Editable-conductor geometry, in canvas pixels, for the drag layer: every drawn run so a
         click can find the segment it lands on, and every user bend point so its handle can be
         grabbed. Only the shown conductors, so a hidden feeder is not secretly editable. */
      if (state.editable) {
        state.paths = drawEdges.filter(e => visible(e.from) && visible(e.to))
          .map(e => ({ key: ekeyOf(e.from, e.to), pts: (e.points || []).slice(),
                       nwp: e.wp ? e.wp.length : 0 }));
        state.handles = [];
        state.paths.forEach(pp => {
          for (let i = 1; i <= pp.nwp; i++) state.handles.push({ key: pp.key, index: i - 1, x: pp.pts[i].x, y: pp.pts[i].y });
        });
      }
      /* A two-terminal symbol is oriented along the axis between its terminals — the transformer's
         primary winding ends up next to whatever feeds it, and a device in a horizontal tie lies
         down. Derived from the routed conductors, so it follows a drag. */
      const axisOf = id => {
        const legs = [];
        drawEdges.forEach(e => {
          const p = e.points; if (!p || p.length < 2) return;
          // the direction the conductor LEAVES this symbol — the first/last SEGMENT of the run,
          // so a bend the user pulled the wire into rotates the device with it
          if (e.from === id) legs.push({ dx: p[1].x - p[0].x, dy: p[1].y - p[0].y, o: drawNodes[e.to] });
          else if (e.to === id) legs.push({ dx: p[p.length - 2].x - p[p.length - 1].x,
                                           dy: p[p.length - 2].y - p[p.length - 1].y, o: drawNodes[e.from] });
        });
        if (legs.length < 2) return null;
        // Point the axis primary → secondary: toward whichever terminal is downstream (lower on
        // the page), so a transformer's P/S sit the right way up and a fuse points with the flow.
        let down = legs[0];
        legs.forEach(l => { if (l.o && (!down.o || l.o.y > down.o.y)) down = l; });
        const a = Math.atan2(down.dy, down.dx);
        /* Snap to the nearest cardinal only when it is ALREADY within ~7° of one — that kills the
           sub-pixel float error on an auto-routed orthogonal run while leaving a genuinely
           diagonal, user-reshaped segment tilted the way the user drew it. */
        const snap = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
        return Math.abs(a - snap) < 0.12 ? snap : a;
      };
      // Every in-line TWO-TERMINAL device orients to the conductor it sits in — not just the
      // transformer. A breaker, fuse, CT or series impedance lies along its run and turns with a
      // bend. Shunts (cap, reactor, load, source, gen, bus) have a fixed pose and are skipped.
      const ORIENTS = { xfmr: 1, line: 1, breaker: 1, fuse: 1, ct: 1 };
      shownIds.forEach(id => {
        ctx.save(); ctx.globalAlpha = alphaOf(id);
        const n = drawNodes[id];
        sym(ctx, n, ink, mut, ORIENTS[n.type] ? axisOf(id) : null);
        ctx.restore();
      });
      // labels last, over the conductors, dodging one another
      ctx.save();
      drawLabels(ctx, shownIds.filter(id => alphaOf(id) > 0.5).map(id => drawNodes[id]), mut,
        boxesLocal.map(b => ({ cx: b.cx, cy: b.cy, hw: b.hw, hh: Math.min(b.hh, 10) })));
      ctx.restore();
      /* Bend handles on top of everything: a small hollow dot at each user waypoint, so the room
         can see the run has been reshaped and where to grab it. Only when editing is on — a
         printed or captured figure shows the clean conductor, not the editing furniture. */
      if (state.editable && state.handles && state.handles.length && cfg.showHandles !== false) {
        const hr = 4.5 * Math.max(1, (state.symK || 1));
        ctx.save();
        state.handles.forEach(h => {
          ctx.beginPath(); ctx.arc(h.x, h.y, hr, 0, TAU);
          ctx.fillStyle = cfg.bg || '#fff'; ctx.fill();
          ctx.lineWidth = 1.6 * Math.max(1, (state.symK || 1));
          ctx.strokeStyle = cfg.handleInk || '#b06e00'; ctx.stroke();
        });
        ctx.restore();
      }
      ctx.restore();
    }
    return bindDraw(canvas, cfg, draw, {
      toPx: mapper(state),
      layout: () => state.laid || null,
      /** In-line devices left undrawn this frame because their run was too short to hold them. */
      hidden: () => state.hidden || 0,
      /** Force a fresh autoLayout solve (it is otherwise cached and only re-runs on a model or
       *  aspect change). Options:
       *    relayout()                 — new arrangement (bumps the seed) and clears drags/bends
       *    relayout({ seed: n })       — a SPECIFIC arrangement
       *    relayout({ reseed: false }) — re-solve with the same seed (e.g. after mutating the model)
       *    relayout({ keepEdits: true })— keep the user's drags and bends
       *  Hand-positions are offsets against the OLD arrangement, so they are cleared by default —
       *  they are meaningless against a re-solved one. */
      relayout: o => {
        o = o || {};
        const base = (cfg.layout && cfg.layout.seed) || 1;
        if (o.seed != null) state.seedBump = o.seed - base;
        else if (o.reseed !== false) state.seedBump = (state.seedBump || 0) + 1;
        if (o.keepEdits !== true) { state.moved = {}; state.wp = {}; }
        state.laid = null;                                  // force the cache miss on the next frame
      },
      /** Which symbol is under this canvas-pixel point? Topmost-last wins, so a small symbol
       *  sitting on a bus bar is picked before the bar. */
      hitTest: (px, py) => {
        /* Of everything under the pointer, take the one whose CENTRE is nearest, measured in
           units of its own size. "Topmost wins" is wrong on a dense one-line: a CT drawn after a
           bus would swallow every click on the bar it hangs off, and the bus would be unpickable
           even where nothing else is drawn. This way a small symbol still beats a big one it
           sits on — you are closer to its centre — while the big one keeps the rest of itself. */
        let best = null, bestD = Infinity;
        (state.boxes || []).forEach(q => {
          if (Math.abs(px - q.cx) > q.hw || Math.abs(py - q.cy) > q.hh) return;
          const d = Math.max(Math.abs(px - q.cx) / (q.hw || 1), Math.abs(py - q.cy) / (q.hh || 1));
          if (d < bestD) { bestD = d; best = q.id; }
        });
        return best;
      },
      /** Nudge a symbol by a CANVAS-pixel delta; stored in model space so it survives a resize. */
      nudge: (id, dxPx, dyPx) => {
        const kk = state.k || 1;
        state.moved = state.moved || {};
        const m = state.moved[id] || { dx: 0, dy: 0 };
        state.moved[id] = { dx: m.dx + dxPx / kk, dy: m.dy + dyPx / kk };
      },
      positions: () => JSON.parse(JSON.stringify(state.moved || {})),
      setPositions: p => { state.moved = p ? JSON.parse(JSON.stringify(p)) : {}; },
      resetPositions: () => { state.moved = {}; },
      moved: () => Object.keys(state.moved || {}).length,

      /* ---- editable conductor paths (bend points) ----------------------------------------
         The user reshapes a run by adding bend points and dragging them, exactly like PFAS.
         Bends are held in MODEL space keyed by the conductor's from|to, so they survive a
         resize and a zoom, and reroute() threads the run through them verbatim. */
      /** The bend-point handle under a canvas point, or null. Small targets, so this is tried
       *  before symbols and conductors. */
      hitWaypoint: (px, py) => {
        const R = 9 * Math.max(1, (state.symK || 1));
        let best = null, bestD = R * R;
        (state.handles || []).forEach(h => {
          const d = (px - h.x) * (px - h.x) + (py - h.y) * (py - h.y);
          if (d <= bestD) { bestD = d; best = { key: h.key, index: h.index }; }
        });
        return best;
      },
      /** The conductor under a canvas point: its key, which segment was hit, and where — so a
       *  new bend can be inserted into the run in the right order. */
      hitConductor: (px, py) => {
        const TOL = 7 * Math.max(1, (state.symK || 1));
        let best = null, bestD = TOL * TOL;
        (state.paths || []).forEach(pp => {
          for (let i = 0; i < pp.pts.length - 1; i++) {
            const d = segDist2(px, py, pp.pts[i], pp.pts[i + 1]);
            if (d <= bestD) { bestD = d; best = { key: pp.key, seg: i }; }
          }
        });
        return best;
      },
      /** Insert a bend at a canvas point on the given conductor segment; returns the new bend's
       *  index (so a drag can immediately grab it), or null if the path can't be resolved. */
      addWaypoint: (key, seg, px, py) => {
        if (!state.toModel) return null;
        const m = state.toModel(px, py);
        state.wp = state.wp || {};
        const arr = state.wp[key] ? state.wp[key].slice() : [];
        const at = Math.max(0, Math.min(arr.length, seg));   // segment s inserts a bend at wp index s
        arr.splice(at, 0, { x: Math.round(m.x), y: Math.round(m.y) });
        state.wp[key] = arr;
        return at;
      },
      /** Drag a bend by a canvas-pixel delta; stored in model space so it survives a resize. */
      moveWaypoint: (key, index, dxPx, dyPx) => {
        const w = state.wp && state.wp[key] && state.wp[key][index];
        if (!w) return;
        const kk = state.k || 1;
        w.x += dxPx / kk; w.y += dyPx / kk;
      },
      /** Remove one bend; drops the conductor back toward its auto-route as its bends run out. */
      removeWaypoint: (key, index) => {
        const arr = state.wp && state.wp[key];
        if (!arr) return;
        arr.splice(index, 1);
        if (!arr.length) delete state.wp[key];
      },
      waypoints: () => JSON.parse(JSON.stringify(state.wp || {})),
      setWaypoints: w => { state.wp = w ? JSON.parse(JSON.stringify(w)) : {}; },
      resetWaypoints: () => { state.wp = {}; },
      /** How many conductors the user has reshaped. */
      reshaped: () => Object.keys(state.wp || {}).length,

      /* ---- viewport ----------------------------------------------------------------------
         Canvas pixels in, canvas pixels out. `zoomAt` keeps the point under the cursor still,
         which is the whole difference between a magnifier and a jump-cut. */
      view: () => ({ z: state.view.z, ox: state.view.ox, oy: state.view.oy }),
      setView: v => {
        if (v) { state.view = { z: v.z || 1, ox: v.ox || 0, oy: v.oy || 0 }; clampView(state.W || 1, state.H || 1); }
      },
      resetView: () => { state.view = { z: 1, ox: 0, oy: 0 }; },
      zoomAt: (factor, px, py) => {
        const v = state.view, W = state.W || 1, H = state.H || 1;
        const z0 = v.z;
        const cx = px == null ? W / 2 : px, cy = py == null ? H / 2 : py;
        const ux = (cx - v.ox) / z0, uy = (cy - v.oy) / z0;   // the point under the cursor, unzoomed
        v.z = z0 * (factor || 1);
        clampView(W, H);                                      // z is clamped first…
        v.ox = cx - ux * v.z; v.oy = cy - uy * v.z;           // …then re-anchor on the real z
        clampView(W, H);
        return v.z;
      },
      panBy: (dx, dy) => {
        const v = state.view;
        v.ox += dx; v.oy += dy;
        clampView(state.W || 1, state.H || 1);
      },
      /** True once there is somewhere to pan to — at zoom 1 the fit already shows everything. */
      pannable: () => Math.abs(state.view.z - 1) > 0.001,
    });
  };

  /* ======================================================================
   *  Power — V/I dial, instantaneous power p(t), and the P–Q–S triangle.
   *  The middle panel is the point: p(t) ripples at 2f, averages to P, and
   *  dips negative for part of every cycle the moment the pf leaves unity.
   * ==================================================================== */
  NS.Power = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {};
    const cal = C, TAU = C.TAU, D2R = C.D2R;
    const WEIGHT = { dial: 1.0, instantaneous: 1.75, triangle: 1.05 };
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const val = (v, d) => (typeof v === 'function' ? v(t) : (v == null ? d : v));
      const V = val(cfg.v, 1), I = val(cfg.i, 1), lead = !!val(cfg.lead, false);
      const r = cal.pqs(V, I, val(cfg.pf, 0.8), lead), phi = r.phi * D2R;
      const grid = cfg.grid || '#c9d4dd', mut = cfg.muted || '#5a6b78', ink = cfg.ink || '#0f1c26';
      const cV = cfg.vColor || cal.SEQ.pos, cI = cfg.iColor || cal.SEQ.neg, cP = cfg.pColor || '#7a5cc4';
      const un = cfg.units || {};
      const fmt = (x, unit) => (Math.abs(x) < 10 ? x.toFixed(2) : x.toFixed(0)) + (unit ? ' ' + unit : '');
      const show = cfg.show || ['dial', 'instantaneous', 'triangle'];
      const tot = show.reduce((a, k) => a + (WEIGHT[k] || 1), 0);
      const rect = {}; let cursor = 0;
      show.forEach(k => { const w = (WEIGHT[k] || 1) / tot * W; rect[k] = [cursor, w]; cursor += w; });
      const rot = cfg.rotate === false ? 0 : (cfg.spin == null ? 0.15 : cfg.spin) * 360 * t;

      /* ---- dial: V and I with the angle between them ---- */
      if (rect.dial) {
        const rx = rect.dial[0], rw = rect.dial[1];
        const ox = rx + rw / 2, oy = H * 0.46, R = Math.min(rw * 0.40, H * 0.34);
        D.refCircle(ctx, ox, oy, R, { alpha: 0.28 });
        const sc = R / Math.max(V, I, 1e-9);
        D.phasor(ctx, ox, oy, I, rot - r.phi, { scale: sc, color: cI, label: 'I', w: 3.2 });
        D.phasor(ctx, ox, oy, V, rot, { scale: sc, color: cV, label: 'V', w: 3.2 });
        if (Math.abs(r.phi) > 0.5) {                                     // the angle arc, V → I
          ctx.save(); ctx.strokeStyle = mut; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.arc(ox, oy, R * 0.30, -rot * D2R, -(rot - r.phi) * D2R, r.phi < 0); ctx.stroke(); ctx.restore();
        }
        D.label(ctx, 'φ = ' + Math.abs(r.phi).toFixed(1) + '°  ' + (lead ? 'lead' : 'lag'), ox, oy + R + 20, mut, 12.5, true, 'center');
        D.label(ctx, 'pf = ' + r.pf.toFixed(3), ox, oy + R + 38, mut, 12.5, true, 'center');
      }

      /* ---- instantaneous: v, i on top; p = v·i underneath ---- */
      if (rect.instantaneous) {
        const rx = rect.instantaneous[0], rw = rect.instantaneous[1];
        const x0 = rx + 30, x1 = rx + rw - 14;
        const cyc = cfg.cycles || 2, k = TAU * cyc / Math.max(1, x1 - x0), ph = rot * D2R;
        const vAt = x => Math.SQRT2 * V * Math.sin(ph - (x - x0) * k);
        const iAt = x => Math.SQRT2 * I * Math.sin(ph - phi - (x - x0) * k);
        const pAt = x => vAt(x) * iAt(x);
        const tMid = H * 0.24, tAmp = H * 0.17, pMid = H * 0.70, pAmp = H * 0.21;
        const nrm = Math.SQRT2 * Math.max(V, I, 1e-9), pNrm = Math.max(r.s * 2.02, 1e-9);
        const trace = (fn, scaleTo, mid, amp, col, w) => {
          ctx.strokeStyle = col; ctx.lineWidth = w || 2.2; ctx.beginPath();
          for (let x = x0; x <= x1; x += 2) { const y = mid - fn(x) / scaleTo * amp; x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
          ctx.stroke();
        };
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, tMid); ctx.lineTo(x1, tMid); ctx.moveTo(x0, pMid); ctx.lineTo(x1, pMid); ctx.stroke();
        trace(vAt, nrm, tMid, tAmp, cV);
        trace(iAt, nrm, tMid, tAmp, cI);
        D.label(ctx, 'v', x0 - 8, tMid - tAmp * 0.6, cV, 13, true, 'right');
        D.label(ctx, 'i', x0 - 8, tMid + tAmp * 0.6, cI, 13, true, 'right');
        // shade p(t) by sign — the returned-energy lobes are the whole lesson
        if (cfg.negativeLobes !== false) {
          ctx.save(); ctx.globalAlpha = 0.24;
          for (let x = x0; x <= x1; x += 2) {
            const y = pMid - pAt(x) / pNrm * pAmp;
            ctx.fillStyle = y <= pMid ? cP : (cfg.negColor || cal.SEQ.neg);
            ctx.fillRect(x, Math.min(pMid, y), 2, Math.abs(y - pMid));
          }
          ctx.restore();
        }
        trace(pAt, pNrm, pMid, pAmp, cP, 2.4);
        const yP = pMid - r.p / pNrm * pAmp;                              // the average
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = ink; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x0, yP); ctx.lineTo(x1, yP); ctx.stroke(); ctx.restore();
        D.label(ctx, 'P', x0 - 8, yP, ink, 13, true, 'right');
        D.label(ctx, 'p = v·i   ·   average = P   ·   ' + cyc + ' cycles', (x0 + x1) / 2, H - 10, mut, 12, false, 'center');
      }

      /* ---- the P–Q–S triangle (fixed hypotenuse, so it swings with pf) ---- */
      if (rect.triangle) {
        const rx = rect.triangle[0], rw = rect.triangle[1], pad = 30;
        const bx = rx + pad, by = H * 0.78;
        const sc = Math.min((rw - 2 * pad) / Math.max(r.s, 1e-9), (H * 0.56) / Math.max(r.s, 1e-9));
        const ex = bx + r.p * sc, ey = by - r.q * sc;
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx - 10, by); ctx.lineTo(rx + rw - 12, by); ctx.stroke();
        ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = cV;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, by); ctx.lineTo(ex, ey); ctx.closePath(); ctx.fill(); ctx.restore();
        const seg = (ax, ay, bx2, by2, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w || 2.6; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2); ctx.stroke(); };
        seg(bx, by, ex, by, cV);                                          // P
        seg(ex, by, ex, ey, cI);                                          // Q
        seg(bx, by, ex, ey, cP, 3);                                       // S
        if (Math.abs(r.phi) > 0.5) { ctx.save(); ctx.strokeStyle = mut; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(bx, by, 26, 0, -r.phi * D2R, r.phi > 0); ctx.stroke(); ctx.restore(); }
        D.label(ctx, 'P ' + fmt(r.p, un.p || 'pu'), (bx + ex) / 2, by + 15, cV, 12.5, true, 'center');
        D.label(ctx, 'Q ' + fmt(r.q, un.q || 'pu'), ex + 7, (by + ey) / 2, cI, 12.5, true, 'left');
        D.label(ctx, 'S ' + fmt(r.s, un.s || 'pu'), (bx + ex) / 2 - 8, (by + ey) / 2 - 12, cP, 12.5, true, 'right');
      }
    }
    return bindDraw(canvas, cfg, draw);
  };

  /* ======================================================================
   *  Decompose — the symmetrical-component transform as a construction:
   *  apply the a-operator rotations, chain the terms tip to tail, divide.
   * ==================================================================== */
  NS.Decompose = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {};
    const cal = C;
    const ease = x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const terms = (typeof cfg.terms === 'function' ? cfg.terms() : cfg.terms) || [];
      const div = cfg.divide == null ? 3 : cfg.divide;
      const period = cfg.period || 8;
      let u = null;                                                       // an explicit progress wins; anything else sweeps
      if (cfg.progress != null) { const pv = typeof cfg.progress === 'function' ? cfg.progress() : cfg.progress; if (isFinite(pv)) u = pv; }
      if (u == null) u = cfg.auto === false ? 1 : (t % period) / period;
      u = Math.max(0, Math.min(1, u));
      const stage = (a, b) => ease(Math.max(0, Math.min(1, (u - a) / (b - a))));
      const uRot = stage(0.05, 0.40), uChain = stage(0.45, 0.72), uOut = stage(0.78, 0.96);
      const grid = cfg.grid || '#c9d4dd', mut = cfg.muted || '#5a6b78';

      const rotated = terms.map(tm => cal.rot(cal.Z(tm.z), (tm.rot || 0) * uRot));
      const total = rotated.length ? cal.add.apply(null, rotated) : cal.cx(0, 0);
      const result = cal.scale(total, 1 / (div || 1));
      const origins = []; let acc = cal.cx(0, 0);                         // running tip-to-tail origins
      rotated.forEach(z => { origins.push(cal.scale(acc, uChain)); acc = cal.add(acc, z); });

      const twoUp = cfg.result !== false;
      const lx = twoUp ? W * 0.30 : W * 0.5, rxc = W * 0.755, oy = H * 0.48;
      const R = Math.min(twoUp ? W * 0.21 : W * 0.34, H * 0.34);
      let peak = 1e-6;
      rotated.forEach((z, i) => { peak = Math.max(peak, cal.abs(z), cal.abs(cal.add(origins[i], z))); });
      const sc = R / peak;

      D.refCircle(ctx, lx, oy, R, { alpha: 0.26 });
      rotated.forEach((z, i) => {
        const tm = terms[i], o = origins[i];
        const ox = lx + o.re * sc, oyy = oy - o.im * sc;
        if (uChain > 0.01) {
          ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = grid; ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(lx, oy); ctx.lineTo(ox, oyy); ctx.stroke(); ctx.restore();
        }
        D.phasor(ctx, ox, oyy, cal.abs(z), cal.ang(z), { scale: sc, color: tm.color || cal.seqColor(['a', 'b', 'c'][i] || 'pos'), label: tm.label, w: 2.8 });
      });
      if (uChain > 0.02) {                                                // the closing sum
        D.phasor(ctx, lx, oy, cal.abs(total), cal.ang(total), { scale: sc, color: cfg.sumColor || '#7a5cc4', w: 3.4, dash: [7, 4], label: cfg.sumLabel || 'Σ' });
      }

      if (twoUp) {
        D.refCircle(ctx, rxc, oy, R, { alpha: 0.26 });
        if (uOut > 0.01) {
          const res = (typeof cfg.result === 'function' ? cfg.result() : cfg.result) || {};
          D.phasor(ctx, rxc, oy, cal.abs(result) * uOut, cal.ang(result), { scale: sc, color: res.color || '#7a5cc4', w: 3.6, label: res.label || 'V₁' });
          D.label(ctx, cal.fmtC(result), rxc, oy + R + 20, mut, 12.5, true, 'center');
        }
        D.label(ctx, '÷ ' + div, (lx + rxc) / 2, oy - 10, mut, 15, true, 'center');
        ctx.save(); ctx.strokeStyle = mut; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(lx + R + 12, oy + 6); ctx.lineTo(rxc - R - 12, oy + 6); ctx.stroke(); ctx.restore();
      }
      const caps = cfg.captions || [];
      const caption = u < 0.42 ? (caps[0] || 'rotate by the a-operator')
        : u < 0.74 ? (caps[1] || 'add tip to tail')
          : (caps[2] || 'divide by ' + div);
      D.label(ctx, caption, W / 2, H - 12, mut, 13, true, 'center');
    }
    return bindDraw(canvas, cfg, draw);
  };

  /* ======================================================================
   *  Estimator — a sliding DFT window over a record, and the phasor it
   *  produces settling.  This is the picture behind "the relay needs a cycle".
   * ==================================================================== */
  NS.Estimator = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {};
    const cal = C, TAU = C.TAU, D2R = C.D2R;
    const state = { trail: [] };
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const sig = cfg.signal; if (typeof sig !== 'function') return;
      const f = cfg.freq || 60, fs = cfg.fs || 1920;
      const winCyc = (typeof cfg.window === 'function' ? cfg.window() : cfg.window) || 1;
      const winLen = winCyc / f;
      const span = cfg.span || 0.15, travel = Math.max(1e-6, span - winLen);
      const grid = cfg.grid || '#c9d4dd', mut = cfg.muted || '#5a6b78';
      const period = cfg.sweepPeriod || 6;
      const pos = (t % period) / period * travel;                         // window start, seconds
      const N = Math.max(4, Math.round(fs * winLen));
      const est = tw => { const s = []; for (let n = 0; n < N; n++) s.push(sig(tw + n / fs)); return cal.phasorOf(s, f, fs); };

      /* ---- the record, with the window riding along it ---- */
      const x0 = 52, x1 = W - 14, ty = H * 0.06, tb = H * 0.40;
      const xAt = tt => x0 + tt / span * (x1 - x0), mid = (ty + tb) / 2;
      let peak = 1e-6; for (let k = 0; k <= 400; k++) peak = Math.max(peak, Math.abs(sig(k / 400 * span)));
      const amp = (tb - ty) * 0.44 / peak;
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      for (let c = 0; c / f <= span + 1e-9; c++) { const x = xAt(c / f); ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x, tb); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = cfg.windowColor || '#7a5cc4';
      ctx.fillRect(xAt(pos), ty, xAt(pos + winLen) - xAt(pos), tb - ty); ctx.restore();
      ctx.strokeStyle = cfg.windowColor || '#7a5cc4'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(xAt(pos), ty); ctx.lineTo(xAt(pos), tb); ctx.moveTo(xAt(pos + winLen), ty); ctx.lineTo(xAt(pos + winLen), tb); ctx.stroke();
      if (cfg.trigger != null) {
        const xf = xAt(cfg.trigger);
        ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = '#b06e00'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(xf, ty - 2); ctx.lineTo(xf, tb + 2); ctx.stroke(); ctx.restore();
        D.label(ctx, 'fault', xf + 6, ty + 8, '#b06e00', 12);
      }
      ctx.strokeStyle = cfg.signalColor || cal.SEQ.pos; ctx.lineWidth = 2.1; ctx.beginPath();
      for (let x = x0; x <= x1; x += 2) { const y = mid - sig((x - x0) / (x1 - x0) * span) * amp; x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
      D.label(ctx, winCyc + '-cycle window · ' + fs + ' Hz · ' + N + ' samples', x1, tb + 14, mut, 12, false, 'right');

      /* ---- the estimate: dial on the left, magnitude-vs-window on the right ---- */
      const by0 = H * 0.53, by1 = H - 28, dx = x0 + (x1 - x0) * 0.16, dy = (by0 + by1) / 2;
      const R = Math.min((x1 - x0) * 0.14, (by1 - by0) * 0.44);
      const now = est(pos);
      const mags = []; const STEPS = 90; let mmax = 1e-6;
      for (let k = 0; k <= STEPS; k++) { const m = cal.abs(est(k / STEPS * travel)); mags.push(m); if (m > mmax) mmax = m; }
      D.refCircle(ctx, dx, dy, R, { alpha: 0.26 });
      const sc = R / mmax;
      state.trail.push([cal.abs(now), cal.ang(now)]); if (state.trail.length > 26) state.trail.shift();
      ctx.save(); ctx.strokeStyle = cfg.estColor || cal.SEQ.neg; ctx.lineWidth = 1.6;
      state.trail.forEach((pt, k) => {
        ctx.globalAlpha = 0.04 + 0.26 * (k / state.trail.length);
        ctx.beginPath(); ctx.moveTo(dx, dy);
        ctx.lineTo(dx + pt[0] * sc * Math.cos(pt[1] * D2R), dy - pt[0] * sc * Math.sin(pt[1] * D2R));
        ctx.stroke();
      });
      ctx.restore();
      D.phasor(ctx, dx, dy, cal.abs(now), cal.ang(now), { scale: sc, color: cfg.estColor || cal.SEQ.neg, w: 3.2, label: cfg.estLabel || 'Î' });
      D.label(ctx, cal.fmtC(now), dx, dy + R + 18, mut, 12.5, true, 'center');

      const gx0 = x0 + (x1 - x0) * 0.36, gx1 = x1, gh = (by1 - by0) * 0.92;
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx0, by1); ctx.lineTo(gx1, by1); ctx.moveTo(gx0, by0); ctx.lineTo(gx0, by1); ctx.stroke();
      (cfg.refs || []).forEach(rf => {
        const y = by1 - rf.mag / mmax * gh;
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = rf.color || mut; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke(); ctx.restore();
        if (rf.label) D.label(ctx, rf.label, gx1 - 2, y - 9, rf.color || mut, 11.5, true, 'right');
      });
      ctx.strokeStyle = cfg.estColor || cal.SEQ.neg; ctx.lineWidth = 2.4; ctx.beginPath();
      mags.forEach((m, k) => { const x = gx0 + k / STEPS * (gx1 - gx0), y = by1 - m / mmax * gh; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      const cx = gx0 + (pos / travel) * (gx1 - gx0), cy = by1 - cal.abs(now) / mmax * gh;
      ctx.strokeStyle = cfg.windowColor || '#7a5cc4'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, by0); ctx.lineTo(cx, by1); ctx.stroke();
      ctx.fillStyle = cfg.estColor || cal.SEQ.neg; ctx.beginPath(); ctx.arc(cx, cy, 4.2, 0, TAU); ctx.fill();
      D.label(ctx, cfg.magLabel || '|estimate| as the window slides', (gx0 + gx1) / 2, H - 9, mut, 12, false, 'center');
    }
    return bindDraw(canvas, cfg, draw);
  };

  /* ======================================================================
   *  sub — a context scoped to a rectangle.  Components size themselves from
   *  ctx.canvas, so this is how you put two of them on one canvas.
   * ==================================================================== */
  NS.sub = function (ctx, x, y, w, h) {
    return new Proxy(ctx, {
      get(t, k) { if (k === 'canvas') return { width: w, height: h, __x: x, __y: y }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; },
      set(t, k, v) { t[k] = v; return true; },
    });
  };

  /* ======================================================================
   *  Callout — an arrow and a label anchored to a point in the figure.
   *  Ink is great live and gone in the PDF; a callout survives export.
   * ==================================================================== */
  NS.Callout = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {};
    const cal = C, TAU = C.TAU;
    const state = { on0: null };
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const vis = typeof cfg.show === 'function' ? !!cfg.show(t) : (cfg.show !== false);
      if (!vis) { state.on0 = null; return; }
      if (state.on0 == null) state.on0 = t;
      const fade = cfg.fade == null ? 0.35 : cfg.fade;
      const a = fade > 0 ? Math.max(0, Math.min(1, (t - state.on0) / fade)) : 1;

      const raw = typeof cfg.at === 'function' ? cfg.at(W, H) : cfg.at;
      if (!raw) return;                          // a component's toPx returns null until it has drawn once
      const tx = Array.isArray(raw) ? raw[0] : (raw && raw.x) || 0;
      const ty = Array.isArray(raw) ? raw[1] : (raw && raw.y) || 0;
      const col = cfg.color || '#b06e00', ink = cfg.textColor || '#0f1c26';
      const txt = typeof cfg.text === 'function' ? cfg.text(t) : cfg.text;   // a function, so it can carry a live value
      const lines = String(txt == null ? '' : txt).split('\n');
      const size = cfg.size || 13.5, pad = 8, lh = size * 1.35;

      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = '600 ' + size + 'px "Segoe UI",system-ui,sans-serif';
      const tw = Math.max.apply(null, lines.map(s => ctx.measureText(s).width));
      const bw = tw + pad * 2, bh = lines.length * lh + pad * 1.4;
      const gap = cfg.gap == null ? 62 : cfg.gap, side = cfg.from || 'right';
      let bx, by;                                                         // box top-left
      if (side === 'left') { bx = tx - gap - bw; by = ty - bh / 2; }
      else if (side === 'above') { bx = tx - bw / 2; by = ty - gap - bh; }
      else if (side === 'below') { bx = tx - bw / 2; by = ty + gap; }
      else { bx = tx + gap; by = ty - bh / 2; }
      bx = Math.max(4, Math.min(W - bw - 4, bx));
      by = Math.max(4, Math.min(H - bh - 4, by));
      const ax = side === 'left' ? bx + bw : side === 'right' ? bx : bx + bw / 2;   // leader anchor on the box
      const ay = side === 'above' ? by + bh : side === 'below' ? by : by + bh / 2;

      const ex = ax + (tx - ax) * a, ey = ay + (ty - ay) * a;             // the leader grows toward the target
      ctx.strokeStyle = col; ctx.lineWidth = cfg.lineWidth || 1.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + ex) / 2, (ay + ey) / 2 + (cfg.bow == null ? 10 : cfg.bow), ex, ey);
      ctx.stroke();
      if (a > 0.85 && cfg.ring !== false) {
        ctx.beginPath(); ctx.arc(tx, ty, cfg.ringRadius || 7, 0, TAU); ctx.stroke();
        ctx.save(); ctx.globalAlpha = a * 0.85; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(tx, ty, 2.6, 0, TAU); ctx.fill(); ctx.restore();
      }
      ctx.fillStyle = cfg.bg || 'rgba(255,255,255,.92)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx, by + bh); ctx.closePath(); ctx.stroke();
      lines.forEach((s, i) => D.label(ctx, s, bx + pad, by + pad * 0.7 + lh * (i + 0.5), ink, size, true, 'left'));
      ctx.restore();
    }
    return bindDraw(canvas, cfg, draw);
  };

  /* ======================================================================
   *  Compare — two figures on one canvas: wipe, split, or crossfade.
   *  The deck's -orig / -rev slide pairs, as one slide with a handle.
   * ==================================================================== */
  NS.Compare = function (canvas, cfg) {
    if (canvas && !isCanvas(canvas)) { cfg = canvas; canvas = null; }
    cfg = cfg || {};
    const cal = C;
    const asDraw = x => (typeof x === 'function' ? x : (x && typeof x.draw === 'function' ? (c, tt) => x.draw(c, tt) : null));
    function draw(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const A = asDraw(cfg.a), B = asDraw(cfg.b);
      const mode = (typeof cfg.mode === 'function' ? cfg.mode() : cfg.mode) || 'wipe';
      let at = typeof cfg.at === 'function' ? cfg.at(t) : (cfg.at == null ? 0.5 : cfg.at);
      at = Math.max(0, Math.min(1, at));
      const mut = cfg.muted || '#5a6b78', line = cfg.dividerColor || '#7a5cc4';
      const labels = cfg.labels || [];

      if (mode === 'split') {
        const gap = cfg.gap == null ? 14 : cfg.gap, half = (W - gap) / 2;
        if (A) { ctx.save(); ctx.translate(0, 0); A(NS.sub(ctx, 0, 0, half, H), t); ctx.restore(); }
        if (B) { ctx.save(); ctx.translate(half + gap, 0); B(NS.sub(ctx, half + gap, 0, half, H), t); ctx.restore(); }
        if (cfg.divider !== false) { ctx.save(); ctx.strokeStyle = cfg.grid || '#c9d4dd'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(half + gap / 2, 8); ctx.lineTo(half + gap / 2, H - 8); ctx.stroke(); ctx.restore(); }
      } else if (mode === 'fade') {
        if (A) { ctx.save(); ctx.globalAlpha = 1 - at; A(ctx, t); ctx.restore(); }
        if (B) { ctx.save(); ctx.globalAlpha = at; B(ctx, t); ctx.restore(); }
      } else {                                                            // wipe: same geometry, split down the middle
        const xw = W * at;
        if (B) { ctx.save(); ctx.beginPath(); ctx.rect(xw, 0, W - xw, H); ctx.clip(); B(ctx, t); ctx.restore(); }
        if (A) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xw, H); ctx.clip(); A(ctx, t); ctx.restore(); }
        if (cfg.divider !== false) {
          ctx.save(); ctx.strokeStyle = line; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(xw, 0); ctx.lineTo(xw, H); ctx.stroke();
          ctx.fillStyle = line; ctx.beginPath(); ctx.arc(xw, H / 2, 7, 0, cal.TAU); ctx.fill(); ctx.restore();
        }
      }
      if (labels[0]) D.label(ctx, labels[0], 12, 16, cfg.labelColor || mut, 13, true, 'left');
      if (labels[1]) D.label(ctx, labels[1], W - 12, 16, cfg.labelColor || mut, 13, true, 'right');
    }
    return bindDraw(canvas, cfg, draw);
  };

  /* ======================================================================
   *  mountDeck — the slide-toolkit adapter.  Instead of owning a page the
   *  way mount() does, a figure joins the deck: the deck's clock drives it,
   *  the slide's data-params feed it, its fragments step it, and it holds a
   *  chosen still whenever the deck is being photographed.
   *
   *    NS.mountDeck('decompose', api => NS.Decompose({
   *      progress: () => api.steps ? api.step / api.steps : NaN,
   *      terms:    () => build(api.p.mag),
   *    }), { poseAt: 6 });
   *
   *  api = { p, step, steps, t, inst }.  Read it inside config functions —
   *  it is the same object every frame, refreshed before each draw.
   * ==================================================================== */
  NS.mountDeck = function (name, build, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') return null;
    const go = () => {
      const d = root.deck;
      if (!d || !d.anim || typeof d.anim.register !== 'function') { console.warn('nerx-signals: no deck.anim — mountDeck needs the slide-toolkit runtime'); return; }
      let printing = false;
      addEventListener('beforeprint', () => { printing = true; });
      addEventListener('afterprint', () => { printing = false; });
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (opts.restart) document.addEventListener('deck:slide', e => {
        d.anim.instances.forEach(a => { if (a.id === name && a.sec === e.detail.el && a.state.ns) a.state.ns.t0 = null; });
      });
      d.anim.register(name, function (ctx, vt, inst, params) {
        const st = inst.state;
        if (!st.ns) { st.ns = { p: {}, step: 0, steps: 0, t: 0, inst: inst, t0: null }; st.comp = build(st.ns, inst) || null; }
        const api = st.ns;
        api.p = params || {}; api.inst = inst;
        const fr = inst.sec ? inst.sec.querySelectorAll('.frag') : [];    // no deck:frag event exists — read the DOM
        api.steps = fr.length; api.step = 0;
        for (let i = 0; i < fr.length; i++) if (fr[i].classList.contains('on')) api.step++;
        if (api.t0 == null) api.t0 = vt;                                  // deck vt starts at 1.7, not 0
        // every static-capture path sets body.capturing: snapshots, the PDF render window, transition textures
        const still = opts.poseAt != null &&
          (opts.still || printing || reduce || d.renderMode || document.body.classList.contains('capturing'));
        api.t = still ? opts.poseAt : (opts.absolute ? vt : vt - api.t0);
        if (opts.clear !== false) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        const c = st.comp; if (!c) return;
        const list = Array.isArray(c) ? c : [c];
        for (const item of list) {
          if (!item) continue;
          if (typeof item === 'function') item(ctx, api.t, api);
          else if (typeof item.draw === 'function') item.draw(ctx, api.t);
        }
      });
    };
    if (root.deck && root.deck.anim) go(); else document.addEventListener('deck:ready', go, { once: true });
    return { name };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
  root.NS = NS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
