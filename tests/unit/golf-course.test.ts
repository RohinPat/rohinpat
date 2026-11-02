import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLUBS, simulate } from "@/components/offhours/golf/flight";
import { HOLE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { GH, GW, zone } from "@/components/offhours/golf/green";
import { DROP_CLEAR, LIE_ORDER, dropFor, lieFor, waterWithin } from "@/components/offhours/golf/lie";
import { YD } from "@/components/offhours/golf/scene";
import { PICK_UP_OVER, bestRound, forgetBest, holeScore, overUnder, recordRound, shouldPickUp, toPar } from "@/components/offhours/golf/score";

// The course's data, the lie table and the scoring: no screen, no clock.

describe("course data", () => {
  for (const def of HOLE_DEFS) {
    const b = buildHole(def);
    describe(`hole ${def.n}, ${def.name}`, () => {
      it("tee to pin is the yardage it is sold at, within 5 yards", () => {
        const yd = Math.hypot(b.pin[0], b.pin[1]) / YD;
        expect(Math.abs(yd - def.yards)).toBeLessThanOrEqual(5);
      });
      it("the pin is on the green, well inside its edge", () => {
        expect(b.surfaceAt(b.pin[0], b.pin[1])).toBe("green");
        const [gx, gy] = b.toGreen(b.pin[0], b.pin[1]);
        expect(zone(b.green, gx, gy)).toBe(0);
        expect(Math.hypot((gx - GW / 2) / (GW / 2), (gy - GH / 2) / (GH / 2))).toBeLessThan(0.8);
        expect([gx, gy]).toEqual(b.green.cup);
      });
      it("the aim for the tee shot is on the fairway (a par 3 aims at the green)", () => {
        const sf = b.surfaceAt(b.landing[0], b.landing[1]);
        expect(def.par === 3 ? ["green", "fringe"] : ["fairway"]).toContain(sf);
      });
      it("the tee is mown, with no sand or water near it", () => {
        expect(b.surfaceAt(0, 0)).toBe("fairway");
        for (const blob of [...def.bunkers, ...def.water]) expect(Math.hypot(blob.x, blob.z)).toBeGreaterThan(60);
      });
      it("the line from tee to green is fairway all the way (no pond across it)", () => {
        // both holes run straight down z
        const lz = def.line[def.line.length - 1][1];
        for (let z = 0; z < (lz - 12) * YD; z += 2) expect(["fairway", "fringe", "green"], `z ${(z / YD).toFixed(0)} yd`).toContain(b.surfaceAt(0, z));
      });
      it("every hazard is where it says it is", () => {
        for (const w of def.water) expect(b.surfaceAt(w.x * YD, w.z * YD)).toBe("water");
        for (const s of def.bunkers) expect(b.surfaceAt(s.x * YD, s.z * YD)).toBe("bunker");
        expect(b.world.water).toHaveLength(def.water.length);
        expect(b.world.sand).toHaveLength(def.bunkers.length);
      });
      it("beyond the rough is the woods", () => {
        expect(b.surfaceAt(60 * YD, 100 * YD)).toBe("out");
        expect(b.surfaceAt(-60 * YD, 100 * YD)).toBe("out");
        expect(b.surfaceAt(0, 600 * YD)).toBe("out");
      });
      it("a ball in the woods is dropped on ground in play, a little inside the edge", () => {
        for (const side of [-1, 1]) {
          const [dx, dz] = b.edgeDrop(side * 70 * YD, 60 * YD);
          expect(["fairway", "rough"]).toContain(b.surfaceAt(dx, dz));
          expect(Math.abs(dx)).toBeLessThan(70 * YD);
        }
      });
      it("the green maps to and from the putting view", () => {
        const [x, z] = [b.pin[0] + 1.5, b.pin[1] - 2];
        const [gx, gy] = b.toGreen(x, z);
        const [x2, z2] = b.fromGreen(gx, gy);
        expect([x2, z2].map((v) => +v.toFixed(9))).toEqual([x, z].map((v) => +v.toFixed(9)));
        // downrange is up the screen: further from the tee is a smaller y
        expect(b.toGreen(x, z + 1)[1]).toBeLessThan(gy);
        expect(b.toGreen(x + 1, z)[0]).toBeGreaterThan(gx);
      });
      it("draws no range scenery: no range boards, no target greens, one green with no target rings", () => {
        expect(b.world.boards).toEqual([]);
        expect(b.world.greens).toHaveLength(1);
        expect(b.world.greens[0].plain).toBe(true);
        expect(b.world.flagMin).toBeGreaterThanOrEqual(30);
      });
      it("yardage markers are 100, 150 and 200 yd from the middle of the green, on the edge of the fairway, clear of every hazard", () => {
        const cz = def.green.c[1];
        for (const m of b.world.markers ?? []) {
          const d = Number(m.label);
          expect([100, 150, 200]).toContain(d);
          expect(m.z / YD).toBeCloseTo(cz - d, 6);
          expect(["fairway", "rough"]).toContain(b.surfaceAt(m.x, m.z));
          expect(waterWithin(b.surfaceAt, m.x, m.z, 3)).toBeNull();
          for (let a = 0; a < 12; a++) for (const r of [1, 2.5]) expect(["bunker", "water", "out"]).not.toContain(b.surfaceAt(m.x + Math.cos(a) * r, m.z + Math.sin(a) * r));
          // on the edge of the fairway: past it, not far out
          expect(Math.abs(m.x)).toBeGreaterThan(b.fairHalfAt(m.z));
          expect(Math.abs(m.x)).toBeLessThan(b.fairHalfAt(m.z) + 6);
        }
        // hole 1 has them (a 340 yd hole; the left-hand 100 would stand in the bunker, so it is left out), hole 2 has the 100 only
        expect((b.world.markers ?? []).map((m) => m.label).sort()).toEqual(def.n === 1 ? ["100", "150", "150", "200", "200"] : ["100", "100"]);
      });
      it("the wind is the same every time", () => {
        expect(buildHole(def).wind).toEqual(b.wind);
        expect(Math.hypot(...b.wind)).toBeCloseTo(def.wind.speed, 9);
      });
    });
  }

  it("holes are numbered in order, with the par and the yards the plan says", () => {
    expect(HOLE_DEFS.map((d) => [d.n, d.name, d.par, d.yards])).toEqual([
      [1, "Open Door", 4, 340],
      [2, "Short Straw", 3, 135],
    ]);
  });
  it("hole 2 has water short and left of the green, sand to the right, and a crosswind", () => {
    const d = HOLE_DEFS[1];
    expect(d.water[0].x).toBeLessThan(0);
    expect(d.water[0].z).toBeLessThan(d.pin[1]);
    expect(d.bunkers[0].x).toBeGreaterThan(0);
    const b = buildHole(d);
    expect(Math.abs(b.wind[0])).toBeGreaterThan(Math.abs(b.wind[1]) * 5);
  });
});

describe("the lie table", () => {
  const carry = (sf: Parameters<typeof lieFor>[0], club: number) =>
    simulate({ club: CLUBS[club], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => "fairway", lie: lieFor(sf, club), rng: () => 0.5 }).carry;

  it("a worse lie never carries further, club for club: fairway, fringe, rough, bunker", () => {
    for (let c = 0; c < CLUBS.length - 1; c++) {
      const row = LIE_ORDER.map((sf) => carry(sf, c));
      for (let i = 1; i < row.length; i++) expect(row[i], `${CLUBS[c].name}: ${LIE_ORDER[i]} vs ${LIE_ORDER[i - 1]}`).toBeLessThan(row[i - 1]);
    }
  });
  it("the sand wedge is the club for sand: it keeps about two thirds of its carry, any other club about half", () => {
    const sw = CLUBS.length - 1;
    expect(carry("bunker", sw) / carry("fairway", sw)).toBeGreaterThan(0.6);
    expect(carry("bunker", 3) / carry("fairway", 3)).toBeLessThan(0.55);
    expect(carry("bunker", sw) / carry("fairway", sw)).toBeGreaterThan(carry("bunker", 4) / carry("fairway", 4));
    // and takes a low flight
    expect(simulate({ club: CLUBS[3], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => "fairway", lie: lieFor("bunker", 3) }).apex).toBeLessThan(
      simulate({ club: CLUBS[3], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => "fairway" }).apex * 0.8,
    );
  });
  it("tee and fairway are the swing as it is", () => {
    expect(lieFor("fairway", 3)).toBeUndefined();
    expect(lieFor("green", 3)).toBeUndefined();
  });
  it("the rough has no check: less spin, a poorer strike, and the face wanders", () => {
    const r = lieFor("rough", 3)!;
    expect(r.speed).toBeCloseTo(0.82, 9);
    expect(r.spin).toBeCloseTo(0.5, 9);
    expect(r.contactCap).toBeLessThanOrEqual(0.8);
    expect(r.faceNoise).toBeGreaterThan(0);
  });

  describe("water and the woods", () => {
    const pond = (x: number, z: number) => (z > 90 && z < 140 && Math.abs(x) < 40 ? ("water" as const) : ("fairway" as const));
    it("water: one stroke, dropped at the last dry ground, said", () => {
      const t = simulate({ club: CLUBS[3], speed: 0.85, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: pond, origin: [0, 0] });
      const d = dropFor(t, t.surface, () => [0, 0])!;
      expect(d.why).toBe("water");
      expect(d.penalty).toBe(1);
      expect(d.say).toMatch(/water/i);
      expect(pond(d.x, d.z)).toBe("fairway");
      expect(d.z).toBeGreaterThan(80);
    });
    it("the drop is on dry ground, fairway or rough, at least 2 m from the water, back along the flight line", () => {
      const b = buildHole(HOLE_DEFS[1]);
      const sw = (x: number, z: number) => b.surfaceAt(x, z);
      const d = HOLE_DEFS[1].water[0];
      let seen = 0;
      for (const club of [3, 4]) {
        for (const aimX of [-24, -17, -12]) {
          for (const sp of [0.8, 0.9, 1.0]) {
            const s = simulate({ club: CLUBS[club], speed: sp, yaw: Math.atan2(aimX, d.z), face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: sw });
            if (s.surface !== "water") continue;
            seen++;
            const dr = dropFor(s, s.surface, b.edgeDrop, sw)!;
            expect(sw(dr.x, dr.z), `${club} ${aimX} ${sp}`).not.toBe("water");
            expect(["fairway", "rough"]).toContain(sw(dr.x, dr.z));
            expect(waterWithin(sw, dr.x, dr.z, DROP_CLEAR)).toBeNull();
            // back toward the tee, and on the line the ball flew
            expect(dr.z).toBeLessThan(s.bounces[s.bounces.length - 1].z);
            let on = 1e9;
            for (let i = 0; i < s.n; i++) on = Math.min(on, Math.hypot(s.pts[i * 4 + 1] - dr.x, s.pts[i * 4 + 3] - dr.z));
            expect(on).toBeLessThan(0.3);
          }
        }
      }
      expect(seen).toBeGreaterThanOrEqual(6);
    });
    it("the woods: one stroke, dropped by the edge function", () => {
      const s = simulate({ club: CLUBS[3], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => "out" });
      const d = dropFor(s, "out", () => [7, 8])!;
      expect([d.x, d.z, d.penalty, d.why]).toEqual([7, 8, 1, "out"]);
    });
    it("anything else is played as it lies", () => {
      const s = simulate({ club: CLUBS[3], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => "fairway" });
      expect(dropFor(s, "fairway", () => [0, 0])).toBeNull();
      expect(dropFor(s, "bunker", () => [0, 0])).toBeNull();
    });
  });
});

describe("score", () => {
  beforeEach(forgetBest);
  afterEach(forgetBest);

  it("the ball is picked up at par + 5, and the score stops there", () => {
    expect(PICK_UP_OVER).toBe(5);
    expect(shouldPickUp(8, 4)).toBe(false);
    expect(shouldPickUp(9, 4)).toBe(true);
    expect(shouldPickUp(8, 3)).toBe(true);
    expect(holeScore(9, 4)).toEqual({ strokes: 9, pickedUp: true, call: "PICK UP" });
    expect(holeScore(11, 4)).toEqual({ strokes: 9, pickedUp: true, call: "PICK UP" });
    expect(holeScore(8, 4, true).pickedUp).toBe(false);
  });
  it("the calls", () => {
    const call = (s: number, par: number) => holeScore(s, par).call;
    expect(call(1, 3)).toBe("HOLE IN ONE");
    expect(call(2, 4)).toBe("EAGLE");
    expect(call(3, 4)).toBe("BIRDIE");
    expect(call(4, 4)).toBe("PAR");
    expect(call(5, 4)).toBe("BOGEY");
    expect(call(6, 4)).toBe("DOUBLE BOGEY");
    expect(call(7, 4)).toBe("+3");
  });
  it("to par, in words and in a sign", () => {
    expect(toPar(7, 7)).toBe("E");
    expect(toPar(9, 7)).toBe("+2");
    expect(toPar(6, 7)).toBe("-1");
    expect(overUnder(7, 7)).toBe("EVEN PAR");
    expect(overUnder(9, 7)).toBe("2 OVER PAR");
    expect(overUnder(6, 7)).toBe("1 UNDER PAR");
  });
  it("the best of this visit is a variable: the first round is the best, a worse one is not, a better one is", () => {
    expect(bestRound(2)).toBeNull();
    expect(recordRound(9, 2)).toEqual({ isBest: true, previous: null, best: 9 });
    expect(recordRound(11, 2)).toEqual({ isBest: false, previous: 9, best: 9 });
    expect(recordRound(8, 2)).toEqual({ isBest: true, previous: 9, best: 8 });
    expect(bestRound(2)).toBe(8);
    // a course of another length keeps its own
    expect(bestRound(6)).toBeNull();
    forgetBest();
    expect(bestRound(2)).toBeNull();
  });
  it("keeps nothing in the browser", () => {
    recordRound(9, 2);
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});
