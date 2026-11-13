import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUBS, simulate } from "@/components/offhours/golf/flight";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { CourseGame } from "@/components/offhours/golf/play";
import { DROP_CLEAR, dropFor, waterWithin } from "@/components/offhours/golf/lie";
import { YD } from "@/components/offhours/golf/scene";
import { solidsOf } from "@/components/offhours/golf/solids";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { forgetBest } from "@/components/offhours/golf/score";
import { stubScratchCanvas } from "./golf-headless";
import { BOTS, Player } from "./golf-bots";

vi.setConfig({ testTimeout: 60_000 });

// Hole 8, Long Water: a par 5 that climbs to a green on an island in a lake, a footbridge behind it. Go for it with a driver,
// or lay up on the left bank and pitch over the water. Water on every side of the green costs a stroke and a drop on the bank.

beforeEach(() => {
  stubScratchCanvas();
  forgetBest();
});
afterEach(() => vi.unstubAllGlobals());

const def = NINE_DEFS.find((d) => d.n === 8)!;
const hole = buildHole(def);
const ground = terrainOf(hole);
const [PX, PZ] = def.pin;

/** a shot from (x, z) yd, aimed at the pin plus `off` degrees, with no wind and a pure strike */
const shoot = (x: number, z: number, club: number, speed: number, off = 0) =>
  simulate({
    club: CLUBS[club],
    speed,
    yaw: Math.atan2(PX - x, PZ - z) + (off * Math.PI) / 180,
    face: 0,
    curve: 0,
    contact: 1,
    wind: [0, 0],
    surfaceAt: hole.surfaceAt,
    trees: hole.blockers,
    ground,
    origin: [x * YD, z * YD],
  });

describe("hole 8: the island green", () => {
  it("climbs from the tee to a green about 18 m up, on a plateau with the lake level on it", () => {
    expect(ground.y(def.pin[0] * YD, def.pin[1] * YD) - ground.y(0, 0)).toBeGreaterThan(16);
    expect(ground.y(def.pin[0] * YD, def.pin[1] * YD) - ground.y(0, 0)).toBeLessThan(20);
    // the water lies a little under the ground round the island, and the green stands over it
    const wy = ground.waterY(70 * YD, 400 * YD);
    expect(ground.y(def.pin[0] * YD, def.pin[1] * YD)).toBeGreaterThan(wy + 1);
  });

  it("the pin is on a green with water on every side: a ray from the flag meets the lake within 45 yd in every direction", () => {
    expect(hole.surfaceAt(PX * YD, PZ * YD)).toBe("green");
    for (let a = 0; a < 360; a += 10) {
      const t = (a * Math.PI) / 180;
      let wet = -1;
      for (let d = 0; d <= 45; d += 0.5) if (hole.surfaceAt((PX + Math.sin(t) * d) * YD, (PZ + Math.cos(t) * d) * YD) === "water") { wet = d; break; }
      expect(wet, `${a} deg`).toBeGreaterThan(10);
    }
  });

  it("a footbridge crosses the channel on the green's west side, from dry ground to dry ground, over water", () => {
    const br = def.props!.find((p) => p.kind === "bridge")!;
    if (br.kind !== "bridge") throw new Error("not a bridge");
    const sf = (x: number, z: number) => hole.surfaceAt(x * YD, z * YD);
    expect(["fairway", "rough"]).toContain(sf(...br.a));
    expect(["fairway", "rough", "fringe", "green"]).toContain(sf(...br.b));
    let wet = 0;
    for (let k = 0.1; k < 0.9; k += 0.05) if (sf(br.a[0] + (br.b[0] - br.a[0]) * k, br.a[1] + (br.b[1] - br.a[1]) * k) === "water") wet++;
    expect(wet).toBeGreaterThanOrEqual(5);
    // it is a prop to look at, with rails that stop a ball
    expect(solidsOf(def.props, ground).length).toBeGreaterThan(0);
  });

  it("no tree stands in the lake, and the right side is open to the bay", () => {
    for (const t of hole.world.trees) expect(hole.surfaceAt(t.x, t.z)).not.toBe("water");
    expect(hole.world.trees.filter((t) => t.x > 24 * YD)).toHaveLength(0);
  });
});

describe("hole 8: the choice", () => {
  // the drive is about 240 yd (a driver up the climb, into a light crosswind); from there the island is 235 yd across the water
  const from: [number, number] = [6, 244];

  it("brave: a driver at 95 to 100% on a true line lands on the island; a 3 wood at full power is short, in the lake", () => {
    for (const sp of [0.95, 1]) {
      const s = shoot(...from, 0, sp);
      expect(["green", "fringe", "fairway", "rough"], `driver ${sp}`).toContain(s.surface);
      expect(s.carry).toBeGreaterThan(215);
    }
    const w = shoot(...from, 1, 1);
    expect(w.surface).toBe("water");
    // under 90% a driver is in the water too, and so is a pull or a push of 8 degrees
    expect(shoot(...from, 0, 0.88).surface).toBe("water");
    for (const off of [-8, 8]) expect(shoot(...from, 0, 1, off).surface).toBe("water");
  });

  it("safe: lay up to the left bank, then a 7 iron or a wedge pitches onto the island", () => {
    const bank: [number, number] = [-14, 390];
    expect(["fairway", "rough"]).toContain(hole.surfaceAt(bank[0] * YD, bank[1] * YD));
    expect(Math.hypot(PX - bank[0], PZ - bank[1])).toBeLessThan(115);
    expect(["green", "fringe"]).toContain(shoot(...bank, 3, 0.8).surface);
    expect(["green", "fringe"]).toContain(shoot(...bank, 4, 0.9).surface);
    // a lay-up that is short of the water is dry
    expect(shoot(0, 0, 0, 1).surface).toBe("fairway");
  });

  it("a ball in the lake is one stroke and a drop on the lay-up bank, dry, a short pitch from the island", () => {
    const tries = [shoot(...from, 1, 1), shoot(...from, 0, 0.88), shoot(-14, 390, 1, 1), shoot(-14, 390, 4, 1.05, 3)];
    let seen = 0;
    for (const s of tries) {
      if (s.surface !== "water") continue;
      seen++;
      const d = dropFor(s, s.surface, hole.edgeDrop, hole.surfaceAt, hole.pin, hole.drops)!;
      expect(d.why).toBe("water");
      expect(d.penalty).toBe(1);
      expect(["fairway", "rough"]).toContain(hole.surfaceAt(d.x, d.z));
      expect(waterWithin(hole.surfaceAt, d.x, d.z, DROP_CLEAR)).toBeNull();
      expect(Math.hypot(hole.pin[0] - d.x, hole.pin[1] - d.z) / YD).toBeLessThan(115);
      expect(Math.hypot(hole.pin[0] - d.x, hole.pin[1] - d.z) / YD).toBeGreaterThan(80);
    }
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  it("a ball in the woods is dropped within 100 yd of where it went in, on the fairway or rough", () => {
    // (the drop zones run the length of the fairway, so a stray drive does not skip ahead to the lake)
    let seen = 0;
    for (const yaw of [-0.5, -0.35, 0.45]) {
      const s = simulate({ club: CLUBS[0], speed: 1, yaw, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: hole.surfaceAt, ground });
      if (s.surface !== "out") continue;
      seen++;
      const d = dropFor(s, s.surface, hole.edgeDrop, hole.surfaceAt, hole.pin, hole.drops)!;
      const ez = s.oz + s.pts[(s.n - 1) * 4 + 3];
      expect(Math.abs(d.z - ez) / YD).toBeLessThan(100);
      expect(["fairway", "rough"]).toContain(hole.surfaceAt(d.x, d.z));
    }
    expect(seen).toBeGreaterThanOrEqual(1);
    for (const q of hole.drops) expect(["fairway", "rough"]).toContain(hole.surfaceAt(q[0], q[1]));
  });
});

describe("hole 8: the bots finish it", () => {
  const play = (bot: (typeof BOTS)[string], seed: number) => {
    const g = new CourseGame({ seed, holes: [def] });
    const p = new Player(g, bot, seed);
    while (!g.finished && g.t < 1500) p.tick();
    return g;
  };
  it("the skilled player, the casual one and the keyboard finish within a stroke of par plus 4", () => {
    for (const name of ["skilled", "casual", "keyboard"]) for (let seed = 1; seed <= 8; seed++) {
      const g = play(BOTS[name], seed);
      expect(g.finished, `${name} ${seed}`).toBe(true);
      expect(g.scores[0].strokes, `${name} ${seed}`).toBeLessThanOrEqual(def.par + 5);
    }
  });
  it("one button never loops: it is picked up at par + 5 at the worst", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const g = play(BOTS.oneButton, seed);
      expect(g.finished, `seed ${seed}`).toBe(true);
      expect(g.scores[0].strokes).toBeLessThanOrEqual(def.par + 5);
    }
  });
  it("a skilled player averages about a par and a bit on it", () => {
    const rs = Array.from({ length: 24 }, (_, i) => play(BOTS.skilled, i + 1).scores[0].strokes);
    const m = rs.reduce((a, b) => a + b, 0) / rs.length;
    expect(m).toBeGreaterThanOrEqual(4.8);
    expect(m).toBeLessThanOrEqual(6.8);
  });
});
