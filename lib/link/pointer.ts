import type { Orient } from "./session";
import { OneEuro } from "./orient/oneEuro";
import { sampleToQuat } from "./orient/orientation";
import { DEG, qRotate } from "./orient/quat";

// The air pointer (lab): the phone held like a remote, its top edge aimed at
// the laptop. The direction the top edge points is turned into a heading
// (left/right) and an elevation (up/down), measured from where it pointed
// when the visitor pressed Center, and mapped linearly onto the screen:
// `reach` degrees of turn cross the whole width.
//
// Only the top edge's direction matters, so rolling the phone in the hand
// doesn't move the dot. Heading comes from the phone's alpha, which drifts on
// some phones (no compass lock); Center resets it. Measuring that drift on
// real phones is what this lab is for.

/** The /p screen the lab sends so the phone shows the pointer pad. */
export const POINTER_SCREEN = "lab:pointer";

/** Where the phone's top edge points: heading and elevation in radians. */
export function aim(o: Pick<Orient, "alpha" | "beta" | "gamma" | "screenAngle">): { yaw: number; pitch: number } {
  const q = sampleToQuat({ alpha: o.alpha, beta: o.beta, gamma: o.gamma, screenAngle: 0 });
  // device +y (the top edge) in earth coordinates: x east, y north, z up
  const v = qRotate(q, { x: 0, y: 1, z: 0 });
  return { yaw: Math.atan2(v.x, v.y), pitch: Math.asin(Math.max(-1, Math.min(1, v.z))) };
}

/** a - b, wrapped to -π..π (heading crosses north without a jump) */
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export type PointerTuning = {
  /** degrees of turn across the full screen width (height scales with the aspect) */
  reach: number;
  /** one-euro minimum cutoff, Hz: lower is steadier and laggier */
  minCutoff: number;
  /** one-euro speed coefficient */
  beta: number;
};

export const DEFAULT_TUNING: PointerTuning = { reach: 40, minCutoff: 1.2, beta: 0.004 };

export class AirPointer {
  tuning: PointerTuning;
  private zero: { yaw: number; pitch: number } | null = null;
  private last: { yaw: number; pitch: number } | null = null;
  private fx: OneEuro;
  private fy: OneEuro;
  samples = 0;

  constructor(tuning: PointerTuning = DEFAULT_TUNING) {
    this.tuning = { ...tuning };
    this.fx = new OneEuro({ minCutoff: tuning.minCutoff, beta: tuning.beta, dCutoff: 1 });
    this.fy = new OneEuro({ minCutoff: tuning.minCutoff, beta: tuning.beta, dCutoff: 1 });
  }

  tune(t: Partial<PointerTuning>): void {
    this.tuning = { ...this.tuning, ...t };
    this.fx.params = { ...this.fx.params, minCutoff: this.tuning.minCutoff, beta: this.tuning.beta };
    this.fy.params = { ...this.fy.params, minCutoff: this.tuning.minCutoff, beta: this.tuning.beta };
  }

  get centered(): boolean {
    return this.zero !== null;
  }

  /** wherever the phone points now is the middle of the screen */
  center(): void {
    this.zero = this.last ? { ...this.last } : null;
    this.fx.reset();
    this.fy.reset();
  }

  push(o: Orient): void {
    this.last = aim(o);
    this.samples++;
    if (!this.zero) this.center();
  }

  /** degrees off centre right now, unfiltered (for the readout) */
  offset(): { dx: number; dy: number } | null {
    if (!this.last || !this.zero) return null;
    return { dx: angleDiff(this.last.yaw, this.zero.yaw) / DEG, dy: (this.last.pitch - this.zero.pitch) / DEG };
  }

  /** the dot in CSS px for a w×h viewport at time `tMs`, clamped to the edges; null before any sample */
  position(w: number, h: number, tMs: number): { x: number; y: number } | null {
    const off = this.offset();
    if (!off) return null;
    const pxPerDeg = w / this.tuning.reach;
    const rawX = w / 2 + off.dx * pxPerDeg;
    const rawY = h / 2 - off.dy * pxPerDeg;
    const t = tMs / 1000;
    const x = this.fx.filter(rawX, t);
    const y = this.fy.filter(rawY, t);
    return { x: Math.max(0, Math.min(w - 1, x)), y: Math.max(0, Math.min(h - 1, y)) };
  }
}
