// One-euro filter (Casiez, Roussel and Vogel, 2012): a low-pass filter whose
// cutoff rises with speed, so it is smooth when you hold still and quick when
// you move.
import { Quat, Vec3, qConj, qExp, qIdentity, qLog, qMul, qNormalize, qSameHemisphere } from "./quat";

/** Smoothing factor for a first-order low-pass with cutoff fc (Hz) at step dt (s). */
export const alphaFor = (fc: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * fc);
  return 1 / (1 + tau / dt);
};

export interface OneEuroParams {
  /** Hz: cutoff at rest. Lower = smoother and laggier when slow. */
  minCutoff: number;
  /** Hz per (unit/s): how fast the cutoff opens with speed. */
  beta: number;
  /** Hz: cutoff of the speed estimate itself. */
  dCutoff: number;
}

export class OneEuro {
  private x: number | null = null;
  private xRaw = 0;
  private dx = 0;
  private t = 0;
  constructor(public params: OneEuroParams) {}
  reset(): void {
    this.x = null;
  }
  /** t in seconds. */
  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.xRaw = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    const rawVel = (value - this.xRaw) / dt;
    this.dx += alphaFor(this.params.dCutoff, dt) * (rawVel - this.dx);
    const fc = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += alphaFor(fc, dt) * (value - this.x);
    this.xRaw = value;
    this.t = t;
    return this.x;
  }
}

/**
 * The same filter on rotations. "Speed" is angular speed in rad/s; the smoothing
 * step is a slerp along the shortest arc, so it never flips and has no gimbal
 * lock. Also keeps a smoothed angular velocity (body frame) for prediction.
 */
export class QuatOneEuro {
  private fq: Quat | null = null;
  private raw: Quat = qIdentity();
  private t = 0;
  /** smoothed angular velocity, rad/s, in the body frame */
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  /** the cutoff used on the last step (Hz), for the HUD */
  cutoff = 0;
  constructor(public params: OneEuroParams) {}

  reset(): void {
    this.fq = null;
    this.velocity = { x: 0, y: 0, z: 0 };
  }

  get value(): Quat | null {
    return this.fq;
  }
  get lastTime(): number {
    return this.t;
  }

  /** t in seconds. A gap longer than `maxGap` snaps instead of smearing. */
  filter(q: Quat, t: number, maxGap = 0.5): Quat {
    const qn = qNormalize(q);
    if (this.fq === null || t - this.t > maxGap) {
      this.fq = qn;
      this.raw = qn;
      this.t = t;
      this.velocity = { x: 0, y: 0, z: 0 };
      return qn;
    }
    const dt = Math.max(1e-3, t - this.t);
    const cur = qSameHemisphere(qn, this.raw);
    // raw rotation since the previous raw sample, in the body frame
    const step = qLog(qMul(qConj(this.raw), cur));
    const ad = alphaFor(this.params.dCutoff, dt);
    this.velocity = {
      x: this.velocity.x + ad * (step.x / dt - this.velocity.x),
      y: this.velocity.y + ad * (step.y / dt - this.velocity.y),
      z: this.velocity.z + ad * (step.z / dt - this.velocity.z),
    };
    const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
    this.cutoff = this.params.minCutoff + this.params.beta * speed;
    const a = alphaFor(this.cutoff, dt);
    // move a fraction `a` of the way from the filtered value to the new sample
    const toward = qLog(qMul(qConj(this.fq), qSameHemisphere(cur, this.fq)));
    this.fq = qNormalize(qMul(this.fq, qExp({ x: toward.x * a, y: toward.y * a, z: toward.z * a })));
    this.raw = cur;
    this.t = t;
    return this.fq;
  }
}
