import { describe, expect, it } from "vitest";
import { ENGINE_CAL, NO_INPUT, type NightInput } from "@/components/offhours/engineRemote";
import { NightGame } from "@/components/offhours/night/game";
import { ASSIST_DEFAULT, ASSIST_NAMES, assistGain, assistSteer, newAssist, stepFade, type AssistLevel } from "@/components/offhours/night/assist";
import { steerToLine, drive } from "@/components/offhours/night/ai";
import { newCar } from "@/components/offhours/night/car";
import { getRoad } from "@/components/offhours/night/road";
import { getTarget } from "@/components/offhours/night/target";
import { MEDALS, medalsAt } from "@/components/offhours/night/medals";
import { BOTS, playRun, type Bot, type RunStat } from "./cars-bots";
import { newKeyAxes, stepKeys } from "@/components/offhours/night/nightInput";

// The steering assist (Off, Light, Full): a lane-keep for the keys and the touch pads that blends the player's wheel toward
// the racing line, gives way to a key held against it, and lets go while the car slides.

const A = ENGINE_CAL.assist;
const bot = (name: string): Bot => BOTS.find((b) => b.name === name)!;
const many = (name: string, level: AssistLevel, n = 24): RunStat[] => Array.from({ length: n }, (_, i) => playRun(bot(name), i + 1, (g) => (g.assist = level)));
const avg = (rs: RunStat[], f: (r: RunStat) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
const input = (steer = 0, hand = 0): NightInput => ({ ...NO_INPUT, steer, throttle: 1, hand });

describe("the assist's levels", () => {
  it("has three, starts on Light for keys and touch, and the game itself starts with it off", () => {
    expect(ASSIST_NAMES).toEqual(["Off", "Light", "Full"]);
    expect(ASSIST_DEFAULT).toBe(1);
    expect(assistGain(0)).toBe(0);
    expect(assistGain(1)).toBeGreaterThan(0);
    expect(assistGain(2)).toBeGreaterThan(assistGain(1));
    expect(assistGain(2)).toBeLessThan(1);
    expect(new NightGame(true).assist).toBe(0);
  });

  it("steers toward the racing line, and the wheel is the player's when the assist is off", () => {
    const road = getRoad();
    const plan = getTarget().plan;
    const c = newCar(300, 3);
    c.u = 30;
    const line = steerToLine(c, road, plan.line);
    // 3 m right of a line near the middle: the wheel that holds the line is to the left
    expect(line).toBeLessThan(0);
    const off = assistSteer(newAssist(), 0, c, road, plan, input(0.2), 1 / 120);
    expect(off).toBe(0.2);
    const light = assistSteer(newAssist(), 1, c, road, plan, input(0.2), 1 / 120);
    const full = assistSteer(newAssist(), 2, c, road, plan, input(0.2), 1 / 120);
    // each level goes further toward the line's wheel than the one before, and none overshoots it
    expect(light).toBeLessThan(0.2);
    expect(full).toBeLessThan(light);
    expect(full).toBeGreaterThan(line - 1e-9);
  });

  it("leaves a wheel that is already the line's alone: a driver who holds the line is not fought", () => {
    const road = getRoad();
    const plan = getTarget().plan;
    const c = newCar(300, 0);
    c.u = 30;
    const line = steerToLine(c, road, plan.line);
    expect(assistSteer(newAssist(), 2, c, road, plan, input(line), 1 / 120)).toBeCloseTo(line, 9);
  });

  it("steers the target driver the way it always did: the AI and the assist share one function", () => {
    const road = getRoad();
    const plan = getTarget().plan;
    const c = newCar(900, -1.5);
    c.u = 36;
    c.psi = 0.03;
    const out = { ...NO_INPUT };
    drive(c, road, plan, 0.9, out);
    expect(out.steer).toBe(steerToLine(c, road, plan.line));
  });
});

describe("the assist lets go of a slide", () => {
  it("fades out fast with a big body angle, and comes back slowly once the car is straight", () => {
    const st = newAssist();
    expect(stepFade(st, 0, false, false, 0.01)).toBe(1);
    // under the slide's start it is all there
    expect(stepFade(st, A.slipFrom * 0.9, false, false, 0.01)).toBe(1);
    // a drift's angle: gone within a quarter second
    let f = 1;
    for (let i = 0; i < 30; i++) f = stepFade(st, A.slipTo * 1.2, false, false, 1 / 120);
    expect(f).toBeLessThan(0.02);
    // straight again: it does not snap back
    f = stepFade(st, 0, false, false, 1 / 120);
    expect(f).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) f = stepFade(st, 0, false, false, 1 / 120);
    expect(f).toBeGreaterThan(0.3);
    expect(f).toBeLessThan(1);
    for (let i = 0; i < 240; i++) f = stepFade(st, 0, false, false, 1 / 120);
    expect(f).toBe(1);
  });

  it("is off while the handbrake is held, and stays off a moment after it is let go", () => {
    const st = newAssist();
    for (let i = 0; i < 20; i++) stepFade(st, 0, true, false, 1 / 120);
    expect(st.fade).toBe(0);
    // released with the car still straight: held off for holdS, then the ramp
    let t = 0;
    while (stepFade(st, 0, false, false, 1 / 120) === 0 && t < 2) t += 1 / 120;
    expect(t).toBeGreaterThanOrEqual(A.holdS - 0.02);
    expect(t).toBeLessThan(A.holdS + 0.05);
  });

  it("does not steer against a slide: with the car sideways and the handbrake held the wheel is the player's", () => {
    const road = getRoad();
    const plan = getTarget().plan;
    const c = newCar(300, 0);
    c.u = 30;
    c.w = 8;
    c.slip = Math.atan2(c.w, c.u);
    c.hand = 1;
    const st = newAssist();
    for (let i = 0; i < 60; i++) assistSteer(st, 2, c, road, plan, input(0.4, 1), 1 / 120);
    // in the middle of the road (the edge guard is for the rail's side) the player's 0.4 comes back whole
    expect(assistSteer(st, 2, c, road, plan, input(0.4, 1), 1 / 120)).toBe(0.4);
  });

  it("a key press wins: on every level a held key moves the car the way it says, and Full keeps most of the response", () => {
    // hold a key for 0.4 s at speed, in a straight and in corners, and see how far across the road the car goes
    const DT = 1 / 60;
    const press = (level: AssistLevel, dir: 1 | -1, s: number, speed: number) => {
      const g = new NightGame(true);
      g.assist = level;
      g.start();
      while (g.phase !== "run") g.update(DT, { ...NO_INPUT });
      Object.assign(g.car, { s, u: speed, w: 0, r: 0, psi: 0, lat: 0 });
      const axes = newKeyAxes();
      for (let i = 0; i < 24; i++) {
        stepKeys(axes, { dir, gas: true, brake: false }, speed, DT);
        g.update(DT, { steer: axes.steer, throttle: 0.4, brake: 0, hand: 0 });
      }
      return g.car.lat;
    };
    for (const speed of [20, 35])
      for (const s of [260, 1500, 2600])
        for (const dir of [-1, 1] as const) {
          const off = press(0, dir, s, speed);
          for (const level of [1, 2] as AssistLevel[]) {
            const on = press(level, dir, s, speed);
            expect(Math.sign(on)).toBe(dir);
            expect(Math.abs(on)).toBeGreaterThan(Math.abs(off) * 0.4);
          }
        }
  });

  it("a new run starts with all of it on", () => {
    const g = new NightGame(true);
    g.assistState.fade = 0;
    g.assistState.hold = 1;
    g.reset();
    expect(g.assistState.fade).toBe(1);
    expect(g.assistState.hold).toBe(0);
  });
});

describe("what the assist does to a run (scripted keyboard drivers, 24 runs each)", { timeout: 60_000 }, () => {
  it("Light takes a good share off a decent driver's rail hits, and Full is no worse", () => {
    const off = many("decent", 0);
    const light = many("decent", 1);
    const full = many("decent", 2);
    const r = (rs: RunStat[]) => avg(rs, (x) => x.rails);
    // it gives way to the keys now (see "a key press wins"), so it saves fewer rail hits than a wheel pulled to the line would
    expect(r(light)).toBeLessThan(r(off) * 0.85);
    expect(r(full)).toBeLessThan(r(off) * 0.8);
    // they still finish, and a leg driven clean is more common
    expect(light.every((x) => x.finished)).toBe(true);
    expect(avg(light, (x) => x.clean)).toBeGreaterThan(avg(off, (x) => x.clean));
  });

  it("a careful driver is helped most, and everyone still finishes", () => {
    const off = many("cautious", 0, 12);
    const light = many("cautious", 1, 12);
    expect(avg(light, (x) => x.rails)).toBeLessThan(avg(off, (x) => x.rails) * 0.7);
    expect(light.every((x) => x.finished)).toBe(true);
  });

  it("does not take the slide away: the greedy drifter's drift points do not fall, and the points are still the drift", () => {
    const off = many("drifter", 0);
    // Light leaves the slide alone; Full holds the line harder, so a slide is a little shorter, and is still most of the score
    for (const [level, keep] of [[1, 0.9], [2, 0.7]] as [AssistLevel, number][]) {
      const on = many("drifter", level);
      expect(avg(on, (x) => x.drift)).toBeGreaterThan(avg(off, (x) => x.drift) * keep);
      expect(avg(on, (x) => x.drift)).toBeGreaterThan(avg(on, (x) => x.score) * 0.45);
    }
  });

  it("a driver who only holds the gas gets no medal on any level, and Light does not even get them to the end", () => {
    for (const level of [0, 1, 2] as AssistLevel[]) {
      const r = playRun(bot("gas-only"), 1, (g) => (g.assist = level));
      expect(r.medals).toBe(0);
      expect(medalsAt(r.score)).toBe(0);
      expect(r.score).toBeLessThan(MEDALS[0].score * 0.9);
    }
    expect(playRun(bot("gas-only"), 1, (g) => (g.assist = 1)).finished).toBe(false);
  });
});
