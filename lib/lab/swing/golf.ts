import { clamp, dominantAxis, dot, emaAlpha, norm, qFromRotVec, qIdentity, qMul, qNormalize, qTwist, safeDt, scale } from "./math";
import type { Detector, DetectorOutput, MotionSample, Vec3 } from "./types";

/**
 * Golf swing recogniser: phone held like a club grip, gyro driven.
 *
 * Why the gyro and not the accelerometer: a real swing reaches 20-30 rad/s at
 * the hands, and at a hand radius of ~0.7 m that is 300+ m/s^2, far past the
 * +-8..16 g range of a phone accelerometer. The gyro (+-2000 deg/s = 34.9
 * rad/s) is the only sensor that survives a full swing, so everything here
 * runs on rotationRate. The accelerometer is not used at all.
 *
 * Pipeline (streaming):
 *  1. ADDRESS  smoothed |omega| stays under `quietRate` for `minAddressS`.
 *              The mean gyro reading in that window is the bias.
 *  2. SWING    smoothed |omega| leaves the quiet band. We keep every sample.
 *  3. PEAK     |omega| passed a peak >= `minPeakRate` and fell to 60% of it.
 *              That is just after impact, so the result arrives ~0.1 s after
 *              the ball would have been struck.
 *  4. ANALYSE  find the swing-plane axis n (dominant axis of omega), project
 *              omega onto it to get a signed scalar s(t), split s into lobes.
 *              A swing is exactly [negative lobe = backswing][positive lobe =
 *              downswing], the downswing faster and shorter. Anything else
 *              (shake: many lobes of equal size; put-down: one lobe;
 *              walking: never gets quiet) is rejected with a reason.
 *  5. OUTPUT   speed = peak |omega| * radius; tempo = backswing time /
 *              downswing time; face angle = twist about the shaft axis of
 *              the gyro-integrated rotation from address to impact.
 */
export interface GolfOptions {
  /** Assumed pivot-to-clubhead radius in metres (arm + club). Calibrate per player. */
  radius?: number;
  /** Which device axis runs along the grip/shaft: 0 = x, 1 = y (long edge, default), 2 = z. */
  shaftAxis?: 0 | 1 | 2;
  /** Smoothed |omega| below this (rad/s) counts as holding still. */
  quietRate?: number;
  /** How long it must be still before a swing is armed. */
  minAddressS?: number;
  /** Downswing peak must reach this (rad/s) to be a swing. */
  minPeakRate?: number;
  /** A swing that never finishes within this many seconds is dropped. */
  maxSwingS?: number;
  /** Gyro full-scale per axis (rad/s); readings at or above are flagged saturated. */
  saturationRate?: number;
  /** Quiet this long ends a swing that never produced a peak (must outlast the pause at the top of a slow backswing). */
  endHoldS?: number;
  /** Extrapolate lobe onsets (see analyse). false = plain 8% threshold crossings. */
  extrapolateOnset?: boolean;
}

export interface GolfSwingEvent {
  type: "golf-swing";
  /** Time of the estimated impact (s, sample clock). */
  t: number;
  /** Peak angular speed |omega| at impact, rad/s. */
  peakRate: number;
  /** Clubhead-ish speed: peakRate * radius. */
  clubSpeed: number;
  clubSpeedMph: number;
  /** Backswing duration / downswing duration. 3.0 is the textbook tour tempo. */
  tempo: number;
  backswingS: number;
  downswingS: number;
  /** Signed twist about the shaft axis at impact relative to address, degrees. + = right-handed about the +shaft axis. */
  faceAngleDeg: number;
  /** Share of the swing's rotation energy in a single plane, 0..1. */
  planarity: number;
  /** True when the gyro hit full scale, so the speed is a lower bound. */
  saturated: boolean;
  radius: number;
}

interface Entry {
  t: number;
  w: Vec3;
}

interface Run {
  sign: 1 | -1;
  start: number;
  end: number;
  peakAbs: number;
  peakIdx: number;
}

type Analysis =
  | { ok: true; event: Omit<GolfSwingEvent, "type" | "radius" | "clubSpeed" | "clubSpeedMph"> }
  | { ok: false; reason: string; incomplete?: boolean; detail?: string };

const MPH = 2.2369362920544;

export function createGolfDetector(options: GolfOptions = {}): Detector<MotionSample, GolfSwingEvent> {
  const o = {
    radius: options.radius ?? 1.4,
    shaftAxis: options.shaftAxis ?? 1,
    quietRate: options.quietRate ?? 0.7,
    minAddressS: options.minAddressS ?? 0.3,
    minPeakRate: options.minPeakRate ?? 6,
    maxSwingS: options.maxSwingS ?? 4,
    saturationRate: options.saturationRate ?? 34,
    endHoldS: options.endHoldS ?? 0.9,
    extrapolateOnset: options.extrapolateOnset ?? true,
  };

  let buf: Entry[] = [];
  let phase: "idle" | "armed" | "swing" = "idle";
  let sm = 0;
  let lastT: number | null = null;
  let quietStart: number | null = null;
  let bias: Vec3 = [0, 0, 0];
  let startIdx = 0;
  let swingStartT = 0;
  let maxMag = 0;
  let maxMagT = 0;
  let lowStart: number | null = null;
  let swingPeak = 0;

  function toIdle(withQuietFrom: number | null) {
    phase = "idle";
    quietStart = withQuietFrom;
    maxMag = 0;
    swingPeak = 0;
    lowStart = null;
  }

  function reset() {
    buf = [];
    sm = 0;
    lastT = null;
    toIdle(null);
  }

  function windowMean(t0: number): Vec3 {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = buf.length - 1; i >= 0 && buf[i].t >= t0; i--) {
      sx += buf[i].w[0]; sy += buf[i].w[1]; sz += buf[i].w[2]; n++;
    }
    return n ? [sx / n, sy / n, sz / n] : [0, 0, 0];
  }

  function analyse(from: number): Analysis {
    const seg = buf.slice(from);
    const wc: Vec3[] = seg.map((e) => [e.w[0] - bias[0], e.w[1] - bias[1], e.w[2] - bias[2]]);
    const mags = wc.map(norm);
    let imax = 0;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[imax]) imax = i;

    const n = dominantAxis(wc, wc[imax]);
    let s = wc.map((w) => dot(w, n));
    // The downswing is the fastest lobe: orient the axis so it is positive.
    let sMax = -Infinity, sMin = Infinity;
    for (const v of s) { if (v > sMax) sMax = v; if (v < sMin) sMin = v; }
    if (-sMin > sMax) {
      s = s.map((v) => -v);
      [sMax, sMin] = [-sMin, -sMax];
    }
    const p = s.indexOf(sMax);
    const peak = sMax;
    if (peak < o.minPeakRate * 0.7) return { ok: false, reason: "too-slow", detail: `${peak.toFixed(1)} rad/s` };

    // Sign runs above a noise-and-size threshold, merging same-sign neighbours.
    const thr = Math.max(0.05 * peak, 0.5);
    const raw: Run[] = [];
    for (let i = 0; i < s.length; i++) {
      const sign: 0 | 1 | -1 = s[i] >= thr ? 1 : s[i] <= -thr ? -1 : 0;
      if (sign === 0) continue;
      const last = raw[raw.length - 1];
      if (last && last.sign === sign) {
        last.end = i;
        if (Math.abs(s[i]) > last.peakAbs) { last.peakAbs = Math.abs(s[i]); last.peakIdx = i; }
      } else {
        raw.push({ sign, start: i, end: i, peakAbs: Math.abs(s[i]), peakIdx: i });
      }
    }
    // Hand tremor and takeaway wobble are not lobes: drop runs too small to be a swing phase.
    const minLobe = Math.max(0.08 * peak, 0.8);
    const runs: Run[] = [];
    for (const run of raw) {
      if (run.peakAbs < minLobe) continue;
      const last = runs[runs.length - 1];
      if (last && last.sign === run.sign) {
        last.end = run.end;
        if (run.peakAbs > last.peakAbs) { last.peakAbs = run.peakAbs; last.peakIdx = run.peakIdx; }
      } else {
        runs.push({ ...run });
      }
    }
    const r = runs.findIndex((run) => p >= run.start && p <= run.end);
    if (r < 0) return { ok: false, reason: "no-peak-run" };
    if (r === 0) return { ok: false, reason: "no-backswing", incomplete: true };
    if (r > 1) return { ok: false, reason: "multi-lobe", detail: `${r} lobes before the downswing` };
    const back = runs[0];
    if (back.sign !== -1) return { ok: false, reason: "no-backswing" };
    const backPeak = back.peakAbs;
    if (backPeak / peak > 0.85) return { ok: false, reason: "symmetric", detail: "backswing as fast as downswing" };

    // Impact time: vertex of a parabola fitted to the top of the downswing lobe.
    const tp = seg[p].t;
    let tImpact = tp;
    {
      let n0 = 0, sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
      for (let j = Math.max(0, p - 5); j <= Math.min(s.length - 1, p + 5); j++) {
        if (s[j] < 0.8 * peak) continue;
        const x = seg[j].t - tp, y = s[j];
        n0++; sx += x; sx2 += x * x; sx3 += x ** 3; sx4 += x ** 4; sy += y; sxy += x * y; sx2y += x * x * y;
      }
      if (n0 >= 4) {
        // Solve [n sx sx2; sx sx2 sx3; sx2 sx3 sx4] [a b c]^T = [sy sxy sx2y]^T by Cramer's rule.
        const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
        const M = [n0, sx, sx2, sx, sx2, sx3, sx2, sx3, sx4];
        const d = det3(M);
        if (Math.abs(d) > 1e-18) {
          const bNum = det3([n0, sy, sx2, sx, sxy, sx3, sx2, sx2y, sx4]);
          const cNum = det3([n0, sx, sy, sx, sx2, sxy, sx2, sx3, sx2y]);
          const bb = bNum / d, cc = cNum / d;
          if (cc < 0) tImpact = tp + clamp(-bb / (2 * cc), -0.05, 0.05);
        }
      }
    }

    // Lobe edges. Threshold crossings at a few percent of a lobe's own peak
    // would eat the slow start of the lobe and bias the tempo low, so by
    // default the onset is extrapolated from the 15% and 50% crossings assuming
    // a quadratic start (sqrt of rate linear in time). This is a model of an
    // idealised swing: check it against real recordings.
    const crossing = (v: number[], peakIdx: number, dir: -1 | 1, lo: number, hi: number, frac: number): number => {
      const lobePeak = v[peakIdx];
      let i = peakIdx;
      while (i + dir >= lo && i + dir <= hi && v[i + dir] >= frac * lobePeak) i += dir;
      const j = i + dir;
      if (j < lo || j > hi) return seg[i].t;
      const u = (v[i] - frac * lobePeak) / (v[i] - v[j] || 1);
      return seg[i].t + u * (seg[j].t - seg[i].t);
    };
    const edge = (v: number[], peakIdx: number, dir: -1 | 1, lo: number, hi: number): number => {
      if (!o.extrapolateOnset) return crossing(v, peakIdx, dir, lo, hi, 0.08);
      const t1 = crossing(v, peakIdx, dir, lo, hi, 0.15);
      const t2 = crossing(v, peakIdx, dir, lo, hi, 0.5);
      const k = Math.sqrt(0.15) / (Math.sqrt(0.5) - Math.sqrt(0.15));
      return t1 + (t1 - t2) * k;
    };
    const negS = s.map((v) => -v);
    const tBackStart = Math.max(seg[0].t, edge(negS, back.peakIdx, -1, 0, back.peakIdx));
    const tBackEnd = edge(negS, back.peakIdx, 1, back.peakIdx, p);
    const tDownStart = edge(s, p, -1, back.peakIdx, p);
    const tTop = (tBackEnd + tDownStart) / 2;
    const backswingS = tTop - tBackStart;
    const downswingS = tImpact - tTop;
    if (backswingS < 0.25 || backswingS > 2.6) return { ok: false, reason: "backswing-duration", detail: `${backswingS.toFixed(2)} s` };
    if (downswingS < 0.07 || downswingS > 1.0) return { ok: false, reason: "downswing-duration", detail: `${downswingS.toFixed(2)} s` };
    const tempo = backswingS / downswingS;
    if (tempo < 1.1 || tempo > 8) return { ok: false, reason: "tempo", detail: `${tempo.toFixed(1)}:1` };

    // Planarity: how much of the rotation energy is in the plane axis.
    let eAxis = 0, eAll = 0;
    for (let i = back.start; i <= p; i++) { eAxis += s[i] * s[i]; eAll += mags[i] * mags[i]; }
    const planarity = eAll > 0 ? eAxis / eAll : 0;
    if (planarity < 0.5) return { ok: false, reason: "non-planar", detail: `${(planarity * 100).toFixed(0)}% in plane` };

    // Peak |omega| near the impact (3-point max keeps one noisy sample from deciding it).
    let peakRate = 0;
    for (let i = Math.max(0, p - 1); i <= Math.min(mags.length - 1, p + 1); i++) peakRate = Math.max(peakRate, mags[i]);

    // Face angle: integrate the rotation from address to the peak sample, take
    // the twist about the shaft, then carry it to the refined impact time.
    let q = qIdentity();
    for (let i = 1; i <= p; i++) {
      const dt = safeDt(seg[i].t - seg[i - 1].t);
      const wm: Vec3 = [(wc[i][0] + wc[i - 1][0]) / 2, (wc[i][1] + wc[i - 1][1]) / 2, (wc[i][2] + wc[i - 1][2]) / 2];
      q = qNormalize(qMul(q, qFromRotVec(scale(wm, dt))));
    }
    const faceAngleDeg = ((qTwist(q, o.shaftAxis) + wc[p][o.shaftAxis] * (tImpact - tp)) * 180) / Math.PI;

    let saturated = false;
    for (const e of seg) if (Math.max(Math.abs(e.w[0]), Math.abs(e.w[1]), Math.abs(e.w[2])) >= o.saturationRate) saturated = true;

    return {
      ok: true,
      event: { t: tImpact, peakRate, tempo, backswingS, downswingS, faceAngleDeg, planarity, saturated },
    };
  }

  function push(sample: MotionSample): DetectorOutput<GolfSwingEvent>[] {
    const out: DetectorOutput<GolfSwingEvent>[] = [];
    const w = sample.gyro;
    const t = sample.t;
    const dt = lastT === null ? 0.016 : safeDt(t - lastT);
    lastT = t;
    const mag = norm(w);
    sm += emaAlpha(dt, 0.08) * (mag - sm);
    buf.push({ t, w });
    while (buf.length > 2 && t - buf[0].t > 9) { buf.shift(); startIdx = Math.max(0, startIdx - 1); }

    if (phase === "idle") {
      if (sm < o.quietRate) {
        quietStart ??= t;
        if (t - quietStart >= o.minAddressS) {
          phase = "armed";
          bias = windowMean(t - o.minAddressS);
        }
      } else {
        quietStart = null;
      }
      return out;
    }

    if (phase === "armed") {
      if (sm < o.quietRate) {
        bias = windowMean(t - o.minAddressS);
        return out;
      }
      // Motion started. Keep up to 0.8 s of the quiet that preceded it (but no
      // further back than where the quiet began): slow swings leave the
      // quiet band long after the club actually starts moving, and the lobe
      // onset is extrapolated from data before the trigger.
      const from = Math.max(quietStart ?? t - 0.8, t - 0.8);
      let i = buf.length - 1;
      while (i > 0 && buf[i - 1].t >= from) i--;
      startIdx = i;
      swingStartT = buf[i].t;
      phase = "swing";
      maxMag = 0;
      swingPeak = 0;
      lowStart = null;
    }

    // phase === "swing"
    const d = norm([w[0] - bias[0], w[1] - bias[1], w[2] - bias[2]]);
    swingPeak = Math.max(swingPeak, d);
    if (d > maxMag) { maxMag = d; maxMagT = t; }

    if (maxMag >= o.minPeakRate && d < 0.6 * maxMag && t - maxMagT >= 0.05) {
      const res = analyse(startIdx);
      if (res.ok) {
        const e = res.event;
        out.push({
          kind: "event",
          event: {
            type: "golf-swing",
            ...e,
            clubSpeed: e.peakRate * o.radius,
            clubSpeedMph: e.peakRate * o.radius * MPH,
            radius: o.radius,
          },
        });
        toIdle(null);
      } else if (res.incomplete) {
        // Probably the backswing's own peak: keep listening for the real one.
        maxMag = 0;
      } else {
        out.push({ kind: "reject", t, gesture: "golf", reason: res.reason, detail: res.detail });
        toIdle(null);
      }
      return out;
    }

    if (sm < o.quietRate) {
      lowStart ??= t;
      if (t - lowStart >= o.endHoldS) {
        if (swingPeak >= 2) {
          out.push({ kind: "reject", t, gesture: "golf", reason: "too-weak", detail: `peak ${swingPeak.toFixed(1)} rad/s` });
        }
        toIdle(lowStart);
      }
    } else {
      lowStart = null;
    }
    if (phase === "swing" && t - swingStartT > o.maxSwingS) {
      if (swingPeak >= 2) out.push({ kind: "reject", t, gesture: "golf", reason: "too-long" });
      toIdle(null);
    }
    return out;
  }

  return { push, reset };
}
