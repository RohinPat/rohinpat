import { describe, expect, it } from "vitest";
import { BRIDGE, ROCK_L, ROCK_R, TUNNEL, buildRoad, getRoad } from "@/components/offhours/night/road";
import { BOULDER, HOUSE, LAMP, NONE, PINE, buildScenery, getScenery, hash, stretchAt } from "@/components/offhours/night/scenery";
import { stripGeom } from "@/components/offhours/night/stripScene";

// Cars, third pass: the world is laid out from the road and a seed of its own.
// What is pinned here is what can go wrong without anyone looking: a tree on the
// road, a lamp in the tunnel, a landmark missing before a gate, a wall that hides
// the sky at the start, and a different road for the next visitor.

describe("cars: the roadside", () => {
  const road = getRoad();
  const sc = getScenery(road);
  const seg = road.segM;

  it("is the same every time, and leaves the road alone", () => {
    const again = buildScenery(road);
    expect(Array.from(again.kind.slice(0, 2000))).toEqual(Array.from(sc.kind.slice(0, 2000)));
    expect(Array.from(again.rockTop.slice(0, 400))).toEqual(Array.from(sc.rockTop.slice(0, 400)));
    expect(again.landmarks).toEqual(sc.landmarks);
    // the road is the road: the same flags and the same length whatever the scenery did
    const fresh = buildRoad();
    expect(fresh.n).toBe(road.n);
    expect(Array.from(fresh.flags.slice(0, 600))).toEqual(Array.from(road.flags.slice(0, 600)));
    expect(getScenery(road)).toBe(sc);
  });

  it("hashes into 0..1 and does not repeat itself", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const h = hash(i, 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      seen.add(h);
    }
    expect(seen.size).toBeGreaterThan(490);
  });

  it("puts nothing where a cliff stands, and nothing in the tunnel or on the bridge but the bridge's own", () => {
    let trees = 0;
    let houses = 0;
    let lamps = 0;
    let boulders = 0;
    for (let i = 0; i < road.n; i++) {
      const f = road.flags[i];
      for (let slot = 0; slot < 4; slot++) {
        const k = sc.kind[i * 4 + slot];
        if (k === NONE) continue;
        expect(f & (TUNNEL | BRIDGE)).toBe(0);
        expect(f & (slot < 2 ? ROCK_L : ROCK_R)).toBe(0);
        if (k === PINE) trees++;
        if (k === HOUSE) houses++;
        if (k === LAMP) lamps++;
        if (k === BOULDER) boulders++;
      }
    }
    // a road with a roadside: pines, a few houses, boulders, lamps
    expect(trees).toBeGreaterThan(200);
    expect(houses).toBeGreaterThan(5);
    expect(boulders).toBeGreaterThan(20);
    expect(lamps).toBeGreaterThan(40);
  });

  it("keeps trees and boulders clear of the rail, and the pines thickest in the pines", () => {
    const perStretch = new Array(8).fill(0);
    for (let i = 0; i < road.n; i++) {
      for (let slot = 0; slot < 4; slot++) {
        const k = sc.kind[i * 4 + slot];
        if (k === PINE || k === BOULDER) expect(sc.out[i * 4 + slot] / 4).toBeGreaterThanOrEqual(1.2);
        if (k === PINE) perStretch[stretchAt(road, i * seg)]++;
      }
    }
    expect(perStretch[1]).toBe(Math.max(...perStretch));
    expect(perStretch[3]).toBeLessThan(perStretch[1] / 4);
  });

  it("has lamps at the start and the finish, and light round every gate", () => {
    const lampsIn = (a: number, b: number) => {
      let n = 0;
      for (let i = Math.max(0, Math.floor(a / seg)); i < Math.min(road.n, Math.ceil(b / seg)); i++) for (let s = 0; s < 4; s++) if (sc.kind[i * 4 + s] === LAMP) n++;
      return n;
    };
    expect(lampsIn(0, 300)).toBeGreaterThan(3);
    expect(lampsIn(road.finish - 100, road.length)).toBeGreaterThan(3);
    // (a gate between two cliffs has no ground for them: the stretch round it, 250 m, has some)
    for (const g of road.checks) expect(lampsIn(g - 200, g + 120)).toBeGreaterThan(0);
  });

  it("has a landmark before every gate, and one at the start", () => {
    for (let k = 1; k <= road.checks.length; k++) {
      const g = road.checks[k - 1];
      expect(sc.landmarks.some((l) => l.s <= g && l.s >= g - 450)).toBe(true);
    }
    expect(sc.landmarks.some((l) => l.s < 140)).toBe(true);
    // never in front of a cliff (a mast in a gorge stands on the cliff top: it is the one thing that may)
    for (const l of sc.landmarks) {
      const f = road.flags[Math.max(0, Math.min(road.n - 1, Math.round(l.s / seg)))];
      if (l.kind === "mast" || l.kind === "flood") continue;
      expect(f & (l.side < 0 ? ROCK_L : ROCK_R)).toBe(0);
      expect(f & (TUNNEL | BRIDGE)).toBe(l.kind === "towers" ? BRIDGE : 0);
    }
  });

  it("finds the tunnel and the bridge where the road's flags say", () => {
    expect(sc.tunnel).not.toBeNull();
    expect(sc.bridge).not.toBeNull();
    const [t0, t1] = sc.tunnel!;
    expect(road.flags[Math.floor((t0 + t1) / 2 / seg)] & TUNNEL).toBeTruthy();
    expect(t1 - t0).toBeGreaterThan(150);
    const [b0, b1] = sc.bridge!;
    expect(road.flags[Math.floor((b0 + b1) / 2 / seg)] & BRIDGE).toBeTruthy();
    // the towers stand over the middle of the deck
    const towers = sc.landmarks.find((l) => l.kind === "towers");
    expect(towers).toBeDefined();
    expect(towers!.s).toBeGreaterThan(b0);
    expect(towers!.s).toBeLessThan(b1);
  });

  it("keeps the cliff ragged and, near the start, low enough to leave the sky", () => {
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i <= road.n; i++) {
      lo = Math.min(lo, sc.rockTop[i]);
      hi = Math.max(hi, sc.rockTop[i]);
      expect(sc.rockOut[i]).toBeGreaterThan(5);
      expect(sc.rockShade[i]).toBeLessThan(4);
    }
    expect(lo).toBeGreaterThanOrEqual(4);
    expect(hi).toBeLessThan(40);
    expect(hi - lo).toBeGreaterThan(10);
    const start = Math.max(...Array.from(sc.rockTop.slice(0, Math.round(100 / seg))));
    const elsewhere = Math.max(...Array.from(sc.rockTop.slice(Math.round(1500 / seg), Math.round(2300 / seg))));
    expect(start).toBeLessThan(elsewhere);
  });
});

describe("cars: the strip's place", () => {
  it("lays the wall above the lanes and the line before the finish at every size the game is drawn", () => {
    for (const [w, h] of [[1440, 755], [1200, 640], [390, 640], [320, 480]] as const) {
      for (const play of [true, false]) {
        const g = stripGeom(w, h, play);
        expect(g.wallY).toBeLessThan(g.ry);
        expect(g.wallY).toBeGreaterThan(h * 0.3);
        expect(g.ry + g.roadH).toBeCloseTo(h, 5);
        expect(g.x0).toBeGreaterThan(g.carLen);
        expect(g.x1).toBeGreaterThan(g.x0 + 80);
        expect(g.lanes).toBe(play ? 2 : 1);
        expect(g.laneH * g.lanes).toBeCloseTo(g.roadH, 5);
      }
    }
  });
});
