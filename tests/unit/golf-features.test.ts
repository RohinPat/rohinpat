import { describe, expect, it } from "vitest";
import { CLUBS, simulate, type ShotIn } from "@/components/offhours/golf/flight";
import { HOLE_DEFS, buildHole, type HoleDef } from "@/components/offhours/golf/course";
import { compileFeatures, type Feature } from "@/components/offhours/golf/features";
import { slopeLie, slopeWords } from "@/components/offhours/golf/lie";
import { YD } from "@/components/offhours/golf/scene";
import { terrainOf } from "@/components/offhours/golf/terrain";

// Landforms (features.ts): their heights as pure functions, the ground they make on a hole, and a ball on a pot face
// and on a steep bank.

const B = [{ x: 0, z: 0, rx: 5, rz: 5 }];
const fy = (f: Feature[], x: number, z: number) => compileFeatures(f, B).y(x * YD, z * YD);

describe("feature heights", () => {
  it("a ridge peaks on its path, falls to nothing at its half width, and can end lower", () => {
    const f: Feature[] = [{ k: "ridge", path: [[0, 0], [0, 40]], w: 10, h: 6, h2: 2 }];
    expect(fy(f, 0, 0)).toBeCloseTo(6, 5);
    expect(fy(f, 0, 40)).toBeCloseTo(2, 5);
    expect(fy(f, 5, 20)).toBeGreaterThan(0.5);
    expect(fy(f, 5, 20)).toBeLessThan(3);
    expect(fy(f, 10, 20)).toBe(0);
    expect(fy(f, 30, 20)).toBe(0);
  });
  it("a closed ridge is a ring round a hollow centre", () => {
    const ring: [number, number][] = Array.from({ length: 16 }, (_, i) => [30 * Math.cos((i / 16) * 6.283), 30 * Math.sin((i / 16) * 6.283)]);
    const f: Feature[] = [{ k: "ridge", path: ring, w: 8, h: 4, closed: true, flat: 0.3 }];
    expect(fy(f, 0, 0)).toBe(0);
    expect(fy(f, 30, 0)).toBeCloseTo(4, 1);
    expect(fy(f, 0, -30)).toBeCloseTo(4, 1);
  });
  it("a mound rises, a hollow dips, a bowl has a flat floor and a rim", () => {
    expect(fy([{ k: "mound", x: 0, z: 0, r: 10, h: 3 }], 0, 0)).toBeCloseTo(3, 5);
    expect(fy([{ k: "hollow", x: 0, z: 0, r: 10, d: 2 }], 0, 0)).toBeCloseTo(-2, 5);
    const bowl: Feature[] = [{ k: "bowl", x: 0, z: 0, r: 20, d: 3, flat: 0.5, rim: 1.5, rimW: 6 }];
    expect(fy(bowl, 0, 0)).toBeCloseTo(-3, 5);
    expect(fy(bowl, 8, 0)).toBeCloseTo(-3, 5);
    expect(fy(bowl, 20, 0)).toBeCloseTo(1.5, 1);
    expect(fy(bowl, 40, 0)).toBe(0);
  });
  it("a pot has a floor, a face and a lip", () => {
    const c = compileFeatures([{ k: "pot", b: 0, d: 1.7, lip: 0.5 }], B);
    const r = 5 * YD;
    expect(c.pot(0, 0, 0)).toBeCloseTo(1.7, 5);
    expect(c.pot(0, r * 0.5, 0)).toBeCloseTo(1.7, 5);
    expect(c.pot(0, r * 0.99, 0)!).toBeLessThan(0.3);
    expect(c.pot(0, 0, r * 1.1)!).toBeLessThan(-0.3);
    expect(c.pot(0, 0, r * 2)).toBe(0);
    expect(c.pot(1, 0, 0)).toBeNull();
  });
  it("a channel is deep on its floor and level past its banks; a shelf is flat on top; a face steps; a terrace climbs", () => {
    const ch: Feature[] = [{ k: "channel", path: [[0, -50], [0, 50]], w: 6, bank: 5, d: 4, d2: 2 }];
    expect(fy(ch, 0, -50)).toBeCloseTo(-4, 5);
    expect(fy(ch, 0, 50)).toBeCloseTo(-2, 5);
    expect(fy(ch, 12, 0)).toBe(0);
    const sh: Feature[] = [{ k: "shelf", x: 0, z: 0, r: 15, rz: 10, h: 4, edge: 6 }];
    expect(fy(sh, 0, 0)).toBeCloseTo(4, 5);
    expect(fy(sh, 10, 5)).toBeCloseTo(4, 5);
    expect(fy(sh, 40, 0)).toBe(0);
    // the left of a path running +z is -x
    const face: Feature[] = [{ k: "face", path: [[0, -60], [0, 60]], h: 5, w: 4, reach: 60 }];
    expect(fy(face, -8, 0)).toBeCloseTo(5, 1);
    expect(fy(face, 8, 0)).toBeCloseTo(0, 5);
    expect(fy(face, -8, 200)).toBe(0);
    const ter: Feature[] = [{ k: "terrace", path: [[0, -60], [0, 60]], h: 6, n: 3, tread: 10, riser: 3, reach: 80 }];
    expect(fy(ter, -4, 0)).toBeGreaterThan(1.9);
    expect(fy(ter, -14, 0)).toBeGreaterThan(3.9);
    expect(fy(ter, -24, 0)).toBeGreaterThan(5.8);
  });
});

describe("a hole with features", () => {
  const base = HOLE_DEFS[4];
  const def = (over: Partial<HoleDef>, ground: object = {}): HoleDef => ({ ...base, ...over, ground: { ...base.ground!, ...ground } });

  it("a small sigma keeps a crest the default blur flattens", () => {
    const rise: [number, number][] = [[0, 0], [60, 0], [90, 8], [120, 0], [177, 0]];
    const crest = (sigma?: number) => terrainOf(buildHole(def({}, { rise, swell: 0, sigma }))).y(0, 90 * YD);
    expect(crest(8)).toBeGreaterThan(crest() + 1.5);
  });
  it("a short greenEase leaves a rim close to the green", () => {
    const green = base.green.c;
    const feats: Feature[] = [{ k: "mound", x: green[0] + 22, z: green[1], r: 6, h: 3 }];
    const at = (f: Feature[], ease?: number) => terrainOf(buildHole(def({ features: f }, { greenEase: ease }))).y((green[0] + 22) * YD, green[1] * YD);
    const kept = (ease?: number) => at(feats, ease) - at([], ease);
    expect(kept(3)).toBeGreaterThan(kept() + 0.8);
  });
  it("a tilted pad leans, and bunkers can be dug deeper", () => {
    const g = base.green.c;
    const t = terrainOf(buildHole(def({}, { padTilt: [0, -0.04] })));
    expect(t.y(g[0] * YD, g[1] * YD - 3)).toBeGreaterThan(t.y(g[0] * YD, g[1] * YD + 3) + 0.15);
    const bk = base.bunkers[0];
    const deep = terrainOf(buildHole(def({ bunkers: [{ ...bk, depth: 1.2 }, ...base.bunkers.slice(1)] })));
    const shallow = terrainOf(buildHole(def({})));
    expect(deep.y(bk.x * YD, bk.z * YD)).toBeLessThan(shallow.y(bk.x * YD, bk.z * YD) - 0.7);
  });
  it("hole 2 drops 13 m to its green, hole 3 has a pot at its corner", () => {
    expect(terrainOf(buildHole(HOLE_DEFS[1])).pad).toBeLessThan(-12);
    const h = buildHole(HOLE_DEFS[2]);
    const t = terrainOf(h);
    const b = h.def.bunkers[0];
    const cx = b.x * YD, cz = b.z * YD, lip = t.y(cx, cz + b.rz * YD * 1.1);
    expect(lip - t.y(cx, cz)).toBeGreaterThan(1.6);
  });
});

describe("a ball on a pot face and on a bank", () => {
  const h = buildHole(HOLE_DEFS[2]);
  const t = terrainOf(h);
  const b = h.def.bunkers[0];
  const cx = b.x * YD, cz = b.z * YD, rx = b.rx * YD, rz = b.rz * YD, c = Math.cos(b.rot ?? 0), s = Math.sin(b.rot ?? 0);
  const radius = (x: number, z: number) => {
    const dx = x - cx, dz = z - cz;
    return Math.hypot((dx * c + dz * s) / rx, (-dx * s + dz * c) / rz);
  };
  const shot = (ox: number, oz: number, over: Partial<ShotIn> = {}): ShotIn => ({
    club: CLUBS[5], speed: 0.0005, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: h.surfaceAt, origin: [ox, oz], ground: t, ...over,
  });

  it("the face is steep and reads as a slope lie", () => {
    const x = cx, z = cz - rz * 0.86;
    const [sx, sz] = t.slope(x, z);
    expect(Math.hypot(sx, sz)).toBeGreaterThan(0.8);
    expect(slopeLie(sx, sz, 0, 5)).toBeDefined();
    expect(slopeWords(sx, sz, 0)).not.toBeNull();
    expect(h.surfaceAt(x, z)).toBe("bunker");
  });
  it("a ball rolling in over the face ends low, on ground it can rest on", () => {
    for (const a of [0.8, 2.4, 4.0, 5.5]) {
      const x = cx + Math.cos(a) * rx * 0.88, z = cz + Math.sin(a) * rz * 0.88;
      // nudged toward the middle (a ball that has only just stopped on a face stays; one that arrives rolling goes down)
      const sim = simulate(shot(x, z, { speed: 0.06, yaw: Math.atan2(cx - x, cz - z) }));
      const e = sim.n - 1;
      const ex = x + sim.pts[e * 4 + 1], ez = z + sim.pts[e * 4 + 3];
      expect(radius(ex, ez), `from angle ${a}`).toBeLessThan(0.86);
      expect(t.y(ex, ez), `from angle ${a}`).toBeLessThan(t.y(x, z) + 0.05);
      expect(Math.hypot(...t.slope(ex, ez)), `from angle ${a}`).toBeLessThan(1.3);
      expect(sim.restT).toBeLessThan(10);
    }
  });
  it("a ball on a steep bank of fairway runs to the foot of it and stays on the flat", () => {
    const ground = {
      y: (_x: number, z: number) => 4 * (1 - Math.min(1, Math.max(0, (z - 10) / 6))),
      slope: (_x: number, z: number): [number, number] => [0, z > 10 && z < 16 ? -4 / 6 : 0],
    };
    const sim = simulate(shot(0, 11, { ground, surfaceAt: () => "fairway" }));
    const e = sim.n - 1;
    expect(sim.pts[e * 4 + 3]).toBeGreaterThan(5);
    expect(sim.pts[e * 4 + 2]).toBeLessThan(-2);
  });
});
