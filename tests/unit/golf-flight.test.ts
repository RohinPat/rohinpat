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
