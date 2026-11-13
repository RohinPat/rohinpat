import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLE_DEFS, NINE_DEFS, buildHole, type HoleDef } from "@/components/offhours/golf/course";
import { CourseGame, STEP } from "@/components/offhours/golf/play";
import { paint } from "@/components/offhours/golf/playDraw";
import { analyse, calloutsOf, eyeFor, firstCarry, heroOf } from "@/components/offhours/golf/sightline";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { flyoverView } from "@/components/golf3d/flyover";
import { forgetBest } from "@/components/offhours/golf/score";
import { buildGorse } from "@/components/golf3d/gorse3d";
import { fakeCtx, stubScratchCanvas } from "./golf-headless";

// Sightlines (wave 2): what the eye can see over a crest, what the tee card says of the drop and the carry (worked out
// from the ground and the hazards, never typed in), where the flyover lingers, and hole 7's own sea reveal.

beforeEach(() => {
  stubScratchCanvas();
  forgetBest();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const YD = 0.9144;
const def = (n: number) => NINE_DEFS.find((d) => d.n === n)!;
const ptr = { x: -1, y: -1, inside: false };

describe("eyeFor", () => {
  it("stands where it is on the flat, and rises over a crest to see what is beyond it", () => {
    expect(eyeFor(() => 0, 0, 0, 0, 1.2, 200, 1.9)).toBe(1.9);
    // a hill 6 m high 100 m out, the aim 200 m out on the far side at ground level
    const hill = (_x: number, z: number) => Math.max(0, 6 - Math.abs(z - 100) * 0.3);
    const e = eyeFor(hill, 0, 0, 0, 1.2, 200, 1.9);
    expect(e).toBeGreaterThan(8);
    // from there the ray clears every sample with room to spare
    for (let d = 5; d < 190; d += 4) expect(e + ((1.2 - e) * d) / 200, `at ${d}`).toBeGreaterThan(hill(0, d));
  });
  it("is not asked for a crest the aim sits on (a post on the top is seen from the tee)", () => {
    const T = terrainOf(buildHole(def(7)));
    const az = 235 * YD;
    expect(eyeFor(T.y, 0, -8.4, 0, T.y(0, az) + 2, az, T.y(0, 0) + 1.9) - 1.9).toBeLessThan(1);
  });
});

describe("the tee card's call-outs", () => {
  it("are worked out from the ground: hole 7 climbs to a crest and drops, hole 2 drops, hole 3 drops", () => {
    expect(calloutsOf(buildHole(def(7)))).toEqual(["climbs 11 m, drops 15 m"]);
    expect(calloutsOf(buildHole(def(2)))).toEqual(["drops 29 m", "carry 140 to clear"]);
    // hole 3's chute: the tee stands on the plateau, and its mesa green sits 9 m under it
    expect(calloutsOf(buildHole(def(3)))).toEqual(["drops 9 m"]);
    // hole 6's cape: the tee stands over the flats, and the arm of the tide is carried on the line to the pin
    expect(calloutsOf(buildHole(def(6)))).toEqual(["drops 21 m", "carry 155 to clear"]);
    // flat enough, and nothing across the line: nothing is said
    expect(calloutsOf(buildHole(def(8)))).toEqual([]);
  });
  it("follow the numbers: a taller crest says so, with no typed text", () => {
    const d7 = def(7);
    const taller: HoleDef = { ...d7, ground: { ...d7.ground!, rise: d7.ground!.rise.map(([z, h]) => [z, h * 1.5] as [number, number]) } };
    expect(analyse(buildHole(taller)).peak).toBeGreaterThan(16);
    expect(calloutsOf(buildHole(taller))[0]).toMatch(/^climbs 1[67] m, drops 2\d m$/);
  });
  it("name the carry over water that crosses the line, to its far bank", () => {
    const d = HOLE_DEFS[0];
    // a creek across the fairway, 150 to 165 yd out
    const wet: HoleDef = { ...d, water: [{ path: [[-40, 157.5], [0, 157.5], [40, 157.5]], w: 15 }] };
    const h = buildHole(wet);
    const c = firstCarry(h)!;
    expect(c.kind).toBe("water");
    expect(c.from).toBeGreaterThan(140);
    expect(c.to - c.from).toBeGreaterThan(8);
    expect(c.to - c.from).toBeLessThan(40);
    expect(calloutsOf(h).find((s) => s.startsWith("carry"))).toBe(`carry ${Math.round(c.to)} to clear`);
    expect(Math.round(c.to)).toBeGreaterThanOrEqual(160);
    expect(Math.round(c.to)).toBeLessThanOrEqual(185);
    expect(heroOf(h)).toEqual({ s: ((c.from + c.to) / 2) * YD, kind: "carry" });
  });
  it("count gorse and a dry ravine across the line, and not a pond beside it", () => {
    const d = HOLE_DEFS[0];
    const gorse = buildHole({ ...d, areas: [{ kind: "gorse", poly: [[-30, 150], [30, 150], [30, 162], [-30, 162]] }] });
    expect(firstCarry(gorse)).toMatchObject({ kind: "gorse" });
    const ravine = buildHole({ ...d, features: [{ k: "channel", path: [[-60, 170], [60, 170]], w: 8, bank: 6, d: 4 }] });
    expect(firstCarry(ravine)).toMatchObject({ kind: "ravine" });
    const beside = buildHole({ ...d, water: [{ x: 40, z: 150, rx: 8, rz: 8 }] });
    expect(firstCarry(beside)).toBeNull();
  });
  it("are said at the tee, and not on a flat course", () => {
    const hills = new CourseGame({ seed: 5, holes: [def(7)], hills: true });
    expect(hills.callouts()).toEqual(["climbs 11 m, drops 15 m"]);
    expect(hills.said.some((s) => /^Hole 7, 385 yards, par 4\. Climbs 11 m, drops 15 m\. /.test(s))).toBe(true);
    const flat = new CourseGame({ seed: 5, holes: [def(7)] });
    expect(flat.callouts()).toEqual([]);
  });
});

describe("the camera over a crest", () => {
  it("rises on the climb of hole 7 to see the aim over the crest", () => {
    const g = new CourseGame({ seed: 5, holes: [def(7)], hills: true });
    g.key({ key: " " }, true);
    // on the climb, 150 yd out: the flag is over the crest
    g.ball = [0, 150 * YD];
    g.strokes = 1;
    (g as unknown as { prepareShot(tee: boolean): void }).prepareShot(false);
    g.yaw = g.yawT;
    g.camReady = false;
    for (let i = 0; i < 400; i++) paint(fakeCtx(), g, 1280, 720, 1 / 60, ptr, { world: false });
    const gb = g.terrain.y(g.ball[0], g.ball[1]);
    expect(g.cam.y - gb).toBeGreaterThan(5);
    // and from the eye the aim is above the ground between
    const [tx, tz] = g.target();
    expect(eyeFor(g.terrain.y, g.cam.x, g.cam.z, tx, g.terrain.y(tx, tz) + 2, tz, 0)).toBeLessThanOrEqual(g.cam.y + 0.6);
  });
  it("leaves a flat hole's eye where it was", () => {
    const g = new CourseGame({ seed: 5, holes: [HOLE_DEFS[0]], hills: true });
    g.key({ key: " " }, true);
    for (let i = 0; i < 60; i++) paint(fakeCtx(), g, 1280, 720, 1 / 60, ptr, { world: false });
    expect(g.cam.y - g.terrain.y(g.ball[0], g.ball[1])).toBeLessThan(2.6);
  });
  it("shows the landing from a tee above it: the camera looks out at the aim, not the slope under the tee", () => {
    const high: HoleDef = { ...def(9), ground: { rise: [[0, 0], [40, 0], [80, -14], [215, -16], [410, -16]], sigma: 9 } };
    const g = new CourseGame({ seed: 5, holes: [high], hills: true });
    g.key({ key: " " }, true);
    for (let i = 0; i < 90; i++) paint(fakeCtx(), g, 1280, 720, 1 / 60, ptr, { world: false });
    expect(Math.hypot(g.cam.tx - g.cam.x, g.cam.tz - g.cam.z)).toBeGreaterThan(150);
    expect(g.cam.y).toBeGreaterThan(g.terrain.y(g.ball[0], g.ball[1]) + 2.5);
  });
  it("does not run away while a shot flies over the crest", () => {
    const g = new CourseGame({ seed: 5, holes: [def(7)], hills: true });
    g.key({ key: " " }, true);
    g.wind = [0, 0];
    for (let i = 0; i < 30; i++) paint(fakeCtx(), g, 1280, 720, 1 / 60, ptr, { world: false });
    g.remoteSwing({ power: 1, face: 0, curve: 0, contact: 1 });
    let top = 0;
    for (let i = 0; i < 60 * 14 && g.phase !== "rest"; i++) {
      g.step(STEP);
      paint(fakeCtx(), g, 1280, 720, STEP, ptr, { world: false });
      top = Math.max(top, g.cam.y - g.terrain.y(g.cam.x, g.cam.z));
      expect(Number.isFinite(g.cam.y) && Number.isFinite(g.cam.ty)).toBe(true);
    }
    expect(top).toBeLessThan(40);
  });
});

describe("the flyover", () => {
  it("lingers low at a crest and stays above the ground", () => {
    const hole = buildHole(def(7));
    const hero = heroOf(hole)!;
    expect(hero.kind).toBe("crest");
    const G = terrainOf(hole).y;
    const end = { x: 1, y: 1.9, z: -8, tx: 0, ty: 0.9, tz: 60, F: 1200 };
    let lowest = Infinity, atCrest = 0;
    const N = 100;
    for (let i = 0; i <= N; i++) {
      const v = flyoverView(hole, i / N, 1280, 720, end);
      expect(v.y, `u ${i}`).toBeGreaterThan(G(v.x, v.z) + 1);
      if (i / N < 0.6) {
        lowest = Math.min(lowest, v.y - G(v.x, v.z));
        if (Math.hypot(v.x, v.z - hero.s) < 60) atCrest++;
      }
    }
    expect(lowest).toBeLessThan(8);
    // the share of the first 60% spent within 60 m of the crest is more than the plain sweep gives it
    expect(atCrest).toBeGreaterThan(10);
    expect(flyoverView(hole, 0, 1280, 720, end)).not.toEqual(end);
    expect(flyoverView(hole, 1, 1280, 720, end)).toEqual(end);
  });
  it("has no hero on a hole without a crest or a carry", () => {
    expect(heroOf(buildHole(def(1)))).toBeNull();
  });
});

describe("hole 7's ground and sea", () => {
  const hole = buildHole(def(7));
  const T = terrainOf(hole);
  it("climbs to a crest 11 m over the tee at the post and falls to a green about 15 m under it", () => {
    const post = def(7).props!.find((p) => p.kind === "post") as { at: [number, number] };
    expect(Math.abs(post.at[1] - 236)).toBeLessThan(8);
    const a = analyse(hole);
    expect(a.peak).toBeGreaterThan(10.5);
    expect(a.peak).toBeLessThan(12.5);
    expect(a.peakS / YD).toBeGreaterThan(215);
    expect(a.peakS / YD).toBeLessThan(250);
    expect(a.peak - a.pin).toBeGreaterThan(14);
    expect(a.peak - a.pin).toBeLessThan(17);
    // the drive is blind: from eye height on the climb the green is over the crest
    const z = 190 * YD;
    expect(eyeFor(T.y, 0, z, hole.pin[0], T.y(hole.pin[0], hole.pin[1]) + 2, hole.pin[1], T.y(0, z) + 1.9)).toBeGreaterThan(T.y(0, z) + 3);
  });
  it("opens the trees to the sea on the right and behind the green", () => {
    const d = def(7);
    expect(d.trees.behind).toBe(0);
    expect(d.trees.clear!.length).toBeGreaterThanOrEqual(2);
    expect(d.trees.sides![1]).toBeLessThan(d.trees.sides![0]);
  });
  it("puts the cliff behind the green out of bounds, with nothing in play beyond it", () => {
    expect(hole.surfaceAt(-12, 412 * YD)).toBe("oob");
    expect(hole.surfaceAt(-12, 430 * YD)).toBe("oob");
    for (let z = 410; z <= 470; z += 5) for (const x of [-60, -30, 0, 30, 60]) expect(["oob", "out"]).toContain(hole.surfaceAt(x * YD, z * YD));
  });
});

describe("gorse as bushes", () => {
  it("one instanced mesh of low bushes standing on the ground inside the gorse areas", () => {
    const hole = buildHole(def(7));
    const T = terrainOf(hole);
    const mesh = buildGorse(hole, T, "high", [])!;
    expect(mesh).toBeTruthy();
    expect(mesh.count).toBeGreaterThan(80);
    const m = mesh.matrix.clone();
    for (let i = 0; i < mesh.count; i += 7) {
      mesh.getMatrixAt(i, m);
      const e = m.elements;
      expect(hole.surfaceAt(e[12], e[14])).toBe("gorse");
      expect(Math.abs(e[13] - T.y(e[12], e[14]))).toBeLessThan(0.2);
      // low: a bush is never above two metres
      expect(e[5]).toBeLessThan(2.5);
    }
    // fewer on a phone, fewer again with no GPU
    expect(buildGorse(hole, T, "low", [])!.count).toBeLessThan(mesh.count);
    expect(buildGorse(hole, T, "soft", [])!.count).toBeLessThan(buildGorse(hole, T, "low", [])!.count);
  });
  it("none on a hole without gorse", () => {
    const h = buildHole(HOLE_DEFS[1]);
    expect(buildGorse(h, terrainOf(h), "high", [])).toBeNull();
  });
});

describe("hitting a wall", () => {
  it("is called when the ball strikes one", () => {
    // a ball two metres from the wall that runs down the right of hole 7, struck at it: too low to clear it
    const g = new CourseGame({ seed: 5, holes: [def(7)], hills: true });
    g.key({ key: " " }, true);
    g.wind = [0, 0];
    g.ball = [27.5 * YD, 150 * YD];
    g.setAim(Math.PI / 2);
    g.yaw = g.yawT;
    g.setClub(3);
    g.remoteSwing({ power: 0.8, face: 0, curve: 0, contact: 1 });
    for (let i = 0; i < 60 * 12 && g.phase !== "rest"; i++) g.step(STEP);
    expect(g.shot!.prop?.kind).toBe("wall");
    expect(g.said[g.said.length - 1]).toMatch(/Hit the wall\./);
  });
});
