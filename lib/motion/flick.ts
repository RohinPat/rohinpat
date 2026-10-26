import { OrientationFilter } from "./orientation";
import { clamp } from "./math";
import type { Detector, DetectorOutput, MotionSample } from "./types";

/**
 * Flick-up recogniser (hoops): one sharp upward acceleration pulse.
 *
 * Frame: a gyro-aided gravity tracker (OrientationFilter) rotates linear
 * acceleration into a world frame, so "up" stays up even when the wrist
 * pitches the phone mid-flick. If the browser supplies `acceleration` (OS
 * gravity-free) that is used; otherwise gravity is subtracted using the
 * tracker. Heading comes from integrating the gyro, so it is only good for
 * about a second, which is all a flick needs.
 *
 * A flick is accepted when its positive vertical lobe
 *  - peaks above `minPeak` (m/s^2),
 *  - has a half-height width between `minWidthS` and `maxWidthS`
 *    (a table bump is ~20 ms wide, a slow pick-up is seconds),
 *  - is not part of a rhythm (another lobe >= 40% as tall within
 *    `isolationS` either side: walking, shaking, pocket heel strikes),
 *  - is not ringing (a bump rattles the sign of the signal several times),
 *  - and is mostly vertical rather than sideways.
 * The result is held back `confirmDelayS` after the lobe ends so a second
 * stroke of a shake can still cancel it. That is a latency/precision trade.
 *
 * Power is the lobe's impulse (hand release speed, m/s). Aim is the angle of
 * the lobe's lateral-to-vertical impulse (atan2), optionally blended with the
 * wrist yaw swept during the flick.
 */
export interface FlickOptions {
  /** Minimum peak vertical acceleration (m/s^2). */
  minPeak?: number;
  minWidthS?: number;
  maxWidthS?: number;
  /** Rhythm window either side of the flick. */
  isolationS?: number;
  /** Wait this long after the lobe ends before emitting. */
  confirmDelayS?: number;
  /** Impulse (m/s) mapping to power 0 and power 1. */
  impulseLow?: number;
  impulseHigh?: number;
  /** Aim angle (deg) that maps to +-1. */
  aimRangeDeg?: number;
  /** How many degrees of aim one degree of wrist yaw adds (0 = lateral only). */
  yawWeight?: number;
}

export interface FlickEvent {
  type: "flick-up";
  /** Time of the acceleration peak. */
  t: number;
  /** Peak vertical acceleration, m/s^2. */
  peakAccel: number;
  /** Vertical impulse of the lobe (release speed), m/s. */
  impulse: number;
  /** 0..1. */
  power: number;
  /** -1 (left) .. 1 (right). */
  aim: number;
  aimDeg: number;
  /** atan2(lateral, vertical) impulse of the lobe, degrees, + = right. */
  lateralAimDeg: number;
  /** Wrist yaw swept during the flick, degrees, + = counter-clockwise seen from above (turning left). */
  yawDeg: number;
  widthS: number;
}

interface Entry {
  t: number;
  /** World-frame linear acceleration. */
  ax: number;
  ay: number;
  az: number;
  yawRate: number;
  /** Horizontal direction of the device x axis in the world. */
  hx: number;
  hy: number;
}

interface Lobe {
  /** +1 for an upward pulse, -1 for a downward one. */
  sign: 1 | -1;
  tStart: number;
  tEnd: number;
  tPeak: number;
  peak: number;
  open: boolean;
  emitted: boolean;
}

export function createFlickDetector(options: FlickOptions = {}): Detector<MotionSample, FlickEvent> {
  const o = {
    minPeak: options.minPeak ?? 9,
    minWidthS: options.minWidthS ?? 0.045,
    maxWidthS: options.maxWidthS ?? 0.45,
    isolationS: options.isolationS ?? 0.7,
    confirmDelayS: options.confirmDelayS ?? 0.25,
    impulseLow: options.impulseLow ?? 0.4,
    impulseHigh: options.impulseHigh ?? 3.0,
    aimRangeDeg: options.aimRangeDeg ?? 30,
    yawWeight: options.yawWeight ?? 0.5,
  };
  const ON = 3; // m/s^2 to open a lobe
  const OFF = 1.5; // m/s^2 to close it

  let filter = new OrientationFilter();
  let buf: Entry[] = [];
  let lobes: Lobe[] = [];
  let cur: Lobe | null = null;
  let negLobes: Lobe[] = [];
  let curNeg: Lobe | null = null;

  function reset() {
    filter = new OrientationFilter();
    buf = [];
    lobes = [];
    cur = null;
    negLobes = [];
    curNeg = null;
  }

  function evaluate(l: Lobe, now: number): DetectorOutput<FlickEvent> | null {
    // Rhythm check: any comparable lobe near this one.
    for (const other of lobes) {
      if (other === l) continue;
      if (other.peak < 0.4 * l.peak) continue;
      const gap = other.tPeak < l.tPeak ? l.tStart - other.tEnd : other.tStart - l.tEnd;
      if (gap < o.isolationS) {
        return { kind: "reject", t: now, gesture: "flick", reason: "repetitive", detail: "another pulse nearby: walking or shaking" };
      }
    }
    // A downward pulse of similar size just before is a stop, not a start (putting the phone down).
    for (const n of negLobes) {
      if (n.peak >= 0.7 * l.peak && n.tEnd <= l.tStart + 0.05 && l.tStart - n.tEnd < 0.6) {
        return { kind: "reject", t: now, gesture: "flick", reason: "mirrored", detail: "a downward pulse just before: a stop, not a start" };
      }
    }
    const seg = buf.filter((e) => e.t >= l.tStart - 0.02 && e.t <= l.tEnd + 0.02);
    if (seg.length < 2) return null;
    // Half-height width, with linear interpolation at the crossings.
    const half = l.peak / 2;
    let width = 0;
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1].az - half, b = seg[i].az - half;
      const dt = seg[i].t - seg[i - 1].t;
      if (a >= 0 && b >= 0) width += dt;
      else if (a >= 0 !== b >= 0) width += dt * (Math.max(a, b) / (Math.abs(a) + Math.abs(b)));
    }
    if (width < o.minWidthS) return { kind: "reject", t: now, gesture: "flick", reason: "too-sharp", detail: `${(width * 1000).toFixed(0)} ms wide: a bump, not a flick` };
    if (width > o.maxWidthS) return { kind: "reject", t: now, gesture: "flick", reason: "too-slow", detail: `${(width * 1000).toFixed(0)} ms wide` };

    // Ringing: sign of the vertical signal flips several times soon after the start.
    const ringBand = 0.3 * l.peak;
    let flips = 0;
    let lastSign = 0;
    for (const e of buf) {
      if (e.t < l.tStart - 0.05 || e.t > l.tStart + 0.35) continue;
      const sgn = e.az > ringBand ? 1 : e.az < -ringBand ? -1 : 0;
      if (sgn !== 0) {
        if (lastSign !== 0 && sgn !== lastSign) flips++;
        lastSign = sgn;
      }
    }
    if (flips > 2) return { kind: "reject", t: now, gesture: "flick", reason: "ringing", detail: `${flips} sign flips` };

    // Verticality at the peak.
    const pk = seg.reduce((m, e) => (e.az > m.az ? e : m), seg[0]);
    const share = pk.az / Math.hypot(pk.ax, pk.ay, pk.az);
    if (share < 0.4) return { kind: "reject", t: now, gesture: "flick", reason: "not-vertical", detail: `${(share * 100).toFixed(0)}% vertical` };

    // Impulses over the lobe.
    const first = buf.find((e) => e.t >= l.tStart) ?? seg[0];
    const hn = Math.hypot(first.hx, first.hy) || 1;
    const rx = first.hx / hn, ry = first.hy / hn;
    let Iu = 0, Il = 0;
    for (let i = 1; i < seg.length; i++) {
      const e = seg[i], p = seg[i - 1];
      if (e.t < l.tStart || e.t > l.tEnd) continue;
      const dt = e.t - p.t;
      Iu += 0.5 * (e.az + p.az) * dt;
      Il += 0.5 * (e.ax * rx + e.ay * ry + p.ax * rx + p.ay * ry) * dt;
    }
    let yaw = 0;
    for (let i = 1; i < buf.length; i++) {
      const e = buf[i], p = buf[i - 1];
      if (e.t < l.tStart - 0.05 || e.t > l.tEnd + 0.05) continue;
      yaw += 0.5 * (e.yawRate + p.yawRate) * (e.t - p.t);
    }
    const lateralAimDeg = (Math.atan2(Il, Iu) * 180) / Math.PI;
    const yawDeg = (yaw * 180) / Math.PI;
    const aimDeg = lateralAimDeg - yawDeg * o.yawWeight;
    return {
      kind: "event",
      event: {
        type: "flick-up",
        t: l.tPeak,
        peakAccel: l.peak,
        impulse: Iu,
        power: clamp((Iu - o.impulseLow) / (o.impulseHigh - o.impulseLow), 0, 1),
        aim: clamp(aimDeg / o.aimRangeDeg, -1, 1),
        aimDeg,
        lateralAimDeg,
        yawDeg,
        widthS: width,
      },
    };
  }

  function push(s: MotionSample): DetectorOutput<FlickEvent>[] {
    const out: DetectorOutput<FlickEvent>[] = [];
    filter.update(s);
    const aw = filter.toWorld(filter.linearDevice(s));
    const xw = filter.toWorld([1, 0, 0]);
    const e: Entry = {
      t: s.t,
      ax: aw[0],
      ay: aw[1],
      az: aw[2],
      yawRate: filter.yawRate(s.gyro),
      hx: xw[0],
      hy: xw[1],
    };
    buf.push(e);
    while (buf.length > 2 && s.t - buf[0].t > 4) buf.shift();
    lobes = lobes.filter((l) => s.t - l.tEnd < 4);
    negLobes = negLobes.filter((l) => s.t - l.tEnd < 4);

    // Downward pulses, tracked only for the "mirrored" check.
    if (!curNeg) {
      if (-e.az > ON) {
        curNeg = { sign: -1, tStart: e.t, tEnd: e.t, tPeak: e.t, peak: -e.az, open: true, emitted: true };
        negLobes.push(curNeg);
      }
    } else {
      if (-e.az > curNeg.peak) { curNeg.peak = -e.az; curNeg.tPeak = e.t; }
      curNeg.tEnd = e.t;
      if (-e.az < OFF || e.t - curNeg.tStart > 1.0) { curNeg.open = false; curNeg = null; }
    }

    if (!cur) {
      if (e.az > ON) {
        cur = { sign: 1, tStart: e.t, tEnd: e.t, tPeak: e.t, peak: e.az, open: true, emitted: false };
        lobes.push(cur);
      }
    } else {
      if (e.az > cur.peak) { cur.peak = e.az; cur.tPeak = e.t; }
      cur.tEnd = e.t;
      if (e.az < OFF || e.t - cur.tStart > 1.0) {
        cur.open = false;
        cur = null;
      }
    }

    for (const l of lobes) {
      if (l.emitted || l.peak < o.minPeak) continue;
      if (!l.open && s.t >= l.tEnd + o.confirmDelayS) {
        l.emitted = true;
        const res = evaluate(l, s.t);
        if (res) out.push(res);
      }
    }
    return out;
  }

  return { push, reset };
}
