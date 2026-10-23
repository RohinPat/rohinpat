import { DEG } from "./math";
import type { MotionSample, OrientationAngles } from "./types";

/**
 * The subset of a browser DeviceMotionEvent we read. Declared structurally so
 * this module has no DOM dependency and tests can pass plain objects.
 */
export interface DeviceMotionLike {
  accelerationIncludingGravity: { x: number | null; y: number | null; z: number | null } | null;
  acceleration: { x: number | null; y: number | null; z: number | null } | null;
  /** Degrees per second. alpha = about z, beta = about x, gamma = about y. */
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null } | null;
  interval?: number;
}

const finite3 = (v: { x: number | null; y: number | null; z: number | null } | null): [number, number, number] | null =>
  v && v.x !== null && v.y !== null && v.z !== null && Number.isFinite(v.x + v.y + v.z) ? [v.x, v.y, v.z] : null;

/**
 * Convert a DeviceMotionEvent into a MotionSample. Returns null when the
 * event carries no usable accelerometer + gyro pair (desktop browsers fire
 * one empty event on load).
 *
 * `t` is seconds on any monotonic clock (use performance.now() / 1000).
 * Mapping: rotationRate.beta -> x, gamma -> y, alpha -> z, degrees -> radians.
 */
export function motionSampleFromEvent(e: DeviceMotionLike, t: number, orient?: OrientationAngles | null): MotionSample | null {
  const acc = finite3(e.accelerationIncludingGravity);
  const rr = e.rotationRate;
  if (!acc || !rr || rr.alpha === null || rr.beta === null || rr.gamma === null) return null;
  if (!Number.isFinite(rr.alpha + rr.beta + rr.gamma)) return null;
  const lin = finite3(e.acceleration);
  const s: MotionSample = { t, acc, gyro: [rr.beta * DEG, rr.gamma * DEG, rr.alpha * DEG] };
  if (lin) s.lin = lin;
  if (orient) s.orient = orient;
  return s;
}

/** One row of the downloadable recording, flat and human-readable. Times in ms, angles in degrees. */
export interface RecordedRow {
  t: number;
  ax: number; ay: number; az: number;
  lx: number | null; ly: number | null; lz: number | null;
  /** rotationRate, deg/s, exactly as the browser reported them. */
  ra: number; rb: number; rg: number;
  oa: number | null; ob: number | null; og: number | null;
}

export interface RecordingFile {
  format: "swing-lab-recording";
  version: 1;
  /** Gesture label picked in the recorder, e.g. "golf-swing". */
  label: string;
  note: string;
  userAgent: string;
  /** Result of the accelerometer sign check: 1 = spec (up at rest), -1 = inverted, null = could not tell. Raw rows are NOT corrected. */
  accelSign: 1 | -1 | null;
  /** Estimated sample rate while recording, Hz. */
  rateHz: number;
  /** Axis convention reminder so the file explains itself. */
  axes: string;
  durationMs: number;
  samples: RecordedRow[];
}

export const AXES_NOTE =
  "Device frame: x right, y up the screen, z out of the screen. a* = accelerationIncludingGravity m/s^2 (points up at rest on spec-following browsers), l* = acceleration m/s^2 (gravity removed, may be null), ra = rotationRate.alpha (about z), rb = beta (about x), rg = gamma (about y), all deg/s. oa/ob/og = deviceorientation alpha/beta/gamma degrees. t is ms since recording start.";

export function rowFromSample(s: MotionSample, t0: number): RecordedRow {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    t: r((s.t - t0) * 1000),
    ax: r(s.acc[0]), ay: r(s.acc[1]), az: r(s.acc[2]),
    lx: s.lin ? r(s.lin[0]) : null, ly: s.lin ? r(s.lin[1]) : null, lz: s.lin ? r(s.lin[2]) : null,
    rb: r(s.gyro[0] / DEG), rg: r(s.gyro[1] / DEG), ra: r(s.gyro[2] / DEG),
    oa: s.orient ? r(s.orient.alpha) : null, ob: s.orient ? r(s.orient.beta) : null, og: s.orient ? r(s.orient.gamma) : null,
  };
}

export function sampleFromRow(row: RecordedRow): MotionSample {
  const s: MotionSample = {
    t: row.t / 1000,
    acc: [row.ax, row.ay, row.az],
    gyro: [row.rb * DEG, row.rg * DEG, row.ra * DEG],
  };
  if (row.lx !== null && row.ly !== null && row.lz !== null) s.lin = [row.lx, row.ly, row.lz];
  if (row.oa !== null && row.ob !== null && row.og !== null) s.orient = { alpha: row.oa, beta: row.ob, gamma: row.og };
  return s;
}

/** Load a downloaded recording back into samples (for replaying through the recognisers). */
export function samplesFromRecording(file: RecordingFile): MotionSample[] {
  const rows = file.samples.map(sampleFromRow);
  return file.accelSign === -1 ? rows.map(flipAccel) : rows;
}

// ---- accelerometer sign convention -------------------------------------------------
//
// The spec says accelerationIncludingGravity points UP at rest (+9.8 on z for
// a phone lying face up). Some browsers/platforms report the opposite sign,
// and every recogniser here assumes the spec. DeviceOrientation (beta/gamma)
// has no such ambiguity, so we compare the two and flip the accelerometer if
// they disagree.

/** World up in device coordinates implied by DeviceOrientation beta/gamma (degrees). */
export function upFromOrientation(o: OrientationAngles): [number, number, number] {
  const b = o.beta * DEG, g = o.gamma * DEG;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

/** Cosine between the accelerometer direction and the orientation-implied up. +1 = spec, -1 = inverted. */
export function accelSignVote(acc: [number, number, number], o: OrientationAngles): number {
  const n = Math.hypot(acc[0], acc[1], acc[2]);
  if (n < 5) return 0;
  const u = upFromOrientation(o);
  return (acc[0] * u[0] + acc[1] * u[1] + acc[2] * u[2]) / n;
}

/** Running vote over quiet samples; call `add` per sample, `sign` once enough evidence exists. */
export function createAccelSignDetector(minVotes = 30) {
  let sum = 0;
  let n = 0;
  return {
    add(s: MotionSample) {
      if (!s.orient) return;
      const mag = Math.hypot(s.acc[0], s.acc[1], s.acc[2]);
      // Only vote while the reading is close to 1 g: then it IS gravity.
      if (Math.abs(mag - 9.80665) > 1.5) return;
      const v = accelSignVote(s.acc, s.orient);
      if (v === 0) return;
      sum += v;
      n++;
    },
    /** 1 = matches spec, -1 = inverted, null = not enough evidence yet. */
    sign(): 1 | -1 | null {
      if (n < minVotes) return null;
      const m = sum / n;
      return Math.abs(m) < 0.5 ? null : m > 0 ? 1 : -1;
    },
    votes: () => n,
  };
}

export function flipAccel(s: MotionSample): MotionSample {
  const neg = (v: [number, number, number]): [number, number, number] => [-v[0], -v[1], -v[2]];
  return { ...s, acc: neg(s.acc), lin: s.lin ? neg(s.lin) : undefined };
}
