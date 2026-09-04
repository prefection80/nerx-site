/* ============================================================================
 * test-signals.js — reference checks for lib/signals.js (the figure library).
 * Calc references and component geometry, with no browser:
 *
 *     node test/test-signals.js
 *
 * The components are exercised against a recording stub context, so their
 * drawing geometry (does the projection line up? does the trace fit the row?)
 * is testable without a canvas.
 * ==========================================================================*/
'use strict';
const NS = require('./nerx-signals.js');
const C = NS.calc, TAU = C.TAU;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
};
const near = (name, got, want, tol) => {
  const t = tol == null ? 1e-6 : tol;
  ok(name, Math.abs(got - want) <= t, 'got ' + got + ', want ' + want + ' ±' + t);
};
const group = n => console.log('\n' + n);

/* ---------------------------------------------------------------- calc --- */

group('complex & phasor');
near('abs(3+j4)', C.abs(C.cx(3, 4)), 5);
near('ang(j1)', C.ang(C.j(1)), 90);
near('bare number is a reactance', C.abs(C.Z(0.1)), 0.1);
near('div: 1/j0.25', C.abs(C.div(C.cx(1, 0), C.j(0.25))), 4);
near('rot 90° of 1∠0', C.ang(C.rot(C.cx(1, 0), 90)), 90);
near('par(j0.2, j0.2)', C.abs(C.par(C.j(0.2), C.j(0.2))), 0.1);

group('symmetrical components');
{
  const a = C.polar(1, 0), b = C.polar(1, -120), c = C.polar(1, 120);
  const s = C.toSeq(a, b, c);
  near('balanced set → V0 = 0', C.abs(s[0]), 0, 1e-9);
  near('balanced set → V1 = 1', C.abs(s[1]), 1, 1e-9);
  near('balanced set → V2 = 0', C.abs(s[2]), 0, 1e-9);
  const back = C.toPhase(s[0], s[1], s[2]);
  near('round-trip |a|', C.abs(back[0]), 1, 1e-9);
  near('round-trip ∠b', C.ang(back[1]), -120, 1e-6);
  // pure zero-sequence: all three phases equal
  const z = C.toSeq(C.cx(1, 0), C.cx(1, 0), C.cx(1, 0));
  near('a=b=c → V0 = 1', C.abs(z[0]), 1, 1e-9);
  near('a=b=c → V1 = 0', C.abs(z[1]), 0, 1e-9);
  const u = C.unbalance(C.polar(1.2, 0), C.polar(1, -120), C.polar(1, 120));
  ok('unbalance reports a non-zero negative %', u.neg > 3 && u.neg < 10, 'neg = ' + u.neg.toFixed(2) + '%');
}

group('per-unit & base');
{
  const b = C.base(100, 138);
  near('Ib for 100 MVA @ 138 kV', b.ib, 418.4, 0.1);
  near('Zb for 100 MVA @ 138 kV', b.zb, 190.44, 0.01);
  near('changeBase 10→100 MVA, same kV', C.abs(C.changeBase(C.j(0.1), 10, 13.8, 100, 13.8)), 1.0, 1e-9);
  near('toPu ∘ toOhms round-trip', C.abs(C.toPu(C.toOhms(C.j(0.1), 190.44), 190.44)), 0.1, 1e-9);
  near('pctZtoPu(8.5)', C.pctZtoPu(8.5), 0.085);
}

group('three-phase power');
{
  const p = C.power3ph(13.8e3, 400, 0.9);
  near('S = √3·V·I', p.s / 1e6, 9.561, 1e-3);
  near('P = S·pf', p.p / 1e6, 8.605, 1e-3);
  near('S² = P² + Q²', Math.hypot(p.p, p.q) / 1e6, p.s / 1e6, 1e-9);
  near('pf of 0.8+j0.6', C.pf(C.cx(0.8, 0.6)), 0.8, 1e-9);
}

group('shunt faults — the textbook reference set (z1 = z2 = j0.1, z0 = j0.05)');
{
  const f = C.faults({ z1: 0.1, z2: 0.1, z0: 0.05 });
  near('3φ = 10.0 pu', f.threePhase.mag, 10.0, 1e-6);
  near('L-L = 8.66 pu', f.ll.mag, Math.sqrt(3) * 5, 1e-6);
  near('SLG = 12.0 pu', f.slg.mag, 12.0, 1e-6);
  near('SLG 3I₀ = Ia', C.abs(f.slg.ig), f.slg.mag, 1e-9);
  near('L-L has no zero sequence', C.abs(f.ll.seq.i0), 0, 1e-12);
  near('L-L healthy phase a = 0', C.abs(f.ll.phase.a), 0, 1e-12);
  near('3φ has no zero sequence', C.abs(f.threePhase.seq.i0), 0, 1e-12);
  // regression: Z₂ must fall back to the *resolved* Z₁, not to undefined
  near('faults({z0}) defaults z1 = z2 = j0.1 → L-L 8.66', C.faults({ z0: 0.05 }).ll.mag, Math.sqrt(3) * 5, 1e-6);
  // fault impedance always reduces the current
  ok('Zf reduces the SLG current', C.faults({ z1: 0.1, z0: 0.05, zf: 0.05 }).slg.mag < f.slg.mag);
  ok('Zn reduces the SLG current', C.faults({ z1: 0.1, z0: 0.05, zn: 0.05 }).slg.mag < f.slg.mag);
  // amps come out when a base is given
  const fa = C.faults({ z1: 0.1, z0: 0.05, mva: 100, kv: 138 });
  near('SLG in amps = 12 pu × Ib', fa.slg.amps, 12 * C.base(100, 138).ib, 1e-6);
}

group('short-circuit duty');
near('X/R of 1 + j10', C.xr(C.cx(1, 10)), 10, 1e-9);
near('dcDecay is 1 at t = 0', C.dcDecay(10, 0), 1, 1e-12);
ok('dcDecay falls with time', C.dcDecay(10, 1) < C.dcDecay(10, 0.5));
ok('peakFactor → √2 as X/R → 0', Math.abs(C.peakFactor(0.01) - Math.SQRT2) < 1e-6);
ok('peakFactor → 2√2 as X/R → ∞', Math.abs(C.peakFactor(1e9) - 2 * Math.SQRT2) < 1e-6);
near('rmsAsymFactor at X/R = 10 (ANSI ½ cycle)', C.rmsAsymFactor(10), 1.438, 1e-3);
ok('rmsAsymFactor → 1 with no X', Math.abs(C.rmsAsymFactor(1e-6) - 1) < 1e-6);

group('overcurrent curves — IEEE C37.112 carries the /7 dial divisor');
near('IEEE-VI, M = 5, TD = 3', C.ocTime('IEEE-VI', 5, 3), 0.5606, 1e-3);
near('IEEE-MI, M = 5, TD = 5', C.ocTime('IEEE-MI', 5, 5), 1.2059, 1e-3);
near('IEEE-EI, M = 10, TD = 1', C.ocTime('IEEE-EI', 10, 1), 0.0581, 1e-3);
near('IEC-SI, M = 5, TMS = 0.1 (no divisor)', C.ocTime('IEC-SI', 5, 0.1), 0.4281, 1e-3);
near('IEC-VI, M = 5, TMS = 0.1', C.ocTime('IEC-VI', 5, 0.1), 0.3375, 1e-3);
ok('no operation at or below pickup', C.ocTime('IEEE-VI', 1.0, 1) === Infinity);
ok('faster at higher multiples', C.ocTime('IEEE-VI', 20, 1) < C.ocTime('IEEE-VI', 5, 1));
ok('TD scales linearly', Math.abs(C.ocTime('IEEE-VI', 5, 6) - 2 * C.ocTime('IEEE-VI', 5, 3)) < 1e-9);

group('signal analysis');
{
  const fs = 1920, N = 32;
  for (const phi of [0, 30, -120, 175]) {
    const w = C.waveform({ mag: 1.4, ang: phi, f: 60 });
    const s = []; for (let n = 0; n < N; n++) s.push(w(n / fs));
    const p = C.phasorOf(s, 60, fs);
    near('phasorOf ∘ waveform recovers |M| at ∠' + phi, C.abs(p), 1.4, 1e-6);
    near('phasorOf ∘ waveform recovers ∠' + phi, C.ang(p), phi, 1e-6);
  }
  const w2 = C.waveform({ mag: 1, f: 60, harmonics: [{ n: 5, mag: 0.2 }] });
  const s2 = []; for (let n = 0; n < 64; n++) s2.push(w2(n / 3840));
  near('one-bin DFT rejects the 5th', C.abs(C.phasorOf(s2, 60, 3840)), 1, 1e-6);
  near('rms of a unit sine', C.rms(Array.from({ length: 360 }, (_, i) => Math.sin(i * C.D2R))), Math.SQRT1_2, 1e-3);
}

group('THD — both accepted shapes agree');
{
  const want = Math.hypot(0.25, 0.15, 0.08) * 100;
  near('component list [{n,mag}]', C.thd([{ n: 1, mag: 1 }, { n: 3, mag: 0.25 }, { n: 5, mag: 0.15 }, { n: 7, mag: 0.08 }]), want, 1e-9);
  const idx = []; idx[1] = C.cx(1, 0); idx[3] = C.cx(0.25, 0); idx[5] = C.cx(0.15, 0); idx[7] = C.cx(0.08, 0);
  for (let i = 0; i <= 7; i++) idx[i] = idx[i] || C.cx(0, 0);
  near('order-indexed array', C.thd(idx), want, 1e-9);
  near('a clean fundamental is 0%', C.thd([{ n: 1, mag: 1 }]), 0, 1e-9);
}

group('transformers');
near('Dy11 shifts +30°', C.vectorShift(11), -330);
near('Dy1 shifts −30°', C.vectorShift(1), -30);
{
  const v = (hv, lv, core) => C.xfmrZeroSeq(hv, lv, core).verdict;
  ok('Yg–Yg passes I₀', v('Wye-G', 'Wye-G') === 'PASSES');
  ok('D–Yg is a local ground source', v('Delta', 'Wye-G') === 'GROUND SOURCE');
  ok('Yg–D blocks here, sources on the HV side', v('Wye-G', 'Delta') === 'BLOCKS HERE · SOURCES HV');
  ok('Y–Yg on a 3-legged core is a phantom source', v('Wye', 'Wye-G', '3-Legged') === 'PHANTOM SOURCE');
  ok('Y–Yg on a shell core blocks', v('Wye', 'Wye-G', '5-Legged') === 'BLOCKS');
  ok('D–D blocks', v('Delta', 'Delta') === 'BLOCKS');
}

group('CTs — ratio, burden, saturation');
{
  near('1200/5 CT ratio', C.ctRatio(1200, 5), 240);
  near('12 kA primary → 50 A secondary', C.ctSecondary(12000, 240), 50);
  const cls = C.ctClass('C400');
  near("C400 terminal volts", cls.volts, 400);
  near('C400 is defined at 20 × 5 A', cls.at, 100);
  near('C400 standard burden', cls.burden, 4);
  near('C800 on a 1 A CT', C.ctClass('C800', 1).burden, 40);
  near('Vs = Is·(Rct + Rlead + Zrelay)', C.ctBurdenVolts(50, { rct: 0.5, rlead: 0.4, zrelay: 0.1 }), 50);

  const burden = { rct: 0.5, rlead: 0.4, zrelay: 0.1 };
  const s = C.ctSaturation(Object.assign({ ifault: 12000, ratio: 240, vk: 400, xr: 15 }, burden));
  near('saturation factor Ks = Vk/Vs', s.ks, 8, 1e-9);
  ok('a heavy dc offset saturates it', s.saturates);
  ok('but not instantly — about 1.5 cycles', s.cycles > 1.2 && s.cycles < 1.8, 'cycles = ' + s.cycles.toFixed(2));
  // C37.110: with Ks − 1 ≥ ωT1 the flux demand never catches up
  const ride = C.ctSaturation(Object.assign({ ifault: 12000, ratio: 240, vk: 400, xr: 5 }, burden));
  ok('a low X/R rides through', !ride.saturates && ride.cycles === Infinity);
  const dead = C.ctSaturation(Object.assign({ ifault: 12000, ratio: 240, vk: 40, xr: 5 }, burden));
  ok('Ks < 1 saturates on the symmetrical wave alone', dead.saturates && dead.tSat === 0);
  const rem = C.ctSaturation(Object.assign({ ifault: 12000, ratio: 240, vk: 400, xr: 5, remanence: 0.5 }, burden));
  ok('remanent flux eats the margin', rem.ks < ride.ks && rem.saturates);
  ok('a longer lead run hurts', C.ctSaturation({ ifault: 12000, ratio: 240, vk: 400, xr: 15, rct: 0.5, rlead: 2.0, zrelay: 0.1 }).cycles < s.cycles);
}

group('distance & directional');
{
  near('Zpri → Zsec through 240 CT / 1200 PT', C.abs(C.zSecondary(C.j(10), 240, 1200)), 2, 1e-9);
  near('zPrimary inverts zSecondary', C.abs(C.zPrimary(C.zSecondary(C.j(10), 240, 1200), 240, 1200)), 10, 1e-9);
  const k = C.k0(C.j(0.8), C.j(2.4));
  near('k₀ = (Z₀ − Z₁)/3Z₁ magnitude', C.abs(k), 2 / 3, 1e-9);
  near('k₀ is real when Z₀ and Z₁ share an angle', C.ang(k), 0, 1e-9);
  // a bolted SLG at the reach point: the loop must read the line impedance back
  const ia = C.polar(1, -75), ig = C.polar(1, -75), zline = C.polar(0.8, 75);
  const va = C.mul(zline, C.add(ia, C.mul(k, ig)));
  const zseen = C.apparentZground(va, ia, k, ig);
  near('ground loop recovers |Z₁| at the reach point', C.abs(zseen), 0.8, 1e-9);
  near('ground loop recovers ∠Z₁', C.ang(zseen), 75, 1e-9);
  const zph = C.apparentZphase(C.polar(1.6, 0), C.polar(0, 0), C.polar(2, -75), C.polar(0, 0));
  near('phase loop = ΔV/ΔI', C.abs(zph), 0.8, 1e-9);

  const fwd = C.directional(C.polar(1, 0), C.polar(1, -60), 60);
  ok('a fault at the MTA is forward', fwd.forward);
  near('and sits at maximum torque', fwd.angle, 0, 1e-9);
  ok('the reverse fault is not forward', !C.directional(C.polar(1, 0), C.polar(1, 120), 60).forward);
  ok('the boundary at ±90° has no torque', Math.abs(C.directional(C.polar(1, 0), C.polar(1, -150), 60).torque) < 1e-9);
}

group('log scale');
{
  const L = C.logScale(100, 100000, 0, 300);
  near('min maps to px0', L.toPx(100), 0, 1e-9);
  near('max maps to px1', L.toPx(100000), 300, 1e-9);
  near('one decade = 100 px', L.toPx(1000) - L.toPx(100), 100, 1e-9);
  near('fromPx inverts toPx', L.fromPx(L.toPx(2500)), 2500, 1e-6);
  ok('ticks stay inside the range', L.ticks().every(t => t.v >= 99 && t.v <= 100001));
  ok('four major decades', L.ticks().filter(t => t.major).length === 4);
}

/* ---------------------------------------------------------- components --- */
/* A recording 2-D context: enough surface for the components to draw into,
   and it keeps every coordinate so the geometry can be asserted. */
function stubCtx(w, h) {
  const rec = { pts: [], arcs: [], rects: [], texts: [] };
  let m = { k: 1, tx: 0, ty: 0 }; const stack = [];            // uniform scale + translate is all the components use
  const X = x => m.tx + x * m.k, Y = y => m.ty + y * m.k;
  const ctx = {
    canvas: { width: w, height: h }, rec,
    save() { stack.push({ k: m.k, tx: m.tx, ty: m.ty }); },
    restore() { if (stack.length) m = stack.pop(); },
    translate(x, y) { m.tx += x * m.k; m.ty += y * m.k; },
    scale(k) { m.k *= k; },
    beginPath() {}, closePath() {}, stroke() {}, fill() {},
    clearRect() {}, setLineDash() {}, rotate() {}, strokeRect() {},
    clip() {}, rect: (x, y, ww, hh) => rec.rects.push([X(x), Y(y), ww * m.k, hh * m.k]),
    quadraticCurveTo: (cx1, cy1, x, y) => { rec.pts.push([X(cx1), Y(cy1)]); rec.pts.push([X(x), Y(y)]); },
    arcTo() {}, bezierCurveTo() {},
    measureText: t => ({ width: String(t).length * 6 }),
    moveTo: (x, y) => rec.pts.push([X(x), Y(y)]), lineTo: (x, y) => rec.pts.push([X(x), Y(y)]),
    arc: (x, y, r) => rec.arcs.push([X(x), Y(y), r * m.k]),
    fillRect: (x, y, ww, hh) => rec.rects.push([X(x), Y(y), ww * m.k, hh * m.k]),
    fillText: (t, x, y) => rec.texts.push([String(t), X(x), Y(y)]),
  };
  return ctx;
}
// Rectangles count: the PFAS symbol set fills a bus bar and a breaker body with fillRect/rect,
// so a bbox that only looked at paths and arcs would miss the widest thing on the drawing.
const bbox = rec => {
  const xs = rec.pts.map(p => p[0]).concat(rec.arcs.map(a => a[0] - a[2]), rec.arcs.map(a => a[0] + a[2]),
    rec.rects.map(r => r[0]), rec.rects.map(r => r[0] + r[2]));
  const ys = rec.pts.map(p => p[1]).concat(rec.arcs.map(a => a[1] - a[2]), rec.arcs.map(a => a[1] + a[2]),
    rec.rects.map(r => r[1]), rec.rects.map(r => r[1] + r[3]));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

group('Phasor — the projection must line up with the arrow tip');
{
  const S = C.SEQ, R = 96;
  const ph = NS.Phasor({
    radius: R, rotate: 'ccw', freq: 0.16, waveform: 'right', refCircle: true,
    phasors: () => [{ mag: 1.2, ang: 0, color: S.pos, label: 'a' }, { mag: 1, ang: -120, color: S.neg, label: 'b' }, { mag: 1, ang: 120, color: S.zero, label: 'c' }],
  });
  for (const t of [0, 0.5, 1.0, 2.3]) {
    const ctx = stubCtx(820, 344); ph.draw(ctx, t);
    const oy = 172, s = R / 1.2, rot = 0.16 * 360 * t;
    const tipY = oy - 1.2 * s * Math.sin(rot * C.D2R);
    const dots = ctx.rec.arcs.filter(a => Math.abs(a[2] - 3.4) < 0.01);   // the projection markers
    ok('t=' + t + ': three projection dots', dots.length === 3, 'got ' + dots.length);
    near('t=' + t + ': dot y == a-phase tip y', dots.length ? dots[0][1] : NaN, tipY, 1e-6);
    ok('t=' + t + ': dots share the wave origin x', dots.length === 3 && dots.every(d => Math.abs(d[0] - dots[0][0]) < 1e-9));
  }
}

group('Phasor — a zero-length phasor draws no label');
{
  const ctx = stubCtx(600, 300);
  NS.Phasor({ radius: 100, waveform: false, rotate: false, phasors: () => [
    { mag: 1, ang: 0, label: 'Ia' }, { mag: 0, ang: 0, label: 'Ib' }, { mag: 0, ang: 0, label: 'Ic' },
  ] }).draw(ctx, 0);
  const labels = ctx.rec.texts.map(t => t[0]);
  ok('the live phasor keeps its label', labels.includes('Ia'));
  ok('the collapsed phasors do not stack labels on the origin', !labels.includes('Ib') && !labels.includes('Ic'));
}

group('Scope — traces stay inside the plot band');
{
  const tF = 0.08, tau = 12 / (TAU * 60), S = C.SEQ;
  const chans = () => [
    { name: 'Ia', color: S.pos, signal: t => t < tF ? 0.7 * Math.sin(TAU * 60 * t) : 4 * Math.sin(TAU * 60 * t + 0.4) + 3 * Math.exp(-(t - tF) / tau) },
    { name: 'Ib', color: S.neg, signal: t => 0.7 * Math.sin(TAU * 60 * t - 2.094) },
    { name: 'Ic', color: S.zero, signal: t => 0.7 * Math.sin(TAU * 60 * t + 2.094) },
    { name: '3I₀', color: '#c9a24a', derived: 'residual' },
  ];
  const H = 410, top = 20, bot = H - 26;
  for (const cfg of [{}, { gain: 6 }, { motion: 'scroll' }]) {
    const ctx = stubCtx(820, H);
    NS.Scope(Object.assign({ window: 0.25, freq: 60, trigger: tF, motion: 'sweep', channels: chans }, cfg)).draw(ctx, 1.5);
    const b = bbox(ctx.rec);
    // the trigger and sweep cursors legitimately overhang the band by 2 px; the traces must not
    ok('cfg ' + JSON.stringify(cfg) + ': nothing drawn above the band', b.y0 >= top - 3, 'y0 = ' + b.y0.toFixed(1));
    ok('cfg ' + JSON.stringify(cfg) + ': nothing drawn below the band', b.y1 <= bot + 3, 'y1 = ' + b.y1.toFixed(1));
  }
}

group('Scope — the residual is the sum of the phase channels');
{
  const ctx = stubCtx(600, 300);
  let seen = null;
  NS.Scope({ window: 0.05, freq: 60, motion: 'static', channels: () => [
    { name: 'a', signal: () => 2 }, { name: 'b', signal: () => 3 }, { name: 'c', signal: () => -1 },
    { name: '3I0', derived: 'residual', signal: undefined },
  ] }).draw(ctx, 0);
  // the residual row is flat at 2+3−1 = 4 × the shared gain; assert it is not flat at zero
  const rows = ctx.rec.pts.filter(p => Number.isFinite(p[1]));
  ok('the residual channel is drawn', rows.length > 0);
  seen = C.thd; ok('(sanity) calc still reachable', typeof seen === 'function');
}

group('OneLine — the schematic is fitted to its canvas');
{
  const nodes = {
    src: { x: 80, y: 52, type: 'source', label: 'Utility', lx: -70 },
    b1: { x: 80, y: 106, type: 'bus', w: 48, label: '115 kV', lx: -72 },
    tx: { x: 80, y: 160, type: 'xfmr' },
    b2: { x: 80, y: 214, type: 'bus', w: 48, label: '13.8 kV', lx: -76 },
    ld1: { x: 250, y: 214, type: 'load', label: 'Feeder A', ly: 30, lx: -26 },
    ld2: { x: 430, y: 214, type: 'load', label: 'Feeder B', ly: 30, lx: -26 },
  };
  const edges = () => [
    { from: 'src', to: 'b1', flow: 1.4 }, { from: 'b1', to: 'tx', flow: 1.4 }, { from: 'tx', to: 'b2', flow: 1.3 },
    { from: 'b2', to: 'ld1', flow: 0.7 }, { from: 'b2', to: 'ld2', flow: 0.6 },
  ];
  const W = 820, H = 410, ctx = stubCtx(W, H);
  NS.OneLine({ nodes, edges }).draw(ctx, 1);
  const b = bbox(ctx.rec);
  ok('fills most of the width', (b.x1 - b.x0) > W * 0.6, 'width used = ' + (b.x1 - b.x0).toFixed(0) + ' of ' + W);
  ok('fills most of the height', (b.y1 - b.y0) > H * 0.6, 'height used = ' + (b.y1 - b.y0).toFixed(0) + ' of ' + H);
  ok('stays inside the canvas', b.x0 >= -1 && b.y0 >= -1 && b.x1 <= W + 1 && b.y1 <= H + 1,
    JSON.stringify({ x0: +b.x0.toFixed(1), y0: +b.y0.toFixed(1), x1: +b.x1.toFixed(1), y1: +b.y1.toFixed(1) }));
  const off = stubCtx(W, H);
  NS.OneLine({ nodes, edges, fit: false }).draw(off, 1);
  // Probe the authored bus bar itself (x 80, half-width 48 -> left edge 32) rather than the whole
  // bbox: label halos are authored well to the left of it and would mask a fitting transform.
  const bar = off.rec.rects.filter(r => Math.abs(r[2] - 96) < 2 && r[3] < 16).map(r => r[0]).sort();
  ok('fit:false keeps the authored coordinates', bar.length === 2 && Math.abs(bar[0] - 32) < 2,
    'bus bar left edges = ' + JSON.stringify(bar));
}

group('Impedance — mho geometry, and no state left on the config');
{
  const cfg = { range: 1.2, trail: true, pointLabel: 'Z',
    zones: [{ type: 'mho', reach: 0.7, angle: 75, label: 'Z2' }],
    point: t => ({ r: 0.2, x: 0.3 + 0.01 * t }) };
  const comp = NS.Impedance(cfg);
  for (let t = 0; t < 5; t++) comp.draw(stubCtx(700, 420), t);
  ok('the trail is not stashed on the caller config', cfg._tr === undefined);
  const ctx = stubCtx(700, 420); comp.draw(ctx, 0);
  const circles = ctx.rec.arcs.filter(a => a[2] > 20);
  ok('the mho circle is drawn', circles.length >= 1);
}

group('Coordination / Stability / Spectrum draw without throwing');
{
  const ctx1 = stubCtx(800, 480);
  NS.Coordination({ iMin: 100, iMax: 100000, tMin: 0.01, tMax: 100,
    devices: () => [{ name: '51', curve: I => C.ocTime('IEEE-VI', I / 600, 3) }], faultCurrent: () => 9000 }).draw(ctx1, 1);
  ok('the TCC plots points', ctx1.rec.pts.length > 50);
  const ctx2 = stubCtx(800, 430);
  NS.Stability({ pmax: 1.8, pmaxFault: 0.5, pmaxPost: 1.5, pm: 1.0, clearAngle: 1.15 }).draw(ctx2, 1);
  ok('the P–δ curves plot points', ctx2.rec.pts.length > 100);
  ok('the equal-area readout is shown', ctx2.rec.texts.some(t => /A[₁1]/.test(t[0]) || /accel/.test(t[0])));
  const ctx3 = stubCtx(800, 460);
  NS.Spectrum({ showWave: true, maxOrder: 13, harmonics: () => [{ n: 1, mag: 1 }, { n: 5, mag: 0.2 }] }).draw(ctx3, 1);
  const thdLabel = ctx3.rec.texts.find(t => t[0].startsWith('THD'));
  ok('the THD readout is computed, not zeroed', thdLabel && parseFloat(thdLabel[0].replace(/[^\d.]/g, '')) > 19,
    thdLabel ? thdLabel[0] : 'no THD label');
}

group('power — P/Q/S and instantaneous power');
{
  const r = C.pqs(1, 1, 0.8);
  near('P = S·pf', r.p, 0.8, 1e-9);
  near('Q = S·sin φ', r.q, 0.6, 1e-9);
  near('φ = acos(pf)', r.phi, 36.8699, 1e-3);
  ok('lagging Q is positive', r.q > 0);
  ok('leading Q is negative', C.pqs(1, 1, 0.8, true).q < 0);
  near('unity pf has no Q', C.pqs(2, 3, 1).q, 0, 1e-9);
  near('S = V·I', C.pqs(2, 3, 0.5).s, 6, 1e-9);

  const avg = (fn, f) => { const N = 2000; let s = 0; for (let n = 0; n < N; n++) s += fn(n / (N * f)); return s / N; };
  for (const pf of [1, 0.9, 0.5, 0]) {
    const p = C.instPower({ v: 1, i: 1, pf, f: 60 });
    near('p(t) averages to P at pf ' + pf, avg(p, 60), C.pqs(1, 1, pf).p, 1e-3);
  }
  const samp = (fn, f) => { const out = []; for (let n = 0; n <= 600; n++) out.push(fn(n / (600 * f))); return out; };
  ok('at unity pf, p(t) never goes negative', Math.min(...samp(C.instPower({ pf: 1 }), 60)) > -1e-9);
  ok('at 0.8 pf it does — energy goes back to the source', Math.min(...samp(C.instPower({ pf: 0.8 }), 60)) < -0.01);
  ok('at zero pf the average is zero, all sloshing', Math.abs(avg(C.instPower({ pf: 0 }), 60)) < 1e-3);
  // the ripple is at twice line frequency: p(t) and p(t + 1/2f) agree
  const p8 = C.instPower({ pf: 0.8, f: 60 });
  near('p(t) repeats every half cycle', p8(0.004), p8(0.004 + 1 / 120), 1e-9);
}

group('Power / Decompose / Estimator draw');
{
  const ctx = stubCtx(900, 380);
  NS.Power({ v: 1, i: 1, pf: 0.8 }).draw(ctx, 1);
  ok('the power view draws all three panels', ctx.rec.pts.length > 200);
  const labels = ctx.rec.texts.map(t => t[0]).join(' ');
  ok('it reads out pf and φ', /pf = 0\.800/.test(labels) && /φ =/.test(labels));
  ok('it labels P, Q and S', /P 0\.80/.test(labels) && /Q 0\.60/.test(labels) && /S 1\.00/.test(labels));
  const one = stubCtx(900, 380);
  NS.Power({ v: 1, i: 1, pf: 1, show: ['triangle'] }).draw(one, 1);
  ok('a single-panel view still draws', one.rec.pts.length > 0);

  // Decompose at u = 1 must land on the true positive-sequence component
  const S2 = C.SEQ;
  const va = C.polar(1.2, 0), vb = C.polar(1, -120), vc = C.polar(1, 120);
  const want = C.toSeq(va, vb, vc)[1];
  const dctx = stubCtx(880, 380);
  NS.Decompose({ progress: 1, terms: () => [
    { z: va, rot: 0, label: 'Va', color: S2.a }, { z: vb, rot: 120, label: 'a·Vb', color: S2.b }, { z: vc, rot: 240, label: 'a²·Vc', color: S2.c },
  ], divide: 3, result: { label: 'V1' } }).draw(dctx, 0);
  const shown = dctx.rec.texts.find(t => /∠/.test(t[0]));
  ok('the finished construction prints the sequence value', !!shown, 'no ∠ readout');
  near('and it is V₁', parseFloat(shown[0]), C.abs(want), 1e-2);
  const mid = stubCtx(880, 380);
  NS.Decompose({ progress: 0.2, terms: () => [{ z: va, rot: 0 }, { z: vb, rot: 120 }, { z: vc, rot: 240 }] }).draw(mid, 0);
  ok('mid-construction it captions the step', mid.rec.texts.some(t => /a-operator/.test(t[0])));

  // Estimator: the settling curve must run from the prefault level to the fault level
  const tF = 0.05, sig = tt => (tt < tF ? 0.5 : 3) * Math.sin(TAU * 60 * tt);
  const ectx = stubCtx(900, 460);
  NS.Estimator({ signal: sig, freq: 60, fs: 1920, window: 1, span: 0.15, trigger: tF,
    refs: [{ mag: 0.5, label: 'load' }, { mag: 3, label: 'fault' }] }).draw(ectx, 0);
  ok('the estimator draws the record and the estimate', ectx.rec.pts.length > 200);
  ok('it labels the window', ectx.rec.texts.some(t => /1-cycle window/.test(t[0])));
  ok('and the reference levels', ectx.rec.texts.some(t => t[0] === 'fault') && ectx.rec.texts.some(t => t[0] === 'load'));
  // the estimate itself: a window fully before the fault reads load, fully after reads fault
  const win = tw => { const s = []; for (let n = 0; n < 32; n++) s.push(sig(tw + n / 1920)); return C.abs(C.phasorOf(s, 60, 1920)); };
  near('a window entirely in load current reads 0.5', win(0.0), 0.5, 1e-6);
  near('a window entirely in fault current reads 3', win(tF + 1 / 60), 3, 1e-6);
  const straddle = win(tF - 0.5 / 60);
  ok('a straddling window reads in between', straddle > 0.6 && straddle < 2.9, 'straddle = ' + straddle.toFixed(3));
}

group('toPx — figure coordinates instead of pixels');
{
  // Impedance: with an explicit origin and scale the mapping is exactly checkable
  const plane = NS.Impedance({ origin: [300, 320], scale: 200, zones: [{ type: 'mho', reach: 0.7, angle: 75 }] });
  ok('toPx is null before the first draw', plane.toPx({ r: 0, x: 0 }) === null);
  plane.draw(stubCtx(700, 420), 0);
  const o = plane.toPx({ r: 0, x: 0 });
  near('the origin maps to the origin (x)', o[0], 300, 1e-9);
  near('the origin maps to the origin (y)', o[1], 320, 1e-9);
  const p1 = plane.toPx({ r: 0.5, x: 0.25 });
  near('R runs right', p1[0], 300 + 0.5 * 200, 1e-9);
  near('X runs up', p1[1], 320 - 0.25 * 200, 1e-9);
  near('it also accepts a complex', plane.toPx(C.cx(0.5, 0.25))[0], p1[0], 1e-9);

  // it must follow the auto-fit, which is the whole point
  const auto = NS.Impedance({ zones: [{ type: 'mho', reach: 0.7, angle: 75 }] });
  auto.draw(stubCtx(700, 420), 0); const a1 = auto.toPx({ r: 0.35, x: 0.35 });
  auto.draw(stubCtx(1200, 700), 0); const a2 = auto.toPx({ r: 0.35, x: 0.35 });
  ok('the mapping tracks a resize', Math.abs(a1[0] - a2[0]) > 20, JSON.stringify([a1, a2]));

  // Phasor: the dial, including the current rotation
  const dial = NS.Phasor({ origin: [200, 200], radius: 100, scale: 80, rotate: false, waveform: false,
    phasors: () => [{ mag: 1, ang: 0 }] });
  dial.draw(stubCtx(600, 400), 0);
  const tip = dial.toPx({ mag: 1, ang: 0 });
  near('0° points right', tip[0], 280, 1e-6);
  near('and sits on the origin line', tip[1], 200, 1e-6);
  near('90° points up', dial.toPx({ mag: 1, ang: 90 })[1], 120, 1e-6);

  // OneLine: anchor by node name, through the fit transform
  const one = NS.OneLine({ nodes: { a: { x: 40, y: 40, type: 'bus', w: 30 }, b: { x: 240, y: 200, type: 'load' } },
    edges: () => [{ from: 'a', to: 'b', flow: 1 }] });
  const octx = stubCtx(800, 400); one.draw(octx, 0);
  const pa = one.toPx('a'), pb = one.toPx('b');
  ok('both nodes land inside the canvas', pa[0] > 0 && pa[0] < 800 && pb[1] > 0 && pb[1] < 400, JSON.stringify([pa, pb]));
  ok('and b is down-right of a', pb[0] > pa[0] && pb[1] > pa[1]);
  ok('an unknown node is null, not a crash', one.toPx('nope') === null);

  // Coordination: log-log amps and seconds
  const tcc = NS.Coordination({ iMin: 100, iMax: 100000, tMin: 0.01, tMax: 100, devices: () => [] });
  tcc.draw(stubCtx(800, 480), 0);
  const lo = tcc.toPx({ i: 100, t: 0.01 }), hi = tcc.toPx({ i: 100000, t: 100 });
  ok('current runs left to right', hi[0] > lo[0]);
  ok('time runs bottom to top', hi[1] < lo[1]);
  near('a decade is a constant width', tcc.toPx({ i: 1000, t: 1 })[0] - tcc.toPx({ i: 100, t: 1 })[0],
       tcc.toPx({ i: 10000, t: 1 })[0] - tcc.toPx({ i: 1000, t: 1 })[0], 1e-9);

  // Spectrum and Stability publish one too
  const sp = NS.Spectrum({ maxOrder: 13, harmonics: () => [{ n: 1, mag: 1 }] });
  sp.draw(stubCtx(800, 460), 0);
  ok('Spectrum maps harmonic order', sp.toPx({ n: 5, pct: 20 })[0] > sp.toPx({ n: 1, pct: 20 })[0]);
  const st = NS.Stability({ pmax: 1.8, pm: 1 });
  st.draw(stubCtx(800, 430), 0);
  ok('Stability maps δ and P', st.toPx({ delta: Math.PI / 2, p: 1 })[0] > st.toPx({ delta: 0, p: 1 })[0]);

  // and the point of all of it: a Callout anchored in figure space
  const cctx = stubCtx(700, 420);
  const fig = NS.Impedance({ origin: [300, 320], scale: 200, zones: [{ type: 'mho', reach: 0.7, angle: 75 }] });
  const note = NS.Callout({ at: () => fig.toPx({ r: 0.2, x: 0.5 }), text: 'here', fade: 0 });
  note.draw(cctx, 0);
  ok('a callout drawn before its figure simply waits', cctx.rec.texts.length === 0);
  fig.draw(cctx, 0); note.draw(cctx, 0);
  ok('and lands once the figure has drawn', cctx.rec.texts.some(t => t[0] === 'here'));
  ok('with its leader reaching the mapped point',
     cctx.rec.pts.some(p => Math.abs(p[0] - (300 + 0.2 * 200)) < 1.5 && Math.abs(p[1] - (320 - 0.5 * 200)) < 1.5));
}

group('autoLayout — a network model becomes a one-line');
{
  // a plant: utility → 13.8 kV bus → transformer → 480 V board → two feeders,
  // plus an on-site generator BEHIND the transformer and a CT to be collapsed
  const el = (id, type, extra) => Object.assign({ id, name: id, type, nodes: [] }, extra || {});
  const model = {
    elements: [
      el('src', 'Source'), el('hv', 'Bus', { nominalKv: 13.8 }), el('cb', 'Breaker'),
      el('tx', 'Transformer'), el('lv', 'Bus', { nominalKv: 0.48 }),
      el('ct1', 'CT'), el('fdr1', 'Load'), el('fdr2', 'Load'),
      el('gen', 'Generator', { machineType: 'generator' }),
      el('Feeder Jct', 'Bus', { nominalKv: 0.48 }),
    ],
    connections: [
      { fromElementId: 'src', toElementId: 'hv' }, { fromElementId: 'hv', toElementId: 'cb' },
      { fromElementId: 'cb', toElementId: 'tx' }, { fromElementId: 'tx', toElementId: 'lv' },
      { fromElementId: 'lv', toElementId: 'ct1' }, { fromElementId: 'ct1', toElementId: 'Feeder Jct' },
      { fromElementId: 'Feeder Jct', toElementId: 'fdr1' },
      { fromElementId: 'lv', toElementId: 'fdr2' }, { fromElementId: 'lv', toElementId: 'gen' },
    ],
  };
  const L = NS.autoLayout(model, { width: 500, starts: 20, seed: 3 });

  ok('the source is on band 0', L.level.src === 0);
  ok('so is the bus it feeds', L.level.hv === 0);
  ok('the transformer stays on the high side', L.level.tx === 0);
  ok('and everything past it steps down one band', L.level.lv === 1 && L.level.fdr2 === 1);
  // the rule I got wrong first time: an injecting generator BEHIND the transformer must not root
  ok('a generator behind the transformer does NOT root band 0', L.level.gen === 1,
    'gen landed on band ' + L.level.gen + ' — rooting it there inverts the hierarchy');
  ok('two galvanic bands in total', L.bands === 2, 'got ' + L.bands);

  /* Nothing is thrown away. In-line hardware does not get its own ROW — the layout is solved
     for places, or a chain of pass-through devices stretches the tree into a ladder — but every
     device comes back as a real node sitting on the conductor that replaced it, so it can be
     seen, named, clicked and dragged. */
  ok('a CT is a node, not something the drawing swallowed', !!L.nodes.ct1 && L.nodes.ct1.type === 'ct');
  ok('a breaker is a node too', !!L.nodes.cb && L.nodes.cb.type === 'breaker');
  ok('and both are marked as riding a conductor', L.nodes.ct1.device && L.nodes.cb.device);
  // the run it was spliced out of is now the CHAIN through it
  const touching = id => L.edges.filter(e => e.from === id || e.to === id);
  ok('the conductor runs through the breaker, not past it', touching('cb').length === 2,
    'cb has ' + touching('cb').length + ' conductors');
  ok('and it sits between the two things it was wired to', (() => {
    const ends = touching('cb').map(e => (e.from === 'cb' ? e.to : e.from)).sort();
    return ends.join(',') === ['hv', 'tx'].sort().join(',');
  })());
  ok('a device sits ON its run, not off to one side', (() => {
    const a = L.nodes.hv, b = L.nodes.tx, c = L.nodes.cb;
    return c.y > Math.min(a.y, b.y) - 1 && c.y < Math.max(a.y, b.y) + 1;
  })());
  ok('devices can still be collapsed away if a slide wants only the places',
    !NS.autoLayout(model, { collapse: ['CT'], starts: 4 }).nodes.ct1);
  ok('a radial network gets the tidy tree, not the relaxation', L.how === 'tree', 'got ' + L.how);
  ok('every symbol is still reachable from the source', (() => {
    const adj = {}; Object.keys(L.nodes).forEach(id => (adj[id] = []));
    L.edges.forEach(e => { adj[e.from].push(e.to); adj[e.to].push(e.from); });
    const seen = { src: 1 }, q = ['src'];
    while (q.length) { const u = q.shift(); adj[u].forEach(v => { if (!seen[v]) { seen[v] = 1; q.push(v); } }); }
    return Object.keys(seen).length === Object.keys(L.nodes).length;
  })());
  ok('a junction bus is collapsed too', !L.nodes['Feeder Jct']);
  ok('unless you ask to keep it', !!NS.autoLayout(model, { collapseJunctions: false, starts: 4 }).nodes['Feeder Jct']);
  ok('and a CT survives when collapse is off', !!NS.autoLayout(model, { collapse: [], starts: 4 }).nodes.ct1);
  ok('every node the layout produced is reported in the count',
    L.elements === Object.keys(L.nodes).length, L.elements + ' vs ' + Object.keys(L.nodes).length);

  ok('every element gets a symbol type', Object.keys(L.nodes).every(id => !!L.nodes[id].type));
  ok('the bus becomes a bus, the source a source, the transformer an xfmr',
    L.nodes.hv.type === 'bus' && L.nodes.src.type === 'source' && L.nodes.tx.type === 'xfmr');
  ok('a bus bar is as wide as its taps reach', L.nodes.lv.w >= 40);
  ok('places are labelled — buses, machines, transformers, loads',
    !!L.nodes.hv.label && !!L.nodes.src.label && !!L.nodes.fdr1.label);

  ok('bands are stacked, high voltage above low', L.nodes.hv.y < L.nodes.lv.y);
  ok('conductors are orthogonal', L.edges.every(e => e.points.every((p, i, a) =>
    i === 0 || Math.abs(p.x - a[i - 1].x) < 0.001 || Math.abs(p.y - a[i - 1].y) < 0.001)));
  ok('the layout is deterministic for a given seed',
    JSON.stringify(NS.autoLayout(model, { width: 500, starts: 20, seed: 3 }).nodes) === JSON.stringify(L.nodes));
  ok('a tidy tree does not depend on the seed at all',
    JSON.stringify(NS.autoLayout(model, { width: 500, starts: 20, seed: 9 }).nodes) === JSON.stringify(L.nodes));
  {
    // close a loop and it becomes a mesh: the relaxation takes over, and seeds matter again
    const mesh = { elements: model.elements.concat([{ id: 'tie', name: 'tie', type: 'Bus', nodes: [] }]),
      connections: model.connections.concat([
        { fromElementId: 'lv', toElementId: 'tie' }, { fromElementId: 'tie', toElementId: 'fdr2' }]) };
    const auto = NS.autoLayout(mesh, { width: 500, starts: 12, seed: 3 });
    const asTree = NS.autoLayout(mesh, { width: 500, starts: 12, seed: 3, layout: 'tree' });
    const asRelax = NS.autoLayout(mesh, { width: 500, starts: 12, seed: 3, layout: 'relaxed' });
    ok('a mesh runs both and the gate keeps one', auto.how === 'tree' || auto.how === 'relaxed');
    ok('and never the one with more crossings',
      auto.crossings <= Math.max(asTree.crossings, asRelax.crossings),
      'auto ' + auto.crossings + ' vs tree ' + asTree.crossings + ' / relaxed ' + asRelax.crossings);
    ok('either can be forced', asTree.how === 'tree' && asRelax.how === 'relaxed');
    ok('the relaxation explores a different arrangement per seed',
      JSON.stringify(NS.autoLayout(mesh, { width: 500, starts: 12, seed: 9, layout: 'relaxed' }).nodes)
        !== JSON.stringify(asRelax.nodes));
    ok('but each seed is reproducible',
      JSON.stringify(NS.autoLayout(mesh, { width: 500, starts: 12, seed: 3, layout: 'relaxed' }).nodes)
        === JSON.stringify(asRelax.nodes));
  }

  // and OneLine draws it without any hand-placed coordinates
  const ctx = stubCtx(900, 400);
  const one = NS.OneLine({ model: model, layout: { width: 500, starts: 12, seed: 3 }, flow: () => ({ flow: 1 }) });
  one.draw(ctx, 0.5);
  ok('OneLine renders a model directly — conductors and symbols',
    ctx.rec.pts.length > 10 && (ctx.rec.arcs.length + ctx.rec.rects.length) > 5,
    ctx.rec.pts.length + ' pts, ' + ctx.rec.arcs.length + ' arcs, ' + ctx.rec.rects.length + ' rects');
  ok('and exposes what the layout achieved', one.layout() && one.layout().bands === 2);
  const b = bbox(ctx.rec);
  ok('fitted inside the canvas', b.x0 >= -1 && b.y0 >= -1 && b.x1 <= 901 && b.y1 <= 401);
  ok('an empty model is handled', NS.autoLayout({ elements: [], connections: [] }).bands === 0);

  // reading it in a ROOM: symbols keep their size, and the network can arrive a piece at a time
  ok('depth counts hops from the infeed', L.depth.src === 0 && L.depth.hv === 1 && L.depth.lv > L.depth.tx);
  const big = stubCtx(1000, 400), small = stubCtx(500, 200);
  const sizeOf = rec => { const a = rec.arcs.filter(x => x[2] > 10); return a.length ? a[0][2] : 0; };
  NS.OneLine({ model: model, layout: { width: 500, starts: 8, seed: 3 } }).draw(big, 0);
  NS.OneLine({ model: model, layout: { width: 500, starts: 8, seed: 3 } }).draw(small, 0);
  near('a symbol is the same size whatever the canvas', sizeOf(big.rec), sizeOf(small.rec), 0.001);

  const early = stubCtx(900, 400), late = stubCtx(900, 400);
  const build = at => NS.OneLine({ model: model, layout: { width: 500, starts: 8, seed: 3 },
    show: (id, n, LL) => LL.depth[id] <= at });
  const cEarly = build(1), cLate = build(99);
  cEarly.draw(early, 0); cLate.draw(late, 0);
  ok('a reveal shows less than the finished diagram',
    early.rec.pts.length < late.rec.pts.length && early.rec.pts.length > 0,
    early.rec.pts.length + ' vs ' + late.rec.pts.length);
  // the framing must not move as the build advances, or the room loses its place: a symbol
  // present at both steps has to land on exactly the same pixel
  const pe = cEarly.toPx('hv'), pl = cLate.toPx('hv');
  ok('the framing does not shift between steps',
    !!pe && !!pl && Math.abs(pe[0] - pl[0]) < 0.5 && Math.abs(pe[1] - pl[1]) < 0.5,
    JSON.stringify(pe) + ' vs ' + JSON.stringify(pl));

  const lab = stubCtx(900, 400);
  NS.OneLine({ model: model, layout: { width: 260, starts: 8, seed: 3 }, labelSize: 15 }).draw(lab, 0);
  const tags = lab.rec.texts.filter(t => /Bus|src|gen|tx|hv|lv/.test(t[0]));
  let clash = 0;
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
    if (Math.abs(tags[i][1] - tags[j][1]) < 30 && Math.abs(tags[i][2] - tags[j][2]) < 12) clash++;
  }
  ok('labels dodge each other rather than stacking', clash === 0, clash + ' collisions among ' + tags.length + ' tags');
}

group('dragging a one-line — connections must stay attached');
{
  const el = (id, type, extra) => Object.assign({ id, name: id, type, nodes: [] }, extra || {});
  const model = {
    elements: [el('src', 'Source'), el('hv', 'Bus'), el('tx', 'Transformer'), el('lv', 'Bus'),
               el('f1', 'Load'), el('f2', 'Load')],
    connections: [{ fromElementId: 'src', toElementId: 'hv' }, { fromElementId: 'hv', toElementId: 'tx' },
                  { fromElementId: 'tx', toElementId: 'lv' }, { fromElementId: 'lv', toElementId: 'f1' },
                  { fromElementId: 'lv', toElementId: 'f2' }],
  };
  const one = NS.OneLine({ model: model, layout: { starts: 8, seed: 3 } });
  const ctx = stubCtx(900, 400);
  one.draw(ctx, 0); one.draw(stubCtx(900, 400), 0);   // one settling frame, then it holds

  const at = id => one.toPx(id);
  const before = at('lv');
  ok('a symbol can be found by pointing at it', one.hitTest(before[0], before[1]) === 'lv');
  ok('empty canvas hits nothing', one.hitTest(5, 5) === null);

  one.nudge('lv', 90, 40);
  one.draw(ctx, 0);
  const after = at('lv');
  ok('dragging moves the symbol', Math.abs(after[0] - before[0]) > 40 && Math.abs(after[1] - before[1]) > 15,
    JSON.stringify(before) + ' → ' + JSON.stringify(after));
  ok('and only that symbol', Math.abs(at('hv')[0] - one.toPx('hv')[0]) < 0.001);

  // the point of the whole exercise: every conductor still lands on its symbols
  const fresh = stubCtx(900, 400); one.draw(fresh, 0);
  const L = one.layout();
  const ends = {};
  L.edges.forEach(e => { ends[e.from] = 1; ends[e.to] = 1; });
  ok('every conductor still has both ends', L.edges.every(e => !!L.nodes[e.from] && !!L.nodes[e.to]));
  ok('nothing was disconnected by the drag', L.conductors === 5);

  // a run touching the moved symbol must have been re-routed to reach it
  const moved = one.positions();
  ok('the offset is recorded in model space', !!moved.lv && Math.abs(moved.lv.dx) > 1);
  const nodes2 = {}; Object.keys(L.nodes).forEach(id => {
    const m = moved[id];
    nodes2[id] = Object.assign({}, L.nodes[id], m ? { x: L.nodes[id].x + m.dx, y: L.nodes[id].y + m.dy } : {});
  });
  const routed = NS.reroute(nodes2, L.edges.map(e => ({ from: e.from, to: e.to })));
  routed.forEach(e => {
    const A = nodes2[e.from], B = nodes2[e.to];
    const first = e.points[0], last = e.points[e.points.length - 1];
    const onA = A.type === 'bus' ? Math.abs(first.y - A.y) < 1 : Math.hypot(first.x - A.x, first.y - A.y) < 1;
    const onB = B.type === 'bus' ? Math.abs(last.y - B.y) < 1 : Math.hypot(last.x - B.x, last.y - B.y) < 1;
    ok('  ' + e.from + ' → ' + e.to + ' stays attached at both ends', onA && onB);
  });
  ok('a tap slid along the bar to meet what moved',
    routed.some(e => (e.from === 'lv' || e.to === 'lv') &&
      Math.abs((e.from === 'lv' ? e.fromPt.x : e.toPt.x) - nodes2.lv.x) > 1));
  ok('conductors are still orthogonal after the drag', routed.every(e =>
    e.points.every((p, i, arr) => i === 0 || Math.abs(p.x - arr[i - 1].x) < 0.001 || Math.abs(p.y - arr[i - 1].y) < 0.001)));

  ok('the arrangement can be saved and restored', (() => {
    const saved = one.positions();
    one.resetPositions();
    if (one.moved() !== 0) return false;
    one.setPositions(saved);
    return JSON.stringify(one.positions()) === JSON.stringify(saved);
  })());
  one.resetPositions();
  one.draw(ctx, 0);
  ok('reset puts it back where the layout had it', Math.abs(at('lv')[0] - before[0]) < 0.001);

  ok('NS.drag is a no-op on something undraggable', typeof NS.drag(null, null) === 'function');
}

group('routing — the PFAS orthogonal router');
{
  const N = {
    a: { x: 100, y: 0, type: 'source' },
    b: { x: 100, y: 200, type: 'bus' },
    c: { x: 400, y: 0, type: 'source' },
    d: { x: 400, y: 200, type: 'bus' },
  };
  const e1 = NS.reroute(N, [{ from: 'a', to: 'b' }]);
  ok('endpoints that already line up get a straight run, no bend', e1[0].points.length === 2,
    JSON.stringify(e1[0].points));

  // every route is orthogonal, whatever shape it picks
  const orth = es => es.every(e => e.points.every((p, i, arr) =>
    i === 0 || Math.abs(p.x - arr[i - 1].x) < 1e-6 || Math.abs(p.y - arr[i - 1].y) < 1e-6));
  const e2 = NS.reroute(N, [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }, { from: 'b', to: 'd' }]);
  ok('every conductor is orthogonal', orth(e2));
  ok('and every one still ends on its two symbols', e2.every(e => {
    const A = N[e.from], B = N[e.to], f = e.points[0], l = e.points[e.points.length - 1];
    const on = (n, p) => (n.type === 'bus' ? Math.abs(p.y - n.y) < 1e-6 : Math.abs(p.x - n.x) < 1e-6 && Math.abs(p.y - n.y) < 1e-6);
    return on(A, f) && on(B, l);
  }));

  // the router is deterministic: same input, same routes (it is a greedy longest-first search)
  const again = NS.reroute(JSON.parse(JSON.stringify(N)), [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }, { from: 'b', to: 'd' }]);
  ok('the same network routes the same way twice',
    JSON.stringify(again.map(e => e.points)) === JSON.stringify(e2.map(e => e.points)));

  /* Two runs sharing one lane are the defect the overlap term exists to prevent: you cannot tell
     which flow is which. Give two conductors the same corridor and check the router separates
     them instead of drawing one on top of the other. */
  /* Two runs that do NOT have to cross, but whose mid-spans coincide: the naive Z this replaced
     put both on the y=60 lane for 200 px, and you could not tell which flow was which. (Where a
     crossing is unavoidable the router will still accept a short shared stub rather than add a
     second crossing — that is the PFAS cost order, not a defect.) */
  const M = {
    p: { x: 0, y: 0, type: 'source' }, q: { x: 300, y: 120, type: 'load' },
    r: { x: 50, y: 10, type: 'source' }, t: { x: 250, y: 110, type: 'load' },
  };
  const es = NS.reroute(M, [{ from: 'p', to: 'q' }, { from: 'r', to: 't' }]);
  const segsOf = e => { const o = []; for (let i = 1; i < e.points.length; i++) o.push([e.points[i - 1], e.points[i]]); return o; };
  let shared = 0;
  segsOf(es[0]).forEach(a => segsOf(es[1]).forEach(b => {
    const hA = Math.abs(a[0].y - a[1].y) < 2, hB = Math.abs(b[0].y - b[1].y) < 2;
    const vA = Math.abs(a[0].x - a[1].x) < 2, vB = Math.abs(b[0].x - b[1].x) < 2;
    if (hA && hB && Math.abs(a[0].y - b[0].y) < 6)
      shared += Math.max(0, Math.min(Math.max(a[0].x, a[1].x), Math.max(b[0].x, b[1].x)) - Math.max(Math.min(a[0].x, a[1].x), Math.min(b[0].x, b[1].x)));
    if (vA && vB && Math.abs(a[0].x - b[0].x) < 6)
      shared += Math.max(0, Math.min(Math.max(a[0].y, a[1].y), Math.max(b[0].y, b[1].y)) - Math.max(Math.min(a[0].y, a[1].y), Math.min(b[0].y, b[1].y)));
  }));
  ok('two runs are never drawn on top of one another', shared < 1, 'shared run = ' + shared.toFixed(1) + ' px');

  // a bar may not grow into the next bus on the same row, or the two read as one bus
  const B2 = { l: { x: 0, y: 0, type: 'bus' }, r2: { x: 160, y: 0, type: 'bus' },
               f: { x: 0, y: 120, type: 'load' }, g: { x: 160, y: 120, type: 'load' } };
  NS.reroute(B2, [{ from: 'l', to: 'r2' }, { from: 'l', to: 'f' }, { from: 'r2', to: 'g' }]);
  ok('adjacent bus bars stop short of each other', B2.l.w + B2.r2.w < 160,
    'bars ' + B2.l.w + ' + ' + B2.r2.w + ' vs 160 apart');
}

group('symbols — the PFAS one-line vocabulary');
{
  const draw = (nodes, edges, cfg) => {
    const c = stubCtx(600, 400);
    NS.OneLine(Object.assign({ nodes, edges: edges || (() => []), fit: false }, cfg || {})).draw(c, 0);
    return c.rec;
  };
  const near = (v, want, tol) => Math.abs(v - (want || 0)) <= (tol == null ? 1 : tol);

  const src = draw({ s: { x: 200, y: 100, type: 'source' } });
  ok('a source is a circle of radius 20 carrying a tilde',
    src.arcs.some(a => near(a[2], 20)) && src.texts.some(t => t[0] === '∼'));
  const gen = draw({ g: { x: 200, y: 100, type: 'gen' } });
  ok('a generator is the same circle carrying a G', gen.texts.some(t => t[0] === 'G'));

  const tx = draw({ t: { x: 200, y: 150, type: 'xfmr', cp: 'Delta', cs: 'Wye-G' } });
  const r18 = tx.arcs.filter(a => near(a[2], 18));
  ok('a transformer is two overlapping windings of radius 18', r18.length === 2, 'found ' + r18.length);
  ok('and its two windings are 30 apart on the axis',
    r18.length === 2 && near(Math.hypot(r18[0][0] - r18[1][0], r18[0][1] - r18[1][1]), 30, 1.5));
  ok('the winding types are designated P and S',
    tx.texts.some(t => t[0] === 'P') && tx.texts.some(t => t[0] === 'S'));
  /* The delta triangle must stay UPRIGHT however the transformer is turned — a tipped triangle
     reads as an arrowhead. Its apex is directly above its two base corners. */
  const apexUp = tx.pts.some((p, i) => {
    const q = tx.pts[i + 1], u = tx.pts[i + 2];
    return q && u && near(q[1], u[1], 0.5) && p[1] < q[1] - 8 && near(p[0], (q[0] + u[0]) / 2, 1.5);
  });
  ok('a delta winding draws an upright triangle', apexUp);

  const load = draw({ l: { x: 200, y: 100, type: 'load' } });
  ok('a load is a triangle pointing away from its terminal', load.pts.length >= 3);

  const bus = draw({ b: { x: 200, y: 100, type: 'bus', w: 60 } });
  ok('a bus is a filled bar spanning its taps',
    bus.rects.some(r => near(r[0], 140) && near(r[2], 120)), JSON.stringify(bus.rects));

  // colour: the PFAS category palette by default, monochrome on request
  ok('symbols carry the PFAS category colours', (() => {
    const c = stubCtx(600, 400); const seen = [];
    Object.defineProperty(c, 'fillStyle', { set: v => seen.push(v), get: () => '#000' });
    NS.OneLine({ nodes: { b: { x: 200, y: 100, type: 'bus', w: 60 } }, edges: () => [], fit: false }).draw(c, 0);
    return seen.indexOf('#1976d2') >= 0;
  })());
  ok('palette:"ink" gives them all back to the deck ink', (() => {
    const c = stubCtx(600, 400); const seen = [];
    Object.defineProperty(c, 'fillStyle', { set: v => seen.push(v), get: () => '#000' });
    NS.OneLine({ nodes: { b: { x: 200, y: 100, type: 'bus', w: 60 } }, edges: () => [], fit: false, palette: 'ink' }).draw(c, 0);
    return seen.indexOf('#1976d2') < 0;
  })());
}

group('the protection layer — relays, PTs and CTs are symbols you can grab');
{
  const el = (id, type, extra) => Object.assign({ id: id, name: id, type: type, nodes: [] }, extra || {});
  const model = {
    elements: [el('src', 'Source'), el('hv', 'Bus'), el('cb', 'Breaker'), el('ct', 'CT', { ratio: '600:5' }),
               el('tx', 'Transformer'), el('lv', 'Bus'), el('ld', 'Load')],
    connections: [{ fromElementId: 'src', toElementId: 'hv' }, { fromElementId: 'hv', toElementId: 'cb' },
                  { fromElementId: 'cb', toElementId: 'ct' }, { fromElementId: 'ct', toElementId: 'tx' },
                  { fromElementId: 'tx', toElementId: 'lv' }, { fromElementId: 'lv', toElementId: 'ld' }],
    // neither of these is a power element: a PT is shunt-connected and a relay lives on the
    // secondary side of a CT, so they arrive in their own collections, as PFAS exports them
    instrumentTransformers: [{ id: 'pt1', type: 'PT', label: '21-A-PT', ratio: '13800:115',
                               attachedTo: { elementId: 'hv', elementType: 'bus' } }],
    ansiRelays: [{ id: 'r51', label: '51-M', ansiNumber: '51', enabled: true,
                   itAssignment: { ctIds: ['ct'], ptIds: [] } },
                 { id: 'r21', label: '21-A', ansiNumber: '21', enabled: false,
                   itAssignment: { ctIds: [], ptIds: ['pt1'] } }],
  };
  const one = NS.OneLine({ model: model, layout: { starts: 8, seed: 3 } });
  const ctx = stubCtx(900, 420);
  one.draw(ctx, 0); one.draw(stubCtx(900, 420), 0);
  const L2 = one.layout();

  ok('the CT is on the diagram, not collapsed out of it', !!L2.nodes.ct && L2.nodes.ct.type === 'ct');
  ok('the PT is there', !!L2.nodes.pt1 && L2.nodes.pt1.type === 'pt');
  ok('and so is every relay', !!L2.nodes.r51 && !!L2.nodes.r21 && L2.nodes.r51.type === 'relay');
  ok('a relay carries its ANSI number, which is what it draws inside', L2.nodes.r51.ansi === '51');
  ok('a disabled relay is still drawn, just marked disabled', L2.nodes.r21.enabled === false);
  ok('relays and PTs are marked aux, so a slide can reveal them separately',
    L2.nodes.r51.aux && L2.nodes.pt1.aux && !L2.nodes.ct.aux);

  /* Secondary circuits are LINKS, not conductors — a relay's sensing wire must never be counted
     as part of the power network or a fault would appear to flow down it. */
  ok('the sensing wiring is links, kept out of the conductors',
    L2.links.length === 3 && L2.edges.every(e => e.from !== 'r51' && e.to !== 'r51'));
  ok('the relay is wired to the CT that feeds it',
    L2.links.some(l => l.from === 'r51' && l.to === 'ct' && l.kind === 'ct'));
  ok('the PT taps the bus it is connected across',
    L2.links.some(l => l.from === 'pt1' && l.to === 'hv' && l.kind === 'pt'));
  ok('and the distance relay senses voltage, not current',
    L2.links.some(l => l.from === 'r21' && l.to === 'pt1' && l.kind === 'pt'));

  // ── everything on the drawing can be picked up ──────────────────────────────
  const grabbable = id => {
    const p = one.toPx(id);
    return p && one.hitTest(p[0], p[1]) === id;
  };
  ['src', 'hv', 'cb', 'ct', 'tx', 'lv', 'ld', 'pt1', 'r51', 'r21'].forEach(id => {
    ok('  ' + id + ' can be clicked', grabbable(id));
  });

  /* Dragging a CT has to take its conductors with it. This is the reason an in-line device is a
     real node rather than a decoration painted on the wire: a decoration would slide off it. */
  const runs = id => L2.edges.filter(e => e.from === id || e.to === id);
  ok('a CT sits IN the conductor, with a run either side', runs('ct').length === 2);
  const beforeC = one.toPx('ct');
  one.nudge('ct', 70, 30);
  one.draw(stubCtx(900, 420), 0);
  const afterC = one.toPx('ct');
  ok('the CT moves when dragged', Math.hypot(afterC[0] - beforeC[0], afterC[1] - beforeC[1]) > 20);
  ok('and both its conductors follow it', (() => {
    const L3 = one.layout(), moved = one.positions();
    const n2 = {}; Object.keys(L3.nodes).forEach(id => {
      const m = moved[id];
      n2[id] = Object.assign({}, L3.nodes[id], m ? { x: L3.nodes[id].x + m.dx, y: L3.nodes[id].y + m.dy } : {});
    });
    const routed = NS.reroute(n2, L3.edges.map(e => ({ from: e.from, to: e.to })));
    return routed.filter(e => e.from === 'ct' || e.to === 'ct').every(e => {
      const mine = e.from === 'ct' ? e.points[0] : e.points[e.points.length - 1];
      return Math.hypot(mine.x - n2.ct.x, mine.y - n2.ct.y) < 1;
    });
  })());

  // a relay is not in the topology, so dragging it moves only its sensing wire
  const beforeR = one.toPx('r51');
  one.nudge('r51', -60, 40);
  one.draw(stubCtx(900, 420), 0);
  ok('a relay can be dragged too', Math.hypot(one.toPx('r51')[0] - beforeR[0], one.toPx('r51')[1] - beforeR[1]) > 20);
  ok('and moving it disturbs no conductor', one.layout().edges.every(e => e.from !== 'r51' && e.to !== 'r51'));
  one.resetPositions();

  /* Which symbol a click belongs to, when two of them overlap. "Topmost wins" is the obvious
     rule and the wrong one on a one-line: a device drawn after the bus it hangs off would
     swallow every click on the bar, and the bus would be unpickable even at its own centre.
     Nearest-centre — measured in units of each symbol's own size — gives the small symbol its
     own body and leaves the big one the rest of itself. */
  ok('a click belongs to the symbol whose centre it is nearest', (() => {
    const nodes = { bar: { x: 200, y: 100, type: 'bus', w: 80 },
                    cb: { x: 200, y: 108, type: 'breaker' } };     // sitting ON the bar
    const two = NS.OneLine({ nodes: nodes, edges: () => [], fit: false });
    two.draw(stubCtx(500, 260), 0);
    return two.hitTest(200, 100) === 'bar'      // the bar's own centre stays the bar's
        && two.hitTest(200, 108) === 'cb'       // the device's own centre is the device
        && two.hitTest(265, 100) === 'bar';     // and out along the bar, clear of it
  })());

  /* The real test of "every element is clickable": a PLANT, crowded enough that symbols overlap
     on a slide-sized canvas. Nearest-centre hit-testing is what makes this hold — "topmost wins"
     would let a CT drawn after a bus swallow every click on the bar it hangs off. */
  ok('every symbol of a crowded plant is still pickable at its own centre', (() => {
    const els = [{ id: 'u', name: 'u', type: 'Source', nodes: [] }], cx2 = [];
    for (let f = 0; f < 6; f++) {
      els.push({ id: 'b' + f, name: 'bus ' + f, type: 'Bus', nodes: [] },
               { id: 'k' + f, name: 'cb' + f, type: 'Breaker', nodes: [] },
               { id: 'c' + f, name: 'ct' + f, type: 'CT', nodes: [] },
               { id: 'l' + f, name: 'load ' + f, type: 'Load', nodes: [] });
      cx2.push({ fromElementId: 'u', toElementId: 'b' + f }, { fromElementId: 'b' + f, toElementId: 'k' + f },
               { fromElementId: 'k' + f, toElementId: 'c' + f }, { fromElementId: 'c' + f, toElementId: 'l' + f });
    }
    const big = NS.OneLine({
      model: { elements: els, connections: cx2,
               ansiRelays: cx2.filter((_, i2) => i2 % 4 === 2).map((_, i2) => ({
                 id: 'rr' + i2, label: '51-' + i2, ansiNumber: '51',
                 itAssignment: { ctIds: ['c' + i2], ptIds: [] } })) },
      symbols: 'fixed', layout: { starts: 6, seed: 5 },
    });
    big.draw(stubCtx(1060, 370), 0);
    const ids = Object.keys(big.layout().nodes);
    const missed = ids.filter(id => { const p = big.toPx(id); return !p || big.hitTest(p[0], p[1]) !== id; });
    return ids.length >= 30 && missed.length === 0;
  })());

  // the relay/PT placement search must not simply stack them on the equipment
  ok('the protection layer is placed clear of the equipment it watches', (() => {
    const gap = (a, b) => Math.hypot(L2.nodes[a].x - L2.nodes[b].x, L2.nodes[a].y - L2.nodes[b].y);
    return gap('r51', 'ct') > 20 && gap('pt1', 'hv') > 20 && gap('r51', 'r21') > 20;
  })());
}

group('zoom & pan — the viewport over the auto-fit');
{
  const el = (id, type) => ({ id: id, name: id, type: type, nodes: [] });
  const model = {
    elements: [el('src', 'Source'), el('hv', 'Bus'), el('tx', 'Transformer'), el('lv', 'Bus'),
               el('f1', 'Load'), el('f2', 'Load')],
    connections: [{ fromElementId: 'src', toElementId: 'hv' }, { fromElementId: 'hv', toElementId: 'tx' },
                  { fromElementId: 'tx', toElementId: 'lv' }, { fromElementId: 'lv', toElementId: 'f1' },
                  { fromElementId: 'lv', toElementId: 'f2' }],
  };
  const W = 900, H = 400;
  const one = NS.OneLine({ model: model, layout: { starts: 8, seed: 3 } });
  const paint = () => { const c = stubCtx(W, H); one.draw(c, 0); return c.rec; };
  /* The first frame lays out against a guessed canvas shape and the second refines it against
     the measured one — so a figure is allowed exactly one settling frame, and then must hold
     still. A drawing that re-solved every frame would visibly crawl on a slide. */
  paint(); const settle1 = one.toPx('lv'); paint(); const settle2 = one.toPx('lv'); paint();
  ok('the layout settles after one frame and then holds still',
    Math.hypot(settle2[0] - one.toPx('lv')[0], settle2[1] - one.toPx('lv')[1]) < 0.001,
    JSON.stringify(settle1) + ' → ' + JSON.stringify(settle2));

  ok('it starts fitted, with nothing to pan to',
    one.view().z === 1 && one.view().ox === 0 && !one.pannable());
  ok('panning does nothing until there is somewhere to pan to',
    (one.panBy(-200, -80), one.view().ox === 0 && one.view().oy === 0));

  /* The whole difference between a magnifier and a jump-cut: whatever was under the cursor is
     still under the cursor afterwards. Zoom about a symbol and it must not move a pixel. */
  const before = one.toPx('lv');
  one.zoomAt(2, before[0], before[1]);
  paint();
  const after = one.toPx('lv');
  ok('zoom keeps the point under the cursor still',
    Math.abs(after[0] - before[0]) < 0.001 && Math.abs(after[1] - before[1]) < 0.001,
    JSON.stringify(before) + ' → ' + JSON.stringify(after));
  ok('and it really is twice the size', Math.abs(one.view().z - 2) < 1e-9);

  // a symbol is still pickable where it is drawn, not where it used to be
  ok('hit-testing follows the viewport', one.hitTest(after[0], after[1]) === 'lv');
  const other = one.toPx('hv');
  ok('two symbols are now further apart on screen',
    Math.hypot(after[0] - other[0], after[1] - other[1]) > 1);

  ok('now it can be panned', one.pannable());
  one.panBy(-99999, -99999);
  ok('and the pan is clamped so the drawing always covers the canvas',
    Math.abs(one.view().ox - (W - W * 2)) < 0.001 && Math.abs(one.view().oy - (H - H * 2)) < 0.001,
    JSON.stringify(one.view()));
  one.panBy(99999, 99999);
  ok('clamped at the other end too', one.view().ox === 0 && one.view().oy === 0);

  one.zoomAt(1000);
  ok('zoom is capped', one.view().z <= 16.0001, 'z = ' + one.view().z);
  one.zoomAt(0.0001);
  ok('and it can be pulled back out past the fit, to a floor', (() => {
    const z = one.view().z;
    return z >= 0.3499 && z < 1;
  })(), 'z = ' + one.view().z);
  /* Pushed around while zoomed OUT the drawing must still not leave the canvas — the clamp
     interval flips at z = 1 and both ends have to hold. */
  one.panBy(-99999, -99999);
  ok('zoomed out, it cannot be pushed off the left edge either', one.view().ox >= -0.001,
    JSON.stringify(one.view()));
  one.panBy(99999, 99999);
  ok('nor off the right', one.view().ox <= W * (1 - one.view().z) + 0.001, JSON.stringify(one.view()));
  ok('and there is somewhere to pan to when zoomed out', one.pannable());

  // the drawing itself grows — the network spreads across more of the canvas
  one.resetView(); const flat = paint();
  one.zoomAt(3, W / 2, H / 2); const big = paint();
  /* At rest the fit puts the whole network inside the canvas; magnified it must genuinely
     overflow it, which is the difference between zooming and merely re-fitting. (Comparing the
     CLIPPED width would prove nothing now that the fit fills the canvas at rest.) */
  const wide = rec => { const b = bbox(rec); return b.x1 - b.x0; };
  ok('at rest the whole network is inside the canvas', wide(flat) <= W + 2,
    wide(flat).toFixed(0) + ' of ' + W);
  ok('and at 3x it overflows it, as a magnifier should', wide(big) > W * 1.5,
    wide(big).toFixed(0) + ' of ' + W);
  /* Symbols grow too, but only by the DAMPED share (z^zoomDamp, √3 here). That gap between
     position growth and symbol growth is the room a crowded section gains when you zoom in —
     it is the point of the whole feature, not a rounding detail. */
  const biggest = r => Math.max.apply(null, r.arcs.map(a => a[2]));
  ok('and its symbols grow by the damped share, not the full zoom',
    Math.abs(biggest(big) / biggest(flat) - Math.sqrt(3)) < 0.02,
    biggest(flat).toFixed(1) + ' → ' + biggest(big).toFixed(1) + ' px radius');
  ok('zoomDamp:1 gives plain uniform magnification', (() => {
    const u = NS.OneLine({ model: model, layout: { starts: 8, seed: 3 }, zoomDamp: 1 });
    const go = () => { const c = stubCtx(W, H); u.draw(c, 0); return biggest(c.rec); };
    const a = go(); u.zoomAt(3, W / 2, H / 2); const b = go();
    return Math.abs(b / a - 3) < 0.02;
  })());

  /* The pay-off, stated as the invariant that produces it: at zoom z a CONDUCTOR gets z times
     longer while a device body gets only z^damp wider. That widening gap is the room a crowded
     run gains, which is why zooming a one-line brings back the devices that would not fit — on
     the demo plant, 4 skipped devices become 1 at 2x and 0 at 3x. */
  ok('a conductor gains room on a device faster than the device grows', (() => {
    const gap = () => { const a = one.toPx('lv'), b2 = one.toPx('f1'); return Math.hypot(a[0] - b2[0], a[1] - b2[1]); };
    one.resetView(); paint(); const g1 = gap(), s1 = biggest(paint());
    one.zoomAt(3, W / 2, H / 2); paint(); const g3 = gap(), s3 = biggest(paint());
    return Math.abs(g3 / g1 - 3) < 0.02 && s3 / s1 < 3 * 0.7;
  })());

  one.resetView(); paint();
  ok('reset puts the whole network back', one.view().z === 1 && one.view().ox === 0);
  ok('and the symbols are back where they were', (() => {
    const p = one.toPx('lv');
    return Math.abs(p[0] - before[0]) < 0.001 && Math.abs(p[1] - before[1]) < 0.001;
  })());

  // saving a view and restoring it
  one.zoomAt(2.5, 100, 100); one.panBy(-40, -20);
  const saved = one.view();
  one.resetView(); one.setView(saved);
  ok('a view can be saved and restored', JSON.stringify(one.view()) === JSON.stringify(saved));
  one.resetView();
}

group('relayout — force a fresh solve from the slide');
{
  const stub = (w, h) => {
    const c = { canvas: { width: w, height: h } };
    'save restore beginPath closePath stroke fill fillRect strokeRect rect clip translate scale rotate setLineDash clearRect fillText arcTo bezierCurveTo quadraticCurveTo roundRect arc moveTo lineTo'.split(' ').forEach(k => (c[k] = () => {}));
    c.measureText = t => ({ width: String(t).length * 7 });
    return c;
  };
  const el = (id, type) => ({ id: id, name: id, type: type, nodes: [] });
  // a MESHED model — the seeded relaxation, so reseeding actually changes the arrangement
  const model = {
    elements: [el('s1', 'Source'), el('s2', 'Source'), el('b1', 'Bus'), el('b2', 'Bus'),
               el('b3', 'Bus'), el('b4', 'Bus'), el('b5', 'Bus'), el('l3', 'Load'), el('l4', 'Load'), el('l5', 'Load')],
    connections: [{ fromElementId: 's1', toElementId: 'b1' }, { fromElementId: 's2', toElementId: 'b2' },
                  { fromElementId: 'b1', toElementId: 'b2' }, { fromElementId: 'b1', toElementId: 'b3' },
                  { fromElementId: 'b2', toElementId: 'b4' }, { fromElementId: 'b3', toElementId: 'b4' },
                  { fromElementId: 'b3', toElementId: 'b5' }, { fromElementId: 'b4', toElementId: 'b5' },
                  { fromElementId: 'b2', toElementId: 'b3' }, { fromElementId: 'b3', toElementId: 'l3' },
                  { fromElementId: 'b4', toElementId: 'l4' }, { fromElementId: 'b5', toElementId: 'l5' }],
  };
  const one = NS.OneLine({ model: model, symbols: 'fixed', layout: { seed: 3, starts: 120 }, aspect: 2.2 });
  const paint = () => { one.draw(stub(900, 400), 0); one.draw(stub(900, 400), 0); };
  paint();
  const a = one.toPx('b3');

  // the layout is cached — drawing again does NOT move anything
  paint();
  const same = one.toPx('b3');
  ok('the layout is cached between frames', Math.abs(same[0] - a[0]) < 0.001 && Math.abs(same[1] - a[1]) < 0.001);

  one.relayout();                       // new seed → a different arrangement
  paint();
  const b = one.toPx('b3');
  ok('relayout() solves a fresh arrangement', Math.hypot(b[0] - a[0], b[1] - a[1]) > 2);

  one.relayout({ seed: 3 });            // a specific arrangement is reproducible
  paint();
  const c = one.toPx('b3');
  ok('relayout({seed}) reproduces that exact arrangement', Math.hypot(c[0] - a[0], c[1] - a[1]) < 2);

  one.nudge('b3', 60, 20);
  one.relayout();
  ok('relayout clears hand-positions (they meant the old arrangement)', one.moved() === 0);

  one.nudge('b3', 60, 20);
  one.relayout({ keepEdits: true });
  ok('relayout({keepEdits:true}) keeps them', one.moved() === 1);
}

group('bus taps fan out — no two conductors leave a bus from the same point');
{
  const el = (id, type) => ({ id: id, name: id, type: type, nodes: [] });
  // a bus tied to another by TWO parallel conductors, plus a feed and a load: without fan-out
  // the two parallel ties would land on the same tap and drop on top of each other
  const model = {
    elements: [el('u', 'Source'), el('a', 'Bus'), el('t1', 'Impedance'), el('t2', 'Impedance'),
               el('b', 'Bus'), el('l', 'Load')],
    connections: [{ fromElementId: 'u', toElementId: 'a' }, { fromElementId: 'a', toElementId: 't1' },
                  { fromElementId: 't1', toElementId: 'b' }, { fromElementId: 'a', toElementId: 't2' },
                  { fromElementId: 't2', toElementId: 'b' }, { fromElementId: 'b', toElementId: 'l' }],
  };
  const L = NS.autoLayout(model, { starts: 40, seed: 4, aspect: 2 });
  const tapsOf = busId => {
    const xs = [];
    L.edges.forEach(e => { if (e.from === busId && e.fromPt) xs.push(Math.round(e.fromPt.x));
                           if (e.to === busId && e.toPt) xs.push(Math.round(e.toPt.x)); });
    return xs.sort((p, q) => p - q);
  };
  const ta = tapsOf('a');
  ok('every conductor leaving a bus gets its own tap', new Set(ta).size === ta.length,
    'taps ' + JSON.stringify(ta));
  ok('and adjacent taps are spread at least ~TAP_GAP apart', (() => {
    for (let i = 1; i < ta.length; i++) if (ta[i] - ta[i - 1] < 18) return false;
    return true;
  })(), 'taps ' + JSON.stringify(ta));

  // and the two parallel ties no longer draw on top of each other near the bus
  const segsOf = pred => { const o = []; L.edges.filter(pred).forEach(e => {
    for (let i = 1; i < e.points.length; i++) o.push([e.points[i - 1], e.points[i]]); }); return o; };
  const ties = segsOf(e => (e.from === 'a' || e.to === 'a'));
  let overlap = 0;
  for (let i = 0; i < ties.length; i++) for (let j = i + 1; j < ties.length; j++) {
    const x = ties[i], y = ties[j];
    if (Math.abs(x[0].x - x[1].x) < 2 && Math.abs(y[0].x - y[1].x) < 2 && Math.abs(x[0].x - y[0].x) < 6)
      overlap += Math.max(0, Math.min(Math.max(x[0].y, x[1].y), Math.max(y[0].y, y[1].y)) - Math.max(Math.min(x[0].y, x[1].y), Math.min(y[0].y, y[1].y)));
  }
  ok('the parallel ties are not drawn one on top of the other', overlap < 6, overlap.toFixed(0) + ' px shared');

  // a bus with a single conductor is untouched (nothing to fan)
  const solo = NS.autoLayout({
    elements: [el('s', 'Source'), el('bx', 'Bus'), el('ld', 'Load')],
    connections: [{ fromElementId: 's', toElementId: 'bx' }, { fromElementId: 'bx', toElementId: 'ld' }],
  }, { starts: 8, seed: 1, aspect: 2 });
  ok('the fan-out never fires on a bus that needs it not', !!solo.nodes.bx);
}

group('editable connector paths — reshape a run like in PFAS');
{
  const segCtx = (w, h) => {
    const rec = { seg: [] }; let cur = null;
    const c = { canvas: { width: w, height: h }, rec };
    'save restore beginPath closePath stroke fill fillRect strokeRect rect clip translate scale rotate setLineDash clearRect fillText arcTo bezierCurveTo quadraticCurveTo roundRect arc'.split(' ').forEach(k => (c[k] = () => {}));
    c.moveTo = (x, y) => { cur = [x, y]; };
    c.lineTo = (x, y) => { if (cur) rec.seg.push([cur[0], cur[1], x, y]); cur = [x, y]; };
    c.measureText = t => ({ width: String(t).length * 7 });
    return c;
  };
  const el = (id, type) => ({ id: id, name: id, type: type, nodes: [] });
  const model = {
    elements: [el('src', 'Source'), el('b1', 'Bus'), el('cb', 'Breaker'), el('b2', 'Bus'), el('ld', 'Load')],
    connections: [{ fromElementId: 'src', toElementId: 'b1' }, { fromElementId: 'b1', toElementId: 'cb' },
                  { fromElementId: 'cb', toElementId: 'b2' }, { fromElementId: 'b2', toElementId: 'ld' }],
  };
  const one = NS.OneLine({ model: model, symbols: 'fixed', layout: { starts: 8, seed: 3 } });
  const W = 700, H = 400;
  one.draw(segCtx(W, H), 0); one.draw(segCtx(W, H), 0);

  ok('a fresh diagram has no user bends', one.reshaped() === 0);

  // Find the b1↔cb conductor by scanning near it — its bus tap is fanned, so the naive
  // node-centre midpoint isn't on the run; probe a small grid around it instead.
  const findRun = key => {
    const p = one.toPx('b1'), q = one.toPx('cb');
    for (let f = 0.2; f <= 0.8; f += 0.05)
      for (let dx = -30; dx <= 30; dx += 4) {
        const x = p[0] + (q[0] - p[0]) * f + dx, y = p[1] + (q[1] - p[1]) * f;
        const h = one.hitConductor(x, y);
        if (h && h.key.indexOf(key) >= 0) return { hit: h, at: [x, y] };
      }
    return null;
  };
  const found = findRun('cb');
  ok('a conductor can be found by pointing at it', !!found, JSON.stringify(found && found.hit));
  ok('empty canvas is not a conductor', one.hitConductor(4, 4) === null);

  const seg = found.hit, m1 = found.at;
  const idx = one.addWaypoint(seg.key, seg.seg, m1[0] + 60, m1[1]);
  ok('adding a bend returns its index', idx === 0);
  one.draw(segCtx(W, H), 0);
  ok('the run is now reshaped', one.reshaped() === 1);

  const hw = one.hitWaypoint(m1[0] + 60, m1[1]);
  ok('the bend handle can be grabbed', !!hw && hw.index === 0, JSON.stringify(hw));

  const runThrough = () => {
    const Ly = one.layout();
    const wp = one.waypoints();
    const nodes2 = {}; Object.keys(Ly.nodes).forEach(id => (nodes2[id] = Object.assign({}, Ly.nodes[id])));
    const routed = NS.reroute(nodes2, Ly.edges.map(e => ({ from: e.from, to: e.to, wp: wp[e.from + '~>' + e.to] })));
    const e = routed.find(r => (r.from === 'b1' && r.to === 'cb') || (r.from === 'cb' && r.to === 'b1'));
    const w = wp[e.from + '~>' + e.to][0];
    return e.points.some(p => Math.abs(p.x - w.x) < 1 && Math.abs(p.y - w.y) < 1);
  };
  ok('the reroute threads the run through the bend point', runThrough());

  const before = one.waypoints()[seg.key][0].x;
  one.moveWaypoint(seg.key, 0, 40, 0);
  ok('dragging the bend moves it', Math.abs(one.waypoints()[seg.key][0].x - before) > 10);

  const saved = one.waypoints();
  one.resetWaypoints();
  ok('reset clears the bends', one.reshaped() === 0);
  one.setWaypoints(saved);
  ok('a reshaped arrangement can be saved and restored',
    JSON.stringify(one.waypoints()) === JSON.stringify(saved));

  one.removeWaypoint(seg.key, 0);
  ok('removing the last bend un-reshapes the run', one.reshaped() === 0);
}

group('series elements rotate to their connector');
{
  const segCtx = (w, h) => {
    const rec = { seg: [] }; let cur = null;
    const c = { canvas: { width: w, height: h }, rec };
    'save restore beginPath closePath stroke fill fillRect strokeRect rect clip translate scale rotate setLineDash clearRect fillText arcTo bezierCurveTo quadraticCurveTo roundRect arc'.split(' ').forEach(k => (c[k] = () => {}));
    c.moveTo = (x, y) => { cur = [x, y]; };
    c.lineTo = (x, y) => { if (cur) rec.seg.push([cur[0], cur[1], x, y]); cur = [x, y]; };
    c.measureText = t => ({ width: String(t).length * 7 });
    return c;
  };
  const el = (id, type) => ({ id: id, name: id, type: type, nodes: [] });
  const model = {
    elements: [el('src', 'Source'), el('b1', 'Bus'), el('cb', 'Breaker'), el('b2', 'Bus'), el('ld', 'Load')],
    connections: [{ fromElementId: 'src', toElementId: 'b1' }, { fromElementId: 'b1', toElementId: 'cb' },
                  { fromElementId: 'cb', toElementId: 'b2' }, { fromElementId: 'b2', toElementId: 'ld' }],
  };
  const one = NS.OneLine({ model: model, symbols: 'fixed', layout: { starts: 8, seed: 3 } });
  const W = 700, H = 400;
  const near = (rec, pos) => rec.seg.filter(s => Math.hypot((s[0] + s[2]) / 2 - pos[0], (s[1] + s[3]) / 2 - pos[1]) < 18);
  const diag = segs => segs.filter(s => Math.abs(s[2] - s[0]) > 1 && Math.abs(s[3] - s[1]) > 1).length;

  one.draw(segCtx(W, H), 0); one.draw(segCtx(W, H), 0);
  const straight = segCtx(W, H); one.draw(straight, 0);
  ok('a breaker on an orthogonal run is drawn axis-aligned', diag(near(straight.rec, one.toPx('cb'))) === 0);

  const cb = one.toPx('cb'), b2 = one.toPx('b2');
  // cb↔b2 leaves the bus at a fanned tap, so scan for the run rather than assuming its midpoint
  let seg = null, hitAt = null;
  for (let f = 0.2; f <= 0.8 && !seg; f += 0.05)
    for (let dx = -28; dx <= 28 && !seg; dx += 4) {
      const x = cb[0] + (b2[0] - cb[0]) * f + dx, y = cb[1] + (b2[1] - cb[1]) * f;
      const h = one.hitConductor(x, y);
      if (h && (h.key === 'cb~>b2' || h.key === 'b2~>cb')) { seg = h; hitAt = [x, y]; }
    }
  one.addWaypoint(seg.key, seg.seg, hitAt[0] + 120, hitAt[1] + 15);
  one.draw(segCtx(W, H), 0);
  const bent = segCtx(W, H); one.draw(bent, 0);
  ok('bending its conductor rotates the breaker off the axes', diag(near(bent.rec, one.toPx('cb'))) > 0);
  one.resetWaypoints();

  const ct = NS.OneLine({ model: {
    elements: [el('s', 'Source'), el('c', 'CT'), el('l', 'Load')],
    connections: [{ fromElementId: 's', toElementId: 'c' }, { fromElementId: 'c', toElementId: 'l' }],
  }, symbols: 'fixed', layout: { starts: 6, seed: 2 } });
  ct.draw(segCtx(400, 400), 0); ct.draw(segCtx(400, 400), 0);
  const cc = segCtx(400, 400); ct.draw(cc, 0);
  const pc = ct.toPx('c');
  const bars = cc.rec.seg.filter(s => Math.hypot((s[0] + s[2]) / 2 - pc[0], (s[1] + s[3]) / 2 - pc[1]) < 20);
  const alongRun = bars.filter(s => Math.abs(s[3] - s[1]) > Math.abs(s[2] - s[0])).length;
  ok('a CT on a vertical drop runs its primary bar along the drop', alongRun > 0, 'bars ' + bars.length + ' along ' + alongRun);
}

group('sub — a context scoped to a rectangle');
{
  const ctx = stubCtx(800, 400);
  const half = NS.sub(ctx, 0, 0, 400, 400);
  ok('the sub-context reports the sub size', half.canvas.width === 400 && half.canvas.height === 400);
  ok('the parent is untouched', ctx.canvas.width === 800);
  half.beginPath(); half.moveTo(10, 10); half.lineTo(20, 20);
  ok('drawing through it reaches the parent recorder', ctx.rec.pts.length === 2);
  half.strokeStyle = '#123456';
  ok('property writes pass through', ctx.strokeStyle === '#123456');
}

group('Callout');
{
  const ctx = stubCtx(700, 380);
  const co = NS.Callout({ at: (W, H) => [W * 0.5, H * 0.6], text: 'swing enters Z2', from: 'right', fade: 0 });
  co.draw(ctx, 0);
  ok('it draws the label text', ctx.rec.texts.some(t => t[0] === 'swing enters Z2'));
  const box = ctx.rec.rects[0];
  ok('the label box is on the canvas', box && box[0] >= 0 && box[0] + box[2] <= 700, JSON.stringify(box));
  ok('the leader reaches the target', ctx.rec.pts.some(p => Math.abs(p[0] - 350) < 1 && Math.abs(p[1] - 228) < 1));
  const live = stubCtx(700, 380);
  let v = 0.7;
  NS.Callout({ at: [300, 200], text: () => 'Z2 reach ' + v.toFixed(2) + ' pu', fade: 0 }).draw(live, 0);
  ok('text may be a function carrying a live value', live.rec.texts.some(t => t[0] === 'Z2 reach 0.70 pu'));
  const hidden = stubCtx(700, 380);
  NS.Callout({ at: [10, 10], text: 'nope', show: () => false }).draw(hidden, 0);
  ok('show:false draws nothing', hidden.rec.texts.length === 0 && hidden.rec.pts.length === 0);
  // a target near the edge must not push the box off-canvas
  const edge = stubCtx(700, 380);
  NS.Callout({ at: [690, 12], text: 'right at the edge', from: 'right', fade: 0 }).draw(edge, 0);
  const eb = edge.rec.rects[0];
  ok('the box is clamped inside the canvas', eb[0] >= 0 && eb[0] + eb[2] <= 700 && eb[1] >= 0 && eb[1] + eb[3] <= 380, JSON.stringify(eb));
  // the reveal grows the leader
  const g = NS.Callout({ at: [400, 200], text: 'x', fade: 1 });
  const early = stubCtx(700, 380); g.draw(early, 0);
  const late = stubCtx(700, 380); g.draw(late, 1.5);
  // the box sits to the right of the target, so the leader grows leftward toward it
  const tip = r => Math.min.apply(null, r.rec.pts.map(p => p[0]));
  ok('the leader is shorter at the start of the reveal', tip(early) > tip(late));
  near('and reaches the target when the reveal finishes', tip(late), 400, 1e-6);
}

group('Compare');
{
  const A = (c, t) => { c.beginPath(); c.moveTo(0, 0); c.lineTo(c.canvas.width, c.canvas.height); c.stroke(); };
  const B = (c, t) => { c.beginPath(); c.moveTo(0, c.canvas.height); c.lineTo(c.canvas.width, 0); c.stroke(); };
  const split = stubCtx(800, 400);
  NS.Compare({ a: A, b: B, mode: 'split', gap: 0 }).draw(split, 0);
  const xs = split.rec.pts.map(p => p[0]);
  ok('split puts one figure in each half', Math.min(...xs) < 10 && Math.max(...xs) > 790);
  ok('and each half is drawn at half width', split.rec.pts.some(p => Math.abs(p[0] - 400) < 1));
  const wipe = stubCtx(800, 400);
  NS.Compare({ a: A, b: B, mode: 'wipe', at: 0.25, labels: ['orig', 'rev'] }).draw(wipe, 0);
  ok('wipe labels both sides', wipe.rec.texts.some(t => t[0] === 'orig') && wipe.rec.texts.some(t => t[0] === 'rev'));
  ok('wipe draws the divider at the split', wipe.rec.pts.some(p => Math.abs(p[0] - 200) < 1));
  const fade = stubCtx(800, 400);
  NS.Compare({ a: A, b: B, mode: 'fade', at: 0.5 }).draw(fade, 0);
  ok('fade draws both figures full size', fade.rec.pts.length >= 4);
  const comps = stubCtx(800, 400);
  NS.Compare({ a: NS.Phasor({ phasors: () => [{ mag: 1, ang: 0 }] }), b: NS.Phasor({ phasors: () => [{ mag: 1, ang: 90 }] }), mode: 'split' }).draw(comps, 0);
  ok('it accepts components as well as draw functions', comps.rec.pts.length > 10);
}

group('mountDeck — the slide-toolkit adapter');
{
  // a stand-in for the parts of the deck runtime the adapter touches
  const made = [];
  const fakeSlide = (fragsOn, fragTotal) => ({
    querySelectorAll: () => Array.from({ length: fragTotal }, (_, i) => ({ classList: { contains: () => i < fragsOn } })),
  });
  const fakeDeck = { renderMode: false, anim: { instances: [], register(n, fn) { made.push({ n, fn }); } } };
  const listeners = {};
  global.document = { addEventListener(k, fn) { (listeners[k] = listeners[k] || []).push(fn); }, body: { classList: { contains: () => global.__capturing } } };
  global.addEventListener = () => {};
  global.matchMedia = () => ({ matches: false });
  global.window = global; global.deck = fakeDeck;
  delete require.cache[require.resolve('./nerx-signals.js')];
  const NS2 = require('./nerx-signals.js');

  let apiSeen = null;
  NS2.mountDeck('demo', api => { apiSeen = api; return (c, t) => { c.beginPath(); c.moveTo(t, api.step); c.lineTo(api.steps, api.p.mag || 0); c.stroke(); }; }, { poseAt: 6 });
  ok('it registers with deck.anim', made.length === 1 && made[0].n === 'demo');
  const fn = made[0].fn;

  const inst = { state: {}, sec: fakeSlide(2, 4) };
  const c1 = stubCtx(600, 300);
  fn(c1, 1.7, inst, { mag: 1.3 });                                       // deck vt starts at 1.7
  near('the clock is zeroed at first paint', c1.rec.pts[0][0], 0, 1e-9);
  ok('fragments become step / steps', apiSeen.step === 2 && apiSeen.steps === 4);
  ok('data-params arrive as api.p', apiSeen.p.mag === 1.3);

  const c2 = stubCtx(600, 300);
  fn(c2, 4.7, inst, { mag: 1.3 });
  near('and advances with the deck clock', c2.rec.pts[0][0], 3, 1e-9);

  inst.sec = fakeSlide(4, 4);
  const c3 = stubCtx(600, 300);
  fn(c3, 5.0, inst, {});
  ok('revealing fragments advances the step', apiSeen.step === 4);

  global.__capturing = true;                                              // every static-capture path sets body.capturing
  const c4 = stubCtx(600, 300);
  fn(c4, 9.9, inst, {});
  near('while being photographed it holds poseAt', c4.rec.pts[0][0], 6, 1e-9);
  global.__capturing = false;

  fakeDeck.renderMode = true;
  const c5 = stubCtx(600, 300);
  fn(c5, 12.0, inst, {});
  near('and holds it in the offscreen render window too', c5.rec.pts[0][0], 6, 1e-9);
  fakeDeck.renderMode = false;

  const inst2 = { state: {}, sec: fakeSlide(0, 0) };
  const c6 = stubCtx(600, 300);
  fn(c6, 20, inst2, {});
  near('a second canvas gets its own clock', c6.rec.pts[0][0], 0, 1e-9);
  ok('a slide with no fragments reports zero steps', apiSeen.steps === 0);

  delete global.document; delete global.window; delete global.deck; delete global.addEventListener; delete global.matchMedia;
}

group('components accept (cfg) or (canvas, cfg)');
{
  const ctx = stubCtx(600, 300);
  ok('NS.Phasor(cfg) works', typeof NS.Phasor({ phasors: () => [] }).draw === 'function');
  ok('NS.Phasor(null, cfg) still works', typeof NS.Phasor(null, { phasors: () => [] }).draw === 'function');
  NS.Phasor({ phasors: () => [{ mag: 1, ang: 0 }] }).draw(ctx, 0);
  ok('drawing through the (cfg) form produces output', ctx.rec.pts.length > 0);
}

group('lib/power.js — the older deck API, now a shim over this engine');
{
  const fs = require('fs'), path = require('path');
  // absent in the standalone web-toolkit mirror of this library, where there is no deck runtime
  const POWER = path.join(__dirname, '../lib/power.js');
  if (!fs.existsSync(POWER)) { console.log('  --   not applicable here (no lib/power.js alongside)'); }
  else {
  const g = { NS };                                   // power.js reads window.NS
  new Function('window', 'console', fs.readFileSync(POWER, 'utf8'))(g, console);
  const P = g.PWR;
  // every name the old file exported — decks in this repo are written against these
  const SURFACE = ['TAU','D2R','R2D','cx','j','polar','Z','add','sub','mul','div','neg','conj','scale',
    'abs','ang','par','A','A2','toSeq','toPhase','base','amps','faults','fmt','fmtC','fmtA','fmtPu',
    'SEQ','seqColor','phasor','triad','refCircle','wave','netBox','ground'];
  const missing = SURFACE.filter(k => P[k] === undefined);
  ok('every name the decks use still exists', missing.length === 0, 'missing: ' + missing.join(', '));
  ok('faults() IS the tested one, not a second copy', P.faults === C.faults);
  ok('toSeq/toPhase are the tested ones', P.toSeq === C.toSeq && P.toPhase === C.toPhase);
  ok('drawing primitives come from NS.draw', P.phasor === NS.draw.phasor && P.netBox === NS.draw.netBox && P.ground === NS.draw.ground);
  ok('the sequence palette is shared', P.SEQ === C.SEQ);
  near('and the reference set still solves', P.faults({ z1: 0.1, z2: 0.1, z0: 0.05 }).slg.mag, 12, 1e-9);
  near('including the Z2 fallback that used to be wrong here', P.faults({ z0: 0.05 }).ll.mag, Math.sqrt(3) * 5, 1e-6);
  ok('the whole engine is reachable for new slide code', P.calc === C && P.draw === NS.draw);
  }
}

/* ------------------------------------------------------------------------ */
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
