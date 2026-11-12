import { describe, expect, it } from "vitest";
import { CLUBS, simulate, type ShotIn, type Surface } from "@/components/offhours/golf/flight";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { bridgeShape, collide, solidsOf, wallRuns, type Prop, type Solid } from "@/components/offhours/golf/solids";
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
  it("hole 4's bridge spans the creek: its ends are dry and its middle is over the water", () => {
    const h = buildHole(NINE_DEFS.find((d) => d.n === 4)!);
    const br = h.def.props!.find((p) => p.kind === "bridge") as Extract<Prop, { kind: "bridge" }>;
    const at = (k: number) => h.surfaceAt((br.a[0] + (br.b[0] - br.a[0]) * k) * YD, (br.a[1] + (br.b[1] - br.a[1]) * k) * YD);
    expect(at(0)).not.toBe("water");
    expect(at(1)).not.toBe("water");
    expect(at(0.5)).toBe("water");
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
    const hole = buildHole(NINE_DEFS.find((d) => d.n === 5)!);
    const ter = terrainOf(hole);
    const mk = (solids?: Solid[]) => simulate({ ...base({ club: CLUBS[0], speed: 1, yaw: 0.1, curve: 0.3 }), ground: ter, surfaceAt: hole.surfaceAt, solids });
    const a = mk(), b = mk([]);
    expect(Array.from(b.pts)).toEqual(Array.from(a.pts));
    expect(b.total).toBe(a.total);
    expect("prop" in b).toBe(false);
    expect(solidsOf(hole.def.props, ter)).toEqual([]);
  });
  it("only holes 2, 4 and 7 have props", () => {
    expect(NINE_DEFS.filter((d) => d.props?.length).map((d) => d.n)).toEqual([2, 4, 7]);
  });
});
