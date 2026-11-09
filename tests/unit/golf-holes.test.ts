import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUBS, simulate } from "@/components/offhours/golf/flight";
import { HOLE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { MAP_WIDE, fit, mapRect } from "@/components/offhours/golf/map";
import { CourseGame, NEAR_GREEN, REST_HOLD, STEP } from "@/components/offhours/golf/play";
import { carryRing, paint } from "@/components/offhours/golf/playDraw";
import { YD, project } from "@/components/offhours/golf/scene";
import { CHIP_YD, carryAtChip, carryAtPower, chipCarry, chipPowerFor, chipTop, fullCarry, greenRoll, lieCarry, meterFace, overSpeed, sfOf, sfOfChip, strikeNumbers } from "@/components/offhours/golf/swing";
import { forgetBest } from "@/components/offhours/golf/score";
import { DROP_CLEAR, waterWithin } from "@/components/offhours/golf/lie";
import { fakeCtx, recordingCtx, stubScratchCanvas } from "./golf-headless";

// these play real shots and rounds, which run many times slower under coverage on CI
vi.setConfig({ testTimeout: 60_000 });

// Holes 3 to 6, the hole map, the short game and putting from beside the green.

beforeEach(() => {
  stubScratchCanvas();
  forgetBest();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PURE = { power: 1, face: 0, curve: 0, contact: 1 };
const ptr = { x: 0, y: 0, inside: false };
const run = (g: CourseGame, until: () => boolean, max = 40) => {
  const t0 = g.t;
  while (!until() && g.t - t0 < max) g.step(STEP);
  return until();
};
/** a game on hole `n` (1-based) alone, past the tee card, with no wind */
function onHole(n: number, opts = {}) {
  const g = new CourseGame({ seed: 5, holes: [HOLE_DEFS[n - 1]], ...opts });
  g.key({ key: " " }, true);
  g.wind = [0, 0];
  return g;
}
/** put the ball somewhere and ready the next shot from it */
function place(g: CourseGame, x: number, z: number, lie: "fairway" | "rough" = "fairway", strokes = 2) {
  g.ball = [x, z];
  g.lie = lie;
  g.strokes = strokes;
  g.phase = "ready";
  (g as unknown as { prepareShot(tee: boolean): void }).prepareShot(false);
  g.wind = [0, 0];
  g.camReady = false;
}
const rad = (d: number) => (d * Math.PI) / 180;

describe("hole 3, The Elbow", () => {
  const d = HOLE_DEFS[2];
  const b = buildHole(d);
  it("bends right, with a bunker and a stand of trees on the inside of the bend", () => {
    expect(d.line[2][0]).toBeGreaterThan(50);
    expect(d.bunkers[0].x).toBeGreaterThan(0);
    expect(d.bunkers[0].z).toBeLessThan(d.line[1][1]);
    expect(d.copse!.length).toBeGreaterThanOrEqual(6);
    for (const [x, z] of d.copse!) {
      expect(x).toBeGreaterThan(30);
      expect(z).toBeLessThan(d.line[1][1] + 10);
      expect(b.surfaceAt(x * YD, z * YD)).toBe("out");
    }
    expect(b.blockers).toHaveLength(d.copse!.length);
  });
  it("a driver aimed over the trees clears them; a 3 wood or a 5 iron on the same line goes into them and comes down short", () => {
    const tee = (club: number, deg: number) => simulate({ club: CLUBS[club], speed: 1, yaw: rad(deg), face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: b.surfaceAt, trees: b.blockers });
    for (const deg of [10, 14]) expect(tee(0, deg).tree, `driver ${deg}`).toBeNull();
    for (const [club, deg] of [[1, 14], [1, 17], [2, 14], [2, 17]]) {
      const s = tee(club, deg);
      expect(s.tree, `${CLUBS[club].short} ${deg}`).not.toBeNull();
      // it went in at the trees, short of where the club carries, and came down short of where it would have
      const free = simulate({ club: CLUBS[club], speed: 1, yaw: rad(deg), face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: b.surfaceAt });
      expect(s.total).toBeLessThan(free.total - 3);
      expect(Math.hypot(s.tree!.x, s.tree!.z) / YD).toBeLessThan(fullCarry(club) * 0.95);
    }
    // the same shots with no trees are not stopped
    expect(simulate({ club: CLUBS[2], speed: 1, yaw: rad(14), face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: b.surfaceAt }).tree).toBeNull();
  });
  it("in the game: a 3 wood into the copse says so, drops in the trees, and costs a stroke", () => {
    const g = onHole(3);
    g.setAim(rad(14));
    g.setClub(1);
    g.remoteSwing(PURE);
    expect(run(g, () => g.phase === "rest")).toBe(true);
    expect(g.shot!.tree).not.toBeNull();
    expect(g.said[g.said.length - 1]).toMatch(/Hit a tree\.$/);
    expect(g.strokes).toBeGreaterThanOrEqual(1);
  });
  it("the default aim goes down the first leg to the landing zone, a 5 iron to the bend, and leaves a long second", () => {
    const g = onHole(3);
    expect(g.yawT).toBeCloseTo(Math.atan2(b.landing[0], b.landing[1]), 9);
    expect(g.club).toBe(2);
    g.remoteSwing(PURE);
    run(g, () => g.phase === "ready");
    expect(g.lie).toBe("fairway");
    expect(g.yardsToPin()).toBeGreaterThan(140);
    expect(g.yardsToPin()).toBeLessThan(175);
  });
});

describe("hole 4, Reed Creek", () => {
  const d = HOLE_DEFS[3];
  const b = buildHole(d);
  const creek = d.water[0] as { path: [number, number][]; w: number };
  it("a creek across the fairway from 320 to 334 yd, and the green 136 yd past it", () => {
    const zs = creek.path.map((p) => p[1]);
    expect(Math.min(...zs) - creek.w / 2).toBeGreaterThanOrEqual(319);
    expect(Math.max(...zs) + creek.w / 2).toBeLessThanOrEqual(335.5);
    expect(d.pin[1] - 334).toBeGreaterThanOrEqual(135);
    // it runs the whole width of the fairway and the rough, and a ball down the middle lands in it
    for (const x of [-34, -20, 0, 20, 34]) expect(b.surfaceAt(x * YD, 327 * YD), `x ${x}`).toBe("water");
    expect(b.surfaceAt(0, 318 * YD)).toBe("fairway");
    expect(b.surfaceAt(0, 338 * YD)).toBe("fairway");
  });
  it("a ball that lands in the creek is a stroke, dropped short of it on the fairway", () => {
    const h = onHole(4);
    place(h, 0, 262 * YD);
    h.setAim(0);
    h.setClub(3);
    h.remoteSwing({ ...PURE, power: 0.51 });
    expect(run(h, () => h.phase === "rest")).toBe(true);
    expect(h.shot!.surface).toBe("water");
    expect(h.dropped).toBe(true);
    expect(h.strokes).toBe(4);
    expect(h.ball[1]).toBeLessThan(318 * YD);
    expect(h.hole.surfaceAt(h.ball[0], h.ball[1])).not.toBe("water");
  });
  it("with water across the line the camera rises to show it, and the creek is on screen with room to spare", () => {
    for (const [w, h] of [[1440, 900], [390, 700]]) {
      const g = onHole(4);
      place(g, 0, 262 * YD);
      g.w = w;
      g.h = h;
      paint(fakeCtx(), g, w, h, 1 / 60, ptr);
      expect(g.cam.y, `${w}`).toBeGreaterThan(8);
      const p = { x: 0, y: 0, d: 0, s: 0 };
      let thick = 0;
      for (const x of [-12, 0, 12]) {
        expect(project(g.cam, x * YD, 0, 320 * YD, p)).toBe(true);
        const y0 = p.y;
        expect(project(g.cam, x * YD, 0, 334 * YD, p)).toBe(true);
        expect(p.y).toBeGreaterThan(0);
        expect(y0).toBeLessThan(h);
        thick = Math.max(thick, y0 - p.y);
      }
      // the creek's band is at least 12 px deep (it is 14 yd across the line)
      expect(thick, `${w}`).toBeGreaterThan(12);
    }
    // the tee shot, with the creek 320 yd away, keeps the long camera
    const t = onHole(4);
    paint(fakeCtx(), t, 1440, 900, 1 / 60, ptr);
    expect(t.cam.y).toBeCloseTo(1.9, 6);
  });
});

describe("hole 5, The Collar", () => {
  const d = HOLE_DEFS[4];
  const b = buildHole(d);
  it("the green is ringed with sand, with a pond on its left edge", () => {
    const g = b.world.greens[0];
    let hazard = 0, n = 0;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      // a point about 4 yd beyond the edge of the green
      const x = g.x + Math.cos(a) * (10 + 3.6), z = g.z + Math.sin(a) * (6.25 + 3.6);
      n++;
      if (["bunker", "water"].includes(b.surfaceAt(x, z))) hazard++;
    }
    expect(hazard / n).toBeGreaterThan(0.8);
    expect(d.water[0]).toMatchObject({ x: expect.any(Number) });
    const w = d.water[0] as { x: number; z: number; rx: number };
    expect(w.x + w.rx).toBeLessThan(-10);
    expect(w.x + w.rx).toBeGreaterThan(-14);
    expect(Math.abs(w.z - d.green.c[1])).toBeLessThan(4);
  });
  it("has the strongest wind of the six, blowing toward the pond", () => {
    const sp = HOLE_DEFS.map((h) => h.wind.speed);
    expect(Math.max(...sp)).toBe(d.wind.speed);
    expect(sp.filter((s) => s === d.wind.speed)).toHaveLength(1);
    expect(b.wind[0]).toBeLessThan(-3);
  });
  it("from the tee the green, its sand and its pond are all in the picture, the green at least 60 px tall", () => {
    for (const [w, h] of [[1440, 900], [1406, 698]]) {
      const g = onHole(5);
      g.w = w;
      g.h = h;
      paint(fakeCtx(), g, w, h, 1 / 60, ptr);
      const gr = g.hole.world.greens[0];
      const p = { x: 0, y: 0, d: 0, s: 0 };
      let y0 = 1e9, y1 = -1e9;
      for (const [x, , z] of gr.ring(gr.r)) {
        expect(project(g.cam, x, 0, z, p)).toBe(true);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      expect(y1 - y0, `${w}x${h}`).toBeGreaterThanOrEqual(60);
      expect(y1).toBeLessThan(h);
      for (const [x, z] of [[-18.5, 176], [16.5, 176], [0, 164.5], [0, 187.5]]) {
        expect(project(g.cam, x * YD, 0, z * YD, p)).toBe(true);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(w);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(h);
      }
    }
  });
});

describe("hole 6, Last Light", () => {
  const d = HOLE_DEFS[5];
  const b = buildHole(d);
  it("a long dogleg left, with water down the inside of the bend and the wind in your face", () => {
    expect(d.line[2][0]).toBeLessThan(-80);
    const wp = (d.water[0] as { path: [number, number][] }).path;
    // the water is left of the line all the way, and runs the length of the bend
    for (const [x, z] of wp) expect(x, `z ${z}`).toBeLessThan(buildHole(d).surfaceAt(0, 0) === "fairway" ? -40 : 0);
    expect(wp[wp.length - 1][1] - wp[0][1]).toBeGreaterThan(120);
    expect(b.wind[1]).toBeLessThan(-2);
    expect(d.copse!.length).toBeGreaterThanOrEqual(5);
    for (const [x] of d.copse!) expect(x).toBeLessThan(0);
  });
  it("a drive down the line stays dry; one cut at the water is wet", () => {
    const tee = (deg: number) => simulate({ club: CLUBS[0], speed: 1, yaw: -rad(deg), face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: b.surfaceAt, trees: b.blockers });
    for (const deg of [8, 12]) expect(tee(deg).surface).toBe("fairway");
    expect(tee(20).surface).toBe("water");
  });
  it("the default aim is the fairway round the bend, and the tee shot's camera looks down it", () => {
    const g = onHole(6);
    expect(g.yawT).toBeCloseTo(Math.atan2(b.landing[0], b.landing[1]), 9);
    expect(g.yawT).toBeLessThan(0);
    expect(["fairway"]).toContain(b.surfaceAt(b.landing[0], b.landing[1]));
    // the line to it is clear: no woods, no water
    for (let u = 0; u <= 1; u += 0.02) expect(["fairway", "rough"]).toContain(b.surfaceAt(b.landing[0] * u, b.landing[1] * u));
    g.w = 1440;
    g.h = 900;
    paint(fakeCtx(), g, 1440, 900, 1 / 60, ptr);
    // the camera's own heading is the aim
    const fx = g.cam.tx - g.cam.x, fz = g.cam.tz - g.cam.z;
    expect(Math.atan2(fx, fz)).toBeCloseTo(g.yaw, 1);
  });
  it("an approach from the fairway, on this hole and on hole 3, shows the green at least 60 px tall with the hazards in the picture", () => {
    for (const [n, x, z] of [[3, 58, 262], [6, -62, 262]] as const) {
      for (const [w, h] of [[1440, 900], [1406, 698]]) {
        const g = onHole(n);
        place(g, x * YD, z * YD);
        g.w = w;
        g.h = h;
        paint(fakeCtx(), g, w, h, 1 / 60, ptr);
        const gr = g.hole.world.greens[0];
        const p = { x: 0, y: 0, d: 0, s: 0 };
        let y0 = 1e9, y1 = -1e9;
        for (const [gx, , gz] of gr.ring(gr.r)) {
          expect(project(g.cam, gx, 0, gz, p)).toBe(true);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
        expect(y1 - y0, `hole ${n} at ${w}x${h}`).toBeGreaterThanOrEqual(60);
        expect(y1).toBeLessThan(h);
        expect(y0).toBeGreaterThan(0);
      }
    }
  });
});

describe("the short game", () => {
  /** Space, then a second press `gap` frames on, then the third on the line: the carry of the chip from 30 yd */
  function chip(gap: number, from = 30, opts: { club?: number } = {}) {
    const g = onHole(2);
    place(g, g.hole.pin[0], g.hole.pin[1] - from * YD);
    if (opts.club !== undefined) g.setClub(opts.club);
    g.key({ key: " " }, true);
    for (let i = 0; i < gap; i++) g.step(STEP);
    g.key({ key: " " }, true);
    while (g.phase === "swing" && g.sw.dur - g.sw.t > 0) g.step(STEP);
    g.key({ key: " " }, true);
    expect(g.phase).toBe("fly");
    return g;
  }
  it("inside 40 yd the quickest double press carries 3 to 6 yd, and the carry rises with the gap up to about 45 yd", () => {
    const carries = [10, 20, 30, 45, 60].map((gap) => chip(gap).shot!.carry);
    expect(carries[0]).toBeGreaterThanOrEqual(3);
    expect(carries[0]).toBeLessThanOrEqual(6);
    for (let i = 1; i < carries.length; i++) expect(carries[i]).toBeGreaterThan(carries[i - 1] + 2);
    expect(carries[4]).toBeGreaterThan(38);
    expect(carries[4]).toBeLessThan(52);
  });
  it("beyond 40 yd the meter is the full swing's (the quickest press still carries about 15 yd)", () => {
    const g = chip(10, CHIP_YD + 15);
    expect(g.sw.chip).toBe(false);
    expect(g.shot!.carry).toBeGreaterThan(11);
    expect(chip(10, CHIP_YD - 1).sw.chip).toBe(true);
  });
  it("a drag is the chip meter too, and a phone's swing is not scaled", () => {
    const g = onHole(2);
    place(g, g.hole.pin[0], g.hole.pin[1] - 30 * YD);
    g.h = 900;
    g.pointer("down", 700, 300);
    expect(g.sw.chip).toBe(true);
    const r = onHole(2);
    place(r, r.hole.pin[0], r.hole.pin[1] - 30 * YD);
    r.remoteSwing({ ...PURE, power: 0.5 });
    run(r, () => r.phase === "fly");
    expect(Math.abs(r.shot!.carry - carryAtPower(5, 0.5))).toBeLessThan(1.5);
  });
  it("the suggestion in the meter's units reaches the pin: a keyboard chip played to it lands within 4 yd of the distance", () => {
    for (const from of [8, 15, 25, 35]) {
      const g = onHole(2);
      place(g, g.hole.pin[0], g.hole.pin[1] - from * YD);
      const sg = g.meterSuggest();
      expect(sg.club).toBe(5);
      const gap = Math.round((sg.power * 1.1) / STEP / 1);
      g.key({ key: " " }, true);
      while (g.sw.b < sg.power) g.step(STEP);
      g.key({ key: " " }, true);
      while (g.phase === "swing" && g.sw.dur - g.sw.t > 0) g.step(STEP);
      g.key({ key: " " }, true);
      void gap;
      expect(Math.abs(g.shot!.carry - from), `${from} yd`).toBeLessThan(4);
    }
  });
  it("the numbers: the top of the chip meter carries 45 to 55 yd with the wedges, a longer club is scaled down to the same, and the meter is monotone", () => {
    for (const club of [4, 5]) expect(chipCarry(club)).toBeGreaterThan(45);
    for (const club of [3, 4, 5]) expect(chipCarry(club)).toBeLessThan(56);
    expect(chipTop(5)).toBeLessThan(1);
    let prev = -1;
    for (let b = 0; b <= 1.0001; b += 0.05) {
      expect(sfOfChip(5, b)).toBeGreaterThan(prev);
      prev = sfOfChip(5, b);
    }
    expect(carryAtChip(5, 0.1)).toBeGreaterThanOrEqual(3);
    expect(carryAtChip(5, 0.1)).toBeLessThan(5);
    expect(chipPowerFor(5, 20)).toBeCloseTo(0.5, 1);
    expect(chipPowerFor(5, 90)).toBe(1);
  });
  it("strikeNumbers: chip scales a meter or gesture swing and the over-the-top swing; a phone's swing is untouched", () => {
    const base = { src: "meter" as const, peak: 0.5, x0: 0, xTop: 0, xNow: 0, lastL: 200, td: 0, autoFace: 0, remote: null, over: false };
    const full = strikeNumbers(base, 5, () => 0.5, false);
    const ch = strikeNumbers(base, 5, () => 0.5, true);
    expect(ch.speed).toBeCloseTo(sfOfChip(5, 0.5), 9);
    expect(ch.speed).toBeLessThan(full.speed);
    const phone = { ...base, src: "remote" as const, remote: { power: 0.5, face: 0, curve: 0, contact: 1 } };
    expect(strikeNumbers(phone, 5, () => 0.5, true).speed).toBeCloseTo(strikeNumbers(phone, 5, () => 0.5, false).speed, 12);
    const over = strikeNumbers({ ...base, over: true }, 5, () => 0.5, true);
    expect(over.speed).toBeCloseTo(overSpeed(5) * chipTop(5), 9);
  });
  it("the carry ring and the gauge say the chip's carry, not the club's", () => {
    const g = onHole(2);
    place(g, g.hole.pin[0], g.hole.pin[1] - 30 * YD);
    g.setAim(0);
    expect(carryRing(g).yd).toBeCloseTo(chipCarry(5), 6);
    const rec = recordingCtx();
    g.w = 1440;
    g.h = 900;
    paint(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    expect(rec.texts).toContain(`${Math.round(chipCarry(5))} YD CARRY`);
    expect(rec.texts).not.toContain(`${Math.round(fullCarry(5))} YD CARRY`);
  });
});

describe("putting from beside the green", () => {
  /** the first point down the line from the pin that is not green or fringe (m, z) */
  function offEdge(g: CourseGame) {
    let z = g.hole.pin[1];
    while (["green", "fringe"].includes(g.hole.surfaceAt(g.hole.pin[0], z))) z -= 0.05;
    return z;
  }
  const settle = (g: CourseGame) => {
    g.phase = "rest";
    g.restT = REST_HOLD;
    g.step(STEP);
  };
  it("a ball on the rough or fairway within 2 yd of the green is putted; further out it is played, and sand is played", () => {
    const g0 = onHole(2);
    const z0 = offEdge(g0);
    for (const lie of ["rough", "fairway"] as const) {
      const g = onHole(2);
      place(g, g.hole.pin[0], z0 - 0.4);
      g.lie = lie;
      expect(g.nearGreen()).toBe(true);
      settle(g);
      expect(g.phase, lie).toBe("putt");
      // the putt starts where the ball lies, off the green
      expect(g.puttState().dist).toBeGreaterThan(4);
    }
    const near = onHole(2);
    place(near, near.hole.pin[0], z0 - NEAR_GREEN - 1);
    expect(near.nearGreen()).toBe(false);
    settle(near);
    expect(near.phase).toBe("ready");
    const sand = onHole(2);
    place(sand, sand.hole.pin[0], z0 - 0.4);
    sand.lie = "bunker";
    expect(sand.nearGreen()).toBe(false);
    expect(NEAR_GREEN).toBeCloseTo(2 * YD, 9);
  });
  it("it can be holed: putts from a yard off the green on hole 2 finish the hole", () => {
    const g = onHole(2);
    place(g, g.hole.pin[0] + 0.5, offEdge(g) - 0.4);
    settle(g);
    expect(g.phase).toBe("putt");
    for (let i = 0; i < 14 && g.phase === "putt"; i++) {
      run(g, () => !g.puttState().rolling || g.phase !== "putt", 20);
      if (g.phase !== "putt") break;
      const ps = g.puttState();
      g.puttShoot(Math.atan2(ps.cup[1] - ps.ball[1], ps.cup[0] - ps.ball[0]), Math.min(1, Math.sqrt(ps.dist / 12) + 0.25));
    }
    run(g, () => g.phase === "hole-card", 10);
    expect(g.phase).toBe("hole-card");
  });
});

describe("the hole map", () => {
  it("fits every hole into its rect at desktop and phone size, and a point on it maps back to the hole", () => {
    for (const [w, h] of [[1440, 900], [1406, 698], [390, 700], [800, 600]]) {
      const r = mapRect(w, h);
      // the inset is clear of the HUD's corners and the gauge; the narrow map clears the top row and the ball marker
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(w);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h).toBeLessThanOrEqual(h);
      if (w >= MAP_WIDE) {
        expect(r.w).toBeLessThanOrEqual(150);
        expect(r.x).toBeGreaterThan(w / 2 + 235);
        expect(r.y).toBeGreaterThan(60);
      } else expect(r.w).toBe(w - 16);
      for (const def of HOLE_DEFS) {
        const hole = buildHole(def);
        const f = fit(hole, r);
        const bx = hole.shape.box;
        for (const [x, z] of [[bx.x0, bx.z0], [bx.x1, bx.z1]]) {
          expect(f.px(x)).toBeGreaterThanOrEqual(r.x);
          expect(f.px(x)).toBeLessThanOrEqual(r.x + r.w);
          expect(f.py(z)).toBeGreaterThanOrEqual(r.y);
          expect(f.py(z)).toBeLessThanOrEqual(r.y + r.h);
        }
        const [x, z] = f.at(f.px(hole.pin[0]), f.py(hole.pin[1]));
        expect(x).toBeCloseTo(hole.pin[0], 6);
        expect(z).toBeCloseTo(hole.pin[1], 6);
        // the tee is below the pin
        expect(f.py(0)).toBeGreaterThan(f.py(hole.pin[1]));
      }
    }
  });
  it("is open at once on a wide screen and shut on a narrow one, until M or the chip says otherwise", () => {
    const opened: boolean[] = [];
    const wide = new CourseGame({ seed: 5, onMap: (o) => opened.push(o) });
    paint(fakeCtx(), wide, 1440, 900, 1 / 60, ptr);
    expect(wide.mapOpen).toBe(true);
    expect(opened).toEqual([true]);
    const narrow = new CourseGame({ seed: 5 });
    paint(fakeCtx(), narrow, 390, 700, 1 / 60, ptr);
    expect(narrow.mapOpen).toBe(false);
    expect(narrow.mapView).toBeNull();
    narrow.key({ key: "m" }, true);
    expect(narrow.mapOpen).toBe(true);
    expect(narrow.said[narrow.said.length - 1]).toBe("Map open.");
    // a held key does not flicker it
    narrow.key({ key: "m", repeat: true }, true);
    expect(narrow.mapOpen).toBe(true);
    narrow.key({ key: "M" }, true);
    expect(narrow.mapOpen).toBe(false);
    expect(narrow.said[narrow.said.length - 1]).toBe("Map closed.");
    // painting does not reopen what was closed
    narrow.key({ key: " " }, true);
    paint(fakeCtx(), narrow, 390, 700, 1 / 60, ptr);
    expect(narrow.mapOpen).toBe(false);
  });
  it("a tap or a drag on it sets the aim and is not a swing; a press outside it swings", () => {
    const g = onHole(3);
    g.w = 1440;
    g.h = 900;
    g.setMap(true);
    expect(g.phase).toBe("ready");
    paint(fakeCtx(), g, 1440, 900, 1 / 60, ptr);
    const v = g.mapView!;
    expect(v).not.toBeNull();
    // a spot on the first leg's right side, over the trees
    const f = fit(g.hole, mapRect(1440, 900));
    const target: [number, number] = [28 * YD, 200 * YD];
    g.pointer("down", f.px(target[0]), f.py(target[1]));
    expect(g.phase).toBe("ready");
    expect(g.yawT).toBeCloseTo(Math.atan2(target[0], target[1]), 3);
    // dragging along the map moves it
    const t2: [number, number] = [70 * YD, 250 * YD];
    g.pointer("move", f.px(t2[0]), f.py(t2[1]));
    expect(g.yawT).toBeCloseTo(Math.atan2(t2[0], t2[1]), 3);
    g.pointer("up", f.px(t2[0]), f.py(t2[1]));
    expect(g.phase).toBe("ready");
    // after the drag a move is nothing, and a press outside the map starts a swing
    g.pointer("move", 10, 10);
    expect(g.yawT).toBeCloseTo(Math.atan2(t2[0], t2[1]), 3);
    g.pointer("down", 300, 300);
    expect(g.phase).toBe("swing");
    // while a shot is in the air the map does not take the aim
    const h = onHole(3);
    h.setMap(true);
    paint(fakeCtx(), h, 1440, 900, 1 / 60, ptr);
    h.remoteSwing(PURE);
    run(h, () => h.phase === "fly");
    const yaw = h.yawT;
    h.pointer("down", f.px(target[0]), f.py(target[1]));
    expect(h.yawT).toBe(yaw);
  });
  it("the aim from the map stays within the arrows' range", () => {
    const g = onHole(3);
    g.setMap(true);
    paint(fakeCtx(), g, 1440, 900, 1 / 60, ptr);
    g.aimAt(-300 * YD, 20 * YD);
    // the range is about the target: the landing zone from this tee
    const [tx, tz] = g.target();
    const base = Math.atan2(tx, tz);
    expect(Math.abs(g.yawT - base)).toBeLessThanOrEqual(0.42 + 1e-9);
  });
  it("is drawn while the ball waits, swings, flies and rests, not on a card or the green; it is kept, not redrawn", () => {
    const g = onHole(3);
    g.w = 1440;
    g.h = 900;
    // stubScratchCanvas spies on createElement: count the canvases the map asks for
    const made = { get length() { return vi.mocked(document.createElement).mock.calls.filter((c) => c[0] === "canvas").length; } };
    paint(fakeCtx(), g, 1440, 900, 1 / 60, ptr);
    expect(g.mapView).not.toBeNull();
    const first = made.length;
    for (let i = 0; i < 20; i++) paint(fakeCtx(), g, 1440, 900, 1 / 60, ptr);
    expect(made.length).toBe(first);
    g.remoteSwing(PURE);
    const seen = new Set<string>();
    while (g.phase !== "hole-card" && g.t < 200) {
      g.step(STEP);
      paint(fakeCtx(), g, 1440, 900, 1 / 60, ptr);
      seen.add(`${g.phase}:${g.mapView ? 1 : 0}`);
      if (g.phase === "ready") g.remoteSwing({ ...PURE, power: g.suggested().power });
      if (g.phase === "putt" && !g.puttState().rolling) {
        const ps = g.puttState();
        g.puttShoot(Math.atan2(ps.cup[1] - ps.ball[1], ps.cup[0] - ps.ball[0]), 0.6);
      }
    }
    for (const p of ["ready", "swing", "fly", "rest"]) expect(seen.has(`${p}:1`), Array.from(seen).join(" ")).toBe(true);
    expect(seen.has("putt:0"), `${Array.from(seen).join(" ")} t=${g.t.toFixed(0)} strokes=${g.strokes}`).toBe(true);
    expect(seen.has("hole-card:0")).toBe(true);
    expect(seen.has("putt:1")).toBe(false);
  });
  it("keeps where each shot went, to draw them, and starts afresh on the next hole", () => {
    const g = onHole(2);
    g.remoteSwing({ ...PURE, power: 0.9 });
    run(g, () => g.phase === "rest");
    expect(g.legs).toHaveLength(1);
    const [x0, z0, x1, z1] = g.legs[0];
    expect([x0, z0]).toEqual([0, 0]);
    expect(Math.hypot(x1, z1) / YD).toBeGreaterThan(50);
    const two = new CourseGame({ seed: 5, holes: [HOLE_DEFS[1], HOLE_DEFS[0]] });
    two.key({ key: " " }, true);
    two.remoteSwing(PURE);
    run(two, () => two.phase === "rest");
    two.nextHole();
    expect(two.legs).toEqual([]);
  });
  it("draws on a phone with no error, with its one line of copy", () => {
    const rec = recordingCtx();
    const g = onHole(4);
    g.w = 390;
    g.h = 700;
    g.setMap(true);
    paint(rec.ctx, g, 390, 700, 1 / 60, ptr);
    expect(rec.texts).toContain("TAP OR DRAG TO AIM");
    expect(g.mapView!.w).toBe(374);
  });
});

describe("found in play", () => {
  it("a ball in the woods behind the copse is dropped where the way to the pin is open", () => {
    for (const n of [3, 6]) {
      const b = buildHole(HOLE_DEFS[n - 1]);
      const open = (x: number, z: number) => {
        const dx = b.pin[0] - x, dz = b.pin[1] - z, l = Math.hypot(dx, dz);
        return b.blockers.every((t) => {
          const u = Math.max(0, Math.min(l, 100, ((t.x - x) * dx + (t.z - z) * dz) / l));
          return Math.hypot(x + (dx / l) * u - t.x, z + (dz / l) * u - t.z) >= t.r + 2;
        });
      };
      for (const t of b.blockers) {
        // just outside the copse, on the woods side
        const out = Math.sign(t.x) * 9 * YD;
        const [x, z] = b.edgeDrop(t.x + out, t.z);
        expect(["fairway", "rough"], `hole ${n}`).toContain(b.surfaceAt(x, z));
        expect(open(x, z), `hole ${n} by the tree at ${Math.round(t.z / YD)} yd`).toBe(true);
      }
    }
  });
  it("from the rough, the club it picks carries the distance (the rough keeps about two thirds to four fifths of a club's carry)", () => {
    for (let c = 0; c < CLUBS.length; c++) {
      expect(lieCarry("rough", c)).toBeGreaterThan(0.62);
      expect(lieCarry("rough", c)).toBeLessThan(0.8);
      expect(lieCarry("fairway", c)).toBe(1);
    }
    const g = onHole(1);
    for (const yd of [60, 90, 120]) {
      place(g, 0, (339.5 - yd) * YD, "rough");
      const sg = g.suggested();
      const carry = carryAtPower(sg.club, sg.power) * g.carryK(sg.club);
      expect(carry, `${yd} yd`).toBeGreaterThan(g.yardsToTarget() - 6);
      expect(carry, `${yd} yd`).toBeLessThan(g.yardsToTarget() + 6);
    }
    // and the club's carry on the screen is what it carries from here
    place(g, 0, 150 * YD, "rough");
    expect(carryRing(g).yd).toBeCloseTo(fullCarry(g.club) * lieCarry("rough", g.club), 1);
  });
  it("a creek no club can carry from here is laid up short of; one that can be carried is played over", () => {
    const g = onHole(4);
    for (const [z, lie] of [[177, "rough"], [60, "fairway"]] as const) {
      place(g, 0, z * YD, lie);
      expect(g.layUp(), `${lie} at ${z}`).not.toBeNull();
      const sg = g.suggested();
      // the carry and its roll stay short of the bank at 320 yd
      expect(z + carryAtPower(sg.club, sg.power) * g.carryK(sg.club) + 12, `${lie} at ${z}`).toBeLessThan(320);
    }
    // from 100 yd the driver carries the far bank (234 yd away) with room to spare
    for (const z of [100, 250]) {
      place(g, 0, z * YD, "fairway");
      expect(g.layUp(), `fairway at ${z}`).toBeNull();
    }
  });
  it("round a dogleg with the pin out of reach, the aim goes down the fairway, not over the woods", () => {
    for (const [n, x, z] of [[3, 21, 150], [6, -25, 150]] as const) {
      const g = onHole(n);
      place(g, x * YD, z * YD, "rough");
      const [tx, tz] = g.target();
      expect(g.target(), `hole ${n}`).not.toEqual(g.hole.pin);
      expect(g.hole.surfaceAt(tx, tz), `hole ${n}`).toBe("fairway");
      // the line to it stays in play
      for (let u = 0.1; u <= 1; u += 0.05) expect(g.hole.surfaceAt(g.ball[0] + (tx - g.ball[0]) * u, g.ball[1] + (tz - g.ball[1]) * u), `hole ${n} at ${u.toFixed(2)}`).not.toBe("out");
      expect(Math.atan2(tx - g.ball[0], tz - g.ball[1])).toBeCloseTo(g.yawT, 6);
    }
    // in reach, it is the pin
    const g = onHole(3);
    place(g, 60 * YD, 260 * YD);
    expect(g.target()).toEqual(g.hole.pin);
  });
  it("an iron that lands on the green stops on it: a wedge runs a few yards, a long iron about ten, a driver more", () => {
    expect(greenRoll(5, 1)).toBeLessThan(4);
    expect(greenRoll(4, 1)).toBeLessThan(7);
    expect(greenRoll(3, 1)).toBeLessThan(9);
    expect(greenRoll(2, 1)).toBeLessThan(12);
    expect(greenRoll(0, 1)).toBeGreaterThan(greenRoll(2, 1));
    // the rough takes the spin off: it runs further
    expect(greenRoll(3, 1, "rough")).toBeGreaterThan(greenRoll(3, 1));
  });
  it("a pure approach at the suggested club and swing finishes on the green, from 60 to 180 yd on every hole", () => {
    for (let n = 1; n <= 6; n++) {
      for (const D of [60, 100, 140, 180]) {
        const g = onHole(n);
        const pin = g.hole.pin;
        // the middle of the fairway D yards short of the pin
        let at: [number, number] | null = null, bd = 4 * YD;
        for (const p of g.hole.line) {
          const d = Math.abs(Math.hypot(p[0] - pin[0], p[1] - pin[1]) - D * YD);
          if (d < bd && p[1] < pin[1]) [bd, at] = [d, p];
        }
        if (!at || g.hole.surfaceAt(...at) !== "fairway") continue;
        place(g, at[0], at[1], "fairway", 1);
        if (g.target() !== g.hole.pin) continue;
        const sg = g.suggested();
        g.setClub(sg.club);
        g.remoteSwing({ ...PURE, power: sg.power });
        expect(run(g, () => g.phase === "rest" || g.phase === "putt")).toBe(true);
        expect(["green", "fringe"], `hole ${n} from ${D}`).toContain(g.lie);
        expect(g.yardsToPin(), `hole ${n} from ${D}`).toBeLessThan(10);
      }
    }
    // and the swing asked for lands short and runs up: less carry than the distance
    const g = onHole(1);
    place(g, 0, (339.5 - 140) * YD, "fairway", 1);
    const sg = g.suggested();
    expect(carryAtPower(sg.club, sg.power)).toBeLessThan(g.yardsToPin());
    expect(carryAtPower(sg.club, sg.power) + greenRoll(sg.club, sfOf(sg.power))).toBeGreaterThan(g.yardsToPin() - 3);
  });
  it("on a phone on its side (830x304) the hole and round cards fit, the shot HUD stays off them, and a touch screen is told to tap", () => {
    const g = onHole(2);
    g.touch = true;
    const drawn: [string, number][] = [];
    const ctx = new Proxy(fakeCtx() as object, {
      get: (t, k) => (k === "fillText" ? (s: string, _x: number, y: number) => drawn.push([s, y]) : Reflect.get(t, k)),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const look = (phase: string) => {
      drawn.length = 0;
      paint(ctx, g, 830, 304, 1 / 60, ptr);
      expect(drawn.some(([s]) => s === "POWER"), phase).toBe(false);
      // the card's last line, the prompt, is on the canvas
      const tap = drawn.find(([s]) => s.startsWith("TAP "));
      expect(tap, phase).toBeDefined();
      expect(tap![1], phase).toBeLessThan(304 - 8);
    };
    let seen = false;
    for (let i = 0; i < 40000 && g.phase !== "round-card"; i++) {
      if (g.phase === "ready") g.remoteSwing({ ...PURE, power: g.suggested().power });
      if (g.phase === "putt" && !g.puttState().rolling) {
        const ps = g.puttState();
        g.puttShoot(Math.atan2(ps.cup[1] - ps.ball[1], ps.cup[0] - ps.ball[0]), 0.35);
      }
      if (g.phase === "hole-card" && g.phaseT > 1 && !seen) {
        seen = true;
        look("hole card");
        g.key({ key: " " }, true);
      }
      g.step(STEP);
    }
    expect(g.phase).toBe("round-card");
    run(g, () => g.phaseT > 1, 3);
    look("round card");
    expect(drawn.map(([s]) => s)).toContain("TAP TO PLAY AGAIN");
  });
  it("a drive into the creek in the woods on hole 6 is dropped beside it, not back near the tee, and is no better off than the trees", () => {
    const tee = (deg: number) => {
      const g = onHole(6);
      g.aim(rad(deg));
      g.yaw = g.yawT;
      g.setClub(0);
      g.remoteSwing(PURE);
      expect(run(g, () => g.phase === "rest")).toBe(true);
      return g;
    };
    const wet = tee(-12);
    expect(wet.result).toBe("WATER · +1");
    expect(["fairway", "rough"]).toContain(wet.lie);
    expect(waterWithin(wet.hole.surfaceAt, wet.ball[0], wet.ball[1], DROP_CLEAR)).toBeNull();
    // it went in about 230 yd out: the drop is within 40 yd of that, not 50 yd off the tee
    const s = wet.shot!;
    const inAt = s.bounces[s.bounces.length - 1];
    expect(Math.hypot(wet.ball[0] - inAt.x, wet.ball[1] - inAt.z) / YD).toBeLessThan(40);
    expect(wet.yardsToPin()).toBeLessThan(200);
    // a little further left is the trees: the water costs about the same, not 200 yd more
    const dry = tee(-14);
    expect(dry.result).toBe("TREES · +1");
    expect(wet.yardsToPin() - dry.yardsToPin()).toBeLessThan(50);
  });
  it("a keyboard swing a little off the line still finds the fairway on the first hole", () => {
    // 40 ms either way is two frames: it was the trees, it is the fairway now
    expect(Math.abs(meterFace(0.04))).toBeLessThan(0.1);
    for (const late of [-0.04, 0.04]) {
      const h = onHole(1);
      h.key({ key: " " }, true);
      run(h, () => h.sw.b >= 1);
      h.key({ key: " " }, true);
      run(h, () => h.sw.t >= h.sw.dur + late);
      h.key({ key: " " }, true);
      expect(run(h, () => h.phase === "rest")).toBe(true);
      expect(h.lie, `${late * 1000} ms`).toBe("fairway");
    }
  });
});

describe("the round, on all six holes", () => {
  it("opens each hole on its card, in order, and ends on the scorecard with par 23", () => {
    const g = new CourseGame({ seed: 3 });
    expect(g.defs.map((d) => d.name)).toEqual(["Open Door", "Short Straw", "The Elbow", "Reed Creek", "The Collar", "Last Light"]);
    const said: string[] = [];
    for (let i = 0; i < g.defs.length; i++) {
      said.push(`Hole ${g.defs[i].n}, ${g.defs[i].yards} yards, par ${g.defs[i].par}.`);
    }
    const rec = recordingCtx();
    g.defs.forEach((d, i) => {
      const h = new CourseGame({ seed: 3, holes: [d] });
      h.w = 1440;
      h.h = 900;
      paint(rec.ctx, h, 1440, 900, 1 / 60, ptr);
      expect(rec.texts, `hole ${i + 1}`).toContain(`HOLE ${d.n} · PAR ${d.par} · ${d.yards} YD`);
      expect(rec.texts).toContain(d.name.toUpperCase());
      expect(h.said[0].startsWith(said[i])).toBe(true);
    });
  });
});
