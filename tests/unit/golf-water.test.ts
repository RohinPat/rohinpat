import { describe, expect, it } from "vitest";
import { BACK_DEFS, HOLE_DEFS, buildHole, creekSd, polyOf, ringSd, type Creek, type Lake } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import { onDeck } from "@/components/offhours/golf/solids";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { riffles, waterStakes } from "@/components/golf3d/water3d";
import { OLD_H2 } from "./golf-old-h2";

// Water in play: a creek dug into the ground, ponds with natural shores, lakes drawn from a polygon. The hit test, the
// drawn outline and the dig all share one shape.

const LAKE: Lake = { shore: [[50, 370], [62, 364], [76, 372], [82, 392], [80, 415], [88, 430], [78, 440], [62, 436], [52, 420], [46, 396]] };

describe("a creek", () => {
  const b = buildHole(HOLE_DEFS[3]);
  const creek = HOLE_DEFS[3].water[0] as Creek;
  const poly = polyOf(creek);
  const t = terrainOf(b);
  it("is a smooth meander whose width changes along it", () => {
    const hw = poly.map((p) => p.hw);
    expect(Math.max(...hw) - Math.min(...hw)).toBeGreaterThan(1.5 * YD);
    // no kinks: the heading between neighbouring samples turns gently
    for (let i = 2; i < poly.length; i++) {
      const a = Math.atan2(poly[i - 1].z - poly[i - 2].z, poly[i - 1].x - poly[i - 2].x), c = Math.atan2(poly[i].z - poly[i - 1].z, poly[i].x - poly[i - 1].x);
      expect(Math.abs(Math.atan2(Math.sin(c - a), Math.cos(c - a)))).toBeLessThan(0.35);
    }
  });
  it("the hit test, the outline and the distance field agree", () => {
    // (the bridge's deck is dry, so the creek under it is skipped)
    for (const p of poly.filter((q, i) => i % 9 === 0 && !onDeck(HOLE_DEFS[3].props, q.x, q.z))) {
      expect(b.surfaceAt(p.x, p.z)).toBe("water");
      expect(creekSd(poly, p.x, p.z)).toBeLessThan(0);
    }
    for (const [x, z] of b.world.water[0].filter((_, i) => i % 7 === 0)) expect(Math.abs(creekSd(poly, x, z))).toBeLessThan(0.6);
  });
  it("is dug in: the water lies under the grass beside it, and the bed is deeper than the bank", () => {
    const mid = poly[Math.floor(poly.length / 2)];
    const nx = -(poly[poly.length / 2 + 1 | 0].z - mid.z), nz = poly[poly.length / 2 + 1 | 0].x - mid.x;
    const l = Math.hypot(nx, nz);
    const side = (d: number) => [mid.x + (nx / l) * (mid.hw + d), mid.z + (nz / l) * (mid.hw + d)] as const;
    const wy = t.waterY(mid.x, mid.z);
    expect(wy - t.y(mid.x, mid.z)).toBeGreaterThan(0.25);
    const [fx, fz] = side(5);
    expect(t.y(fx, fz) - wy).toBeGreaterThan(0.4);
    // the waterline at the edge is where the bank meets the water
    const [ex, ez] = side(0);
    expect(Math.abs(t.y(ex, ez) - t.waterY(ex, ez))).toBeLessThan(0.35);
  });
  it("has riffles where it narrows", () => {
    const r = riffles(poly);
    expect(r.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Math.max(...r)).toBeGreaterThan(0.5);
    expect(Math.min(...r)).toBe(0);
  });
});

describe("a pond with a natural shore", () => {
  const d = OLD_H2, pond = d.water[0] as { x: number; z: number; lobe?: number };
  const b = buildHole(d);
  const t = terrainOf(b);
  it("is lobed, and its drawn shore is where the ball is lost", () => {
    expect(pond.lobe).toBeGreaterThan(0);
    const ring = b.world.water[0];
    expect(ring.length).toBeGreaterThan(30);
    const cx = pond.x * YD, cz = pond.z * YD;
    for (const [x, z] of ring) {
      expect(b.surfaceAt(cx + (x - cx) * 0.96, cz + (z - cz) * 0.96)).toBe("water");
      expect(b.surfaceAt(cx + (x - cx) * 1.05, cz + (z - cz) * 1.05)).not.toBe("water");
    }
  });
  it("is dug into a hollow with a lip: the water is under the ground at the shore and over the bed inside", () => {
    const [sx, sz] = b.world.water[0][0];
    expect(t.waterY(pond.x * YD, pond.z * YD) - t.y(pond.x * YD, pond.z * YD)).toBeGreaterThan(0.5);
    expect(Math.abs(t.y(sx, sz) - t.waterY(sx, sz))).toBeLessThan(0.3);
  });
});

describe("a lake from a polygon", () => {
  const d = { ...BACK_DEFS.find((x) => x.n === 8)!, water: [LAKE] };
  const b = buildHole(d);
  const t = terrainOf(b);
  it("is water inside the shore and dry outside, with the drawn outline on the shore", () => {
    expect(b.surfaceAt(64 * YD, 400 * YD)).toBe("water");
    expect(b.surfaceAt(30 * YD, 400 * YD)).not.toBe("water");
    expect(b.world.water).toHaveLength(1);
    for (const [x, z] of b.world.water[0]) expect(Math.abs(ringSd(b.world.water[0], x, z))).toBeLessThan(1e-6);
  });
  it("is dug: the bed is under the surface in the middle, and the surface is under the ground at the shore", () => {
    const x = 64 * YD, z = 400 * YD;
    expect(t.waterY(x, z) - t.y(x, z)).toBeGreaterThan(0.6);
    const [sx, sz] = b.world.water[0][5];
    expect(Math.abs(t.y(sx, sz) - t.waterY(sx, sz))).toBeLessThan(0.35);
  });
});

describe("hazard stakes", () => {
  it("stand on dry ground beside each hole's water, and none where there is none", () => {
    for (const d of [...HOLE_DEFS, ...BACK_DEFS]) {
      const b = buildHole(d);
      const s = waterStakes(b);
      if (!d.water.length) expect(s).toHaveLength(0);
      for (const p of s) expect(b.surfaceAt(p.x, p.z)).not.toBe("water");
    }
    expect(waterStakes(buildHole(HOLE_DEFS[3])).length).toBeGreaterThanOrEqual(6);
  });
});
