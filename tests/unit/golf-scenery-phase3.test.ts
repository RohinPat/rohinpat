import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NINE_DEFS, RANGE_DEF, buildHole, ringSd } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { nearest } from "@/components/golf3d/scenery/geo";
import { makeHeight } from "@/components/golf3d/scenery/height";
import { makeTint } from "@/components/golf3d/scenery/tint";
import { makeTreeKeep } from "@/components/golf3d/scenery/openings";
import { ringCentre, ringGeometry, ringHeight } from "@/components/golf3d/scenery/rings";
import { sceneryFor } from "@/components/golf3d/scenery/scenes";
import { validateScenery } from "@/components/golf3d/scenery/validate";
import { wallSpine, wallStations } from "@/components/golf3d/scenery/wall";
import { MIST_SEGS, blobTexture, buildMist, mistAlpha, mistAngle, mistGeometry, mistTexture } from "@/components/golf3d/scenery/mist";
import { buildWaterfall, fallClock, waterfallData } from "@/components/golf3d/scenery/waterfall";
import { prepareScenery } from "@/components/golf3d/scenery";
import type { Tier } from "@/components/golf3d/scenery/types";

// Phase 3: the alpine tarn (hole 2, with its waterfall), the meadow valley and its morning mist (hole 4), the range.

const hole2 = buildHole(NINE_DEFS.find((d) => d.n === 2)!);
const hole4 = buildHole(NINE_DEFS.find((d) => d.n === 4)!);
const range = buildHole(RANGE_DEF);
const g2 = terrainOf(hole2).y, g4 = terrainOf(hole4).y, gR = terrainOf(range).y;
const rec2 = sceneryFor(2), rec4 = sceneryFor(4), recR = sceneryFor(10);
const tiers: Tier[] = ["high", "low", "soft"];
/** plan 3.12, cumulative, high / low / soft: draw calls and triangles */
const BUDGET: Record<Tier, [number, number]> = { high: [8, 9000], low: [5, 4500], soft: [3, 800] };

describe("phase 3 records", () => {
  it("are registered and valid against their holes", () => {
    expect([rec2.id, rec4.id, recR.id]).toEqual(["short-straw", "reed-creek", "range"]);
    expect(validateScenery(hole2, rec2)).toEqual([]);
    expect(validateScenery(hole4, rec4)).toEqual([]);
    expect(validateScenery(range, recR)).toEqual([]);
  });

  it("every ring layer rises above the tree line from the ground, and each record keeps one for the cheapest tier", () => {
    for (const rec of [rec2, rec4, recR]) {
      expect(rec.rings!.filter((l) => l.soft).length).toBe(1);
      for (const l of rec.rings!) {
        let top = -Infinity;
        for (let i = 0; i < 720; i++) top = Math.max(top, ringHeight(l, (i / 720) * Math.PI * 2 - Math.PI));
        expect(top, `${rec.id} ${l.radius}`).toBeGreaterThanOrEqual(0.095 * l.radius);
      }
    }
  });

  it("the range is a calm skyline: the layers roll gently all the way round, with no peaks", () => {
    for (const l of recR.rings!) {
      const hs: number[] = [];
      for (let i = 0; i < 720; i++) hs.push(ringHeight(l, (i / 720) * Math.PI * 2 - Math.PI));
      expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(110);
      expect(l.sectors.every((s) => s.shape === "rolling")).toBe(true);
    }
    expect(recR.walls).toBeUndefined();
    expect(recR.coast).toBeUndefined();
  });

  it("hole 2 has the granite wall ahead, the peak in line with the green, and gold patches in the palette", () => {
    expect(rec2.walls![0].follow).toBe("beyond");
    const peak = rec2.rings!.flatMap((l) => l.sectors).find((s) => s.shape === "cone")!;
    expect((peak.from + peak.to) / 2).toBe(0);
    expect(peak.snow).toBeGreaterThan(0);
    expect(rec2.palette!.patches!.share).toBeGreaterThan(0);
  });

  it("hole 4 follows the map: dunes, mesas and the canyon mouth, mist, and the creek left alone", () => {
    expect(rec4.mist!.layers.length).toBeGreaterThanOrEqual(2);
    const l1 = rec4.rings![0].sectors;
    // facing west the dunes (south) are on the left, the canyon (north) on the right, the mesas behind the tee on the left
    expect(l1.find((s) => s.color === "#c3bb8c")!.to).toBeLessThan(0);
    expect(l1.find((s) => s.shape === "mesa" && s.from > 0)).toBeDefined();
    expect(l1.find((s) => s.shape === "mesa" && s.to < -90)).toBeDefined();
    // the drawn ground along the creek is the hole's own, so the water in play is untouched
    const { heightAt } = makeHeight(hole4, g4, rec4);
    for (let x = -50; x <= 50; x += 10) for (const z of [318, 327, 336]) expect(heightAt(x, z)).toBe(g4(x, z));
  });
});

describe("the waterfall", () => {
  const { heightAt } = makeHeight(hole2, g2, rec2);

  it("hangs on the wall, from its lip to a pool of its own, well away from the pond in play", () => {
    for (const tier of ["high", "low"] as const) {
      const d = waterfallData(hole2, rec2, heightAt, tier)!;
      expect(d).not.toBeNull();
      expect(d.positions.every(Number.isFinite)).toBe(true);
      // the strip's top is the wall's top at that station
      const wall = rec2.walls![0];
      const { st } = wallStations(wall, heightAt, tier, wallSpine(hole2, wall));
      const i = Math.round(rec2.waterfall!.at * (st.length - 1));
      let top = -Infinity;
      for (let k = 0; k < d.positions.length; k += 3) if (d.marks[k + 2] === 0) top = Math.max(top, d.positions[k + 1]);
      expect(top).toBeCloseTo(st[i].f + st[i].H, 3);
      expect(d.drop).toBeGreaterThan(30);
      // the fall pours into the tarn (wave 2): its pool is in the tarn's far corner, and the pool is no higher than a metre over it
      expect(ringSd(hole2.world.water[0], d.pool.x, d.pool.z)).toBeLessThan(0);
      expect(d.pool.y - terrainOf(hole2).waterY(d.pool.x, d.pool.z)).toBeLessThan(1);
      expect(nearest(wallSpine(hole2, wall), d.pool.x, d.pool.z).d).toBeLessThan(60);
    }
  });

  it("is deterministic, and stays inside its triangle budget", () => {
    const a = waterfallData(hole2, rec2, heightAt, "high")!, b = waterfallData(hole2, rec2, heightAt, "high")!;
    expect(a.positions).toEqual(b.positions);
    expect(a.tris).toBe(14 * 2 + 22 * 3);
    expect(waterfallData(hole2, rec2, heightAt, "low")!.tris).toBe(8 * 2 + 12 * 3);
    // no wall on the cheapest tier, so no fall
    expect(waterfallData(hole2, rec2, heightAt, "soft")).toBeNull();
    expect(waterfallData(hole4, rec4, makeHeight(hole4, g4, rec4).heightAt, "high")).toBeNull();
  });

  it("stands still under reduced motion and runs otherwise", () => {
    expect(fallClock(123456, true)).toBe(0);
    expect(fallClock(5000, false)).toBe(5);
    const own = (m: THREE.Object3D) => Object.prototype.hasOwnProperty.call(m, "onBeforeRender");
    const still = buildWaterfall(hole2, rec2, heightAt, "high", true)!;
    expect(still.group.children.some(own)).toBe(false);
    const moving = buildWaterfall(hole2, rec2, heightAt, "high", false)!;
    expect(moving.group.children.every(own)).toBe(true);
    // the middle tier is a still picture whatever the setting, and has no spray
    const low = buildWaterfall(hole2, rec2, heightAt, "low", false)!;
    expect(low.group.children.length).toBe(1);
    expect(own(low.group.children[0])).toBe(false);
    expect(moving.calls).toBe(2);
    [still, moving, low].forEach((f) => f.dispose());
  });

  it("the spray's texture falls from white in the middle to nothing at the rim", () => {
    const t = blobTexture();
    const px = (x: number, y: number) => (t.image.data as Uint8Array)[(y * 32 + x) * 4 + 3];
    expect(px(16, 16)).toBeGreaterThan(240);
    expect(px(0, 0)).toBe(0);
    t.dispose();
  });
});

describe("the mist", () => {
  it("is soft: the texture is a band of banks that wraps round the ring, thickest low and gone at the top", () => {
    for (const v of [0, 0.2, 0.5, 1]) for (const u of [0, 0.3, 0.77]) {
      const a = mistAlpha(u, v, 4);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect(mistAlpha(0, 0.3, 4)).toBeCloseTo(mistAlpha(1, 0.3, 4), 6);
    let low = 0, high = 0;
    for (let i = 0; i < 64; i++) {
      low += mistAlpha(i / 64, 0.08, 4);
      high += mistAlpha(i / 64, 0.98, 4);
    }
    expect(low).toBeGreaterThan(high + 10);
    expect(high).toBeLessThan(0.5);
    const tex = mistTexture(4);
    expect((tex.image.data as Uint8Array).length).toBe(64 * 32 * 4);
    tex.dispose();
  });

  it("is one cheap transparent mesh on the top tier only, inside the budget", () => {
    expect(MIST_SEGS).toEqual({ high: 48, low: 0, soft: 0 });
    const hi = mistGeometry(rec4.mist!, "high");
    expect(hi.tris).toBe(rec4.mist!.layers.length * 48 * 4);
    expect(hi.tris).toBeLessThanOrEqual(800);
    expect(hi.positions.every(Number.isFinite)).toBe(true);
    for (let k = 3; k < hi.colors.length; k += 4) expect(hi.colors[k]).toBeLessThanOrEqual(0.6);
    expect(mistGeometry(rec4.mist!, "low").tris).toBe(0);
    expect(mistGeometry(rec4.mist!, "soft").tris).toBe(0);
    const { heightAt } = makeHeight(hole4, g4, rec4);
    expect(buildMist(hole4, rec4.mist, heightAt, "low", false)).toBeNull();
    expect(buildMist(hole4, undefined, heightAt, "high", false)).toBeNull();
    const m = buildMist(hole4, rec4.mist, heightAt, "high", false)!;
    const mat = m.mesh.material as THREE.MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    m.dispose();
  });

  it("every ring starts in the mist's own place: it stands outside the trees, well past the end of the hole", () => {
    const [cx, cz] = ringCentre(hole4);
    const end = hole4.line[hole4.line.length - 1];
    const reach = Math.max(Math.hypot(end[0] - cx, end[1] - cz), Math.hypot(cx, cz));
    for (const l of rec4.mist!.layers) {
      expect(l.radius).toBeGreaterThan(reach + 250);
      // above the tree line (about 7 degrees) from the ground
      expect(l.top / l.radius).toBeGreaterThan(0.12);
    }
  });

  it("drifts slowly, and not at all under reduced motion", () => {
    expect(mistAngle(1e6, true)).toBe(0);
    expect(mistAngle(0, false)).toBe(0);
    expect(mistAngle(100000, false)).toBeGreaterThan(0);
    expect(mistAngle(100000, false)).toBeLessThan(1);
    const { heightAt } = makeHeight(hole4, g4, rec4);
    const own = (m: THREE.Object3D) => Object.prototype.hasOwnProperty.call(m, "onBeforeRender");
    const still = buildMist(hole4, rec4.mist, heightAt, "high", true)!;
    expect(own(still.mesh)).toBe(false);
    expect(still.mesh.rotation.y).toBe(0);
    const moving = buildMist(hole4, rec4.mist, heightAt, "high", false)!;
    expect(own(moving.mesh)).toBe(true);
    still.dispose();
    moving.dispose();
  });
});

describe("the palette's patches", () => {
  it("colour blotches of the ground beyond the gate, the same each time, and leave the gate alone", () => {
    const { beyond } = makeHeight(hole2, g2, rec2);
    const tint = makeTint(rec2, beyond);
    const plain = makeTint({ ...rec2, palette: { ...rec2.palette!, patches: undefined } }, beyond);
    const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0];
    let differ = 0, same = 0;
    for (let i = 0; i < 400; i++) {
      const x = -900 + (i % 20) * 90, z = -300 + Math.floor(i / 20) * 90;
      if (beyond(x, z) < 120) continue;
      tint(x, z, 6, 0, "#24502d", a);
      plain(x, z, 6, 0, "#24502d", b);
      if (a.some((v, k) => Math.abs(v - b[k]) > 1e-6)) differ++;
      else same++;
      const c: [number, number, number] = [0, 0, 0];
      tint(x, z, 6, 0, "#24502d", c);
      expect(c).toEqual(a);
    }
    expect(differ).toBeGreaterThan(10);
    expect(same).toBeGreaterThan(10);
    tint(0, 60, 0, 0, "#24502d", a);
    expect(a).toEqual([1, 1, 1]);
  });
});

describe("the budget of every tier", () => {
  for (const [name, hole, ground] of [["hole 2", hole2, g2], ["hole 4", hole4, g4], ["the range", range, gR]] as const) {
    it(`${name}: calls and triangles stay inside plan 3.12`, () => {
      for (const tier of tiers) {
        const p = prepareScenery(hole, ground, tier);
        const b = p.build();
        expect(p.stats.calls, `${name} ${tier} calls`).toBeLessThanOrEqual(BUDGET[tier][0]);
        expect(p.stats.tris, `${name} ${tier} tris`).toBeLessThanOrEqual(BUDGET[tier][1]);
        b.dispose();
      }
    });
  }

  it("the rings are one cheap layer on the cheapest tier everywhere", () => {
    for (const [hole, rec] of [[hole2, rec2], [hole4, rec4], [range, recR]] as const) {
      expect(ringGeometry(rec, ringCentre(hole), "soft").tris).toBe(384);
      expect(ringGeometry(rec, ringCentre(hole), "high").tris).toBeLessThanOrEqual(4 * 640);
    }
  });
});

describe("the backdrop never reaches play", () => {
  it("heights, tints and the trees that stop a ball are the hole's own inside the gate, on every phase 3 hole", () => {
    for (const [hole, rec, ground] of [[hole2, rec2, g2], [hole4, rec4, g4], [range, recR, gR]] as const) {
      const { heightAt, beyond } = makeHeight(hole, ground, rec);
      const tint = makeTint(rec, beyond);
      const keep = makeTreeKeep(hole, rec, beyond);
      const out: [number, number, number] = [0, 0, 0];
      const b = hole.shape.box;
      let near = 0;
      for (let i = 0; i <= 60; i++)
        for (let j = 0; j <= 90; j++) {
          const x = b.x0 - 100 + ((b.x1 - b.x0 + 200) * i) / 60, z = b.z0 - 100 + ((b.z1 - b.z0 + 200) * j) / 90;
          if (beyond(x, z) >= 30) continue;
          near++;
          expect(heightAt(x, z)).toBe(ground(x, z));
          tint(x, z, ground(x, z), ground(x, z), "#24502d", out);
          expect(out).toEqual([1, 1, 1]);
        }
      expect(near).toBeGreaterThan(200);
      if (keep) for (const bl of hole.blockers) expect(keep(bl.x, bl.z, bl.h)).toBe(true);
    }
  });

  it("the walls stay 60 m or more from the rough and the pond", () => {
    expect(validateScenery(hole2, rec2).filter((m) => /wall/.test(m))).toEqual([]);
  });
});
