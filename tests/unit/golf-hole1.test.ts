import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUBS, simulate } from "@/components/offhours/golf/flight";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { CourseGame, STEP } from "@/components/offhours/golf/play";
import { YD } from "@/components/offhours/golf/scene";
import { forgetBest } from "@/components/offhours/golf/score";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { DOOR } from "@/components/golf3d/scenery/hole1";
import { stubScratchCanvas } from "./golf-headless";

vi.setConfig({ testTimeout: 60_000 });
beforeEach(() => {
  stubScratchCanvas();
  forgetBest();
});
afterEach(() => vi.unstubAllGlobals());

// Hole 1, The Door (wave 2): a raised tee, a wide fairway that turns gently right round a lone oak, a climb to a plateau
// green up a false front, two stone gateposts and the Door peak behind.

const def = NINE_DEFS[0];
const hole = buildHole(def);
const t = terrainOf(hole);
const rad = (d: number) => (d * Math.PI) / 180;
const PURE = { power: 1, face: 0, curve: 0, contact: 1 };
const run = (g: CourseGame, until: () => boolean, max = 40) => {
  const t0 = g.t;
  while (!until() && g.t - t0 < max) g.step(STEP);
  return until();
};
const tee = (club: number, deg: number) => simulate({ club: CLUBS[club], speed: 1, yaw: rad(deg), face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: hole.surfaceAt, ground: { y: t.y, slope: t.slope }, trees: hole.blockers });
/** the line's own point at `z` yd */
const onLine = (z: number) => hole.line.reduce((b, p) => (Math.abs(p[1] - z * YD) < Math.abs(b[1] - z * YD) ? p : b));

describe("hole 1, The Door", () => {
  it("falls from the tee to a swale and climbs about 15 m to a plateau green 10 m above the tee", () => {
    let low = Infinity;
    for (let z = 100; z <= 260; z += 5) low = Math.min(low, t.y(...onLine(z)));
    expect(low).toBeLessThan(-4.5);
    expect(t.pad).toBeGreaterThan(9);
    expect(t.pad - low).toBeGreaterThan(14);
    expect(def.ground!.baseY).toBe(30);
  });

  it("the face to the plateau is steep enough to hold a ball and to roll a short one back, never past the rest limit", () => {
    let top = 0;
    for (let z = 270; z <= 330; z += 2) {
      const [x, zz] = onLine(z);
      const m = Math.hypot(...t.slope(x, zz));
      top = Math.max(top, m);
      expect(m, `${z} yd`).toBeLessThan(0.3);
    }
    expect(top).toBeGreaterThan(0.22);
  });

  it("a wedge that comes up short lands on the face and stays in play, on the fairway, short of the green", () => {
    const g = new CourseGame({ seed: 5, holes: [def], hills: true });
    g.key({ key: " " }, true);
    g.wind = [0, 0];
    g.ball = [...onLine(266)] as [number, number];
    g.lie = "fairway";
    g.strokes = 1;
    g.phase = "ready";
    (g as unknown as { prepareShot(tee: boolean): void }).prepareShot(false);
    g.wind = [0, 0];
    const sg = g.suggested();
    g.setClub(sg.club);
    g.remoteSwing({ ...PURE, power: sg.power * 0.75 });
    expect(run(g, () => g.phase === "rest" || g.phase === "putt")).toBe(true);
    expect(["fairway", "rough"]).toContain(g.lie);
    expect(g.yardsToPin()).toBeGreaterThan(8);
    expect(g.yardsToPin()).toBeLessThan(70);
  });

  it("the oak stands in the fairway: a driver on the inside line clears it, a 3 wood aimed at it goes in and drops short, the safe line is clear", () => {
    expect(def.copse).toHaveLength(1);
    const [ox, oz] = def.copse![0];
    expect(hole.surfaceAt(ox * YD, oz * YD)).toBe("fairway");
    const deg = (Math.atan2(ox, oz) * 180) / Math.PI;
    expect(tee(0, deg).tree).toBeNull();
    const wood = tee(1, deg);
    expect(wood.tree).not.toBeNull();
    expect(wood.total).toBeLessThan(tee(1, 0).total - 20);
    // aimed at the landing area (the safe line) nothing is in the way
    const a = Math.atan2(def.landing[0], def.landing[1]);
    for (const club of [0, 1]) expect(tee(club, (a * 180) / Math.PI).tree, `club ${club}`).toBeNull();
  });

  it("the landing area is wide and leans right, and the bunker sits outside the fairway", () => {
    const [lx, lz] = onLine(240);
    expect(hole.fairHalfAt(lz)).toBeGreaterThan(28);
    expect(t.slope(lx, lz)[0]).toBeLessThan(-0.015);
    for (const b of def.bunkers) expect(hole.surfaceAt(b.x * YD, b.z * YD)).toBe("bunker");
  });

  it("two gateposts frame the green with the Door peak between them, clear of play", () => {
    const gate = def.props!.find((p) => p.kind === "gatepost")!;
    if (gate.kind !== "gatepost") throw new Error("no gate");
    expect(gate.h).toBeGreaterThan(3);
    expect(Math.abs(gate.at[0] - def.green.c[0])).toBeLessThan(3);
    expect(gate.at[1]).toBeGreaterThan(def.pin[1] + 10);
    const [gx, gz] = [gate.at[0] * YD, gate.at[1] * YD];
    expect(Math.abs((Math.atan2(gx, gz) * 180) / Math.PI - DOOR)).toBeLessThan(1.5);
    for (const s of [-1, 1]) {
      const px = gx + s * (gate.gap / 2) * Math.sin(gate.yaw), pz = gz + s * (gate.gap / 2) * Math.cos(gate.yaw);
      expect(Math.hypot(px - hole.pin[0], pz - hole.pin[1])).toBeGreaterThan(14);
    }
  });

  it("opens the view: no trees on the right from the face on, none behind the green, a thinned left", () => {
    expect(hole.world.trees.filter((tr) => tr.z > 262 * YD && tr.x > 48 * YD).map((q) => [q.x / YD, q.z / YD].map(Math.round))).toEqual([]);
    expect(hole.world.trees.filter((tr) => tr.z > (def.pin[1] + 8) * YD)).toEqual([]);
    expect(hole.world.trees.length).toBeGreaterThan(25);
  });
});
