import { describe, expect, it } from "vitest";
import {
  DEG,
  Quat,
  qAngle,
  qAngleBetween,
  qConj,
  qEquivalent,
  qExp,
  qFromAxisAngle,
  qFromEulerZXY,
  qIdentity,
  qLog,
  qMul,
  qNormalize,
  qRotate,
  qSlerp,
  qToEulerZXY,
  qToMatrix,
} from "@/lib/lab/mirror/quat";
import {
  DEFAULT_CLAMP,
  deviceToCss,
  detectPlatform,
  normalizeAcceleration,
  parseMatrix3d,
  sampleToQuat,
  softClamp,
  softLimit,
  toMatrix3d,
} from "@/lib/lab/mirror/orientation";
import { Calibrator, averageQuats, relativeTo } from "@/lib/lab/mirror/calibration";
import { OneEuro, QuatOneEuro } from "@/lib/lab/mirror/oneEuro";
import { DEFAULT_PIPELINE, OrientationPipeline } from "@/lib/lab/mirror/pipeline";
import { ClockSync, createLoopbackPair, isMirrorMessage } from "@/lib/lab/mirror/transport";

const X = { x: 1, y: 0, z: 0 };
const Y = { x: 0, y: 1, z: 0 };
const Z = { x: 0, y: 0, z: 1 };

// small deterministic PRNG so the tests are stable
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const randQuat = (r: () => number): Quat =>
  qNormalize({ x: r() * 2 - 1, y: r() * 2 - 1, z: r() * 2 - 1, w: r() * 2 - 1 });

/** What a real sensor would report for rotation q, as OrientSample (degrees). */
function report(q: Quat, screenAngle = 0) {
  const e = qToEulerZXY(q);
  return { alpha: e.alpha / DEG, beta: e.beta / DEG, gamma: e.gamma / DEG, screenAngle };
}

describe("quaternion basics", () => {
  it("multiplies, conjugates and normalises", () => {
    const q = qFromAxisAngle({ x: 1, y: 2, z: 3 }, 1.1);
    const id = qMul(q, qConj(q));
    expect(id.w).toBeCloseTo(1, 12);
    expect(Math.hypot(id.x, id.y, id.z)).toBeLessThan(1e-12);
  });

  it("exp and log are inverses (shortest way round)", () => {
    const v = { x: 0.3, y: -0.5, z: 0.9 };
    const back = qLog(qExp(v));
    expect(back.x).toBeCloseTo(v.x, 9);
    expect(back.y).toBeCloseTo(v.y, 9);
    expect(back.z).toBeCloseTo(v.z, 9);
  });

  it("slerp halves an angle and takes the short way across the double cover", () => {
    const a = qIdentity();
    const b = qFromAxisAngle(Z, 80 * DEG);
    expect(qAngle(qSlerp(a, b, 0.5))).toBeCloseTo(40 * DEG, 9);
    // -b is the same rotation; slerp must not go the long way round
    const nb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    expect(qAngle(qSlerp(a, nb, 0.5))).toBeCloseTo(40 * DEG, 9);
  });

  it("rotates a vector like a rotation matrix does", () => {
    const q = qFromAxisAngle(Z, 90 * DEG);
    const v = qRotate(q, X);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(1, 12);
    const m = qToMatrix(q);
    expect(m[1][0]).toBeCloseTo(1, 12);
  });
});

describe("W3C Euler (alpha, beta, gamma) <-> quaternion", () => {
  it("round-trips random orientations, including around beta = +-90", () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const q = randQuat(r);
      const s = report(q);
      const back = sampleToQuat(s);
      expect(qEquivalent(q, back, 1e-9)).toBe(true);
    }
    for (const beta of [89.999, 90, 90.001, -89.999, -90, -90.001]) {
      const q = qFromEulerZXY(37 * DEG, beta * DEG, 21 * DEG);
      expect(qEquivalent(q, sampleToQuat(report(q)), 1e-9)).toBe(true);
    }
  });

  it("keeps the spec's ranges: beta in [-180,180), gamma in [-90,90]", () => {
    const r = rng(11);
    for (let i = 0; i < 300; i++) {
      const s = report(randQuat(r));
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThan(360.0001);
      expect(s.beta).toBeGreaterThanOrEqual(-180.0001);
      expect(s.beta).toBeLessThanOrEqual(180.0001);
      expect(Math.abs(s.gamma)).toBeLessThanOrEqual(90.0001);
    }
  });

  it("is continuous through 90 degrees of pitch even though the Euler angles are not", () => {
    // pitch the phone 0 -> 170 degrees about its own x axis while also yawing a
    // little, so alpha and gamma are both involved at the singularity
    const q0 = qFromEulerZXY(40 * DEG, 20 * DEG, 12 * DEG);
    let prev: Quat | null = null;
    let maxStep = 0;
    let maxEulerJump = 0;
    let prevE: { alpha: number; gamma: number } | null = null;
    const N = 3400; // 0.05 degree steps
    for (let i = 0; i <= N; i++) {
      const pitch = (i / N) * 170 * DEG;
      const q = qMul(q0, qMul(qFromAxisAngle(X, pitch), qFromAxisAngle({ x: 0.1, y: 0.05, z: 1 }, pitch * 0.2)));
      const s = report(q);
      if (prevE) {
        const da = Math.abs(((s.alpha - prevE.alpha + 540) % 360) - 180);
        maxEulerJump = Math.max(maxEulerJump, 180 - da, Math.abs(s.gamma - prevE.gamma));
      }
      prevE = s;
      const recon = sampleToQuat(s);
      if (prev) maxStep = Math.max(maxStep, qAngleBetween(prev, recon));
      prev = recon;
    }
    // sanity: the raw angles really do jump somewhere on this path...
    expect(maxEulerJump).toBeGreaterThan(20);
    // ...but the quaternions never move more than ~the true step (0.05 deg + the yaw)
    expect(maxStep / DEG).toBeLessThan(0.12);
  });
});

describe("mapping into CSS", () => {
  // the phone's own frame: x right, y up the screen, z out of the screen at you
  const css = (q: Quat, v: { x: number; y: number; z: number }) => {
    const m = parseMatrix3d(toMatrix3d(q))!;
    return {
      x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
      y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
      z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
    };
  };
  const TOP = { x: 0, y: -1, z: 0 }; // CSS: up is -y
  const RIGHT = { x: 1, y: 0, z: 0 };

  it("identity maps to identity", () => {
    expect(toMatrix3d(qIdentity())).toBe("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)");
  });

  it("phone's top tipping away from you moves the mockup's top away (negative z)", () => {
    // device frame: rotating about +x by +theta brings the top toward the user,
    // so tipping it away is a negative rotation about x
    const away = qFromAxisAngle(X, -30 * DEG);
    const top = css(away, TOP);
    expect(top.z).toBeLessThan(-0.45);
    expect(top.y).toBeLessThan(0); // still above centre
  });

  it("phone's right edge dipping (positive gamma) moves the mockup's right edge away", () => {
    const dip = qFromAxisAngle(Y, 30 * DEG);
    const right = css(dip, RIGHT);
    expect(right.z).toBeLessThan(-0.45);
    expect(right.x).toBeGreaterThan(0.8);
  });

  it("twisting the phone counter-clockwise (seen from the front) turns the mockup counter-clockwise", () => {
    const twist = qFromAxisAngle(Z, 30 * DEG);
    const right = css(twist, RIGHT);
    // counter-clockwise on screen: the right edge heads up, i.e. CSS -y
    expect(right.y).toBeLessThan(-0.45);
    expect(right.x).toBeGreaterThan(0.8);
  });

  it("produces a proper rotation (det 1, orthonormal) for any orientation", () => {
    const r = rng(3);
    for (let i = 0; i < 100; i++) {
      const m = parseMatrix3d(toMatrix3d(randQuat(r)))!;
      const det =
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      expect(det).toBeCloseTo(1, 4);
    }
  });

  it("deviceToCss only negates x and z parts", () => {
    const q = { x: 0.1, y: 0.2, z: 0.3, w: 0.9 };
    expect(deviceToCss(q)).toEqual({ x: -0.1, y: 0.2, z: -0.3, w: 0.9 });
  });
});

describe("screen orientation and platform conventions", () => {
  it("landscape adds a rotation about the screen normal", () => {
    const s0 = { alpha: 30, beta: 50, gamma: 10, screenAngle: 0 };
    const s90 = { ...s0, screenAngle: 90 };
    const q0 = sampleToQuat(s0);
    const q90 = sampleToQuat(s90);
    const delta = qMul(qConj(q0), q90);
    expect(qAngle(delta)).toBeCloseTo(90 * DEG, 9);
    // axis is the device's z
    const v = qLog(delta);
    expect(Math.abs(v.z)).toBeCloseTo(90 * DEG, 9);
    expect(Math.abs(v.x)).toBeLessThan(1e-9);
  });

  it("flipping beta mirrors the pitch direction", () => {
    const base = { alpha: 0, beta: 0, gamma: 0, screenAngle: 0 };
    const up = qMul(qConj(sampleToQuat(base)), sampleToQuat({ ...base, beta: 25 }));
    const flipped = qMul(
      qConj(sampleToQuat(base, { flipAlpha: false, flipBeta: true, flipGamma: false })),
      sampleToQuat({ ...base, beta: 25 }, { flipAlpha: false, flipBeta: true, flipGamma: false }),
    );
    expect(qLog(up).x).toBeCloseTo(-qLog(flipped).x, 9);
  });

  it("detects platforms and normalises the iOS acceleration sign", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(normalizeAcceleration({ x: 1, y: -2, z: 3 }, "ios")).toEqual({ x: -1, y: 2, z: -3 });
    expect(normalizeAcceleration({ x: 1, y: -2, z: 3 }, "android")).toEqual({ x: 1, y: -2, z: 3 });
  });
});

describe("calibration", () => {
  it("averages nearby orientations, hemisphere-safe", () => {
    const a = qFromAxisAngle(X, 10 * DEG);
    const b = qFromAxisAngle(X, 14 * DEG);
    const nb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    const m = averageQuats([a, nb]);
    expect(qAngle(m)).toBeCloseTo(12 * DEG, 4);
  });

  it("makes however the phone is held the neutral pose", () => {
    const r = rng(21);
    for (let i = 0; i < 50; i++) {
      const hold = randQuat(r);
      const cal = new Calibrator(4);
      for (let k = 0; k < 4; k++) expect(cal.push(hold)).toBe(k === 3);
      expect(qAngle(cal.relative(hold))).toBeLessThan(1e-9);
    }
  });

  it("then tracks rotations in the phone's own frame, whatever the hold", () => {
    const r = rng(5);
    for (let i = 0; i < 50; i++) {
      const hold = randQuat(r);
      const turn = qFromAxisAngle(X, 20 * DEG);
      const rel = relativeTo(hold, qMul(hold, turn));
      expect(qEquivalent(rel, turn, 1e-9)).toBe(true);
    }
  });

  it("pipeline: a phone held tilted shows flat, then follows a 20 degree pitch", () => {
    const hold = qFromEulerZXY(137 * DEG, 62 * DEG, -4 * DEG);
    const p = new OrientationPipeline({ predict: false });
    let t = 1000;
    for (let i = 0; i < 40; i++, t += 16.67) p.push(report(hold), t);
    expect(p.calibrated).toBe(true);
    expect(qAngle(p.pose(t).q)).toBeLessThan(0.1 * DEG);
    const pitched = qMul(hold, qFromAxisAngle(X, -20 * DEG));
    for (let i = 0; i < 90; i++, t += 16.67) p.push(report(pitched), t);
    const shown = qLog(p.pose(t).q);
    // clamped at 42 deg * tanh(20/42) = 18.5 deg, tipping away
    expect(shown.x / DEG).toBeCloseTo(-42 * Math.tanh(20 / 42), 0);
    expect(Math.abs(shown.y) / DEG).toBeLessThan(0.1);
  });

  it("pipeline: a phone held dead still still calibrates (only two samples arrive)", () => {
    const hold = qFromEulerZXY(300 * DEG, 80 * DEG, 10 * DEG);
    const p = new OrientationPipeline({ predict: false });
    p.push(report(hold), 0);
    p.push(report(hold), 16);
    expect(p.calibrated).toBe(false);
    p.pose(100); // too soon
    expect(p.calibrated).toBe(false);
    p.pose(400);
    expect(p.calibrated).toBe(true);
    expect(qAngle(p.pose(500).q)).toBeLessThan(0.01 * DEG);
  });

  it("pipeline: re-centring a phone that is held still needs no new samples", () => {
    const a = qFromEulerZXY(10 * DEG, 40 * DEG, 0);
    const b = qMul(a, qFromAxisAngle(X, -30 * DEG));
    const p = new OrientationPipeline({ predict: false, clamp: { maxTilt: 1e6, maxRoll: 1e6 } });
    let t = 0;
    for (let i = 0; i < 20; i++, t += 16.67) p.push(report(a), t);
    // tilt away and hold (the sensor goes quiet), then press re-centre
    for (let i = 1; i <= 10; i++, t += 16.67) p.push(report(qSlerp(a, b, i / 10)), t);
    for (let i = 0; i < 10; i++, t += 16.67) p.push(report(b), t);
    expect(qAngle(p.pose(t + 500).q) / DEG).toBeGreaterThan(25);
    p.recalibrate(t + 600);
    // no more samples arrive; after the ease the mockup must be flat
    expect(p.calibrated).toBe(true);
    expect(qAngle(p.pose(t + 600 + 1000).q) / DEG).toBeLessThan(0.1);
    // and it keeps tracking from the new neutral
    const c = qMul(b, qFromAxisAngle(X, 10 * DEG));
    for (let i = 0; i < 60; i++) { t += 16.67; p.push(report(c), t + 1700); }
    expect(qAngle(p.pose(t + 1700 + 400).q) / DEG).toBeCloseTo(10, 0);
  });

  it("pipeline: re-centring ignores stale samples from before a fast move", () => {
    const old = qFromEulerZXY(10 * DEG, 40 * DEG, 0);
    const now = qFromEulerZXY(10 * DEG, 100 * DEG, 0);
    const p = new OrientationPipeline({ predict: false, clamp: { maxTilt: 1e6, maxRoll: 1e6 } });
    for (let i = 0; i < 8; i++) p.push(report(old), 900 + i * 16.7); // a burst at the old pose, 16 ms before the move
    p.push(report(now), 1033); // one event at the new pose, then the sensor goes quiet
    p.recalibrate(1100);
    expect(qAngle(p.pose(2200).q) / DEG).toBeLessThan(0.1);
    // moving on from there is measured from the NEW pose
    for (let i = 1; i <= 40; i++) p.push(report(qMul(now, qFromAxisAngle(X, -(i / 40) * 20 * DEG))), 2300 + i * 16.7);
    expect(qAngle(p.pose(3500).q) / DEG).toBeCloseTo(20, 0);
  });

  it("pipeline: reset() (a new connection) waits for fresh samples", () => {
    const p = new OrientationPipeline({ predict: false });
    const a = qFromEulerZXY(10 * DEG, 40 * DEG, 0);
    for (let i = 0; i < 20; i++) p.push(report(a), i * 16.7);
    p.reset(400);
    expect(p.calibrated).toBe(false);
    p.push(report(qFromEulerZXY(90 * DEG, 10 * DEG, 0)), 420);
    p.pose(700);
    expect(p.calibrated).toBe(true);
    expect(qAngle(p.pose(900).q) / DEG).toBeLessThan(0.1);
  });

  it("pipeline: changing the screen rotation re-calibrates instead of jumping", () => {
    const hold = qFromEulerZXY(10 * DEG, 70 * DEG, 5 * DEG);
    const p = new OrientationPipeline({ predict: false });
    let t = 0;
    for (let i = 0; i < 30; i++, t += 16.67) p.push(report(hold, 0), t);
    const before = p.pose(t).q;
    p.push(report(hold, 90), t);
    t += 16.67;
    // still holding the old pose while the new neutral is collected
    expect(qAngleBetween(before, p.pose(t).q)).toBeLessThan(1 * DEG);
    for (let i = 0; i < 30; i++, t += 16.67) p.push(report(hold, 90), t);
    expect(p.calibrated).toBe(true);
    expect(qAngle(p.pose(t + 1000).q)).toBeLessThan(0.1 * DEG);
  });
});

describe("soft clamp", () => {
  it("tracks small tilts 1:1 and never exceeds its limits", () => {
    const small = qFromAxisAngle(X, 4 * DEG);
    expect(qAngle(softClamp(small)) / DEG).toBeCloseTo(4, 1);
    for (let a = 0; a <= 360; a += 3) {
      for (const axis of [X, Y, Z, { x: 1, y: 1, z: 1 }]) {
        const out = softClamp(qFromAxisAngle(axis, a * DEG));
        const v = qLog(out);
        // swing and twist are each bounded; their composition is bounded by the sum
        expect(qAngle(out)).toBeLessThanOrEqual(DEFAULT_CLAMP.maxTilt + DEFAULT_CLAMP.maxRoll + 1e-9);
      }
    }
  });

  it("is monotone then saturates, and eases back to flat at a half-turn (no 180 degree flip)", () => {
    let prev = 0;
    for (let a = 0; a <= 100; a += 1) {
      const out = softLimit(a * DEG, DEFAULT_CLAMP.maxTilt);
      expect(out).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = out;
    }
    expect(softLimit(90 * DEG, DEFAULT_CLAMP.maxTilt) / DEG).toBeGreaterThan(36);
    expect(softLimit(90 * DEG, DEFAULT_CLAMP.maxTilt)).toBeLessThan(DEFAULT_CLAMP.maxTilt);
    expect(softLimit(180 * DEG, DEFAULT_CLAMP.maxTilt)).toBeCloseTo(0, 12);
  });

  it("is continuous over the whole sphere of rotations about x, y and z", () => {
    for (const axis of [X, Y, Z, { x: 0.3, y: 0.5, z: 0.8 }]) {
      let prev: Quat | null = null;
      let maxJump = 0;
      for (let a = 0; a <= 720; a += 0.1) {
        const out = softClamp(qFromAxisAngle(axis, a * DEG));
        if (prev) maxJump = Math.max(maxJump, qAngleBetween(prev, out));
        prev = out;
      }
      // 0.1 degree of input must never move the output by much more than that
      expect(maxJump / DEG).toBeLessThan(0.2);
    }
  });

  it("returns to flat after a full 360 degree spin", () => {
    expect(qAngle(softClamp(qFromAxisAngle(X, 360 * DEG)))).toBeLessThan(1e-9);
  });
});

describe("one-euro filter", () => {
  const dt = 1 / 60;
  const params = DEFAULT_PIPELINE.filter;

  it("step response: monotone, no overshoot, settles", () => {
    const f = new QuatOneEuro(params);
    f.filter(qIdentity(), 0);
    const target = qFromAxisAngle(X, 20 * DEG);
    const out: number[] = [];
    for (let i = 1; i <= 240; i++) out.push(qAngle(f.filter(target, i * dt)) / DEG);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] - 1e-9);
    expect(Math.max(...out)).toBeLessThanOrEqual(20 + 1e-6);
    expect(out[out.length - 1]).toBeGreaterThan(19.99);
    // time to 63% and 90%, in ms (documented, and bounded so it stays snappy)
    const t63 = (out.findIndex((v) => v >= 0.63 * 20) + 1) * dt * 1000;
    const t90 = (out.findIndex((v) => v >= 0.9 * 20) + 1) * dt * 1000;
    expect(t63).toBeLessThanOrEqual(100);
    expect(t90).toBeLessThanOrEqual(250);
  });

  it("opens up for big, fast moves and stays heavy for tiny ones (that is the point)", () => {
    const settle = (deg: number) => {
      const f = new QuatOneEuro(params);
      f.filter(qIdentity(), 0);
      const target = qFromAxisAngle(X, deg * DEG);
      for (let i = 1; i <= 600; i++) {
        const v = qAngle(f.filter(target, i * dt)) / DEG;
        if (v >= 0.9 * deg) return i * dt * 1000;
      }
      return Infinity;
    };
    expect(settle(30)).toBeLessThan(settle(0.5));
  });

  it("attenuates jitter at rest", () => {
    const r = rng(99);
    const f = new QuatOneEuro(params);
    f.filter(qIdentity(), 0);
    const rawDev: number[] = [];
    const outDev: number[] = [];
    for (let i = 1; i <= 600; i++) {
      const noisy = qExp({ x: (r() - 0.5) * 0.02, y: (r() - 0.5) * 0.02, z: (r() - 0.5) * 0.02 });
      const o = f.filter(noisy, i * dt);
      if (i > 60) {
        rawDev.push(qAngle(noisy));
        outDev.push(qAngle(o));
      }
    }
    const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(outDev)).toBeLessThan(0.45 * rms(rawDev));
  });

  it("the scalar filter has the same step behaviour", () => {
    const f = new OneEuro(params);
    f.filter(0, 0);
    let prev = 0;
    for (let i = 1; i <= 240; i++) {
      const v = f.filter(10, i * dt);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(10);
      prev = v;
    }
    expect(prev).toBeGreaterThan(9.99);
  });

  it("snaps over a long gap instead of smearing", () => {
    const f = new QuatOneEuro(params);
    f.filter(qIdentity(), 0);
    const far = qFromAxisAngle(X, 30 * DEG);
    expect(qAngle(f.filter(far, 5)) / DEG).toBeCloseTo(30, 6);
  });
});

describe("pipeline: lag and prediction", () => {
  /** drive a constant-rate pitch ramp, sampled at `hz`, drawn at 240 Hz; return lag in ms */
  function rampLag(rateDegPerS: number, cfg: Partial<typeof DEFAULT_PIPELINE>, latencyMs = 0) {
    const hold = qFromEulerZXY(0, 0, 0);
    const p = new OrientationPipeline({ ...cfg, clamp: { maxTilt: 1e6, maxRoll: 1e6 } });
    const hz = 60;
    let t = 0;
    for (let i = 0; i < 30; i++, t += 1000 / hz) p.push(report(hold), t);
    const t0 = t;
    const truth = (tt: number) => (-(tt - t0) / 1000) * rateDegPerS; // degrees about x (tipping away)
    const lags: number[] = [];
    let nextSample = t;
    for (let now = t; now < t0 + 1100; now += 1000 / 240) {
      while (nextSample <= now - latencyMs) {
        const q = qMul(hold, qFromAxisAngle(X, truth(nextSample) * DEG));
        p.push(report(q), nextSample);
        nextSample += 1000 / hz;
      }
      const shown = -qLog(p.pose(now).q).x / DEG; // positive = tipped away
      // invert the ramp: when was the truth equal to what we show?
      const tTruth = t0 + (shown / rateDegPerS) * 1000;
      if (now - t0 > 400) lags.push(now - tTruth);
    }
    return lags.reduce((a, b) => a + b, 0) / lags.length;
  }

  it("prediction cancels the filter's lag on a steady sweep", () => {
    const withPred = rampLag(90, { predict: true });
    const without = rampLag(90, { predict: false });
    // eslint-disable-next-line no-console
    console.log(`ramp 90deg/s lag: predict=${withPred.toFixed(1)}ms, no predict=${without.toFixed(1)}ms`);
    expect(without).toBeGreaterThan(15);
    expect(Math.abs(withPred)).toBeLessThan(without * 0.5);
  });

  it("with 30 ms of transport latency the predicted display lags far less than the raw stream would", () => {
    const withPred = rampLag(90, { predict: true }, 30);
    const without = rampLag(90, { predict: false }, 30);
    // eslint-disable-next-line no-console
    console.log(`ramp 90deg/s, 30ms transport: predict=${withPred.toFixed(1)}ms, no predict=${without.toFixed(1)}ms`);
    expect(withPred).toBeLessThan(without - 20);
  });

  it("still smooths jitter at rest with prediction on", () => {
    const r = rng(1234);
    const p = new OrientationPipeline({ clamp: { maxTilt: 1e6, maxRoll: 1e6 } });
    const hold = qFromEulerZXY(20 * DEG, 50 * DEG, 3 * DEG);
    let t = 0;
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 600; i++, t += 16.67) {
      // about 0.1 degree of sensor noise per axis
      const noisy = qMul(hold, qExp({ x: (r() - 0.5) * 0.0035, y: (r() - 0.5) * 0.0035, z: (r() - 0.5) * 0.0035 }));
      p.push(report(noisy), t);
      if (i > 60) {
        raw.push(qAngleBetween(hold, noisy));
        out.push(qAngle(p.pose(t + 8).q));
      }
    }
    const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    // eslint-disable-next-line no-console
    console.log(`rest jitter rms: raw=${(rms(raw) / DEG).toFixed(3)}deg out=${(rms(out) / DEG).toFixed(3)}deg`);
    expect(rms(out)).toBeLessThan(0.6 * rms(raw));
  });

  it("converges on the last pose when the sensor goes quiet (Chrome only fires on a 0.1 degree change)", () => {
    const hold = qIdentity();
    const p = new OrientationPipeline({ clamp: { maxTilt: 1e6, maxRoll: 1e6 } });
    let t = 0;
    for (let i = 0; i < 20; i++, t += 16.67) p.push(report(hold), t);
    const target = qFromAxisAngle(X, -25 * DEG);
    // a quick move then stillness: three samples and nothing more
    for (let i = 1; i <= 3; i++, t += 16.67) p.push(report(qSlerp(hold, target, i / 3)), t);
    let err = 0;
    for (let k = 0; k < 90; k++) {
      t += 16.67;
      err = qAngleBetween(p.pose(t).q, target) / DEG;
    }
    expect(err).toBeLessThan(0.15);
  });

  it("does not run away if the stream stalls", () => {
    const hold = qIdentity();
    const p = new OrientationPipeline({ clamp: { maxTilt: 1e6, maxRoll: 1e6 } });
    let t = 0;
    for (let i = 0; i < 20; i++, t += 16.67) p.push(report(hold), t);
    // swing at 180 deg/s for half a second then stop sending
    for (let i = 0; i < 30; i++, t += 16.67) p.push(report(qFromAxisAngle(X, (i * 16.67 * 180) / 1000 * DEG)), t);
    const soon = qAngle(p.pose(t).q);
    const later = qAngle(p.pose(t + 5000).q);
    expect(later - soon).toBeLessThan(15 * DEG); // 60 ms * 180 deg/s = 11 deg at most
  });

  it("sweeping through 90 degrees of pitch yields a smooth, bounded display with no flips", () => {
    const hold = qFromEulerZXY(137 * DEG, 20 * DEG, 8 * DEG);
    const p = new OrientationPipeline();
    let t = 0;
    for (let i = 0; i < 30; i++, t += 16.67) p.push(report(hold), t);
    let prev = p.pose(t).q;
    let maxStep = 0;
    let maxAngle = 0;
    // pitch up through the singularity to 160 deg and back, at 120 deg/s
    const total = (160 / 120) * 2 * 1000;
    for (let e = 0; e <= total; e += 16.67, t += 16.67) {
      const frac = e / total;
      const ang = (frac < 0.5 ? frac * 2 : (1 - frac) * 2) * 160;
      p.push(report(qMul(hold, qFromAxisAngle(X, ang * DEG))), t);
      const q = p.pose(t).q;
      maxStep = Math.max(maxStep, qAngleBetween(prev, q));
      maxAngle = Math.max(maxAngle, qAngle(q));
      prev = q;
    }
    // true motion is 2 deg/frame; the display step may exceed it a little via prediction but never "flips"
    expect(maxStep / DEG).toBeLessThan(3);
    expect(maxAngle).toBeLessThanOrEqual(DEFAULT_CLAMP.maxTilt + 1e-6);
  });
});

describe("transport", () => {
  it("validates messages", () => {
    expect(isMirrorMessage({ type: "unlock", t: 1 })).toBe(true);
    expect(isMirrorMessage({ type: "tap", t: 1, x: 0.2, y: 0.9 })).toBe(true);
    expect(isMirrorMessage({ type: "tap", t: 1, x: "a", y: 0.9 })).toBe(false);
    expect(isMirrorMessage({ type: "orient", t: 1, seq: 1, alpha: 1, beta: 2, gamma: NaN, screenAngle: 0 })).toBe(false);
    expect(isMirrorMessage({ type: "nope" })).toBe(false);
    expect(isMirrorMessage(null)).toBe(false);
    expect(isMirrorMessage("unlock")).toBe(false);
  });

  it("loopback pair delivers a copy in both directions, and unsubscribe works", async () => {
    const [a, b] = createLoopbackPair();
    const got: unknown[] = [];
    const off = b.onMessage((m) => got.push(m));
    const msg = { type: "tap" as const, t: 5, x: 0.25, y: 0.75 };
    a.send(msg);
    await Promise.resolve();
    expect(got).toEqual([msg]);
    expect(got[0]).not.toBe(msg);
    off();
    a.send(msg);
    await Promise.resolve();
    expect(got).toHaveLength(1);
    const back: unknown[] = [];
    a.onMessage((m) => back.push(m));
    b.send({ type: "unlock", t: 9 });
    await Promise.resolve();
    expect(back).toEqual([{ type: "unlock", t: 9 }]);
  });

  it("estimates clock offset and latency from ping/pong", () => {
    const cs = new ClockSync();
    // phone clock is 5000 ms ahead; one-way delay 20 ms each way
    for (let i = 0; i < 5; i++) {
      const t0 = 1000 + i * 500;
      const t1 = t0 + 20 + 5000;
      const t2 = t0 + 40;
      cs.addPong(t0, t1, t2);
    }
    expect(cs.offset).toBeCloseTo(5000, 6);
    expect(cs.latency).toBeCloseTo(20, 6);
  });
});
