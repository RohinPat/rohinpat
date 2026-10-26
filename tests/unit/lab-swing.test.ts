import { afterAll, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import {
  OrientationFilter,
  accelSignVote,
  createAccelSignDetector,
  createFlickDetector,
  createGolfDetector,
  createSwipeTracker,
  createTiltFilter,
  createTwistFilter,
  eventsOf,
  flipAccel,
  motionSampleFromEvent,
  recogniseSwipe,
  runDetector,
  samplesFromRecording,
  rowFromSample,
  AXES_NOTE,
} from "../../lib/motion";
import type { MotionSample, RecordingFile } from "../../lib/motion";
import {
  CONFOUNDERS,
  genConfounder,
  genFlick,
  genGolf,
  genStill,
  genSwipe,
  genSwipeConfounder,
  genTilt,
  genTwist,
  mulberry32,
} from "./lab-swing-traces";

// these sweeps simulate hundreds of traces; under a full parallel run they
// can pass 5 s, so give the whole file room
vi.setConfig({ testTimeout: 30_000 });

// ---------------------------------------------------------------- helpers
const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const median = (xs: number[]) => quantile(xs, 0.5);
const abs = (xs: number[]) => xs.map(Math.abs);
function ranks(xs: number[]) {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  idx.forEach(([, i], k) => (r[i] = k));
  return r;
}
function spearman(a: number[], b: number[]) {
  const ra = ranks(a), rb = ranks(b);
  const n = a.length;
  const ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; }
  return num / Math.sqrt(da * db);
}
const D2R = Math.PI / 180;

// Numbers collected for the report; printed once at the end.
const M: Record<string, string | number> = {};
const put = (k: string, v: number | string, digits = 3) => { M[k] = typeof v === "number" ? Number(v.toFixed(digits)) : v; };

afterAll(() => {
  const lines = Object.entries(M).map(([k, v]) => `${k.padEnd(52)} ${v}`);
  // eslint-disable-next-line no-console
  console.log("\n=== swing lab metrics ===\n" + lines.join("\n") + "\n");
  const out = process.env.SWING_METRICS_PATH;
  if (out) {
    writeFileSync(out, JSON.stringify(M, null, 2));
  }
});

const N = 200; // positive trials per gesture
const NF = 100; // trials per confounder

// ---------------------------------------------------------------- the generator itself
describe("synthetic generator sanity", () => {
  it("a still phone reports 1 g pointing up and ~zero rotation", () => {
    const s = genStill(1, 3, { held: false });
    const mags = s.map((x) => Math.hypot(...x.acc));
    expect(Math.abs(median(mags) - 9.80665)).toBeLessThan(0.25);
    expect(median(s.map((x) => Math.hypot(...x.gyro)))).toBeLessThan(0.05);
    expect(s.length).toBeGreaterThan(170);
    expect(s.length).toBeLessThan(185);
  });

  it("the golf generator's gyro peak matches its own physics truth", () => {
    const errs: number[] = [];
    for (let i = 1; i <= 30; i++) {
      const { samples, truth } = genGolf(i);
      const peak = Math.max(...samples.map((x) => Math.hypot(...x.gyro)));
      errs.push(Math.abs(peak - truth.peakRate) / truth.peakRate);
    }
    // 60 Hz sampling of a sharp peak undershoots a little; it must not be wildly off.
    expect(median(errs)).toBeLessThan(0.05);
  });

  it("the orientation filter recovers gravity direction from generated traces", () => {
    const { samples } = genFlick(3);
    const f = new OrientationFilter();
    for (const s of samples.slice(0, 40)) f.update(s);
    const up = f.up();
    const a = samples[39].acc;
    const n = Math.hypot(...a);
    const dot = (up[0] * a[0] + up[1] * a[1] + up[2] * a[2]) / n;
    // 0.67 s in, within a few degrees of the true gravity direction despite hand-shake noise
    expect(dot).toBeGreaterThan(0.99);
  });
});

// ---------------------------------------------------------------- conversions
describe("sample conversion and recordings", () => {
  it("maps DeviceMotion fields: beta -> x, gamma -> y, alpha -> z, degrees -> radians", () => {
    const s = motionSampleFromEvent(
      {
        accelerationIncludingGravity: { x: 0.1, y: 9.7, z: 1.2 },
        acceleration: { x: null, y: null, z: null },
        rotationRate: { alpha: 90, beta: 180, gamma: 45 },
      },
      12.5,
      { alpha: 1, beta: 2, gamma: 3 }
    )!;
    expect(s.gyro[0]).toBeCloseTo(Math.PI, 6);
    expect(s.gyro[1]).toBeCloseTo(Math.PI / 4, 6);
    expect(s.gyro[2]).toBeCloseTo(Math.PI / 2, 6);
    expect(s.lin).toBeUndefined();
    expect(s.orient).toEqual({ alpha: 1, beta: 2, gamma: 3 });
  });

  it("returns null for the empty event desktop browsers fire", () => {
    expect(motionSampleFromEvent({ accelerationIncludingGravity: null, acceleration: null, rotationRate: null }, 0)).toBeNull();
    expect(
      motionSampleFromEvent({ accelerationIncludingGravity: { x: null, y: null, z: null }, acceleration: null, rotationRate: { alpha: 0, beta: 0, gamma: 0 } }, 0)
    ).toBeNull();
  });

  it("a recording round-trips through the file format and replays to the same detection", () => {
    const { samples } = genGolf(7);
    const t0 = samples[0].t;
    const file: RecordingFile = {
      format: "swing-lab-recording",
      version: 1,
      label: "golf-swing",
      note: "",
      userAgent: "test",
      accelSign: 1,
      rateHz: 60,
      axes: AXES_NOTE,
      durationMs: 1,
      samples: samples.map((s) => rowFromSample(s, t0)),
    };
    const replay = samplesFromRecording(JSON.parse(JSON.stringify(file)));
    const a = eventsOf(runDetector(createGolfDetector(), samples));
    const b = eventsOf(runDetector(createGolfDetector(), replay));
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    // Rounding to 1 mdeg/s and 1 ms moves nothing that matters.
    expect(b[0].peakRate).toBeCloseTo(a[0].peakRate, 2);
    expect(b[0].tempo).toBeCloseTo(a[0].tempo, 1);
    expect(b[0].faceAngleDeg).toBeCloseTo(a[0].faceAngleDeg, 0);
  });

  it("detects an inverted accelerometer from DeviceOrientation and corrects it", () => {
    const { samples } = genFlick(5);
    const flipped = samples.map(flipAccel);
    const spec = createAccelSignDetector();
    const inv = createAccelSignDetector();
    for (const s of samples.slice(0, 80)) spec.add(s);
    for (const s of flipped.slice(0, 80)) inv.add(s);
    expect(spec.sign()).toBe(1);
    expect(inv.sign()).toBe(-1);
    expect(accelSignVote(samples[10].acc, samples[10].orient!)).toBeGreaterThan(0.95);
    expect(accelSignVote(flipped[10].acc, flipped[10].orient!)).toBeLessThan(-0.95);
    // and the flip is exactly undone, so recognisers see the same stream
    const back = flipped.map(flipAccel);
    expect(back[10].acc[2]).toBeCloseTo(samples[10].acc[2], 9);
  });
});

// ---------------------------------------------------------------- golf
describe("golf swing recogniser", () => {
  it("detects real-looking swings and measures them", () => {
    let hit = 0, dupes = 0;
    const speedErr: number[] = [], tempoErr: number[] = [], tempoSigned: number[] = [], faceErr: number[] = [], timeErr: number[] = [];
    const ratios: number[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const { samples, truth } = genGolf(seed);
      const ev = eventsOf(runDetector(createGolfDetector(), samples));
      if (ev.length > 1) dupes++;
      if (ev.length === 0) continue;
      hit++;
      const e = ev[0];
      speedErr.push(Math.abs(e.peakRate - truth.peakRate) / truth.peakRate);
      tempoErr.push(Math.abs(e.tempo - truth.tempo) / truth.tempo);
      tempoSigned.push((e.tempo - truth.tempo) / truth.tempo);
      faceErr.push(Math.abs(e.faceAngleDeg - truth.faceDeg));
      timeErr.push(e.t - truth.tImpact);
      expect(e.clubSpeed).toBeCloseTo(e.peakRate * 1.4, 9);
      ratios.push(e.peakRate / truth.peakRate);
    }
    put("golf.recall", hit / N);
    put("golf.duplicateEvents", dupes);
    put("golf.speedRelErr.median", median(speedErr));
    put("golf.speedRelErr.p95", quantile(speedErr, 0.95));
    put("golf.tempoRelErr.median", median(tempoErr));
    put("golf.tempoRelErr.p90", quantile(tempoErr, 0.9));
    put("golf.tempoBias.median(signed)", median(tempoSigned));
    put("golf.faceErrDeg.median", median(faceErr));
    put("golf.faceErrDeg.p90", quantile(faceErr, 0.9));
    put("golf.impactTimeErrMs.medianSigned", median(timeErr) * 1000, 1);
    put("golf.impactTimeErrMs.p95Abs", quantile(abs(timeErr), 0.95) * 1000, 1);
    expect(hit / N).toBeGreaterThanOrEqual(0.97);
    expect(dupes).toBe(0);
    expect(median(speedErr)).toBeLessThan(0.03);
    expect(quantile(speedErr, 0.95)).toBeLessThan(0.08);
    expect(median(tempoErr)).toBeLessThan(0.12);
    expect(quantile(tempoErr, 0.9)).toBeLessThan(0.22);
    expect(median(faceErr)).toBeLessThan(6);
    expect(quantile(faceErr, 0.9)).toBeLessThan(14);
  });

  it("scales clubhead speed with the radius you give it", () => {
    const { samples } = genGolf(11);
    const a = eventsOf(runDetector(createGolfDetector({ radius: 1.0 }), samples))[0];
    const b = eventsOf(runDetector(createGolfDetector({ radius: 2.0 }), samples))[0];
    expect(b.clubSpeed / a.clubSpeed).toBeCloseTo(2, 6);
    expect(a.clubSpeedMph).toBeCloseTo(a.clubSpeed * 2.23694, 3);
  });

  it("orders swings by speed (what a golf game needs)", () => {
    const truth: number[] = [], got: number[] = [];
    for (let seed = 1; seed <= 80; seed++) {
      const { samples, truth: t } = genGolf(1000 + seed);
      const e = eventsOf(runDetector(createGolfDetector(), samples))[0];
      if (!e) continue;
      truth.push(t.peakRate);
      got.push(e.clubSpeed);
    }
    const rho = spearman(truth, got);
    put("golf.speedRankCorrelation", rho);
    expect(rho).toBeGreaterThan(0.98);
  });

  it("tempo ranks swings correctly even though it reads low", () => {
    const truth: number[] = [], got: number[] = [];
    for (let seed = 1; seed <= 100; seed++) {
      const { samples, truth: t } = genGolf(2000 + seed);
      const e = eventsOf(runDetector(createGolfDetector(), samples))[0];
      if (!e) continue;
      truth.push(t.tempo);
      got.push(e.tempo);
    }
    const rho = spearman(truth, got);
    put("golf.tempoRankCorrelation", rho);
    expect(rho).toBeGreaterThan(0.85);
  });

  it("reports face angle with the right sign and magnitude for clearly open/closed faces", () => {
    let right = 0, n = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { samples, truth } = genGolf(3000 + seed);
      if (Math.abs(truth.faceDeg) < 8) continue;
      const e = eventsOf(runDetector(createGolfDetector(), samples))[0];
      if (!e) continue;
      n++;
      if (Math.sign(e.faceAngleDeg) === Math.sign(truth.faceDeg)) right++;
    }
    put("golf.faceSignAgreement(|face|>=8deg)", right / n);
    expect(right / n).toBeGreaterThan(0.85);
  });

  it("never fires on confounders: walking, pocket, table bump, slow pick-up, put-down, shaking", () => {
    let total = 0, fp = 0;
    for (const kind of CONFOUNDERS) {
      let k = 0;
      for (let seed = 1; seed <= NF; seed++) {
        const ev = eventsOf(runDetector(createGolfDetector(), genConfounder(kind, 7000 + seed)));
        total++;
        k += ev.length > 0 ? 1 : 0;
      }
      put(`golf.falsePositives.${kind}`, `${k}/${NF}`);
      fp += k;
    }
    put("golf.falsePositives.total", `${fp}/${total}`);
    expect(fp).toBe(0);
  });

  it("copes with a waggle before the swing, up to a point", () => {
    for (const amp of [0.05, 0.1, 0.2]) {
      let hit = 0;
      const n = 60;
      for (let seed = 1; seed <= n; seed++) {
        const { samples } = genGolf(4000 + seed, { waggle: amp });
        if (eventsOf(runDetector(createGolfDetector(), samples)).length === 1) hit++;
      }
      put(`golf.recall.waggle${amp}rad`, hit / n);
      if (amp <= 0.1) expect(hit / n).toBeGreaterThan(0.9);
    }
  });

  it("model mismatch: swings with sharp-cornered (triangular) velocity profiles instead of smooth ones", () => {
    let hit = 0;
    const speedErr: number[] = [], tempoSigned: number[] = [], faceErr: number[] = [];
    const n = 100;
    for (let seed = 1; seed <= n; seed++) {
      const { samples, truth } = genGolf(10000 + seed, { profile: "triangle" });
      const e = eventsOf(runDetector(createGolfDetector(), samples))[0];
      if (!e) continue;
      hit++;
      speedErr.push(Math.abs(e.peakRate - truth.peakRate) / truth.peakRate);
      tempoSigned.push((e.tempo - truth.tempo) / truth.tempo);
      faceErr.push(Math.abs(e.faceAngleDeg - truth.faceDeg));
    }
    put("golf.triangleProfile.recall", hit / n);
    put("golf.triangleProfile.speedRelErr.median", median(speedErr));
    put("golf.triangleProfile.tempoBias.median(signed)", median(tempoSigned));
    put("golf.triangleProfile.tempoBias.p10", quantile(tempoSigned, 0.1));
    put("golf.triangleProfile.tempoBias.p90", quantile(tempoSigned, 0.9));
    put("golf.triangleProfile.faceErrDeg.median", median(faceErr));
    expect(hit / n).toBeGreaterThan(0.9);
    expect(median(speedErr)).toBeLessThan(0.05);
  });

  it("is not thrown by 3x the nominal hand tremor", () => {
    let hit = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { samples } = genGolf(5000 + seed, { tremor: 3 });
      if (eventsOf(runDetector(createGolfDetector(), samples)).length === 1) hit++;
    }
    put("golf.recall.tremorx3", hit / 60);
    expect(hit / 60).toBeGreaterThan(0.9);
  });

  it("works at other sensor rates", () => {
    for (const rate of [30, 50, 100, 200]) {
      let hit = 0;
      const sp: number[] = [];
      const n = 40;
      for (let seed = 1; seed <= n; seed++) {
        const { samples, truth } = genGolf(6000 + seed, {}, { rate });
        const e = eventsOf(runDetector(createGolfDetector(), samples))[0];
        if (e) { hit++; sp.push(Math.abs(e.peakRate - truth.peakRate) / truth.peakRate); }
      }
      put(`golf.recall.${rate}Hz`, hit / n);
      put(`golf.speedRelErr.median.${rate}Hz`, median(sp));
      expect(hit / n).toBeGreaterThan(rate <= 30 ? 0.75 : 0.9);
    }
  });

  it("flags a clipped gyro, and underestimates the speed it cannot see", () => {
    const { samples, truth } = genGolf(77, { Wp: 40 });
    const e = eventsOf(runDetector(createGolfDetector(), samples))[0];
    expect(e).toBeDefined();
    expect(e.saturated).toBe(true);
    put("golf.clippedSwing.reportedOverTrue", e.peakRate / truth.peakRate);
    expect(e.peakRate).toBeLessThan(truth.peakRate);
  });

  it("works for left-handed swings (mirrored rotation)", () => {
    let hit = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { samples } = genGolf(8000 + seed, { lefty: true });
      n++;
      if (eventsOf(runDetector(createGolfDetector(), samples)).length === 1) hit++;
    }
    expect(hit / n).toBeGreaterThan(0.95);
  });

  it("emits at most one event per swing and can swing again after reset", () => {
    const { samples } = genGolf(21);
    const det = createGolfDetector();
    const first = eventsOf(runDetector(det, samples));
    expect(first.length).toBe(1);
    det.reset();
    const second = eventsOf(runDetector(det, samples));
    expect(second.length).toBe(1);
  });

  it("reports back why it ignored a limp movement", () => {
    const out = runDetector(createGolfDetector(), genConfounder("put-down", 3));
    expect(eventsOf(out).length).toBe(0);
    expect(out.some((o) => o.kind === "reject")).toBe(true);
  });
});

// ---------------------------------------------------------------- flick
describe("flick-up recogniser", () => {
  it("detects flicks and measures power and aim", () => {
    let hit = 0, dupes = 0;
    const peakErr: number[] = [], impErr: number[] = [], aimErr: number[] = [], aimBlendErr: number[] = [];
    const truthImp: number[] = [], gotPower: number[] = [];
    let signOk = 0, signN = 0;
    for (let seed = 1; seed <= N; seed++) {
      const { samples, truth } = genFlick(seed);
      const ev = eventsOf(runDetector(createFlickDetector(), samples));
      if (ev.length > 1) dupes++;
      if (!ev.length) continue;
      hit++;
      const e = ev[0];
      peakErr.push(Math.abs(e.peakAccel - truth.peak) / truth.peak);
      impErr.push(Math.abs(e.impulse - truth.impulse) / truth.impulse);
      aimErr.push(Math.abs(e.lateralAimDeg - truth.aimDeg));
      aimBlendErr.push(Math.abs(e.aimDeg - truth.aimDeg));
      truthImp.push(truth.impulse);
      gotPower.push(e.power);
      if (Math.abs(truth.aimDeg) > 5) { signN++; if (Math.sign(e.aim) === Math.sign(truth.aimDeg)) signOk++; }
    }
    put("flick.recall", hit / N);
    put("flick.duplicateEvents", dupes);
    put("flick.peakAccelRelErr.median", median(peakErr));
    put("flick.impulseRelErr.median", median(impErr));
    put("flick.impulseRelErr.p95", quantile(impErr, 0.95));
    put("flick.aimLateralErrDeg.median", median(aimErr));
    put("flick.aimLateralErrDeg.p95", quantile(aimErr, 0.95));
    put("flick.aimBlendedWithYawErrDeg.median", median(aimBlendErr));
    put("flick.aimSignAgreement(|aim|>5deg)", signOk / signN);
    put("flick.powerRankCorrelation", spearman(truthImp, gotPower));
    expect(hit / N).toBeGreaterThanOrEqual(0.97);
    expect(dupes).toBe(0);
    expect(median(impErr)).toBeLessThan(0.05);
    expect(quantile(impErr, 0.95)).toBeLessThan(0.12);
    expect(median(aimErr)).toBeLessThan(2);
    expect(quantile(aimErr, 0.95)).toBeLessThan(5);
    expect(signOk / signN).toBeGreaterThan(0.98);
    expect(spearman(truthImp, gotPower)).toBeGreaterThan(0.97);
  });

  it("also works when the browser gives no gravity-free acceleration", () => {
    let hit = 0;
    const aimErr: number[] = [];
    const n = 100;
    for (let seed = 1; seed <= n; seed++) {
      const { samples, truth } = genFlick(300 + seed, {}, { hasLinear: false });
      const e = eventsOf(runDetector(createFlickDetector(), samples))[0];
      if (!e) continue;
      hit++;
      aimErr.push(Math.abs(e.lateralAimDeg - truth.aimDeg));
    }
    put("flick.recall.noLinearAccel", hit / n);
    put("flick.aimLateralErrDeg.median.noLinearAccel", median(aimErr));
    expect(hit / n).toBeGreaterThan(0.95);
    expect(median(aimErr)).toBeLessThan(4);
  });

  it("works at other sensor rates", () => {
    for (const rate of [30, 100]) {
      let hit = 0;
      const n = 60;
      for (let seed = 1; seed <= n; seed++) {
        const { samples } = genFlick(900 + seed, {}, { rate });
        if (eventsOf(runDetector(createFlickDetector(), samples)).length >= 1) hit++;
      }
      put(`flick.recall.${rate}Hz`, hit / n);
      expect(hit / n).toBeGreaterThan(rate <= 30 ? 0.8 : 0.95);
    }
  });

  it("false positives on confounders, by confirmation delay (latency vs precision)", () => {
    const table: Record<number, { total: number; fp: number; byKind: Record<string, number> }> = {};
    for (const delay of [0, 0.25, 0.5]) {
      const row = { total: 0, fp: 0, byKind: {} as Record<string, number> };
      for (const kind of CONFOUNDERS) {
        let k = 0;
        for (let seed = 1; seed <= NF; seed++) {
          const ev = eventsOf(runDetector(createFlickDetector({ confirmDelayS: delay }), genConfounder(kind, 9000 + seed)));
          row.total++;
          if (ev.length) k++;
        }
        row.byKind[kind] = k;
        row.fp += k;
      }
      table[delay] = row;
      put(`flick.falsePositives.delay${delay}s.total`, `${row.fp}/${row.total}`);
      put(`flick.falsePositives.delay${delay}s.byKind`, Object.entries(row.byKind).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(" ") || "none");
    }
    // The default (250 ms) must keep rhythmic motion and bumps out: at most 1% overall, and no shake gets through.
    expect(table[0.25].fp / table[0.25].total).toBeLessThanOrEqual(0.01);
    expect(table[0.25].byKind["shake"]).toBe(0);
    expect(table[0.25].byKind["shake-vertical"]).toBe(0);
    expect(table[0.25].byKind["table-bump"]).toBe(0);
    expect(table[0.25].byKind["walk-swing"]).toBe(0);
    // Waiting longer can only help.
    expect(table[0.5].fp).toBeLessThanOrEqual(table[0.25].fp);
    expect(table[0].fp).toBeGreaterThanOrEqual(table[0.25].fp);
  });

  it("cross-talk: a golf swing DOES look like a flick to this detector (known, so enable one recogniser per game)", () => {
    let fp = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { samples } = genGolf(9500 + seed);
      fp += eventsOf(runDetector(createFlickDetector(), samples)).length > 0 ? 1 : 0;
    }
    put("flick.firesOnGolfSwings(cross-talk)", `${fp}/60`);
    // Not a pass/fail quality bar: the golf swing's centripetal pull produces a big vertical pulse.
    // Pinned so a future change that fixes it (or breaks the premise) shows up here.
    expect(fp).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------- swipe
describe("curved swipe recogniser", () => {
  it("recovers direction, power and curl from touch paths", () => {
    let hit = 0;
    const dirErr: number[] = [], turnErr: number[] = [], spdErr: number[] = [];
    const truthSpeed: number[] = [], gotPower: number[] = [];
    let signOk = 0, signN = 0;
    for (let seed = 1; seed <= N * 2; seed++) {
      const { points, truth } = genSwipe(seed);
      const r = recogniseSwipe(points);
      if (r.kind !== "event") continue;
      hit++;
      const e = r.event;
      dirErr.push(Math.abs(e.direction - truth.direction) / D2R);
      turnErr.push(Math.abs(e.turnAngle - truth.turn) / D2R);
      spdErr.push(Math.abs(e.peakSpeed - truth.peakSpeed) / truth.peakSpeed);
      truthSpeed.push(truth.peakSpeed);
      gotPower.push(e.power);
      if (Math.abs(truth.turn) > 0.15) { signN++; if (Math.sign(e.curl) === Math.sign(truth.turn)) signOk++; }
    }
    put("swipe.recall", hit / (N * 2));
    put("swipe.directionErrDeg.median", median(dirErr));
    put("swipe.directionErrDeg.p95", quantile(dirErr, 0.95));
    put("swipe.turnAngleErrDeg.median", median(turnErr));
    put("swipe.turnAngleErrDeg.p95", quantile(turnErr, 0.95));
    put("swipe.peakSpeedRelErr.median", median(spdErr));
    put("swipe.curlSignAgreement(|turn|>0.15rad)", signOk / signN);
    put("swipe.powerRankCorrelation", spearman(truthSpeed, gotPower));
    expect(hit / (N * 2)).toBe(1);
    expect(median(dirErr)).toBeLessThan(0.5);
    expect(quantile(dirErr, 0.95)).toBeLessThan(2);
    expect(median(turnErr)).toBeLessThan(2);
    expect(quantile(turnErr, 0.95)).toBeLessThan(5);
    expect(median(spdErr)).toBeLessThan(0.08);
    expect(signOk / signN).toBe(1);
    expect(spearman(truthSpeed, gotPower)).toBeGreaterThan(0.95);
  });

  it("curl sign convention: path that turns clockwise (finishes heading right) is positive", () => {
    // Hand-made path, written independently of the generator.
    const pts = Array.from({ length: 12 }, (_, i) => {
      const u = i / 11;
      // Heading goes from about 8 degrees to 31 degrees to the right of up: it turns clockwise.
      return { t: u * 0.2, x: 200 + 60 * u + 90 * u * u, y: 600 - 400 * u };
    });
    const r = recogniseSwipe(pts);
    expect(r.kind).toBe("event");
    if (r.kind === "event") expect(r.event.curl).toBeGreaterThan(0); // turns clockwise: the ball bends right
    const mirrored = pts.map((p) => ({ ...p, x: 400 - p.x }));
    const m = recogniseSwipe(mirrored);
    expect(m.kind).toBe("event");
    if (m.kind === "event") expect(m.event.curl).toBeLessThan(0);
  });

  it("applies a curl bias and keeps curl inside [-1, 1]", () => {
    const { points } = genSwipe(5, { turn: 1.2 });
    const a = recogniseSwipe(points);
    const b = recogniseSwipe(points, { curlBias: 0.3 });
    if (a.kind === "event" && b.kind === "event") {
      expect(b.event.curl).toBeLessThan(a.event.curl);
      expect(Math.abs(a.event.curl)).toBeLessThanOrEqual(1);
    }
  });

  it("rejects taps, slow drags, long-press jitter and micro swipes", () => {
    for (const kind of ["tap", "slow-drag", "long-press-jitter", "micro-swipe"] as const) {
      let fp = 0;
      for (let seed = 1; seed <= NF; seed++) if (recogniseSwipe(genSwipeConfounder(kind, seed)).kind === "event") fp++;
      put(`swipe.falsePositives.${kind}`, `${fp}/${NF}`);
      expect(fp).toBe(0);
    }
  });

  it("pointer tracker feeds the recogniser", () => {
    const { points } = genSwipe(9);
    const tr = createSwipeTracker();
    tr.down(points[0].t, points[0].x, points[0].y);
    for (const p of points.slice(1, -1)) tr.move(p.t, p.x, p.y);
    const last = points[points.length - 1];
    const r = tr.up(last.t, last.x, last.y);
    expect(r.kind).toBe("event");
  });
});

// ---------------------------------------------------------------- twist
describe("twist filter", () => {
  const run = (samples: MotionSample[], opts = {}) => {
    const f = createTwistFilter(opts);
    let st = f.push(samples[0]);
    let peakAbs = 0;
    for (const s of samples) { st = f.push(s); peakAbs = Math.max(peakAbs, Math.abs(st.angle)); }
    return { st, peakAbs };
  };

  it("accumulates the angle you actually turned, in both directions", () => {
    const err: number[] = [], rel: number[] = [];
    let dirOk = 0;
    for (let seed = 1; seed <= NF; seed++) {
      const { samples, truth } = genTwist(seed);
      const { st } = run(samples);
      err.push((st.angle - truth.totalAngle) / D2R);
      rel.push(Math.abs(st.angle - truth.totalAngle) / Math.max(0.5, Math.abs(truth.totalAngle)));
      if (Math.abs(truth.totalAngle) > 0.5 && Math.sign(st.angle) === Math.sign(truth.totalAngle)) dirOk++;
    }
    put("twist.accumulatedAngleErrDeg.medianAbs", median(abs(err)), 2);
    put("twist.accumulatedAngleErrDeg.p90Abs", quantile(abs(err), 0.9), 2);
    put("twist.accumulatedAngleErrDeg.max", Math.max(...abs(err)), 2);
    put("twist.accumulatedAngleRelErr.median", median(rel));
    expect(median(abs(err))).toBeLessThan(6);
    expect(Math.max(...abs(err))).toBeLessThan(20);
    expect(median(rel)).toBeLessThan(0.06);
    expect(dirOk).toBeGreaterThan(NF * 0.9);
  });

  it("outputs signed angular velocity close to the true rate mid-stroke", () => {
    const { samples, truth } = genTwist(3, { strokes: 3 });
    const f = createTwistFilter();
    let checked = 0, good = 0;
    for (const s of samples) {
      const st = f.push(s);
      for (const k of truth.strokes) {
        const u = (s.t - k.t0) / k.T;
        if (u > 0.4 && u < 0.6) {
          const trueRate = (1.875 * k.d) / k.T; // min-jerk peak
          checked++;
          if (Math.sign(st.omega) === Math.sign(trueRate) && Math.abs(st.omega - trueRate) / Math.abs(trueRate) < 0.25) good++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect(good / checked).toBeGreaterThan(0.9);
  });

  it("does not creep when held still, even with gyro bias up to 0.08 rad/s", () => {
    for (const bias of [0.02, 0.05, 0.08]) {
      const drift: number[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        const { st } = run(genStill(seed, 60, { bias }));
        drift.push(Math.abs(st.angleDeg));
      }
      put(`twist.stillDriftDeg.60s.bias${bias}`, Math.max(...drift), 2);
      expect(Math.max(...drift)).toBeLessThan(1);
    }
  });

  it("does not creep at nominal tremor, and leaks only slowly at 3x tremor", () => {
    const nominal = run(genStill(3, 60, { held: true, tremor: 1 })).st;
    const rough = run(genStill(3, 60, { held: true, tremor: 3 })).st;
    put("twist.stillDriftDeg.60s.tremorx1", Math.abs(nominal.angleDeg), 2);
    put("twist.stillDriftDeg.60s.tremorx3", Math.abs(rough.angleDeg), 2);
    expect(Math.abs(nominal.angleDeg)).toBeLessThan(1);
    expect(Math.abs(rough.angleDeg)).toBeLessThan(10);
  });

  it("ignores everything that is not a twist: net angle after walking, pickup, put-down, bump, shake", () => {
    for (const kind of ["walk-texting", "walk-swing", "slow-pickup", "put-down", "table-bump", "shake", "shake-vertical"] as const) {
      const fin: number[] = [];
      for (let seed = 1; seed <= 30; seed++) {
        const { st } = run(genConfounder(kind, 11000 + seed));
        fin.push(Math.abs(st.angleDeg));
      }
      put(`twist.netAngleDeg.afterConfounder.${kind}.p90`, quantile(fin, 0.9), 1);
      // The phone does rotate in some of these, so "net" is not always zero; it must stay far from a crown turn.
      expect(quantile(fin, 0.9)).toBeLessThan(45);
    }
  });

  it("invert flips the sign convention and zero() resets the angle", () => {
    const { samples } = genTwist(4, { strokes: 2 });
    const a = run(samples).st;
    const b = run(samples, { invert: true }).st;
    expect(b.angle).toBeCloseTo(-a.angle, 9);
    const f = createTwistFilter();
    for (const s of samples) f.push(s);
    f.zero();
    expect(f.push(samples[samples.length - 1]).angle).toBeCloseTo(0, 3);
  });
});

// ---------------------------------------------------------------- tilt
describe("tilt steer filter", () => {
  const expectedSteer = (lean: number, dz = 4, max = 30) => {
    const a = Math.abs(lean);
    return a <= dz ? 0 : Math.sign(lean) * Math.min(1, (a - dz) / (max - dz));
  };

  function evaluate(seed: number, walking: boolean) {
    const { samples, truth } = genTilt(seed, { walking, tuckSteps: true });
    const flt = createTiltFilter();
    const out = samples.map((s) => ({ t: s.t, st: flt.push(s) }));
    // Best-lag RMS error against the ideal mapping of the true lean.
    let best = Infinity, lag = 0;
    for (let L = 0; L <= 0.4 + 1e-9; L += 0.02) {
      let se = 0, n = 0;
      for (const o of out) {
        if (o.t < 1.3) continue;
        se += (o.st.steer - expectedSteer(truth.leanDeg(o.t - L) - truth.neutralLean)) ** 2;
        n++;
      }
      const r = Math.sqrt(se / n);
      if (r < best) { best = r; lag = L; }
    }
    let tuckSe = 0, tn = 0, tuckPeak = 0;
    for (const o of out) {
      if (o.t < 1.3) continue;
      const exp = Math.min(1, Math.max(0, (truth.tuck(o.t - lag) - 5) / 20));
      tuckSe += (o.st.tuck - exp) ** 2; tn++;
      tuckPeak = Math.max(tuckPeak, o.st.tuck);
    }
    return { rms: best, lag, tuckRms: Math.sqrt(tuckSe / tn), tuckPeak };
  }

  it("follows the lean with a short lag and a small error (phone held steady)", () => {
    const rms: number[] = [], lag: number[] = [], tuck: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const r = evaluate(seed, false);
      rms.push(r.rms); lag.push(r.lag); tuck.push(r.tuckRms);
    }
    put("tilt.steerRmsErr.median", median(rms));
    put("tilt.steerRmsErr.p90", quantile(rms, 0.9));
    put("tilt.latencyMs.median", median(lag) * 1000, 0);
    put("tilt.tuckRmsErr.median", median(tuck));
    expect(median(rms)).toBeLessThan(0.08);
    expect(quantile(rms, 0.9)).toBeLessThan(0.15);
    expect(median(lag)).toBeLessThanOrEqual(0.1);
    expect(median(tuck)).toBeLessThan(0.05);
  });

  it("stays usable while walking (stress case, noisier)", () => {
    const rms: number[] = [];
    for (let seed = 1; seed <= 40; seed++) rms.push(evaluate(seed, true).rms);
    put("tilt.steerRmsErr.walking.median", median(rms));
    put("tilt.steerRmsErr.walking.p90", quantile(rms, 0.9));
    expect(median(rms)).toBeLessThan(0.25);
  });

  it("outputs exactly zero steer for tremor-sized wobble (dead zone)", () => {
    let worst = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { samples } = genTilt(seed, { steps: 0 });
      const flt = createTiltFilter();
      for (const s of samples) { const st = flt.push(s); if (s.t > 1) worst = Math.max(worst, Math.abs(st.steer)); }
    }
    put("tilt.steerWhenHeldStill.maxAbs", worst);
    expect(worst).toBe(0);
  });

  it("reaches full deflection and respects its sign: right edge down is positive", () => {
    const { samples, truth } = genTilt(2, { steps: 3 });
    const flt = createTiltFilter();
    let maxPos = 0, maxNeg = 0;
    for (const s of samples) {
      const st = flt.push(s);
      maxPos = Math.max(maxPos, st.steer);
      maxNeg = Math.min(maxNeg, st.steer);
    }
    const leans = truth.steps.map((s) => s.to - truth.neutralLean);
    if (leans.some((l) => l > 20)) expect(maxPos).toBeGreaterThan(0.5);
    if (leans.some((l) => l < -20)) expect(maxNeg).toBeLessThan(-0.5);
  });

  it("recalibrate() makes the current pose neutral", () => {
    const { samples } = genTilt(6, { steps: 4 });
    const flt = createTiltFilter();
    for (const s of samples) flt.push(s);
    flt.recalibrate();
    const last = samples[samples.length - 1];
    const st = flt.push({ ...last, t: last.t + 0.02 });
    expect(Math.abs(st.leanDeg)).toBeLessThan(1.5);
    expect(st.steer).toBe(0);
  });

  it("says it cannot read lean when the phone is held bolt upright", () => {
    const upright = genTilt(8, { steps: 0 }).samples.map((s) => ({ ...s, acc: [0, 9.8, 0.1] as [number, number, number], gyro: [0, 0, 0] as [number, number, number] }));
    const flt = createTiltFilter();
    let last = flt.push(upright[0]);
    for (const s of upright) last = flt.push(s);
    expect(last.valid).toBe(false);
    expect(last.steer).toBe(0);
  });

  it("is independent per instance and resettable", () => {
    const a = createTiltFilter(), b = createTiltFilter();
    const { samples } = genTilt(1, { steps: 3 });
    for (const s of samples.slice(0, 200)) a.push(s);
    const sb = b.push(samples[0]);
    expect(sb.calibrated).toBe(false);
    a.reset();
    expect(a.push(samples[0]).calibrated).toBe(false);
  });
});

describe("determinism", () => {
  it("the same seed gives the same trace and the same detection", () => {
    const a = genGolf(42), b = genGolf(42);
    expect(a.samples.length).toBe(b.samples.length);
    expect(a.samples[100].gyro).toEqual(b.samples[100].gyro);
    const r = mulberry32(1);
    expect(r()).toBe(mulberry32(1)());
  });
});
