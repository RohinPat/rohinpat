import { describe, expect, it } from "vitest";
import { ENGINE_CAL, NO_INPUT, type NightInput } from "@/components/offhours/engineRemote";
import { RATIOS, wheelRpm } from "@/components/offhours/engineModel";
import { NightGame, type GameEvent } from "@/components/offhours/night/game";
import { newCar, shiftGear, speedOf, stepCar, type Car } from "@/components/offhours/night/car";
import { drawHud } from "@/components/offhours/night/hud";
import { getRoad } from "@/components/offhours/night/road";
import { BOTS, playRun, type Bot, type RunStat } from "./cars-bots";

// The manual gearbox pays: an upshift in the green window gives a short boost, and a downshift with the handbrake held (or
// one that throws the revs up as the car turns in) is a clutch kick that starts a slide.

const P = ENGINE_CAL.car;
const road = getRoad();
const DT = 1 / 120;
const bot = (name: string): Bot => BOTS.find((b) => b.name === name)!;
const many = (name: string, n: number, assist: 0 | 1 | 2 = 0): RunStat[] => Array.from({ length: n }, (_, i) => playRun(bot(name), i + 1, (g) => (g.assist = assist)));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const inp = (o: Partial<NightInput> = {}): NightInput => ({ ...NO_INPUT, throttle: 1, ...o });

/** a manual car at this speed in this gear, settled with the throttle part down on a straight bit of the road */
function settled(u: number, gear: number, auto = false): Car {
  const c = newCar(700, 0);
  c.u = u;
  c.gear = gear;
  c.auto = auto;
  c.rpm = wheelRpm(u, gear);
  for (let i = 0; i < 36; i++) stepCar(c, inp({ throttle: 0.4 }), road, DT);
  return c;
}

/** a car in this gear with its revs set (as if it had been pulled there) and the pedal down */
function revved(rpm: number, gear = 2, auto = false): Car {
  const c = settled(30, gear, auto);
  c.rpm = rpm;
  c.pedal = 1;
  return c;
}

describe("a shift in the green window", () => {
  it("is the drag strip's window: from the shift light to just short of the limiter", () => {
    expect(P.shiftGreenFromRpm).toBe(ENGINE_CAL.engine.shiftAt);
    expect(P.shiftGreenToRpm).toBe(ENGINE_CAL.engine.limit - 20);
  });

  it("gives a boost on an upshift by hand with the pedal down; early, late and off the throttle give none", () => {
    for (const [rpm, pedal, boosted] of [
      [7350, 1, true],
      [7900, 1, true],
      [7000, 1, false],
      [6200, 1, false],
      [8000, 1, false],
      [7600, 0, false],
    ] as [number, number, boolean][]) {
      const c = revved(rpm);
      c.pedal = pedal;
      expect(shiftGear(c, 1)).toBe(true);
      expect(c.boostGood, `${rpm} rpm, pedal ${pedal}`).toBe(boosted);
      expect(c.boostT > 0).toBe(boosted);
    }
  });

  it("is for the hand: the automatic box's own shifts never pay", () => {
    const c = revved(7500, 2, true);
    c.shiftT = 0;
    c.holdT = 0;
    // the automatic box shifts at 7,000 rpm at the most; run it up and see
    let up = 0;
    for (let i = 0; i < 240 && up === 0; i++) {
      stepCar(c, inp(), road, DT);
      if (c.shifted > 0) up = c.rpm;
    }
    expect(c.boostGood).toBe(false);
    expect(c.boostT).toBe(0);
  });

  it("pulls harder for about 0.4 s after the torque cut, and then is gone", () => {
    const a = settled(42, 3);
    const b = structuredClone(a);
    a.rpm = b.rpm = 7400;
    a.pedal = b.pedal = 1;
    shiftGear(a, 1);
    // b shifts the same, with no boost to spend
    shiftGear(b, 1);
    b.boostT = 0;
    expect(a.boostT).toBeCloseTo(ENGINE_CAL.gearbox.cutS + P.shiftBoostS, 5);
    for (let i = 0; i < 0.6 / DT; i++) {
      stepCar(a, inp(), road, DT);
      stepCar(b, inp(), road, DT);
    }
    const ua = speedOf(a);
    const ub = speedOf(b);
    expect(ua).toBeGreaterThan(ub + 0.1);
    expect(a.boostT).toBe(0);
    // the same afterwards: no more than a speed's difference, not a different car
    expect(ua - ub).toBeLessThan(3);
  });

  it("is announced to the dash once, as SHIFT, with a punch of the lens, and goes", () => {
    const g = new NightGame(false);
    const events: GameEvent[] = [];
    g.onEvent = (e) => events.push(e);
    g.setAuto(false);
    g.start();
    for (let i = 0; i < 60 * 6 && g.phase !== "run"; i++) g.update(1 / 60, inp());
    expect(g.phase).toBe("run");
    const c = g.car;
    // get it moving and then put the revs where the window is
    for (let i = 0; i < 60 * 2; i++) g.update(1 / 60, inp());
    c.rpm = 7400;
    c.pedal = 1;
    c.shiftT = 0;
    c.holdT = 0;
    g.shift(1);
    g.update(1 / 60, inp());
    const shift = events.filter((e) => e.kind === "shift" && e.up);
    expect(shift.length).toBeGreaterThan(0);
    expect(shift.some((e) => e.kind === "shift" && e.good)).toBe(true);
    expect(g.shiftFlash).toBeGreaterThan(0.4);
    expect(g.scene.cam.kick).toBeGreaterThan(0.3);
    for (let i = 0; i < 60; i++) g.update(1 / 60, inp({ throttle: 0.5 }));
    expect(g.shiftFlash).toBe(0);
  });

  it("is told on the dash: the shift light goes green in the window, and the ring says SHIFT after a good one", () => {
    const g = new NightGame(true);
    g.setAuto(false);
    g.start();
    for (let i = 0; i < 60 * 6 && g.phase !== "run"; i++) g.update(1 / 60, inp());
    for (let i = 0; i < 60; i++) g.update(1 / 60, inp());
    const texts: string[] = [];
    const fills: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (t: Record<string, unknown>, k: string) => {
          if (k === "fillText") return (s: string) => texts.push(s);
          if (k === "measureText") return () => ({ width: 10 });
          if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
          return typeof t[k] === "function" ? t[k] : () => undefined;
        },
        set: (t: Record<string, unknown>, k: string, v: unknown) => {
          if (k === "fillStyle") fills.push(String(v));
          t[k] = v;
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const opt = { touch: false, linked: false, lift: 0 };
    g.shiftFlash = 0;
    g.car.rpm = 7500;
    drawHud(ctx, 1440, 900, g, opt, 1, true);
    expect(texts).not.toContain("SHIFT");
    expect(fills).toContain("#8ad9a8");
    g.shiftFlash = 0.5;
    texts.length = 0;
    drawHud(ctx, 1440, 900, g, opt, 1, true);
    expect(texts).toContain("SHIFT");
  });
});

describe("the clutch kick", () => {
  /** a downshift on a straight with the wheel turned in for 0.6 s: how big a slide, and for how long it is a scoring one (over 10 degrees) */
  function turnIn(c: Car, down: boolean, steer = 0.3) {
    if (down) shiftGear(c, -1);
    let maxSlip = 0;
    let over = 0;
    let kicked = false;
    for (let i = 0; i < 120; i++) {
      stepCar(c, inp({ steer: i < 72 ? steer : 0, throttle: 0.3, hand: c.hand }), road, DT);
      maxSlip = Math.max(maxSlip, Math.abs(c.slip));
      if (Math.abs(c.slip) > 0.17) over += DT;
      if (c.kickT > 0) kicked = true;
    }
    return { maxSlip, over, kicked };
  }

  it("with the handbrake held, a downshift breaks the rear loose: a slide the same turn-in does not make", () => {
    const kicked = settled(38, 3);
    kicked.hand = 1;
    const control = structuredClone(kicked);
    const a = turnIn(kicked, true);
    const b = turnIn(control, false);
    expect(a.kicked).toBe(true);
    expect(b.kicked).toBe(false);
    expect(a.maxSlip).toBeGreaterThan(0.35);
    expect(a.over).toBeGreaterThan(0.4);
    expect(b.maxSlip).toBeLessThan(0.17);
  });

  it("at high revs into a corner, a downshift is a kick too, without the handbrake", () => {
    // 46 m/s in fourth, down to third: the revs jump
    const c = settled(46, 3);
    const after = (c.rpm * RATIOS[2]) / RATIOS[3];
    expect(after).toBeGreaterThan(P.kickMinRpm + 0.6 * (P.kickFullRpm - P.kickMinRpm));
    const control = structuredClone(c);
    const a = turnIn(c, true);
    const b = turnIn(control, false);
    expect(a.maxSlip).toBeGreaterThan(0.3);
    expect(a.over).toBeGreaterThan(0.2);
    expect(b.maxSlip).toBeLessThan(0.1);
  });

  it("does nothing with the revs low, on a straight with the wheel straight, in the automatic box or at a crawl", () => {
    // a gentle downshift: the revs hardly move
    const low = settled(20, 3);
    shiftGear(low, -1);
    stepCar(low, inp({ steer: 0.3 }), road, DT);
    expect(low.kickT).toBe(0);
    // high revs but the wheel is straight on a straight
    const straight = settled(46, 3);
    shiftGear(straight, -1);
    stepCar(straight, inp(), road, DT);
    expect(straight.kickT).toBe(0);
    // the automatic box never kicks
    const auto = settled(46, 3, true);
    auto.hand = 1;
    shiftGear(auto, -1);
    stepCar(auto, inp({ steer: 0.3, hand: 1 }), road, DT);
    expect(auto.kickT).toBe(0);
    expect(auto.kickReq).toBe(0);
    // too slow
    const slow = settled(9, 1);
    slow.hand = 1;
    shiftGear(slow, -1);
    stepCar(slow, inp({ steer: 0.3, hand: 1 }), road, DT);
    expect(slow.kickT).toBe(0);
  });

  it("waits between kicks, and a kick takes the steering assist off for as long as it lasts", () => {
    const c = settled(40, 4);
    c.hand = 1;
    shiftGear(c, -1);
    stepCar(c, inp({ steer: 0.3, hand: 1 }), road, DT);
    expect(c.kickT).toBeGreaterThan(0);
    const k1 = c.kickK;
    // 0.2 s later, another downshift: the wait is on
    for (let i = 0; i < 24; i++) stepCar(c, inp({ steer: 0.3, hand: 1 }), road, DT);
    c.shiftT = 0;
    shiftGear(c, -1);
    const t0 = c.kickT;
    stepCar(c, inp({ steer: 0.3, hand: 1 }), road, DT);
    expect(c.kickK).toBe(k1);
    expect(c.kickT).toBeLessThanOrEqual(t0);
  });

  it("is told to the page as a kick, once", () => {
    const g = new NightGame(true);
    const events: GameEvent[] = [];
    g.onEvent = (e) => events.push(e);
    g.setAuto(false);
    g.start();
    for (let i = 0; i < 60 * 6 && g.phase !== "run"; i++) g.update(1 / 60, inp());
    for (let i = 0; i < 60 * 3; i++) g.update(1 / 60, inp());
    const c = g.car;
    c.shiftT = 0;
    c.holdT = 0;
    c.gear = Math.max(c.gear, 3);
    g.shift(-1);
    for (let i = 0; i < 30; i++) g.update(1 / 60, inp({ steer: 0.3, hand: 1 }));
    expect(events.filter((e) => e.kind === "kick").length).toBeLessThanOrEqual(1);
  });
});

describe("what it does to a run (scripted drivers, who change gear by hand)", { timeout: 60_000 }, () => {
  it("a decent driver who shifts in the window is quicker than the same one on the automatic box", () => {
    const auto = many("decent", 48, 1);
    const hand = many("decent-manual", 48, 1);
    expect(hand.every((r) => r.finished)).toBe(true);
    const t = (rs: RunStat[]) => mean(rs.map((r) => r.time));
    // about 1.5 to 2 seconds in 107: the run is cornering-limited, so power buys little
    expect(t(hand)).toBeLessThan(t(auto) * 0.99);
    expect(t(hand)).toBeGreaterThan(t(auto) * 0.95);
  });

  it("the automatic box is still fine: it finishes with time to spare, and scores the same", () => {
    const auto = many("decent", 24);
    const hand = many("decent-manual", 24);
    expect(auto.every((r) => r.finished)).toBe(true);
    expect(mean(auto.map((r) => r.timeLeftEnd))).toBeGreaterThan(3);
    expect(mean(hand.map((r) => r.score))).toBeGreaterThan(mean(auto.map((r) => r.score)) * 0.85);
  });

  it("only the window pays: a driver who shifts early or late gets no boost at all, one who shifts in it gets one on most shifts", () => {
    const count = (name: string) => {
      let good = 0;
      let ups = 0;
      playRun(bot(name), 3, (g) => {
        const prev = g.onEvent;
        g.onEvent = (e) => {
          prev(e);
          if (e.kind === "shift" && e.up) {
            ups++;
            if (e.good) good++;
          }
        };
      });
      return { good, ups };
    };
    const early = count("decent-early");
    const late = count("decent-late");
    const green = count("decent-manual");
    expect(early.ups).toBeGreaterThan(5);
    expect(early.good).toBe(0);
    expect(late.good).toBe(0);
    expect(green.good).toBeGreaterThan(green.ups * 0.6);
  });

  it("a driver who kicks into the fast corners, and shifts in the window, is a few per cent quicker than one who flicks the handbrake into the same corners on the automatic box, for the same score", () => {
    const flick = many("flicker", 48);
    const kick = many("kicker", 48);
    expect(mean(kick.map((r) => r.drift))).toBeGreaterThan(2500);
    expect(kick.every((r) => r.finished)).toBe(true);
    const t = (rs: RunStat[]) => mean(rs.map((r) => r.time));
    expect(t(kick)).toBeLessThan(t(flick) * 0.98);
    expect(t(kick)).toBeGreaterThan(t(flick) * 0.94);
    const sc = (rs: RunStat[]) => mean(rs.map((r) => r.score));
    expect(sc(kick)).toBeGreaterThan(sc(flick) * 0.85);
    expect(sc(kick)).toBeLessThan(sc(flick) * 1.2);
  });
});
