// "Neutral" calibration: however the person is holding the phone when they
// connect becomes flat-on-screen for the mockup.
import { Quat, qConj, qIdentity, qMul, qNormalize, qSameHemisphere } from "./quat";

/** Mean of nearby orientations (hemisphere-aligned, summed, normalised). */
export function averageQuats(qs: Quat[]): Quat {
  if (qs.length === 0) return qIdentity();
  const ref = qs[0];
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 0;
  for (const q of qs) {
    const a = qSameHemisphere(q, ref);
    x += a.x;
    y += a.y;
    z += a.z;
    w += a.w;
  }
  return qNormalize({ x, y, z, w });
}

/** Rotation of `q` relative to `neutral`, expressed in neutral's own frame. */
export const relativeTo = (neutral: Quat, q: Quat): Quat => qNormalize(qMul(qConj(neutral), q));

export class Calibrator {
  private buf: Quat[] = [];
  neutral: Quat | null = null;
  constructor(public samples = 6) {}

  /** Adopt the average of orientations we already have. */
  seed(qs: Quat[]): void {
    this.buf = [];
    this.neutral = qs.length ? averageQuats(qs) : null;
  }
  get count(): number {
    return this.buf.length;
  }
  /** Settle for however many samples arrived (a phone held very still may send few). */
  finalize(): boolean {
    if (this.neutral || this.buf.length === 0) return this.done;
    this.neutral = averageQuats(this.buf);
    this.buf = [];
    return true;
  }
  get done(): boolean {
    return this.neutral !== null;
  }
  get progress(): number {
    return this.neutral ? 1 : this.buf.length / this.samples;
  }
  reset(): void {
    this.buf = [];
    this.neutral = null;
  }
  /** Feed an orientation. Returns true once calibration has completed (and on every later call). */
  push(q: Quat): boolean {
    if (this.neutral) return true;
    this.buf.push(q);
    if (this.buf.length >= this.samples) {
      this.neutral = averageQuats(this.buf);
      this.buf = [];
      return true;
    }
    return false;
  }
  relative(q: Quat): Quat {
    return this.neutral ? relativeTo(this.neutral, q) : qIdentity();
  }
}
