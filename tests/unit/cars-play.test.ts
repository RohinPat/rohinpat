import { describe, expect, it } from "vitest";
import { ENGINE_CAL, NO_INPUT, type NightInput } from "@/components/offhours/engineRemote";
import { NightGame, forgetBestRun, railPenalty } from "@/components/offhours/night/game";
import { MEDALS, medalsAt } from "@/components/offhours/night/medals";
import { getRoad } from "@/components/offhours/night/road";
import { getTarget } from "@/components/offhours/night/target";
import { drive, planSpeed } from "@/components/offhours/night/ai";
import { adviceFor, secs, MANY_RAILS, type AdviceInput } from "@/components/offhours/night/advice";
import { cornerPay, driftRate, newDrift, stepDrift } from "@/components/offhours/night/score";
import { keySteerFeel, newKeyAxes, resolveInput, noSources, stepKeyPedal, stepKeys } from "@/components/offhours/night/nightInput";
import { attractWindow } from "@/components/offhours/night/attract";
import { freshCar, parEt, dragAdvice, noteRun, shiftUp, stepDrag, sinceAmber, treeTime, FALSE_START_S, LAUNCH, SIXTY_FT, SLOW_START_S, TREE_GAP_JITTER_S, TREE_GAP_S, TREE_GREEN_S, TREE_WAIT, QUARTER, type DragCar } from "@/components/offhours/dragModel";
import { SHIFT_AT, LIMIT } from "@/components/offhours/engineModel";
import { BOTS, playRun, type Bot, type RunStat } from "./cars-bots";
import { DRAG_BOTS, runDrag } from "./cars-dragbots";

// Cars, third polish pass: how it plays. Scripted keyboard drivers (cars-bots.ts) drive the real game through the real key
// functions, so what is pinned here is the spread between a blind driver, a careful one, a decent one and a greedy drifter.

const DT = 1 / 60;
const bot = (name: string): Bot => BOTS.find((b) => b.name === name)!;
const many = (name: string, n = 4, assist: 0 | 1 | 2 = 1): RunStat[] => Array.from({ length: n }, (_, i) => playRun(bot(name), i + 1, (g) => (g.assist = assist)));
const avg = (rs: RunStat[], f: (r: RunStat) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
const inp = (steer = 0, throttle = 0, brake = 0, hand = 0): NightInput => ({ steer, throttle, brake, hand });

describe("cars: the spread between drivers", () => {
  it("a blind driver on the gas is out of time before the last gate, and gets no medal", () => {
    const r = playRun(bot("gas-only"), 1);
    expect(r.finished).toBe(false);
    expect(r.cp).toBeLessThan(ENGINE_CAL.road.checkpoints);
    expect(medalsAt(r.score)).toBe(0);
    expect(r.score).toBeLessThan(MEDALS[0].score / 2);
  });

  // 16 seeded runs of each scripted driver, the assist Light (the default) and Off, on the canyon (the climb's are in cars-climb.test.ts)
  describe("the drivers, 16 runs each", { timeout: 60_000 }, () => {
    const runs = (name: string, assist: 0 | 1) => many(name, 16, assist);
    const fin = (rs: RunStat[]) => rs.filter((r) => r.finished);
    const beat = (rs: RunStat[]) => fin(rs).filter((r) => r.vsTarget! < 0).length;
    const medalled = (rs: RunStat[], n: number) => rs.filter((r) => medalsAt(r.score) >= n).length;

    for (const assist of [1, 0] as const) {
      const lvl = assist === 1 ? "Light" : "Off";

      it(`assist ${lvl}: held gas, with or without steering, never beats the target and never medals`, () => {
        for (const name of ["gas-only", "gas+steer"]) {
          const rs = runs(name, assist);
          expect(beat(rs)).toBe(0);
          expect(medalled(rs, 1)).toBe(0);
        }
        // a rail every corner or so: this is where the time, the clock and the clean legs go
        const rs = runs("gas+steer", assist);
        expect(avg(rs, (r) => r.rails)).toBeGreaterThan(5);
        expect(avg(rs, (r) => r.clean)).toBeLessThan(2);
      });

      it(`assist ${lvl}: the drifters, the decent driver and the careful ones all finish, with some clock left`, () => {
        for (const name of ["cautious", "careful-drifter", "decent", "precise", "drifter"]) {
          const rs = runs(name, assist);
          expect(fin(rs).length, name).toBeGreaterThanOrEqual(15);
          expect(avg(fin(rs), (r) => r.timeLeftEnd), name).toBeGreaterThan(4);
          // a clock that is felt: about 12 to 20 s, where it was 30 for a careful run
          expect(avg(fin(rs), (r) => r.timeLeftEnd), name).toBeLessThan(24);
        }
      });

      it(`assist ${lvl}: the target is beaten by the drifters most of the time and by the decent driver sometimes`, () => {
        expect(beat(runs("precise", assist))).toBeGreaterThanOrEqual(10);
        expect(beat(runs("drifter", assist))).toBeGreaterThanOrEqual(10);
        expect(beat(runs("decent", assist))).toBeGreaterThanOrEqual(1);
        expect(beat(runs("careful-drifter", assist))).toBeGreaterThanOrEqual(10);
      });

      it(`assist ${lvl}: skill ranks (the drifters score clearly more than the decent and the cautious), and the medals sit where it lands`, () => {
        const cautious = runs("cautious", assist);
        const decent = runs("decent", assist);
        const precise = runs("precise", assist);
        const drifter = runs("drifter", assist);
        for (const hi of [precise, drifter]) for (const lo of [cautious, decent]) expect(avg(hi, (r) => r.score)).toBeGreaterThan(avg(lo, (r) => r.score) * 1.2);
        expect(avg(drifter, (r) => r.drift)).toBeGreaterThan(avg(decent, (r) => r.drift) * 1.5);
        // bronze is common for the cautious, silver for the decent, and gold is reached, by the drifter and (with the assist) the precise one
        expect(medalled(cautious, 1)).toBeGreaterThanOrEqual(10);
        expect(medalled(decent, 1)).toBeGreaterThanOrEqual(8);
        expect(medalled(decent, 2)).toBeGreaterThanOrEqual(2);
        expect(medalled(drifter, 3)).toBeGreaterThanOrEqual(1);
        expect(medalled(drifter, 3)).toBeLessThanOrEqual(8);
        if (assist === 1) expect(medalled(precise, 3)).toBeGreaterThanOrEqual(1);
        expect(medalled(precise, 2)).toBeGreaterThanOrEqual(5);
      });
    }

    it("a careful drifter keeps off the rails and finishes with the clock to spare", () => {
      const rs = runs("careful-drifter", 1);
      expect(avg(rs, (r) => r.rails)).toBeLessThan(8);
      expect(avg(rs, (r) => r.clean)).toBeGreaterThan(2);
    });

    it("a cautious driver has few rail hits and a lot of clean legs", () => {
      const rs = runs("cautious", 1);
      expect(avg(rs, (r) => r.rails)).toBeLessThan(5);
      expect(avg(rs, (r) => r.clean)).toBeGreaterThan(4);
    });

    it("the clock on offer is about what the target driver needs (and the target is the slow one)", () => {
      const t = getTarget();
      const budget = t.startS + t.bonusS.reduce((a, b) => a + b, 0);
      expect(budget).toBeGreaterThan(t.ghost.time * 0.9);
      expect(budget).toBeLessThan(t.ghost.time * 1.15);
    });
  });

  it("does not pay a slalom down the straights", () => {
    forgetBestRun();
    const g = new NightGame(true);
    const plan = getTarget().plan;
    const ai = { ...NO_INPUT };
    const keys = newKeyAxes();
    const input = inp(0, 1);
    let sgn = 1;
    let flip = 0;
    g.start();
    for (let i = 0; i < 60 * 120 && g.phase !== "done"; i++) {
      if (g.phase === "run") {
        const c = g.car;
        const v = Math.hypot(c.u, c.w);
        drive(c, g.road, plan, 1, ai);
        const straight = Math.abs(g.road.kappa[Math.round((c.s + 20) / g.road.segM)] || 0) < 1 / 400;
        let dir = ai.steer > 0.12 ? 1 : ai.steer < -0.12 ? -1 : 0;
        let hand = false;
        if (straight && g.clock > 5) {
          if (g.clock - flip > 0.9) {
            sgn = -sgn;
            flip = g.clock;
          }
          dir = sgn;
          hand = g.clock - flip < 0.3;
        }
        const target = straight ? 30 : planSpeed(plan, g.road, c.s + 0.25 * v);
        stepKeys(keys, { dir, gas: target - v > -0.5, brake: !straight && target - v < -2 }, v, DT);
        input.steer = keys.steer;
        input.throttle = keys.gas;
        input.brake = keys.brake;
        input.hand = hand ? 1 : 0;
      } else {
        input.throttle = 1;
        keys.gas = 1;
      }
      g.update(DT, input);
    }
    // it slides, but out of time with a medal nowhere near
    expect(g.result?.finished).toBe(false);
    expect(g.score).toBeLessThan(MEDALS[0].score);
    forgetBestRun();
  });
});

describe("cars: the road teaches, and is not long", () => {
  it("has a bend to brake for within the first three hundred metres or so, and one every few hundred after", () => {
    const road = getRoad();
    const corners: number[] = [];
    for (let i = 0; i < road.n; ) {
      if (Math.abs(road.kappa[i]) > 1 / 330) {
        corners.push(i * road.segM);
        const sg = Math.sign(road.kappa[i]);
        while (i < road.n && Math.abs(road.kappa[i]) > 1 / 330 && Math.sign(road.kappa[i]) === sg) i++;
      } else i++;
    }
    expect(corners[0]).toBeLessThan(340);
    expect(corners.filter((s) => s < road.finish).length).toBeGreaterThanOrEqual(10);
    for (let k = 1; k < corners.length; k++) if (corners[k] < road.finish) expect(corners[k] - corners[k - 1]).toBeLessThan(620);
    // the first one is a medium bend (the plan allows under 100 mph there), so a driver at full speed has to lift for it
    const t = getTarget();
    const first = Math.round(corners[0] / road.segM);
    expect(Math.min(...Array.from(t.plan.vmax.slice(first, first + 25))) * 2.237).toBeLessThan(100);
  });

  it("counts the rail penalties in the time it measures against the target, harder hits more, and says them as \"3.5 S\", not \"−4 S\"", () => {
    const t = getTarget();
    for (const r of many("careful-drifter", 6).filter((x) => x.finished)) {
      const pens = r.railInto.reduce((a, into) => a + railPenalty(ENGINE_CAL.run, into), 0);
      expect(r.vsTarget!).toBeCloseTo(r.time + pens - t.ghost.time, 1);
    }
    // a brush costs about the base, a flat-out hit a good deal more, and no more than the cap
    expect(railPenalty(ENGINE_CAL.run, 1)).toBeLessThan(1);
    expect(railPenalty(ENGINE_CAL.run, 10)).toBeGreaterThan(railPenalty(ENGINE_CAL.run, 5) * 2);
    expect(railPenalty(ENGINE_CAL.run, 40)).toBe(ENGINE_CAL.run.railPenaltyMaxS);
    expect(secs(2)).toBe("2 S");
    expect(secs(3.5)).toBe("3.5 S");
    expect(secs(7)).toBe("7 S");
  });

  it("is a bit over two minutes for the target driver, a driver who keeps off the rails", () => {
    const t = getTarget();
    expect(t.ghost.time).toBeGreaterThan(115);
    expect(t.ghost.time).toBeLessThan(145);
    expect(getRoad().finish).toBeLessThan(4200);
  });
});

describe("cars: the rail costs", () => {
  /** put the car on the rail at speed and leave it there for `s` seconds */
  function grind(g: NightGame, s: number) {
    for (let i = 0; i < 60 * s; i++) {
      g.car.u = Math.max(g.car.u, 30);
      g.car.w = 3;
      g.car.lat = g.road.railHalf - 0.9 + 0.2;
      g.update(DT, inp(1, 1));
    }
  }

  it("takes seconds off the clock for a touch, once for grinding along it, and again for a second touch after a gap", () => {
    forgetBestRun();
    const g = new NightGame(true);
    g.start();
    for (let i = 0; i < 60 * 8; i++) g.update(DT, inp(0, 1));
    expect(g.phase).toBe("run");
    const left = g.timeLeft;
    const t0 = g.clock;
    grind(g, 1.2);
    expect(g.rails).toBe(1);
    // the clock ran for the time that went by and the penalty came off it as well
    expect(left - g.timeLeft).toBeGreaterThan(ENGINE_CAL.run.railPenaltyS * ENGINE_CAL.run.railClockShare + (g.clock - t0) - 0.1);
    expect(g.penaltyShown).toBeGreaterThan(0);
    // clear of it for a couple of seconds, then back
    g.car.lat = 0;
    g.car.psi = 0;
    g.car.w = 0;
    for (let i = 0; i < 60 * 2; i++) {
      g.car.lat = 0;
      g.update(DT, inp(0, 1));
    }
    grind(g, 0.5);
    expect(g.rails).toBe(2);
    forgetBestRun();
  });

  it("pays a clean leg at the gate and not a leg with a touch in it", () => {
    forgetBestRun();
    const run = (touch: boolean) => {
      const g = new NightGame(true);
      g.start();
      for (let i = 0; i < 60 * 4; i++) g.update(DT, inp(0, 1));
      g.car.lat = 0;
      g.car.psi = 0;
      if (touch) grind(g, 0.3);
      g.car.lat = 0;
      g.car.psi = 0;
      g.car.w = 0;
      g.car.s = g.road.checks[0] - 6;
      g.car.u = 20;
      const before = g.bonusPoints;
      for (let i = 0; i < 30; i++) {
        g.car.lat = 0;
        g.car.psi = 0;
        g.update(DT, inp(0, 1));
      }
      expect(g.cp).toBe(1);
      return { gain: g.bonusPoints - before, clean: g.cleanLegs, toast: g.toasts.map((t) => t.sub).join("|") };
    };
    const clean = run(false);
    const dirty = run(true);
    expect(clean.gain).toBe(ENGINE_CAL.run.checkpointPoints + ENGINE_CAL.run.cleanLegPoints);
    expect(clean.clean).toBe(1);
    expect(clean.toast).toContain("CLEAN");
    expect(dirty.gain).toBe(ENGINE_CAL.run.checkpointPoints);
    expect(dirty.clean).toBe(0);
    expect(dirty.toast).not.toContain("CLEAN");
    forgetBestRun();
  });
});

describe("cars: what a slide pays", () => {
  it("pays all of it in a corner and a share of it on a straight, and in between a share", () => {
    expect(cornerPay(0)).toBeCloseTo(ENGINE_CAL.drift.straightPay, 5);
    expect(cornerPay(1 / ENGINE_CAL.drift.refRadiusM)).toBeCloseTo(1, 5);
    expect(cornerPay(-1 / 100)).toBe(1);
    expect(cornerPay(1 / 600)).toBeGreaterThan(cornerPay(0));
    expect(cornerPay(1 / 600)).toBeLessThan(1);
  });

  it("earns less for the same slide on a straight", () => {
    const earn = (kappa?: number) => {
      const d = newDrift();
      for (let i = 0; i < 120; i++) stepDrift(d, 30 * (Math.PI / 180), 35, 1 / 60, kappa);
      return d.base;
    };
    expect(earn(0)).toBeCloseTo(earn(1 / 100) * ENGINE_CAL.drift.straightPay, 3);
    expect(earn()).toBeCloseTo(earn(1 / 100), 3);
    // and more for the same angle at more speed
    expect(driftRate(0.5, 40)).toBeGreaterThan(driftRate(0.5, 20) * 3.9);
  });
});

describe("cars: the keys", () => {
  it("ramps the keyboard's pedals: a tap is a touch, a hold climbs to the floor, and it comes off faster than it went on", () => {
    const C = ENGINE_CAL;
    const first = stepKeyPedal(0, true, DT, C.keyGasS, C.keyGasOffS, C.keyGasSnap);
    expect(first).toBeCloseTo(C.keyGasSnap, 5);
    let v = first;
    let t = 0;
    while (v < 1) {
      v = stepKeyPedal(v, true, DT, C.keyGasS, C.keyGasOffS, C.keyGasSnap);
      t += DT;
    }
    expect(t).toBeGreaterThan(C.keyGasS * 0.5);
    expect(t).toBeLessThan(C.keyGasS * 1.2);
    let off = 0;
    while (v > 0) {
      v = stepKeyPedal(v, false, DT, C.keyGasS, C.keyGasOffS, C.keyGasSnap);
      off += DT;
    }
    expect(off).toBeLessThan(C.keyGasOffS + DT * 2);
    expect(off).toBeLessThan(t + DT * 2);
  });

  it("gives the car the keys' pedals and steering at once, and a plain true still counts as the floor", () => {
    const a = newKeyAxes();
    stepKeys(a, { dir: 1, gas: true, brake: false }, 10, DT);
    expect(a.steer).toBeGreaterThan(0);
    expect(a.gas).toBeGreaterThan(0);
    expect(a.gas).toBeLessThan(1);
    expect(a.brake).toBe(0);
    const s = noSources();
    s.keyGas = a.gas;
    expect(resolveInput(s).throttle).toBeCloseTo(a.gas, 5);
    s.keyGas = true;
    s.keyBrake = true;
    expect(resolveInput(s)).toMatchObject({ throttle: 1, brake: 1 });
    // the pads' pedals the same way
    const p = noSources();
    p.padGas = 0.4;
    expect(resolveInput(p).throttle).toBe(0.4);
  });

  it("makes the steering firmer and quicker at speed, where the wheel's lock has closed, and leaves it as it was when slow", () => {
    const slow = keySteerFeel(5);
    const fast = keySteerFeel(60);
    expect(slow.snap).toBeCloseTo(ENGINE_CAL.keySnap, 5);
    expect(slow.upS).toBeCloseTo(ENGINE_CAL.keySteerS, 5);
    expect(fast.snap).toBeGreaterThan(slow.snap);
    expect(fast.upS).toBeLessThan(slow.upS);
    expect(keySteerFeel(35).snap).toBeGreaterThan(slow.snap);
    expect(keySteerFeel(35).snap).toBeLessThan(fast.snap);
  });
});

describe("cars: the countdown and the end card", () => {
  it("counts a second a number on a first run and half that after it", () => {
    forgetBestRun();
    const g = new NightGame(true);
    g.start();
    expect(g.countStep).toBeCloseTo(0.9, 5);
    g.timeLeft = 0.05;
    for (let i = 0; i < 60 * 12 && g.phase !== "done"; i++) g.update(DT, inp(0, 1));
    expect(g.phase).toBe("done");
    for (let i = 0; i < 60; i++) g.update(DT, inp(0, 1));
    g.start();
    expect(g.phase).toBe("count");
    expect(g.countStep).toBeLessThan(0.6);
    let n = 0;
    while (g.phase === "count" && n < 60 * 5) {
      g.update(DT, inp(0, 1));
      n++;
    }
    expect(n * DT).toBeLessThan(1.8);
    expect(g.phase).toBe("run");
    forgetBestRun();
  });

  const base: AdviceInput = { finished: true, checkpoints: 8, rails: 0, railS: 0, spins: 0, driftTotal: 9000, bestDrift: 2000, score: 20000, vsTargetS: -2 };
  it("gives one short line, the first thing that went wrong", () => {
    expect(adviceFor({ ...base, rails: MANY_RAILS, railS: 7.5 }, false)).toMatch(/RAIL HITS TOOK 7\.5 S/);
    expect(adviceFor({ ...base, finished: false, checkpoints: 5 }, false)).toMatch(/BRAKE LATER/);
    expect(adviceFor({ ...base, spins: 2 }, false)).toMatch(/SPIN/);
    expect(adviceFor({ ...base, driftTotal: 1000 }, false)).toMatch(/SHIFT/);
    expect(adviceFor({ ...base, driftTotal: 1000 }, true)).toMatch(/DRIFT/);
    expect(adviceFor({ ...base, vsTargetS: 8 }, false)).toMatch(/TARGET WAS 8 S AHEAD/);
    expect(adviceFor({ ...base, rails: 2, railS: 3 }, false)).toMatch(/2 RAIL HITS TOOK 3 S/);
    expect(adviceFor(base, false)).toMatch(/CLEAN/);
    for (const r of [base, { ...base, rails: 9, railS: 13.5 }, { ...base, vsTargetS: 11 }]) expect(adviceFor(r, false).length).toBeLessThanOrEqual(48);
  });

  it("puts the rail hits, the clean legs and the advice in the result a finished run hands the page", () => {
    forgetBestRun();
    const r = playRun(bot("careful-drifter"), 1, (g) => (g.assist = 1));
    expect(r.finished).toBe(true);
    const g = new NightGame(true);
    g.start();
    g.timeLeft = 0.05;
    for (let i = 0; i < 60 * 12 && g.phase !== "done"; i++) g.update(DT, inp(0, 1));
    expect(g.result).toMatchObject({ rails: expect.any(Number), railS: expect.any(Number), spins: 0, cleanLegs: expect.any(Number) });
    forgetBestRun();
  });
});

describe("cars: the tile", () => {
  it("loops the stretch with the biggest slide in it, not the opening straight", () => {
    const t = getTarget();
    const w = attractWindow(t.ghost);
    expect(w.from).toBeGreaterThanOrEqual(6);
    expect(w.to - w.from).toBeLessThanOrEqual(36);
    expect(w.to).toBeLessThanOrEqual(t.ghost.time + 1.6);
    expect(w.to).toBeGreaterThan(w.from + 10);
  });
});

describe("cars: the strip", () => {
  const run = (name: string, seed = 1) => runDrag(DRAG_BOTS.find((b) => b.name === name)!, seed);

  it("has a par, and a run with the launch, the throttle and the shifts all right is on it", () => {
    const p = parEt();
    expect(p).toBeGreaterThan(9);
    expect(p).toBeLessThan(12);
    const r = run("perfect");
    expect(Math.abs(r.et - p)).toBeLessThan(0.06);
    expect(r.car.shifts.perfect).toBe(4);
    expect(r.car.launch).toBe("PERFECT LAUNCH");
    expect(dragAdvice(r.car, p)).toMatch(/OFF PAR/);
  });

  it("spreads the ways to lose time: the launch, being late on the throttle, and the shifts", () => {
    const p = parEt();
    const good = run("perfect").et;
    expect(run("hold throttle").et).toBeGreaterThan(good + 0.8);
    expect(run("early shifts").et).toBeGreaterThan(good + 0.45);
    expect(run("misses green .6").et).toBeGreaterThan(good + 0.5);
    expect(run("misses green .3").et).toBeGreaterThan(good + 0.2);
    expect(run("bogged").et).toBeGreaterThan(good + 0.12);
    expect(run("late shifts").et).toBeGreaterThan(good + 0.08);
    expect(good).toBeGreaterThanOrEqual(p - 0.06);
  });

  it("measures the reaction: nothing when the foot is down at the green, the late press when it is not", () => {
    expect(run("perfect").car.reaction ?? 9).toBeLessThan(0.05);
    const late = run("misses green .3");
    expect(late.car.reaction).toBeGreaterThan(0.25);
    expect(late.car.reaction).toBeLessThan(0.4);
    expect(dragAdvice(late.car, parEt())).toMatch(/GET ON THE THROTTLE/);
  });

  it("names what went wrong with the launch and the shifts, the first thing first", () => {
    const p = parEt();
    expect(dragAdvice(run("hold throttle").car, p)).toMatch(/TOO MANY REVS/);
    expect(dragAdvice(run("bogged").car, p)).toMatch(/TOO FEW REVS/);
    expect(dragAdvice(run("early shifts").car, p)).toMatch(/EARLY SHIFT/);
    expect(dragAdvice(run("late shifts").car, p)).toMatch(/LATE SHIFT/);
  });

  it("grades a shift on the limiter as late, not perfect, and counts each kind", () => {
    const c = freshCar();
    c.phase = "run";
    const shiftAt = (rpm: number) => {
      c.rpm = rpm;
      c.shiftT = 0;
      return shiftUp(c, 1) ? c.call : "none";
    };
    expect(shiftAt(SHIFT_AT - 1500)).toBe("EARLY");
    expect(shiftAt(SHIFT_AT - 400)).toBe("GOOD");
    expect(shiftAt(SHIFT_AT + 100)).toBe("PERFECT");
    expect(shiftAt(LIMIT)).toBe("LATE");
    expect(c.shifts).toEqual({ perfect: 1, good: 1, early: 1, late: 1 });
    expect(c.perfect).toBe(1);
  });

  it("waits a different moment before the first amber each run, so the green cannot be counted down to", () => {
    const waits = new Set<number>();
    for (const r of [0, 0.5, 0.99]) {
      const c = freshCar();
      c.throttle = true;
      c.pedal = 1;
      const path: number[] = [];
      for (let i = 0; i < 120 && c.phase !== "tree"; i++) stepDrag(c, 1 / 120, i / 120, path, {}, () => r);
      expect(c.phase).toBe("tree");
      expect(c.wait).toBeGreaterThanOrEqual(TREE_WAIT.min);
      expect(c.wait).toBeLessThanOrEqual(TREE_WAIT.min + TREE_WAIT.spread);
      expect(treeTime(c)).toBeCloseTo(c.wait + 1 + c.gap, 5);
      waits.add(c.wait);
    }
    expect(waits.size).toBe(3);
    const c = freshCar();
    c.wait = 0.5;
    c.tree = 0.3;
    expect(sinceAmber(c)).toBeLessThan(0);
    c.tree = 1.2;
    expect(sinceAmber(c)).toBeCloseTo(0.7, 5);
  });

  it("puts the green a different time after the last amber each run, 0.6 s give or take 0.15, so it cannot be counted from the ambers", () => {
    const gaps: number[] = [];
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const c = freshCar();
      c.throttle = true;
      c.pedal = 1;
      for (let i = 0; i < 120 && c.phase !== "tree"; i++) stepDrag(c, 1 / 120, i / 120, [], {}, () => r);
      expect(c.gap).toBeGreaterThanOrEqual(TREE_GAP_S - TREE_GAP_JITTER_S - 1e-9);
      expect(c.gap).toBeLessThanOrEqual(TREE_GAP_S + TREE_GAP_JITTER_S + 1e-9);
      // the last amber is 1 s after the first: the green is `gap` after it
      expect(treeTime(c) - c.wait).toBeCloseTo(1 + c.gap, 9);
      gaps.push(c.gap);
    }
    expect(new Set(gaps.map((g) => g.toFixed(3))).size).toBe(5);
    // and par is what it was: it is made at the middle of the range
    expect(treeTime({ wait: 0 })).toBeCloseTo(TREE_GREEN_S, 9);
  });

  describe("the reaction can be lost", () => {
    /** stage, then run the tree with `foot(timeBeforeGreen)` saying whether the throttle is down, and return the car at the first step of the run */
    const tree = (foot: (toGreen: number) => boolean, revs = 5000) => {
      const c = freshCar();
      c.phase = "tree";
      c.wait = 0.4;
      c.gap = 0.6;
      c.tree = 0;
      c.throttle = true;
      c.pedal = 1;
      const dt = 1 / 120;
      for (let i = 0; i < 120 * 5 && c.phase === "tree"; i++) {
        c.throttle = foot(treeTime(c) - c.tree);
        c.pedal = c.throttle ? 1 : 0;
        stepDrag(c, dt, i * dt, [], {}, () => 0.5);
        if (c.phase === "tree") c.rpm = revs;
      }
      return c;
    };

    it("holds steady: a foot that stays down, or taps to hold the revs, is on time", () => {
      expect(tree(() => true).reaction).toBe(0);
      const tap = tree((t) => !(t > 0.5 && t < 0.62) && !(t > 0.9 && t < 1.0));
      expect(tap.jumped).toBe(false);
      expect(tap.reaction).toBe(0);
    });

    it("counts a lift of a quarter second or more and a stab in the 0.3 s before green as jumping the light", () => {
      const c = tree((t) => !(t > 0.28 && t < 1.0));
      expect(c.jumped).toBe(true);
      expect(c.reaction).toBeCloseTo(FALSE_START_S, 9);
      expect(dragAdvice(noteRun(c), parEt())).toMatch(/JUMPED THE LIGHT/);
      // lifted for as long, but back on it well before the 0.3 s: not a jump
      expect(tree((t) => !(t > 0.9 && t < 1.2)).jumped).toBe(false);
    });

    it("counts a throttle held into the green with the revs past the launch band as a slow start", () => {
      const c = tree(() => true, LAUNCH.hi + 400);
      expect(c.reaction).toBeCloseTo(SLOW_START_S, 9);
      expect(c.launch).toBe("WHEELSPIN");
      // the card names the revs, not the foot
      expect(dragAdvice(noteRun(c), parEt())).toMatch(/TOO MANY REVS/);
    });

    it("still measures a press after the green", () => {
      const c = tree((t) => t > 0.7 || t < 0.2);
      expect(c.reaction === null || c.reaction >= 0).toBe(true);
    });
  });

  it("times sixty feet and the quarter, and the speed over the line", () => {
    const r: DragCar = run("perfect").car;
    expect(r.sixtyFt).toBeGreaterThan(1.4);
    expect(r.sixtyFt).toBeLessThan(2.4);
    expect(r.split60).toBeGreaterThan(r.sixtyFt ?? 0);
    expect(r.x).toBeGreaterThanOrEqual(QUARTER);
    expect(SIXTY_FT).toBeCloseTo(60 * 0.3048, 1);
    expect(r.trap).toBeGreaterThan(120);
  });
});
