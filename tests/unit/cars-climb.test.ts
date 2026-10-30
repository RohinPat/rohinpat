import { describe, expect, it } from "vitest";
import { ENGINE_CAL, NO_INPUT, type NightInput } from "@/components/offhours/engineRemote";
import { NightGame, forgetBestRun, getBestRun, getBestScore } from "@/components/offhours/night/game";
import { CLIMB_MEDALS, MEDALS, medalsAt, nextMedal } from "@/components/offhours/night/medals";
import { ROCK_L, ROCK_R, TUNNEL, BRIDGE, buildRoad, getRoad, headingAt, heightAt } from "@/components/offhours/night/road";
import { getScenery } from "@/components/offhours/night/scenery";
import { getTarget } from "@/components/offhours/night/target";
import { TRACKS, TRACK_IDS } from "@/components/offhours/night/tracks";
import { drive } from "@/components/offhours/night/ai";
import { Attract } from "@/components/offhours/night/attract";
import { newCar, speedOf, stepCar } from "@/components/offhours/night/car";
import { medalHint } from "@/components/offhours/night/hud";
import { BOTS, playRun, type Bot, type RunStat } from "./cars-bots";

// The second track, "The climb": a short, hairpin-heavy road up a mountain, from the same generator as the canyon with its own
// seed, corner mix and rise; its own clock, medals, best run and picture. The canyon must be exactly what it was.

const climb = () => getRoad("climb");
const bot = (name: string): Bot => BOTS.find((b) => b.name === name)!;
const many = (name: string, n: number, level: 0 | 1 | 2 = 1): RunStat[] => Array.from({ length: n }, (_, i) => playRun(bot(name), i + 1, (g) => { g.setTrack("climb"); g.assist = level; }));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** the corners of a road: where each starts and ends, and the radius at its tightest, m */
function corners(r: ReturnType<typeof climb>) {
  const out: { from: number; to: number; radius: number }[] = [];
  let at = -1;
  let peak = 0;
  for (let i = 0; i <= r.n; i++) {
    const k = Math.abs(r.kappa[i]);
    if (k > 1 / 400) {
      if (at < 0) {
        at = i * r.segM;
        peak = 0;
      }
      peak = Math.max(peak, k);
    } else if (at >= 0) {
      out.push({ from: at, to: i * r.segM, radius: 1 / peak });
      at = -1;
    }
  }
  return out;
}

/** a finished run by the target driver's own steering, so a test can have a best run to keep */
function finish(g: NightGame, pace = 0.8) {
  const inp: NightInput = { ...NO_INPUT, throttle: 1 };
  g.start();
  for (let i = 0; i < 60 * 240 && g.phase !== "done"; i++) {
    if (g.phase === "run") drive(g.car, g.road, g.target.plan, pace, inp);
    else Object.assign(inp, { steer: 0, throttle: 1, brake: 0, hand: 0 });
    g.update(1 / 60, inp);
  }
  return g.result!;
}

describe("the tracks", () => {
  it("are the canyon and the climb, with their own words and medals", () => {
    expect(TRACK_IDS).toEqual(["canyon", "climb"]);
    expect(TRACKS.canyon.name).toBe("Canyon");
    expect(TRACKS.climb.name).toBe("Climb");
    expect(TRACKS.canyon.medals).toBe(MEDALS);
    expect(TRACKS.climb.medals).toBe(CLIMB_MEDALS);
    for (const t of [MEDALS, CLIMB_MEDALS]) {
      expect(t).toHaveLength(3);
      expect(t[0].score).toBeLessThan(t[1].score);
      expect(t[1].score).toBeLessThan(t[2].score);
    }
    // the canyon's marks are the ones it had
    expect(MEDALS.map((m) => m.score)).toEqual([15_000, 25_000, 34_000]);
    expect(CLIMB_MEDALS[2].score).toBeLessThan(MEDALS[2].score);
    expect(TRACKS.climb.cleared).not.toBe(TRACKS.canyon.cleared);
    expect(TRACKS.climb.strap).not.toBe(TRACKS.canyon.strap);
  });

  it("score against their own marks", () => {
    expect(medalsAt(9_000)).toBe(0);
    expect(medalsAt(9_000, CLIMB_MEDALS)).toBe(1);
    expect(medalsAt(14_500, CLIMB_MEDALS)).toBe(3);
    expect(nextMedal(10_500, CLIMB_MEDALS)?.name).toBe("GOLD");
    expect(nextMedal(30_000, CLIMB_MEDALS)).toBeNull();
    expect(medalHint(9_000, CLIMB_MEDALS)).toBe("SILVER 10,000");
    // the dash's default is the canyon's
    expect(medalHint(10_000)).toBe("BRONZE 15,000");
  });

  it("the canyon is exactly what it was: its road, its clock and its target driver", () => {
    const r = getRoad();
    expect(r.track).toBe("canyon");
    expect(r.length).toBe(4100);
    expect(r.finish).toBe(3680);
    expect(r.half).toBe(5.4);
    expect(r.railK).toBe(1);
    expect(r.checks).toHaveLength(ENGINE_CAL.road.checkpoints);
    expect(getRoad()).toBe(getRoad("canyon"));
    expect(buildRoad().kappa).toEqual(r.kappa);
    const t = getTarget();
    expect(t.road).toBe(r);
    expect(t.ghost.time).toBeCloseTo(106.0, 0);
    expect(t.startS).toBe(23);
    expect(t.bonusS).toEqual([18, 14, 13.5, 14.5, 17.5, 21.5, 21, 0]);
    expect(TRACKS.canyon.run).toBe(ENGINE_CAL.run);
    expect(TRACKS.canyon.driftPay).toBe(1);
    // a tunnel and a bridge, as ever
    expect(Array.from(r.flags).some((f) => f & TUNNEL)).toBe(true);
    expect(Array.from(r.flags).some((f) => f & BRIDGE)).toBe(true);
  });
});

describe("the climb's road", () => {
  it("is built by the same generator from its own seed, the same every time, and is not the canyon", () => {
    const r = climb();
    expect(r.track).toBe("climb");
    expect(r.seed).toBe(ENGINE_CAL.climb.road.seed);
    expect(buildRoad(undefined, "climb").kappa).toEqual(r.kappa);
    expect(buildRoad(undefined, "climb").y).toEqual(r.y);
    expect(r).not.toBe(getRoad());
    expect(getRoad("climb")).toBe(r);
    expect(r.n).not.toBe(getRoad().n);
  });

  it("is short, a little narrow, with seven gates close together and the last the finish", () => {
    const r = climb();
    const C = ENGINE_CAL.climb.road;
    expect(r.checks).toHaveLength(C.checkpoints);
    expect(r.checks[1] - r.checks[0]).toBe(C.checkEveryM);
    expect(r.finish).toBe(r.checks[r.checks.length - 1]);
    expect(r.finish).toBeLessThan(getRoad().finish / 2);
    expect(r.half).toBeLessThan(getRoad().half);
    expect(r.railK).toBeGreaterThan(1);
  });

  it("is mostly tight corners and hairpins, with short straights between them", () => {
    const r = climb();
    const cs = corners(r);
    expect(cs.length).toBeGreaterThanOrEqual(8);
    const sharp = cs.filter((c) => c.radius < 75).length;
    const tightOrSharp = cs.filter((c) => c.radius < 130).length;
    expect(sharp).toBeGreaterThanOrEqual(5);
    expect(tightOrSharp).toBeGreaterThanOrEqual(cs.length - 1);
    expect(Math.max(...cs.map((c) => c.radius))).toBeLessThan(130);
    // the canyon, by contrast, has long easy bends
    expect(Math.max(...corners(getRoad()).map((c) => c.radius))).toBeGreaterThan(250);
    // between one corner and the next, never a long straight (the start and the run-out aside)
    for (let i = 1; i < cs.length; i++) expect(cs[i].from - cs[i - 1].to).toBeLessThan(140);
    // and the corners turn back and forth: a switchback
    let flips = 0;
    for (let i = 1; i < cs.length; i++) {
      const a = r.kappa[Math.round(((cs[i - 1].from + cs[i - 1].to) / 2) / r.segM)];
      const b = r.kappa[Math.round(((cs[i].from + cs[i].to) / 2) / r.segM)];
      if (Math.sign(a) !== Math.sign(b)) flips++;
    }
    expect(flips).toBeGreaterThanOrEqual(cs.length - 2);
  });

  it("climbs: it rises a couple of hundred metres, never dips far, and tops out at the finish", () => {
    const r = climb();
    expect(heightAt(r, r.finish) - heightAt(r, 0)).toBeGreaterThan(180);
    for (let s = 0; s < r.finish; s += 40) expect(heightAt(r, s + 80)).toBeGreaterThan(heightAt(r, s) - 2);
    // the grade is steep and not a cliff
    for (let s = 0; s < r.finish; s += 40) expect((heightAt(r, s + 40) - heightAt(r, s)) / 40).toBeLessThan(0.3);
  });

  it("has a straight bit of road at every gate and at the start, and neither a tunnel nor a bridge", () => {
    const r = climb();
    for (const g of r.checks) for (let d = -18; d <= 18; d += 4) expect(Math.abs(r.kappa[Math.round((g + d) / r.segM)])).toBeLessThan(1e-6);
    expect(headingAt(r, 100)).toBeCloseTo(0, 6);
    expect(Array.from(r.flags).some((f) => f & (TUNNEL | BRIDGE))).toBe(false);
  });

  it("puts the wall on the inside of a corner that bites, and opens out at the summit", () => {
    const r = climb();
    let inside = 0;
    let checked = 0;
    for (let j = 0; j < r.n; j++) {
      const k = r.kappa[j];
      if (Math.abs(k) > 1 / 420 && j * r.segM < r.finish - 140) {
        checked++;
        const want = k > 0 ? ROCK_R : ROCK_L;
        const other = k > 0 ? ROCK_L : ROCK_R;
        if (r.flags[j] & want && !(r.flags[j] & other)) inside++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(inside).toBe(checked);
    // nothing on the last stretch
    for (let j = Math.round((r.finish - 130) / r.segM); j < r.n; j++) expect(r.flags[j] & (ROCK_L | ROCK_R)).toBe(0);
  });

  it("has its own scenery: pines that give up, a lodge and stands on the summit, masts on the way, low walls at the top", () => {
    const r = climb();
    const sc = getScenery(r);
    expect(sc).not.toBe(getScenery(getRoad()));
    expect(sc.tunnel).toBeNull();
    expect(sc.bridge).toBeNull();
    const kinds = new Set(sc.landmarks.map((l) => l.kind));
    expect(kinds.has("mast")).toBe(true);
    expect(kinds.has("stand")).toBe(true);
    expect(kinds.has("flood")).toBe(true);
    expect(kinds.has("canopy")).toBe(false);
    expect(kinds.has("pylons")).toBe(false);
    expect(kinds.has("towers")).toBe(false);
    // the stands are at the finish
    expect(sc.landmarks.filter((l) => l.kind === "stand" && l.s > r.finish - 100).length).toBeGreaterThanOrEqual(2);
    // pines in the first half, hardly any in the last third
    const count = (kind: number, from: number, to: number) => {
      let n = 0;
      for (let i = Math.round(from / r.segM); i < Math.round(to / r.segM); i++) for (let slot = 0; slot < 4; slot++) if (sc.kind[i * 4 + slot] === kind) n++;
      return n;
    };
    expect(count(1, 0, r.finish / 2)).toBeGreaterThan(count(1, (r.finish * 2) / 3, r.length) * 4);
    expect(count(2, r.finish - 100, r.length)).toBeGreaterThan(0);
    expect(sc.rockTop[Math.round(r.finish / r.segM)]).toBeLessThan(sc.rockTop[Math.round(r.checks[2] / r.segM)]);
  });
});

describe("the climb's run", () => {
  it("is about a minute for the target driver, who finishes it without a hit", () => {
    const t = getTarget("climb");
    expect(t.road).toBe(climb());
    expect(t.ghost.finished).toBe(true);
    expect(t.ghost.time).toBeGreaterThan(55);
    expect(t.ghost.time).toBeLessThan(75);
    expect(t.bonusS).toHaveLength(7);
    expect(t.bonusS[6]).toBe(0);
    expect(getTarget("climb")).toBe(t);
    expect(t).not.toBe(getTarget());
  });

  it("has its own clock, a tighter one, and a slide pays more on a road of slower corners", () => {
    const run = TRACKS.climb.run;
    expect(run.legShare).toBeGreaterThan(1);
    expect(run.railPenaltyS).toBe(ENGINE_CAL.run.railPenaltyS);
    expect(run.checkpointPoints).toBe(ENGINE_CAL.run.checkpointPoints);
    expect(TRACKS.climb.driftPay).toBeGreaterThan(1);
    const t = getTarget("climb");
    const budget = t.startS + t.bonusS.reduce((a, b) => a + b, 0);
    expect(budget).toBeGreaterThan(t.ghost.time * 1.2);
    expect(budget).toBeLessThan(t.ghost.time * 1.6);
  });

  it("a rail on the climb takes more speed than the canyon's, so a hairpin is not a berm", () => {
    // the same push into the rail, on a straight bit of each road: how much speed is left after half a second
    const after = (road: ReturnType<typeof getRoad>) => {
      const c = newCar(60, 0);
      c.u = 30;
      c.psi = 0.3;
      c.lat = road.railHalf - 1.1;
      for (let i = 0; i < 60; i++) stepCar(c, { ...NO_INPUT, throttle: 0.5 }, road, 1 / 120);
      expect(c.scrape || c.hit > 0 || Math.abs(c.lat) > road.railHalf - 1.4).toBe(true);
      return speedOf(c);
    };
    expect(after(climb())).toBeLessThan(after(getRoad()) - 1);
  });
});

describe("the tile", () => {
  it("stays on the canyon: the attract mode replays the canyon's target driver, whatever was picked in the game", () => {
    const g = new NightGame(true, "climb");
    expect(g.track.id).toBe("climb");
    const at = new Attract(true);
    expect(at.target).toBe(getTarget());
    expect(at.scene.road).toBe(getRoad());
    expect(at.scene.road.track).toBe("canyon");
  });
});

describe("the game on two tracks", () => {
  it("starts on the canyon, and can be made on the climb, which takes its road, target, medals and run", () => {
    const g = new NightGame(true);
    expect(g.track.id).toBe("canyon");
    expect(g.road).toBe(getRoad());
    const h = new NightGame(true, "climb");
    expect(h.track.id).toBe("climb");
    expect(h.road).toBe(climb());
    expect(h.target).toBe(getTarget("climb"));
    expect(h.scene.road).toBe(climb());
    expect(h.timeLeft).toBe(getTarget("climb").startS);
    expect(h.phase).toBe("ready");
    expect(h.view().cps).toBe(climb().checks.length);
    expect(g.view().cps).toBe(getRoad().checks.length);
  });

  it("changes road between runs: on the ready screen and the end card, and not on the road", () => {
    forgetBestRun();
    const g = new NightGame(true);
    expect(g.setTrack("climb")).toBe(true);
    expect(g.road).toBe(climb());
    expect(g.scene.road).toBe(climb());
    expect(g.phase).toBe("ready");
    g.start();
    expect(g.phase).toBe("count");
    expect(g.setTrack("canyon")).toBe(false);
    expect(g.track.id).toBe("climb");
    for (let i = 0; i < 60 * 5 && g.phase !== "run"; i++) g.update(1 / 60, { ...NO_INPUT, throttle: 1 });
    expect(g.phase).toBe("run");
    expect(g.setTrack("canyon")).toBe(false);
    expect(g.road).toBe(climb());
    // after a run, the card
    g.timeLeft = 0.05;
    for (let i = 0; i < 60 * 8 && g.phase !== "done"; i++) g.update(1 / 60, { ...NO_INPUT, throttle: 1 });
    expect(g.phase).toBe("done");
    expect(g.setTrack("canyon")).toBe(true);
    expect(g.phase).toBe("ready");
    expect(g.road).toBe(getRoad());
    expect(g.car.s).toBeLessThan(20);
    expect(g.result).toBeNull();
    forgetBestRun();
  });

  it("keeps the best run and the best score for each track, in memory, and races you only on the road you set them on", () => {
    forgetBestRun();
    const g = new NightGame(true);
    g.setTrack("climb");
    const a = finish(g);
    expect(a.finished).toBe(true);
    expect(a.newBest).toBe(true);
    const climbBest = getBestScore("climb");
    expect(climbBest).toBe(a.score);
    expect(getBestRun("climb")).not.toBeNull();
    // the canyon has none
    expect(getBestScore("canyon")).toBe(0);
    expect(getBestScore()).toBe(0);
    expect(getBestRun("canyon")).toBeNull();
    g.setTrack("canyon");
    expect(g.scene.ghosts[1].show).toBe(false);
    g.setTrack("climb");
    expect(g.scene.ghosts[1].show).toBe(true);
    // a run on the canyon keeps its own and leaves the climb's alone
    g.setTrack("canyon");
    const b = finish(g, 0.8);
    expect(b.finished).toBe(true);
    expect(b.prevBestScore).toBe(0);
    expect(getBestScore("canyon")).toBe(b.score);
    expect(getBestScore("climb")).toBe(climbBest);
    forgetBestRun();
    expect(getBestScore("climb")).toBe(0);
    expect(getBestScore("canyon")).toBe(0);
    expect(getBestRun("climb")).toBeNull();
  });

  it("scores medals against the track being driven", () => {
    forgetBestRun();
    const g = new NightGame(true, "climb");
    const seen: number[] = [];
    g.onEvent = (e) => e.kind === "medal" && seen.push(e.n);
    const r = finish(g, 0.85);
    expect(r.medals).toBe(medalsAt(r.score, CLIMB_MEDALS));
    expect(r.next).toEqual(nextMedal(r.bestScore, CLIMB_MEDALS));
    // announced in order, each once, and none above what the run ended with (the points at the finish line come after the last announcement)
    expect(seen).toEqual(Array.from({ length: seen.length }, (_, i) => i + 1));
    expect(seen.length).toBeLessThanOrEqual(r.medals);
    forgetBestRun();
  });
});

describe("what the climb does to the drivers (scripted keyboard drivers, 48 runs each, Light assist)", () => {
  it("a driver who only holds the gas has no medal, with the assist on or off, and neither has one who steers but never brakes", () => {
    for (const level of [0, 1, 2] as const) {
      for (const name of ["gas-only", "gas+steer"]) {
        const rs = many(name, 6, level);
        for (const r of rs) expect(medalsAt(r.score, CLIMB_MEDALS)).toBe(0);
      }
    }
  });

  it("a careful driver finishes and gets bronze, a decent one gets silver, the greedy drifter gold", () => {
    const cautious = many("cautious", 24);
    const decent = many("decent", 48);
    const drifter = many("drifter", 48);
    for (const rs of [cautious, decent, drifter]) expect(rs.every((r) => r.finished)).toBe(true);
    const share = (rs: RunStat[], n: number) => rs.filter((r) => medalsAt(r.score, CLIMB_MEDALS) >= n).length / rs.length;
    expect(share(cautious, 1)).toBeGreaterThan(0.95);
    expect(share(cautious, 2)).toBeLessThan(0.2);
    expect(share(decent, 2)).toBeGreaterThan(0.6);
    expect(share(decent, 3)).toBeLessThan(0.45);
    expect(share(drifter, 3)).toBeGreaterThan(0.6);
    expect(mean(drifter.map((r) => r.score))).toBeGreaterThan(mean(decent.map((r) => r.score)) * 1.15);
    // and a minute or so of driving
    for (const rs of [decent, drifter]) {
      expect(mean(rs.map((r) => r.time))).toBeGreaterThan(55);
      expect(mean(rs.map((r) => r.time))).toBeLessThan(75);
    }
  });

  it("is not a berm: the driver who never brakes finishes no faster than a careful one's score and loses the clean legs", () => {
    const blind = many("gas+steer", 12);
    const careful = many("cautious", 12);
    expect(mean(blind.map((r) => r.score))).toBeLessThan(mean(careful.map((r) => r.score)));
    expect(mean(careful.map((r) => r.clean))).toBeGreaterThan(mean(blind.map((r) => r.clean)) + 3);
  });
});
