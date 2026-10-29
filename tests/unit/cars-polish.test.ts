import { describe, expect, it } from "vitest";
import { NO_INPUT, type NightInput } from "@/components/offhours/engineRemote";
import { NightGame, forgetBestRun, getBestScore, type GameEvent } from "@/components/offhours/night/game";
import { MEDALS, medalsAt, nextMedal } from "@/components/offhours/night/medals";
import { MARK_N, clearFx, mark, newFx } from "@/components/offhours/night/fx";
import { newCar, resetCar, stepCar } from "@/components/offhours/night/car";
import { getRoad } from "@/components/offhours/night/road";
import { getTarget } from "@/components/offhours/night/target";
import { drive } from "@/components/offhours/night/ai";
import { stepKeySteer } from "@/components/offhours/night/nightInput";
import { deltaText } from "@/components/offhours/night/hud";
import { DRAG_GHOST_DT, gapToGhost, ghostAt, ghostTimeAt } from "@/components/offhours/dragGhost";

// Cars, second polish pass: the pieces that can be pinned without a browser.

const inp = (steer = 0, throttle = 0, brake = 0, hand = 0): NightInput => ({ steer, throttle, brake, hand });
const DT = 1 / 60;

/** drive the whole canyon the way a keyboard player would: steer to the target's line with a keyboard's ramp, at `pace` of the plan's speed (or gas only) */
function canyon(pace: number | "gas", steer: "none" | "keys") {
  forgetBestRun();
  const g = new NightGame(true);
  const plan = getTarget().plan;
  const ai = { ...NO_INPUT };
  const input = inp(0, 1);
  let ks = 0;
  g.start();
  for (let i = 0; i < 60 * 260 && g.phase !== "done"; i++) {
    if (g.phase === "run") {
      drive(g.car, g.road, plan, pace === "gas" ? 9 : pace, ai);
      if (steer === "keys") {
        ks = stepKeySteer(ks, ai.steer > 0.12 ? 1 : ai.steer < -0.12 ? -1 : 0, DT);
        input.steer = ks;
      }
      input.throttle = pace === "gas" ? 1 : ai.throttle;
      input.brake = pace === "gas" ? 0 : ai.brake;
    }
    g.update(DT, input);
  }
  const out = { phase: g.phase, score: g.score, finished: g.result?.finished ?? false };
  forgetBestRun();
  return out;
}

describe("cars: medals", () => {
  it("counts the marks a score has reached and names the next", () => {
    expect(MEDALS.map((m) => m.name)).toEqual(["BRONZE", "SILVER", "GOLD"]);
    expect(medalsAt(0)).toBe(0);
    expect(medalsAt(MEDALS[0].score - 1)).toBe(0);
    expect(medalsAt(MEDALS[0].score)).toBe(1);
    expect(medalsAt(MEDALS[1].score)).toBe(2);
    expect(medalsAt(1e9)).toBe(3);
    expect(nextMedal(0)?.name).toBe("BRONZE");
    expect(nextMedal(MEDALS[1].score)?.name).toBe("GOLD");
    expect(nextMedal(MEDALS[2].score)).toBeNull();
  });

  it("sit where driving of different care lands: flooring it blind is under bronze, a driver at the target's pace clears it, a careful one clears silver", () => {
    const blind = canyon("gas", "none");
    expect(blind.phase).toBe("done");
    expect(medalsAt(blind.score)).toBe(0);
    const racing = canyon(1.0, "keys");
    expect(medalsAt(racing.score)).toBeGreaterThanOrEqual(1);
    const careful = canyon(0.75, "keys");
    expect(careful.finished).toBe(true);
    expect(medalsAt(careful.score)).toBeGreaterThanOrEqual(2);
  });

  it("are announced when the score crosses them, once each, and are in the result with the next one to go for", () => {
    forgetBestRun();
    const g = new NightGame(true);
    const seen: GameEvent[] = [];
    g.onEvent = (e) => seen.push(e);
    g.start();
    for (let i = 0; i < 60 * 4; i++) g.update(DT, inp(0, 1));
    expect(g.medals).toBe(0);
    g.bonusPoints = MEDALS[0].score + 10;
    for (let i = 0; i < 6; i++) g.update(DT, inp(0, 1));
    expect(seen.filter((e) => e.kind === "medal")).toEqual([{ kind: "medal", n: 1 }]);
    expect(g.toasts.some((t) => t.text === "BRONZE")).toBe(true);
    g.bonusPoints = MEDALS[1].score + 10;
    for (let i = 0; i < 6; i++) g.update(DT, inp(0, 1));
    expect(seen.filter((e) => e.kind === "medal").map((e) => (e as { n: number }).n)).toEqual([1, 2]);
    g.timeLeft = 0.1;
    for (let i = 0; i < 60 * 6; i++) g.update(DT, inp(0, 1));
    expect(g.result).toMatchObject({ medals: 2, bestMedals: 2, next: { name: "GOLD" } });
    forgetBestRun();
  });
});

describe("cars: what the screen says", () => {
  it("prints the gap to the target with a sign and a colour that agree with the number", () => {
    expect(deltaText(0)).toBe("0.0s");
    expect(deltaText(-2)).toBe("−0.2s");
    expect(deltaText(13)).toBe("+1.3s");
    // a gap that rounds to nothing is never shown as ahead or behind
    expect(deltaText(Math.round(0.04 * 10))).toBe("0.0s");
    expect(deltaText(Math.round(-0.04 * 10))).toBe("0.0s");
  });

  it("shows one slide's payout at a time by the drift panel, and two words at most over the road", () => {
    const g = new NightGame(true);
    g.toast("+10", "drift", "drift", 2, "bank");
    g.toast("+20", "drift", "drift", 2, "bank");
    expect(g.toasts.filter((t) => t.slot === "bank").map((t) => t.text)).toEqual(["+20"]);
    g.toast("A", "", "good");
    g.toast("B", "", "good");
    g.toast("C", "", "bad");
    expect(g.toasts.filter((t) => t.slot === "main").map((t) => t.text)).toEqual(["B", "C"]);
    expect(g.toasts.filter((t) => t.slot === "bank")).toHaveLength(1);
  });

  it("does not toast a rail that cost almost nothing", () => {
    const g = new NightGame(true);
    g.start();
    for (let i = 0; i < 60 * 4; i++) g.update(DT, inp(0, 1));
    g.drift.base = 6;
    g.drift.combo = 1;
    g.drift.sliding = true;
    g.car.lat = getRoad().railHalf - 0.9;
    g.car.psi = 0.3;
    g.car.u = 40;
    const hits = g.hitN;
    for (let i = 0; i < 30; i++) g.update(DT, inp(1, 1));
    expect(g.hitN).toBeGreaterThan(hits);
    expect(g.toasts.some((t) => t.text === "COMBO LOST")).toBe(false);
  });

  it("coaches a first run, once each, and a later run not at all", () => {
    forgetBestRun();
    const g = new NightGame(true);
    g.start();
    expect(g.firstRun).toBe(true);
    for (let i = 0; i < 60 * 5; i++) g.update(DT, inp(0, 1));
    expect(g.coach).toBe("steer");
    expect(g.coachT).toBeGreaterThan(0);
    g.timeLeft = 0.1;
    for (let i = 0; i < 60 * 6; i++) g.update(DT, inp(0, 1));
    expect(g.phase).toBe("done");
    expect(getBestScore()).toBeGreaterThanOrEqual(0);
    // a score of 0 is no best: make this one count
    forgetBestRun();
    const h = new NightGame(true);
    h.start();
    for (let i = 0; i < 60 * 4; i++) h.update(DT, inp(0, 1));
    h.bonusPoints = 500;
    h.timeLeft = 0.1;
    for (let i = 0; i < 60 * 6; i++) h.update(DT, inp(0, 1));
    expect(getBestScore()).toBeGreaterThan(0);
    h.start();
    h.update(DT, inp(0, 1));
    expect(h.firstRun).toBe(false);
    for (let i = 0; i < 60 * 5; i++) h.update(DT, inp(0, 1));
    expect(h.coach).toBe("");
    forgetBestRun();
  });
});

describe("cars: the feel", () => {
  it("launches with smoke and a punch of the lens, and with reduced motion only the smoke", () => {
    const run = (reduce: boolean) => {
      const g = new NightGame(reduce);
      g.start();
      let kick = 0;
      let puffs = 0;
      for (let i = 0; i < 60 * 3.4; i++) {
        g.update(DT, inp(0, 1));
        if (g.phase === "run") {
          kick = Math.max(kick, g.scene.cam.kick);
          for (let k = 0; k < g.scene.fx.slife.length; k++) if (g.scene.fx.sage[k] < g.scene.fx.slife[k]) puffs++;
        }
      }
      return { kick, puffs };
    };
    const full = run(false);
    expect(full.kick).toBeGreaterThan(0.5);
    expect(full.puffs).toBeGreaterThan(10);
    const calm = run(true);
    expect(calm.kick).toBe(0);
    expect(calm.puffs).toBeGreaterThan(10);
  });

  it("trails the car on the throttle and closes up on the brakes, and holds still with reduced motion", () => {
    const lean = (reduce: boolean, brake: boolean) => {
      const g = new NightGame(reduce);
      g.start();
      for (let i = 0; i < 60 * 3; i++) g.update(DT, inp(0, 1));
      let l = 0;
      for (let i = 0; i < 60 * 1.2; i++) {
        g.update(DT, brake ? inp(0, 0, 1) : inp(0, 1));
        l = g.scene.cam.lean;
      }
      return l;
    };
    expect(lean(false, false)).toBeGreaterThan(0.3);
    expect(lean(false, true)).toBeLessThan(-0.3);
    expect(lean(true, false)).toBe(0);
    expect(lean(true, true)).toBe(0);
  });

  it("lays skid marks while the tail is out and none on a straight, and none with reduced motion", () => {
    const marks = (reduce: boolean, slide: boolean) => {
      const g = new NightGame(reduce);
      g.start();
      for (let i = 0; i < 60 * 5.6; i++) g.update(DT, inp(0, 1));
      const base = g.scene.fx.markN;
      // well past the launch's burnout, then either keep straight or throw the tail out
      for (let i = 0; i < 60 * 3.5; i++) g.update(DT, slide && i > 60 * 1.5 ? inp(1, 1, 0, 1) : inp(0, 1));
      return { base, after: g.scene.fx.markN };
    };
    const straight = marks(false, false);
    expect(straight.base).toBeGreaterThan(0);
    // (the burnout of the launch is the only rubber on the opening straight)
    expect(straight.after).toBeLessThan(straight.base + 6);
    const slide = marks(false, true);
    expect(slide.after).toBeGreaterThan(slide.base + 8);
    expect(marks(true, true)).toEqual({ base: 0, after: 0 });
  });

  it("keeps a ring of marks, ends a line with a zero, and clears with the run", () => {
    const fx = newFx();
    for (let i = 0; i < MARK_N + 20; i++) mark(fx, 0, i, 0, 1);
    expect(fx.markN).toBe(MARK_N);
    // the newest is the last one laid
    expect(fx.ms[0][(fx.markI[0] - 1 + MARK_N) % MARK_N]).toBe(MARK_N + 19);
    mark(fx, 0, 1, 0, 0);
    expect(fx.ma[0][(fx.markI[0] - 1 + MARK_N) % MARK_N]).toBe(0);
    clearFx(fx);
    expect(fx.markN).toBe(0);
    expect(fx.ma[0].every((v) => v === 0)).toBe(true);
  });

  it("cracks the exhaust when the throttle comes off at high revs, and says so on every gear change", () => {
    const road = getRoad();
    const c = newCar(12, 0);
    const seen: number[] = [];
    let lifts = 0;
    for (let i = 0; i < 120 * 9; i++) {
      stepCar(c, inp(0, 1), road, 1 / 120);
      c.hit = 0;
      if (c.shifted) {
        seen.push(c.shifted);
        c.shifted = 0;
      }
    }
    // a run of upshifts through the box, no downshift on the way up
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((s) => s === 1)).toBe(true);
    expect(c.rpm).toBeGreaterThan(5200);
    for (let i = 0; i < 12; i++) {
      stepCar(c, inp(0, 0), road, 1 / 120);
      if (c.lift) lifts++;
    }
    expect(lifts).toBeGreaterThan(0);
    // and not off the line, at low revs
    const d = newCar(12, 0);
    resetCar(d, 12, 0);
    for (let i = 0; i < 60; i++) stepCar(d, inp(0, 1), road, 1 / 120);
    d.lift = false;
    for (let i = 0; i < 12; i++) stepCar(d, inp(0, 0), road, 1 / 120);
    expect(d.lift).toBe(false);
  });

  it("tells the page about a hard upshift, a crackle and the revs of the launch", () => {
    const g = new NightGame(true);
    const seen: GameEvent[] = [];
    g.onEvent = (e) => seen.push(e);
    g.start();
    for (let i = 0; i < 60 * 12; i++) g.update(DT, inp(0, 1));
    for (let i = 0; i < 30; i++) g.update(DT, inp(0, 0));
    const go = seen.find((e) => e.kind === "go") as { kind: "go"; rpm: number } | undefined;
    expect(go?.rpm).toBeGreaterThan(4000);
    expect(seen.some((e) => e.kind === "shift" && e.up && e.hard)).toBe(true);
    expect(seen.some((e) => e.kind === "backfire")).toBe(true);
  });

  it("lights the corner warning sooner than it did for a driver who floors it on the opening straight and steers with the keys", () => {
    const g = new NightGame(true);
    const plan = getTarget().plan;
    const ai = { ...NO_INPUT };
    const input = inp(0, 1);
    let ks = 0;
    g.start();
    let at = -1;
    for (let i = 0; i < 60 * 30 && at < 0; i++) {
      if (g.phase === "run") {
        drive(g.car, g.road, plan, 9, ai);
        ks = stepKeySteer(ks, ai.steer > 0.12 ? 1 : ai.steer < -0.12 ? -1 : 0, DT);
        input.steer = ks;
      }
      g.update(DT, input);
      if (g.cue.on) at = g.clock;
    }
    // 14.2 s into the run with the 1.5 s look-ahead and its 3% margin
    expect(at).toBeGreaterThan(8);
    expect(at).toBeLessThan(14);
  });
});

describe("cars: the strip's ghost", () => {
  /** a car that gains 20 m a second, sampled as the strip records it, to the line at 402.3 m */
  const path = Float32Array.from({ length: Math.ceil(402.3 / 20 / DRAG_GHOST_DT) + 2 }, (_, i) => Math.min(402.3, i * DRAG_GHOST_DT * 20));

  it("reads where the ghost was at a time, and waits on the line when it is done", () => {
    expect(ghostAt(path, 0)).toBe(0);
    expect(ghostAt(path, 5)).toBeCloseTo(100, 0);
    expect(ghostAt(path, 5.025)).toBeCloseTo(100.5, 0);
    expect(ghostAt(path, 99)).toBeCloseTo(402.3, 3);
    expect(ghostAt(new Float32Array(0), 3)).toBe(0);
  });

  it("finds when the ghost was at a distance, or says it never was", () => {
    expect(ghostTimeAt(path, 100)).toBeCloseTo(5, 1);
    expect(ghostTimeAt(path, 0)).toBe(0);
    expect(ghostTimeAt(path, 402)).not.toBeNull();
    expect(ghostTimeAt(path, 500)).toBeNull();
    expect(ghostTimeAt(new Float32Array(0), 1)).toBeNull();
  });

  it("gives the gap at the same distance: behind is positive, ahead is negative", () => {
    // the car is at 100 m at 6 s; the ghost was there at 5 s
    expect(gapToGhost(path, 6, 100)).toBeCloseTo(1, 1);
    expect(gapToGhost(path, 4, 100)).toBeCloseTo(-1, 1);
    expect(gapToGhost(path, 4, 9999)).toBeNull();
  });
});
