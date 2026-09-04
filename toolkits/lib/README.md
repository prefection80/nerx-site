# nerx-signals

A small, dependency-free library for building **power-engineering training toolkits** — the
common calculations, phasor animation, and plotting used across the NERX interactive figures.

One file (`nerx-signals.js`), one global (`NS`). Works as a browser `<script>` or a
Node module. `node test-nerx-signals.js` runs the reference checks. It grew out of the
slide-toolkit's `lib/power.js`, with the animation layer the decks re-implemented per slide
factored out into reusable components.

> **The canonical copy now lives in the slide toolkit**, at
> `C:\Presentation\slide-toolkit\lib\signals.js`, where it is built into every deck and the
> `mountDeck` adapter binds figures to slides. This folder is a mirror that serves the public web
> toolkits and the demo pages; refresh it by copying that file over `nerx-signals.js` (and
> `test/test-signals.js` over `test-nerx-signals.js`, adjusting the two require paths).

**Live demo of every component:** <https://www.nerxpower.com/toolkits/lib/demo.html>

```
NS = {
  calc,     // the math: complex, symmetrical components, per-unit, faults, duty, power,
            //           impedance/lines, transformers, CTs & distance, signal analysis, TCC
  draw,     // stateless one-frame canvas primitives (phasor, triad, refCircle, wave, ground)
  Phasor, Scope, Impedance, Coordination, Stability, Spectrum, OneLine,   // plot components
  Power, Decompose, Estimator,                                           //  …ten of them
  Callout, Compare, sub,   // presentation layer: annotate, contrast, split a canvas
  mount,       // standalone page: RAF loop, canvas fit, auto-generated controls
  mountDeck,   // inside slide-toolkit: deck clock, data-params, fragments, static poses
}
```

---

## Quick start

```html
<canvas id="cv"></canvas>
<div id="controls"></div>
<script src="nerx-signals.js"></script>
<script>
  const S = NS.calc.SEQ;                      // shared sequence colors
  const phasor = NS.Phasor({
    origin: [130, 150], radius: 96, rotate: 'ccw', freq: 0.16, waveform: 'right',
    phasors: () => [                          // a function, so it follows the sliders
      { mag: ui.p.mag, ang: 0,    color: S.a, label: 'a' },
      { mag: 1,        ang: -120, color: S.b, label: 'b' },
      { mag: 1,        ang: 120,  color: S.c, label: 'c' },
    ],
  });
  const ui = NS.mount('#cv', '#controls', {
    aspect: 0.33,
    params: { mag: { label: '|Iₐ|', min: 0.2, max: 1.6, step: 0.05, value: 1 } },
    view: (ctx, t) => phasor.draw(ctx, t),
  });
</script>
```

That is a complete, interactive toolkit — no build step, no framework.

---

## `mount(canvas, controls, cfg)` — the runtime

Handles the render clock, canvas sizing, and the control bar so a toolkit is a page of config.

| cfg field | Meaning |
| --- | --- |
| `params` | `{ name: {…} }`. A slider is `{ label, min, max, step, value }`; a dropdown is `{ label, choices:[…], value }`. Auto-rendered into `controls`. |
| `view(ctx, t, p, w, h)` | Called every frame. `t` = virtual seconds; `p` = live control values. |
| `aspect` | Canvas height ÷ width (default `0.4`). |
| `speed` | Virtual-time multiplier. |

Returns `{ p, canvas, ctx, fit, redraw }`. Under `prefers-reduced-motion` the *clock* stops, not
the toolkit: it holds a static frame but still repaints on every control change and resize, so the
sliders keep working. Call `redraw()` to force a frame yourself. Style the controls via the
`.ns-ctrl`, `.ns-lab`, `.ns-val` classes.

---

## Components

Every component is `NS.Xxx(cfg) → { draw(ctx, t), config, canvas }`. Call `draw` from a `mount`
view. Any config value that should track the sliders is passed as a **function** re-read each frame.

You can also write `NS.Xxx(canvas, cfg)` to bind a canvas up front, in which case `draw(t)` works
too. Both forms are accepted everywhere; the examples below use the short one.

### `Phasor` — phasor diagrams, animated
Rotating or static phasors on a reference frame, with an optional projected-waveform panel.
The projection is sine-referenced, so the trace leaves the arrow tip at the tip's own height and
the tie-line is horizontal. A phasor that collapses to zero length draws no label.
```js
NS.Phasor({
  origin: [150, 150], radius: 100,
  phasors: () => [ { mag, ang, color, label }, … ],   // or complex {re,im}
  rotate: 'ccw',        // 'ccw' | 'cw' | false
  freq: 0.25,           // revolutions / virtual second
  waveform: 'right',    // project traces beside the dial, or false
  refCircle: true, locus: false, scale: 'fit',
});
```

### `Scope` — oscillography strip
Multi-channel time record on a cycle grid, with a trigger and a sweep/scroll reveal.
```js
NS.Scope({
  window: 0.25, freq: 60, trigger: 0.08, motion: 'sweep',   // 'sweep'|'scroll'|'static'
  channels: () => [
    { name: 'Iₐ',  color: S.a,    signal: t => … },         // signal: (t) => value
    { name: '3I₀', color: S.zero, derived: 'residual' },     // = sum of the phase signals
  ],
  markers: false,
});
```
Channels share one vertical scale. Leave `gain` out and the tallest channel is auto-fitted to
~80 % of its row (the peak is held and released slowly, so a scrolling window doesn't breathe).
Set `gain` only to pin the scale yourself — it is px per unit relative to the row height, and a
trace that exceeds its row is flat-topped rather than allowed to smear across its neighbours.

### `Impedance` — R–X plane (distance relaying)
Mho / quadrilateral zones and a live apparent-impedance point with a trail.
```js
NS.Impedance({
  range: 1.2,
  zones: [ { type: 'mho', reach: 0.7, angle: 75, color, label: 'Z2', dash: [6,4] }, … ],
  point: t => ({ r, x }), trail: true, pointLabel: 'Z',
});
```

### `Coordination` — time-current curves
Log-log TCC for relays / fuses / damage curves, with a fault-current sweep line.
```js
NS.Coordination({
  iMin: 100, iMax: 100000, tMin: 0.01, tMax: 100,
  devices: () => [ { name: '51', color, curve: I => NS.calc.ocTime('IEEE-VI', I / pickup, TD) } ],
  faultCurrent: () => amps,
});
```

### `Stability` — power-angle & equal-area
Pre-fault / fault / post-fault P–δ curves with shaded accelerating and decelerating areas and a
swinging rotor-angle point.
```js
NS.Stability({ pmax: 1.8, pmaxFault: 0.5, pmaxPost: 1.5, pm: 1.0, clearAngle: 1.15 });
```
Both areas are integrated and read out as `A₁ / A₂` with a stable / unstable verdict (`areas:false`
hides it). The moving dot is a scripted sweep between δ₀ and δmax for illustration — it is not an
integration of the swing equation, so its *timing* is not physical. Pass `swing: t => δ` to drive
it yourself.

### `Spectrum` — harmonics & THD
A harmonic bar chart (% of fundamental) linked to its composite waveform, with a live THD readout.
```js
NS.Spectrum({
  showWave: true, maxOrder: 13,
  harmonics: () => [ { n: 1, mag: 1 }, { n: 3, mag: 0.25 }, { n: 5, mag: 0.15 } ],
});
```

### `OneLine` — schematic with animated flow
Buses, sources, transformers, loads, breakers, with current flowing as dots along the conductors.
```js
NS.OneLine({
  nodes: { src: { x, y, type: 'source', label }, b1: { x, y, type: 'bus', w: 46 }, … },
  edges: () => [ { from: 'src', to: 'b1', flow: 1.4, flowColor } ],  // flow sign = direction
});
```
Node `type`: `bus` · `source` · `gen` · `xfmr` · `line` · `load` · `breaker` · `fuse` · `ct` ·
`cap` · `reactor` · `relay` · `pt`. The symbols are the PFAS one-line set at PFAS's own proportions: filled shapes
in the category colour for the things that *are* a place (bar, source, generator, load), stroked
outlines over an opaque body for the things that sit *in* a conductor (transformer, breaker, fuse,
CT, series impedance) so the run passes behind them. A transformer reads `cp` / `cs`
(`'Wye' | 'Delta' | 'Wye-G'`) and draws Y, Δ and a ground rake accordingly, designated P and S.
`palette: 'ink'` drops the colour, `symScale` sizes the set, `bg` is what a body paints over the
conductor.

Give a `model` (`{ elements, connections, ansiRelays, instrumentTransformers }` — a PFAS project
export) instead of `nodes` and
`NS.autoLayout` places everything: bands from a 0-1 BFS that only costs when leaving a transformer,
a tidy tree or a clamped relaxation (whichever scores better), taps that slide along each bar, and
conductors routed the PFAS way — straight / L / a family of Z-bends with a sliding lane and a 90 px
overshoot, longest-first, priced on crossings, pierced symbols, collinear overlap per pixel, bends,
then length. `NS.drag(canvas, one)` then makes it something the room can work with: symbols drag,
empty canvas pans, the wheel (or a pinch) zooms about the cursor, and a double-click zooms in then
back to the fit. The conductors re-route and nothing comes unattached, because a conductor is its
two element ids, not coordinates. Every symbol is pickable — bus, breaker, CT, relay, PT alike —
and where two overlap the click goes to the one whose centre is nearest, in units of its own size.
In-line devices are laid out as part of the conductor rather than given their own row, but they are
real nodes: drag a CT and the runs either side follow it. Grab a wire where there is no symbol and pull to bend it (double-click a bend to remove it); every two-terminal device rotates to follow the segment it sits on, so a reshaped run tilts its breaker or CT with it. Relays and PTs come from the model's own
`ansiRelays` / `instrumentTransformers` collections and are wired by dotted `links` (blue for
current sensing, green for voltage) rather than conductors, so nothing about the power network is
implied by them. Zoom is damped — positions take the full zoom, symbols and name
tags take `z^zoomDamp` (0.5) — so magnifying spreads a crowded section out rather than just making
two symbols enormous; `zoomDamp: 1` for plain magnification. Zooming out (to 0.35x) is uniform. Pan
is clamped in both directions so the drawing never leaves the canvas. The fit is solved exactly for
the fixed-size symbols, so the network fills the canvas rather than being shrunk to reserve margin
for its own labels.

Nodes are authored in their own pixel space and the whole schematic is scaled and centred to fit
whatever canvas it gets (`fit: false` to keep your coordinates; `pad`, `minScale`, `maxScale`,
`reserve: {t,r,b,l}` tune the fit).

### `Power` — power factor, and what it costs
Three linked panels: V and I on a dial with the angle between them, `p(t) = v·i` underneath, and
the P–Q–S triangle.
```js
NS.Power({
  v: 1, i: () => ui.p.amps, pf: () => ui.p.pf, lead: false,
  show: ['dial', 'instantaneous', 'triangle'],   // any subset, in any order
  cycles: 2, negativeLobes: true, spin: 0.15,
});
```
The middle panel is the reason this exists. `p(t)` ripples at **twice** line frequency, its average
is P (drawn as a dashed line), and the moment pf leaves unity part of every cycle goes **negative** —
energy handed back to the source, shaded red. At pf = 1 the red vanishes; at pf = 0 the average is
zero and it is all sloshing. The triangle keeps a fixed hypotenuse, so it swings as pf changes
rather than growing. `calc.pqs(v, i, pf, lead)` and `calc.instPower({v, i, pf, lead, f})` are the
same maths on their own.

### `Decompose` — the transform as a construction
Rotate by the a-operator, add tip to tail, divide. Not a matrix.
```js
NS.Decompose({
  terms: () => [ { z: Va, rot: 0,   label: 'Vₐ' },      // rot = the a-operator angle, degrees
                 { z: Vb, rot: 120, label: 'a·V_b' },
                 { z: Vc, rot: 240, label: 'a²·V_c' } ],
  divide: 3, result: { label: 'V₁' },
  progress: () => ui.p.step,     // 0…1; anything non-finite lets it sweep on its own
  period: 8, captions: ['rotate', 'add tip to tail', '÷ 3'],
});
```
Rotations `[0,120,240]` build V₁, `[0,240,120]` builds V₂, `[0,0,0]` builds V₀ — and the same
component runs the inverse if you feed it sequence values and `divide: 1`. Drive `progress` from a
slider (or a fragment) to step it in front of a class; leave it out and it loops.

### `Estimator` — why the relay needs a cycle
A DFT window slides along a record; the phasor it produces is on a dial, and its magnitude against
window position is beside it.
```js
NS.Estimator({
  signal: t => amps, freq: 60, fs: 1920,
  window: 1, span: 0.15, trigger: 0.05, sweepPeriod: 6,
  refs: [ { mag: 0.5, label: 'load' }, { mag: 3, label: 'fault' } ],
});
```
The estimate only reads true once the window sits **entirely** inside the fault; everything before
that is a ramp between the two reference lines. Add dc offset to `signal` and a one-cycle window
overshoots — which is the honest lead-in to why filtering exists. `window` accepts a function, so a
dropdown can compare ½, 1 and 2 cycles.

---

### `Callout` — annotation that survives export
An arrow and a label anchored to a point in the figure, revealed on a step.
```js
NS.Callout({
  at: (W, H) => [W * 0.5, H * 0.6],     // pixels; a function so it follows a resize
  text: 'the swing crosses in',          // '\n' for two lines
  from: 'right',                         // which side the label sits on: left|right|above|below
  show: () => api.step >= 2, fade: 0.35, gap: 62, color: '#b06e00',
});
```
Live ink is better for improvising; a callout is for the annotation you always make, and unlike ink
it is in the PDF and in the snapshot. The label box is clamped inside the canvas, so a target near
an edge still reads. To anchor to *figure* coordinates rather than pixels, pin the figure's scale
(`Impedance` takes `origin` and `scale`) and convert — see panel 13 of the demo.

### `Compare` — two figures, one canvas
```js
NS.Compare({ a: origFigure, b: revFigure, mode: 'wipe',   // 'wipe' | 'split' | 'fade'
             at: () => ui.p.position, labels: ['before', 'after'] });
```
`wipe` draws both at full size and splits them at a draggable divider — the right tool when the two
sides share geometry, which is exactly the `-orig` / `-rev` slide pairs in the Part 1 deck. `split`
gives each figure half the canvas (via `sub`, so each one still sizes itself correctly), and `fade`
crossfades. `a` and `b` may be components or bare `(ctx, t)` functions.

### `sub(ctx, x, y, w, h)`
A context scoped to a rectangle: it forwards every call to the real canvas but reports the sub-rect
as `ctx.canvas`. Since every component sizes itself from `ctx.canvas`, this is how you put two of
them side by side. Pair it with `ctx.translate` — `Compare`'s split mode is four lines of it.

## Putting figures on slides

`mount` assumes it owns the page: its own RAF loop, its own control strip, its own clock. Inside a
slide-toolkit deck all three belong to the deck, so use `mountDeck` instead.

```js
// in slides/07-decomposition.js
NS.mountDeck('decompose', api => NS.Decompose({
  progress: () => (api.steps ? api.step / api.steps : NaN),   // fragments drive the build
  terms:    () => buildTerms(api.p.mag),                       // data-params drive the numbers
}), { poseAt: 6 });
```
```html
<canvas data-anim="decompose" data-params="mag=1.3 [0.2..1.8/0.05] '|Vₐ|'" width="1060" height="400"></canvas>
<p class="frag">rotate by the a-operator</p>
<p class="frag">add tip to tail</p>
<p class="frag">divide by three</p>
```

`build(api, inst)` runs once per canvas and returns a component, a `(ctx, t, api)` function, or an
array of either. `api` is the same object every frame, refreshed before each draw:

| field | |
| --- | --- |
| `p` | the slide's `data-params` values — the deck renders the control strip and persists them |
| `step` / `steps` | how many `.frag` elements on this slide are revealed, out of how many |
| `t` | seconds since this canvas first painted (the deck's own clock starts at 1.7, not 0) |
| `inst` | the raw animation instance, if you need `speed`, `playing` or `state` |

Options: `poseAt` (see below) · `restart: true` re-zeros the clock on `deck:slide`, the way the
vector-hour-codes scenes replay on entry · `absolute: true` passes the deck's raw `vt` through ·
`clear: false` if you want to paint over what is already on the canvas.

**`poseAt` — a chosen still.** Animated figures are photographed in three places: `cli.js snapshots`,
the PDF/print render, and the offscreen window that supplies transition textures. None of them run
a normal animation loop, so whatever half-finished tween the capture lands on is what ends up in the
export. `poseAt: 6` says "when being photographed, draw me at t = 6" — the `Estimator` window
mid-slide, the `Power` triangle at the pf you want. All three paths set `body.capturing`, so the
adapter detects them without any change to the deck. `prefers-reduced-motion` holds the same pose.

Two things you get for free: `deck.param('decompose', 'mag', 0.4)` drives the figure from the
console or a recorded session, and because every label goes through `ctx.fillText`, the deck's
in-place edit and move modes can retitle and reposition canvas text the same as any other slide.

## `calc` — the calculations

Every quantity is a complex `{re, im}` in per-unit unless amperes are requested; a bare number is
a pure reactance (`0.1` → `j0.1`).

| Family | Functions |
| --- | --- |
| Complex & phasor | `polar · add sub mul div neg conj scale · abs · ang · rot · par` |
| Symmetrical components | `toSeq · toPhase · A · unbalance` |
| Per-unit & base | `base(mva,kv) · amps · toPu · toOhms · pctZtoPu · changeBase` |
| Three-phase power | `power3ph(vll,il,pf) · complexPower(v,i) · pf · pqs(v,i,pf,lead) · instPower({v,i,pf,f})` |
| Fault currents | `faults({z1,z2,z0,zf,zn,e,mva,kv}) → {threePhase, slg, ll, llg} · faultMVA` |
| Short-circuit duty | `xr · dcDecay · peakFactor · rmsAsymFactor` |
| Impedance & lines | `series · parallel · line({r,x,b})` |
| Transformers | `vectorShift(hour) · xfmrZeroSeq(hv,lv,core)` |
| CTs | `ctRatio(pri,sec) · ctSecondary · ctClass('C400') · ctBurdenVolts · ctSaturation` |
| Distance & directional | `zSecondary · zPrimary · k0(z1,z0) · apparentZground · apparentZphase · directional(v,i,mta)` |
| Signal analysis | `phasorOf(samples,f,fs) · waveform({mag,ang,f,dc,tau,harmonics}) · rms · thd` |
| Overcurrent curves | `ocTime(curve, M, TD)` · `OC_CURVES` (IEEE-MI/VI/EI, IEC-SI/VI/EI) |
| Scales & format | `logScale(min,max,px0,px1) · fmtC · fmtPu · fmtA · fmtDeg · SEQ` |

`faults()` reference: with `z1 = z2 = j0.1`, `z0 = j0.05` → 3φ **10.0**, L-L **8.66**, SLG **12.0** pu.

Each result of `faults()` carries `{ seq:{i0,i1,i2}, phase:{a,b,c}, ig (3I₀), mag, amps }`.

Three conventions worth knowing:

- **`ocTime`** applies each standard's own dial: IEEE C37.112 is `(TD/7)·(A/(Mᵖ−1)+B)` with TD
  0.5–15, IEC 60255 is `TMS·A/(Mᵖ−1)`. Pass the dial as the relay states it and the seconds come
  out right — `ocTime('IEEE-VI', 5, 3)` = **0.561 s**.
- **`phasorOf` is sine-referenced**, so it round-trips with `waveform()`: feed it
  `waveform({mag:1.4, ang:30})` and you get back 1.4 ∠ 30°.
- **`thd`** takes either shape — an order-indexed array (`[ , V₁, V₂ … ]`, complex or number) or
  the `[{n, mag}]` list the `Spectrum` component uses.

### Relay & protection

`ctSaturation` answers the question the CT sizing sheet asks — does the core ride through the
fault, and if not, how long do you get before it folds? It's the IEEE C37.110 check: Ks = Vk/Vs,
and `tSat = −T₁·ln[1 − (Ks−1)/(X/R)]`, which is `Infinity` when `Ks − 1 ≥ X/R`.

```js
NS.calc.ctSaturation({
  ifault: 12000, ratio: NS.calc.ctRatio(1200, 5),   // 50 A secondary
  rct: 0.5, rlead: 0.4, zrelay: 0.1,                // → Vs = 50 V
  vk: 400, xr: 15, remanence: 0,                    // C400 core
});
// { isec: 50, vs: 50, ks: 8, tSat: 0.025, cycles: 1.5, saturates: true }
```
Drop `xr` to 5 and the same CT rides through. `remanence` (0…1) discounts the knee for trapped
flux. `ctClass('C400')` returns `{ volts: 400, at: 100, burden: 4 }` — the class is defined at
20× rated secondary, so it gives you the standard burden for free.

For distance work, `k0(z1, z0)` is the residual compensation factor `(Z₀ − Z₁)/3Z₁`,
`apparentZground(va, ia, k0, ig)` is the ground loop `Va/(Ia + k₀·3I₀)`, `apparentZphase` is
`ΔV/ΔI`, and `zSecondary(zpri, ct, pt)` moves primary ohms to the relay's own scale. Feed the
result straight into the `Impedance` component's `point`. `directional(v, i, mta)` returns
`{ angle, torque, forward }` for a 32 element.

---

## Development

```bash
node test-nerx-signals.js             # the full suite — calc references + component geometry
node --check nerx-signals.js          # syntax
```
`calc` is pure and unit-testable in Node: fault-current references, base change, IEEE/IEC operate
times, DFT round-trip, THD, transformer verdicts, log scales. The components are tested the same
way — `test-nerx-signals.js` draws them into a recording stub context and asserts the *geometry*
(the phasor projection lands on the arrow tip, scope traces stay inside their rows, the one-line
fills its canvas), so a visual regression fails the suite instead of waiting to be noticed on a
slide.

## Roadmap
- **Arc-flash** (IEEE 1584-2018) incident energy — deliberately not stubbed in: the 2018 model is
  a table of per-electrode-configuration coefficients plus the 600 V / 2700 V / 14 300 V
  interpolation, and those have to be transcribed from the standard, not reconstructed.
- A **CT saturation** component — `ctSaturation` gives the verdict; the secondary waveform
  collapsing on a `Scope` strip is the picture that goes with it.
- **`PowerThreePhase`** — the same `p(t)` for all three phases plus their sum. Balanced, the sum is
  a flat line; unbalance it and the sum ripples, which is negative sequence showing up as a
  mechanical beat. The bridge between the power deck and the symmetrical-components one.
- **`Field`** — three windings, three currents, one rotating MMF vector. Positive sequence turns it
  forward, negative sequence backwards: the picture behind negative-sequence rotor heating.
- **`VectorClock`** — HV/LV triads on a clock face wired to `vectorShift`, which would replace most
  of the nine bespoke canvases in the `vector-hour-codes` deck.
- More presentation furniture: **`Legend`** (a shared key for the sequence palette, hand-drawn in
  most figures today), **`Readout`** (a KPI strip fed by the same params as the figure, so the
  numbers and the picture can't disagree), **`Equation`** (a formula on canvas with addressable
  terms, so a step can highlight `Z₀ + 3Z_n`), **`Timeline`** (sequence of events on the same time
  axis as `Scope`), and **`Table`** (row reveal and cell emphasis — dull, and the one you'd use
  most).
- A figure-space helper so `Callout` can anchor to `{r, x}` or `{mag, ang}` without pinning scales
  by hand — each component would expose the transform it already computes.
- Retrofitting the existing symmetrical-components toolkits onto this library.
