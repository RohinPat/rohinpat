import { emaAlpha, safeDt } from "./math";
import type { MotionSample } from "./types";

/**
 * Twist recogniser (watch crown, engine throttle): continuous rotation about
 * the screen axis (device z), read straight from the gyro.
 *
 * Output per sample:
 *  - omega: signed angular velocity after smoothing and dead zone, rad/s.
 *    Positive = counter-clockwise as the player looks at the screen
 *    (right-hand rule about the axis pointing out of the screen). Negative is
 *    the clockwise "wind the crown" direction.
 *  - angle: omega integrated since the last `zero()`, radians (not wrapped,
 *    so it counts whole turns).
 *
 * Gyro bias is tracked while the signal is inside the dead-zone band, so a
 * phone lying still does not creep. The dead zone ramps in over one extra
 * `deadZone` width instead of stepping, so slow turns do not stutter and the
 * accumulated angle loses less than a degree per stroke.
 */
export interface TwistOptions {
  /** Dead zone half-width, rad/s (0.12 = 7 deg/s). */
  deadZone?: number;
  /** Smoothing time constant, s. */
  smoothingS?: number;
  /** Bias tracking time constant, s. */
  biasTauS?: number;
  /** Flip the sign if your game wants clockwise = positive. */
  invert?: boolean;
}

export interface TwistState {
  /** Rad/s, dead-zoned. */
  omega: number;
  /** Radians since zero(). */
  angle: number;
  angleDeg: number;
  /** Whole turns (angle / 2 pi). */
  turns: number;
  /** True while |omega| is outside the dead zone. */
  active: boolean;
  /** Tracked gyro bias on the screen axis, rad/s (diagnostic). */
  bias: number;
}

export interface TwistFilter {
  push(sample: MotionSample): TwistState;
  zero(): void;
  reset(): void;
}

export function createTwistFilter(options: TwistOptions = {}): TwistFilter {
  const dz = options.deadZone ?? 0.12;
  const smoothingS = options.smoothingS ?? 0.04;
  const biasTauS = options.biasTauS ?? 1.5;
  const sign = options.invert ? -1 : 1;
  let lastT: number | null = null;
  let sm = 0;
  let bias = 0;
  let angle = 0;
  let omega = 0;
  let primed = false;

  const state = (): TwistState => ({
    omega: omega * sign,
    angle: angle * sign,
    angleDeg: (angle * sign * 180) / Math.PI,
    turns: (angle * sign) / (2 * Math.PI),
    active: omega !== 0,
    bias,
  });

  return {
    push(s) {
      const raw = s.gyro[2];
      const dt = lastT === null ? 0.016 : safeDt(s.t - lastT);
      lastT = s.t;
      if (!primed) {
        sm = raw;
        bias = raw;
        primed = true;
      }
      sm += emaAlpha(dt, smoothingS) * (raw - sm);
      // Track bias only while the reading sits inside the band where it could be bias.
      if (Math.abs(sm - bias) < 2 * dz) bias += emaAlpha(dt, biasTauS) * (sm - bias);
      const x = sm - bias;
      const a = Math.abs(x);
      const gain = a <= dz ? 0 : a >= 2 * dz ? 1 : (() => { const u = (a - dz) / dz; return u * u * (3 - 2 * u); })();
      omega = x * gain;
      angle += omega * dt;
      return state();
    },
    zero() {
      angle = 0;
    },
    reset() {
      lastT = null;
      sm = 0;
      bias = 0;
      angle = 0;
      omega = 0;
      primed = false;
    },
  };
}
