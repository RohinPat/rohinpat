import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NINE_DEFS, RANGE_DEF, TEE_BOX, buildHole, creekSd, lakeOf, polyOf, ringSd, type BuiltHole, type Creek, type Lake } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import { GH, GW } from "@/components/offhours/golf/green";
import { NOTCH_FADE, outsideGreen, teeMarkers, terrainOf } from "@/components/offhours/golf/terrain";
import { prepareScenery } from "@/components/golf3d/scenery";
import { waterStakes } from "@/components/golf3d/water3d";
import { stubScratchCanvas } from "./golf-headless";

// Invariants over every hole: the nine and the range. Each one was a bug fixed for one hole and then found again on another
// (the tee on a slope, the lake that floated over its bank, the stakes lost to a cove, a drop in the water, the green's step).
// They are written over the course's data, so a new hole is held to them without a test of its own.

const DEFS = [...NINE_DEFS, RANGE_DEF];
/** the bank the water's painting reaches past its waterline (hole3d.ts strokes the ring 4 m wide), m */
const BANK = 2;
/** a marker keeps this far from the water: the bank, and a golfer's stance beside the ball, m */
const MARKER_WATER = 3;
/** a tee's level, m: the slope under it, a rise per metre */
const LEVEL = 0.02;

const hole = (n: number) => buildHole(DEFS.find((d) => d.n === n)!);
const ringOf = (h: BuiltHole, wi: number) => h.world.water[wi] as [number, number][];
const lakeHoles = DEFS.filter((d) => d.water.some((w) => "shore" in w && !w.sea));

beforeAll(() => stubScratchCanvas());
afterAll(() => vi.unstubAllGlobals());

describe("the tee", () => {
  it.each(DEFS.map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): the pad is flat, under 2% within 3 m of the tee", ({ n }) => {
    const h = hole(n);
    const g = terrainOf(h);
    let worst = 0, at = "";
    for (let x = -3; x <= 3; x += 0.25)
      for (let z = -3; z <= 3; z += 0.25) {
        if (x * x + z * z > 9) continue;
        const s = Math.hypot(...g.slope(x, z));
        if (s > worst) (worst = s), (at = `${x},${z}`);
      }
    expect(worst, `slope ${(worst * 100).toFixed(2)}% at ${at}`).toBeLessThan(LEVEL);
  });

  it.each(DEFS.map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): both tee markers are on the tee pad and on level ground, clear of the water", ({ n }) => {
    const h = hole(n);
    const g = terrainOf(h);
    const line = h.def.line;
    const [lx, lz] = [line[Math.min(2, line.length - 1)][0] * YD, line[Math.min(2, line.length - 1)][1] * YD];
    const yaw = Math.atan2(lx, lz);
    const marks = teeMarkers(h);
    expect(marks).toHaveLength(2);
    for (const [mx, mz] of marks) {
      // across the line and along it, from the tee, in the box's own frame (hole3d.ts draws the box from these)
      const across = mx * Math.cos(yaw) - mz * Math.sin(yaw);
      const along = mx * Math.sin(yaw) + mz * Math.cos(yaw);
      expect(Math.abs(across), `across ${across.toFixed(2)} m`).toBeLessThanOrEqual(TEE_BOX.half);
      expect(along).toBeGreaterThanOrEqual(-TEE_BOX.back);
      expect(along).toBeLessThanOrEqual(TEE_BOX.front);
      for (let wi = 0; wi < h.def.water.length; wi++) {
        const w = h.def.water[wi];
        const sd = "path" in w ? creekSd(polyOf(w as Creek), mx, mz) : ringSd(ringOf(h, wi), mx, mz);
        expect(sd, `water ${wi} is ${sd.toFixed(2)} m off`).toBeGreaterThanOrEqual(MARKER_WATER);
      }
      expect(Math.hypot(...g.slope(mx, mz))).toBeLessThan(LEVEL);
    }
  });

  it.each(DEFS.map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): the markers keep the default spacing unless water or the pad needs them nearer", ({ n }) => {
    const h = hole(n);
    const line = h.def.line;
    const [lx, lz] = [line[Math.min(2, line.length - 1)][0] * YD, line[Math.min(2, line.length - 1)][1] * YD];
    const yaw = Math.atan2(lx, lz);
    // the default pair: 2.6 m either side of the line, 1.2 m ahead of the tee
    const at = (side: number) => [side * 2.6 * Math.cos(yaw) + 1.2 * Math.sin(yaw), -side * 2.6 * Math.sin(yaw) + 1.2 * Math.cos(yaw)] as [number, number];
    const water = h.def.water.some((w, wi) => [-1, 1].some((side) => {
      const [x, z] = at(side);
      return ("path" in w ? creekSd(polyOf(w as Creek), x, z) : ringSd(ringOf(h, wi), x, z)) < MARKER_WATER;
    }));
    const marks = teeMarkers(h);
    const gap = Math.hypot(marks[0][0] - marks[1][0], marks[0][1] - marks[1][1]);
    if (water) expect(gap).toBeLessThan(5.2);
    else expect(gap).toBeCloseTo(5.2, 6);
  });
});

describe("no lake is a slab", () => {
  it.each(lakeHoles.map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): the drawn ground beside each shore is not below the water", ({ n }) => {
    const h = hole(n);
    const g = terrainOf(h);
    const drawn = prepareScenery(h, g.y, "soft").heightAt;
    const f = h.def.falls;
    // a falls notch is where the bank steps down into the notch on purpose: the lift ramps in over NOTCH_FADE m from it
    const inNotch = (x: number, z: number) => {
      if (!f) return false;
      const ax = f.from[0] * YD, az = f.from[1] * YD, bx = f.to[0] * YD, bz = f.to[1] * YD;
      const dx = bx - ax, dz = bz - az;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - (ax + dx * u), z - (az + dz * u)) < (f.width * YD) / 2 + NOTCH_FADE;
    };
    let worst = 0, where = "", count = 0;
    h.def.water.forEach((w, wi) => {
      if (!("shore" in w) || w.sea) return;
      const ring = lakeOf(w as Lake);
      for (let i = 0; i < ring.length; i += 2) {
        const [x, z] = ring[i];
        const [x2, z2] = ring[(i + 1) % ring.length];
        const l = Math.hypot(x2 - x, z2 - z) || 1;
        let nx = -(z2 - z) / l, nz = (x2 - x) / l;
        if (ringSd(ring, x + nx * 0.5, z + nz * 0.5) < 0) (nx = -nx), (nz = -nz);
        const level = g.waterY(x, z);
        for (const d of [0.5, 1.5, 3]) {
          const px = x + nx * d, pz = z + nz * d;
          if (inNotch(px, pz)) continue;
          const short = drawn(px, pz) - level;
          if (short < 0) count++;
          if (short < worst) (worst = short), (where = `water ${wi} at (${px.toFixed(1)}, ${pz.toFixed(1)}) m, ${d} m out`);
        }
      }
    });
    expect(worst, `${count} shore points below the water; worst ${worst.toFixed(2)} m, ${where}`).toBeGreaterThanOrEqual(0);
  });
});

describe("the play ground is walkable", () => {
  // a ball rolls on the ground it lands on: no step steeper than 1 in 3 in the in-play area. Exempt, on purpose:
  // - a cliff's own face (features.ts cliff), and a bunker's surface (its sand, and a pot's sod face): dug or built, not a bank;
  // - a steep spot the hole's declared landforms make (mounds, ridges, bowls, hollows, shelves, faces, terraces): the test
  //   removes them, and the spot is exempt only if the ground without them is walkable (so a bank the landforms did not make is not);
  // - a green's rim the hole declares with its own greenEase (a punchbowl's rim, a false front): within that ease only.
  //   An undeclared ease is not an exemption: the green's bank is held to the same rule as any bank
  const IN_PLAY = ["fairway", "rough", "fescue", "waste", "green", "fringe"];
  for (const d of DEFS) {
    it(`hole ${d.n} (${d.name}): the slope of the ground in play is at most 1 in 3, off the exempt faces and landforms`, () => {
      const h = hole(d.n);
      const g = terrainOf(h);
      // the same hole without its declared landforms: the ground the steep spots are judged against
      const bare = buildHole({ ...d, features: undefined, ground: d.ground && { ...d.ground, mounds: undefined } });
      const gBare = terrainOf(bare);
      const ease = d.ground?.greenEase;
      const b = h.shape.box;
      let worst = 0, at = "";
      for (let x = b.x0; x <= b.x1; x += 1)
        for (let z = b.z0; z <= b.z1; z += 1) {
          const sf = h.surfaceAt(x, z);
          if (!IN_PLAY.includes(sf)) continue;
          if (h.rockName(x, z) || g.fx.cliffs.some((c) => {
            const q = c.at(x, z);
            return q.along > -0.5 && q.along < 1.5 && q.c > -c.run * 4 - 4 && q.c < c.run + c.talus + 4;
          })) continue;
          const [gx, gy] = h.toGreen(x, z);
          if (ease !== undefined && sf !== "green" && sf !== "fringe" && outsideGreen(h, gx, gy) < ease) continue;
          const s = Math.hypot(...g.slope(x, z));
          if (s <= 1 / 3) continue;
          if (Math.hypot(...gBare.slope(x, z)) <= 1 / 3) continue;
          if (s > worst) (worst = s), (at = `(${x}, ${z}) m`);
        }
      expect(worst, `slope 1 in ${(1 / worst).toFixed(1)} at ${at}`).toBeLessThanOrEqual(1 / 3);
    });
  }
});

describe("hazards have stakes", () => {
  it.each(DEFS.filter((d) => d.water.length).map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): every water hazard has stakes", ({ n }) => {
    const h = hole(n);
    const stakes = waterStakes(h);
    h.def.water.forEach((_, wi) => {
      expect(stakes.filter((s) => s.water === wi).length, `water ${wi}`).toBeGreaterThan(0);
    });
  });

  it.each(DEFS.filter((d) => (d.areas ?? []).some((a) => a.kind === "oob")).map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): every out-of-bounds area has stakes", ({ n }) => {
    const h = hole(n);
    for (const a of h.areas.filter((a) => a.kind === "oob")) expect(a.stakes.length).toBeGreaterThan(1);
  });
});

describe("drop zones", () => {
  it.each(DEFS.filter((d) => d.drops?.length).map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): each drop zone is on dry ground in play", ({ n }) => {
    const h = hole(n);
    for (const [x, z] of h.drops) {
      const sf = h.surfaceAt(x, z);
      expect(["fairway", "rough", "fescue", "waste"], `surface at (${x.toFixed(1)}, ${z.toFixed(1)})`).toContain(sf);
      for (let wi = 0; wi < h.def.water.length; wi++) {
        const w = h.def.water[wi];
        const sd = "path" in w ? creekSd(polyOf(w as Creek), x, z) : ringSd(ringOf(h, wi), x, z);
        expect(sd, `water ${wi} is ${sd.toFixed(2)} m off`).toBeGreaterThanOrEqual(BANK);
      }
    }
  });
});

describe("the cup and the green", () => {
  it.each(DEFS.map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): the cup is on the green", ({ n }) => {
    const h = hole(n);
    expect(h.surfaceAt(h.pin[0], h.pin[1])).toBe("green");
  });

  it.each(DEFS.map((d) => ({ n: d.n, name: d.name })))("hole $n ($name): the green's edge meets the ground with no step over a cm", ({ n }) => {
    const h = hole(n);
    const g = terrainOf(h);
    let worst = 0, where = "";
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      // the edge along this ray from the green's middle, in green coordinates
      let edge = -1;
      for (let r = 0; r < 60; r += 0.05) {
        if (outsideGreen(h, GW / 2 + Math.cos(a) * r, GH / 2 + Math.sin(a) * r) > 0) {
          edge = r;
          break;
        }
      }
      if (edge < 0) continue;
      // a step, not a slope: two points 2 cm either side of the edge, one on the green's own height and one on the ground
      const ix = GW / 2 + Math.cos(a) * (edge - 0.02), iy = GH / 2 + Math.sin(a) * (edge - 0.02);
      const ox = GW / 2 + Math.cos(a) * (edge + 0.02), oy = GH / 2 + Math.sin(a) * (edge + 0.02);
      const [xo, zo] = h.fromGreen(ox, oy);
      const step = Math.abs(g.yG(ix, iy) - g.y(xo, zo));
      if (step > worst) (worst = step), (where = `${(a * 180) / Math.PI} deg`);
    }
    expect(worst * 100, `step ${(worst * 100).toFixed(2)} cm at ${where}`).toBeLessThan(1);
  });
});
