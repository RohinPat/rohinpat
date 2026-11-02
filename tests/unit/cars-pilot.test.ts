import { describe, expect, it } from "vitest";
import { ENGINE_CAL } from "@/components/offhours/engineRemote";
import { buildPilot, lineCurvature, racingLine } from "@/components/offhours/night/ai";
import { attractWindow, widestSlide } from "@/components/offhours/night/attract";
import { GHOST_HZ, GHOST_STRIDE } from "@/components/offhours/night/ghost";
import { getRoad } from "@/components/offhours/night/road";
import { getTarget, recordAI } from "@/components/offhours/night/target";
import { TRACKS, type TrackId } from "@/components/offhours/night/tracks";

// The target driver (night/ai.ts: the pilot). Its run is the ghost, the tile's attract mode and the clock's yardstick, so
// what is pinned here is the time it takes, that it keeps off the rails, that it slides the canyon's medium corners, that
// its hands are smooth, and that the same run comes out every time.

const DEG = Math.PI / 180;

type Run = {
  time: number;
  rails: number;
  minClear: number;
  slides: { t0: number; t1: number; peak: number }[];
  rate: number[];
  jerkRms: number;
  jerkMax: number;
  vMax: number;
  vStraight: number;
  handFrames: number;
};

/** drive the pilot round a track and measure it (the steering is read at 60 Hz, as the game's input is) */
function measure(track: TrackId): Run {
  const t = getTarget(track);
  const road = t.road;
  const steer: number[] = [];
  const slides: Run["slides"] = [];
  let rails = 0;
  let was = false;
  let minClear = 99;
  let vMax = 0;
  let sv = 0;
  let sn = 0;
  let hand = 0;
  let n = 0;
  recordAI(road, t.pilot, TRACKS[track].pilot, (c, inp, time) => {
    if (c.s >= road.finish) return;
    if (c.scrape && !was) rails++;
    was = c.scrape;
    const extent = 0.92 * Math.abs(Math.cos(c.psi)) + 2.2 * Math.abs(Math.sin(c.psi));
    minClear = Math.min(minClear, road.railHalf - (Math.abs(c.lat) + extent));
    const v = Math.hypot(c.u, c.w);
    vMax = Math.max(vMax, v);
    if (Math.abs(road.kappa[Math.round(c.s / road.segM)]) < 1 / 600) {
      sv += v;
      sn++;
    }
    if (inp.hand > 0.5) hand++;
    if (n++ % 2 === 0) steer.push(inp.steer);
    // a slide as the game counts it: past 10 degrees at over 11 m/s, joined across gaps under 0.8 s
    if (Math.abs(c.slip) > 10 * DEG && v > 11) {
      const last = slides[slides.length - 1];
      if (last && time - last.t1 < 0.8) {
        last.t1 = time;
        last.peak = Math.max(last.peak, Math.abs(c.slip) / DEG);
      } else slides.push({ t0: time, t1: time, peak: Math.abs(c.slip) / DEG });
    }
  });
  const dt = 1 / 60;
  const rate: number[] = [];
  for (let i = 1; i < steer.length; i++) rate.push((steer[i] - steer[i - 1]) / dt);
  const jerk: number[] = [];
  for (let i = 1; i < rate.length; i++) jerk.push((rate[i] - rate[i - 1]) / dt);
  return {
    time: t.ghost.time,
    rails,
    minClear,
    slides: slides.filter((s) => s.t1 - s.t0 > 0.15),
    rate,
    jerkRms: Math.sqrt(jerk.reduce((a, x) => a + x * x, 0) / jerk.length),
    jerkMax: Math.max(...jerk.map(Math.abs)),
    vMax,
    vStraight: sv / sn,
    handFrames: hand,
  };
}

const runs: Record<TrackId, Run> = { canyon: measure("canyon"), climb: measure("climb") };

describe("the target driver's time", () => {
  it("is what the clock was calibrated on: the canyon about 134.3 s and the climb about 94.4 s, to within 2 s", () => {
    expect(Math.abs(runs.canyon.time - 134.3)).toBeLessThan(2);
    expect(Math.abs(runs.climb.time - 94.4)).toBeLessThan(2);
  });

  it("takes each leg of the canyon and of the climb within 1.5 s of what the clock's bonuses were set on", () => {
    const old = {
      canyon: [16.88, 17.99, 13.73, 12.26, 12.61, 17.53, 22.12, 21.23],
      climb: [11.92, 12.1, 15.26, 14.17, 13.89, 14.39, 12.62],
    };
    for (const track of ["canyon", "climb"] as const) {
      const t = getTarget(track);
      t.legT.forEach((x, i) => expect(Math.abs(x - (i ? t.legT[i - 1] : 0) - old[track][i]), `${track} leg ${i + 1}`).toBeLessThan(1.5));
    }
  });

  it("does not crawl on a straight: it gets over 44 m/s on the canyon, and averages over 32 m/s on the road that is straight (it was 41.6 and 30.8)", () => {
    expect(runs.canyon.vMax).toBeGreaterThan(44);
    expect(runs.canyon.vStraight).toBeGreaterThan(32);
  });
});

describe("the target driver's driving", () => {
  it("never touches a rail, on either road, and keeps most of a metre between the car and the rail at its closest", () => {
    for (const r of Object.values(runs)) {
      expect(r.rails).toBe(0);
      expect(r.minClear).toBeGreaterThan(0.8);
    }
  });

  it("slides the canyon's medium corners with the handbrake (at least three, over 15 degrees at the widest), and keeps the climb's hairpins slow and on the line", () => {
    expect(runs.canyon.slides.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...runs.canyon.slides.map((s) => s.peak))).toBeGreaterThan(15);
    // the handbrake is a flick at a turn-in, not a habit
    expect(runs.canyon.handFrames).toBeGreaterThan(0);
    expect(runs.canyon.handFrames / 120).toBeLessThan(3);
    expect(runs.climb.slides).toHaveLength(0);
    expect(runs.climb.handFrames).toBe(0);
  });

  it("has smooth hands: the steering's jerk is a tenth of what it was (RMS 28 1/s^2 and 930 at worst on the canyon), and it never moves the wheel faster than 4 a second", () => {
    for (const r of Object.values(runs)) {
      expect(r.jerkRms).toBeLessThan(3);
      expect(r.jerkMax).toBeLessThan(120);
      expect(Math.max(...r.rate.map(Math.abs))).toBeLessThan(4);
    }
  });

  it("records the same run every time", () => {
    for (const track of ["canyon", "climb"] as const) {
      const t = getTarget(track);
      const again = recordAI(t.road, buildPilot(t.road, TRACKS[track].pilot, TRACKS[track].run.targetPace), TRACKS[track].pilot);
      expect(again.n).toBe(t.ghost.n);
      expect(again.time).toBe(t.ghost.time);
      expect(Array.from(again.data)).toEqual(Array.from(t.ghost.data));
    }
  });

  it("is a ghost that does not pop: each sample is where the car could be a twentieth of a second on, and it runs past the line", () => {
    for (const track of ["canyon", "climb"] as const) {
      const g = getTarget(track).ghost;
      let worst = 0;
      for (let i = 1; i < g.n; i++) {
        const o = i * GHOST_STRIDE;
        const moved = Math.hypot(g.data[o] - g.data[o - GHOST_STRIDE], g.data[o + 1] - g.data[o + 1 - GHOST_STRIDE]);
        worst = Math.max(worst, moved * GHOST_HZ - Math.max(g.data[o + 3], g.data[o + 3 - GHOST_STRIDE]));
      }
      expect(worst).toBeLessThan(8);
      expect(g.finished).toBe(true);
      expect(g.dist).toBeGreaterThan(getRoad(track).finish);
    }
  });
});

describe("the racing line", () => {
  for (const track of ["canyon", "climb"] as const) {
    it(`${track}: stays inside the width it is given, and bends no more than the centre line at any corner`, () => {
      const road = getRoad(track);
      const w = road.half - TRACKS[track].pilot.marginM;
      const line = racingLine(road, w);
      const kp = lineCurvature(road, line);
      for (let i = 0; i <= road.n; i++) expect(Math.abs(line[i])).toBeLessThanOrEqual(w + 1e-4);
      let gentler = 0;
      let corners = 0;
      for (let i = 0; i < road.n; ) {
        if (Math.abs(road.kappa[i]) > 1 / 400) {
          let j = i;
          let kr = 0;
          let kl = 0;
          while (j < road.n && Math.abs(road.kappa[j]) > 1 / 400 && Math.sign(road.kappa[j]) === Math.sign(road.kappa[i])) {
            kr = Math.max(kr, Math.abs(road.kappa[j]));
            kl = Math.max(kl, Math.abs(kp[j]));
            j++;
          }
          // the tightest bend of the line is no tighter than the road's (to a few percent), and on a good share of the corners it is gentler
          expect(kl).toBeLessThan(kr * 1.06);
          if (kl < kr * 0.95) gentler++;
          corners++;
          i = j;
        } else i++;
      }
      expect(gentler).toBeGreaterThan(corners / 3);
    });
  }

  it("goes out, in to the apex, and out: before the right-hander at 2.6 km it is on the outside, and in it on the inside", () => {
    const road = getRoad("canyon");
    const pilot = getTarget("canyon").pilot;
    const i0 = Math.round(2628 / road.segM);
    const dir = Math.sign(road.kappa[i0 + 12]);
    expect(dir).not.toBe(0);
    expect(pilot.line[i0 - 12] * dir).toBeLessThan(-2);
    let apex = -99;
    for (let i = i0; i < i0 + 40; i++) apex = Math.max(apex, pilot.line[i] * dir);
    expect(apex).toBeGreaterThan(2.4);
  });
});

describe("the tile", () => {
  it("loops a stretch with a slide over fifteen degrees in it, replayed from the same run", () => {
    const g = getTarget().ghost;
    const t = widestSlide(g);
    expect(Math.abs(g.data[Math.round(t * GHOST_HZ) * GHOST_STRIDE + 4])).toBeGreaterThan(15 * DEG);
    const w = attractWindow(g);
    expect(t).toBeGreaterThan(w.from);
    expect(t).toBeLessThan(w.to);
    expect(ENGINE_CAL.pilot.slides).toBe(true);
  });
});
