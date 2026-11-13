import { describe, expect, it, vi } from "vitest";
import { CLUBS, STEEP_REST, simulate } from "@/components/offhours/golf/flight";
import { HOLE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { compileFeatures, type Feature } from "@/components/offhours/golf/features";
import { CourseGame, STEP } from "@/components/offhours/golf/play";
import { dropFor, waterWithin } from "@/components/offhours/golf/lie";
import { YD } from "@/components/offhours/golf/scene";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { BOTS, playRound } from "./golf-bots";
import { stubScratchCanvas } from "./golf-headless";

vi.setConfig({ testTimeout: 90_000 });

// Cliffs (features.ts `cliff`), the steep-ground rule (flight.ts E5), drop zones (HoleDef.drops) and hole 2, which uses all three.

const ring: [number, number][] = [[0, 20], [20, 0], [0, -20], [-20, 0]];
const cliff: Feature[] = [{ k: "cliff", path: ring, closed: true, drop: 30, run: 3, talus: 10 }];

describe("a cliff feature", () => {
  const fy = (x: number, z: number) => compileFeatures(cliff, []).y(x * YD, z * YD);
  it("is level on the high side, falls its whole drop in a few yards, and stays down", () => {
    expect(fy(0, 0)).toBe(0);
    expect(fy(0, 19)).toBe(0);
    expect(fy(0, 30)).toBeLessThan(-25);
    expect(fy(0, 20 + 20)).toBeCloseTo(-30, 3);
    expect(fy(100, 100)).toBeCloseTo(-30, 3);
  });
  it("calls the face rock, and holds the ground against a lake's levelling", () => {
    const c = compileFeatures(cliff, []);
    expect(c.rock(0, 21 * YD)).toBe(true);
    expect(c.rock(0, 5 * YD)).toBe(false);
    expect(c.rock(0, 60 * YD)).toBe(false);
    expect(c.held(0, 40 * YD)).toBe(1);
    expect(c.held(0, 5 * YD)).toBe(0);
    expect(c.cliffs).toHaveLength(1);
  });
  it("an open cliff fades out past its ends", () => {
    const open: Feature[] = [{ k: "cliff", path: [[-30, 0], [30, 0]], drop: 20, fade: 10 }];
    const c = compileFeatures(open, []);
    expect(c.y(0, 5 * YD)).toBeLessThan(-17);
    expect(c.y(0, -5 * YD)).toBe(0);
    expect(c.y(80 * YD, 5 * YD)).toBe(0);
  });
});

describe("hole 2's ground", () => {
  const h = buildHole(HOLE_DEFS[1]);
  const t = terrainOf(h);
  it("every point steeper than 0.6 is the rock face; the scree and everything else is walkable", () => {
    const b = h.shape.box;
    for (let z = b.z0 - 30; z <= b.z1 + 30; z += 1.1)
      for (let x = b.x0 - 30; x <= b.x1 + 30; x += 1.1) {
        const [sx, sz] = t.slope(x, z);
        const m = Math.hypot(sx, sz);
        if (m <= 0.6) {
          // (the banks of the tarn are steep, but they are water a moment later)
          if (m >= STEEP_REST && waterWithin(h.surfaceAt, x, z, 2.5) === null) expect.fail(`${x.toFixed(1)}, ${z.toFixed(1)} slope ${m.toFixed(2)}`);
          continue;
        }
        if (waterWithin(h.surfaceAt, x, z, 2.5) !== null) continue;
        expect(t.fx.rock(x, z), `${x.toFixed(1)}, ${z.toFixed(1)} slope ${m.toFixed(2)}`).toBe(true);
      }
  });
  it("a ball that lands on the face, or rolls off the ledge, ends in the tarn, on dry ground or on a drop, never at rest on the face", () => {
    let wet = 0, steep = 0;
    for (const club of [3, 5])
      for (const sp of [0.28, 0.3, 0.32, 0.35, 0.4, 0.45])
        for (const yaw of [-0.6, -0.3, 0, 0.3, 0.6, 1.2, 2.4, 3.14]) {
          const s = simulate({ club: CLUBS[club], speed: sp, yaw, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: h.surfaceAt, ground: t });
          expect(s.restT, `${club} ${sp} ${yaw}`).toBeLessThan(28);
          const end = [s.pts[(s.n - 1) * 4 + 1], s.pts[(s.n - 1) * 4 + 3]];
          const rest = t.fx.rock(end[0], end[1]);
          // at rest on the rock only if it was called unplayable
          if (rest) expect(s.steep).toBe(true);
          if (s.surface === "water") wet++;
          if (s.steep) {
            steep++;
            const d = dropFor(s, s.surface, h.edgeDrop, h.surfaceAt, h.pin, h.drops, (x, z) => Math.hypot(...t.slope(x, z)) < 0.3)!;
            expect(d.why).toBe("steep");
            expect(t.fx.rock(d.x, d.z)).toBe(false);
          }
        }
    expect(wet).toBeGreaterThan(0);
    void steep;
  });
  it("a ball dropped off the brink falls to the foot", () => {
    // a putter-speed ball over the front brink (hole 2: 19.5 yd out)
    const s = simulate({ club: CLUBS[5], speed: 0.3, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: h.surfaceAt, ground: t, origin: [0, 14.5 * YD] });
    expect(s.pts[(s.n - 1) * 4 + 2] + s.oy).toBeLessThan(-20);
    expect(s.restT).toBeLessThan(28);
  });
});

describe("drop zones", () => {
  it("a ball in the tarn is dropped on the bench for a stroke, whatever way it went in", () => {
    stubScratchCanvas();
    for (const aim of [-0.3, 0, 0.12]) {
      const g = new CourseGame({ seed: 5, hills: true, holes: [HOLE_DEFS[1]] });
      g.key({ key: " " }, true);
      g.wind = [0, 0];
      g.setAim(aim);
      g.setClub(4);
      g.remoteSwing({ power: 0.6, face: 0, curve: 0, contact: 1 });
      for (let i = 0; i < 4000 && g.phase !== "rest"; i++) g.step(STEP);
      expect(g.shot!.surface).toBe("water");
      expect(g.strokes).toBe(2);
      expect(g.result).toBe("WATER · +1");
      expect(g.ball[0] / YD).toBeCloseTo(HOLE_DEFS[1].drops![0][0], 5);
      expect(g.ball[1] / YD).toBeCloseTo(HOLE_DEFS[1].drops![0][1], 5);
    }
  });
});

describe("the bots on hole 2", () => {
  it("every bot finishes it, and the skilled ones stay near par", () => {
    stubScratchCanvas();
    const rs = (name: string) => Array.from({ length: 12 }, (_, i) => playRound(BOTS[name], i + 1, { game: { hills: true, holes: [HOLE_DEFS[1]] }, maxSeconds: 400 }));
    for (const name of ["skilled", "casual", "keyboard", "oneButton"]) expect(rs(name).every((r) => r.finished), name).toBe(true);
    const k = rs("keyboard").reduce((a, r) => a + r.total, 0) / 12;
    expect(k).toBeGreaterThanOrEqual(3);
    expect(k).toBeLessThanOrEqual(5);
  });
});
