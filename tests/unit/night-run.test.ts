import { describe, expect, it } from "vitest";
import { ENGINE_CAL, NO_INPUT, nightStateData, parseEngineMode, parseHandbrakeMs, parseNightState, parseShift, shapeSteer, READY_VIEW, type NightInput } from "@/components/offhours/engineRemote";
import { autoGear, engineRpm, speedAt, torque, tractiveForce, wheelRpm } from "@/components/offhours/engineModel";
import { BRIDGE, TUNNEL, buildRoad, curvatureAt, flagsAt, getRoad, headingAt, heightAt, pointAt, toCamera, type Road } from "@/components/offhours/night/road";
import { newCar, resetCar, shiftGear, speedOf, stepCar, type Car } from "@/components/offhours/night/car";
import { bankNow, driftRate, isSliding, loseDrift, newDrift, pending, stepDrift } from "@/components/offhours/night/score";
import { GHOST_HZ, better, createRecorder, newPose, samplePose, timeAt, type Ghost } from "@/components/offhours/night/ghost";
import { getTarget } from "@/components/offhours/night/target";
import { buildPlan, drive } from "@/components/offhours/night/ai";
import { newPhone, noSources, resolveInput, setPhoneAxis, smoothPhone, stepKeySteer } from "@/components/offhours/night/nightInput";
import { NightGame, forgetBestRun, getBestScore } from "@/components/offhours/night/game";
import { createAxes } from "@/components/link/controllers/axes";
import { createWheelFilter } from "@/lib/motion";
import type { LinkMsg } from "@/lib/link/session";
import type { MotionSample } from "@/lib/motion";

const D = Math.PI / 180;
const DT = 1 / 120;
const inp = (steer = 0, throttle = 0, brake = 0, hand = 0): NightInput => ({ steer, throttle, brake, hand });

describe("night run: the road", () => {
  const road = getRoad();

  it("is the same road every time, and a different seed is a different road", () => {
    const again = buildRoad();
    expect(again.n).toBe(road.n);
    expect(Array.from(again.kappa.slice(0, 300))).toEqual(Array.from(road.kappa.slice(0, 300)));
    expect(Array.from(again.y.slice(0, 300))).toEqual(Array.from(road.y.slice(0, 300)));
    const other = buildRoad(12345);
    expect(Array.from(other.kappa.slice(200, 400))).not.toEqual(Array.from(road.kappa.slice(200, 400)));
  });

  it("has eight gates a stretch apart, the last is the finish, and the road runs on past it", () => {
    expect(road.checks).toHaveLength(ENGINE_CAL.road.checkpoints);
    expect(road.checks[1] - road.checks[0]).toBe(ENGINE_CAL.road.checkEveryM);
    expect(road.finish).toBe(road.checks[road.checks.length - 1]);
    expect(road.length).toBeGreaterThan(road.finish + 400);
  });

  it("is straight where it must be: the start, the gates, the tunnel and the bridge", () => {
    const at = (s: number) => Math.abs(curvatureAt(road, s));
    expect(at(100)).toBe(0);
    for (const g of road.checks) expect(at(g)).toBeLessThan(1e-6);
    let tunnel = 0;
    let bridge = 0;
    for (let s = 0; s < road.length; s += 4) {
      const f = flagsAt(road, s);
      if (f & TUNNEL) {
        tunnel++;
        expect(at(s)).toBeLessThan(1e-6);
      }
      if (f & BRIDGE) {
        bridge++;
        expect(at(s)).toBeLessThan(1e-6);
      }
    }
    expect(tunnel).toBeGreaterThan(20);
    expect(bridge).toBeGreaterThan(20);
  });

  it("has corners of every size, none tighter than a hairpin, and hills a car can climb", () => {
    let maxK = 0;
    for (let i = 0; i <= road.n; i++) maxK = Math.max(maxK, Math.abs(road.kappa[i]));
    expect(1 / maxK).toBeGreaterThan(40);
    expect(1 / maxK).toBeLessThan(80);
    let slope = 0;
    for (let i = 0; i < road.n; i++) slope = Math.max(slope, Math.abs(road.y[i + 1] - road.y[i]) / road.segM);
    expect(slope).toBeLessThan(0.1);
    expect(road.signs.length).toBeGreaterThan(5);
  });

  it("turns right where the curvature is positive, and the heading is its integral", () => {
    let i = 0;
    while (road.kappa[i] <= 0.004) i++;
    expect(headingAt(road, (i + 5) * road.segM)).toBeGreaterThan(headingAt(road, (i - 5) * road.segM));
    let sum = 0;
    for (let j = 0; j < 100; j++) sum += 0.5 * (road.kappa[j] + road.kappa[j + 1]) * road.segM;
    expect(headingAt(road, 100 * road.segM)).toBeCloseTo(sum, 4);
  });

  it("places a point `lat` metres across the road, perpendicular to it", () => {
    const o = () => ({ x: 0, y: 0, z: 0, phi: 0 });
    const a = pointAt(road, 900, 0, o());
    const b = pointAt(road, 900, 3, o());
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(3, 5);
    const c = pointAt(road, 902, 0, o());
    const along = (c.x - a.x) * (b.x - a.x) + (c.z - a.z) * (b.z - a.z);
    expect(Math.abs(along)).toBeLessThan(0.2);
    expect(Math.abs(heightAt(road, 1500))).toBeGreaterThan(0.5);
  });

  it("projects into the camera: ahead is +z, to the right is +x, and the heading turns the frame", () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(toCamera(0, 0, 10, 0, 0, 0, 0, out)).toMatchObject({ x: 0, z: 10 });
    expect(toCamera(2, 1, 10, 0, 0, 0, 0, out).x).toBeCloseTo(2, 6);
    expect(out.y).toBe(1);
    toCamera(10, 0, 0, 0, 0, 0, Math.PI / 2, out);
    expect(out.z).toBeCloseTo(10, 6);
    expect(Math.abs(out.x)).toBeLessThan(1e-6);
    // a point on the road's right edge lands on the camera's right, ahead of it
    const o = () => ({ x: 0, y: 0, z: 0, phi: 0 });
    const r = pointAt(road, 300, 4.9, o());
    const cpt = pointAt(road, 292, 0, o());
    toCamera(r.x, r.y, r.z, cpt.x, cpt.y, cpt.z, cpt.phi, out);
    expect(out.x).toBeGreaterThan(4);
    expect(out.z).toBeGreaterThan(6);
  });
});

describe("night run: the engine it shares with the drag strip", () => {
  it("keeps the old torque curve and ratios, and the gearbox shifts up and down with the pedal", () => {
    expect(torque(5500)).toBeGreaterThan(torque(900));
    expect(torque(7600)).toBeLessThan(torque(6800));
    expect(wheelRpm(30, 2)).toBeCloseTo((30 / (2 * Math.PI * 0.33)) * 60 * 1.55 * 3.55, 6);
    expect(speedAt(wheelRpm(30, 2), 2)).toBeCloseTo(30, 6);
    expect(tractiveForce(5000, 1, 0.5)).toBeCloseTo(tractiveForce(5000, 1, 1) / 2, 6);
    expect(autoGear(1, 7100, 1, false)).toBe(2);
    expect(autoGear(1, 5300, 0.2, false)).toBe(2); // a light foot shifts early
    expect(autoGear(1, 5000, 1, false)).toBe(1);
    expect(autoGear(3, 2000, 0.5, false)).toBe(2);
    expect(autoGear(0, 2000, 0.5, false)).toBe(0);
    expect(autoGear(5, 9000, 1, false)).toBe(5);
    expect(autoGear(3, 4000, 0, true)).toBe(2); // braking in a lugging gear drops one
  });
  it("holds some revs against the pedal off the line", () => {
    let rpm = 900;
    for (let i = 0; i < 60; i++) rpm = engineRpm(rpm, 0, 0, 1, DT, false);
    expect(rpm).toBeGreaterThan(3500);
    for (let i = 0; i < 240; i++) rpm = engineRpm(rpm, 0, 0, 0, DT, false);
    expect(rpm).toBeLessThan(1000);
  });
  it("keeps the launch revs up through first gear instead of dipping to half and climbing again", () => {
    const road = getRoad();
    const c = newCar(12, 0);
    let min = Infinity;
    let peak = 0;
    for (let i = 0; i < 120 * 4 && c.gear === 0; i++) {
      stepCar(c, inp(0, 1), road, DT);
      if (i > 120 * 0.5) min = Math.min(min, c.rpm);
      peak = Math.max(peak, c.rpm);
    }
    expect(peak).toBeGreaterThan(5000);
    // the old model fell to about 2.5k as the launch term faded under the wheels' own revs
    expect(min).toBeGreaterThan(4500);
  });
});

describe("night run: the car", () => {
  const road = getRoad();
  const run = (c: Car, f: (t: number) => NightInput, secs: number, r: Road = road) => {
    for (let i = 0; i < secs / DT; i++) stepCar(c, f(i * DT), r, DT);
  };

  it("accelerates in a straight line and shifts through the gears by itself", () => {
    const c = newCar(12, 0);
    run(c, () => inp(0, 1), 8);
    expect(speedOf(c)).toBeGreaterThan(38);
    expect(c.gear).toBeGreaterThanOrEqual(2);
    expect(Math.abs(c.lat)).toBeLessThan(0.3);
    expect(Math.abs(c.slip)).toBeLessThan(0.02);
    const d = newCar(12, 0);
    let t = 0;
    while (speedOf(d) < 26.8 && t < 10) {
      stepCar(d, inp(0, 1), road, DT);
      t += DT;
    }
    expect(t).toBeGreaterThan(2.2);
    expect(t).toBeLessThan(5);
  });

  it("brakes to a stop and does not roll backwards", () => {
    const c = newCar(12, 0);
    c.u = 30;
    run(c, () => inp(0, 0, 1), 6);
    expect(c.u).toBe(0);
    expect(speedOf(c)).toBeLessThan(0.5);
    run(c, () => inp(0, 0, 1), 2);
    expect(c.u).toBeGreaterThanOrEqual(0);
  });

  it("follows the road with no steering at a gentle speed (the road turns the wheel part of the way)", () => {
    const c = newCar(300, 0);
    c.u = 14;
    c.gear = 1;
    run(c, () => inp(0, 0.35), 4);
    expect(Math.abs(c.lat)).toBeLessThan(road.railHalf);
    expect(c.s).toBeGreaterThan(330);
  });

  it("kicks the tail out when you brake into a corner, and the slide settles", () => {
    // a right-hander of a hundred metres radius, taken fast
    let i = 0;
    while (!(road.kappa[i] > 0.0085 && road.kappa[i] < 0.0105 && road.kappa[i + 12] > 0.0085)) i++;
    const c = newCar(i * road.segM - 70, 0);
    c.u = 38;
    c.gear = 4;
    let peak = 0;
    for (let n = 0; n < 6 / DT; n++) {
      const t = n * DT;
      stepCar(c, inp(t > 1.2 ? 1 : 0, t > 1.8 ? 0.8 : 0, t > 0.8 && t < 1.8 ? 0.8 : 0), road, DT);
      c.hit = 0;
      peak = Math.max(peak, Math.abs(c.slip));
    }
    expect(peak).toBeGreaterThan(12 * D);
    expect(peak).toBeLessThan(65 * D);
    expect(Math.abs(c.slip)).toBeLessThan(25 * D);
  });

  it("a handbrake flick swings the tail much further than steering alone, and a flick does not spin the car", () => {
    let i = 0;
    while (!(road.kappa[i] > 0.0085 && road.kappa[i] < 0.0105 && road.kappa[i + 12] > 0.0085)) i++;
    const peakWith = (hold: number) => {
      const c = newCar(i * road.segM - 70, 0);
      c.u = 30;
      c.gear = 3;
      let peak = 0;
      let spun = false;
      for (let n = 0; n < 5 / DT; n++) {
        const t = n * DT;
        stepCar(c, inp(t > 1.2 ? 0.5 : 0, 0.6, 0, hold && t > 1.4 && t < 1.4 + hold ? 1 : 0), road, DT);
        c.hit = 0;
        peak = Math.max(peak, Math.abs(c.slip));
        if (Math.abs(c.psi) > 80 * D) spun = true;
      }
      return { peak, spun };
    };
    const none = peakWith(0);
    const flick = peakWith(0.35);
    expect(flick.peak).toBeGreaterThan(none.peak + 12 * D);
    expect(flick.peak).toBeGreaterThan(28 * D);
    expect(flick.spun).toBe(false);
    // and the longer it is held, the further it goes
    expect(peakWith(0.7).peak).toBeGreaterThan(flick.peak);
  });

  it("the rail stops the car, costs it speed, and never lets it through", () => {
    const c = newCar(150, 0);
    c.u = 40;
    c.gear = 3;
    let hit = 0;
    for (let n = 0; n < 3 / DT; n++) {
      stepCar(c, inp(1, 1), road, DT);
      hit = Math.max(hit, c.hit);
      c.hit = 0;
      const extent = 0.92 * Math.abs(Math.cos(c.psi)) + 2.2 * Math.abs(Math.sin(c.psi));
      expect(Math.abs(c.lat) + extent).toBeLessThanOrEqual(road.railHalf + 0.05);
    }
    expect(hit).toBeGreaterThan(0.6);
    expect(speedOf(c)).toBeLessThan(40);
  });

  it("stays finite under any input, and a manual shift is refused while one is under way", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const c = newCar(12, 0);
    for (let n = 0; n < 60 / DT; n++) {
      if (n % 60 === 0) c.hit = 0;
      stepCar(c, inp(rnd() * 2 - 1, rnd(), rnd() < 0.2 ? 1 : 0, rnd() < 0.1 ? 1 : 0), road, DT);
      if (c.s > road.length - 100 || c.s < 5) resetCar(c, 50, 0);
    }
    for (const v of [c.s, c.lat, c.psi, c.u, c.w, c.r, c.rpm]) expect(Number.isFinite(v)).toBe(true);
    const m = newCar(12, 0);
    m.auto = false;
    expect(shiftGear(m, 1)).toBe(true);
    expect(shiftGear(m, 1)).toBe(false);
    expect(shiftGear(m, -1)).toBe(false);
    expect(m.gear).toBe(1);
  });
});

describe("night run: drift scoring and banking", () => {
  const ang = 25 * D;
  const slide = (d: ReturnType<typeof newDrift>, secs: number, slip = ang, speed = 35) => {
    for (let t = 0; t < secs; t += 1 / 60) stepDrift(d, slip, speed, 1 / 60);
  };

  it("counts a slide only past the angle and the speed", () => {
    expect(isSliding(5 * D, 40)).toBe(false);
    expect(isSliding(25 * D, 5)).toBe(false);
    expect(isSliding(-25 * D, 40)).toBe(true);
    expect(driftRate(30 * D, 40)).toBeCloseTo(ENGINE_CAL.drift.pointsPerDegMs * 30 * 40, 3);
    expect(driftRate(80 * D, 40)).toBeCloseTo(ENGINE_CAL.drift.pointsPerDegMs * ENGINE_CAL.drift.maxAngleDeg * 40, 3);
  });

  it("earns points and a multiplier that climbs with the slide, and holds them until the car is straight", () => {
    const d = newDrift();
    slide(d, 0.5);
    expect(d.combo).toBe(1);
    expect(pending(d)).toBeGreaterThan(0);
    const early = pending(d);
    slide(d, 3);
    expect(d.combo).toBeGreaterThanOrEqual(3);
    expect(pending(d)).toBeGreaterThan(early * 3);
    expect(d.total).toBe(0);
  });

  it("banks base x multiplier once it has been straight long enough, and not before", () => {
    const d = newDrift();
    slide(d, 2.5);
    const want = pending(d);
    const combo = d.combo;
    let ev = stepDrift(d, 0, 35, ENGINE_CAL.drift.bankStraightS * 0.5);
    expect(ev.kind).toBe("none");
    expect(d.total).toBe(0);
    ev = stepDrift(d, 0, 35, ENGINE_CAL.drift.bankStraightS * 0.6);
    expect(ev.kind).toBe("bank");
    expect(ev.points).toBe(want);
    expect(ev.combo).toBe(combo);
    expect(d.total).toBe(want);
    expect(d.best).toBe(want);
    expect(pending(d)).toBe(0);
    expect(d.combo).toBe(0);
  });

  it("chains a slide that starts before the points bank (an S-bend is one score), and banks the lot", () => {
    const d = newDrift();
    slide(d, 1);
    const c1 = d.combo;
    stepDrift(d, 0, 35, 0.3);
    const ev = stepDrift(d, -ang, 35, 1 / 60);
    expect(ev.kind).toBe("chain");
    expect(d.combo).toBe(c1 + 1);
    slide(d, 1, -ang);
    const total = pending(d);
    stepDrift(d, 0, 35, 1);
    expect(d.total).toBe(total);
  });

  it("caps the multiplier", () => {
    const d = newDrift();
    slide(d, 30);
    expect(d.combo).toBe(ENGINE_CAL.drift.comboMax);
  });

  it("loses what is unbanked at the wall, and keeps what was banked", () => {
    const d = newDrift();
    slide(d, 2);
    stepDrift(d, 0, 35, 1);
    const banked = d.total;
    expect(banked).toBeGreaterThan(0);
    slide(d, 2);
    const lost = pending(d);
    expect(lost).toBeGreaterThan(0);
    const ev = loseDrift(d);
    expect(ev.kind).toBe("lost");
    expect(ev.points).toBe(lost);
    expect(pending(d)).toBe(0);
    stepDrift(d, 0, 35, 2);
    expect(d.total).toBe(banked);
    expect(loseDrift(d).kind).toBe("none");
  });

  it("can bank on the spot when the run ends mid-slide", () => {
    const d = newDrift();
    slide(d, 1.5);
    const p = pending(d);
    expect(bankNow(d).points).toBe(p);
    expect(d.total).toBe(p);
    expect(bankNow(d).kind).toBe("none");
  });
});

describe("night run: ghosts", () => {
  const make = (n: number, f: (t: number) => number): Ghost => {
    const rec = createRecorder(60);
    const p = newPose();
    for (let i = 0; i < n * 6; i++) {
      const t = i / (GHOST_HZ * 6);
      p.s = f(t);
      p.lat = Math.sin(t);
      p.psi = 0.1 * t;
      p.speed = 10;
      p.slip = 0.2;
      p.skid = 0.5;
      p.brake = 0;
      rec.push(t, p);
    }
    return rec.snapshot(n / GHOST_HZ, false);
  };

  it("keeps a sample twenty times a second however often it is called", () => {
    const g = make(100, (t) => t * 30);
    expect(g.n).toBe(100);
    expect(g.dist).toBeCloseTo(((g.n - 1) / GHOST_HZ) * 30, 1);
  });

  it("plays back by time, interpolating, and holds at the end", () => {
    const g = make(100, (t) => t * 30);
    const p = newPose();
    samplePose(g, 1.0125, p);
    expect(p.s).toBeCloseTo(30.375, 1);
    expect(p.lat).toBeCloseTo(Math.sin(1.0125), 1);
    samplePose(g, 1000, p);
    expect(p.s).toBeCloseTo(g.dist, 3);
    samplePose(g, -5, p);
    expect(p.s).toBe(0);
  });

  it("turns the nose the short way round the wrap", () => {
    const rec = createRecorder(5);
    const p = newPose();
    p.psi = 3.1;
    rec.push(0, p);
    p.psi = -3.1;
    rec.push(1 / GHOST_HZ, p);
    const g = rec.snapshot(0.05, false);
    samplePose(g, 0.025, p);
    expect(Math.abs(p.psi)).toBeGreaterThan(3.1);
  });

  it("finds when a ghost was at a point of the road", () => {
    const g = make(200, (t) => t * 30);
    expect(timeAt(g, 60)).toBeCloseTo(2, 1);
    expect(timeAt(g, 1e9)).toBeNull();
    expect(timeAt(g, 0)).toBe(0);
  });

  it("ranks runs: a finish beats none, faster beats slower, further beats nearer", () => {
    const run = (finished: boolean, time: number, dist: number): Ghost => ({ n: 1, data: new Float32Array(7), dist, time, finished });
    expect(better(run(false, 10, 100), null)).toBe(true);
    expect(better(run(true, 200, 5000), run(false, 100, 6000))).toBe(true);
    expect(better(run(false, 100, 6000), run(true, 200, 5000))).toBe(false);
    expect(better(run(true, 150, 5000), run(true, 160, 5000))).toBe(true);
    expect(better(run(true, 170, 5000), run(true, 160, 5000))).toBe(false);
    expect(better(run(false, 90, 3000), run(false, 90, 2000))).toBe(true);
  });

  it("has a target driver that finishes the road, and a clock that matches it", () => {
    const t = getTarget();
    expect(t.ghost.finished).toBe(true);
    expect(t.ghost.time).toBeGreaterThan(100);
    expect(t.ghost.time).toBeLessThan(230);
    expect(t.legT).toHaveLength(8);
    expect(t.legT[7]).toBeCloseTo(t.ghost.time, 0);
    for (let k = 1; k < 8; k++) expect(t.legT[k]).toBeGreaterThan(t.legT[k - 1]);
    expect(t.bonusS).toHaveLength(8);
    expect(t.bonusS[7]).toBe(0);
    for (let k = 0; k < 7; k++) expect(t.bonusS[k]).toBeGreaterThan(10);
    expect(t.startS).toBeGreaterThan(t.legT[0]);
    const again = buildPlan(t.road);
    expect(Array.from(again.vmax.slice(0, 50))).toEqual(Array.from(t.plan.vmax.slice(0, 50)));
  });

  it("a driver at the target's pace makes every gate with time to spare", () => {
    const t = getTarget();
    const c = newCar(12, 0);
    const i = inp();
    let clock = t.startS;
    let gate = 0;
    let time = 0;
    while (gate < 8 && time < 260) {
      drive(c, t.road, t.plan, ENGINE_CAL.run.targetPace, i);
      stepCar(c, i, t.road, DT);
      c.hit = 0;
      time += DT;
      clock -= DT;
      expect(clock).toBeGreaterThan(0);
      if (c.s >= t.road.checks[gate]) {
        clock += t.bonusS[gate];
        gate++;
      }
    }
    expect(gate).toBe(8);
  });
});

describe("night run: the game", () => {
  const road = getRoad();
  const play = (g: NightGame, f: (t: number) => NightInput, secs: number) => {
    for (let t = 0; t < secs; t += 1 / 60) g.update(1 / 60, f(t));
  };

  it("stages, counts down, runs the clock, and moves the car off the line", () => {
    const g = new NightGame(true);
    expect(g.phase).toBe("ready");
    const counts: number[] = [];
    let went = false;
    g.onEvent = (e) => {
      if (e.kind === "count") counts.push(e.n);
      if (e.kind === "go") went = true;
    };
    g.start();
    expect(g.phase).toBe("count");
    play(g, () => inp(0, 1), 3.2);
    expect(counts).toEqual([3, 2, 1]);
    expect(went).toBe(true);
    expect(g.phase).toBe("run");
    const before = g.timeLeft;
    play(g, () => inp(0, 1), 2);
    expect(g.timeLeft).toBeLessThan(before - 1.5);
    expect(g.speed).toBeGreaterThan(15);
  });

  it("passes a gate, adds the time, and says so", () => {
    const g = new NightGame(true);
    let got: { n: number; bonusS: number } | null = null;
    g.onEvent = (e) => {
      if (e.kind === "checkpoint" && !got) got = { n: e.n, bonusS: e.bonusS };
    };
    g.start();
    play(g, () => inp(0, 1), 3);
    g.car.s = road.checks[0] - 6;
    g.car.u = 40;
    g.car.gear = 3;
    g.car.psi = 0;
    g.car.lat = 0;
    const left = g.timeLeft;
    play(g, () => inp(0, 1), 0.6);
    expect(g.cp).toBe(1);
    expect(g.cpN).toBe(1);
    expect(got).toMatchObject({ n: 1 });
    expect(g.timeLeft).toBeGreaterThan(left + 10);
    expect(g.score).toBeGreaterThanOrEqual(ENGINE_CAL.run.checkpointPoints);
  });

  it("ends when the clock runs out, with a result, and keeps the best run for the next one", () => {
    const g = new NightGame(true);
    let result: unknown = null;
    g.onEvent = (e) => {
      if (e.kind === "end") result = e.result;
    };
    g.start();
    play(g, () => inp(0, 1), 3);
    g.timeLeft = 0.2;
    play(g, () => inp(0, 1), 5);
    expect(g.phase).toBe("done");
    expect(result).toMatchObject({ finished: false });
    expect(g.result!.metres).toBeGreaterThan(0);
    expect(g.result!.miles).toBeCloseTo(g.result!.metres / 1609.34, 5);
    expect(g.result!.newBest).toBe(true);
    const h = new NightGame(true);
    expect(h.scene.ghosts[1].show).toBe(true);
  });

  it("hitting the rail costs the unbanked drift and counts a hit", () => {
    const g = new NightGame(true);
    g.start();
    play(g, () => inp(0, 1), 3);
    g.drift.base = 800;
    g.drift.combo = 3;
    g.drift.sliding = true;
    g.car.lat = road.railHalf - 0.9;
    g.car.psi = 0.3;
    g.car.u = 40;
    const hits = g.hitN;
    play(g, () => inp(1, 1), 0.5);
    expect(g.hitN).toBeGreaterThan(hits);
    expect(g.drift.total).toBe(0);
    expect(g.toasts.some((t) => t.text === "COMBO LOST")).toBe(true);
  });

  it("tells the phone the run in a shape it can read back", () => {
    const g = new NightGame(true);
    g.start();
    play(g, () => inp(0, 1), 4);
    const v = g.view();
    expect(v.phase).toBe("run");
    const back = parseNightState(nightStateData(v))!;
    expect(back.phase).toBe("run");
    expect(back.speed).toBe(Math.round(v.speed));
    expect(back.cps).toBe(8);
    expect(back.auto).toBe(true);
    expect(parseNightState({ phase: "nope", gear: 1 })).toBeNull();
    expect(parseNightState({ phase: "run", gear: 1.5 })).toBeNull();
    expect(parseNightState(undefined)).toBeNull();
    expect(parseNightState(nightStateData({ ...READY_VIEW, time: 1e9 }))!.time).toBe(9999);
  });
});

describe("night run: the corner warning and the end card", () => {
  /** drive the target's own driver at `pace` through the run and count how long the warning is lit */
  const litShare = (pace: number, secs: number) => {
    const g = new NightGame(true);
    const plan = getTarget().plan;
    const input = inp(0, 1);
    g.start();
    let run = 0;
    let lit = 0;
    for (let i = 0; i < 60 * secs && g.phase !== "done"; i++) {
      if (g.phase === "run") drive(g.car, g.road, plan, pace, input);
      g.update(1 / 60, input);
      if (g.phase === "run" && g.endWhy === null) {
        run++;
        if (g.cue.on) lit++;
      }
    }
    return lit / run;
  };

  it("is dark on the opening straight and while the car is under the plan's speed", () => {
    const g = new NightGame(true);
    g.start();
    for (let i = 0; i < 60 * 13; i++) {
      g.update(1 / 60, inp(0, 1));
      expect(g.cue.on).toBe(false);
    }
    expect(g.car.s).toBeGreaterThan(200);
    expect(litShare(0.8, 60)).toBeLessThan(0.08);
  });

  it("lights up for a driver who carries more speed than the road allows, with the way the corner turns", () => {
    expect(litShare(1.25, 60)).toBeGreaterThan(0.12);
    // gas only, no steering, no lifting: the first tight corner lights it, and it says which way the road goes
    const road = getRoad();
    const g = new NightGame(true);
    g.start();
    let lit: { dir: number; s: number } | null = null;
    for (let i = 0; i < 60 * 40 && !lit; i++) {
      g.update(1 / 60, inp(0, 1));
      if (g.cue.on) lit = { dir: g.cue.dir, s: g.car.s };
    }
    expect(lit).not.toBeNull();
    // the bend it is warning about is on that side, within a few seconds of road
    let k = 0;
    for (let s = lit!.s; s < lit!.s + 260; s += road.segM) {
      const kk = road.kappa[Math.round(s / road.segM)];
      if (Math.abs(kk) > Math.abs(k)) k = kk;
    }
    expect(Math.sign(k)).toBe(lit!.dir);
  });

  it("goes out for a recovering car and is gone on the end screen", () => {
    const g = new NightGame(true);
    g.start();
    for (let i = 0; i < 60 * 20; i++) g.update(1 / 60, inp(0, 1));
    g.timeLeft = 0.1;
    for (let i = 0; i < 60 * 6; i++) g.update(1 / 60, inp(0, 1));
    expect(g.phase).toBe("done");
    expect(g.cue.on).toBe(false);
  });

  it("keeps the best score of the visit and says what the last best was", () => {
    forgetBestRun();
    expect(getBestScore()).toBe(0);
    const run = (points: number) => {
      const g = new NightGame(true);
      g.start();
      for (let i = 0; i < 60 * 4; i++) g.update(1 / 60, inp(0, 1));
      g.bonusPoints = points;
      g.timeLeft = 0.1;
      for (let i = 0; i < 60 * 6; i++) g.update(1 / 60, inp(0, 1));
      return g.result!;
    };
    const a = run(900);
    expect(a.prevBestScore).toBe(0);
    expect(a.bestScore).toBe(a.score);
    expect(a.vsTargetS).toBeNull();
    const b = run(300);
    expect(b.prevBestScore).toBe(a.score);
    expect(b.bestScore).toBe(a.score);
    const c = run(2000);
    expect(c.prevBestScore).toBe(a.score);
    expect(c.bestScore).toBe(c.score);
    expect(getBestScore()).toBe(c.score);
    forgetBestRun();
    expect(getBestScore()).toBe(0);
  });

  it("tells a finished run how far ahead of or behind the target driver it was", () => {
    forgetBestRun();
    const g = new NightGame(true);
    const plan = getTarget().plan;
    const input = inp(0, 1);
    g.start();
    for (let i = 0; i < 60 * 400 && g.phase !== "done"; i++) {
      if (g.phase === "run") drive(g.car, g.road, plan, 0.9, input);
      g.update(1 / 60, input);
    }
    expect(g.phase).toBe("done");
    forgetBestRun();
    if (g.result!.finished) expect(Number.isFinite(g.result!.vsTargetS)).toBe(true);
    else expect(g.result!.vsTargetS).toBeNull();
  });
});

describe("night run: the phone's wheel, gas and brake", () => {
  it("shapes the steer: a dead zone, full lock at the edge, the sign kept, junk refused", () => {
    expect(shapeSteer(0)).toBe(0);
    expect(shapeSteer(ENGINE_CAL.steerDead * 0.9)).toBe(0);
    expect(shapeSteer(1)).toBe(1);
    expect(shapeSteer(-1)).toBe(-1);
    expect(shapeSteer(0.5)).toBeLessThan(0.5);
    expect(shapeSteer(-0.5)).toBe(-shapeSteer(0.5));
    const p = newPhone();
    expect(setPhoneAxis(p, "steer", 7)).toBe(true);
    expect(p.steer).toBe(1);
    setPhoneAxis(p, "steer", "x");
    expect(p.steer).toBe(0);
    setPhoneAxis(p, "gas", 3);
    setPhoneAxis(p, "brake", -2);
    expect([p.gas, p.brake]).toEqual([1, 0]);
    expect(setPhoneAxis(p, "unknown", 1)).toBe(false);
  });

  it("eases the phone's values over a few frames and lands on them", () => {
    const p = newPhone();
    const sm = { steer: 0, gas: 0, brake: 0 };
    setPhoneAxis(p, "steer", 1);
    setPhoneAxis(p, "gas", 1);
    const first = smoothPhone(p, sm, 1 / 60, 0);
    expect(first.phoneSteer).toBeGreaterThan(0);
    expect(first.phoneSteer).toBeLessThan(1);
    let r = first;
    for (let i = 0; i < 60; i++) r = smoothPhone(p, sm, 1 / 60, 0);
    expect(r.phoneSteer).toBeCloseTo(1, 2);
    expect(r.phoneGas).toBeCloseTo(1, 2);
    expect(r.phoneBrake).toBe(0);
    expect(r.phoneHand).toBe(0);
    p.handUntil = 500;
    expect(smoothPhone(p, sm, 1 / 60, 400).phoneHand).toBe(1);
    expect(smoothPhone(p, sm, 1 / 60, 600).phoneHand).toBe(0);
    setPhoneAxis(p, "hand", 1);
    expect(smoothPhone(p, sm, 1 / 60, 9999).phoneHand).toBe(1);
  });

  it("merges keys, phone and pads: the furthest steer wins and a pedal on any is a pedal", () => {
    const s = noSources();
    s.keySteer = 0.3;
    s.phoneSteer = -0.7;
    expect(resolveInput(s).steer).toBe(-0.7);
    s.padSteer = 0.9;
    expect(resolveInput(s).steer).toBe(0.9);
    s.keyGas = true;
    s.phoneBrake = 0.4;
    s.padHand = true;
    expect(resolveInput(s)).toMatchObject({ throttle: 1, brake: 0.4, hand: 1 });
    expect(resolveInput(noSources())).toEqual(NO_INPUT);
  });

  it("ramps a keyboard's steering: a tap is a nudge, a hold is lock, letting go comes back faster", () => {
    let v = 0;
    for (let i = 0; i < 6; i++) v = stepKeySteer(v, 1, 1 / 60);
    expect(v).toBeGreaterThan(0.2);
    expect(v).toBeLessThan(0.7);
    for (let i = 0; i < 30; i++) v = stepKeySteer(v, 1, 1 / 60);
    expect(v).toBe(1);
    let back = 0;
    while (v > 0) {
      v = stepKeySteer(v, 0, 1 / 60);
      back++;
    }
    expect(back / 60).toBeLessThan(ENGINE_CAL.keyReturnS + 0.05);
    let w = 1;
    let n = 0;
    while (w > -0.5) {
      w = stepKeySteer(w, -1, 1 / 60);
      n++;
    }
    expect(n / 60).toBeLessThan(0.3);
  });

  it("reads the handbrake time, the shift direction and the mode, and refuses junk", () => {
    expect(parseHandbrakeMs({ ms: 300 })).toBe(300);
    expect(parseHandbrakeMs({ ms: 1e9 })).toBe(1500);
    expect(parseHandbrakeMs({ ms: 1 })).toBe(80);
    expect(parseHandbrakeMs({ ms: "x" })).toBe(ENGINE_CAL.handbrakeMs);
    expect(parseHandbrakeMs(undefined)).toBe(ENGINE_CAL.handbrakeMs);
    expect(parseShift({ dir: 1 })).toBe(1);
    expect(parseShift({ dir: -1 })).toBe(-1);
    expect(parseShift({ dir: 0 })).toBe(0);
    expect(parseShift({})).toBe(0);
    expect(parseEngineMode({ mode: "night" })).toBe("night");
    expect(parseEngineMode({ mode: "drag" })).toBe("drag");
    expect(parseEngineMode({ mode: "x" })).toBeNull();
    expect(parseEngineMode(undefined)).toBeNull();
  });

  const G = 9.80665;
  const wheelPose = (t: number, wheelDeg: number): MotionSample => {
    const w = wheelDeg * D, p = 6 * D;
    return { t, acc: [-Math.sin(w) * Math.cos(p) * G, Math.cos(w) * Math.cos(p) * G, Math.sin(p) * G], gyro: [0, 0, 0] };
  };
  it("a turn of the wheel through the real filter becomes a steer axis, rate limited, that lets go when the wheel does", () => {
    const f = createWheelFilter({ maxAngleDeg: ENGINE_CAL.wheel.rangeDeg, deadZoneDeg: ENGINE_CAL.wheel.deadDeg, smoothingS: ENGINE_CAL.wheel.smoothingS });
    const sent: { v: number; at: number }[] = [];
    let clock = 0;
    const axes = createAxes((m: LinkMsg) => m.type === "axis" && m.name === "steer" && sent.push({ v: m.v as number, at: clock }), ["steer", "gas", "brake", "hand"], { step: 0.02, now: () => clock });
    const feed = (deg: number, t0: number, secs: number) => {
      let t = t0;
      for (; t < t0 + secs; t += 1 / 60) {
        clock = t * 1000;
        axes.set("steer", f.push(wheelPose(t, deg)).steer);
      }
      return t;
    };
    let t = feed(90, 0, 1.4);
    expect(sent.length).toBe(0);
    t = feed(90 + 30, t, 2.5);
    expect(sent.some((a) => a.v > 0.4)).toBe(true);
    expect(sent.every((a) => a.v >= 0)).toBe(true);
    t = feed(90 - 30, t, 3);
    expect(sent.some((a) => a.v < -0.4)).toBe(true);
    t = feed(90, t, 3);
    axes.flush();
    expect(sent.at(-1)!.v).toBe(0);
    const span = (sent.at(-1)!.at - sent[0].at) / 1000;
    expect(sent.length / span).toBeLessThanOrEqual(31);
  });

  it("a gas and a brake held on the phone are 1 while down and 0 after, one message each", () => {
    const got: { name: string; v: number }[] = [];
    let clock = 0;
    const axes = createAxes((m: LinkMsg) => m.type === "axis" && got.push({ name: m.name as string, v: m.v as number }), ["steer", "gas", "brake", "hand"], { now: () => clock });
    axes.set("gas", 1);
    axes.set("gas", 1);
    clock = 100;
    axes.set("brake", 1);
    clock = 200;
    axes.set("gas", 0);
    axes.set("brake", 0);
    axes.flush();
    expect(got).toEqual([
      { name: "gas", v: 1 },
      { name: "brake", v: 1 },
      { name: "gas", v: 0 },
      { name: "brake", v: 0 },
    ]);
  });
});
