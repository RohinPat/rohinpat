import { OrientationFilter } from "./orientation";
import { clamp, emaAlpha, safeDt } from "./math";
import type { MotionSample } from "./types";

/**
 * Handlebar recogniser (ski): turn the phone like a steering wheel to carve,
 * lean it forward to tuck.
 *
 * Assumed pose: phone held upright with the screen toward the player, in
 * landscape or portrait (it does not matter which: only the angle of gravity
 * within the screen plane is used, and the neutral is wherever it was held at
 * the start). Steering is rotation about the screen's normal, clockwise =
 * right, exactly what a handlebar or a wheel does. That is the one rotation
 * gravity can see when the phone is upright (the roll that tilt.ts reads
 * disappears there), and it does not move when the phone pitches, so steering
 * and tucking do not fight each other.
 *
 *  steer = clamp((wheel - neutral) / maxAngle), dead-zoned, rescaled to +-1.
 *  tuck  = 0..1 for the top edge tipped AWAY from the player (the screen
 *          turning to face the sky) from its neutral pitch, after a dead zone.
 *
 * If the phone is nearer flat than `minUprightG` allows, the wheel angle is
 * noise, so the output goes `valid: false` (steer and tuck 0) rather than guess.
 */
export interface WheelOptions {
  /** Wheel angle (deg) that maps to steer = +-1. */
  maxAngleDeg?: number;
  deadZoneDeg?: number;
  /** Smoothing time constant, s. */
  smoothingS?: number;
  /** Seconds to wait at start before averaging, while the gravity estimate converges. */
  settleS?: number;
  /** Seconds of data averaged into the neutral pose (after the settle time). */
  autoNeutralS?: number;
  /** Forward tilt (deg) where tuck reaches 1, and its dead zone. */
  tuckRangeDeg?: number;
  tuckDeadDeg?: number;
  /** Least in-plane share of gravity (0..1) for the wheel angle to be trusted; 0.5 is within 60 degrees of upright. */
  minUprightG?: number;
}

export interface WheelState {
  /** -1 (left) .. 1 (right). */
  steer: number;
  /** 0 (upright) .. 1 (fully tucked). */
  tuck: number;
  /** Wheel angle from neutral, degrees, + = turned clockwise (right). */
  wheelDeg: number;
  /** Forward tilt from neutral, degrees, + = top edge away from the player. */
  forwardDeg: number;
  valid: boolean;
  calibrated: boolean;
}

export interface WheelFilter {
  push(sample: MotionSample): WheelState;
  /** Make the current pose neutral (the phone's "Re-centre" button; also after the screen rotates). */
  recalibrate(): void;
  reset(): void;
}

const R2D = 180 / Math.PI;

/** Signed difference a - b wrapped into (-180, 180], degrees. */
export function wrapDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

export function createWheelFilter(options: WheelOptions = {}): WheelFilter {
  const o = {
    maxAngleDeg: options.maxAngleDeg ?? 40,
    deadZoneDeg: options.deadZoneDeg ?? 5,
    smoothingS: options.smoothingS ?? 0.07,
    settleS: options.settleS ?? 0.5,
    autoNeutralS: options.autoNeutralS ?? 0.5,
    tuckRangeDeg: options.tuckRangeDeg ?? 22,
    tuckDeadDeg: options.tuckDeadDeg ?? 6,
    minUprightG: options.minUprightG ?? 0.5,
  };
  let filter = new OrientationFilter();
  let lastT: number | null = null;
  let t0: number | null = null;
  let wheel = 0;
  let pitch = 0;
  let primed = false;
  let neutral: { wheel: number; pitch: number } | null = null;
  // the average of the opening pose, a circular mean for the wheel angle
  let accS = 0, accC = 0, accPitch = 0, accN = 0;
  let wantCal = false;
  let last: WheelState = { steer: 0, tuck: 0, wheelDeg: 0, forwardDeg: 0, valid: false, calibrated: false };

  const dead = (x: number) => {
    const a = Math.abs(x);
    if (a <= o.deadZoneDeg) return 0;
    return Math.sign(x) * clamp((a - o.deadZoneDeg) / (o.maxAngleDeg - o.deadZoneDeg), 0, 1);
  };

  return {
    push(s) {
      filter.update(s);
      const dt = lastT === null ? 0.016 : safeDt(s.t - lastT);
      lastT = s.t;
      t0 ??= s.t;
      const up = filter.up();
      const valid = Math.hypot(up[0], up[1]) >= o.minUprightG;
      if (!valid) {
        last = { ...last, valid: false, steer: 0, tuck: 0 };
        return last;
      }
      const w = Math.atan2(-up[0], up[1]) * R2D;
      const p = Math.asin(clamp(up[2], -1, 1)) * R2D;
      if (!primed) { wheel = w; pitch = p; primed = true; }
      const a = emaAlpha(dt, o.smoothingS);
      wheel += a * wrapDeg(w - wheel);
      pitch += a * (p - pitch);

      if (wantCal) {
        neutral = { wheel, pitch };
        wantCal = false;
      } else if (!neutral) {
        if (s.t - t0 >= o.settleS) {
          accS += Math.sin(w / R2D);
          accC += Math.cos(w / R2D);
          accPitch += p;
          accN++;
        }
        if (s.t - t0 >= o.settleS + o.autoNeutralS && accN > 0) neutral = { wheel: Math.atan2(accS, accC) * R2D, pitch: accPitch / accN };
      }
      const n = neutral ?? { wheel, pitch };
      const turn = wrapDeg(wheel - n.wheel);
      const fwd = pitch - n.pitch;
      last = {
        steer: dead(turn),
        tuck: clamp((fwd - o.tuckDeadDeg) / (o.tuckRangeDeg - o.tuckDeadDeg), 0, 1),
        wheelDeg: turn,
        forwardDeg: fwd,
        valid: true,
        calibrated: neutral !== null,
      };
      return last;
    },
    recalibrate() {
      wantCal = true;
    },
    reset() {
      filter = new OrientationFilter();
      lastT = null;
      t0 = null;
      primed = false;
      neutral = null;
      accS = accC = accPitch = accN = 0;
      wantCal = false;
    },
  };
}
