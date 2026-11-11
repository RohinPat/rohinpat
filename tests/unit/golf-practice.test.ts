import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSEST_BALLS, CourseGame, GREEN_BALLS, STEP, TARGET_SHOTS, targetPoints } from "@/components/offhours/golf/play";
import { NINE_DEFS, RANGE_DEF, buildHole } from "@/components/offhours/golf/course";
import { TARGETS, YD } from "@/components/offhours/golf/scene";
import { fullCarry } from "@/components/offhours/golf/swing";
import { challengeText, isChallenge, isPractice, modeName, onRange, queryFor, setupFor, setupFromQuery, targetsRating } from "@/components/golf3d/modes";
import { forgetBest } from "@/components/offhours/golf/score";
import { stubScratchCanvas } from "./golf-headless";

// Practice on the 3D page: the range (balls at the target flags from one tee) and the putting green (balls around the
// nine's cups). No cards and no score.

vi.setConfig({ testTimeout: 60_000 });
beforeEach(() => {
  stubScratchCanvas();
  forgetBest();
});
afterEach(() => vi.restoreAllMocks());

const PURE = { power: 1, face: 0, curve: 0, contact: 1 };
function run(g: CourseGame, until: () => boolean, max = 40) {
  const t0 = g.t;
  while (!until() && g.t - t0 < max) g.step(STEP);
  return until();
}
const range = () => new CourseGame({ seed: 3, holes: [RANGE_DEF], practice: "range", hills: true });
const green = () => new CourseGame({ seed: 3, holes: NINE_DEFS, practice: "green", hills: true });

describe("the range hole", () => {
  it("has the six target greens in play, each ringed by fringe, and the field around them", () => {
    const h = buildHole(RANGE_DEF);
    for (const t of TARGETS) {
      expect(h.surfaceAt(t.gx, t.gz)).toBe("green");
      expect(h.surfaceAt(t.gx + t.gr + 1, t.gz)).toBe("fringe");
    }
    expect(h.surfaceAt(0, 30 * YD)).toBe("fairway");
    expect(h.world.greens.length).toBe(1 + TARGETS.length);
  });
});

describe("practice on the range", () => {
  it("starts at once (no tee card), aimed at a flag, and says so", () => {
    const g = range();
    expect(g.phase).toBe("ready");
    const [tx, tz] = g.target();
    expect([tx, tz]).toEqual([TARGETS[g.rangeTarget].gx, TARGETS[g.rangeTarget].gz]);
    expect(g.said[0]).toMatch(/^Range\. .* the \d+ yard flag\.$/);
  });
  it("a club picks the flag it carries nearest to", () => {
    const g = range();
    for (let c = 0; c < 6; c++) {
      g.setClub(c);
      const carry = fullCarry(c);
      const best = Math.min(...TARGETS.map((t) => Math.abs(t.yd - carry)));
      expect(Math.abs(TARGETS[g.rangeTarget].yd - carry)).toBe(best);
      expect(g.said[g.said.length - 1]).toMatch(new RegExp(`The ${TARGETS[g.rangeTarget].yd} yard flag\\.$`));
    }
  });
  it("says where a ball finished against the nearest flag, then tees up the next with the same club and flag", () => {
    const g = range();
    g.setClub(3);
    const flag = g.rangeTarget;
    g.remoteSwing(PURE);
    expect(run(g, () => g.phase === "rest")).toBe(true);
    expect(g.said[g.said.length - 1]).toMatch(/^7 Iron: \d+ yards carry, \d+ total(, on the \d+ yard green, \d+ feet from the flag|\. \d+ yards? from the \d+ yard flag)\.$/);
    expect(g.result).toMatch(/^(\d+ GREEN · \d+ FT|\d+ YD FROM THE \d+)$/);
    expect(run(g, () => g.phase === "ready")).toBe(true);
    expect(g.ball).toEqual([0, 0]);
    expect(g.strokes).toBe(0);
    expect(g.club).toBe(3);
    expect(g.rangeTarget).toBe(flag);
    expect(g.balls).toBe(1);
    expect(g.replay).toBeNull();
  });
  it("never shows a hole card, however many balls are hit", () => {
    const g = range();
    for (let i = 0; i < 4; i++) {
      g.remoteSwing(PURE);
      expect(run(g, () => g.phase === "ready" && g.balls === i + 1)).toBe(true);
    }
    expect(g.scores).toEqual([]);
  });
});

describe("practice on the green", () => {
  it("starts on the first green with a ball 4 to 30 ft from the cup", () => {
    const g = green();
    expect(g.phase).toBe("putt");
    const ps = g.puttState();
    expect(ps.dist).toBeGreaterThan(1.1);
    expect(ps.dist).toBeLessThan(9.1);
    expect(g.said[g.said.length - 1]).toMatch(/^Green 1\. \d+ feet to the cup\.$/);
  });
  it("a holed ball brings the next, and after GREEN_BALLS the next hole's green; no card, no score", () => {
    const g = green();
    for (let b = 0; b < GREEN_BALLS + 1; b++) {
      const before = g.balls;
      for (let s = 0; s < 12 && g.balls === before; s++) {
        expect(run(g, () => g.phase === "putt" && !g.puttState().rolling, 20)).toBe(true);
        const ps = g.puttState();
        g.puttShoot(Math.atan2(ps.cup[1] - ps.ball[1], ps.cup[0] - ps.ball[0]), Math.min(1, 0.25 + ps.dist * 0.07));
        run(g, () => g.balls !== before || (!g.puttState().rolling && g.t > 0), 20);
        run(g, () => g.balls !== before || !g.puttState().rolling, 20);
      }
      expect(g.balls).toBe(before + 1);
      expect(g.said.some((m) => /^In, (one putt|\d+ putts)\.$/.test(m))).toBe(true);
    }
    expect(g.idx).toBe(1);
    expect(g.phase).toBe("putt");
    expect(g.scores).toEqual([]);
  });
});

describe("the practice modes in the URL", () => {
  it("range and green are practice, named, and come back from their query", () => {
    for (const m of ["range", "green"] as const) {
      const s = setupFor(m);
      expect(isPractice(s.mode)).toBe(true);
      expect(queryFor(s)).toBe(`?${m}`);
      expect(setupFromQuery(new URLSearchParams(queryFor(s).slice(1)))?.mode).toBe(m);
    }
    expect(setupFor("range").defs).toEqual([RANGE_DEF]);
    expect(modeName(setupFor("range"))).toBe("Range");
    expect(modeName(setupFor("green"))).toBe("Putting green");
    expect(isPractice("full")).toBe(false);
  });
});

describe("the range's challenges", () => {
  const challenge = (kind: "targets" | "closest", seed = 11) => new CourseGame({ seed, holes: [RANGE_DEF], practice: "range", hills: true, challenge: kind });
  /** a pure swing of the suggested strength, stepped until the next ball is up or the challenge is over */
  const play = (g: CourseGame) => {
    const b = g.balls;
    g.remoteSwing({ ...PURE, power: g.suggested().power });
    expect(run(g, () => (g.phase === "ready" && g.balls === b + 1) || g.phase === "round-card")).toBe(true);
  };
  it("scores a ball by how close it finished, more for a far flag's miss, 20 more on the green", () => {
    expect(targetPoints(0, 100, true)).toBe(120);
    expect(targetPoints(0, 100, false)).toBe(100);
    expect(targetPoints(10.5, 100, false)).toBe(50);
    expect(targetPoints(10.5, 200, false)).toBeGreaterThan(50);
    expect(targetPoints(99, 100, false)).toBe(0);
  });
  it("targets: ten balls, a new flag each time (never the same twice running) with the club for it, then the end", () => {
    const g = challenge("targets");
    expect(g.said[0]).toMatch(/^Targets: 10 balls, a new flag for each\./);
    for (let i = 0; i < TARGET_SHOTS; i++) {
      expect(g.phase).toBe("ready");
      expect(g.ball).toEqual([0, 0]);
      expect(g.club).toBe(g.suggested().club);
      play(g);
    }
    const ch = g.challenge!;
    expect(g.phase).toBe("round-card");
    expect(ch.done).toBe(true);
    expect(ch.results).toHaveLength(TARGET_SHOTS);
    for (let i = 1; i < ch.results.length; i++) expect(ch.results[i].flag).not.toBe(ch.results[i - 1].flag);
    expect(ch.score).toBe(ch.results.reduce((a, r) => a + r.pts, 0));
    // pure swings of the suggested club score well
    expect(ch.score).toBeGreaterThan(TARGET_SHOTS * 60);
    expect(g.said[g.said.length - 1]).toBe(`Targets over: ${ch.score} points.`);
  });
  it("targets: the same seed plays the same flags; a club change does not move the flag", () => {
    const flags = (seed: number) => {
      const g = challenge("targets", seed);
      const out: number[] = [];
      for (let i = 0; i < 4; i++) {
        out.push(g.rangeTarget);
        play(g);
      }
      return out;
    };
    expect(flags(5)).toEqual(flags(5));
    const g = challenge("targets");
    const t = g.rangeTarget;
    g.setClub(g.club === 0 ? 5 : 0);
    expect(g.rangeTarget).toBe(t);
  });
  it("closest: five balls at one flag, the best counts", () => {
    const g = challenge("closest");
    const flag = g.rangeTarget;
    for (let i = 0; i < CLOSEST_BALLS; i++) play(g);
    const ch = g.challenge!;
    expect(ch.done).toBe(true);
    expect(ch.results.every((r) => r.flag === flag)).toBe(true);
    expect(ch.best).toBe(Math.min(...ch.results.map((r) => r.ft)));
    expect(g.said[g.said.length - 1]).toMatch(/^Closest to the pin over: your best was \d+ feet?\.$/);
  });
  it("Space on the end starts a new challenge", () => {
    const g = challenge("closest");
    for (let i = 0; i < CLOSEST_BALLS; i++) play(g);
    g.step(1);
    g.key({ key: " " }, true);
    expect(g.phase).toBe("ready");
    expect(g.challenge?.results).toEqual([]);
  });
  it("the modes: on the range, scored, their link plays the same flags, their text says the score", () => {
    for (const m of ["targets", "closest"] as const) {
      const s = setupFor(m, { seed: 42 });
      expect(onRange(m) && isChallenge(m) && !isPractice(m)).toBe(true);
      expect(queryFor(s)).toBe(`?${m}=42`);
      expect(setupFromQuery(new URLSearchParams(`${m}=42`))).toEqual(s);
    }
    expect(modeName(setupFor("closest"))).toBe("Closest to the pin");
    const ch = { kind: "targets" as const, shots: 2, results: [{ flag: 1, ft: 12, on: true, pts: 104 }, { flag: 3, ft: 60, on: false, pts: 40 }], score: 144, best: 12, done: true };
    expect(challengeText(setupFor("targets", { seed: 9 }), ch, "https://x")).toBe("Golf, Targets: 144 points\n104 40\nhttps://x/golf?targets=9");
    expect(targetsRating(1000, 10)).toBe("Tour level");
  });
});
