import { describe, expect, it } from "vitest";
import { YD } from "@/components/offhours/golf/scene";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { signedDist } from "@/components/golf3d/scenery/geo";
import { makeHeight } from "@/components/golf3d/scenery/height";
import { makeTreeKeep } from "@/components/golf3d/scenery/openings";
import { ringCentre, ringGeometry } from "@/components/golf3d/scenery/rings";
import { seaReveal, validateScenery, clearanceOf } from "@/components/golf3d/scenery/validate";
import { sceneryFor } from "@/components/golf3d/scenery/scenes";
import { prepareScenery } from "@/components/golf3d/scenery";

// Hole 8, Long Water: a sea loch on the right, past the in-play lake, seen from the fairway; the ridge and the sea on the left.

const hole = buildHole(NINE_DEFS.find((d) => d.n === 8)!);
const rec = sceneryFor(8);
const ground = terrainOf(hole).y;

describe("hole 8: Long Water", () => {
  it("has a record that is valid against its hole, sea on the right, with the lake on its bluff beside it", () => {
    expect(rec.id).toBe("long-water");
    expect(validateScenery(hole, rec)).toEqual([]);
    expect(rec.coast!.sea).toBe("right");
    // the lake lies right beside the bay, on the plateau above it: a strip of land 8 m or more between, never water into water
    const gap = clearanceOf(hole, rec.coast!.line);
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(30);
    for (const w of hole.world.water) for (const [x, z] of w) expect(signedDist(rec.coast!, x, z)).toBeLessThan(-7);
    // beach tones from the plan
    expect(rec.coast!.tones).toMatchObject({ shallow: "#9fd6cf", mid: "#5aa7b5", deep: "#2f6f8f" });
  });

  it("the sea is on the right of the fairway, the ridge side on the left is land", () => {
    for (const z of [100, 250, 400]) {
      expect(signedDist(rec.coast!, 200, z)).toBeGreaterThan(0);
      expect(signedDist(rec.coast!, -200, z)).toBeLessThan(0);
    }
  });

  it("the bay shows from the fairway, to the right, over the drawn ground", () => {
    const bearings: number[] = [];
    for (let b = 55; b <= 125; b += 2.5) bearings.push(b);
    for (const z of [260, 380, 460]) {
      const seen = seaReveal(hole, rec, ground, [0, ground(0, z) + 3, z], bearings);
      expect(seen.filter(Boolean).length / bearings.length, `from z ${z}`).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("the hole's own clearing leaves no tree on the right from the tee on, and the backdrop never drops the copse", () => {
    const { beyond } = makeHeight(hole, ground, rec);
    const keep = makeTreeKeep(hole, rec, beyond)!;
    for (const b of hole.blockers) expect(keep(b.x, b.z, b.h)).toBe(true);
    // (trees.clear opens the whole right side to the bay; the backdrop's opening has nothing left to drop there)
    expect(hole.world.trees.filter((t) => t.x > 24 * YD && t.z > -60 * YD)).toHaveLength(0);
    for (const t of hole.world.trees.filter((u) => !keep(u.x, u.z, u.h))) expect(beyond(t.x, t.z)).toBeGreaterThanOrEqual(5);
    // and none in the lake (the base keeps trees out of water)
    for (const t of hole.world.trees) expect(hole.surfaceAt(t.x, t.z)).not.toBe("water");
  });

  it("declares a lighthouse on land, outside the gate and out of the sea", () => {
    const at = rec.props!.lighthouse!.at!;
    const { beyond } = makeHeight(hole, ground, rec);
    expect(beyond(at[0], at[1])).toBeGreaterThan(60);
    expect(signedDist(rec.coast!, at[0], at[1])).toBeLessThan(-100);
  });

  it("stays inside the budget of every tier", () => {
    const centre = ringCentre(hole);
    const tris = (t: "high" | "low" | "soft") => ringGeometry(rec, centre, t).tris;
    expect(tris("high")).toBeLessThanOrEqual(4 * 640);
    expect(tris("low")).toBeLessThanOrEqual(3 * 448);
    expect(tris("soft")).toBe(384);
    // plan 3.12, cumulative, high / low / soft: calls 8 / 5 / 3, triangles 9k / 4.5k / 0.8k (this hole: rings, sea, props)
    for (const [tier, calls, t] of [["high", 8, 9000], ["low", 5, 4500], ["soft", 3, 800]] as const) {
      const p = prepareScenery(hole, ground, tier);
      const b = p.build();
      expect(p.stats.calls, tier).toBeLessThanOrEqual(calls);
      expect(p.stats.tris, tier).toBeLessThanOrEqual(t);
      b.dispose();
    }
  });
});
