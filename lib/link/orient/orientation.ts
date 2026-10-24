// Device orientation -> a quaternion, and a quaternion -> CSS.
import {
  DEG,
  Quat,
  qConj,
  qExp,
  qFromAxisAngle,
  qFromEulerZXY,
  qIdentity,
  qLog,
  qMul,
  qNeg,
  qNormalize,
  qToMatrix,
} from "./quat";

export type Platform = "ios" | "android" | "other";

/** Raw W3C deviceorientation angles in degrees, plus the screen rotation. */
export interface OrientSample {
  alpha: number;
  beta: number;
  gamma: number;
  /** screen.orientation.angle: 0, 90, 180 or 270. */
  screenAngle: number;
}

/**
 * Sign conventions. The W3C spec fixes the meaning of alpha/beta/gamma and both
 * iOS Safari and Chrome for Android follow it, so the defaults are "no flip".
 * The knobs exist because this has not been checked on real hardware: if the
 * mockup tilts the wrong way on someone's phone they can flip an axis live.
 */
export interface Conventions {
  flipAlpha: boolean;
  flipBeta: boolean;
  flipGamma: boolean;
}
export const SPEC_CONVENTIONS: Conventions = { flipAlpha: false, flipBeta: false, flipGamma: false };

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  // iPadOS 13+ reports itself as a Mac
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

export function conventionsFor(platform: Platform): Conventions {
  void platform; // both follow the spec; see Conventions above
  return { ...SPEC_CONVENTIONS };
}

/**
 * devicemotion acceleration: iOS reports it with the opposite sign to Android
 * (and to the spec's description) for both `acceleration` and
 * `accelerationIncludingGravity`. Normalise to the Android/spec sign.
 */
export function normalizeAcceleration(
  a: { x: number; y: number; z: number },
  platform: Platform,
): { x: number; y: number; z: number } {
  return platform === "ios" ? { x: -a.x, y: -a.y, z: -a.z } : a;
}

/** deviceorientation angles (degrees) -> orientation quaternion, device -> earth. */
export function sampleToQuat(s: OrientSample, conv: Conventions = SPEC_CONVENTIONS): Quat {
  const a = (conv.flipAlpha ? -s.alpha : s.alpha) * DEG;
  const b = (conv.flipBeta ? -s.beta : s.beta) * DEG;
  const g = (conv.flipGamma ? -s.gamma : s.gamma) * DEG;
  const q = qFromEulerZXY(a, b, g);
  // account for the browser rotating its UI when the phone goes landscape
  return qMul(q, qFromAxisAngle({ x: 0, y: 0, z: 1 }, -s.screenAngle * DEG));
}

// ---- the pleasing range ---------------------------------------------------

export interface ClampConfig {
  /** radians: soft limit on how far the face may tilt (pitch/yaw of the phone) */
  maxTilt: number;
  /** radians: soft limit on in-plane twist */
  maxRoll: number;
}
export const DEFAULT_CLAMP: ClampConfig = { maxTilt: 42 * DEG, maxRoll: 32 * DEG };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Soft limit: slope 1 near zero (so small motions track 1:1), saturating at
 * `max`, then easing back to 0 as the real phone approaches a half-turn from
 * neutral. That last part is what stops a visible jump at 180 degrees, where the
 * shortest-rotation direction flips.
 */
export function softLimit(angle: number, max: number): number {
  const a = Math.abs(angle);
  const fade = 1 - smoothstep(110 * DEG, 175 * DEG, a);
  return Math.sign(angle) * max * Math.tanh(a / max) * fade;
}

/** Split q = swing * twist, twist being the rotation about the screen normal (z). */
export function swingTwist(q: Quat): { swing: Quat; twist: Quat } {
  const p = q.w < 0 ? qNeg(q) : q;
  const n = Math.hypot(p.z, p.w);
  const twist: Quat = n < 1e-9 ? qIdentity() : { x: 0, y: 0, z: p.z / n, w: p.w / n };
  return { swing: qMul(p, qConj(twist)), twist };
}

/** Clamp a calibrated rotation to the pleasing range. Continuous, never flips. */
export function softClamp(q: Quat, cfg: ClampConfig = DEFAULT_CLAMP): Quat {
  const { swing, twist } = swingTwist(qNormalize(q));
  const sv = qLog(swing);
  const sAngle = Math.hypot(sv.x, sv.y, sv.z);
  const sLimited = softLimit(sAngle, cfg.maxTilt);
  const k = sAngle < 1e-9 ? 1 : sLimited / sAngle;
  const swing2 = qExp({ x: sv.x * k, y: sv.y * k, z: sv.z * k });
  const tAngle = 2 * Math.atan2(twist.z, twist.w);
  const twist2 = qFromAxisAngle({ x: 0, y: 0, z: 1 }, softLimit(tAngle, cfg.maxRoll));
  return qNormalize(qMul(swing2, twist2));
}

// ---- device frame -> CSS ---------------------------------------------------
// Device frame: x right, y up the screen, z out of the screen toward the user.
// CSS frame:    x right, y down,         z toward the viewer.
// They differ by the reflection S = diag(1,-1,1); conjugating a rotation by S
// negates the x and z parts of its quaternion.

export const deviceToCss = (q: Quat): Quat => ({ x: -q.x, y: q.y, z: -q.z, w: q.w });

/** CSS matrix3d() (column-major) for a device-frame rotation. */
export function toMatrix3d(qDevice: Quat): string {
  const r = qToMatrix(deviceToCss(qDevice));
  const f = (n: number) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(6));
  return `matrix3d(${f(r[0][0])},${f(r[1][0])},${f(r[2][0])},0,${f(r[0][1])},${f(r[1][1])},${f(r[2][1])},0,${f(r[0][2])},${f(r[1][2])},${f(r[2][2])},0,0,0,0,1)`;
}

/** The 3x3 part of a computed CSS transform (used by tests and the Playwright probe). */
export function parseMatrix3d(css: string): number[][] | null {
  const s = css.trim();
  const m3 = /^matrix3d\(([^)]+)\)$/.exec(s);
  if (m3) {
    const v = m3[1].split(",").map(Number);
    if (v.length !== 16 || v.some((n) => Number.isNaN(n))) return null;
    return [
      [v[0], v[4], v[8]],
      [v[1], v[5], v[9]],
      [v[2], v[6], v[10]],
    ];
  }
  const m2 = /^matrix\(([^)]+)\)$/.exec(s);
  if (m2) {
    const v = m2[1].split(",").map(Number);
    if (v.length !== 6) return null;
    return [
      [v[0], v[2], 0],
      [v[1], v[3], 0],
      [0, 0, 1],
    ];
  }
  if (s === "none") {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }
  return null;
}
