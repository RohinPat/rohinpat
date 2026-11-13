import { describe, expect, it } from "vitest";
import { HOLE_DEFS, NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { queryFor, roundStats, setupFor, setupFromQuery, shareText, today } from "@/components/golf3d/modes";
import { flyoverS, flyoverView, titleView } from "@/components/golf3d/flyover";

import { BOTS, playRound } from "./golf-bots";

// The ways to play on /golf (modes.ts): a round is its mode and seed, read from and written to the URL; the daily
// round is the same for everyone on a date. The flyover ends where the game's camera waits. The round's stats
// add up to what was played.

describe("modes", () => {
  it("the daily round is the same all day and changes the next", () => {
    const a = setupFor("daily", { day: "2026-11-08" });
    const b = setupFor("daily", { day: "2026-11-08" });
    const c = setupFor("daily", { day: "2026-11-09" });
    expect(a.seed).toBe(b.seed);
    expect(a.defs.map((d) => d.wind)).toEqual(b.defs.map((d) => d.wind));
    expect(a.seed).not.toBe(c.seed);
    expect(a.defs.map((d) => d.wind)).not.toEqual(c.defs.map((d) => d.wind));
    // the holes are the nine, only the wind is the day's, and it stays playable
    expect(a.defs.map((d) => d.n)).toEqual(NINE_DEFS.map((d) => d.n));
    for (const d of a.defs) expect(d.wind.speed).toBeGreaterThan(0.5), expect(d.wind.speed).toBeLessThan(4.5);
  });

  it("a bad date in the link plays today's round", () => {
    expect(setupFor("daily", { day: "nope" }).day).toBe(today());
  });

  it("quick 3 is three different holes in course order, the same for a seed", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = setupFor("quick", { seed });
      const ns = s.defs.map((d) => d.n);
      expect(ns).toHaveLength(3);
      expect(new Set(ns).size).toBe(3);
      expect([...ns].sort((x, y) => x - y)).toEqual(ns);
      expect(setupFor("quick", { seed }).defs.map((d) => d.n)).toEqual(ns);
    }
  });

  it("a round's link reads back as the same round", () => {
    for (const s of [setupFor("full", { seed: 77 }), setupFor("quick", { seed: 5 }), setupFor("daily", { day: "2026-01-02" })]) {
      const back = setupFromQuery(new URLSearchParams(queryFor(s)));
      expect(back?.mode).toBe(s.mode);
      expect(back?.seed).toBe(s.seed);
      expect(back?.defs.map((d) => d.n)).toEqual(s.defs.map((d) => d.n));
    }
    expect(setupFromQuery(new URLSearchParams(""))).toBeNull();
  });

  it("the result to share has the score against par, each hole and the link", () => {
    const s = setupFor("quick", { seed: 5 });
    const scores = s.defs.map((d) => ({ strokes: d.par + 1, pickedUp: false, call: "BOGEY" }));
    const par = s.defs.reduce((a, d) => a + d.par, 0);
    const t = shareText(s, scores, "https://example.test");
    expect(t).toContain(`${par + 3} (+3)`);
    expect(t).toContain(`${s.defs[0].n}:${s.defs[0].par + 1}`);
    expect(t).toContain(`https://example.test/golf?quick=5`);
  });

  it("the skilled bot finishes the next ten daily rounds near par", () => {
    for (let i = 0; i < 10; i++) {
      const day = `2026-12-${String(i + 1).padStart(2, "0")}`;
      const s = setupFor("daily", { day });
      const r = playRound(BOTS.skilled, s.seed, { game: { holes: s.defs } });
      expect(r.finished, day).toBe(true);
      expect(r.pickedUp, day).toBe(0);
      // (par 36 again: hole 4 became a par 4 with two crossings to carry and hole 5 a par 4 over the dune; with hole 6's cape too,
      // a skilled bot's worst of ten days is a stroke or two higher than it was)
      expect(r.total - r.par, day).toBeLessThan(12);
    }
  });
});

describe("the flyover", () => {
  const hole = buildHole(HOLE_DEFS[0]);
  const end = { x: 1, y: 1.9, z: -8, tx: 0, ty: 0.9, tz: 60, F: 1200 };
  it("starts high near the green and ends at the game's camera", () => {
    const v0 = flyoverView(hole, 0, 1280, 800, end);
    expect(v0.y).toBeGreaterThan(30);
    expect(hole.toPin(v0.x, v0.z)).toBeLessThan(110);
    expect(flyoverView(hole, 1, 1280, 800, end)).toEqual(end);
  });
  it("lasts longer on a longer hole, within bounds", () => {
    expect(flyoverS(470)).toBeGreaterThan(flyoverS(135));
    expect(flyoverS(135)).toBeGreaterThanOrEqual(3);
    expect(flyoverS(600)).toBeLessThanOrEqual(5);
  });
  it("the title camera circles above the hole", () => {
    const a = titleView(hole, 0, 1280, 800), b = titleView(hole, 30, 1280, 800);
    expect(a.y).toBeGreaterThan(60);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(10);
    expect([a.tx, a.tz]).toEqual([b.tx, b.tz]);
  });
});

describe("the round's stats", () => {
  it("count each hole: fairways only on par 4s and 5s, putts no more than strokes", () => {
    const r = playRound(BOTS.skilled, 11);
    const g = r.game;
    expect(g.stats).toHaveLength(g.defs.length);
    g.defs.forEach((d, i) => {
      const st = g.stats[i];
      expect(st.fairway === null, `hole ${d.n}`).toBe(d.par === 3);
      expect(st.putts).toBeGreaterThanOrEqual(0);
      expect(st.putts).toBeLessThanOrEqual(g.scores[i].strokes);
      if (st.gir) expect(g.scores[i].strokes - st.putts).toBeLessThanOrEqual(d.par - 2);
    });
    const s = roundStats(g);
    expect(s.greens).toMatch(/^\d\/6$/);
    expect(s.fairways).toMatch(/^\d\/5$/);
    expect(s.putts).toBe(g.stats.reduce((a, x) => a + x.putts, 0));
  });
});
