import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { YD } from "@/components/offhours/golf/scene";
import { sceneryFor } from "@/components/golf3d/scenery/scenes";
import { HOLE6 } from "@/components/golf3d/scenery/hole6";
import { bakeShore, glitterFactor } from "@/components/golf3d/scenery/ocean";
import { clearanceOf, seaReveal, validateScenery } from "@/components/golf3d/scenery/validate";
import { prepareScenery } from "@/components/golf3d/scenery";
import type { CoastSpec } from "@/components/golf3d/scenery/types";

// Hole 6, Last Light: golden hour over the estuary. Also the ocean's phase 2 changes it relies on (sand bars, glitter
// that follows the sun's height).

const hole = () => buildHole(NINE_DEFS.find((d) => d.n === 6)!);

describe("hole 6, Last Light", () => {
  it("is registered, valid against its hole, and the estuary is joined to the arm of the tide that crosses the line", () => {
    const rec = sceneryFor(6);
    expect(rec).toBe(HOLE6);
    const h = hole();
    expect(validateScenery(h, rec!)).toEqual([]);
    // wave 2: the arm is the hole's own water (a Lake) and opens into the estuary: the coast lies on its left end, not 70 m off,
    // and the sea stands at the level of the water in the flats (the lake's surface is a lip under its level)
    const arm = h.def.water[0] as { level: number };
    expect(rec.coast!.keepOut).toBe(0);
    expect(clearanceOf(h, rec.coast!.line)).toBeLessThan(25);
    expect(Math.abs(rec.coast!.seaY - (arm.level - 0.22))).toBeLessThan(0.5);
    expect(Math.abs(terrainOf(h).waterY(-60 * YD, 215 * YD) - rec.coast!.seaY)).toBeLessThan(0.5);
  });

  it("has the golden-hour skin, a low sun ahead and to the left, a shallow basin and a lighthouse", () => {
    const rec = sceneryFor(6);
    expect(rec.skin!.skyLow).toBe("#f0c98a");
    expect(rec.skin!.haze).toBe("#e8d4b0");
    const [x, y, z] = rec.skin!.skySun!;
    expect(x).toBeLessThan(0);
    expect(z).toBeGreaterThan(0);
    expect(y / Math.hypot(x, y, z)).toBeLessThan(0.2);
    expect(rec.coast!.sea).toBe("left");
    expect(rec.coast!.deep).toBeLessThanOrEqual(8);
    expect(rec.coast!.sandBars).toBeGreaterThan(0);
    expect(rec.coast!.glitter).toBeGreaterThan(0);
    expect(rec.props?.lighthouse).toBeDefined();
    expect(rec.openings!.some((o) => o.kind === "side" && o.side === "left")).toBe(true);
  });

  it("the estuary shows from the tee over the drawn ground to the left", () => {
    const h = hole();
    const ground = terrainOf(h).y;
    const bearings: number[] = [];
    for (let b = -85; b <= -20; b += 2.5) bearings.push(b);
    const seen = seaReveal(h, sceneryFor(6), ground, [0, ground(0, 0) + 3, 0], bearings);
    expect(seen.filter(Boolean).length / bearings.length).toBeGreaterThanOrEqual(0.2);
  });

  it("stays inside the budget of every tier (calls, triangles)", () => {
    const h = hole();
    const ground = terrainOf(h).y;
    const caps = { high: [8, 9000], low: [5, 4500], soft: [3, 800] } as const;
    for (const tier of ["high", "low", "soft"] as const) {
      const p = prepareScenery(h, ground, tier, { sun: new THREE.Vector3(0.4, 0.09, 0.9) });
      p.build();
      expect(p.stats.calls, tier).toBeLessThanOrEqual(caps[tier][0]);
      expect(p.stats.tris, tier).toBeLessThanOrEqual(caps[tier][1]);
    }
  });
});

describe("sand bars", () => {
  const L: CoastSpec = { line: [[0, -400], [0, 400]], sea: "left", seaY: 0, deep: 8, keepOut: 0, tones: { shallow: "#fff", mid: "#fff", deep: "#fff", foam: "#fff" } };
  const region = { x0: -400, z0: -400, w: 800, l: 800 };
  const size = 64;
  const B = (c: CoastSpec) => {
    const d = bakeShore(c, region, size);
    return { d, at: (i: number, j: number) => d[(j * size + i) * 4 + 2] };
  };
  it("the blue channel varies on the sea side only", () => {
    const { d, at } = B({ ...L, sandBars: 0.8 });
    const sea = new Set<number>(), land = new Set<number>();
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        // the sea is on the left (-x) of a line running +z
        (i < size / 2 - 1 ? sea : i > size / 2 + 1 ? land : new Set()).add(at(i, j));
        if (i > size / 2) expect(d[(j * size + i) * 4]).toBe(0);
      }
    expect(sea.size).toBeGreaterThan(20);
    expect(land.size).toBe(1);
  });
  it("without sandBars the channel is one flat value, as before", () => {
    const { at } = B(L);
    const seen = new Set<number>();
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) seen.add(at(i, j));
    expect(Array.from(seen)).toEqual([128]);
  });
  it("the red channel (distance to the shore) does not depend on the bars", () => {
    const a = B(L).d, b = B({ ...L, sandBars: 1 }).d;
    for (let q = 0; q < size * size; q++) expect(a[q * 4]).toBe(b[q * 4]);
  });
});

describe("glitter follows the sun's height", () => {
  it("full at the horizon, none overhead, falling in between", () => {
    expect(glitterFactor(0)).toBe(1);
    expect(glitterFactor(0.05)).toBe(1);
    expect(glitterFactor(0.35)).toBe(0);
    expect(glitterFactor(0.9)).toBe(0);
    let last = 1;
    for (let y = 0.05; y <= 0.35; y += 0.01) {
      const g = glitterFactor(y);
      expect(g).toBeLessThanOrEqual(last + 1e-12);
      last = g;
    }
    expect(glitterFactor(0.2)).toBeCloseTo(0.5, 6);
  });
  it("holes 6 and 9 sit low enough to glitter", () => {
    for (const n of [6, 9]) {
      const [x, y, z] = sceneryFor(n).skin!.skySun!;
      expect(glitterFactor(y / Math.hypot(x, y, z))).toBeGreaterThan(0.8);
    }
  });
});
