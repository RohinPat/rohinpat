// Samples in, a display pose out:
//   Euler -> quaternion -> screen-rotation fix -> calibrate -> one-euro filter
//   -> predict forward by the sample's age -> soft clamp.
// Everything is a quaternion from the first step, so passing 90 degrees of pitch
// (where alpha and gamma go wild) is just another smooth rotation.
import { Calibrator } from "./calibration";
import { QuatOneEuro, OneEuroParams } from "./oneEuro";
import {
  ClampConfig,
  Conventions,
  DEFAULT_CLAMP,
  OrientSample,
  SPEC_CONVENTIONS,
  sampleToQuat,
  softClamp,
} from "./orientation";
import { Quat, qAngleBetween, qExp, qIdentity, qMul, qSlerp, qSameHemisphere } from "./quat";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface PipelineConfig {
  conventions: Conventions;
  clamp: ClampConfig;
  filter: OneEuroParams;
  /** extrapolate the filtered pose forward by the age of the newest sample */
  predict: boolean;
  /** ms added on top of the sample age: one frame of display latency */
  lookaheadMs: number;
  /**
   * 0..1: also extrapolate by this fraction of the filter's own time constant
   * (1 / (2 pi cutoff)), cancelling the lag the smoothing adds on a sweep.
   * Costs some of the smoothing at rest, so it is a dial, not a free lunch.
   */
  lagCompensation: number;
  /** never lead the filtered pose by more than this many radians (bounds overshoot when a move stops dead) */
  maxLead: number;
  /** a stream quiet for longer than this (ms) starts losing its extrapolation, fully gone at 3x */
  quietMs: number;
  /** never extrapolate further than this (stalled stream) */
  maxExtrapolateMs: number;
  calibrationSamples: number;
}

export const DEFAULT_PIPELINE: PipelineConfig = {
  conventions: SPEC_CONVENTIONS,
  clamp: DEFAULT_CLAMP,
  filter: { minCutoff: 1.6, beta: 4, dCutoff: 6 },
  predict: true,
  lookaheadMs: 8,
  lagCompensation: 0.8,
  maxLead: 3 * (Math.PI / 180),
  quietMs: 30,
  maxExtrapolateMs: 60,
  calibrationSamples: 6,
};

export interface Pose {
  /** displayed rotation, device frame, after prediction and clamp */
  q: Quat;
  /** calibrated, filtered, un-clamped (no prediction) */
  filtered: Quat;
  /** calibrated, un-filtered, un-clamped */
  raw: Quat;
  calibrated: boolean;
  /** how far ahead of the newest sample we extrapolated, ms */
  extrapolatedMs: number;
  /** filter cutoff on the last step, Hz */
  cutoffHz: number;
  /** angular speed, rad/s */
  speed: number;
}

export class OrientationPipeline {
  cfg: PipelineConfig;
  private calib: Calibrator;
  private filter: QuatOneEuro;
  private prevAdj: Quat | null = null;
  /** the last few device orientations (screen-adjusted), so re-centring needs no new samples */
  private recent: { q: Quat; t: number }[] = [];
  private prevRel: Quat = qIdentity();
  private screenAngle: number | null = null;
  private lastT = 0;
  private calibLastT = 0;
  private lastPose: Quat = qIdentity();
  // ease from the old display to the new neutral after a recalibration
  private easeFrom: Quat | null = null;
  private easeStart = 0;
  static EASE_MS = 280;

  constructor(cfg: Partial<PipelineConfig> = {}) {
    this.cfg = { ...DEFAULT_PIPELINE, ...cfg };
    this.calib = new Calibrator(this.cfg.calibrationSamples);
    this.filter = new QuatOneEuro(this.cfg.filter);
  }

  get calibrated(): boolean {
    return this.calib.done;
  }
  get calibrationProgress(): number {
    return this.calib.progress;
  }
  get neutral(): Quat | null {
    return this.calib.neutral;
  }

  /** Change settings live (filter params apply to the next sample). */
  configure(patch: Partial<PipelineConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    if (patch.filter) this.filter.params = patch.filter;
    if (patch.calibrationSamples) this.calib.samples = patch.calibrationSamples;
  }

  /**
   * Adopt the current pose as neutral. Uses the last few samples we already have,
   * so it works on a phone held perfectly still (Chrome sends nothing then), and
   * keeps the display easing rather than snapping.
   */
  recalibrate(nowMs = 0): void {
    this.easeFrom = this.lastPose;
    this.easeStart = nowMs;
    this.calib.reset();
    this.filter.reset();
    if (this.recent.length > 0) {
      // The newest sample is the current pose. Average it with recent neighbours only if
      // they are essentially the same pose (a still hand), never across a move.
      const newest = this.recent[this.recent.length - 1];
      const near = this.recent.filter((r) => newest.t - r.t <= 150 && qAngleBetween(r.q, newest.q) < 1.5 * (Math.PI / 180));
      this.calib.seed(near.map((r) => r.q));
      this.onCalibrated(nowMs);
    }
  }

  /** A new connection: forget everything about the old one, then wait for fresh samples. */
  reset(nowMs = 0): void {
    this.recent = [];
    this.prevAdj = null;
    this.recalibrate(nowMs);
  }

  /** tMs: the sample's time on the local clock (ms). */
  push(sample: OrientSample, tMs: number): void {
    if (this.screenAngle !== null && sample.screenAngle !== this.screenAngle) {
      // the UI rotated under us: the old neutral is meaningless, take a new one
      this.screenAngle = sample.screenAngle;
      this.reset(tMs);
    }
    this.screenAngle = sample.screenAngle;

    let q = sampleToQuat(sample, this.cfg.conventions);
    if (this.prevAdj) q = qSameHemisphere(q, this.prevAdj);
    this.prevAdj = q;
    this.recent.push({ q, t: tMs });
    if (this.recent.length > 8) this.recent.shift();

    if (!this.calib.done) {
      this.calibLastT = tMs;
      this.calib.push(q);
      if (!this.calib.done) return;
      this.onCalibrated(tMs);
    }

    const rel = qSameHemisphere(this.calib.relative(q), this.prevRel);
    this.prevRel = rel;
    this.filter.filter(rel, tMs / 1000);
    this.lastT = tMs;
  }

  private onCalibrated(tMs: number): void {
    // the relative pose is identity by construction
    this.prevRel = qIdentity();
    this.filter.reset();
    this.filter.filter(qIdentity(), tMs / 1000);
    this.lastT = tMs;
    if (this.easeFrom) this.easeStart = tMs;
  }

  /** The pose to draw at local time nowMs. Call once per frame. */
  pose(nowMs: number): Pose {
    // a phone held dead still sends too few samples to fill the calibration window
    if (!this.calib.done && this.calib.count > 0 && nowMs - this.calibLastT > 150 && this.calib.finalize()) {
      this.onCalibrated(nowMs);
    }
    // Chrome only fires deviceorientation when an angle moves by >= 0.1 degree,
    // so a held-still phone sends nothing. Keep feeding the last known pose to the
    // filter at draw time so it converges instead of freezing a little short.
    if (this.calib.done && this.filter.value && nowMs - this.lastT > this.cfg.quietMs && nowMs - this.filter.lastTime * 1000 > 20) {
      this.filter.filter(this.prevRel, nowMs / 1000, Infinity);
    }
    const filtered = this.filter.value;
    if (!this.calib.done || !filtered) {
      // while re-calibrating, hold the last displayed pose rather than snapping flat
      const hold = this.easeFrom ?? qIdentity();
      return { q: hold, filtered: hold, raw: qIdentity(), calibrated: false, extrapolatedMs: 0, cutoffHz: 0, speed: 0 };
    }
    const v = this.filter.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    let ahead = 0;
    let q = filtered;
    if (this.cfg.predict) {
      const rawAge = Math.max(0, nowMs - this.lastT);
      const age = Math.min(rawAge, this.cfg.maxExtrapolateMs);
      // a stream that has gone quiet (dropped packets) gets no more guessing
      const taper = 1 - smoothstep(this.cfg.quietMs, this.cfg.quietMs * 3, rawAge);
      const tau = 1000 / (2 * Math.PI * Math.max(0.1, this.filter.cutoff));
      // gate by speed: at rest the velocity estimate is mostly sensor noise, and
      // extrapolating noise would undo the smoothing
      const gate = smoothstep(0.08, 0.5, speed);
      ahead = (age + this.cfg.lookaheadMs + this.cfg.lagCompensation * tau) * gate * taper;
      let s = ahead / 1000;
      if (speed * s > this.cfg.maxLead) s = this.cfg.maxLead / speed;
      q = qMul(filtered, qExp({ x: v.x * s, y: v.y * s, z: v.z * s }));
      ahead = s * 1000;
    }
    let out = softClamp(q, this.cfg.clamp);
    if (this.easeFrom) {
      const t = (nowMs - this.easeStart) / OrientationPipeline.EASE_MS;
      if (t >= 1) this.easeFrom = null;
      else {
        const e = t <= 0 ? 0 : t * t * (3 - 2 * t);
        out = qSlerp(this.easeFrom, out, e);
      }
    }
    this.lastPose = out;
    return {
      q: out,
      filtered,
      raw: this.prevRel,
      calibrated: true,
      extrapolatedMs: ahead,
      cutoffHz: this.filter.cutoff,
      speed,
    };
  }
}
