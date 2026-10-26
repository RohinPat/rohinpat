import { OrientationFilter } from "./orientation";
import { clamp, emaAlpha, safeDt } from "./math";
import type { MotionSample } from "./types";

/**
 * Tilt-steer recogniser (ski): continuous left-right lean plus a forward tilt
 * to tuck.
 *
 * Assumed pose: phone held in a reading pose, screen up and tilted back
 * (device pitch between about 0 and 70 degrees, top edge raised). Lean is
 * rotation about the long (y) axis, which gravity can see in that pose; it is
 * the W3C `gamma` angle. If the phone is held bolt upright, lean is a
 * rotation about the vertical and no accelerometer on earth can see it: the
 * output goes `valid: false` instead of guessing.
 *
 * Gravity direction comes from the gyro-aided orientation filter, so walking
 * jolts do not turn into steering. Neutral is the average pose over the first
 * `autoNeutralS` seconds (or whatever `recalibrate()` last captured).
 *
 *  steer = clamp((lean - neutral) / maxAngle), dead-zoned and rescaled so it
 *          still reaches +-1 at the end of travel.
 *  tuck  = 0..1 for the top edge tilted AWAY from the player (pitch
 *          decreasing from neutral), after its own dead zone.
 */
export interface TiltOptions {
  /** Lean (deg) that maps to steer = +-1. */
  maxAngleDeg?: number;
  deadZoneDeg?: number;
  /** Smoothing time constant, s. */
  smoothingS?: number;
  /** Seconds of initial data averaged into the neutral pose (after the settle time). */
  autoNeutralS?: number;
  /** Seconds to wait at start before averaging, while the gravity estimate converges. */
  settleS?: number;
  /** Forward tilt (deg) where tuck reaches 1, and its dead zone. */
  tuckRangeDeg?: number;
  tuckDeadDeg?: number;
}

export interface TiltState {
  /** -1 (left) .. 1 (right). */
  steer: number;
  /** 0 (upright) .. 1 (fully tucked). */
  tuck: number;
  /** Lean from neutral, degrees, + = right edge down. */
  leanDeg: number;
  /** Pitch change from neutral, degrees, + = top edge tilted away (forward). */
  forwardDeg: number;
  /** Absolute lean/pitch angles, degrees. */
  rollDeg: number;
  pitchDeg: number;
  /** False when the pose is too upright for gravity to resolve lean. */
  valid: boolean;
  calibrated: boolean;
}

export interface TiltFilter {
  push(sample: MotionSample): TiltState;
  recalibrate(): void;
  reset(): void;
}

const R2D = 180 / Math.PI;

export function createTiltFilter(options: TiltOptions = {}): TiltFilter {
  const o = {
    maxAngleDeg: options.maxAngleDeg ?? 30,
    deadZoneDeg: options.deadZoneDeg ?? 4,
    smoothingS: options.smoothingS ?? 0.08,
    autoNeutralS: options.autoNeutralS ?? 0.6,
    settleS: options.settleS ?? 0.5,
    tuckRangeDeg: options.tuckRangeDeg ?? 25,
    tuckDeadDeg: options.tuckDeadDeg ?? 5,
  };
  let filter = new OrientationFilter();
  let lastT: number | null = null;
  let t0: number | null = null;
  let roll = 0;
  let pitch = 0;
  let primed = false;
  let neutral: { roll: number; pitch: number } | null = null;
  let accRoll = 0, accPitch = 0, accN = 0;
  let wantCal = false;
  let last: TiltState = { steer: 0, tuck: 0, leanDeg: 0, forwardDeg: 0, rollDeg: 0, pitchDeg: 0, valid: false, calibrated: false };

  const dead = (x: number, dz: number, range: number) => {
    const a = Math.abs(x);
    if (a <= dz) return 0;
    return Math.sign(x) * clamp((a - dz) / (range - dz), 0, 1);
  };

  return {
    push(s) {
      filter.update(s);
      const dt = lastT === null ? 0.016 : safeDt(s.t - lastT);
      lastT = s.t;
      t0 ??= s.t;
      const up = filter.up();
      const cosB = Math.hypot(up[0], up[2]);
      const valid = cosB > 0.25;
      if (!valid) {
        last = { ...last, valid: false, steer: 0, tuck: 0 };
        return last;
      }
      const r = Math.atan2(-up[0], up[2]) * R2D;
      const p = Math.asin(clamp(up[1], -1, 1)) * R2D;
      if (!primed) { roll = r; pitch = p; primed = true; }
      const a = emaAlpha(dt, o.smoothingS);
      roll += a * (r - roll);
      pitch += a * (p - pitch);

      if (wantCal) {
        neutral = { roll, pitch };
        wantCal = false;
      } else if (!neutral) {
        if (s.t - t0 >= o.settleS) { accRoll += r; accPitch += p; accN++; }
        if (s.t - t0 >= o.settleS + o.autoNeutralS && accN > 0) neutral = { roll: accRoll / accN, pitch: accPitch / accN };
      }
      const n = neutral ?? { roll, pitch };
      const lean = roll - n.roll;
      const fwd = n.pitch - pitch;
      last = {
        steer: dead(lean, o.deadZoneDeg, o.maxAngleDeg),
        tuck: clamp((fwd - o.tuckDeadDeg) / (o.tuckRangeDeg - o.tuckDeadDeg), 0, 1),
        leanDeg: lean,
        forwardDeg: fwd,
        rollDeg: roll,
        pitchDeg: pitch,
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
      accRoll = accPitch = accN = 0;
      wantCal = false;
    },
  };
}
