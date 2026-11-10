import { describe, expect, it } from "vitest";
import { CLUBS, simulate, type ShotIn } from "@/components/offhours/golf/flight";
import { HOLE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { CourseGame, REST_HOLD, STEP } from "@/components/offhours/golf/play";
import { paint } from "@/components/offhours/golf/playDraw";
import { YD } from "@/components/offhours/golf/scene";
import { replayBall, replayView } from "@/components/golf3d/replay";
import { fakeCtx } from "./golf-headless";

// Game feel (phase 6): a ball that rolls into the cup from off the green is
// holed, and a great shot (holed, stiff, or a big drive) is played again from a
// camera by where it finished, before the next one. A press skips it.

const run = (g: CourseGame, until: () => boolean, max = 40) => {
  const t0 = g.t;
  while (!until() && g.t - t0 < max) g.step(STEP);
  return until();
};
const ptr = { x: 0, y: 0, inside: false };

/** hole 1 alone, the ball on the fairway `yd` short of the pin, aimed at it, no wind */
function chipFrom(yd: number, opts: { replays?: boolean } = {}) {
  const g = new CourseGame({ seed: 5, holes: [HOLE_DEFS[0]], ...opts });
  run(g, () => g.phase === "ready");
  const [px, pz] = g.hole.pin;
  g.ball = [px, pz - yd * YD];
  g.lie = "fairway";
  g.strokes = 2;
  g.setAim(0);
  g.wind = [0, 0];
  g.setClub(CLUBS.length - 1);
  return g;
}
/** a chip that goes in: the power, found by trying them (each try is the same strike, so the first that holes is the one) */
function holingPower(yd: number) {
  for (let p = 0.05; p <= 0.7; p += 0.0015) {
    const g = chipFrom(yd);
    g.remoteSwing({ power: p, face: 0, curve: 0, contact: 1 });
    run(g, () => g.phase === "rest");
    if (g.shot?.holed) return p;
  }
  return null;
}

describe("into the hole from off the green", () => {
  const shot = (over: Partial<ShotIn>): ShotIn => ({ club: CLUBS[5], speed: 0.3, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: () => "green", ...over });
  it("a ball rolling slowly over the cup drops; a fast one runs over it; without a cup nothing changes", () => {
    const free = simulate(shot({}));
    const n = free.n - 1;
    const restZ = free.pts[n * 4 + 3];
    // the cup where it would have stopped, and a little short of it (it is still rolling there, slowly)
    const atRest = simulate(shot({ cup: [0, restZ - 0.3] }));
    expect(atRest.holed).toBe(true);
    expect(atRest.pts[(atRest.n - 1) * 4 + 3]).toBeCloseTo(restZ - 0.3, 6);
    expect(atRest.restT).toBeLessThan(free.restT);
    // on the line, but where the ball is still rolling quickly (over 2 m/s between samples a 60th of a second apart)
    // (a low running 3 wood)
    const runner = simulate(shot({ club: CLUBS[1], speed: 0.4 }));
    const last = runner.bounces[runner.bounces.length - 1];
    let quick = -1;
    for (let i = 1; i < runner.n && quick < 0; i++) if (runner.pts[i * 4] > last.t + 0.05 && runner.pts[i * 4 + 2] < 0.01 && runner.pts[i * 4 + 3] - runner.pts[i * 4 - 1] > 2 / 60) quick = runner.pts[i * 4 + 3];
    expect(quick).toBeGreaterThan(0);
    expect(simulate(shot({ club: CLUBS[1], speed: 0.4, cup: [0, quick] })).holed).toBe(false);
    // off the line
    expect(simulate(shot({ cup: [0.3, restZ] })).holed).toBe(false);
    expect(free.holed).toBe(false);
    expect(Array.from(simulate(shot({ cup: [50, 50] })).pts)).toEqual(Array.from(free.pts));
  });

  it("a chip in ends the hole for the strokes played, says so, and needs no putt", () => {
    const p = holingPower(20);
    expect(p).not.toBeNull();
    const g = chipFrom(20);
    const said: string[] = [];
    g.opts.say = (m) => said.push(m);
    g.remoteSwing({ power: p!, face: 0, curve: 0, contact: 1 });
    expect(run(g, () => g.phase === "rest")).toBe(true);
    expect(g.result).toBe("IN THE HOLE");
    expect(said.some((m) => /In the hole/.test(m))).toBe(true);
    expect(run(g, () => g.phase === "hole-card")).toBe(true);
    expect(g.scores[0].strokes).toBe(3);
    expect(g.stats[0].putts).toBe(0);
  });
});

describe("replays", () => {
  it("a holed shot is played again from a camera by the cup, then the hole ends", () => {
    const p = holingPower(20)!;
    const g = chipFrom(20, { replays: true });
    g.remoteSwing({ power: p, face: 0, curve: 0, contact: 1 });
    run(g, () => g.phase === "rest");
    // the live shot is held first, then the replay
    expect(g.replay).toBeNull();
    run(g, () => g.replay !== null);
    expect(g.phaseT).toBeGreaterThanOrEqual(REST_HOLD - STEP);
    const r = g.replay!;
    expect(r.why).toBe("holed");
    expect(r.t).toBeLessThan(r.shot.landT);
    // the camera stands low, near the cup, and looks at the ball
    const v = replayView(g.hole, r, 1280, 800);
    expect(Math.hypot(v.x - g.hole.pin[0], v.z - g.hole.pin[1])).toBeLessThan(12);
    const [bx, , bz] = replayBall(r);
    const look = Math.atan2(v.tx - v.x, v.tz - v.z), toBall = Math.atan2(bx - v.x, bz - v.z);
    expect(Math.abs(Math.atan2(Math.sin(look - toBall), Math.cos(look - toBall)))).toBeLessThan(0.4);
    // the overlay says it is a replay, and draws no flight line over it
    const drawn: string[] = [];
    const ctx = new Proxy(fakeCtx() as object, { get: (t, k) => (k === "fillText" ? (s: string) => drawn.push(s) : Reflect.get(t, k)), set: () => true }) as unknown as CanvasRenderingContext2D;
    paint(ctx, g, 1280, 800, STEP, ptr, { world: false });
    expect(drawn).toContain("REPLAY");
    expect(run(g, () => g.phase === "hole-card", 12)).toBe(true);
    expect(g.replay).toBeNull();
    expect(g.scores[0].strokes).toBe(3);
  });

  it("a press skips it; without replays (or for a dull shot) there is none", () => {
    const p = holingPower(20)!;
    const g = chipFrom(20, { replays: true });
    g.remoteSwing({ power: p, face: 0, curve: 0, contact: 1 });
    run(g, () => g.replay !== null);
    g.key({ key: " " }, true);
    g.step(STEP);
    expect(g.replay).toBeNull();
    expect(g.phase).toBe("hole-card");
    // the same chip with replays off
    const q = chipFrom(20);
    q.remoteSwing({ power: p, face: 0, curve: 0, contact: 1 });
    run(q, () => q.phase === "hole-card");
    expect(q.replay).toBeNull();
    // a chip that finishes well away from the pin is not replayed
    const d = chipFrom(20, { replays: true });
    d.remoteSwing({ power: p * 0.6, face: 0, curve: 0, contact: 1 });
    run(d, () => d.phase !== "rest" && d.phase !== "fly" && d.phase !== "swing");
    expect(d.replay).toBeNull();
    expect(d.phase).not.toBe("hole-card");
  });

  it("a big drive is replayed from further off, and the camera never goes into the ground", () => {
    const hole = buildHole(HOLE_DEFS[0]);
    const g = new CourseGame({ seed: 5, holes: [HOLE_DEFS[0]], replays: true, hills: true });
    run(g, () => g.phase === "ready");
    g.wind = [0, 3];
    g.setClub(0);
    g.remoteSwing({ power: 1, face: 0, curve: 0, contact: 1 });
    run(g, () => g.phase === "rest");
    expect(g.shot!.total).toBeGreaterThanOrEqual(275);
    run(g, () => g.replay !== null);
    const r = g.replay!;
    expect(r.why).toBe("long");
    for (; g.replay; g.step(STEP)) {
      const v = replayView(hole, r, 1280, 800);
      expect(v.y).toBeGreaterThan(g.terrain.y(v.x, v.z) + 1);
    }
    expect(g.phase).toBe("ready");
  });
});
