import { describe, expect, it } from "vitest";
import { CLUBS, simulate, type ShotIn } from "@/components/offhours/golf/flight";
import { HOLE_DEFS, NINE_DEFS, buildHole, type BuiltHole, type HoleDef } from "@/components/offhours/golf/course";
import { GH, GW } from "@/components/offhours/golf/green";
import { bothLies, lieFor, slopeLie, slopeWords, waterWithin } from "@/components/offhours/golf/lie";
import { CourseGame } from "@/components/offhours/golf/play";
import { YD } from "@/components/offhours/golf/scene";
import { carryIn, fullCarry, sfOf } from "@/components/offhours/golf/swing";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { BOTS, mean, playRound } from "./golf-bots";

// The hills (phase 3): the ground has a shape, the ball lands, bounces and rolls
// on it, a slope under the ball changes the strike, and the club suggestion plays
// the shot as it plays (up or down hill, with the wind or into it). Without
// hills every hole is the flat one it was, shot for shot.

const holes = HOLE_DEFS.map((d) => buildHole(d));
const fair = () => "fairway" as const;
const shot = (over: Partial<ShotIn> = {}): ShotIn => ({ club: CLUBS[3], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: fair, ...over });
/** a plane through the origin rising `sx` per metre to +x and `sz` to +z */
const plane = (sx: number, sz: number) => ({ y: (x: number, z: number) => sx * x + sz * z, slope: () => [sx, sz] as [number, number] });

/** a point in or round a dug pot on the hole (its bunker, and the apron of sod round it, 6 yd out) */
const inPot = (h: BuiltHole, x: number, z: number) =>
  (h.def.features ?? []).some((f) => {
    if (f.k !== "pot") return false;
    const bl = h.def.bunkers[(f as { b: number }).b];
    return Math.hypot(x - bl.x * YD, z - bl.z * YD) < (Math.max(bl.rx, bl.rz) + 6) * YD;
  });

describe("the ground's shape", () => {
  it("the tee is at 0, and every hole rises and falls as it says", () => {
    for (const h of holes) {
      const t = terrainOf(h);
      expect(Math.abs(t.y(0, 0)), `hole ${h.def.n}`).toBeLessThan(0.5);
      const rise = h.def.ground!.rise;
      const [s, line] = rise[rise.length - 1];
      // the green's pad is near the height the line has there (and a cliff's drop, if the green is below one: hole 2's 30 m)
      const [gx, gz] = h.fromGreen(GW / 2, GH / 2);
      const want = line + t.fx.y(gx, gz);
      expect(Math.abs(t.pad - want), `hole ${h.def.n}`).toBeLessThan(1.5);
      void s;
    }
    // a long way down on 2 (30 m, off the cliff), and down on 3 too: its mesa green sits under the canyon's tee
    expect(terrainOf(holes[1]).pad).toBeLessThan(-27);
    expect(terrainOf(holes[2]).pad).toBeLessThan(-7);
  });

  it("has no steps or cliffs anywhere a ball can be", { timeout: 60_000 }, () => {
    for (const h of holes) {
      const t = terrainOf(h);
      const b = h.shape.box;
      for (let z = b.z0; z <= b.z1; z += 2.3)
        for (let x = b.x0; x <= b.x1; x += 2.3) {
          // (the banks of a pond or a creek are steep: a ball there is in the water a moment later)
          if (h.surfaceAt(x, z) === "out" || waterWithin(h.surfaceAt, x, z, 2.5) !== null) continue;
          // (a pot's face, a bank and a ravine's wall are steep on purpose: features.ts, with their own tests)
          if (t.fx.fine(x, z, 0) > 0) continue;
          const [sx, sz] = t.slope(x, z);
          expect(Math.hypot(sx, sz), `hole ${h.def.n} at ${x.toFixed(0)}, ${z.toFixed(0)}`).toBeLessThan(0.6);
          expect(Math.abs(t.y(x + 0.3, z) - t.y(x, z))).toBeLessThan(0.15);
        }
    }
  });

  it("a cliff is the one place the ground may be steeper than 0.6, and it is rock there (E9)", { timeout: 30_000 }, () => {
    for (const h of holes) {
      const t = terrainOf(h);
      if (!t.fx.cliffs.length) continue;
      const b = h.shape.box;
      for (let z = b.z0; z <= b.z1; z += 1.1)
        for (let x = b.x0; x <= b.x1; x += 1.1) {
          // (a dug pot, a sand bunker with its sod apron, is sand and not rock: the rule is for the cliffs)
          if (Math.hypot(...t.slope(x, z)) > 0.6 && waterWithin(h.surfaceAt, x, z, 2.5) === null && !inPot(h, x, z)) expect(t.fx.rock(x, z), `hole ${h.def.n} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(true);
        }
    }
  });

  it("the tee and the green sit level; sand and water are dug in", () => {
    for (const h of holes) {
      const t = terrainOf(h);
      // the tee box
      for (const [x, z] of [[2, 2], [-3, 1], [0, -3]]) expect(Math.hypot(...t.slope(x, z)), `hole ${h.def.n}`).toBeLessThan(0.01);
      // the green, under its own contours, is level: its height there is the pad plus the green's rise
      for (const [gx, gy] of [[GW / 2, GH / 2], [GW * 0.3, GH * 0.6]]) expect(t.yG(gx, gy) - t.rise(gx, gy)).toBeCloseTo(t.pad, 5);
      for (const b of h.def.bunkers) {
        const x = b.x * YD, z = b.z * YD;
        const [gx, gy] = h.toGreen(x, z);
        if (Math.abs(gx - GW / 2) < GW && Math.abs(gy - GH / 2) < GH) continue;
        const off = (b.rx + 6) * YD;
        expect(t.y(x, z), `hole ${h.def.n} sand`).toBeLessThan((t.y(x + off, z) + t.y(x - off, z)) / 2 - 0.15);
      }
    }
    // hole 2's tarn is dug 2.6 m under the ground at its shore
    const ring = holes[1].world.water[0];
    const mx = ring.reduce((a, p) => a + p[0], 0) / ring.length, mz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const t = terrainOf(holes[1]);
    expect(t.waterY(mx, mz) - t.y(mx, mz)).toBeGreaterThan(2);
  });
});

describe("a ball on the slopes", () => {
  it("flat ground is the flat game, to the last digit", () => {
    for (const club of [0, 3, 5]) {
      const a = simulate(shot({ club: CLUBS[club], speed: 0.9, curve: 0.3, wind: [1, -2] }));
      const b = simulate(shot({ club: CLUBS[club], speed: 0.9, curve: 0.3, wind: [1, -2], ground: plane(0, 0) }));
      expect(Array.from(b.pts)).toEqual(Array.from(a.pts));
      expect(b.total).toBe(a.total);
    }
  });

  it("uphill it comes down sooner, downhill later", () => {
    const flat = simulate(shot()).carry;
    const up = simulate(shot({ ground: plane(0, 0.06) })).carry;
    const down = simulate(shot({ ground: plane(0, -0.06) })).carry;
    expect(up).toBeLessThan(flat - 5);
    expect(down).toBeGreaterThan(flat + 5);
  });

  it("a rolling ball runs on downhill, checks uphill, and is pulled off line by a side slope", () => {
    // a low runner with little spin
    const run = (g?: ReturnType<typeof plane>) => simulate(shot({ club: CLUBS[1], speed: 0.45, ground: g }));
    const flat = run();
    const down = run(plane(0, -0.1)), up = run(plane(0, 0.1));
    // downhill it carries further and runs on; uphill it comes down early and runs no further than on the flat
    expect(down.total).toBeGreaterThan(flat.total + 10);
    expect(down.total - down.carry).toBeGreaterThan(flat.total - flat.carry);
    expect(up.carry).toBeLessThan(flat.carry - 10);
    expect(up.total).toBeLessThan(flat.total + 1);
    // ground falling away to the right: it ends up right of where it would have
    const side = run(plane(-0.06, 0));
    expect(side.side).toBeGreaterThan(flat.side + 1);
    // the ball's height follows the ground once it is down
    const n = down.n - 1;
    expect(down.pts[n * 4 + 2]).toBeCloseTo(-0.1 * down.pts[n * 4 + 3], 3);
  });

  it("a ball at rest on a gentle slope stays put; on a steep one it keeps going", () => {
    const putt = (sz: number) => simulate(shot({ club: CLUBS[5], speed: 0.12, ground: plane(0, sz) }));
    const gentle = putt(-0.1), steep = putt(-0.5);
    expect(gentle.restT).toBeLessThan(steep.restT);
    expect(steep.total).toBeGreaterThan(gentle.total + 5);
  });
});

describe("the lie", () => {
  it("uphill adds loft, downhill takes it; above the feet starts left, below right", () => {
    const up = slopeLie(0, 0.08, 0, 3)!, down = slopeLie(0, -0.08, 0, 3)!;
    expect(up.launch!).toBeGreaterThan(1.2);
    expect(down.launch!).toBeLessThan(0.8);
    // the ground rising to the right of the line: the ball is above the golfer's feet (they stand to its left)
    expect(slopeLie(0.08, 0, 0, 3)!.face!).toBeLessThan(-0.4);
    expect(slopeLie(-0.08, 0, 0, 3)!.face!).toBeGreaterThan(0.4);
    // turned round, the same ground reads the other way
    expect(slopeLie(0, 0.08, Math.PI, 3)!.launch!).toBeLessThan(1);
    expect(slopeLie(0.01, -0.01, 0, 3)).toBeUndefined();
    expect(slopeWords(0, 0.08, 0)).toBe("UPHILL LIE");
    expect(slopeWords(0, -0.08, 0)).toBe("DOWNHILL LIE");
    expect(slopeWords(0.08, 0, 0)).toBe("BALL ABOVE FEET");
    expect(slopeWords(-0.08, 0, 0)).toBe("BALL BELOW FEET");
    expect(slopeWords(0.02, 0, 0)).toBeNull();
  });
  it("a slope and a surface together: both apply", () => {
    const l = bothLies(lieFor("rough", 3), slopeLie(0.08, 0.08, 0, 3))!;
    expect(l.speed).toBeCloseTo(0.88, 9);
    expect(l.face!).toBeLessThan(0);
    expect(l.launch!).toBeGreaterThan(1);
    const a = simulate(shot({ lie: l, rng: () => 0.5 })), b = simulate(shot({ lie: lieFor("rough", 3), rng: () => 0.5 }));
    expect(a.side).toBeLessThan(b.side - 3);
  });
});

describe("what a shot plays like", () => {
  it("a carry into the wind or up a hill needs more club; down one, less (the flight's own numbers)", () => {
    for (const c of [0, 3, 5]) {
      const sf = sfOf(0.9);
      const base = carryIn(c, sf, 0, 0);
      expect(carryIn(c, sf, 8, 0)).toBeLessThan(base - 5);
      expect(carryIn(c, sf, -8, 0)).toBeGreaterThan(base + 5);
      expect(carryIn(c, sf, 0, -8)).toBeLessThan(base - 5);
      // it is the flight's: the same as flying it
      expect(carryIn(c, sf, 0, -8)).toBe(simulate(shot({ club: CLUBS[c], speed: sf, wind: [0, -8] })).carry);
    }
  });

  it("the game says what the pin plays like, and suggests the club for it", () => {
    // hole 2 from the tee: a long way down, it plays short; a hole like it turned uphill plays long
    const g2 = new CourseGame({ seed: 3, hills: true, holes: [HOLE_DEFS[1]] });
    g2.wind = [0, 0];
    expect(g2.playsLike()!).toBeLessThan(g2.yardsToPin() - 4);
    const up: HoleDef = { ...HOLE_DEFS[1], n: 12, water: [], props: undefined, features: undefined, drops: undefined, ground: { rise: [[0, 0], [24, 0], [55, 4], [95, 8], [137, 9]], swell: 0.3, sigma: 9 } };
    const g5 = new CourseGame({ seed: 3, hills: true, holes: [up] });
    g5.wind = [0, 0];
    expect(g5.playsLike()!).toBeGreaterThan(g5.yardsToPin() + 3);
    // the suggestion is for the distance it plays: a pure swing at it comes down on the green
    for (const g of [g2, g5]) {
      for (let i = 0; i < 600 && g.phase !== "ready"; i++) g.step(1 / 60);
      const sg = g.suggested();
      g.setClub(sg.club);
      g.remoteSwing({ power: sg.power, face: 0, curve: 0, contact: 1 });
      for (let i = 0; i < 4000 && g.phase !== "putt" && g.phase !== "ready"; i++) g.step(1 / 60);
      expect(g.hole.toPin(g.ball[0], g.ball[1]) / YD, `hole ${g.hole.def.n}`).toBeLessThan(12);
    }
    // flat, the same tee says nothing
    const flat = new CourseGame({ seed: 3, holes: [HOLE_DEFS[1]] });
    flat.wind = [0, 0];
    expect(flat.playsLike()).toBeNull();
  });

  it("no driver out of the rough", () => {
    const g = new CourseGame({ seed: 2, hills: true });
    g.ball = [0, 120 * YD];
    g.lie = "rough";
    expect(g.suggested().club).toBeGreaterThan(0);
    expect(fullCarry(1)).toBeGreaterThan(fullCarry(2));
  });
});

describe("the bots on the hills: measured bands, pinned", () => {
  // 30 seeded rounds each over all six holes with hills (par 23)
  const rounds = (bot: (typeof BOTS)[string]) => Array.from({ length: 30 }, (_, i) => playRound(bot, i + 1, { game: { hills: true } }));
  const total = (rs: ReturnType<typeof rounds>) => mean(rs.map((r) => r.total));
  it("skilled: par + 2 to par + 5, every hole about a par plus one, never stuck", { timeout: 90_000 }, () => {
    const rs = rounds(BOTS.skilled);
    expect(rs.every((r) => r.finished)).toBe(true);
    expect(total(rs)).toBeGreaterThanOrEqual(25.5);
    expect(total(rs)).toBeLessThanOrEqual(29);
    rs[0].pars.forEach((par, h) => {
      const m = mean(rs.map((r) => r.holes[h]));
      expect(m, `hole ${h + 1}`).toBeGreaterThanOrEqual(par - 0.6);
      expect(m, `hole ${h + 1}`).toBeLessThanOrEqual(par + 2);
    });
  });
  it("casual and keyboard stay where they are on the flat", { timeout: 90_000 }, () => {
    const c = total(rounds(BOTS.casual)), k = total(rounds(BOTS.keyboard));
    expect(c).toBeGreaterThanOrEqual(32);
    expect(c).toBeLessThanOrEqual(37.5);
    expect(k).toBeGreaterThanOrEqual(25.5);
    expect(k).toBeLessThanOrEqual(29.5);
  });
});

describe("the nine on the hills (the 3D course's round): measured bands, pinned", () => {
  // 30 seeded rounds over all nine holes (par 37)
  const rounds = (bot: (typeof BOTS)[string]) => Array.from({ length: 30 }, (_, i) => playRound(bot, i + 1, { game: { hills: true, holes: NINE_DEFS }, maxSeconds: 1400 }));
  const total = (rs: ReturnType<typeof rounds>) => mean(rs.map((r) => r.total));
  it("skilled: par + 2 to par + 7, every hole about a par plus one, none out of reach", { timeout: 120_000 }, () => {
    const rs = rounds(BOTS.skilled);
    expect(rs.every((r) => r.finished)).toBe(true);
    expect(total(rs)).toBeGreaterThanOrEqual(39);
    expect(total(rs)).toBeLessThanOrEqual(44);
    rs[0].pars.forEach((par, h) => {
      const m = mean(rs.map((r) => r.holes[h]));
      expect(m, `hole ${h + 1}`).toBeGreaterThanOrEqual(par - 0.6);
      expect(m, `hole ${h + 1}`).toBeLessThanOrEqual(par + 2);
    });
    expect(rs.reduce((a, r) => a + r.pickedUp, 0)).toBeLessThanOrEqual(3);
  });
  it("the keyboard's three presses play like the skilled player; a casual one is well behind", { timeout: 120_000 }, () => {
    const k = total(rounds(BOTS.keyboard)), c = rounds(BOTS.casual);
    expect(k).toBeGreaterThanOrEqual(38.5);
    expect(k).toBeLessThanOrEqual(44.5);
    expect(c.every((r) => r.finished)).toBe(true);
    expect(total(c)).toBeGreaterThan(k + 6);
  });
});
