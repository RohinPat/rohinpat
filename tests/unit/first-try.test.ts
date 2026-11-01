import { describe, expect, it } from "vitest";
import { forTouch } from "@/components/offhours/hints";
import { PIECE_META } from "@/components/offhours/pieces";
import { newPutt, puttPointer, type PuttEnv } from "@/components/offhours/golf/green";

// Fixes from the gameplay audit for the first thing a visitor tries.

describe("hints on a touch screen", () => {
  it("no game's hint mentions a key, an arrow or WASD on a phone", () => {
    for (const m of PIECE_META) {
      for (const line of forTouch(m.how)) expect(line, `${m.id}: ${line}`).not.toMatch(/keyboard|\bkeys?\b|arrow|WASD|Space|←|→|↑|↓/i);
    }
  });
  it("keeps the touch half of a line", () => {
    expect(forTouch(["Walk it yourself: drag (or arrows/WASD)"])).toEqual(["Walk it yourself: drag"]);
    expect(forTouch(["Swipe up to shoot (or arrows aim, hold Space)"])).toEqual(["Swipe up to shoot"]);
    expect(forTouch(["Keyboard: ←/→ steer", "Beat the ghost"])).toEqual(["Beat the ghost"]);
    expect(forTouch(["Click steps to build the beat"])).toEqual(["Tap steps to build the beat"]);
  });
});

describe("golf: a putt is a pull, not a click", () => {
  const env: PuttEnv = { play: true, say: () => {} };
  const fresh = () => {
    const p = newPutt();
    p.view = { sc: 30, cx: 600, cy: 400, rot: false, w: 1200, h: 800 };
    return p;
  };
  it("a click away from the ball does not putt", () => {
    const p = fresh();
    puttPointer(p, "down", 150, 120, 1, env);
    puttPointer(p, "up", 150, 120, 1.1, env);
    expect(p.putter).toBeNull();
  });
  it("a pull that starts anywhere putts", () => {
    const a = fresh();
    puttPointer(a, "down", 150, 120, 1, env);
    puttPointer(a, "move", 150, 240, 1.05, env);
    puttPointer(a, "up", 150, 240, 1.1, env);
    expect(a.putter).not.toBeNull();
    // pulled down the screen, so the putt goes up it, with the drag's length as its power
    expect(a.putter!.dy).toBeLessThan(0);
    expect(a.putter!.pull).toBeGreaterThan(0.3);
  });
});
