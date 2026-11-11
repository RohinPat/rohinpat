import { describe, expect, it } from "vitest";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { makeHeight } from "@/components/golf3d/scenery/height";
import { fallLift } from "@/components/golf3d/scenery/fall";
import { sceneryFor } from "@/components/golf3d/scenery/scenes";
import { seaReveal, validateScenery } from "@/components/golf3d/scenery/validate";
import { ringGeometry, ringCentre } from "@/components/golf3d/scenery/rings";
import { prepareScenery } from "@/components/golf3d/scenery";
import type * as THREE from "three";

const hole = buildHole(NINE_DEFS.find((d) => d.n === 7)!);
const ground = terrainOf(hole).y;
const rec = sceneryFor(7);

describe("hole 7, The Ridge", () => {
  it("has a record that validates", () => {
    expect(rec.id).toBe("ridge");
    expect(rec.hills?.fall).toBeDefined();
    expect(validateScenery(hole, rec)).toEqual([]);
  });

  it("the fall is zero inside the gate and for m up to its start, strictly", () => {
    const { beyond, heightAt, lift } = makeHeight(hole, ground, rec);
    const H = rec.hills!;
    let inside = 0;
    for (let x = -300; x <= 300; x += 7) {
      for (let z = -150; z <= 700; z += 7) {
        const m = beyond(x, z);
        if (m <= H.fall!.from) expect(fallLift(hole, H, x, z, m)).toBe(0);
        if (m < 30) {
          inside++;
          expect(heightAt(x, z)).toBe(ground(x, z));
          expect(lift(x, z)).toBe(0);
        }
      }
    }
    expect(inside).toBeGreaterThan(300);
  });

  it("the land falls ahead of the green and holds on the flanks, finite and deterministic", () => {
    const H = rec.hills!;
    const end = hole.line[hole.line.length - 1];
    const ahead = fallLift(hole, H, end[0], end[1] + 15 + 300, 300);
    const side = fallLift(hole, H, end[0] - 300, end[1], 300);
    expect(ahead).toBeLessThan(-H.fall!.drop * 0.9);
    expect(Math.abs(side)).toBeLessThan(1e-9);
    expect(fallLift(hole, H, end[0] + 20, end[1] + 200, 150)).toBe(fallLift(hole, H, end[0] + 20, end[1] + 200, 150));
    expect(fallLift(hole, { ...H, fall: undefined }, 0, 500, 150)).toBe(0);
  });

  it("the open sea shows from the crest and from the green looking ahead and to the right", () => {
    // the tee looks uphill at the ridge, which hides the sea: the reveal is from the crest on
    const eyeC: [number, number, number] = [0, ground(0, 235) + 3, 235];
    const bearings: number[] = [];
    for (let b = -15; b <= 60; b += 2.5) bearings.push(b);
    const seenC = seaReveal(hole, rec, ground, eyeC, bearings);
    expect(seenC.filter(Boolean).length / bearings.length).toBeGreaterThanOrEqual(0.3);
    const end = hole.line[hole.line.length - 1];
    const eyeG: [number, number, number] = [end[0], ground(end[0], end[1]) + 3, end[1]];
    const ahead = seaReveal(hole, rec, ground, eyeG, [-20, -10, 0, 10, 20, 40]);
    expect(ahead.filter(Boolean).length).toBeGreaterThanOrEqual(5);
  });

  it("the rings fit the budget on every tier", () => {
    const c = ringCentre(hole);
    expect(ringGeometry(rec, c, "high").tris).toBeLessThanOrEqual(4 * 640);
    expect(ringGeometry(rec, c, "low").tris).toBeLessThanOrEqual(3 * 448);
    expect(ringGeometry(rec, c, "soft").tris).toBe(384);
  });

  it("the built backdrop stays inside the plan's added budget on every tier", () => {
    const cap = { high: [8, 9000], low: [5, 4500], soft: [3, 800] } as const;
    for (const tier of ["high", "low", "soft"] as const) {
      const { group, dispose } = prepareScenery(hole, ground, tier).build();
      let calls = 0, tris = 0;
      group.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        calls++;
        const g = m.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(cap[tier][0]);
      expect(tris).toBeLessThanOrEqual(cap[tier][1]);
      dispose();
    }
  });
});
