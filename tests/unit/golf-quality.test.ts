import { describe, expect, it } from "vitest";
import { Governor, LEVELS, LONG_MS, SETTLE_MS, WINDOW, startLevel } from "@/components/golf3d/quality";

// The course turns its own quality down when frames run slow (a phone that is
// weaker than it looks), and never back up.

const run = (g: Governor, ms: number, n: number) => {
  let drops = 0;
  for (let i = 0; i < n; i++) if (g.frame(ms)) drops++;
  return drops;
};
/** frames enough to get past the settle and judge one window */
const oneWindow = (ms: number) => Math.ceil(SETTLE_MS / ms) + WINDOW;

describe("quality levels", () => {
  it("get cheaper all the way down", () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].pixels).toBeLessThan(LEVELS[i - 1].pixels);
      expect(LEVELS[i].shadowMap).toBeLessThanOrEqual(LEVELS[i - 1].shadowMap);
    }
    expect(LEVELS[LEVELS.length - 1].shadows).toBe("off");
  });

  it("a desktop starts at the top, a phone one down, a small phone two down", () => {
    expect(startLevel({ touch: false, cores: 2, memoryGB: 2 })).toBe(0);
    expect(startLevel({ touch: true })).toBe(1);
    expect(startLevel({ touch: true, cores: 8, memoryGB: 8 })).toBe(1);
    expect(startLevel({ touch: true, cores: 4 })).toBe(2);
    expect(startLevel({ touch: true, cores: 8, memoryGB: 3 })).toBe(2);
  });
});

describe("the governor", () => {
  it("leaves a smooth 60 or 120 fps alone", () => {
    const g = new Governor(0);
    expect(run(g, 16.7, 2000)).toBe(0);
    expect(run(g, 8.3, 2000)).toBe(0);
    expect(g.level).toBe(0);
  });

  it("drops one level for a slow stretch, waits, and stops at the bottom", () => {
    const g = new Governor(1);
    expect(run(g, 28, oneWindow(28))).toBe(1);
    expect(g.level).toBe(2);
    // right after a change, nothing is judged
    expect(run(g, 28, Math.floor(SETTLE_MS / 28) - 1)).toBe(0);
    expect(run(g, 28, 5000)).toBe(LEVELS.length - 1 - 2);
    expect(g.level).toBe(LEVELS.length - 1);
  });

  it("a few slow frames among fast ones, or hitches (a hole being built, a hidden tab), do not count", () => {
    const g = new Governor(0);
    for (let i = 0; i < 5000; i++) g.frame(i % 3 === 0 ? 40 : 16.7);
    expect(g.level).toBe(0);
    expect(run(g, LONG_MS + 1, 5000)).toBe(0);
    expect(run(g, 0, 100)).toBe(0);
    expect(g.level).toBe(0);
  });

  it("hold() starts the count again", () => {
    const g = new Governor(0);
    run(g, 30, oneWindow(30) - 1);
    g.hold();
    expect(run(g, 30, 1)).toBe(0);
    expect(g.level).toBe(0);
  });
});
