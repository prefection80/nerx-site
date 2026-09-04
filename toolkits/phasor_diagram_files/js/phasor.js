// ====================================================
// PHASOR MATH — class Phasor
// Source: phasor_diagram.html lines 1508–1520
// Exports: Phasor
// Imports: none
// ====================================================

export class Phasor {
  constructor(re, im) { this.re = re; this.im = im; }
  get mag() { return Math.hypot(this.re, this.im); }
  get ang() { return Math.atan2(this.im, this.re); }
  get angDeg() { return this.ang * 180 / Math.PI; }
  add(b) { return new Phasor(this.re + b.re, this.im + b.im); }
  sub(b) { return new Phasor(this.re - b.re, this.im - b.im); }
  mul(b) { return new Phasor(this.re*b.re - this.im*b.im, this.re*b.im + this.im*b.re); }
  div(b) { const d = b.re*b.re + b.im*b.im; return new Phasor((this.re*b.re+this.im*b.im)/d, (this.im*b.re-this.re*b.im)/d); }
  neg() { return new Phasor(-this.re, -this.im); }
  conj() { return new Phasor(this.re, -this.im); }
  static polar(mag, degAngle) { const r = degAngle * Math.PI / 180; return new Phasor(mag * Math.cos(r), mag * Math.sin(r)); }
}
