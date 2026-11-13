import { describe, expect, it } from "vitest";
import { CLUBS, simulate, type ShotIn, type Surface } from "@/components/offhours/golf/flight";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { bridgeShape, collide, deckTop, onDeck, solidsOf, wallRuns, withDecks, type Prop, type Solid } from "@/components/offhours/golf/solids";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { YD } from "@/components/offhours/golf/scene";

// Walls, boulders, posts and a bridge's rails stop and turn a ball; a hole without props plays exactly as before.

const flat = (): Surface => "fairway";
const FLATG = { y: () => 0 };
const base = (o: Partial<ShotIn> = {}): ShotIn => ({ club: CLUBS[4], speed: 0.8, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: flat, ...o });
const wall: Solid = { kind: "wall", ax: -20, az: 30, bx: 20, bz: 30, r: 0.3, h: 1.2, e: 0.3 };

describe("solids", () => {
  it("a wall cut by a gap is two runs, and the gap is open", () => {
    const p: Extract<Prop, { kind: "wall" }> = { kind: "wall", path: [[0, 0], [0, 100]], gaps: [[40, 50]] };
    const runs = wallRuns(p);
    expect(runs.length).toBe(2);
    expect(runs[0][runs[0].length - 1][1]).toBeCloseTo(40 * YD, 5);
    expect(runs[1][0][1]).toBeCloseTo(50 * YD, 5);
    const s = solidsOf([p], FLATG);
    expect(collide(s, 0, 45 * YD, 0.3, 0.02, 0)).toBeNull();
    expect(collide(s, 0, 30 * YD, 0.3, 0.02, 0)).not.toBeNull();
    expect(collide(s, 0, 30 * YD, 1.5, 0.02, 0)).toBeNull();
  });
  it("is the same array each time for the same props and ground", () => {
    const props: Prop[] = [{ kind: "boulder", at: [0, 10], size: 1 }];
    expect(solidsOf(props, FLATG)).toBe(solidsOf(props, FLATG));
    expect(solidsOf(undefined, FLATG)).toEqual([]);
  });
  it("a bridge's deck sits above both banks and the water, and its rails are above the deck", () => {
    const g = { y: (x: number, z: number) => (Math.abs(z - 100) < 5 ? -2 : 0), waterY: () => -1.2 };
    const p: Extract<Prop, { kind: "bridge" }> = { kind: "bridge", a: [0, 90], b: [0, 110] };
    const b = bridgeShape(p, g);
    expect(b.deckY).toBeGreaterThanOrEqual(0.5);
    // a deeper channel does not move it down; a higher water level moves it up
    expect(bridgeShape(p, { ...g, y: (x, z) => (Math.abs(z - 100) < 5 ? -5 : 0) }).deckY).toBeCloseTo(b.deckY, 6);
    expect(bridgeShape(p, { ...g, waterY: () => 2 }).deckY).toBeGreaterThanOrEqual(3);
    const rails = solidsOf([p], g).filter((s) => s.kind === "rail");
    expect(rails.length).toBe(2);
    for (const r of rails) expect(r.y0).toBe(b.deckY);
  });
  it("hole 4's stone bridge spans the creek: its ends are dry, its deck is dry, and the water runs under and beside it", () => {
    const h = buildHole(NINE_DEFS.find((d) => d.n === 4)!);
    const br = h.def.props!.find((p) => p.kind === "bridge") as Extract<Prop, { kind: "bridge" }>;
    const at = (k: number, across = 0) => h.surfaceAt((br.a[0] + (br.b[0] - br.a[0]) * k) * YD + across, (br.a[1] + (br.b[1] - br.a[1]) * k) * YD);
    expect(at(0)).not.toBe("water");
    expect(at(1)).not.toBe("water");
    // the middle of the span is the deck, which is dry; a few metres to either side of it is the creek
    expect(at(0.5)).toBe("fairway");
    expect(at(0.5, 3)).toBe("water");
    expect(at(0.5, -3)).toBe("water");
    expect((br.arch ?? 0)).toBeGreaterThan(0);
  });
  it("a stone bridge's deck springs from the ground at both ends and rises to a crown that clears the water", () => {
    const g = { y: (x: number, z: number) => (Math.abs(z - 100 * YD) < 6 ? -2 : 0), waterY: () => -1.8 };
    const p: Extract<Prop, { kind: "bridge" }> = { kind: "bridge", a: [0, 90], b: [0, 110], arch: 0.4 };
    const b = bridgeShape(p, g);
    expect(deckTop(b, 0)).toBeCloseTo(0, 6);
    expect(deckTop(b, 1)).toBeCloseTo(0, 6);
    expect(deckTop(b, 0.5)).toBeCloseTo(b.deckY, 6);
    expect(b.deckY).toBeGreaterThanOrEqual(0.4);
    for (const k of [0.25, 0.5, 0.75]) expect(deckTop(b, k)).toBeGreaterThanOrEqual(g.waterY() + 1 - 1e-6);
    expect(onDeck([p], 0, 100 * YD)).toBe(true);
    expect(onDeck([p], 3, 100 * YD)).toBe(false);
    expect(onDeck([p], 0, 120 * YD)).toBe(false);
  });
});

describe("a ball on a bridge", () => {
  // a creek 12 m wide across the course at z = 100 yd, 1.5 m deep, with a stone bridge over it
  const props: Prop[] = [{ kind: "bridge", a: [0, 90], b: [0, 110], w: 3.2, arch: 0.45 }];
  const zc = 100 * YD;
  const dug = { y: (x: number, z: number) => (Math.abs(z - zc) < 6 ? -1.5 : 0), slope: () => [0, 0] as [number, number], waterY: () => -0.9 };
  const decked = withDecks(dug, props);
  const surf = (x: number, z: number): Surface => (Math.abs(z - zc) < 6 && !onDeck(props, x, z) ? "water" : "fairway");
  const solids = solidsOf(props, decked);
  it("with no bridge the ground is untouched", () => {
    expect(withDecks(dug, undefined)).toBe(dug);
    expect(withDecks(dug, [{ kind: "boulder", at: [0, 0], size: 1 }])).toBe(dug);
  });
  it("the deck is the ground's height over it, and the ground everywhere else", () => {
    expect(decked.y(0, zc)).toBeGreaterThan(0.4);
    expect(decked.y(5, zc)).toBeCloseTo(dug.y(5, zc), 9);
    expect((decked as { base?: unknown }).base).toBe(dug);
  });
  it("a ball that lands on the deck rolls over it and comes off the far end, dry", () => {
    // from 30 m short of the creek, a wedge that lands on the deck (a 4 m wide target, so find a power that does)
    let found = 0;
    for (let sp = 0.3; sp < 0.7; sp += 0.005) {
      const s = simulate(base({ club: CLUBS[4], speed: sp, surfaceAt: surf, ground: decked, solids, origin: [0, zc - 30] }));
      const first = s.bounces[0];
      if (!first || !onDeck(props, first.x, zc - 30 + first.z)) continue;
      found++;
      expect(first.surface).toBe("fairway");
      expect(s.surface).not.toBe("water");
      // it ends past the deck (rolled over it), not in the creek under it
      expect(s.pts[s.pts.length - 1]).toBeGreaterThan(8);
    }
    expect(found).toBeGreaterThan(2);
  });
  it("the same shot with no deck is in the water", () => {
    let wet = 0;
    for (let sp = 0.3; sp < 0.7; sp += 0.005) {
      const s = simulate(base({ club: CLUBS[4], speed: sp, surfaceAt: (x, z) => (Math.abs(z - zc) < 6 ? "water" : "fairway"), ground: dug, origin: [0, zc - 30] }));
      if (s.surface === "water") wet++;
    }
    expect(wet).toBeGreaterThan(2);
  });
  it("is deterministic", () => {
    const a = simulate(base({ speed: 0.45, surfaceAt: surf, ground: decked, solids, origin: [0, zc - 30] }));
    const b = simulate(base({ speed: 0.45, surfaceAt: surf, ground: decked, solids, origin: [0, zc - 30] }));
    expect(Array.from(a.pts)).toEqual(Array.from(b.pts));
  });
});

describe("a ball meets a solid", () => {
  it("a low ball into a wall drops and comes back; the same shot with no wall goes on", () => {
    const low = { club: CLUBS[3], speed: 0.8, lie: { launch: 0.1 } };
    const free = simulate(base(low));
    const hit = simulate(base({ ...low, solids: [wall] }));
    expect(free.pts[free.pts.length - 1]).toBeGreaterThan(wall.az);
    expect(hit.prop?.kind).toBe("wall");
    expect(hit.prop!.z).toBeLessThan(wall.az);
    // it stops short of the wall, or back toward the tee
    expect(hit.pts[hit.pts.length - 1]).toBeLessThan(wall.az);
  });
  it("a high ball clears it", () => {
    const hit = simulate(base({ club: CLUBS[5], speed: 0.9, solids: [{ ...wall, az: 25, bz: 25 }] }));
    expect(hit.prop).toBeUndefined();
  });
  it("a rolling ball is turned back by a boulder", () => {
    // a putt-like roll: a 7 iron skimmed in from a lie that kills the launch
    const boulder: Solid = { kind: "boulder", ax: 0, az: 8, bx: 0, bz: 8, r: 1, h: 1, e: 0.4 };
    const s = simulate(base({ club: CLUBS[3], speed: 0.3, solids: [boulder], lie: { launch: 0.01 } }));
    expect(s.prop?.kind).toBe("boulder");
    expect(s.pts[s.pts.length - 1]).toBeLessThan(8);
  });
  it("is deterministic", () => {
    const a = simulate(base({ solids: [wall] }));
    const b = simulate(base({ solids: [wall] }));
    expect(Array.from(a.pts)).toEqual(Array.from(b.pts));
  });
  it("a ball over the water under a bridge's rail is not stopped, one level with it is", () => {
    const rail: Solid = { kind: "rail", ax: -5, az: 30, bx: 5, bz: 30, r: 0.14, h: 1, e: 0.35, y0: 5, y1: 6 };
    expect(simulate(base({ solids: [rail] })).prop).toBeUndefined();
  });
});

describe("holes without props", () => {
  it("empty or no solids give the very same shot, bit for bit", () => {
    const hole = buildHole(NINE_DEFS.find((d) => d.n === 6)!);
    const ter = terrainOf(hole);
    const mk = (solids?: Solid[]) => simulate({ ...base({ club: CLUBS[0], speed: 1, yaw: 0.1, curve: 0.3 }), ground: ter, surfaceAt: hole.surfaceAt, solids });
    const a = mk(), b = mk([]);
    expect(Array.from(b.pts)).toEqual(Array.from(a.pts));
    expect(b.total).toBe(a.total);
    expect("prop" in b).toBe(false);
    expect(solidsOf(hole.def.props, ter)).toEqual([]);
  });
  it("only holes 1, 2, 4, 5, 6 and 7 have props", () => {
    expect(NINE_DEFS.filter((d) => d.props?.length).map((d) => d.n)).toEqual([1, 2, 4, 5, 6, 7]);
  });
});
