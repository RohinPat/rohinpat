import { describe, expect, it } from "vitest";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { buildScrub, scatter } from "@/components/golf3d/scrub3d";

// The standing waste scrub and long grass (scrub3d.ts): where they stand, that it is the same every time, and what they cost.

const h5 = buildHole(NINE_DEFS[4]);
const h1 = buildHole(NINE_DEFS[0]);
const h3 = buildHole(NINE_DEFS[2]);

describe("scattering scrub and tufts", () => {
  it("stands only where the hole says the ground is of that kind, and the same every time", () => {
    for (const [hole, kind] of [[h5, "waste"], [h5, "fescue"], [h1, "fescue"]] as const) {
      const a = scatter(hole, kind, 4, 400, 1), b = scatter(hole, kind, 4, 400, 1);
      expect(a.length, `${hole.def.n} ${kind}`).toBeGreaterThan(20);
      expect(b).toEqual(a);
      for (const [x, z] of a) expect(hole.surfaceAt(x, z)).toBe(kind);
    }
  });
  it("is capped, thinner where the cap bites, and empty for a hole with no such area or a cap of nothing", () => {
    const dense = scatter(h5, "waste", 1, 100000, 1);
    const capped = scatter(h5, "waste", 1, 150, 1);
    expect(dense.length).toBeGreaterThan(300);
    expect(capped.length).toBeLessThanOrEqual(150);
    expect(capped.length).toBeGreaterThan(60);
    expect(scatter(h3, "waste", 4, 400, 1)).toEqual([]);
    expect(scatter(h5, "waste", 4, 0, 1)).toEqual([]);
  });
  it("keeps clear of the green and of any bunker cut out of a field", () => {
    const g = h5.world.greens[0];
    for (const [x, z] of scatter(h5, "waste", 1, 100000, 1)) expect(Math.hypot(x - g.x, z - g.z)).toBeGreaterThan(8);
  });
});

describe("the scrub mesh", () => {
  it("is two draw calls on a hole with both, none on a hole with neither, and none on the no-GPU tier", () => {
    const ground = terrainOf(h5);
    const sink: { dispose: () => void }[] = [];
    const high = buildScrub(h5, ground, "high", sink)!;
    expect(high.calls).toBe(2);
    expect(high.group.children).toHaveLength(2);
    expect(buildScrub(h5, ground, "low", sink)!.calls).toBe(2);
    expect(buildScrub(h5, ground, "soft", sink)).toBeNull();
    expect(buildScrub(h3, terrainOf(h3), "high", sink)).toBeNull();
    // hole 1 has both too: fescue on the flanks of its face and a waste scrape in the right rough
    expect(buildScrub(h1, terrainOf(h1), "high", sink)!.calls).toBe(2);
    sink.forEach((d) => d.dispose());
  });
  it("stays inside its budget: under 24k triangles on the best tier (hole 5 draws about 15k), fewer on the phone's", () => {
    const sink: { dispose: () => void }[] = [];
    const high = buildScrub(h5, terrainOf(h5), "high", sink)!, low = buildScrub(h5, terrainOf(h5), "low", sink)!;
    expect(high.tris).toBeLessThan(24000);
    expect(low.tris).toBeLessThan(high.tris * 0.7);
    sink.forEach((d) => d.dispose());
  });
});
