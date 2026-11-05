import { describe, expect, it } from "vitest";
import { CLUBS, simulate, at, type ShotIn, type Surface } from "@/components/offhours/golf/flight";
import { surfaceAt as rangeSurface } from "@/components/offhours/golf/scene";

// The ball flight. The GOLDEN numbers were recorded from flight.ts before it learned about water, lies and an origin,
// so the range's shots (which pass none of those) are pinned to no change at all.

const flat = (): Surface => "fairway";
const r2 = (v: number) => +v.toFixed(2) || 0;
const sum = (inp: ShotIn) => {
  const s = simulate(inp);
  const e = at(s, s.restT);
  return { carry: r2(s.carry), total: r2(s.total), side: r2(s.side), curve: r2(s.curve), apex: r2(s.apex), restT: r2(s.restT), n: s.n, bounces: s.bounces.length, end: [r2(e[0]), r2(e[2])], surface: s.surface, mph: r2(s.speed), launch: r2(s.launch), spin: s.spin };
};

const base = { speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0] as [number, number], surfaceAt: flat };
const CASES: Record<string, ShotIn> = {
  "driver, flat": { ...base, club: CLUBS[0] },
  "3 wood, flat": { ...base, club: CLUBS[1] },
  "5 iron, flat": { ...base, club: CLUBS[2] },
  "7 iron, flat": { ...base, club: CLUBS[3] },
  "pitching wedge, flat": { ...base, club: CLUBS[4] },
  "sand wedge, flat": { ...base, club: CLUBS[5] },
  "7 iron, half": { ...base, club: CLUBS[3], speed: 0.65 },
  "driver, slice into a crosswind": { ...base, club: CLUBS[0], curve: 0.6, face: 0.2, wind: [3, -2] },
  "5 iron, hook, tailwind": { ...base, club: CLUBS[2], curve: -0.7, face: -0.3, wind: [0, 4], yaw: 0.1 },
  "pw, thin": { ...base, club: CLUBS[4], contact: 0.5, lift: 0.55 },
  "sw, fat, headwind": { ...base, club: CLUBS[5], contact: 0.5, lift: 1.15, wind: [0, -3] },
  "7 iron on the range": { ...base, club: CLUBS[3], surfaceAt: rangeSurface, yaw: 0.2 },
  "driver on the range, to the far end": { ...base, club: CLUBS[0], surfaceAt: rangeSurface, speed: 1.04 },
};

describe("golden values from before", () => {
  it("every range shot is the number it was", () => {
    const got: Record<string, ReturnType<typeof sum>> = {};
    for (const [k, v] of Object.entries(CASES)) got[k] = sum(v);
    if (process.env.RECORD_GOLF_FLIGHT) console.log("RECORD" + JSON.stringify(got));
    expect(got).toEqual(GOLDEN);
  });
});


/** a pond: water for 100 < z < 140 and |x| < 30, fairway everywhere else */
const pond = (x: number, z: number): Surface => (z > 100 && z < 140 && Math.abs(x) < 30 ? "water" : "fairway");

describe("an origin", () => {
  it("no origin is the origin (0, 0)", () => {
    for (const [k, v] of Object.entries(CASES)) expect(sum({ ...v, origin: [0, 0] }), k).toEqual(sum(v));
  });
  it("a shot struck from anywhere flies the same when the ground under it is moved with it", () => {
    for (const [ox, oz] of [[40, 90], [-250, 600], [3.3, -17]] as [number, number][]) {
      for (const [k, v] of Object.entries(CASES)) {
        const moved = sum({ ...v, origin: [ox, oz], surfaceAt: (x, z) => v.surfaceAt(x - ox, z - oz) });
        expect(moved, `${k} from ${ox},${oz}`).toEqual(sum(v));
      }
    }
  });
  it("the surface is looked up in world coordinates, and the shot comes back relative to the origin", () => {
    const seen: [number, number][] = [];
    const s = simulate({ ...base, club: CLUBS[3], origin: [100, 200], surfaceAt: (x, z) => (seen.push([x, z]), "fairway") });
    expect(s.ox).toBe(100);
    expect(s.oz).toBe(200);
    expect(seen.length).toBeGreaterThan(0);
    for (const [x, z] of seen) expect(z).toBeGreaterThanOrEqual(200 - 1);
    expect(s.carry).toBeCloseTo(simulate({ ...base, club: CLUBS[3] }).carry, 9);
  });
});

describe("water", () => {
  it("a shot that comes down in a pond ends there: one splash, no roll", () => {
    const sw = simulate({ ...base, club: CLUBS[3], speed: 0.85, surfaceAt: (x, z) => (z > 90 && z < 140 ? "water" : "fairway") });
    expect(sw.surface).toBe("water");
    expect(sw.bounces).toHaveLength(1);
    expect(sw.bounces[0].surface).toBe("water");
    expect(sw.total).toBeCloseTo(sw.carry, 1);
    // it stops where it landed
    const end = at(sw, sw.restT);
    expect(end[0]).toBeCloseTo(sw.bounces[0].x, 1);
    expect(end[2]).toBeCloseTo(sw.bounces[0].z, 1);
    expect(sw.restT - sw.landT).toBeLessThan(0.1);
  });
  it("the drop is the last dry ground it passed over, on the near side of the water", () => {
    const sw = simulate({ ...base, club: CLUBS[3], speed: 0.85, surfaceAt: (x, z) => (z > 90 && z < 140 ? "water" : "fairway") });
    expect(sw.drop).not.toBeNull();
    expect(sw.drop!.z).toBeLessThanOrEqual(90);
    expect(sw.drop!.z).toBeGreaterThan(90 - 1.5);
  });
  it("a ball that rolls into a pond ends in it", () => {
    // the driver carries about 225 m and rolls out to about 240: water from 236 m is reached on the roll
    const t = simulate({ ...base, club: CLUBS[0], speed: 1, surfaceAt: (x, z) => (z > 236 ? "water" : "fairway") });
    expect(t.bounces.length).toBeGreaterThan(1);
    expect(t.surface).toBe("water");
    expect(t.bounces[t.bounces.length - 1].surface).toBe("water");
    expect(t.drop!.z).toBeLessThanOrEqual(236);
  });
  it("a shot that stays dry has no drop, and the range never sees water", () => {
    expect(simulate({ ...base, club: CLUBS[3] }).drop).toBeNull();
    // a sand wedge carries about 74 m: short of the pond
    expect(simulate({ ...base, club: CLUBS[5], surfaceAt: pond }).drop).toBeNull();
  });
});

describe("lies and the hand", () => {
  it("no lie is no change", () => {
    for (const [k, v] of Object.entries(CASES)) expect(sum({ ...v, lie: {} }), k).toEqual(sum(v));
  });
  it("speed and spin multipliers shorten the shot, in order", () => {
    const carry = (m: number) => simulate({ ...base, club: CLUBS[3], lie: { speed: m } }).carry;
    expect(carry(1)).toBeGreaterThan(carry(0.9));
    expect(carry(0.9)).toBeGreaterThan(carry(0.82));
    expect(carry(0.82)).toBeGreaterThan(carry(0.5));
  });
  it("a contact cap holds a pure strike down, and leaves a poor one alone", () => {
    const pure = simulate({ ...base, club: CLUBS[3], lie: { contactCap: 0.6 } });
    expect(pure.carry).toBeCloseTo(simulate({ ...base, club: CLUBS[3], contact: 0.6 }).carry, 9);
    const poor = simulate({ ...base, club: CLUBS[3], contact: 0.4, lie: { contactCap: 0.6 } });
    expect(poor.carry).toBeCloseTo(simulate({ ...base, club: CLUBS[3], contact: 0.4 }).carry, 9);
  });
  it("a wandering face uses the hand it is given, and repeats with the same one", () => {
    const hand = (v: number) => () => v;
    const a = simulate({ ...base, club: CLUBS[3], lie: { faceNoise: 0.2 }, rng: hand(0.9) });
    const b = simulate({ ...base, club: CLUBS[3], lie: { faceNoise: 0.2 }, rng: hand(0.9) });
    const c = simulate({ ...base, club: CLUBS[3], lie: { faceNoise: 0.2 }, rng: hand(0.1) });
    expect(a.side).toBe(b.side);
    expect(a.side).toBeGreaterThan(0);
    expect(c.side).toBeLessThan(0);
    expect(a.side).toBeCloseTo(-c.side, 6);
  });
  it("without a lie nothing asks for a random number", () => {
    const rng = () => {
      throw new Error("asked");
    };
    expect(() => simulate({ ...base, club: CLUBS[3], rng })).not.toThrow();
  });
});

const GOLDEN: Record<string, ReturnType<typeof sum>> = {
  "driver, flat": {
    "carry": 246.04,
    "total": 261.6,
    "side": 0,
    "curve": 0,
    "apex": 29.49,
    "restT": 9.87,
    "n": 594,
    "bounces": 3,
    "end": [
      0,
      239.21
    ],
    "surface": "fairway",
    "mph": 143.16,
    "launch": 11.5,
    "spin": 2650
  },
  "3 wood, flat": {
    "carry": 222.31,
    "total": 236.02,
    "side": 0,
    "curve": 0,
    "apex": 25.26,
    "restT": 9.32,
    "n": 561,
    "bounces": 3,
    "end": [
      0,
      215.82
    ],
    "surface": "fairway",
    "mph": 129.74,
    "launch": 11,
    "spin": 3500
  },
  "5 iron, flat": {
    "carry": 183.51,
    "total": 195.26,
    "side": 0,
    "curve": 0,
    "apex": 23.97,
    "restT": 8.63,
    "n": 519,
    "bounces": 3,
    "end": [
      0,
      178.54
    ],
    "surface": "fairway",
    "mph": 111.85,
    "launch": 14,
    "spin": 5200
  },
  "7 iron, flat": {
    "carry": 149.9,
    "total": 159.64,
    "side": 0,
    "curve": 0,
    "apex": 19.39,
    "restT": 7.61,
    "n": 458,
    "bounces": 3,
    "end": [
      0,
      145.98
    ],
    "surface": "fairway",
    "mph": 98.43,
    "launch": 17,
    "spin": 6700
  },
  "pitching wedge, flat": {
    "carry": 114.68,
    "total": 122.09,
    "side": 0,
    "curve": 0,
    "apex": 17.86,
    "restT": 6.77,
    "n": 408,
    "bounces": 3,
    "end": [
      0,
      111.64
    ],
    "surface": "fairway",
    "mph": 82.77,
    "launch": 24,
    "spin": 8200
  },
  "sand wedge, flat": {
    "carry": 81.41,
    "total": 86.41,
    "side": 0,
    "curve": 0,
    "apex": 15.66,
    "restT": 5.87,
    "n": 354,
    "bounces": 3,
    "end": [
      0,
      79.01
    ],
    "surface": "fairway",
    "mph": 67.11,
    "launch": 32,
    "spin": 9000
  },
  "7 iron, half": {
    "carry": 63.15,
    "total": 71.86,
    "side": 0,
    "curve": 0,
    "apex": 5.33,
    "restT": 4.82,
    "n": 291,
    "bounces": 2,
    "end": [
      0,
      65.71
    ],
    "surface": "fairway",
    "mph": 63.98,
    "launch": 17,
    "spin": 5640
  },
  "driver, slice into a crosswind": {
    "carry": 234.83,
    "total": 249.48,
    "side": 92.37,
    "curve": 77.7,
    "apex": 27.3,
    "restT": 9.58,
    "n": 577,
    "bounces": 3,
    "end": [
      84.46,
      211.91
    ],
    "surface": "fairway",
    "mph": 143.16,
    "launch": 11.5,
    "spin": 2650
  },
  "5 iron, hook, tailwind": {
    "carry": 181.34,
    "total": 195.87,
    "side": -33.69,
    "curve": -24.87,
    "apex": 18.9,
    "restT": 8.12,
    "n": 489,
    "bounces": 3,
    "end": [
      -13.04,
      178.63
    ],
    "surface": "fairway",
    "mph": 111.85,
    "launch": 14,
    "spin": 5200
  },
  "pw, thin": {
    "carry": 76.43,
    "total": 86.73,
    "side": 0,
    "curve": 0,
    "apex": 5.32,
    "restT": 5.2,
    "n": 313,
    "bounces": 2,
    "end": [
      0,
      79.31
    ],
    "surface": "fairway",
    "mph": 73.66,
    "launch": 13.2,
    "spin": 6970
  },
  "sw, fat, headwind": {
    "carry": 65.58,
    "total": 69.11,
    "side": 0,
    "curve": 0,
    "apex": 15.61,
    "restT": 5.62,
    "n": 339,
    "bounces": 3,
    "end": [
      0,
      63.19
    ],
    "surface": "fairway",
    "mph": 59.73,
    "launch": 36.8,
    "spin": 7650
  },
  "7 iron on the range": {
    "carry": 149.9,
    "total": 159.64,
    "side": 0,
    "curve": 0,
    "apex": 19.39,
    "restT": 7.61,
    "n": 458,
    "bounces": 3,
    "end": [
      29,
      143.07
    ],
    "surface": "fairway",
    "mph": 98.43,
    "launch": 17,
    "spin": 6700
  },
  "driver on the range, to the far end": {
    "carry": 258.53,
    "total": 274.39,
    "side": 0,
    "curve": 0,
    "apex": 33.1,
    "restT": 10.28,
    "n": 618,
    "bounces": 3,
    "end": [
      0,
      250.9
    ],
    "surface": "fairway",
    "mph": 148.89,
    "launch": 11.5,
    "spin": 2700
  }
};
