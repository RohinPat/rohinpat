import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as M from "@/components/offhours/golf/range";
import * as S from "@/components/offhours/golf/swing";
import { makeSim, seedRandom, stubScratchCanvas, type Sim } from "./golf-headless";

// these play real shots and rounds, which run many times slower under coverage on CI
vi.setConfig({ testTimeout: 60_000 });

// The swing's numbers: what a gesture, a two-press meter swing, an over-the-top swing and a phone's swing turn into
// (power, start line, curve, contact, thin/fat) before the ball is struck. The expected values below were recorded from
// the range as it was BEFORE the swing logic moved into golf/swing.ts, so they pin that move to no change at all.

beforeEach(() => {
  stubScratchCanvas();
  seedRandom(21);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const summary = (s: Sim) => {
  const sh = s.r.shot!;
  return {
    label: s.r.label,
    contact: +s.r.contact.toFixed(4),
    mph: +sh.speed.toFixed(2),
    launch: +sh.launch.toFixed(2),
    spin: sh.spin,
    carry: +sh.carry.toFixed(2),
    side: +sh.side.toFixed(2),
    curve: +sh.curve.toFixed(2),
    timing: s.r.timing === null ? null : +s.r.timing.toFixed(4),
  };
};

const fresh = (club: number) => {
  const s = makeSim(M);
  s.r.club = club;
  s.calm();
  s.frame();
  return s;
};

/** a pointer swing: press, pull down by `pull` of the swing length over `hold` s, come back up with a sideways drift */
function gesture(club: number, pull: number, hold: number, drift: number, bend = 0, back = 0.4) {
  const s = fresh(club);
  const L = M.swingLen(900);
  const x0 = 720, y0 = 300;
  M.rangePointer(s.r, "down", x0, y0, 1440, 900, s.time(), s.env);
  const n = Math.round(hold * 60);
  for (let i = 1; i <= n; i++) {
    s.frame();
    M.rangePointer(s.r, "move", x0 + bend * (i / n), y0 + pull * L * (i / n), 1440, 900, s.time(), s.env);
  }
  // back up: the reversal, then the downswing over `back` s
  const m = Math.round(back * 60);
  for (let i = 1; i <= m && s.r.phase !== "fly"; i++) {
    s.frame();
    const u = i / m;
    M.rangePointer(s.r, "move", x0 + bend + (drift - bend) * u, y0 + pull * L * (1 - u) - 0.03 * L * u, 1440, 900, s.time(), s.env);
  }
  if (s.r.phase !== "fly") M.rangePointer(s.r, "up", x0 + drift, y0, 1440, 900, s.time(), s.env);
  return s;
}

/** a keyboard swing: Space, `power` of a backswing, Space, then Space `late` s after the line (negative: before) */
function meter(club: number, powerAt: number, late: number) {
  const s = fresh(club);
  s.key(" ");
  s.run(() => s.r.sw.b >= powerAt, 5);
  s.key(" ");
  s.run(() => s.r.sw.dur - s.r.sw.t <= -late, 5);
  if (s.r.phase === "down") s.key(" ");
  if (s.r.phase !== "fly") s.run(() => s.r.phase === "fly", 5);
  return s;
}

const remote = (club: number, shot: { power: number; face: number; curve: number; contact: number }) => {
  const s = fresh(club);
  expect(M.rangeRemoteSwing(s.r, shot, s.time())).toBe(true);
  s.run(() => s.r.phase === "fly", 5);
  return s;
};

const over = (club: number) => {
  const s = fresh(club);
  s.key(" ");
  s.run(() => s.r.phase === "fly", 10);
  return s;
};

describe("swing numbers, recorded before the extraction", () => {
  const cases: Record<string, () => Sim> = {
    "gesture, square, 70% pull": () => gesture(3, 0.7, 0.5, 0),
    "gesture, full pull, drifting right": () => gesture(0, 1.0, 0.6, 60, 10),
    "gesture, short pull, closed": () => gesture(4, 0.35, 0.4, -50, -20),
    "gesture, held long (late reversal)": () => gesture(2, 0.8, 1.2, 5),
    "gesture, snapped back (rushed)": () => gesture(2, 0.8, 0.3, 0, 0, 0.08),
    "gesture, 110% pull": () => gesture(1, 1.1, 0.6, 0),
    "meter, 60% power on the line": () => meter(3, 0.6, 0),
    "meter, full power early": () => meter(1, 0.95, -0.1),
    "meter, 80% late": () => meter(5, 0.8, 0.07),
    "meter, missed the line": () => meter(3, 0.7, 0.2),
    "over the top, driver": () => over(0),
    "over the top, 7 iron": () => over(3),
    "phone, pure": () => remote(3, { power: 1, face: 0, curve: 0, contact: 1 }),
    "phone, half power, open face": () => remote(4, { power: 0.5, face: 0.4, curve: 0.5, contact: 0.9 }),
    "phone, over-swung with poor contact": () => remote(2, { power: 1.12, face: -0.3, curve: -0.4, contact: 0.7 }),
    "phone, thin or fat": () => remote(0, { power: 0.9, face: 0, curve: 0, contact: 0.5 }),
  };

  it("every case is the number it was", () => {
    const got: Record<string, ReturnType<typeof summary>> = {};
    for (const [name, run] of Object.entries(cases)) {
      seedRandom(21);
      got[name] = summary(run());
    }
    if (process.env.RECORD_GOLF_SWING) console.log(JSON.stringify(got, null, 1));
    expect(got).toEqual(GOLDEN);
  });
});

const GOLDEN: Record<string, ReturnType<typeof summary>> = {
  "gesture, square, 70% pull": {
    "label": "PURE",
    "contact": 1,
    "mph": 77.76,
    "launch": 17,
    "spin": 6070,
    "carry": 96.63,
    "side": 0,
    "curve": 0,
    "timing": null
  },
  "gesture, full pull, drifting right": {
    "label": "SOLID",
    "contact": 0.9047,
    "mph": 140.16,
    "launch": 11.5,
    "spin": 2570,
    "carry": 235.08,
    "side": 50.4,
    "curve": 34.56,
    "timing": null
  },
  "gesture, short pull, closed": {
    "label": "PURE",
    "contact": 0.9793,
    "mph": 44.9,
    "launch": 24,
    "spin": 6480,
    "carry": 35.12,
    "side": -2.56,
    "curve": -0.45,
    "timing": null
  },
  "gesture, held long (late reversal)": {
    "label": "PURE",
    "contact": 1,
    "mph": 96.19,
    "launch": 14,
    "spin": 4870,
    "carry": 143.09,
    "side": 1.54,
    "curve": 0.61,
    "timing": null
  },
  "gesture, snapped back (rushed)": {
    "label": "SOLID",
    "contact": 0.9167,
    "mph": 94.42,
    "launch": 14,
    "spin": 4750,
    "carry": 138.34,
    "side": 0,
    "curve": 0,
    "timing": null
  },
  "gesture, 110% pull": {
    "label": "SOLID",
    "contact": 0.868,
    "mph": 127.86,
    "launch": 11,
    "spin": 3380,
    "carry": 216.97,
    "side": 0,
    "curve": 0,
    "timing": null
  },
  "meter, 60% power on the line": {
    "label": "PURE",
    "contact": 1,
    "mph": 71.28,
    "launch": 17,
    "spin": 5870,
    "carry": 80.29,
    "side": 0,
    "curve": 0,
    "timing": 0.0127
  },
  "meter, full power early": {
    "label": "SOLID",
    "contact": 0.8829,
    "mph": 122.38,
    "launch": 11,
    "spin": 3330,
    "carry": 201.86,
    "side": 22.78,
    "curve": 17.07,
    "timing": -0.0888
  },
  "meter, 80% late": {
    "label": "SOLID",
    "contact": 0.9273,
    "mph": 56.93,
    "launch": 32,
    "spin": 8260,
    "carry": 61.27,
    "side": -1.41,
    "curve": -0.7,
    "timing": 0.0764
  },
  "meter, missed the line": {
    "label": "FAT",
    "contact": 0.64,
    "mph": 72.37,
    "launch": 19.55,
    "spin": 5430,
    "carry": 84.83,
    "side": -15.07,
    "curve": -8.27,
    "timing": 0.1521
  },
  "over the top, driver": {
    "label": "FAT",
    "contact": 0.398,
    "mph": 122.17,
    "launch": 13.22,
    "spin": 2160,
    "carry": 172.04,
    "side": -61.31,
    "curve": -50.97,
    "timing": null
  },
  "over the top, 7 iron": {
    "label": "FAT",
    "contact": 0.398,
    "mph": 80.5,
    "launch": 19.55,
    "spin": 5350,
    "carry": 104.85,
    "side": -21.49,
    "curve": -12.89,
    "timing": null
  },
  "phone, pure": {
    "label": "PURE",
    "contact": 1,
    "mph": 98.43,
    "launch": 17,
    "spin": 6700,
    "carry": 149.9,
    "side": 0,
    "curve": 0,
    "timing": null
  },
  "phone, half power, open face": {
    "label": "SOLID",
    "contact": 0.9,
    "mph": 52.61,
    "launch": 24,
    "spin": 6700,
    "carry": 48.51,
    "side": 3.47,
    "curve": 1.33,
    "timing": null
  },
  "phone, over-swung with poor contact": {
    "label": "FAT",
    "contact": 0.464,
    "mph": 100.43,
    "launch": 16.1,
    "spin": 4400,
    "carry": 156.4,
    "side": -22.94,
    "curve": -16.24,
    "timing": null
  },
  "phone, thin or fat": {
    "label": "FAT",
    "contact": 0.44,
    "mph": 116.74,
    "launch": 13.22,
    "spin": 2140,
    "carry": 181.35,
    "side": 0,
    "curve": 0,
    "timing": null
  }
};

describe("strikeNumbers, on its own", () => {
  const base = { src: "remote" as const, peak: 1, x0: 0, xTop: 0, xNow: 0, lastL: 160, td: 0.3, autoFace: 0, remote: null, over: false };

  it("a phone's swing passes its face, curve and contact through", () => {
    const k = S.strikeNumbers({ ...base, remote: { power: 1, face: 0.2, curve: -0.3, contact: 0.95 } }, 3);
    expect([k.face, k.curve, k.contact, k.label, k.lift, k.speed]).toEqual([0.2, -0.3, 0.95, "PURE", 1, 1]);
  });
  it("a poor strike is thin or fat as the injected hand says, and never asks Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    const poor = { ...base, remote: { power: 1, face: 0, curve: 0, contact: 0.5 } };
    const thin = S.strikeNumbers(poor, 3, () => 0.9);
    const fat = S.strikeNumbers(poor, 3, () => 0.1);
    expect(spy).not.toHaveBeenCalled();
    expect([thin.label, thin.lift, thin.contact]).toEqual(["THIN", 0.55, 0.5]);
    expect([fat.label, fat.lift]).toEqual(["FAT", 1.15]);
    expect(fat.contact).toBeCloseTo(0.44, 6);
  });
  it("a square gesture at a good tempo is pure; rushing it or dawdling costs contact", () => {
    const g = { ...base, src: "gesture" as const, peak: 0.7 };
    expect(S.strikeNumbers(g, 3).contact).toBe(1);
    expect(S.strikeNumbers({ ...g, td: 0.04 }, 3).contact).toBeCloseTo(0.85, 6);
    expect(S.strikeNumbers({ ...g, td: 1.0 }, 3, () => 0.9).contact).toBeLessThan(0.7);
    // a drag that ends to the right of where it began starts the ball right and bends it
    const open = S.strikeNumbers({ ...g, xNow: 40, xTop: 0 }, 3);
    expect(open.face).toBeGreaterThan(0);
    expect(open.curve).toBeGreaterThan(0);
  });
  it("a meter swing: the line is pure, an early press closes the face, a late one opens it the other way", () => {
    const m = { ...base, src: "meter" as const };
    expect(S.strikeNumbers(m, 3).contact).toBe(1);
    expect(S.meterFace(-0.165)).toBeCloseTo(-0.5, 6);
    // a frame either side of the line is the line
    expect(S.meterFace(S.METER_SQUARE)).toBe(0);
    expect(S.meterFace(-S.METER_SQUARE)).toBe(0);
    expect(S.meterFace(0.5)).toBe(1);
    expect(S.strikeNumbers({ ...m, autoFace: -1 }, 3, () => 0.9).face).toBeCloseTo(-0.6, 6);
  });
  it("over the top is the same poor, hooked strike with every club, at a speed that carries about 70%", () => {
    for (let c = 0; c < 6; c++) {
      const k = S.strikeNumbers({ ...base, src: "meter", over: true, peak: 1.15 }, c, () => 0.9);
      expect(k.overTop).toBe(true);
      expect(k.contact).toBeLessThanOrEqual(S.OVER_CONTACT);
      expect(k.speed).toBe(S.overSpeed(c));
    }
    // the same swing as a gesture is not an over-the-top swing
    expect(S.strikeNumbers({ ...base, src: "gesture", over: true }, 3).overTop).toBe(false);
  });
  it("power past full costs contact", () => {
    expect(S.strikeNumbers({ ...base, remote: { power: 1.1, face: 0, curve: 0, contact: 1 }, peak: 1.1 }, 3, () => 0.9).contact).toBeLessThan(0.9);
  });
  it("the club table: the suggestion carries what was asked, with a little in hand", () => {
    for (const yd of [60, 90, 135, 180, 230]) {
      const sg = S.suggest(yd);
      expect(S.fullCarry(sg.club)).toBeGreaterThanOrEqual(yd - 1);
      expect(sg.power).toBeGreaterThanOrEqual(0.62);
      expect(S.suggestCourse(yd)).toEqual(sg);
    }
    expect(S.suggest(135).club).toBe(3);
    expect(S.powerFor(0, 300)).toBeNull();
  });
  it("a chip is a sand wedge at the swing that carries it, where the range's suggestion would reach for a driver", () => {
    expect(S.suggest(30).club).toBe(0);
    for (const yd of [10, 30, 45]) {
      const sg = S.suggestCourse(yd);
      expect(sg.club).toBe(5);
      expect(sg.power).toBeGreaterThan(0);
      expect(sg.power).toBeLessThan(0.62);
    }
  });
});
