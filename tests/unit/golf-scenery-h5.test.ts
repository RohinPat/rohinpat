import { describe, expect, it } from "vitest";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { prepareScenery } from "@/components/golf3d/scenery";
import { makeHeight } from "@/components/golf3d/scenery/height";
import { ridgedLift, ridgedWindow } from "@/components/golf3d/scenery/ridged";
import { ringCentre, ringGeometry, ringHeight } from "@/components/golf3d/scenery/rings";
import { sceneryFor } from "@/components/golf3d/scenery/scenes";
import { makeTreeKeep } from "@/components/golf3d/scenery/openings";
import { validateScenery } from "@/components/golf3d/scenery/validate";

// Hole 5, The Collar: dune ridges with a gap toward the sea, and the head of Long Water as a band of sea in the rings.

const hole = buildHole(NINE_DEFS.find((d) => d.n === 5)!);
const ground = terrainOf(hole).y;
const rec = sceneryFor(5);
const DEG = Math.PI / 180;
const H = rec.hills!;
const SEA_BEARING = H.ridged!.window!.bearing;
const centre = ringCentre(hole);

describe("hole 5's scene", () => {
  it("is a real record, valid against its hole", () => {
    expect(rec.id).toBe("collar");
    expect(validateScenery(hole, rec)).toEqual([]);
  });

  it("the ridges are exactly zero inside the 30 m gate, strictly, and the ground there is the hole's own", () => {
    const { heightAt, beyond } = makeHeight(hole, ground, rec);
    const b = hole.shape.box;
    let near = 0;
    for (let i = 0; i <= 60; i++)
      for (let j = 0; j <= 90; j++) {
        const x = b.x0 - 120 + ((b.x1 - b.x0 + 240) * i) / 60, z = b.z0 - 120 + ((b.z1 - b.z0 + 240) * j) / 90;
        const m = beyond(x, z);
        if (m < 30) {
          near++;
          expect(heightAt(x, z)).toBe(ground(x, z));
        }
      }
    expect(near).toBeGreaterThan(500);
    // the ridges take over past the gate, easing in over the next 30 m
    let past = 0;
    for (let a = -180; a < 180; a += 4) {
      const x = Math.sin(a * DEG) * 400, z = 88 + Math.cos(a * DEG) * 400;
      if (beyond(x, z) > 60) past += ridgedLift(hole, H, x, z, beyond(x, z)) > 0 ? 1 : 0;
    }
    expect(past).toBeGreaterThan(50);
    expect(ridgedLift(hole, H, 300, 300, 0)).toBe(0);
    expect(ridgedLift(hole, { ...H, ridged: undefined }, 300, 300, 100)).toBe(0);
  });

  it("is deterministic, finite and no higher than its amplitude", () => {
    let max = 0;
    for (let x = -600; x <= 600; x += 23)
      for (let z = -300; z <= 900; z += 23) {
        const a = ridgedLift(hole, H, x, z, 100), b = ridgedLift(hole, H, x, z, 100);
        expect(a).toBe(b);
        expect(Number.isFinite(a)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(0);
        max = Math.max(max, a);
      }
    expect(max).toBeLessThanOrEqual(H.ridged!.amp);
    expect(max).toBeGreaterThan(H.ridged!.amp * 0.5);
  });

  it("the window really lowers the ridges toward the sea", () => {
    const w = H.ridged!.window!;
    const mean = (lo: number, hi: number) => {
      let s = 0, n = 0;
      for (let a = lo; a <= hi; a += 1)
        for (let d = 150; d <= 700; d += 25) {
          const x = centre[0] + Math.sin(a * DEG) * d, z = centre[1] + Math.cos(a * DEG) * d;
          s += ridgedLift(hole, H, x, z, 100);
          n++;
        }
      return s / n;
    };
    const inside = mean(w.bearing - w.half * 0.6, w.bearing + w.half * 0.6);
    const outside = mean(w.bearing + w.half + 20, w.bearing + w.half + 120);
    expect(inside).toBeLessThan(outside * 0.5);
    // the factor itself: k in the middle, 1 beyond the edge
    const at = (a: number) => ridgedWindow(hole, H, centre[0] + Math.sin(a * DEG) * 300, centre[1] + Math.cos(a * DEG) * 300);
    expect(at(w.bearing)).toBeCloseTo(w.k, 6);
    expect(at(w.bearing + w.half + 5)).toBeCloseTo(1, 6);
  });

  it("past the green the sea band shows over the drawn dunes from the tee, from the tee deck and from over the trees", () => {
    const { heightAt } = makeHeight(hole, ground, rec);
    const soft = rec.rings!.find((l) => l.soft)!;
    const seaDeg = (SEA_BEARING | 0);
    expect(rec.rings!.filter((l) => l.soft)).toHaveLength(1);
    const g0 = ground(0, 0);
    // the nearest the horizon of the drawn ground comes, as an angle above an eye, along a bearing from the tee
    const horizon = (eyeY: number, deg: number) => {
      let top = -Infinity;
      for (let d = 20; d <= 2500; d += d < 400 ? 5 : 25) {
        const a = deg * DEG;
        top = Math.max(top, (heightAt(Math.sin(a) * d, Math.cos(a) * d) - eyeY) / d);
      }
      return top;
    };
    // the band's crest as an angle from the same eye
    const band = (eyeY: number, deg: number) => (ringHeight(soft, deg * DEG) - eyeY) / soft.radius;
    for (const eyeY of [g0 + 3, g0 + 12, g0 + 40]) for (const deg of [seaDeg - 4, seaDeg, seaDeg + 4]) expect(band(eyeY, deg)).toBeGreaterThan(horizon(eyeY, deg));
  });

  it("the sea band is a gap in the land of the kept layer, and lower than the land beside it", () => {
    const soft = rec.rings!.find((l) => l.soft)!;
    const sea = ringHeight(soft, SEA_BEARING * DEG);
    for (const d of [-60, -35, 40, 90, 180]) expect(ringHeight(soft, d * DEG)).toBeGreaterThan(sea + 5);
  });

  it("opens the trees behind the green, never the copse", () => {
    const { beyond } = makeHeight(hole, ground, rec);
    const keep = makeTreeKeep(hole, rec, beyond)!;
    expect(keep).toBeDefined();
    for (const b of hole.blockers) expect(keep(b.x, b.z, b.h)).toBe(true);
    const dropped = hole.world.trees.filter((t) => !keep(t.x, t.z, t.h));
    expect(dropped.length).toBeGreaterThan(8);
    for (const t of dropped) {
      expect(beyond(t.x, t.z)).toBeGreaterThanOrEqual(5);
      expect(t.z).toBeGreaterThan(170);
    }
  });

  it("stays inside the budget of every tier", () => {
    for (const [tier, calls, tris] of [["high", 1, 2560], ["low", 1, 1344], ["soft", 1, 384]] as const) {
      const p = prepareScenery(hole, ground, tier);
      const built = p.build();
      expect(p.stats.calls).toBeLessThanOrEqual(calls);
      expect(p.stats.tris).toBeLessThanOrEqual(tris);
      built.dispose();
    }
    const g = ringGeometry(rec, centre, "soft");
    expect(g.tris).toBe(384);
    expect(g.positions.every(Number.isFinite)).toBe(true);
  });
});
