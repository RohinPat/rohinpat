import { describe, expect, it } from "vitest";
import { HOLE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { GH, GW, greenHeight, newPutt, puttAim, puttBegin, puttLayout, puttPointer, zone, type PuttProj } from "@/components/offhours/golf/green";
import { reliefOf } from "@/components/golf3d/relief";
import { PuttCam, puttView } from "@/components/golf3d/puttcam";
import type { View } from "@/components/golf3d/flyover";

// Putting on the 3D green: the surface you see is the one the ball rolls on, the
// camera behind the ball frames the ball and the cup, and a pull-back reads the
// same through the 3D camera as through the top-down view.

const holes = HOLE_DEFS.map((d) => buildHole(d));
const env = { play: true, say: () => {} };

/** a point on screen through a view, the way render3d's camera sees it (projection centre at 40% of the height) */
function project(v: View, p: [number, number, number], w: number, h: number) {
  const f = [v.tx - v.x, v.ty - v.y, v.tz - v.z];
  const fl = Math.hypot(f[0], f[1], f[2]);
  f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const r = [f[2], 0, -f[0]];
  const rl = Math.hypot(r[0], r[2]);
  r[0] /= rl; r[2] /= rl;
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const d = [p[0] - v.x, p[1] - v.y, p[2] - v.z];
  const zc = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  return { x: w / 2 + (v.F * (d[0] * r[0] + d[2] * r[2])) / zc, y: 0.4 * h - (v.F * (d[0] * u[0] + d[1] * u[1] + d[2] * u[2])) / zc, z: zc };
}

describe("the green's relief", () => {
  it("is flat ground away from the green and never below it", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      expect(rel.y(0, 0)).toBe(0); // the tee
      for (let gy = -8; gy <= GH + 8; gy += 0.7) for (let gx = -8; gx <= GW + 8; gx += 0.7) expect(rel.yG(gx, gy)).toBeGreaterThanOrEqual(0);
      expect(rel.yG(-8, -8)).toBe(0);
    }
  });
  it("slopes exactly as the putt's green does wherever a putt is played", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const e = 0.01;
      for (let gy = 0.5; gy < GH; gy += 0.9)
        for (let gx = 0.5; gx < GW; gx += 0.9) {
          if (zone(hole.green, gx, gy) === 2) continue;
          const sx = (rel.yG(gx + e, gy) - rel.yG(gx - e, gy)) / (2 * e);
          const px = (greenHeight(hole.green, gx + e, gy) - greenHeight(hole.green, gx - e, gy)) / (2 * e);
          expect(sx).toBeCloseTo(px, 6);
        }
    }
  });
  it("rises gently: no step at the bank's foot", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      // walk out from the middle of the green along a few rays
      for (let a = 0; a < 6.28; a += 0.7) {
        let prev = rel.yG(GW / 2, GH / 2);
        for (let s = 0; s < 18; s += 0.05) {
          const y = rel.yG(GW / 2 + Math.cos(a) * s, GH / 2 + Math.sin(a) * s);
          expect(Math.abs(y - prev)).toBeLessThan(0.03);
          prev = y;
        }
        expect(prev).toBe(0);
      }
    }
  });
});

describe("the putting camera", () => {
  it("puts the ball low in the frame and the cup in view, at any length of putt", () => {
    for (const [w, h] of [
      [1280, 748],
      [414, 816],
    ]) {
      for (const hole of holes) {
        const [cx, cy] = hole.green.cup;
        for (const d of [0.6, 2, 5, 9, 14]) {
          const ball: [number, number] = [cx - d, cy];
          const v = puttView(hole, ball, 0, w, h);
          const rel = reliefOf(hole);
          const [bx, bz] = hole.fromGreen(ball[0], ball[1]);
          const b = project(v, [bx, rel.y(bx, bz), bz], w, h);
          expect(b.y / h, `${hole.def.n} ${d}`).toBeGreaterThan(0.62);
          expect(b.y / h).toBeLessThan(0.78);
          expect(Math.abs(b.x - w / 2)).toBeLessThan(1);
          const [kx, kz] = hole.fromGreen(cx, cy);
          const c = project(v, [kx, rel.y(kx, kz), kz], w, h);
          expect(c.z).toBeGreaterThan(0);
          expect(c.y / h, `${hole.def.n} ${d}`).toBeGreaterThan(0.08);
          expect(c.y).toBeLessThan(b.y);
        }
      }
    }
  });

  it("eases in from the game's camera, holds still while a putt is pulled back, and snaps when motion is reduced", () => {
    const hole = holes[0];
    const p = newPutt();
    const [cx, cy] = hole.green.cup;
    puttBegin(p, hole.green, [cx - 5, cy + 1], 2, { pickUp: 9, onDone: () => {} }, 0, true);
    const from: View = { x: 0, y: 30, z: 200, tx: 0, ty: 0, tz: 300, F: 900 };
    const want = puttView(hole, [p.ball.x, p.ball.y], p.kAngle, 1280, 800);
    const cam = new PuttCam();
    let v = cam.step(hole, p, 1280, 800, 1 / 60, from, false);
    expect(v.y).toBeGreaterThan(from.y * 0.9);
    for (let i = 0; i < 240; i++) v = cam.step(hole, p, 1280, 800, 1 / 60, from, false);
    expect(Math.hypot(v.x - want.x, v.z - want.z)).toBeLessThan(0.05);
    // a pull-back: the aim keys would turn it, but the press holds it
    p.aiming = true;
    p.kAngle += 0.5;
    const held = cam.step(hole, p, 1280, 800, 1 / 60, from, false);
    expect(held).toEqual(v);
    p.aiming = false;
    const snap = new PuttCam();
    expect(snap.step(hole, p, 1280, 800, 1 / 60, from, true)).toEqual(puttView(hole, [p.ball.x, p.ball.y], p.kAngle, 1280, 800));
  });
});

describe("the pull-back through another camera", () => {
  it("putts the same way as the top-down view when the camera maps the same", () => {
    const hole = holes[2];
    const run = (proj: PuttProj | null) => {
      const p = newPutt();
      const [cx, cy] = hole.green.cup;
      puttBegin(p, hole.green, [cx - 4, cy + 2], 1, { pickUp: 9, onDone: () => {} }, 0, true);
      puttLayout(p, 1000, 700, true);
      p.proj = proj;
      puttPointer(p, "down", 500, 300, 0, env);
      puttPointer(p, "move", 470, 420, 0, env);
      const aim = puttAim(p, 0);
      puttPointer(p, "up", 470, 420, 0, env);
      return { aim, putter: p.putter };
    };
    const flat = run(null);
    // the same mapping, handed in from outside
    const sim = (() => {
      const p = newPutt();
      puttLayout(p, 1000, 700, true);
      return p.view;
    })();
    const proj: PuttProj = {
      toScreen: (x, y) => ({ x: sim.cx + (x - GW / 2) * sim.sc, y: sim.cy + (y - GH / 2) * sim.sc }),
      toGreen: (px, py) => ({ x: GW / 2 + (px - sim.cx) / sim.sc, y: GH / 2 + (py - sim.cy) / sim.sc }),
    };
    const mapped = run(proj);
    expect(flat.aim).not.toBeNull();
    expect(mapped.aim!.dx).toBeCloseTo(flat.aim!.dx, 9);
    expect(mapped.aim!.dy).toBeCloseTo(flat.aim!.dy, 9);
    expect(mapped.aim!.pow).toBeCloseTo(flat.aim!.pow, 9);
    expect(mapped.putter!.dx).toBeCloseTo(flat.putter!.dx, 9);
    // pulled down and a little left: the putt goes up and a little right
    expect(flat.aim!.dy).toBeLessThan(-0.9);
    expect(flat.aim!.dx).toBeGreaterThan(0);
  });

  it("a press off the ground (above the horizon) does nothing", () => {
    const hole = holes[0];
    const p = newPutt();
    const [cx, cy] = hole.green.cup;
    puttBegin(p, hole.green, [cx - 4, cy], 1, { pickUp: 9, onDone: () => {} }, 0, true);
    puttLayout(p, 1000, 700, true);
    p.proj = { toScreen: () => ({ x: 500, y: 500 }), toGreen: (px, py) => (py < 200 ? null : { x: px / 50, y: py / 50 }) };
    puttPointer(p, "down", 500, 500, 0, env);
    puttPointer(p, "move", 500, 100, 0, env);
    expect(puttAim(p, 0)).toBeNull();
    puttPointer(p, "up", 500, 100, 0, env);
    expect(p.putter).toBeNull();
  });
});
