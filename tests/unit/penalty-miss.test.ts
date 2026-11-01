import { describe, expect, it } from "vitest";
import { GH, GW, SHOTS, makeStrike, missWhy, shotById } from "@/components/offhours/penaltyModel";

// a strike with no luck in it, so the cause of a miss is the player's
const calm = () => 0.5;

describe("penalty: why a kick missed", () => {
  const placed = shotById("placed");

  it("says too hard when the power is past the kick's band", () => {
    const st = makeStrike(placed, { x: 1.5, y: 1.2 }, 1, calm);
    expect(missWhy(st, { x: 1.5, y: GH + 0.6 })).toBe("TOO HARD");
  });

  it("says too soft when it is short of the band", () => {
    const st = makeStrike(placed, { x: 1.5, y: 1.2 }, 0.1, calm);
    expect(missWhy(st, { x: 1.9, y: 0.5 })).toBe("TOO SOFT");
  });

  it("says off target when it was pointed at the frame or outside it", () => {
    const sweet = makeStrike(placed, { x: GW + 0.5, y: 1 }, placed.sweet, calm);
    expect(missWhy(sweet, { x: GW + 0.5, y: 1 })).toBe("OFF TARGET");
    const inside = makeStrike(placed, { x: 1.5, y: 1.2 }, placed.sweet, calm);
    expect(missWhy(inside, { x: GW + 0.1, y: 1.2 })).toBe("OFF TARGET");
  });

  it("a driven shot over the bar at near full power was hit too hard", () => {
    const driven = shotById("driven");
    const st = makeStrike(driven, { x: 1, y: 2.2 }, 0.95, calm);
    expect(missWhy(st, { x: 1, y: GH + 0.3 })).toBe("TOO HARD");
  });

  it("every kick has a band inside 0..1, so the words can always be earned", () => {
    for (const s of SHOTS) {
      expect(s.sweet - s.width).toBeGreaterThan(0);
      expect(s.sweet + s.width).toBeLessThanOrEqual(1.01);
    }
  });
});
