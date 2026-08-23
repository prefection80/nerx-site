# nerx-signals

A small, dependency-free library for building **power-engineering training toolkits** — the
common calculations, phasor animation, and plotting used across the NERX interactive figures.

One file (`nerx-signals.js`, ~25 KB), one global (`NS`). Works as a browser `<script>` or a
Node module. It's a standalone port and extension of the slide-toolkit's `lib/power.js`, with
the animation layer the decks re-implemented per slide factored out into reusable components.

**Live demo of every component:** <https://www.nerxpower.com/toolkits/lib/demo.html>

```
NS = {
  calc,     // the math: complex, symmetrical components, per-unit, faults, duty, power,
            //           impedance/lines, transformers, signal analysis, TCC curves
  draw,     // stateless one-frame canvas primitives (phasor, triad, refCircle, wave, ground)
  Phasor, Scope, Impedance, Coordination, Stability, Spectrum, OneLine,   // plot components
  mount,    // a tiny runtime: RAF loop, canvas fit, auto-generated controls
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
  const phasor = NS.Phasor(null, {
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

Returns `{ p, canvas, ctx, fit }`. It pauses under `prefers-reduced-motion` (drawing one static
frame) and re-fits on resize. Style the controls via the `.ns-ctrl`, `.ns-lab`, `.ns-val` classes.

---

## Components

Every component is `NS.Xxx(canvas, cfg) → { draw(ctx, t), config }`. Call `draw` from a `mount`
view. Any config value that should track the sliders is passed as a **function** re-read each frame.

### `Phasor` — phasor diagrams, animated
Rotating or static phasors on a reference frame, with an optional projected-waveform panel.
```js
NS.Phasor(null, {
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
NS.Scope(null, {
  window: 0.25, freq: 60, trigger: 0.08, motion: 'sweep',   // 'sweep'|'scroll'|'static'
  channels: () => [
    { name: 'Iₐ',  color: S.a,    signal: t => … },         // signal: (t) => value
    { name: '3I₀', color: S.zero, derived: 'residual' },     // = sum of the phase signals
  ],
  markers: false, gain: 6,
});
```

### `Impedance` — R–X plane (distance relaying)
Mho / quadrilateral zones and a live apparent-impedance point with a trail.
```js
NS.Impedance(null, {
  range: 1.2,
  zones: [ { type: 'mho', reach: 0.7, angle: 75, color, label: 'Z2', dash: [6,4] }, … ],
  point: t => ({ r, x }), trail: true, pointLabel: 'Z',
});
```

### `Coordination` — time-current curves
Log-log TCC for relays / fuses / damage curves, with a fault-current sweep line.
```js
NS.Coordination(null, {
  iMin: 100, iMax: 100000, tMin: 0.01, tMax: 100,
  devices: () => [ { name: '51', color, curve: I => NS.calc.ocTime('IEEE-VI', I / pickup, TD) } ],
  faultCurrent: () => amps,
});
```

### `Stability` — power-angle & equal-area
Pre-fault / fault / post-fault P–δ curves with shaded accelerating and decelerating areas and a
swinging rotor-angle point.
```js
NS.Stability(null, { pmax: 1.8, pmaxFault: 0.5, pmaxPost: 1.5, pm: 1.0, clearAngle: 1.15 });
```

### `Spectrum` — harmonics & THD
A harmonic bar chart (% of fundamental) linked to its composite waveform, with a live THD readout.
```js
NS.Spectrum(null, {
  showWave: true, maxOrder: 13,
  harmonics: () => [ { n: 1, mag: 1 }, { n: 3, mag: 0.25 }, { n: 5, mag: 0.15 } ],
});
```

### `OneLine` — schematic with animated flow
Buses, sources, transformers, loads, breakers, with current flowing as dots along the conductors.
```js
NS.OneLine(null, {
  nodes: { src: { x, y, type: 'source', label }, b1: { x, y, type: 'bus', w: 46 }, … },
  edges: () => [ { from: 'src', to: 'b1', flow: 1.4, flowColor } ],  // flow sign = direction
});
```
Node `type`: `bus` · `source` · `xfmr` · `load` · `breaker`.

---

## `calc` — the calculations

Every quantity is a complex `{re, im}` in per-unit unless amperes are requested; a bare number is
a pure reactance (`0.1` → `j0.1`).

| Family | Functions |
| --- | --- |
| Complex & phasor | `polar · add sub mul div neg conj scale · abs · ang · rot · par` |
| Symmetrical components | `toSeq · toPhase · A · unbalance` |
| Per-unit & base | `base(mva,kv) · amps · toPu · toOhms · pctZtoPu · changeBase` |
| Three-phase power | `power3ph(vll,il,pf) · complexPower(v,i) · pf` |
| Fault currents | `faults({z1,z2,z0,zf,zn,e,mva,kv}) → {threePhase, slg, ll, llg} · faultMVA` |
| Short-circuit duty | `xr · dcDecay · peakFactor · rmsAsymFactor` |
| Impedance & lines | `series · parallel · line({r,x,b})` |
| Transformers | `vectorShift(hour) · xfmrZeroSeq(hv,lv,zn,core)` |
| Signal analysis | `phasorOf(samples,f,fs) · waveform({mag,ang,f,dc,tau,harmonics}) · rms · thd` |
| Overcurrent curves | `ocTime(curve, M, TD)` · `OC_CURVES` (IEEE-MI/VI/EI, IEC-SI/VI/EI) |
| Scales & format | `logScale(min,max,px0,px1) · fmtC · fmtPu · fmtA · fmtDeg · SEQ` |

`faults()` reference: with `z1 = z2 = j0.1`, `z0 = j0.05` → 3φ **10.0**, L-L **8.66**, SLG **12.0** pu.

Each result of `faults()` carries `{ seq:{i0,i1,i2}, phase:{a,b,c}, ig (3I₀), mag, amps }`.

---

## Development

```bash
node --check nerx-signals.js          # syntax
node -e "require('./nerx-signals.js')" # load
```
The `calc` module is pure and unit-testable in Node (see the checks used during the build:
fault-current references, base change, IEEE/IEC operate times, DFT recovery, transformer
verdicts). The visual components render on any `<canvas>`; drive `component.draw(ctx, t)` directly
to test them headlessly.

## Roadmap
- **Relay & protection** calc family — CT ratio/burden, distance reach, directional angle.
- **Arc-flash** (IEEE 1584) incident energy.
- Retrofitting the existing symmetrical-components toolkits onto this library.
