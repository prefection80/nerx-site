// ====================================================
// PRESETS — single-set and multi-set preset equation strings
// Source: phasor_diagram.html lines 1924–2372
// Exports: PRESETS, MULTI_PRESETS
// Imports: none
// ====================================================

export const PRESETS = {
  lag: `# Lagging (inductive) load — voltage drop study
# osc1 = Voltages, osc2 = Current
Vs = 1.0 < 0 :: osc1
I  = 0.85 < -32 :: osc2
R  = 0.05 :: ds
X  = 0.25 :: ds
VR = R * I :: osc1
VX = j * X * I :: osc1
Vr = Vs - VR - VX :: osc1
IRdrop = VR :: Vr
IXdrop = VX :: IRdrop`,

  lead: `# Leading (capacitive) load
# With leading current the voltage drop
# can reverse direction, causing Vr > Vs
Vs = 1.0 < 0
I  = 0.45 < 28
Z  = 0.04 + j0.22 :: ds
Vdrop = Z * I
Vr = Vs - Vdrop
Vd = Vdrop :: Vr`,

  threephase: `# Balanced 3-phase system — Triple Diagram
# Switch to Triple Diagram view to see
# each phase in its own diagram
# osc1 = Voltages (line-to-ground), osc2 = Currents
#
# System parameters
Zload = 1.5 < 32 :: ds
#
# Phase A — Diagram 1
Vag = 1.0 < 0 :: d1 osc1
Ia = Vag / Zload :: d1 osc2
#
# Phase B — Diagram 2
Vbg = 1.0 < -120 :: d2 osc1
Ib = Vbg / Zload :: d2 osc2
#
# Phase C — Diagram 3
Vcg = 1.0 < 120 :: d3 osc1
Ic = Vcg / Zload :: d3 osc2
#
# Power factor
PF = cos(ang(Vag) - ang(Ia)) :: ds`,

  vdrop: `# Feeder voltage drop study
# Vsrc  = source bus voltage
# Iload = load current at 0.8 PF lagging
# Zline = feeder impedance R + jX
Vsrc = 1.05 < 0
Iload = 0.9 < -36.87
Zline = 0.08 + j0.35 :: ds
Vdrop = Zline * Iload
Vload = Vsrc - Vdrop
Vd = Vdrop :: Vload
#
# Voltage regulation
Vreg = (abs(Vsrc) - abs(Vload)) / abs(Vload) :: ds`,

  cap: `# Power factor correction with cap bank
# Compare voltage before and after correction
Vs = 1.0 < 0
Iload = 0.95 < -44
Z = 0.06 + j0.28 :: ds
#
# Before correction
Vdrop1 = Z * Iload
Vr1 = Vs - Vdrop1
Vd1 = Vdrop1 :: Vr1
PFbefore = cos(44) :: ds
#
# After correction — add cap current
Icap = 0.55 < 90
Itotal = Iload + Icap
Vdrop2 = Z * Itotal
Vr2 = Vs - Vdrop2
Vd2 = Vdrop2 :: Vr2
PFafter = cos(abs(ang(Itotal))) :: ds`,

  symcomp: `# Symmetrical component decomposition
# Uses seq() and phase() built-in transforms
# Switch to Triple Diagram: d1=Pos, d2=Neg, d3=Zero
#
# Sequence quantities (inputs)
V1 = 0.92 < 0 :: ds
V2 = 0.12 < -140 :: ds
V0 = 0.06 < 30 :: ds
#
# Reconstruct line-to-ground phase voltages
Vag, Vbg, Vcg = phase(V0, V1, V2)
#
# Verify: decompose back to sequence
V0x, V1x, V2x = seq(Vag, Vbg, Vcg)
#
# Unbalance factor
VUF = abs(V2) / abs(V1) :: ds`,

  fault: `# Bolted SLG fault on phase A
# All three sequence networks in series
# I1 = I2 = I0 = Vf / (Z1 + Z2 + Z0)
# osc1 = Voltages (LG at fault), osc2 = Currents
#
Vf = 1.0 < 0 :: ds
Z1 = 0.0 + j0.15 :: ds
Z2 = 0.0 + j0.15 :: ds
Z0 = 0.0 + j0.25 :: ds
Ztot = Z1 + Z2 + Z0 :: ds
#
# Sequence currents (all equal for SLG)
I1 = Vf / Ztot :: osc2
I2 = I1 :: osc2
I0 = I1 :: osc2
#
# Phase currents via built-in transform
Ia, Ib, Ic = phase(I0, I1, I2) :: osc2
#
# Sequence voltages at fault
Vs1 = Vf - Z1 * I1 :: osc1
Vs2 = -Z2 * I2 :: osc1
Vs0 = -Z0 * I0 :: osc1
#
# Line-to-ground voltages at fault (Vag = 0 for bolted SLG)
Vag, Vbg, Vcg = phase(Vs0, Vs1, Vs2) :: osc1`,

  kvl: `# KVL around series RLC circuit
# Voltages drawn head-to-tail to show
# they sum to the source voltage
I = 1.0 < 0
VR = 0.4 < 0
VL = 0.7 < 90 :: VR
VC = 0.35 < -90 :: VL
Vs = VR + VL + VC`,

  shuntcap: `# Shunt capacitor bank — bus voltage support
# The cap draws leading current from the line,
# reducing the net reactive current and IX drop
Vs    = 1.0 < 0
Iload = 0.8 < -40
Zline = 0.03 + j0.18 :: ds
Bc    = 0.35 :: ds
#
Ic    = j * Bc * Vs
Inet  = Iload + Ic
Vdrop = Zline * Inet
Vbus  = Vs - Vdrop
Vd    = Vdrop :: Vbus
#
PFbefore = cos(40) :: ds
PFafter = cos(abs(ang(Inet))) :: ds`,

  shuntreactor: `# Shunt reactor — Ferranti effect control
# On a lightly loaded line, shunt capacitance
# causes Vr > Vs. The reactor absorbs VARs
# to counteract this voltage rise.
Vs    = 1.0 < 0
Zline = 0.01 + j0.30 :: ds
Iload = 0.15 < 5
BL    = 0.25 :: ds
#
Ireac = -j * BL * Vs
Inet  = Iload + Ireac
Vdrop = Zline * Inet
Vr    = Vs - Vdrop
Vd    = Vdrop :: Vr`,

  llfault: `# Bolted LL fault — phases B and C
# Pos & neg sequence networks in parallel
# I2 = -I1, I0 = 0 (no ground path)
# osc1 = Voltages, osc2 = Currents
#
Vf = 1.0 < 0 :: ds
Z1 = 0.0 + j0.15 :: ds
Z2 = 0.0 + j0.15 :: ds
Ztot = Z1 + Z2 :: ds
#
# Sequence currents
I1 = Vf / Ztot :: osc2
I2 = -I1 :: osc2
I0 = 0.0 < 0 :: osc2
#
# Phase currents via built-in transform
Ia, Ib, Ic = phase(I0, I1, I2) :: osc2
#
# Sequence voltages
Vs1 = Vf - Z1 * I1 :: osc1
Vs2 = Z2 * I1 :: osc1
Vs0 = 0.0 < 0 :: osc1
#
# Line-to-ground voltages at fault (V0=0 so LG = LN)
Vag, Vbg, Vcg = phase(Vs0, Vs1, Vs2) :: osc1`,

  seqtrip: `# Sequence ↔ Phase — Triple Diagram
# Switch to Triple Diagram view:
#   d1 = Line-to-ground (measured)
#   d2 = Sequence components (analytical)
#   d3 = Line-to-line (derived)
#
# Unbalanced line-to-ground voltages
Vag = 1.00 < 0 :: d1 osc1
Vbg = 0.85 < -130 :: d1 osc1
Vcg = 0.92 < 115 :: d1 osc1
#
# Decompose LG to sequence components
V0, V1, V2 = seq(Vag, Vbg, Vcg) :: d2 osc2
#
# Derive line-to-line (V0 cancels)
Vab, Vbc, Vca = lgtoll(Vag, Vbg, Vcg) :: d3 osc3
#
# Extract line-to-neutral (strip V0)
Van, Vbn, Vcn = lgtoln(Vag, Vbg, Vcg) :: ds
#
# Verify round-trip: sequence back to LG
Vagx, Vbgx, Vcgx = phase(V0, V1, V2) :: ds
#
# Metrics
VUF = abs(V2) / abs(V1) :: ds
Vzero = abs(V0) :: ds`,

  powertri: `# Power Triangle — per-phase and three-phase
# Uses built-in power functions
# Switch to Triple Diagram:
#   d1 = Voltage & current phasors
#   d2 = Per-phase power triangle (S, P, Q)
#   d3 = Three-phase power triangle (S3, P3, Q3)
#
# Source and load
Vag = 1.0 < 0 :: d1 osc1
Zload = 1.25 < 36.87 :: ds
Ia = Vag / Zload :: d1 osc2
#
# Per-phase power (built-in functions)
PF = pf(Vag, Ia) :: ds
S1 = power(Vag, Ia) :: ds
P1 = preal(Vag, Ia) :: ds
Q1 = qreactive(Vag, Ia) :: ds
#
# Per-phase power triangle drawn head-to-tail
# P along real axis, jQ vertical (sign preserved), S is hypotenuse
Pph = P1 < 0 :: d2
Qph = j * Q1 :: Pph d2
Sph = S1 :: d2
#
# Three-phase power
S3 = s3p(Vag, Ia) :: ds
P3 = re(S3) :: ds
Q3 = im(S3) :: ds
#
# Three-phase power triangle
Pph3 = P3 < 0 :: d3
Qph3 = j * Q3 :: Pph3 d3
Sph3 = S3 :: d3
#
# Power factor angle
theta = ang(Vag) - ang(Ia) :: ds`,

  phasedist: `# Phase Distance Relay — B-C Phase Fault
# Adjust fault location and resistance below,
# then observe Zrelay on the impedance plane
#
# ======= USER INPUTS (edit these) =======
# Fault location (0 = relay bus, 1 = remote end)
m = 0.50 < 0
# Fault resistance in ohms (pu)
Rf = 0.03 < 0
# Protected line impedance
Zline = 0.02 + j0.18 :: ds
# Source impedance
Zs = 0.0 + j0.05 :: ds
# Pre-fault voltage
Vf = 1.0 < 0 :: ds
# =========================================
#
# Impedance to fault point
Zfault = m * Zline :: ds
#
# B-C fault: I1 = Vf/(Zs + mZline + Rf), I2 = -I1
I1 = Vf / (Zs + Zfault + Rf) :: ds
I2 = -I1 :: ds
I0 = 0.0 < 0 :: ds
Ia, Ib, Ic = phase(I0, I1, I2) :: ds
#
# LG voltages at relay bus
Vs1 = Vf - Zs * I1 :: ds
Vs2 = -Zs * I2 :: ds
Vs0 = 0.0 < 0 :: ds
Vag, Vbg, Vcg = phase(Vs0, Vs1, Vs2) :: ds
#
# Relay inputs: Vab / Iab
Vab = Vag - Vbg :: ds
Iab = Ia - Ib :: ds
#
# === Impedance plane ===
#
# Measured impedance
Zrelay = Vab / Iab
# Line impedance endpoint
Zln = Zline
# Fault point on line (dot marker)
Zflt = Zfault :: dot
#
# --- Zone reaches ---
Z1fwd = 0.80 * Zline :: ds
Z1rev = -0.10 * Zline :: ds
Z2fwd = 1.20 * Zline :: ds
Z2rev = -0.15 * Zline :: ds
Z3fwd = 1.50 * Zline :: ds
Z3rev = -0.25 * Zline :: ds
#
# --- Offset mho circles ---
Mho1 = circle(Z1fwd, Z1rev)
Mho2 = circle(Z2fwd, Z2rev)
Mho3 = circle(Z3fwd, Z3rev)
#
# Metrics
Zmag = abs(Zrelay) :: ds
Zang = ang(Zrelay) :: ds
Trip = Zmag / abs(Z1fwd) :: ds`,

  grounddist: `# Ground Distance Relay — A-G Fault
# Adjust fault location (m) and resistance (Rf)
# to see Zrelay move on the impedance plane.
#
# ======= USER INPUTS =======
# Fault location (0 = relay, 1 = remote)
m = 0.50 < 0
# Fault resistance (ohms)
Rf = 0.05 < 0
# Line Impedances (Pos & Zero Seq)
Z1line = 0.02 + j0.18 :: ds
Z0line = 0.06 + j0.54 :: ds
# Source Impedances
Zs1 = 0.0 + j0.05 :: ds
Zs0 = 0.0 + j0.10 :: ds
# Pre-fault voltage
Vf = 1.0 < 0 :: ds
#
# ======= CALCULATIONS =======
# k0 Factor: (Z0 - Z1) / 3Z1
k0 = (Z0line - Z1line) / (3 * Z1line) :: ds
#
# Total Impedance to Fault
Z1f = m * Z1line :: ds
Z0f = m * Z0line :: ds
#
# Sequence Currents (Series connection for SLG)
# I1 = I2 = I0 = Vf / (Zseq_total + 3Rf)
Zdenom = (Zs1 + Z1f) + (Zs1 + Z1f) + (Zs0 + Z0f) + 3 * Rf :: ds
I1 = Vf / Zdenom :: ds
I2 = I1 :: ds
I0 = I1 :: ds
#
# Phase A Current
Ia = I1 + I2 + I0 :: ds
#
# Relay Voltage (Phase A)
# Vag = Vf - Drop_source
Vag = Vf - (I1 * Zs1 + I2 * Zs1 + I0 * Zs0) :: ds
#
# Compensated Current
# Icomp = Ia + 3 * k0 * I0
Icomp = Ia + 3 * k0 * I0 :: ds
#
# Measured Impedance
Zrelay = Vag / Icomp
#
# ======= VISUALIZATION =======
# Line Impedance (Z1)
Zln = Z1line
#
# Actual Fault Impedance (Z1 to fault)
Zfault = Z1f :: dot
#
# Zone Settings (based on Z1line)
Z1reach = 0.80 * Z1line :: ds
Z1rev   = -0.10 * Z1line :: ds
Z2reach = 1.20 * Z1line :: ds
Z2rev   = -0.15 * Z1line :: ds
Z3reach = 1.50 * Z1line :: ds
Z3rev   = -0.25 * Z1line :: ds
#
# Mho Circles
Mho1 = circle(Z1reach, Z1rev)
Mho2 = circle(Z2reach, Z2rev)
Mho3 = circle(Z3reach, Z3rev)
#
# Metrics
Zmag = abs(Zrelay) :: ds
Zang = ang(Zrelay) :: ds
Trip = Zmag / abs(Z1reach) :: ds`
};

// ====================================================
// MULTI-SET PRESETS (each creates multiple linked sets)
// Source: phasor_diagram.html lines 2319–2372
// ====================================================

export const MULTI_PRESETS = {
  motor_field: {
    label: 'Motor Field',
    sets: [
      { title: '3φ Supply', equations: `# Balanced three-phase supply voltages (line-to-ground)
# Standard ABC positive-sequence rotation
Vag = 1.0 < 0
Vbg = 1.0 < -120
Vcg = 1.0 < 120` },
      { title: 'Stator Rotating Field', equations: `# Three stator windings producing a rotating field
# Uses Vag, Vbg, Vcg from Set 1
#
# Three coils are fixed in the stator iron
# at 0, 120, and 240 degrees on the bore.
# Each produces flux along its radial axis
# proportional to its instantaneous current.
# The :: fixed directive keeps these arrows
# locked to their radial axes during animation.
#
# Winding impedance per phase
Rw = 0.10 :: ds
Xw = 0.50 :: ds
Zw = Rw + j * Xw :: ds
#
# Phase currents (hidden - rotate with animation)
Ia = Vag / Zw :: ds
Ib = Vbg / Zw :: ds
Ic = Vcg / Zw :: ds
#
# Winding positions on stator bore (fixed)
d = 0.6 :: ds fixed
posA = d < 0 :: ds fixed
posB = d < 120 :: ds fixed
posC = d < 240 :: ds fixed
#
# Display scale
k = 0.4 :: ds fixed
#
# Field from each winding - fixed to radial axis
# proj(I, axis) extracts the component along that axis
# Positive current = flux inward toward origin
# Negative current = flux outward from origin
Ba = k * proj(Ia, 0) * 1.0 < 180 :: posA fixed
Bb = k * proj(Ib, 120) * 1.0 < 300 :: posB fixed
Bc = k * proj(Ic, 240) * 1.0 < 60 :: posC fixed
#
# Net rotating field at origin = vector sum
Bnet = Ba + Bb + Bc` }
    ]
  }
};
