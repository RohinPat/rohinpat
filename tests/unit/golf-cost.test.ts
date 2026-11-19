import { describe, expect, it, vi } from "vitest";
import { CLUBS, simulate } from "@/components/offhours/golf/flight";
import { NINE_DEFS, buildHole, type BuiltHole } from "@/components/offhours/golf/course";
import { GH, GW } from "@/components/offhours/golf/green";
import { bakeCost, terrainOf } from "@/components/offhours/golf/terrain";

// What the ground costs, counted rather than timed: a hole's terrain is baked lazily (terrain.ts), and the cost is the
// number of full() evaluations and fine tiles it takes to answer a fixed set of queries a visitor makes (a tee shot's
// flight, the ground either side of the line, the green). A timed budget hides a regression on a fast machine and fails
// on a slow one; these counts do not move with the machine. Each ceiling is today's count plus about 25%.

// (the queries bake up to 33k ground points: hole 9 takes about 5 s in a full run, so the repo's standard 20 s. The count is the guard, not the time)
vi.setConfig({ testTimeout: 20_000 });

/** the ceilings, per hole (n): full() calls and fine tiles, for the queries below (today's counts + about 25%) */
const CEILING: Record<number, { full: number; tiles: number }> = {
  1: { full: 1933, tiles: 0 },
  2: { full: 10405, tiles: 33 },
  3: { full: 41589, tiles: 142 },
  4: { full: 2269, tiles: 0 },
  5: { full: 1950, tiles: 0 },
  6: { full: 2190, tiles: 0 },
  7: { full: 1960, tiles: 0 },
  8: { full: 2410, tiles: 0 },
  9: { full: 34297, tiles: 115 },
};

/** the fixed queries: a driver off the tee at the pin, the flight's ground, the ground 30 m either side of the line, and the green */
function queries(h: BuiltHole) {
  const T = terrainOf(h);
  const [px, pz] = h.pin;
  const shot = simulate({
    club: CLUBS[0], speed: 1, yaw: Math.atan2(px, pz), face: 0, curve: 0, contact: 1, wind: h.wind,
    surfaceAt: h.surfaceAt, ground: { y: T.y, slope: T.slope }, trees: h.blockers,
  });
  for (let i = 0; i < shot.n; i += 4) {
    const x = shot.pts[i * 4 + 1], z = shot.pts[i * 4 + 3];
    T.y(x, z);
    T.slope(x, z);
  }
  const L = h.line;
  for (let i = 1; i < L.length - 1; i += 2) {
    const [ax, az] = L[i - 1], [bx, bz] = L[i + 1];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (bz - az) / l, nz = -(bx - ax) / l;
    for (let d = -30; d <= 30; d += 10) T.y(L[i][0] + nx * d, L[i][1] + nz * d);
  }
  for (let gy = 0; gy <= GH; gy += 2.5) for (let gx = 0; gx <= GW; gx += 2.5) T.yG(gx, gy);
}

describe("the ground's cost, per hole (counted, not timed)", () => {
  for (const def of NINE_DEFS) {
    it(`hole ${def.n}: the fixed queries bake under the ceiling`, () => {
      const h = buildHole(def);
      bakeCost.full = 0;
      bakeCost.tiles = 0;
      queries(h);
      const got = { full: bakeCost.full, tiles: bakeCost.tiles };
      console.log("COST", def.n, JSON.stringify(got));
      expect(got.full).toBeGreaterThan(0);
      const c = CEILING[def.n];
      expect(c, `no ceiling for hole ${def.n}`).toBeDefined();
      expect(got.full, `full() calls on hole ${def.n}`).toBeLessThanOrEqual(c.full);
      expect(got.tiles, `fine tiles on hole ${def.n}`).toBeLessThanOrEqual(c.tiles);
    });
  }
});
