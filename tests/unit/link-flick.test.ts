import { describe, expect, it } from "vitest";
import { HOOPS_CAL, flickShot, parseFlick, parseSwipe, swipeShot } from "@/components/offhours/hoopsRemote";
import { PENALTY_CAL, PHONE_SHOTS, chooseShot, isPhoneShot, kickFromSwipe, parseKick } from "@/components/offhours/penaltyRemote";
import { GW, SHOTS } from "@/components/offhours/penaltyModel";
import { createFlickDetector, eventsOf, recogniseSwipe, runDetector } from "@/lib/motion";
import { genFlick, genSwipe } from "./lab-swing-traces";

// The two flick-style phone controllers' gesture -> game mappings. The games'
// own shot functions (Hoops' shoot(), Penalty's strike()) are what the mouse
// uses too; these are the numbers fed into them.

const HOOP_Z = 4.4;

describe("hoops: swipe -> shot", () => {
  it("is the mouse swipe's own formula (screen heights per second)", () => {
    // the old inline maths, for a swipe of vx, vy px/s on a canvas h px tall
    const h = 600, vx = 120, vy = -1500, ballX = 0.2, ballZ = 0.6;
    const old = { power: 1 + 0.45 * Math.log2(-vy / (h * 1.6)), aim: ballX + (vx / -vy) * (HOOP_Z - ballZ) };
    const got = swipeShot(vx / h, vy / h, ballX, ballZ, HOOP_Z)!;
    expect(got.power).toBeCloseTo(old.power, 10);
    expect(got.aimX).toBeCloseTo(old.aim, 10);
  });
  it("calls a slow or downward swipe no shot, and an unusable one too", () => {
    expect(swipeShot(0, -0.3, 0, 0.6, HOOP_Z)).toBeNull();
    expect(swipeShot(0, 2, 0, 0.6, HOOP_Z)).toBeNull();
    expect(swipeShot(Number.NaN, -3, 0, 0.6, HOOP_Z)).toBeNull();
  });
  it("aims where the swipe points, and a harder swipe is more power", () => {
    const left = swipeShot(-0.5, -2, 0, 0.6, HOOP_Z)!;
    const right = swipeShot(0.5, -2, 0, 0.6, HOOP_Z)!;
    expect(left.aimX).toBeLessThan(0);
    expect(right.aimX).toBeGreaterThan(0);
    expect(swipeShot(0, -4, 0, 0.6, HOOP_Z)!.power).toBeGreaterThan(swipeShot(0, -2, 0, 0.6, HOOP_Z)!.power);
  });
  it("a thumb swipe on the phone's pad lands near perfect, not a wild overshoot", () => {
    // 2000 px/s on a 300 px pad is a firm flick of the thumb
    const s = swipeShot(0, -2000 / 300, 0, 0.6, HOOP_Z, HOOPS_CAL.phoneSwipeGain)!;
    expect(s.power).toBeGreaterThan(0.85);
    expect(s.power).toBeLessThan(1.25);
    // without the gain it would be a hard overshoot
    expect(swipeShot(0, -2000 / 300, 0, 0.6, HOOP_Z)!.power).toBeGreaterThan(1.5);
  });
});

describe("hoops: flick -> shot", () => {
  it("the perfect flick power is a perfect shot, and aim is left-right of the ball", () => {
    const s = flickShot(HOOPS_CAL.flickPerfect, 0, 0.3);
    expect(s.power).toBeCloseTo(1, 10);
    expect(s.aimX).toBeCloseTo(0.3, 10);
    expect(flickShot(0.5, -1, 0).aimX).toBeCloseTo(-HOOPS_CAL.aimRangeM, 10);
    expect(flickShot(0.5, 1, 0).aimX).toBeCloseTo(HOOPS_CAL.aimRangeM, 10);
  });
  it("harder is longer, softer is shorter, clamped", () => {
    expect(flickShot(0.8, 0, 0).power).toBeGreaterThan(flickShot(0.5, 0, 0).power);
    expect(flickShot(0.1, 0, 0).power).toBeLessThan(flickShot(0.5, 0, 0).power);
    expect(flickShot(0, 0, 0).power).toBeGreaterThanOrEqual(HOOPS_CAL.powerMin);
    expect(flickShot(5, 0, 0).power).toBeLessThanOrEqual(HOOPS_CAL.powerMax);
    expect(flickShot(0.5, 9, 0).aimX).toBeCloseTo(HOOPS_CAL.aimRangeM, 10);
  });
  it("a nearly straight flick is straight (wrist noise inside the dead zone)", () => {
    expect(flickShot(0.5, HOOPS_CAL.aimDead * 0.9, 0.1).aimX).toBeCloseTo(0.1, 10);
    expect(flickShot(0.5, HOOPS_CAL.aimDead * 1.5, 0.1).aimX).toBeGreaterThan(0.1);
  });
  it("end to end: the real recogniser's flicks map to shots a player can hit, aimed the way they were thrown", () => {
    let n = 0, signOk = 0, signN = 0;
    const powers: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { samples, truth } = genFlick(seed);
      const ev = eventsOf(runDetector(createFlickDetector(), samples));
      if (ev.length !== 1) continue;
      n++;
      const shot = flickShot(ev[0].power, ev[0].aim, 0);
      powers.push(shot.power);
      if (Math.abs(truth.aimDeg) > 8) {
        signN++;
        if (Math.sign(shot.aimX) === Math.sign(truth.aimDeg)) signOk++;
      }
    }
    expect(n).toBeGreaterThan(25);
    // the spread of power covers the sweet spot (so a player can find it) without every flick being a miss
    expect(Math.min(...powers)).toBeLessThan(0.95);
    expect(Math.max(...powers)).toBeGreaterThan(1.05);
    expect(signOk / signN).toBeGreaterThan(0.8);
  });
});

describe("hoops: gesture parsing", () => {
  it("reads good data, clamps, and drops junk", () => {
    expect(parseFlick({ power: 0.4, aim: -0.2 })).toEqual({ power: 0.4, aim: -0.2 });
    expect(parseFlick({ power: 4, aim: 9 })).toEqual({ power: 1, aim: 1 });
    expect(parseFlick({ power: "x", aim: 0 })).toBeNull();
    expect(parseFlick({})).toBeNull();
    expect(parseSwipe({ vx: 0.2, vy: -3 })).toEqual({ vx: 0.2, vy: -3 });
    expect(parseSwipe({ vx: 0, vy: -1e6 })).toBeNull();
    expect(parseSwipe({ vx: Number.NaN, vy: -1 })).toBeNull();
  });
});

describe("penalty: swipe -> kick", () => {
  it("knows the goal's size", () => {
    expect(PENALTY_CAL.goalHalfWidthM).toBe(GW);
    expect(PENALTY_CAL.reachM).toBeGreaterThan(GW);
    // every phone shot is a real shot id, and every Auto result too
    const ids = new Set(SHOTS.map((s) => s.id));
    for (const s of PHONE_SHOTS) if (s.id !== "auto") expect(ids.has(s.id)).toBe(true);
    for (const curl of [-1, 0, 1]) for (const power of [0.1, 0.5, 0.95]) expect(ids.has(chooseShot("auto", power, curl))).toBe(true);
  });
  it("aims by heading: straight up is the middle, the edges reach past the post", () => {
    const base = { len: 0.5, power: 0.5, curl: 0 };
    expect(kickFromSwipe({ ...base, dirDeg: 0 }, "auto").aim.x).toBeCloseTo(0, 10);
    expect(kickFromSwipe({ ...base, dirDeg: -PENALTY_CAL.dirFullDeg }, "auto").aim.x).toBeCloseTo(-PENALTY_CAL.reachM, 10);
    expect(kickFromSwipe({ ...base, dirDeg: PENALTY_CAL.dirFullDeg }, "auto").aim.x).toBeCloseTo(PENALTY_CAL.reachM, 10);
    // the post is reachable but a wild swipe goes wide
    const post = (GW / PENALTY_CAL.reachM) * PENALTY_CAL.dirFullDeg;
    expect(kickFromSwipe({ ...base, dirDeg: post - 3 }, "auto").aim.x).toBeLessThan(GW);
    expect(kickFromSwipe({ ...base, dirDeg: 90 }, "auto").aim.x).toBeGreaterThan(GW);
  });
  it("aims high with a long swipe and low with a short one, inside the frame", () => {
    const base = { dirDeg: 0, power: 0.5, curl: 0 };
    const low = kickFromSwipe({ ...base, len: 0.05 }, "auto").aim.y;
    const high = kickFromSwipe({ ...base, len: 1.2 }, "auto").aim.y;
    expect(low).toBeCloseTo(PENALTY_CAL.yLowM, 10);
    expect(high).toBeCloseTo(PENALTY_CAL.yHighM, 10);
    expect(high).toBeLessThan(2.44);
    expect(kickFromSwipe({ ...base, len: 0.47 }, "auto").aim.y).toBeGreaterThan(low);
  });
  it("Auto: a bent swipe curls the way it bends, a very hard one is driven, the rest placed", () => {
    expect(chooseShot("auto", 0.5, 0.6)).toBe("curlR");
    expect(chooseShot("auto", 0.5, -0.6)).toBe("curlL");
    expect(chooseShot("auto", 0.5, 0.1)).toBe("placed");
    expect(chooseShot("auto", 0.95, 0)).toBe("driven");
    // a curl on a very hard swipe is still a curl
    expect(chooseShot("auto", 0.95, 0.5)).toBe("curlR");
  });
  it("a picked kick is that kick whatever the swipe does", () => {
    expect(chooseShot("dipper", 0.95, 0.9)).toBe("dipper");
    expect(chooseShot("panenka", 0.1, -0.9)).toBe("panenka");
    expect(isPhoneShot("knuckle")).toBe(true);
    expect(isPhoneShot("curlL")).toBe(false);
  });
  it("power passes through, floored and capped", () => {
    expect(kickFromSwipe({ dirDeg: 0, len: 0.5, power: 0.62, curl: 0 }, "auto").power).toBeCloseTo(0.62, 10);
    expect(kickFromSwipe({ dirDeg: 0, len: 0.5, power: 0, curl: 0 }, "auto").power).toBe(PENALTY_CAL.powerMin);
    expect(kickFromSwipe({ dirDeg: 0, len: 0.5, power: 7, curl: 0 }, "auto").power).toBe(1);
  });
  it("end to end: the real recogniser's swipes aim the way they were drawn and curl the way they bend", () => {
    const opts = { speedLow: PENALTY_CAL.speedLow, speedHigh: PENALTY_CAL.speedHigh, curlRange: PENALTY_CAL.curlRange, curlBias: PENALTY_CAL.curlBias };
    const padH = 500;
    let n = 0, aimOk = 0, curlOk = 0, curlN = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { points, truth } = genSwipe(seed);
      const out = recogniseSwipe(points, opts);
      if (out.kind !== "event") continue;
      n++;
      const e = out.event;
      const k = kickFromSwipe({ dirDeg: e.directionDeg, len: e.length / padH, power: e.power, curl: e.curl }, "auto");
      if (Math.sign(k.aim.x) === Math.sign(truth.direction) || Math.abs(truth.direction) < 0.08) aimOk++;
      if (Math.abs(truth.turn) > 0.9) {
        curlN++;
        if ((k.shot === "curlR") === truth.turn > 0 && (k.shot === "curlR" || k.shot === "curlL")) curlOk++;
      }
    }
    expect(n).toBeGreaterThan(25);
    expect(aimOk / n).toBeGreaterThan(0.9);
    expect(curlN).toBeGreaterThan(3);
    expect(curlOk / curlN).toBeGreaterThan(0.8);
  });
});

describe("penalty: gesture parsing", () => {
  it("reads a kick, clamps it, and drops junk", () => {
    expect(parseKick({ dirDeg: 10, len: 0.5, power: 0.6, curl: -0.2 })).toEqual({ dirDeg: 10, len: 0.5, power: 0.6, curl: -0.2 });
    expect(parseKick({ dirDeg: 400, len: 99, power: 3, curl: 9 })).toEqual({ dirDeg: 90, len: 3, power: 1, curl: 1 });
    expect(parseKick({ dirDeg: 0, len: 0.5, power: "fast", curl: 0 })).toBeNull();
    expect(parseKick({ dirDeg: 0 })).toBeNull();
  });
});
