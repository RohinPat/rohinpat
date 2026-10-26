// Synthetic phone-motion trace generator for the swing lab.
//
// Everything is built from a rigid-body trajectory: an orientation matrix
// R(t) (device -> world, z up) and a world-frame kinematic acceleration a(t).
// The sensor model then produces exactly what a phone would report:
//
//   gyro (body)   = vee( R^T dR/dt )                         + bias + noise
//   accel (body)  = R^T (a + g z)  = specific force, points up at rest
//   linear accel  = R^T a                                    + noise
//   orientation   = ZXY Euler angles of R                    + noise
//
// sampled at ~60 Hz with timing jitter and the odd dropped sample, with
// clipping at the usual accelerometer / gyro full scales.
//
// What this does NOT capture is how a human actually moves: the shapes of the
// velocity profiles below are smooth textbook curves (sin^2 lobes, min-jerk),
// not real swings. See the lab report for the gap.

import type { MotionSample, TouchPoint, Vec3 } from "../../lib/motion/types";

// ---------------------------------------------------------------- random
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const uni = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
export const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
export const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
export const sgn = (r: Rng) => (r() < 0.5 ? -1 : 1);

// ---------------------------------------------------------------- 3x3 maths (row-major)
export type Mat = number[];
const G = 9.80665;
export const mmul = (a: Mat, b: Mat): Mat => {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
};
export const mT = (a: Mat): Mat => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
export const mv = (a: Mat, v: Vec3): Vec3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
  a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
  a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];
export function rotAxis(axis: Vec3, ang: number): Mat {
  const n = Math.hypot(...axis) || 1;
  const [x, y, z] = [axis[0] / n, axis[1] / n, axis[2] / n];
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
export const Rx = (a: number) => rotAxis([1, 0, 0], a);
export const Ry = (a: number) => rotAxis([0, 1, 0], a);
export const Rz = (a: number) => rotAxis([0, 0, 1], a);
/** W3C ZXY pose: Rz(alpha) Rx(beta) Ry(gamma). */
export const pose = (alpha: number, beta: number, gamma: number): Mat => mmul(mmul(Rz(alpha), Rx(beta)), Ry(gamma));
const vcross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vscale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vunit = (a: Vec3): Vec3 => vscale(a, 1 / (Math.hypot(...a) || 1));
const D = Math.PI / 180;

/** Smooth bump on (0,1): sin^2(pi u). */
export const bell = (u: number) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2);
export const smoothstep = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };
/** Minimum-jerk position (0..1) and its second derivative w.r.t. u. */
export const minJerk = (u: number) => { const x = Math.min(1, Math.max(0, u)); return 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5; };
export const minJerkAcc = (u: number) => (u <= 0 || u >= 1 ? 0 : 60 * u - 180 * u * u + 120 * u ** 3);

/** Linear acceleration of a point at radius vector r0 (at theta = 0) swinging about axis n by angle theta(t). */
function rotAccel(n: Vec3, r0: Vec3, th: number, thd: number, thdd: number): Vec3 {
  const r = mv(rotAxis(n, th), r0);
  const nxr = vcross(n, r);
  return vadd(vscale(nxr, thdd), vscale(vcross(n, nxr), thd * thd));
}

// ---------------------------------------------------------------- trajectories and the sensor model
export interface Trajectory {
  duration: number;
  /** Device -> world rotation. */
  R(t: number): Mat;
  /** World-frame kinematic acceleration of the phone, m/s^2 (gravity NOT included). */
  a(t: number): Vec3;
}

export interface SensorOptions {
  rate?: number;
  jitterMs?: number;
  dropRate?: number;
  accNoise?: number;
  accBiasSigma?: number;
  gyroNoise?: number;
  gyroBiasSigma?: number;
  accClip?: number;
  gyroClip?: number;
  hasLinear?: boolean;
  linNoise?: number;
  orientNoiseDeg?: number;
  /** Sensor-bandwidth box average width (s). */
  boxS?: number;
}

export function renderTrace(traj: Trajectory, rng: Rng, opts: SensorOptions = {}): MotionSample[] {
  const o = {
    rate: opts.rate ?? 60,
    jitterMs: opts.jitterMs ?? 1.5,
    dropRate: opts.dropRate ?? 0.003,
    accNoise: opts.accNoise ?? 0.04,
    accBiasSigma: opts.accBiasSigma ?? 0.08,
    gyroNoise: opts.gyroNoise ?? 0.004,
    gyroBiasSigma: opts.gyroBiasSigma ?? 0.012,
    accClip: opts.accClip ?? 78.4,
    gyroClip: opts.gyroClip ?? 34.9,
    hasLinear: opts.hasLinear ?? true,
    linNoise: opts.linNoise ?? 0.08,
    orientNoiseDeg: opts.orientNoiseDeg ?? 0.3,
    boxS: opts.boxS ?? 0.006,
  };
  const accBias: Vec3 = [gauss(rng) * o.accBiasSigma, gauss(rng) * o.accBiasSigma, gauss(rng) * o.accBiasSigma];
  const gyroBias: Vec3 = [gauss(rng) * o.gyroBiasSigma, gauss(rng) * o.gyroBiasSigma, gauss(rng) * o.gyroBiasSigma];
  const accScale = 1 + gauss(rng) * 0.004;
  const h = 5e-4;
  const clip = (x: number, c: number) => Math.max(-c, Math.min(c, x));
  const out: MotionSample[] = [];
  const dt = 1 / o.rate;
  let lastT = -1;
  for (let k = 0; k * dt <= traj.duration; k++) {
    let t = k * dt + (rng() - 0.5) * 2 * (o.jitterMs / 1000);
    if (t <= lastT) t = lastT + 0.002;
    lastT = t;
    if (k > 0 && rng() < o.dropRate) continue;
    // Box-average the ideal signals across the sensor bandwidth.
    const taps = [-o.boxS / 2, 0, o.boxS / 2];
    const w: Vec3 = [0, 0, 0], f: Vec3 = [0, 0, 0], a: Vec3 = [0, 0, 0];
    for (const d of taps) {
      const tt = t + d;
      const Rt = traj.R(tt);
      const dR = mT(Rt);
      const Rp = traj.R(tt + h), Rm = traj.R(tt - h);
      const dRdt = Rp.map((v, i) => (v - Rm[i]) / (2 * h));
      const Om = mmul(dR, dRdt);
      const wb: Vec3 = [Om[7], Om[2], Om[3]];
      const aw = traj.a(tt);
      const fb = mv(dR, [aw[0], aw[1], aw[2] + G]);
      const lb = mv(dR, aw);
      for (let i = 0; i < 3; i++) { w[i] += wb[i] / 3; f[i] += fb[i] / 3; a[i] += lb[i] / 3; }
    }
    const Rt = traj.R(t);
    const s: MotionSample = {
      t,
      acc: [0, 1, 2].map((i) => clip(f[i] * accScale + accBias[i] + gauss(rng) * o.accNoise, o.accClip)) as Vec3,
      gyro: [0, 1, 2].map((i) => clip(w[i] + gyroBias[i] + gauss(rng) * o.gyroNoise, o.gyroClip)) as Vec3,
    };
    if (o.hasLinear) s.lin = [0, 1, 2].map((i) => clip(a[i] + gauss(rng) * o.linNoise, o.accClip)) as Vec3;
    const beta = Math.asin(Math.max(-1, Math.min(1, Rt[7]))) / D;
    s.orient = {
      alpha: ((Math.atan2(-Rt[1], Rt[4]) / D + gauss(rng) * o.orientNoiseDeg) + 360) % 360,
      beta: beta + gauss(rng) * o.orientNoiseDeg,
      gamma: Math.atan2(-Rt[6], Rt[8]) / D + gauss(rng) * o.orientNoiseDeg,
    };
    out.push(s);
  }
  return out;
}

/** Hand tremor: ~0.05 deg at 7-12 Hz (~0.05 rad/s per axis rms) plus ~0.3 m/s^2 of hand shake. An assumption, not a measurement. */
function tremor(rng: Rng, scale = 1) {
  const comp = () => ({ f: uni(rng, 7, 12), p: uni(rng, 0, 6.28), A: uni(rng, 0.0005, 0.0012) * scale });
  const ang = [0, 1, 2].map(() => [comp(), comp()]);
  const lin = [0, 1, 2].map(() => ({ f: uni(rng, 6, 11), p: uni(rng, 0, 6.28), A: uni(rng, 0.0001, 0.00025) * scale }));
  return {
    R(t: number): Mat {
      const v: Vec3 = [0, 1, 2].map((i) => ang[i].reduce((s, c) => s + c.A * Math.sin(2 * Math.PI * c.f * t + c.p), 0)) as Vec3;
      const n = Math.hypot(...v);
      return n < 1e-12 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : rotAxis(v, n);
    },
    a(t: number): Vec3 {
      return [0, 1, 2].map((i) => -((2 * Math.PI * lin[i].f) ** 2) * lin[i].A * Math.sin(2 * Math.PI * lin[i].f * t + lin[i].p)) as Vec3;
    },
  };
}

/** Wrap a trajectory with hand tremor in the phone frame (only while `held(t)`). */
function withTremor(base: Trajectory, rng: Rng, scale: number, held: (t: number) => boolean = () => true): Trajectory {
  const tr = tremor(rng, scale);
  return {
    duration: base.duration,
    R: (t) => (held(t) ? mmul(base.R(t), tr.R(t)) : base.R(t)),
    a: (t) => {
      const a = base.a(t);
      if (!held(t)) return a;
      const x = tr.a(t);
      return [a[0] + x[0], a[1] + x[1], a[2] + x[2]];
    },
  };
}

export interface Rendered<T> {
  samples: MotionSample[];
  truth: T;
}

// ---------------------------------------------------------------- GOLF
export interface GolfParams {
  /** Peak angular speed at impact, rad/s. */
  Wp: number;
  /** Backswing angle, rad. */
  thetaB: number;
  /** Designed backswing/downswing duration ratio (before pauses). */
  ratio: number;
  /** Pause at the top, s. */
  pause: number;
  /** Plane angle at impact relative to address, rad (hands ahead/behind). */
  thetaImpact: number;
  /** Face angle at impact relative to address, rad (truth). */
  face: number;
  /** Forearm release roll amplitude, rad (rolls through impact). */
  release: number;
  followS: number;
  addressS: number;
  finishS: number;
  /** Pre-swing waggle amplitude (rad) and frequency. 0 = none. */
  waggle: number;
  waggleHz: number;
  alpha0: number;
  beta0: number;
  gamma0: number;
  /** Shaft-axis component of the swing-plane normal. */
  planeTilt: number;
  lefty: boolean;
  handRadius: number;
  /** Hand tremor multiplier (1 = nominal). */
  tremor: number;
  /** Velocity profile family: smooth sin^2 lobes (default) or sharp-cornered triangles (a model-mismatch stress test). */
  profile: "smooth" | "triangle";
}

export function randomGolfParams(rng: Rng): GolfParams {
  return {
    Wp: uni(rng, 9, 30),
    thetaB: uni(rng, 2.2, 3.4),
    ratio: uni(rng, 2, 4.2),
    pause: uni(rng, 0.03, 0.12),
    thetaImpact: uni(rng, -0.12, 0.12),
    face: uni(rng, -14, 14) * D,
    release: uni(rng, 0.2, 0.45) * sgn(rng),
    followS: uni(rng, 0.3, 0.55),
    addressS: uni(rng, 0.9, 1.6),
    finishS: uni(rng, 0.9, 1.4),
    waggle: 0,
    waggleHz: uni(rng, 0.8, 1.6),
    alpha0: uni(rng, 0, 6.28),
    beta0: uni(rng, -75, -35) * D,
    gamma0: uni(rng, -20, 20) * D,
    planeTilt: uni(rng, -0.2, 0.2),
    lefty: rng() < 0.15,
    handRadius: uni(rng, 0.55, 0.8),
    tremor: 1,
    profile: "smooth",
  };
}

export interface GolfTruth {
  tImpact: number;
  peakRate: number;
  /** (backswing + half pause) / (downswing + half pause), the quantity the detector estimates. */
  tempo: number;
  backswingS: number;
  downswingS: number;
  faceDeg: number;
}

export function golfTrajectory(p: GolfParams, rng: Rng): { traj: Trajectory; truth: GolfTruth } {
  const Td = (2 * (p.thetaB + p.thetaImpact)) / p.Wp;
  let Tb = p.ratio * Td;
  if (Tb > 2.4) Tb = 2.4;
  const Wb = (2 * p.thetaB) / Tb;
  const t0 = p.addressS;
  const tTop = t0 + Tb;
  const tDown = tTop + p.pause;
  const tImp = tDown + Td;
  const tFollowEnd = tImp + p.followS;
  const duration = tFollowEnd + p.finishS;
  const R0 = pose(p.alpha0, p.beta0, p.gamma0);
  const shaftW = mv(R0, [0, 1, 0]);
  const targetLine = vunit([Math.cos(p.alpha0 + 1.1), Math.sin(p.alpha0 + 1.1), 0]);
  let n = vunit(vcross(shaftW, targetLine));
  n = vunit(vadd(n, vscale(shaftW, p.planeTilt)));
  if (p.lefty) n = vscale(n, -1);
  const r0 = vscale(shaftW, p.handRadius);

  // Rate and angle of the swing about the plane normal.
  const tri = p.profile === "triangle";
  const rate = (t: number): number => {
    if (t < t0) return 0;
    if (t < tTop) {
      const u = (t - t0) / Tb;
      return tri ? -Wb * (1 - Math.abs(2 * u - 1)) : -Wb * Math.sin(Math.PI * u) ** 2;
    }
    if (t < tDown) return 0;
    if (t < tImp) {
      const u = (t - tDown) / Td;
      return tri ? p.Wp * u : p.Wp * Math.sin((Math.PI * u) / 2) ** 2;
    }
    if (t < tFollowEnd) {
      const u = (t - tImp) / p.followS;
      return tri ? p.Wp * (1 - u) : p.Wp * Math.cos((Math.PI * u) / 2) ** 2;
    }
    return 0;
  };
  const angle = (t: number): number => {
    let th = 0;
    if (t > t0) {
      const u = Math.min(1, (t - t0) / Tb);
      th -= tri
        ? Wb * Tb * (u <= 0.5 ? u * u : 0.5 - (1 - u) * (1 - u))
        : Wb * Tb * (u / 2 - Math.sin(2 * Math.PI * u) / (4 * Math.PI));
    }
    if (t > tDown) {
      const u = Math.min(1, (t - tDown) / Td);
      th += tri ? (p.Wp * Td * u * u) / 2 : p.Wp * Td * (u / 2 - Math.sin(Math.PI * u) / (2 * Math.PI));
    }
    if (t > tImp) {
      const u = Math.min(1, (t - tImp) / p.followS);
      th += tri ? p.Wp * p.followS * (u - (u * u) / 2) : p.Wp * p.followS * (u / 2 + Math.sin(Math.PI * u) / (2 * Math.PI));
    }
    // waggle
    if (p.waggle > 0) {
      const ws = 0.15, we = t0 - 0.45;
      if (t > ws && t < we) th += p.waggle * Math.sin(2 * Math.PI * p.waggleHz * (t - ws)) * bell((t - ws) / (we - ws));
    }
    return th;
  };
  const rateW = (t: number): number => {
    let r = rate(t);
    if (p.waggle > 0) {
      const h = 1e-4;
      const ws = 0.15, we = t0 - 0.45;
      if (t > ws && t < we) {
        const f = (x: number) => p.waggle * Math.sin(2 * Math.PI * p.waggleHz * (x - ws)) * bell((x - ws) / (we - ws));
        r += (f(t + h) - f(t - h)) / (2 * h);
      }
    }
    return r;
  };
  const tau = 0.07;
  const phi = (t: number): number => {
    const ramp = smoothstep((t - t0) / (tImp - t0));
    const x = (t - tImp) / tau;
    return p.face * ramp + p.release * x * Math.exp(-0.5 * x * x);
  };
  const base: Trajectory = {
    duration,
    R: (t) => mmul(mmul(rotAxis(n, angle(t)), R0), Ry(phi(t))),
    a: (t) => {
      const h = 1e-3;
      const thdd = (rateW(t + h) - rateW(t - h)) / (2 * h);
      return rotAccel(n, r0, angle(t), rateW(t), thdd);
    },
  };
  // Truth peak rate: scan the true body rate near impact.
  let peak = 0;
  for (let t = tImp - 0.1; t <= tImp + 0.1; t += 0.001) {
    const Rp = base.R(t + 5e-4), Rm = base.R(t - 5e-4);
    const dR = Rp.map((v, i) => (v - Rm[i]) / 1e-3);
    const Om = mmul(mT(base.R(t)), dR);
    peak = Math.max(peak, Math.hypot(Om[7], Om[2], Om[3]));
  }
  const traj = withTremor(base, rng, p.tremor);
  return {
    traj,
    truth: {
      tImpact: tImp,
      peakRate: peak,
      tempo: (Tb + p.pause / 2) / (Td + p.pause / 2),
      backswingS: Tb + p.pause / 2,
      downswingS: Td + p.pause / 2,
      faceDeg: p.face / D,
    },
  };
}

export function genGolf(seed: number, over: Partial<GolfParams> = {}, sensor: SensorOptions = {}): Rendered<GolfTruth & { params: GolfParams }> {
  const rng = mulberry32(seed);
  const params = { ...randomGolfParams(rng), ...over };
  const { traj, truth } = golfTrajectory(params, rng);
  return { samples: renderTrace(traj, rng, sensor), truth: { ...truth, params } };
}

// ---------------------------------------------------------------- FLICK
export interface FlickParams {
  /** Peak thrust acceleration, m/s^2. */
  A: number;
  /** Rise time, s. */
  w: number;
  /** tan(lateral launch angle). */
  lateralTan: number;
  /** Forward component relative to up. */
  fwd: number;
  /** Wrist pitch during the flick, rad (top edge tilts away). */
  wristPitch: number;
  /** Wrist yaw during the flick, rad. */
  wristYaw: number;
  alpha0: number;
  beta0: number;
  gamma0: number;
  startS: number;
}

export function randomFlickParams(rng: Rng): FlickParams {
  const lateralAngle = uni(rng, -25, 25) * D;
  return {
    A: uni(rng, 11, 40),
    w: uni(rng, 0.07, 0.16),
    lateralTan: Math.tan(lateralAngle),
    fwd: uni(rng, 0, 0.5),
    wristPitch: uni(rng, 5, 35) * D,
    // ASSUMPTION (unverified on real wrists): aiming right is accompanied by turning the phone a little right.
    wristYaw: -0.5 * lateralAngle + gauss(rng) * 5 * D,
    alpha0: uni(rng, 0, 6.28),
    beta0: uni(rng, 65, 88) * D,
    gamma0: uni(rng, -10, 10) * D,
    startS: uni(rng, 0.9, 1.6),
  };
}

export interface FlickTruth {
  tPeak: number;
  peak: number;
  /** Vertical impulse of the positive lobe, m/s. */
  impulse: number;
  /** Lateral launch angle, degrees, + = right. */
  aimDeg: number;
  wristYawDeg: number;
}

export function flickTrajectory(p: FlickParams, rng: Rng): { traj: Trajectory; truth: FlickTruth } {
  const w2 = 1.4 * p.w;
  const B = (p.A * p.w) / w2;
  const t0 = p.startS;
  const dur = t0 + p.w + w2 + 1.2;
  const R0 = pose(p.alpha0, p.beta0, p.gamma0);
  const xh = mv(R0, [1, 0, 0]);
  const zh = mv(R0, [0, 0, 1]);
  const rHat = vunit([xh[0], xh[1], 0]);
  const fHat = vunit([-zh[0], -zh[1], 0]);
  const d: Vec3 = vadd(vadd([0, 0, 1], vscale(rHat, p.lateralTan)), vscale(fHat, p.fwd));
  const prof = (t: number) => {
    if (t < t0 || t > t0 + p.w + w2) return 0;
    if (t < t0 + p.w) return p.A * Math.sin((Math.PI * (t - t0)) / p.w);
    return -B * Math.sin((Math.PI * (t - t0 - p.w)) / w2);
  };
  const span = p.w + w2;
  const base: Trajectory = {
    duration: dur,
    R: (t) => {
      const u = (t - t0) / span;
      const b = bell(u);
      return pose(p.alpha0 + p.wristYaw * b, p.beta0 - p.wristPitch * b, p.gamma0);
    },
    a: (t) => vscale(d, prof(t)),
  };
  // Impulse of the positive lobe (vertical component only): d_z = 1.
  const impulse = (2 * p.A * p.w) / Math.PI;
  return {
    traj: withTremor(base, rng, 1),
    truth: { tPeak: t0 + p.w / 2, peak: p.A, impulse, aimDeg: Math.atan(p.lateralTan) / D, wristYawDeg: p.wristYaw / D },
  };
}

export function genFlick(seed: number, over: Partial<FlickParams> = {}, sensor: SensorOptions = {}): Rendered<FlickTruth & { params: FlickParams }> {
  const rng = mulberry32(seed);
  const params = { ...randomFlickParams(rng), ...over };
  const { traj, truth } = flickTrajectory(params, rng);
  return { samples: renderTrace(traj, rng, sensor), truth: { ...truth, params } };
}

// ---------------------------------------------------------------- TWIST
export interface TwistTruth {
  /** Net rotation about the screen axis, radians, + = counter-clockwise seen by the player. */
  totalAngle: number;
  strokes: { t0: number; T: number; d: number }[];
}

export function genTwist(seed: number, opts: { strokes?: number; bias?: number } = {}, sensor: SensorOptions = {}): Rendered<TwistTruth> {
  const rng = mulberry32(seed);
  const n = opts.strokes ?? Math.floor(uni(rng, 3, 7));
  const strokes: { t0: number; T: number; d: number }[] = [];
  let t = uni(rng, 0.9, 1.4);
  for (let i = 0; i < n; i++) {
    const T = uni(rng, 0.5, 1.6);
    const mag = Math.max(uni(rng, 0.8, 4.5), 0.65 * T);
    strokes.push({ t0: t, T, d: mag * sgn(rng) });
    t += T + uni(rng, 0.2, 0.8);
  }
  const dur = t + 1;
  const R0 = pose(uni(rng, 0, 6.28), uni(rng, 60, 88) * D, uni(rng, -10, 10) * D);
  const wob = [0, 1].map(() => ({ f1: uni(rng, 0.5, 1.0), f2: uni(rng, 1.1, 1.8), p: uni(rng, 0, 6.28), A: uni(rng, 0.02, 0.06) }));
  const psi = (tt: number) => strokes.reduce((s, k) => s + k.d * minJerk((tt - k.t0) / k.T), 0);
  const base: Trajectory = {
    duration: dur,
    R: (tt) => mmul(mmul(mmul(R0, Rx(wob[0].A * Math.sin(2 * Math.PI * wob[0].f1 * tt + wob[0].p) + 0.5 * wob[0].A * Math.sin(2 * Math.PI * wob[0].f2 * tt))), Ry(wob[1].A * Math.sin(2 * Math.PI * wob[1].f1 * tt + wob[1].p))), Rz(psi(tt))),
    a: () => [0, 0, 0],
  };
  const sensorOpts = { ...sensor };
  if (opts.bias !== undefined) sensorOpts.gyroBiasSigma = 0;
  const samples = renderTrace(withTremor(base, rng, 1), rng, sensorOpts);
  if (opts.bias !== undefined) for (const s of samples) s.gyro = [s.gyro[0], s.gyro[1], s.gyro[2] + opts.bias];
  return { samples, truth: { totalAngle: strokes.reduce((s, k) => s + k.d, 0), strokes } };
}

/** Phone held perfectly still (on a hand or a table) for `seconds`, with the given z-gyro bias. */
export function genStill(seed: number, seconds: number, opts: { bias?: number; held?: boolean; tremor?: number } = {}, sensor: SensorOptions = {}): MotionSample[] {
  const rng = mulberry32(seed);
  const R0 = pose(uni(rng, 0, 6.28), uni(rng, 20, 70) * D, uni(rng, -8, 8) * D);
  const base: Trajectory = { duration: seconds, R: () => R0, a: () => [0, 0, 0] };
  const held = opts.held ?? true;
  const samples = renderTrace(held ? withTremor(base, rng, opts.tremor ?? 1) : base, rng, { ...sensor, gyroBiasSigma: opts.bias !== undefined ? 0 : sensor.gyroBiasSigma });
  if (opts.bias !== undefined) for (const s of samples) s.gyro = [s.gyro[0] + opts.bias * 0.5, s.gyro[1] - opts.bias * 0.7, s.gyro[2] + opts.bias];
  return samples;
}

// ---------------------------------------------------------------- TILT
export interface TiltTruth {
  /** Lean target (deg, + = right edge down) at each sample time. */
  leanDeg: (t: number) => number;
  tuck: (t: number) => number;
  /** Neutral values the recogniser should lock onto. */
  neutralLean: number;
  neutralPitch: number;
  steps: { t0: number; T: number; to: number }[];
}

export function genTilt(seed: number, opts: { walking?: boolean; steps?: number; tuckSteps?: boolean } = {}, sensor: SensorOptions = {}): Rendered<TiltTruth> {
  const rng = mulberry32(seed);
  const beta0 = uni(rng, 30, 65);
  const gamma0 = uni(rng, -4, 4);
  const alpha0 = uni(rng, 0, 6.28);
  const steps: { t0: number; T: number; to: number }[] = [];
  let t = 1.4;
  const nSteps = opts.steps ?? 6;
  for (let i = 0; i < nSteps; i++) {
    const to = gamma0 + sgn(rng) * uni(rng, 6, 34);
    const T = uni(rng, 0.2, 0.5);
    steps.push({ t0: t, T, to });
    t += T + uni(rng, 0.6, 1.2);
    // return to centre sometimes
    if (rng() < 0.4) { steps.push({ t0: t, T: uni(rng, 0.2, 0.5), to: gamma0 }); t += 1.2; }
  }
  const dur = t + 1;
  const lean = (tt: number) => {
    // Cosine blends from the previous target to the next one.
    let prev = gamma0;
    let val = gamma0;
    for (const s of steps) {
      if (tt < s.t0) break;
      const u = Math.min(1, (tt - s.t0) / s.T);
      val = prev + (s.to - prev) * 0.5 * (1 - Math.cos(Math.PI * u));
      prev = s.to;
    }
    return val;
  };
  const tuckSteps = opts.tuckSteps ? [{ t0: 2.2, T: 0.5, to: uni(rng, 12, 35) }, { t0: 4.6, T: 0.5, to: 0 }] : [];
  const tuck = (tt: number) => {
    let prev = 0, val = 0;
    for (const s of tuckSteps) {
      if (tt < s.t0) break;
      const u = Math.min(1, (tt - s.t0) / s.T);
      val = prev + (s.to - prev) * 0.5 * (1 - Math.cos(Math.PI * u));
      prev = s.to;
    }
    return val;
  };
  const walk = opts.walking
    ? { f: uni(rng, 1.7, 2.1), p: uni(rng, 0, 6.28), rot: uni(rng, 0.02, 0.04), az: uni(rng, 2, 4), ay: uni(rng, 0.8, 1.6), jit: [0, 1, 2].map(() => ({ f: uni(rng, 0.7, 1.4), p: uni(rng, 0, 6.28) })) }
    : null;
  const base: Trajectory = {
    duration: dur,
    R: (tt) => {
      let R = pose(alpha0, (beta0 - tuck(tt)) * D, lean(tt) * D);
      if (walk) {
        const w = 2 * Math.PI * walk.f * tt + walk.p;
        R = mmul(R, Ry(walk.rot * Math.sin(w)));
        R = mmul(R, Rx(walk.rot * 0.8 * Math.sin(w + 1)));
        R = mmul(R, Rz(walk.rot * 0.6 * Math.sin(2 * Math.PI * walk.jit[2].f * tt + walk.jit[2].p)));
      }
      return R;
    },
    a: (tt) => {
      if (!walk) return [0, 0, 0];
      const w = 2 * Math.PI * walk.f * tt + walk.p;
      return [walk.ay * 0.5 * Math.sin(w / 2), walk.ay * Math.sin(w / 2 + 0.7), walk.az * Math.sin(w)];
    },
  };
  const samples = renderTrace(withTremor(base, rng, 1), rng, sensor);
  return { samples, truth: { leanDeg: lean, tuck, neutralLean: gamma0, neutralPitch: beta0, steps } };
}

// ---------------------------------------------------------------- CONFOUNDERS
export type ConfounderKind = "walk-swing" | "walk-texting" | "pocket" | "table-bump" | "slow-pickup" | "put-down" | "shake" | "shake-vertical";

export const CONFOUNDERS: ConfounderKind[] = ["walk-swing", "walk-texting", "pocket", "table-bump", "slow-pickup", "put-down", "shake", "shake-vertical"];

export function genConfounder(kind: ConfounderKind, seed: number, sensor: SensorOptions = {}): MotionSample[] {
  const rng = mulberry32(seed);
  const alpha0 = uni(rng, 0, 6.28);
  const heading: Vec3 = [Math.cos(alpha0), Math.sin(alpha0), 0];
  const side: Vec3 = [-Math.sin(alpha0), Math.cos(alpha0), 0];
  let traj: Trajectory;

  const walkAccel = (t: number, ts: number, f: number, p: number, az: number, ax: number, ay: number): Vec3 => {
    if (t < ts) return [0, 0, 0];
    const w = 2 * Math.PI * f * (t - ts) + p;
    const fwd = vscale(heading, ax * Math.sin(2 * w + 0.5));
    const lat = vscale(side, ay * Math.sin(w + 1.1));
    return vadd(vadd(fwd, lat), [0, 0, az * Math.sin(2 * w)]);
  };

  if (kind === "walk-swing" || kind === "walk-texting") {
    const ts = uni(rng, 0.8, 1.4);
    const f = uni(rng, 0.85, 1.1);
    const swing = kind === "walk-swing" ? uni(rng, 0.2, 0.5) : 0.03;
    const beta0 = kind === "walk-swing" ? uni(rng, -20, 20) * D : uni(rng, 35, 60) * D;
    const R0 = pose(alpha0, beta0, uni(rng, -8, 8) * D);
    const p = uni(rng, 0, 6.28);
    const az = uni(rng, 2, 5), ax = uni(rng, 1, 2.5), ay = uni(rng, 0.6, 1.6);
    const armAxis = side;
    const r0: Vec3 = [0, 0, -0.62];
    const dur = ts + uni(rng, 4, 6);
    const th = (t: number) => (t < ts ? 0 : swing * Math.sin(2 * Math.PI * f * (t - ts)) * Math.min(1, (t - ts) / 0.8));
    const thd = (t: number) => (t < ts ? 0 : (th(t + 1e-3) - th(t - 1e-3)) / 2e-3);
    traj = {
      duration: dur,
      R: (t) => mmul(rotAxis(armAxis, th(t)), R0),
      a: (t) => {
        const w = walkAccel(t, ts, f, p, az, ax, ay);
        if (kind === "walk-texting") return w;
        const thdd = (thd(t + 1e-3) - thd(t - 1e-3)) / 2e-3;
        const arm = rotAccel(armAxis, r0, th(t), thd(t), thdd);
        return vadd(w, arm);
      },
    };
    traj = withTremor(traj, rng, 1.5);
  } else if (kind === "pocket") {
    const ts = uni(rng, 0.8, 1.4);
    const f = uni(rng, 0.85, 1.05);
    const amp = uni(rng, 0.3, 0.5);
    const R0 = pose(alpha0, uni(rng, -100, -80) * D, uni(rng, -15, 15) * D);
    const r0: Vec3 = [0, 0, -0.22];
    const p = uni(rng, 0, 6.28);
    const heelAmp = uni(rng, 7, 14);
    const dur = ts + uni(rng, 4, 6);
    const th = (t: number) => (t < ts ? 0 : amp * Math.sin(2 * Math.PI * f * (t - ts)) * Math.min(1, (t - ts) / 0.8));
    const thd = (t: number) => (th(t + 1e-3) - th(t - 1e-3)) / 2e-3;
    const heel = (t: number) => {
      if (t < ts + 0.3) return 0;
      const period = 1 / (2 * f);
      const ph = ((t - ts - 0.3) % period) / 0.055;
      return ph < 1 ? heelAmp * Math.sin(Math.PI * ph) : 0;
    };
    traj = {
      duration: dur,
      R: (t) => mmul(rotAxis(side, th(t)), R0),
      a: (t) => {
        const w = walkAccel(t, ts, f, p, 3, 2.2, 1.2);
        const thdd = (thd(t + 1e-3) - thd(t - 1e-3)) / 2e-3;
        return vadd(vadd(w, rotAccel(side, r0, th(t), thd(t), thdd)), [0, 0, heel(t)]);
      },
    };
  } else if (kind === "table-bump") {
    const R0 = pose(alpha0, 0, 0);
    const n = 1 + Math.floor(rng() * 3);
    const bumps = Array.from({ length: n }, (_, i) => ({ t: 1 + i * uni(rng, 0.5, 1.2), A: uni(rng, 12, 60), f: uni(rng, 30, 55), lat: uni(rng, -0.4, 0.4) }));
    const ring = (t: number, b: (typeof bumps)[number]) => (t < b.t ? 0 : Math.exp(-(t - b.t) / 0.012) * Math.sin(2 * Math.PI * b.f * (t - b.t)));
    traj = {
      duration: bumps[n - 1].t + 1.2,
      R: (t) => {
        let wob = 0;
        for (const b of bumps) wob += t < b.t ? 0 : 0.004 * Math.exp(-(t - b.t) / 0.06) * Math.sin(2 * Math.PI * 18 * (t - b.t)) * (b.A / 30);
        return mmul(R0, mmul(Rx(wob), Ry(wob * 0.7)));
      },
      a: (t) => {
        let az = 0, ax = 0;
        for (const b of bumps) { const r = b.A * ring(t, b); az += r; ax += r * b.lat; }
        return [ax, 0, az];
      },
    };
  } else if (kind === "slow-pickup") {
    const T = uni(rng, 0.9, 1.8);
    const t0 = uni(rng, 0.8, 1.4);
    const beta1 = uni(rng, 45, 85) * D;
    const yaw1 = uni(rng, -0.4, 0.4);
    const h = uni(rng, 0.12, 0.25);
    const dur = t0 + T + 1.6;
    const base: Trajectory = {
      duration: dur,
      R: (t) => { const u = minJerk((t - t0) / T); return pose(alpha0 + yaw1 * u, beta1 * u, 0); },
      a: (t) => [0, 0, (h * minJerkAcc((t - t0) / T)) / (T * T)],
    };
    traj = withTremor(base, rng, 1, (t) => t > t0 + 0.3 * T);
  } else if (kind === "put-down") {
    const beta0 = uni(rng, 45, 85) * D;
    const t0 = uni(rng, 0.9, 1.5);
    const T = uni(rng, 0.45, 0.9);
    const h = uni(rng, 0.2, 0.35);
    const bumpA = uni(rng, 6, 20);
    const dur = t0 + T + 1.3;
    const base: Trajectory = {
      duration: dur,
      R: (t) => { const u = minJerk((t - t0) / T); return pose(alpha0, beta0 * (1 - u), 0); },
      a: (t) => {
        const down = -(h * minJerkAcc((t - t0) / T)) / (T * T);
        const tb = t0 + T;
        const bump = t < tb ? 0 : bumpA * Math.exp(-(t - tb) / 0.01) * Math.sin(2 * Math.PI * 40 * (t - tb));
        return [0, 0, down + bump];
      },
    };
    traj = withTremor(base, rng, 1, (t) => t < t0 + T);
  } else {
    // shake / shake-vertical: a short burst of vigorous oscillation.
    const t0 = uni(rng, 0.8, 1.4);
    const D_ = uni(rng, 0.8, 2.0);
    const f = uni(rng, 2.5, 5.5);
    const angAmp = uni(rng, 0.25, 0.8);
    const linAmp = uni(rng, 0.02, 0.09);
    const axisA: Vec3 = vunit([gauss(rng), gauss(rng), gauss(rng)]);
    const axisL: Vec3 = kind === "shake-vertical" ? [0, 0, 1] : vunit([gauss(rng), gauss(rng), gauss(rng)]);
    const R0 = pose(alpha0, uni(rng, -30, 80) * D, uni(rng, -15, 15) * D);
    const env = (t: number) => Math.min(1, Math.max(0, Math.min((t - t0) / 0.15, (t0 + D_ - t) / 0.15)));
    const ph = (t: number) => 2 * Math.PI * f * (t - t0);
    const base: Trajectory = {
      duration: t0 + D_ + 1.2,
      R: (t) => mmul(rotAxis(axisA, angAmp * env(t) * Math.sin(ph(t))), R0),
      a: (t) => vscale(axisL, -((2 * Math.PI * f) ** 2) * linAmp * env(t) * Math.sin(ph(t))),
    };
    traj = withTremor(base, rng, 1, (t) => t < t0 || t > t0 + D_);
  }
  return renderTrace(traj, rng, sensor);
}

// ---------------------------------------------------------------- SWIPE
export interface SwipeParams {
  startX: number;
  startY: number;
  /** Chord heading, radians, 0 = up, + = clockwise. */
  direction: number;
  /** Chord length, px. */
  length: number;
  /** Total turning of the path, radians, + = clockwise. */
  turn: number;
  durationS: number;
  /** Speed profile exponent: path fraction = u^accel (1 = constant speed, >1 = accelerating flick). */
  accel: number;
  noisePx: number;
  /** Touch event rate, Hz. */
  rate: number;
}

export interface SwipeTruth {
  direction: number;
  turn: number;
  peakSpeed: number;
  length: number;
  params: SwipeParams;
}

export function randomSwipeParams(rng: Rng): SwipeParams {
  return {
    startX: uni(rng, 100, 280),
    startY: uni(rng, 500, 700),
    direction: uni(rng, -0.6, 0.6),
    length: uni(rng, 160, 480),
    turn: uni(rng, -1.2, 1.2),
    durationS: uni(rng, 0.09, 0.45),
    accel: uni(rng, 1, 1.8),
    noisePx: 0.5,
    rate: pick(rng, [60, 60, 90, 120]),
  };
}

export function genSwipe(seed: number, over: Partial<SwipeParams> = {}): { points: TouchPoint[]; truth: SwipeTruth } {
  const rng = mulberry32(seed);
  const p = { ...randomSwipeParams(rng), ...over };
  const Th = p.turn;
  const arc = Math.abs(Th) < 1e-6 ? p.length : (p.length * (Th / 2)) / Math.sin(Th / 2);
  const h0 = p.direction - Th / 2;
  // Position along the arc by integrating heading = h0 + Th * s/arc.
  const posAt = (s: number): [number, number] => {
    const N = 80;
    let x = 0, y = 0;
    const ds = s / N;
    for (let i = 0; i < N; i++) {
      const hh = h0 + (Th * (i + 0.5) * ds) / arc;
      x += Math.sin(hh) * ds;
      y += -Math.cos(hh) * ds;
    }
    return [x, y];
  };
  const pts: TouchPoint[] = [];
  const dt = 1 / p.rate;
  // finger dwell on touch-down
  const t0 = uni(rng, 0.02, 0.06);
  for (let i = 0; i < 3; i++) pts.push({ t: i * dt, x: p.startX + gauss(rng) * p.noisePx, y: p.startY + gauss(rng) * p.noisePx });
  const tMove = pts[pts.length - 1].t + dt + t0 * 0;
  const n = Math.max(3, Math.round(p.durationS / dt));
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    const s = arc * Math.pow(u, p.accel);
    const [x, y] = posAt(s);
    pts.push({ t: tMove + (k * p.durationS) / n + (rng() - 0.5) * 0.002, x: p.startX + x + gauss(rng) * p.noisePx, y: p.startY + y + gauss(rng) * p.noisePx });
  }
  // true peak speed (px/s) of the finger along the path
  const dsdu = (u: number) => arc * p.accel * Math.pow(u, p.accel - 1);
  const peakSpeed = dsdu(1) / p.durationS;
  const truth: SwipeTruth = { direction: p.direction, turn: Th, peakSpeed, length: p.length, params: p };
  return { points: pts, truth };
}

export type SwipeConfounder = "tap" | "slow-drag" | "long-press-jitter" | "micro-swipe";

export function genSwipeConfounder(kind: SwipeConfounder, seed: number): TouchPoint[] {
  const rng = mulberry32(seed);
  const x0 = uni(rng, 100, 280), y0 = uni(rng, 300, 700);
  const pts: TouchPoint[] = [];
  const rate = 60;
  if (kind === "tap") {
    const n = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) pts.push({ t: i / rate, x: x0 + gauss(rng) * 0.8, y: y0 + gauss(rng) * 0.8 });
  } else if (kind === "slow-drag") {
    const L = uni(rng, 150, 400), T = uni(rng, 1.4, 3);
    const a = uni(rng, 0, 6.28);
    const n = Math.round(T * rate);
    for (let i = 0; i <= n; i++) pts.push({ t: i / rate, x: x0 + Math.cos(a) * L * (i / n) + gauss(rng) * 0.5, y: y0 + Math.sin(a) * L * (i / n) + gauss(rng) * 0.5 });
  } else if (kind === "long-press-jitter") {
    const n = Math.round(uni(rng, 0.6, 1.5) * rate);
    for (let i = 0; i < n; i++) pts.push({ t: i / rate, x: x0 + gauss(rng) * 1.5, y: y0 + gauss(rng) * 1.5 });
  } else {
    const L = uni(rng, 10, 30), a = uni(rng, 0, 6.28), T = uni(rng, 0.05, 0.12);
    const n = Math.max(4, Math.round(T * rate));
    for (let i = 0; i <= n; i++) pts.push({ t: i / rate, x: x0 + Math.cos(a) * L * (i / n) + gauss(rng) * 0.4, y: y0 + Math.sin(a) * L * (i / n) + gauss(rng) * 0.4 });
  }
  return pts;
}
