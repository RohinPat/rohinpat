import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CourseGame, STEP } from "@/components/offhours/golf/play";
import { CLUBS, simulate, type Surface } from "@/components/offhours/golf/flight";
import { NINE_DEFS, buildHole, type Area, type HoleDef } from "@/components/offhours/golf/course";
import { LIE_ORDER, dropFor, gorseDrop, lieFor } from "@/components/offhours/golf/lie";
import { YD } from "@/components/offhours/golf/scene";
import { forgetBest } from "@/components/offhours/golf/score";
import { stubScratchCanvas } from "./golf-headless";
import { OLD_H2 } from "./golf-old-h2";

// The area surfaces: fescue, gorse, waste and out of bounds. Their lies, what each costs, and that surfaceAt reads the
// areas of a hole in the order the HoleDef documents.

vi.setConfig({ testTimeout: 60_000 });
beforeEach(() => {
  stubScratchCanvas();
  forgetBest();
});
afterEach(() => vi.restoreAllMocks());

const PURE = { power: 1, face: 0, curve: 0, contact: 1 };
function run(g: CourseGame, until: () => boolean, max = 40) {
  const t0 = g.t;
  while (!until() && g.t - t0 < max) g.step(STEP);
  return until();
}
const box = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
/** hole 1 with these areas, hit straight with the driver from the tee */
function drive(areas: Area[]) {
  const def: HoleDef = { ...NINE_DEFS[0], areas };
  const g = new CourseGame({ seed: 5, holes: [def] });
  g.key({ key: " " }, true);
  g.wind = [0, 0];
  g.setAim(0);
  g.setClub(0);
  g.remoteSwing(PURE);
  expect(run(g, () => g.phase === "rest")).toBe(true);
  return g;
}
const carry = (sf: Surface, club: number) =>
  simulate({ club: CLUBS[club], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => "fairway", lie: lieFor(sf, club), rng: () => 0.5 }).carry;
const rollOut = (sf: Surface, speed: number) => {
  const s = simulate({ club: CLUBS[4], speed, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => sf });
  return s.total - s.carry;
};

describe("out of bounds", () => {
  it("a ball that ends out of bounds is played again from where it was struck, one stroke added", () => {
    const g = drive([{ kind: "oob", poly: box(-80, 150, 80, 330) }]);
    expect(g.shot!.surface).toBe("oob");
    expect(g.dropped).toBe(true);
    // the shot counted, and the stroke on top: the next shot is the third
    expect(g.strokes).toBe(2);
    expect(g.ball).toEqual([0, 0]);
    expect(g.hole.surfaceAt(0, 0)).toBe("fairway");
    expect(g.lie).toBe("fairway");
    expect(g.result).toBe("OUT OF BOUNDS · +1");
    expect(g.said[g.said.length - 1]).toMatch(/Out of bounds\. One stroke added\. Play it again\./);
    expect(run(g, () => g.phase === "ready")).toBe(true);
    expect(g.strokes).toBe(2);
  });
  it("dropFor: the drop is the shot's own start, from wherever that was", () => {
    const oob = (x: number, z: number) => (z > 60 ? ("oob" as const) : ("fairway" as const));
    const s = simulate({ club: CLUBS[3], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: oob, origin: [3.5, -4.25] });
    const d = dropFor(s, s.surface, () => [0, 0])!;
    expect([d.x, d.z, d.why, d.penalty]).toEqual([3.5, -4.25, "oob", 1]);
  });
  it("the stakes stand every 6 m along the boundary line, and the area is inside the hole's box", () => {
    const b = buildHole(NINE_DEFS[8]);
    const a = b.areas.find((q) => q.kind === "oob")!;
    // (hole 9's first boundary runs along the cliff top for about 100 yd: about 19 stakes at 6 m)
    expect(a.stakes.length).toBeGreaterThan(15);
    for (let i = 1; i < a.stakes.length; i++) expect(Math.hypot(a.stakes[i][0] - a.stakes[i - 1][0], a.stakes[i][1] - a.stakes[i - 1][1])).toBeLessThanOrEqual(6.01);
    for (const [x, z] of a.ring) {
      expect(x).toBeGreaterThanOrEqual(b.shape.box.x0);
      expect(z).toBeLessThanOrEqual(b.shape.box.z1);
    }
  });
});

describe("gorse", () => {
  const patch: Area[] = [{ kind: "gorse", poly: box(-12, 205, 12, 260) }];
  it("a ball that ends in gorse is unplayable: a stroke, and a drop beside it, clear of the gorse and no nearer the hole", () => {
    const g = drive(patch);
    expect(g.shot!.surface).toBe("gorse");
    expect(g.dropped).toBe(true);
    expect(g.strokes).toBe(2);
    expect(g.result).toBe("IN THE GORSE · +1");
    expect(g.said[g.said.length - 1]).toMatch(/In the gorse\. Unplayable\. One stroke added\. Dropping\./);
    const sf = g.hole.surfaceAt;
    expect(["fairway", "rough"]).toContain(sf(g.ball[0], g.ball[1]));
    const e = g.shot!;
    const end: [number, number] = [e.ox + e.pts[(e.n - 1) * 4 + 1], e.oz + e.pts[(e.n - 1) * 4 + 3]];
    expect(g.hole.toPin(g.ball[0], g.ball[1])).toBeGreaterThanOrEqual(g.hole.toPin(end[0], end[1]) - 1e-9);
    // not hard against the bush
    for (let a = 0; a < 8; a++) expect(sf(g.ball[0] + Math.cos(a) * 1.4, g.ball[1] + Math.sin(a) * 1.4)).not.toBe("gorse");
    expect(Math.hypot(g.ball[0] - end[0], g.ball[1] - end[1])).toBeLessThan(25);
  });
  it("gorseDrop: from many starts, never nearer the pin, never in gorse, and the same every time", () => {
    const b = buildHole({ ...NINE_DEFS[0], areas: patch });
    for (const [x, z] of [[0, 230], [-8, 215], [10, 250], [3, 240]].map(([px, pz]) => [px * YD, pz * YD])) {
      const d = gorseDrop(b.surfaceAt, x, z, b.pin)!;
      expect(d).not.toBeNull();
      expect(b.surfaceAt(d.x, d.z)).not.toBe("gorse");
      expect(b.toPin(d.x, d.z)).toBeGreaterThanOrEqual(b.toPin(x, z) - 1e-9);
      expect(gorseDrop(b.surfaceAt, x, z, b.pin)).toEqual(d);
    }
  });
  it("a ball is never dropped into water or out of bounds", () => {
    const sf = (x: number, z: number): Surface => (Math.abs(x) < 3 && Math.abs(z) < 3 ? "gorse" : x > 0 ? "oob" : x < -2 ? "water" : "rough");
    const d = gorseDrop(sf, 0, 0, [0, 100])!;
    expect(sf(d.x, d.z)).toBe("rough");
  });
});

describe("fescue", () => {
  it("is played as it lies, harsher than the rough: slower, little check, a poor strike, a wandering face", () => {
    const f = lieFor("fescue", 3)!, r = lieFor("rough", 3)!;
    expect([f.speed, f.spin, f.contactCap, f.faceNoise]).toEqual([0.78, 0.4, 0.75, 0.14]);
    expect(f.speed!).toBeLessThan(r.speed!);
    expect(f.spin!).toBeLessThan(r.spin!);
    expect(f.contactCap!).toBeLessThan(r.contactCap!);
    expect(f.faceNoise!).toBeGreaterThan(r.faceNoise!);
    const s = simulate({ club: CLUBS[3], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => "fescue", lie: f, rng: () => 0.5 });
    expect(dropFor(s, s.surface, () => [0, 0])).toBeNull();
    for (const c of [1, 2, 3, 4]) expect(carry("fescue", c)).toBeLessThan(carry("rough", c));
  });
  it("the ball stops quicker in it than in the rough", () => {
    expect(rollOut("fescue", 0.8)).toBeLessThan(rollOut("rough", 0.8));
  });
});

describe("waste", () => {
  it("is played as it lies: no drop, no stroke", () => {
    const g = drive([{ kind: "waste", poly: box(-60, 200, 60, 300) }]);
    expect(g.shot!.surface).toBe("waste");
    expect(g.dropped).toBe(false);
    expect(g.strokes).toBe(1);
    expect(g.lie).toBe("waste");
    expect(g.result).toMatch(/^WASTE AREA/);
    expect(run(g, () => g.phase === "ready")).toBe(true);
  });
  it("its lie costs a little: the strike is capped, the face wanders a little, the spin is cut", () => {
    const w = lieFor("waste", 2)!;
    expect([w.speed, w.spin, w.contactCap, w.faceNoise]).toEqual([0.8, 0.7, 0.8, 0.06]);
    for (let c = 0; c < CLUBS.length - 1; c++) {
      expect(carry("waste", c)).toBeLessThan(carry("rough", c));
      expect(carry("waste", c)).toBeGreaterThan(carry("bunker", c));
    }
  });
  it("it is firm: the ball runs on less than from the fairway and more than from a bunker", () => {
    expect(rollOut("waste", 0.9)).toBeLessThan(rollOut("fairway", 0.9));
    expect(rollOut("waste", 0.9)).toBeGreaterThan(rollOut("bunker", 0.9));
  });
});

describe("the lie order and surfaceAt", () => {
  it("the order is fairway, fringe, rough, waste, fescue, bunker", () => {
    expect(LIE_ORDER).toEqual(["fairway", "fringe", "rough", "waste", "fescue", "bunker"]);
  });
  it("the demonstrations: fescue on 1, waste on 5, gorse on 7, out of bounds on 9, each read by surfaceAt", () => {
    for (const [n, kind] of [[1, "fescue"], [5, "waste"], [7, "gorse"], [9, "oob"]] as const) {
      const b = buildHole(NINE_DEFS[n - 1]);
      const a = b.areas.find((q) => q.kind === kind)!;
      expect(a, `${n} ${kind}`).toBeTruthy();
      let hit = 0;
      for (let i = 0; i < 400; i++) {
        const xs = a.ring.map((p) => p[0]), zs = a.ring.map((p) => p[1]);
        const x = Math.min(...xs) + ((i * 37) % 100) / 100 * (Math.max(...xs) - Math.min(...xs));
        const z = Math.min(...zs) + ((i * 61) % 100) / 100 * (Math.max(...zs) - Math.min(...zs));
        if (b.surfaceAt(x, z) === kind) hit++;
      }
      expect(hit, `${n} ${kind}`).toBeGreaterThan(30);
    }
  });
  it("precedence: water, out of bounds, the green and bunkers, then gorse, waste, fescue, then the fairway", () => {
    const base = OLD_H2; // the old hole 2: a green, a bunker and a pond (today's is a carry over a tarn)
    const all = (k: Area["kind"]): Area => ({ kind: k, poly: box(-80, 0, 80, 260) });
    const b = buildHole({ ...base, areas: [all("fescue"), all("waste"), all("gorse")] });
    expect(b.surfaceAt(0, 40 * YD)).toBe("gorse");
    expect(buildHole({ ...base, areas: [all("fescue"), all("waste")] }).surfaceAt(0, 40 * YD)).toBe("waste");
    expect(buildHole({ ...base, areas: [all("fescue")] }).surfaceAt(0, 40 * YD)).toBe("fescue");
    // the green and a bunker are never swallowed
    expect(b.surfaceAt(base.green.c[0] * YD, base.green.c[1] * YD)).toBe("green");
    expect(b.surfaceAt(base.bunkers[0].x * YD, base.bunkers[0].z * YD)).toBe("bunker");
    // the pond beats everything, and out of bounds beats the rest
    const pond = base.water[0] as { x: number; z: number };
    expect(buildHole({ ...base, areas: [all("oob")] }).surfaceAt(pond.x * YD, pond.z * YD)).toBe("water");
    const o = buildHole({ ...base, areas: [all("gorse"), all("oob")] });
    expect(o.surfaceAt(0, 40 * YD)).toBe("oob");
  });
  it("is deterministic: the same hole gives the same surfaces, and the same shot the same end", () => {
    const sample = () => {
      const out: string[] = [];
      for (const n of [1, 5, 7, 9]) {
        const b = buildHole({ ...NINE_DEFS[n - 1] });
        for (let z = 0; z < 420; z += 7) for (let x = -120; x < 80; x += 7) out.push(b.surfaceAt(x, z));
      }
      return out.join("");
    };
    expect(sample()).toBe(sample());
    const a = drive([{ kind: "gorse", poly: box(-12, 205, 12, 260) }]), b = drive([{ kind: "gorse", poly: box(-12, 205, 12, 260) }]);
    expect(a.ball).toEqual(b.ball);
  });
  it("no area comes near a green on any hole", () => {
    for (const d of NINE_DEFS) {
      const b = buildHole(d);
      for (const a of b.areas) {
        const cx = d.green.c[0] * YD, cz = d.green.c[1] * YD;
        for (const [x, z] of a.ring) expect(Math.hypot(x - cx, z - cz), `${d.n} ${a.kind}`).toBeGreaterThan(14);
      }
    }
  });
});
