import { clamp } from "./math";
import type { DetectorOutput, TouchPoint } from "./types";

/**
 * Curved-swipe recogniser (penalty kick): a touch path, not motion.
 *
 * Input is the list of pointer positions from touchstart to touchend (CSS
 * pixels, y down). Output:
 *  - direction: heading of the start-to-end chord, radians, 0 = straight up
 *    the screen, positive = clockwise (towards the right).
 *  - power: from the peak finger speed (px/s), 0..1.
 *  - curl: signed, -1..1. Positive means the path turns clockwise as it is
 *    travelled (bulges left, finishes heading right) = the ball bends right.
 *    Measured as the total turning angle of the best circular arc, found by
 *    least-squares fitting a parabola to the path's deviation from its chord
 *    (linear, so it stays stable when the path is nearly straight).
 *
 * Caveat that only real thumbs can settle: a thumb pivots on the hand, so
 * every swipe has some natural curvature of one sign. `curlBias` subtracts
 * a per-hand baseline once you have measured it.
 */
export interface SwipeOptions {
  /** Shortest accepted path (px). */
  minLength?: number;
  /** Peak speed (px/s) below which it is a drag, not a swipe. */
  minPeakSpeed?: number;
  /** Longest accepted duration (s). */
  maxDurationS?: number;
  /** Peak speed mapping to power 0 and 1 (px/s). */
  speedLow?: number;
  speedHigh?: number;
  /** Total turning angle (rad) that maps to curl +-1. */
  curlRange?: number;
  /** Baseline turn (rad) subtracted before mapping to curl. */
  curlBias?: number;
}

export interface SwipeEvent {
  type: "swipe";
  t: number;
  /** Radians, 0 = up, + = clockwise. */
  direction: number;
  directionDeg: number;
  /** Chord length, px. */
  length: number;
  arcLength: number;
  durationS: number;
  peakSpeed: number;
  meanSpeed: number;
  /** 0..1. */
  power: number;
  /** Signed total turning angle of the path, radians, + = clockwise. */
  turnAngle: number;
  /** turnAngle / arcLength, 1/px. */
  curvature: number;
  /** -1..1, + = ball bends right. */
  curl: number;
}

export function recogniseSwipe(points: readonly TouchPoint[], options: SwipeOptions = {}): DetectorOutput<SwipeEvent> {
  const o = {
    minLength: options.minLength ?? 40,
    minPeakSpeed: options.minPeakSpeed ?? 250,
    maxDurationS: options.maxDurationS ?? 1.2,
    speedLow: options.speedLow ?? 300,
    speedHigh: options.speedHigh ?? 3000,
    curlRange: options.curlRange ?? Math.PI / 2,
    curlBias: options.curlBias ?? 0,
  };
  const t0 = points.length ? points[points.length - 1].t : 0;
  const rej = (reason: string, detail?: string): DetectorOutput<SwipeEvent> => ({ kind: "reject", t: t0, gesture: "swipe", reason, detail });
  if (points.length < 4) return rej("too-few-points", `${points.length} points`);

  // Per-segment speeds.
  const n = points.length;
  const seg: number[] = [];
  for (let i = 1; i < n; i++) {
    const dt = Math.max(points[i].t - points[i - 1].t, 1e-3);
    seg.push(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) / dt);
  }
  // Trim the touch-down dwell (finger settling) and the pre-lift dwell.
  const slop = 6;
  let a = 0;
  while (a < n - 1 && Math.hypot(points[a].x - points[0].x, points[a].y - points[0].y) < slop) a++;
  a = Math.max(0, a - 1);
  let b = n - 1;
  while (b > a + 1 && seg[b - 1] < 40) b--;
  const p = points.slice(a, b + 1);
  if (p.length < 4) return rej("too-few-points", "after trimming");

  // Path metrics.
  let arc = 0;
  for (let i = 1; i < p.length; i++) arc += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  const dx = p[p.length - 1].x - p[0].x, dy = p[p.length - 1].y - p[0].y;
  const chord = Math.hypot(dx, dy);
  const duration = p[p.length - 1].t - p[0].t;
  if (chord < o.minLength) return rej("too-short", `${chord.toFixed(0)} px`);
  if (duration > o.maxDurationS) return rej("too-slow", `${duration.toFixed(2)} s: a drag`);

  // Speed: 3-point mean of segment speeds, take the peak.
  const sp: number[] = [];
  for (let i = 1; i < p.length; i++) {
    sp.push(Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) / Math.max(p[i].t - p[i - 1].t, 1e-3));
  }
  let peak = 0;
  for (let i = 0; i < sp.length; i++) {
    const lo = Math.max(0, i - 1), hi = Math.min(sp.length - 1, i + 1);
    let m = 0;
    for (let j = lo; j <= hi; j++) m += sp[j];
    peak = Math.max(peak, m / (hi - lo + 1));
  }
  if (peak < o.minPeakSpeed) return rej("too-slow", `${peak.toFixed(0)} px/s peak`);

  // Resample by arc length to 32 points, then fit deviation = 4 s u (1-u).
  const N = 32;
  const cum: number[] = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
  const cx = dx / chord, cy = dy / chord;
  // Right-hand side of the direction of travel on a y-down screen.
  const rx = -cy, ry = cx;
  let num = 0, den = 0;
  let j = 0;
  for (let k = 0; k <= N; k++) {
    const target = (arc * k) / N;
    while (j < p.length - 2 && cum[j + 1] < target) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const f = clamp((target - cum[j]) / span, 0, 1);
    const x = p[j].x + (p[j + 1].x - p[j].x) * f;
    const y = p[j].y + (p[j + 1].y - p[j].y) * f;
    const u = ((x - p[0].x) * cx + (y - p[0].y) * cy) / chord;
    const dev = ((x - p[0].x) * rx + (y - p[0].y) * ry) / chord;
    const basis = 4 * u * (1 - u);
    num += dev * basis;
    den += basis * basis;
  }
  const sRight = den > 0 ? num / den : 0; // sagitta / chord, + = bulges right
  // A circular arc with sagitta ratio s turns through 4 atan(2 s); bulging right = anticlockwise.
  const turn = -4 * Math.atan(2 * sRight);
  const direction = Math.atan2(dx, -dy);
  const power = clamp((peak - o.speedLow) / (o.speedHigh - o.speedLow), 0, 1);
  const curl = clamp((turn - o.curlBias) / o.curlRange, -1, 1);
  return {
    kind: "event",
    event: {
      type: "swipe",
      t: p[p.length - 1].t,
      direction,
      directionDeg: (direction * 180) / Math.PI,
      length: chord,
      arcLength: arc,
      durationS: duration,
      peakSpeed: peak,
      meanSpeed: duration > 0 ? arc / duration : 0,
      power,
      turnAngle: turn,
      curvature: arc > 0 ? turn / arc : 0,
      curl,
    },
  };
}

/** Pointer-event adapter: feed down/move/up and get a result on up. */
export interface SwipeTracker {
  down(t: number, x: number, y: number): void;
  move(t: number, x: number, y: number): void;
  up(t: number, x: number, y: number): DetectorOutput<SwipeEvent>;
  cancel(): void;
  /** Points collected so far (for drawing). */
  points(): readonly TouchPoint[];
}

export function createSwipeTracker(options: SwipeOptions = {}): SwipeTracker {
  let pts: TouchPoint[] = [];
  return {
    down(t, x, y) { pts = [{ t, x, y }]; },
    move(t, x, y) { pts.push({ t, x, y }); },
    up(t, x, y) {
      pts.push({ t, x, y });
      const res = recogniseSwipe(pts, options);
      return res;
    },
    cancel() { pts = []; },
    points() { return pts; },
  };
}

