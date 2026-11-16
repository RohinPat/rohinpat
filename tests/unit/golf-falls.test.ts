import { describe, expect, it } from "vitest";
import { YD } from "@/components/offhours/golf/scene";
import { NINE_DEFS, buildHole, lakeOf, ringSd, type Lake } from "@/components/offhours/golf/course";
import { NOTCH_FADE, terrainOf } from "@/components/offhours/golf/terrain";
import { signedDist } from "@/components/golf3d/scenery/geo";
import { sceneryFor } from "@/components/golf3d/scenery/scenes";
import { prepareScenery } from "@/components/golf3d/scenery";
import { buildFalls, fallsPoints } from "@/components/golf3d/falls3d";

// Hole 8's waterfall: the lake spills off its level down the bank to the bay below. Visual only; no play reads it.

const def = NINE_DEFS.find((d) => d.n === 8)!;
const hole = buildHole(def);
const ground = terrainOf(hole);
const rec = sceneryFor(8);

/** the distance (m) from a point to a closed ring */
const toRing = (ring: [number, number][], x: number, z: number) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
    best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z));
  }
  return best;
};

describe("hole 8: the lake's waterfall", () => {
  it("is the only hole with a waterfall", () => {
    expect(NINE_DEFS.filter((d) => d.falls).map((d) => d.n)).toEqual([8]);
  });

  it("spills from the lake's shore, at the lake's level, down to the bay at its level", () => {
    const f = def.falls!;
    const [fx, fz] = [f.from[0] * YD, f.from[1] * YD];
    const [tx, tz] = [f.to[0] * YD, f.to[1] * YD];
    // the lip is on the lake's shore (within a couple of metres of it), and the lake's level is the lip's level
    const lake = lakeOf(def.water.find((w): w is Lake => "shore" in w)!);
    expect(toRing(lake, fx, fz)).toBeLessThan(2.5);
    const lipY = ground.waterY(fx, fz);
    expect(lipY).toBeCloseTo(16.8, 0);
    // the foot is in the bay, and the bay lies lower than the lake
    const bayY = rec.coast!.seaY;
    expect(signedDist(rec.coast!, tx, tz)).toBeGreaterThan(0);
    expect(bayY).toBeLessThan(lipY - 15);
    // the fall runs from the lake's shore out to the bay (no further from the lake than the bank is wide)
    expect(Math.hypot(tx - fx, tz - fz)).toBeLessThan(30);
  });

  it("the sheet hangs between the two levels and clears the drawn bank", () => {
    const p = prepareScenery(hole, ground.y, "high");
    const f = def.falls!;
    const lipY = ground.waterY(f.from[0] * YD, f.from[1] * YD);
    const bayY = rec.coast!.seaY;
    const { pos } = fallsPoints(f.from, f.to, f.width, lipY, bayY, p.heightAt, 14, 4);
    const ys = pos.filter((_, i) => i % 3 === 1);
    // no point of the sheet is above the lake's level, nor below the bay's
    expect(Math.max(...ys)).toBeLessThanOrEqual(lipY + 0.01);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(bayY - 0.01);
    // it stays in the air over the bank: at every row the sheet stands above the drawn ground, bar the foot where it meets the bay
    const cols = 15, rows = 5;
    for (let i = 0; i < cols - 1; i++)
      for (let j = 0; j < rows; j++) {
        const k = (i * rows + j) * 3;
        expect(pos[k + 1]).toBeGreaterThanOrEqual(p.heightAt(pos[k], pos[k + 2]) + 0.2);
      }
  });

  it("the lake is held by its bank: 2 m out round the shore (not across the notch) the drawn ground is never below the lake's level", () => {
    const p = prepareScenery(hole, ground.y, "high");
    const f = def.falls!;
    const lake = lakeOf(def.water.find((w): w is Lake => "shore" in w)!);
    const level = 16.8;
    // the notch: the falls' channel, its width and a little more, where the water spills and the bank is not held
    const [ax, az] = [f.from[0] * YD, f.from[1] * YD], [bx, bz] = [f.to[0] * YD, f.to[1] * YD];
    const across = (x: number, z: number) => {
      const dx = bx - ax, dz = bz - az;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - (ax + dx * u), z - (az + dz * u));
    };
    // (and the bank's ramp down into it, which is not held: terrain.ts NOTCH_FADE)
    const notch = (f.width * YD) / 2 + 1.5 + NOTCH_FADE;
    let sampled = 0;
    for (let i = 0; i < lake.length; i++) {
      const [x, z] = lake[i];
      const [px, pz] = lake[(i + lake.length - 1) % lake.length], [nx, nz] = lake[(i + 1) % lake.length];
      // the ring's normal here, turned to point out of the lake
      let ux = nz - pz, uz = -(nx - px);
      const l = Math.hypot(ux, uz) || 1;
      ux /= l;
      uz /= l;
      if (ringSd(lake, x + ux, z + uz) < 0) [ux, uz] = [-ux, -uz];
      const [qx, qz] = [x + ux * 2, z + uz * 2];
      if (across(qx, qz) < notch) continue;
      const sd = ringSd(lake, qx, qz);
      if (sd < 1 || sd > 3) continue;
      sampled++;
      expect(p.heightAt(qx, qz), `ring ${i}`).toBeGreaterThanOrEqual(level - 0.01);
    }
    expect(sampled).toBeGreaterThan(150);
  });

  it("the bank steps down into the notch, no cliff: across the notch's edges the ground changes by under 0.5 m per 0.5 m", () => {
    const p = prepareScenery(hole, ground.y, "high");
    const f = def.falls!;
    // a line across the falls' channel, a few metres out from the lip, at right angles to the flow
    const [ax, az] = [f.from[0] * YD, f.from[1] * YD], [bx, bz] = [f.to[0] * YD, f.to[1] * YD];
    const mx = (ax + bx) / 2 - 4, mz = az;
    const flow = Math.atan2(bz - az, bx - ax);
    const [ux, uz] = [-Math.sin(flow), Math.cos(flow)];
    const drawn: number[] = [], play: number[] = [];
    for (let d = -18; d <= 18.001; d += 0.5) {
      drawn.push(p.heightAt(mx + ux * d, mz + uz * d));
      play.push(ground.y(mx + ux * d, mz + uz * d));
    }
    for (const [name, ys] of [["drawn", drawn], ["play", play]] as const)
      for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i] - ys[i - 1]), `${name} step ${i}`).toBeLessThan(0.5);
  });

  it("builds on every tier, with a few draws, and not at all without the field", () => {
    const p = prepareScenery(hole, ground.y, "high");
    const disposables: { dispose: () => void }[] = [];
    for (const tier of ["high", "low", "soft"] as const) {
      const fl = buildFalls({ hole, drawnAt: p.heightAt, lipY: 16.6, bayY: -8, tier, reduce: false, disposables });
      expect(fl, tier).not.toBeNull();
      expect(fl!.calls, tier).toBeLessThanOrEqual(2);
      expect(fl!.tris, tier).toBeLessThanOrEqual(200);
    }
    const plain = buildHole(NINE_DEFS.find((d) => d.n === 7)!);
    expect(buildFalls({ hole: plain, drawnAt: p.heightAt, lipY: 0, bayY: 0, tier: "high", reduce: false, disposables })).toBeNull();
    for (const d of disposables) d.dispose();
  });
});
