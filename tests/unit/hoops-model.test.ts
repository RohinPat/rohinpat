import { describe, expect, it } from "vitest";
import {
  ASSIST, HOOP_FAST_AT, HOOP_SLIDE_AT, KEY_ASSIST, KEY_AIM_STEP, KEY_CHARGE, START, newFlight, hoopAfter, hoopVx, launch, missWhy, stepFlight, stepHoop,
  type Flight, type Hoop,
} from "@/components/offhours/hoopsModel";
import { swipeShot } from "@/components/offhours/hoopsRemote";

// the same generator as the piece's tests elsewhere: fixed seeds, so the make rates below are exact
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** fly one shot at 60 fps (5 substeps a frame, as the piece does) and say how it ended */
function fly(f: Flight, hoop: Hoop, score: number) {
  const dt = 1 / 60;
  let t = 0;
  const hits: string[] = [];
  while (f.flyT < 2.2) {
    stepHoop(hoop, score, dt);
    for (let i = 0; i < 5; i++) stepFlight(f, hoop.x, dt / 5, t, { contact: (k) => hits.push(k) });
    t += dt;
    if (f.scored && f.ball.y < 1.2) break;
  }
  return { made: f.scored, swish: f.scored && !f.touched, hits };
}

type Aim = "hoop" | "straight";

/** `n` swipes at a hoop that is already sliding: the player swipes at the hoop they see, speed 1.0 to 2.0 canvas heights a second */
function swipeRate(score: number, opts: { lead: boolean; aim: Aim; n?: number; seed?: number }) {
  const r = rng(opts.seed ?? 7);
  const n = opts.n ?? 1500;
  let made = 0;
  for (let i = 0; i < n; i++) {
    const hoop: Hoop = { x: 0, t: r() * Math.PI * 2 };
    hoop.x = Math.sin(hoop.t) * 0.7;
    const ball = { x: (r() - 0.5) * 1.0, y: START.y, z: START.z };
    const speed = 1.0 + r();
    const aimNoise = gauss(r) * 0.12;
    const aimX = (opts.aim === "hoop" ? hoop.x : ball.x) + aimNoise;
    const slope = (aimX - ball.x) / (4.4 - ball.z);
    const sh = swipeShot(slope * speed, -speed, ball.x, ball.z, 4.4)!;
    const f = newFlight(ball);
    const l = launch(ball, hoop, score, sh.aimX, sh.power, { lead: opts.lead });
    f.vel = l.vel;
    f.spin = -9;
    if (fly(f, hoop, score).made) made++;
  }
  return made / n;
}

describe("hoops: the moving hoop", () => {
  it("starts to slide at 20 points and speeds up at 32", () => {
    const h: Hoop = { x: 0, t: 0 };
    for (let i = 0; i < 120; i++) stepHoop(h, HOOP_SLIDE_AT - 1, 1 / 60);
    expect(h.x).toBe(0);
    expect(hoopVx(h, HOOP_SLIDE_AT - 1)).toBe(0);
    for (let i = 0; i < 120; i++) stepHoop(h, HOOP_SLIDE_AT, 1 / 60);
    expect(Math.abs(h.x)).toBeGreaterThan(0.1);
    const slow = hoopVx({ x: 0, t: 0 }, HOOP_SLIDE_AT), fast = hoopVx({ x: 0, t: 0 }, HOOP_FAST_AT);
    expect(fast).toBeGreaterThan(slow);
  });

  it("predicts where the hoop will be when the ball gets there", () => {
    const h: Hoop = { x: 0, t: 0.4 };
    h.x = Math.sin(h.t) * 0.7;
    const T = 0.97;
    const want = hoopAfter(h, HOOP_SLIDE_AT, T);
    const g: Hoop = { ...h };
    for (let i = 0; i < Math.round(T * 600); i++) stepHoop(g, HOOP_SLIDE_AT, 1 / 600);
    expect(want).toBeCloseTo(g.x, 2);
    expect(hoopAfter(h, 0, T)).toBe(h.x);
  });

  it("aims the assisted shot at the hoop's future position", () => {
    const h: Hoop = { x: 0, t: 0 }; // at the middle, moving right at about 0.77 m/s
    const ball = { x: 0, y: START.y, z: START.z };
    const led = launch(ball, h, HOOP_SLIDE_AT, 0, 1);
    const flat = launch(ball, h, HOOP_SLIDE_AT, 0, 1, { lead: false });
    expect(led.vel.x).toBeGreaterThan(0.5);
    expect(flat.vel.x).toBeCloseTo(0, 6);
  });

  it("a swipe at the sliding hoop makes at least half, where the old fixed aim missed most", { timeout: 60_000 }, () => {
    const oldSlow = swipeRate(12, { lead: false, aim: "hoop" });
    const newSlow = swipeRate(HOOP_SLIDE_AT, { lead: true, aim: "hoop" });
    const oldFast = swipeRate(HOOP_SLIDE_AT, { lead: false, aim: "hoop" });
    const newFast = swipeRate(HOOP_FAST_AT, { lead: true, aim: "hoop" });
    const straight = swipeRate(HOOP_SLIDE_AT, { lead: true, aim: "straight" });
    console.log(`hoops make rates, swipe at the hoop: before ${oldSlow.toFixed(2)} (slow) ${oldFast.toFixed(2)} (fast); after ${newSlow.toFixed(2)} (slow) ${newFast.toFixed(2)} (fast); straight up after ${straight.toFixed(2)}`);
    expect(newSlow).toBeGreaterThanOrEqual(0.5);
    expect(newFast).toBeGreaterThanOrEqual(0.5);
    expect(newSlow).toBeGreaterThan(oldSlow + 0.1);
  });

  it("a still hoop is unchanged: the same swipes make the same", { timeout: 60_000 }, () => {
    const h: Hoop = { x: 0, t: 0 };
    const ball = { x: 0.2, y: START.y, z: START.z };
    const a = launch(ball, h, 0, 0.2, 1.1), b = launch(ball, h, 0, 0.2, 1.1, { lead: false });
    expect(a.vel).toEqual(b.vel);
  });
});

describe("hoops: the keys", () => {
  const keyRate = (hold: (r: () => number) => number, aimSteps: (r: () => number) => number, opts: { n?: number } = {}) => {
    const r = rng(11);
    const n = opts.n ?? 1500;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const hoop: Hoop = { x: 0, t: 0 };
      const ball = { x: (r() - 0.5) * 0.6, y: START.y, z: START.z };
      const power = Math.min(1.6, hold(r) * KEY_CHARGE);
      const aimX = ball.x + aimSteps(r) * KEY_AIM_STEP;
      const l = launch(ball, hoop, 0, aimX, power, { assist: KEY_ASSIST.z, assistX: KEY_ASSIST.x });
      const f = newFlight(ball);
      f.vel = l.vel;
      if (fly(f, hoop, 0).made) made++;
    }
    return made / n;
  };

  it("holding Space for a set time with no aiming no longer swishes every ball", () => {
    // before: aim started on the hoop, charge 1.1 a second, assist 0.55: hold 0.91 s
    const before = (() => {
      const r = rng(5);
      let made = 0;
      for (let i = 0; i < 1000; i++) {
        const hoop: Hoop = { x: 0, t: 0 };
        const ball = { x: (r() - 0.5) * 0.6, y: START.y, z: START.z };
        const l = launch(ball, hoop, 0, 0, Math.min(1.6, (0.91 + gauss(r) * 0.04) * 1.1), { assist: ASSIST });
        const f = newFlight(ball);
        f.vel = l.vel;
        if (fly(f, hoop, 0).made) made++;
      }
      return made / 1000;
    })();
    // after: aim starts under the ball, a faster charge and less sideways assist: a fixed 1 s / KEY_CHARGE hold
    const after = keyRate((r) => 1 / KEY_CHARGE + gauss(r) * 0.04, () => 0);
    console.log(`keys, hold with no aiming: before ${before.toFixed(2)}, after ${after.toFixed(2)}`);
    expect(before).toBeGreaterThan(0.9);
    expect(after).toBeLessThan(0.7);
  });

  it("a player who reads the meter and aims still makes most", () => {
    // aims at the hoop to within one tap, and times the charge to within 40 ms
    const r = rng(3);
    let made = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      const hoop: Hoop = { x: 0, t: 0 };
      const ball = { x: (r() - 0.5) * 0.6, y: START.y, z: START.z };
      const taps = Math.round((0 - ball.x) / KEY_AIM_STEP + gauss(r) * 0.6);
      const l = launch(ball, hoop, 0, ball.x + taps * KEY_AIM_STEP, Math.min(1.6, (1 / KEY_CHARGE + gauss(r) * 0.04) * KEY_CHARGE), { assist: KEY_ASSIST.z, assistX: KEY_ASSIST.x });
      const f = newFlight(ball);
      f.vel = l.vel;
      if (fly(f, hoop, 0).made) made++;
    }
    console.log(`keys, aimed and timed: ${(made / n).toFixed(2)}`);
    expect(made / n).toBeGreaterThan(0.6);
  });
});

describe("hoops: why a shot missed", () => {
  const shot = (aimX: number, power: number) => {
    const hoop: Hoop = { x: 0, t: 0 };
    const ball = { x: 0, y: START.y, z: START.z };
    const f = newFlight(ball);
    f.vel = launch(ball, hoop, 0, aimX, power, { assist: 0 }).vel;
    const res = fly(f, hoop, 0);
    return { res, why: missWhy(f) };
  };

  it("names the side or the depth", () => {
    expect(shot(1.2, 1).why).toBe("RIGHT");
    expect(shot(-1.2, 1).why).toBe("LEFT");
    expect(shot(0, 0.5).why).toBe("SHORT");
    expect(shot(0, 1.5).why).toBe("LONG");
    expect(shot(0, 1).res.made).toBe(true);
  });
});

describe("hoops: how fast a swipe has to be", () => {
  /** swipes aimed at a still hoop at one speed (canvas heights a second), with a little sideways wobble */
  const rate = (v: number, seed = 5) => {
    const r = rng(seed);
    let made = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const hoop: Hoop = { x: 0, t: 0 };
      const ball = { x: (r() - 0.5) * 0.6, y: START.y, z: START.z };
      const vx = (-ball.x / (4.4 - START.z)) * v + gauss(r) * 0.04 * v;
      const sh = swipeShot(vx, -v, ball.x, ball.z, 4.4)!;
      const f = newFlight(ball);
      f.vel = launch(ball, hoop, 0, sh.aimX, sh.power).vel;
      if (fly(f, hoop, 0).made) made++;
    }
    return made / n;
  };

  it("drops across about a doubling of speed, so a quick mouse flick still scores", () => {
    for (const v of [1.3, 1.6, 2.0, 2.4]) expect(rate(v), `${v} heights/s`).toBeGreaterThan(0.6);
  });

  it("a crawl or a slam still misses", () => {
    expect(rate(0.8)).toBeLessThan(0.3);
    expect(rate(3.2)).toBeLessThan(0.3);
  });
});
