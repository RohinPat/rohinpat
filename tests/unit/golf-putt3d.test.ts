import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HOLE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { GH, GW, ftOf, flatRoll, greenHeight, newPutt, puttAim, puttBegin, puttCupPow, puttLayout, puttMeter, puttPointer, puttPowerFor, puttRoll, puttShoot, puttStep, zone, type Hole, type PuttProj } from "@/components/offhours/golf/green";
import { reliefOf } from "@/components/golf3d/relief";
import { createPutt3D } from "@/components/golf3d/putt3d";
import { PuttCam, puttView } from "@/components/golf3d/puttcam";
import type { View } from "@/components/golf3d/flyover";

// Putting on the 3D green: the surface you see is the one the ball rolls on, the
// camera behind the ball frames the ball and the cup, and a pull-back reads the
// same through the 3D camera as through the top-down view.

const holes = HOLE_DEFS.map((d) => buildHole(d));
const env = { play: true, say: () => {} };

/** a spot 6 m from the cup on a straight line that stays on the green, where the break is biggest */
function breakSpot(H: Hole) {
  const [cx, cy] = H.cup;
  let best: { b: [number, number]; ux: number; uy: number; lat: number } | null = null;
  for (let a = 0; a < 360; a += 2) {
    const r = (a * Math.PI) / 180;
    const b: [number, number] = [cx + 6 * Math.cos(r), cy + 6 * Math.sin(r)];
    let ok = true;
    for (let k = 0; k <= 20 && ok; k++) {
      const u = k / 20;
      ok = zone(H, b[0] + (cx - b[0]) * u, b[1] + (cy - b[1]) * u) === 0;
    }
    if (!ok) continue;
    const ux = (cx - b[0]) / 6, uy = (cy - b[1]) / 6;
    const e = 0.01;
    const gx = (greenHeight(H, b[0] + e, b[1]) - greenHeight(H, b[0] - e, b[1])) / (2 * e);
    const gy = (greenHeight(H, b[0], b[1] + e) - greenHeight(H, b[0], b[1] - e)) / (2 * e);
    // the ball is pulled downhill: its sideways push, along the line's left (-uy, ux)
    const lat = -(gx * -uy + gy * ux);
    if (!best || Math.abs(lat) > Math.abs(best.lat)) best = { b, ux, uy, lat };
  }
  return best!;
}

/** the putt struck for real (puttShoot, then puttStep at 60 fps), sampled once a frame: where it is at each distance along */
function realPutt(H: Hole, ball: [number, number], ang: number, pow: number) {
  const p = newPutt();
  puttBegin(p, H, ball, 0, { pickUp: 9, onDone: () => {} }, 0, true);
  puttShoot(p, ang, pow, 0, env);
  const frames: { x: number; y: number; s: number }[] = [];
  let s = 0, px = ball[0], py = ball[1], t = 0;
  for (let i = 0; i < 4000; i++) {
    puttStep(p, 1 / 60, t, env);
    t += 1 / 60;
    if (p.ball.moving || p.ball.sunk) {
      s += Math.hypot(p.ball.x - px, p.ball.y - py);
      px = p.ball.x;
      py = p.ball.y;
      frames.push({ x: px, y: py, s });
    }
    if (frames.length && !p.ball.moving) break;
  }
  return frames;
}

/** where a roll is at `s` along it */

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
  it("rises off its pad and nowhere else", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      for (let gy = -8; gy <= GH + 8; gy += 0.7) for (let gx = -8; gx <= GW + 8; gx += 0.7) expect(rel.rise(gx, gy)).toBeGreaterThanOrEqual(0);
      expect(rel.rise(-8, -8)).toBe(0);
      expect(rel.rise(GW / 2, GH / 2)).toBeGreaterThan(0);
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
    // (it builds every hole's ground: about a second alone, several on a loaded CI box)
  }, 20_000);
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
        expect(rel.rise(GW / 2 + Math.cos(a) * 18, GH / 2 + Math.sin(a) * 18)).toBe(0);
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

// The line on the 3D green: the ball's own roll, shown for its first half.
describe("the aim line is the ball's own roll", () => {
  const DOT_GAP = 0.15;

  function at(pts: { x: number; y: number; s: number }[], s: number) {
    let j = 0;
    while (j < pts.length - 2 && pts[j + 1].s < s) j++;
    const a = pts[j], c = pts[j + 1] ?? a;
    const u = c.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (c.s - a.s))) : 0;
    return { x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u };
  }

  it("the preview matches a real putt's first half within a few cm, and the whole roll's length", () => {
    for (const idx of [2, 5]) {
      const H = holes[idx].green;
      const { b, ux, uy } = breakSpot(H);
      const pow = puttPowerFor(6);
      const preview = puttRoll(H, b[0], b[1], ux, uy, pow);
      const real = realPutt(H, b, Math.atan2(uy, ux), pow);
      expect(Math.abs(real[real.length - 1].s - preview.len)).toBeLessThan(0.05);
      for (const f of real) {
        if (f.s > preview.len / 2) break;
        const q = at(preview.pts, f.s);
        expect(Math.hypot(q.x - f.x, q.y - f.y), `hole ${idx + 1} at ${f.s.toFixed(2)} m`).toBeLessThan(0.05);
      }
    }
  });

  it("on a sideways slope the line bends the way the ball does, and the bend is clear on hole 6 at 6 m", () => {
    const H = holes[5].green;
    const { b, ux, uy, lat } = breakSpot(H);
    expect(Math.abs(lat)).toBeGreaterThan(0.02);
    const roll = puttRoll(H, b[0], b[1], ux, uy, puttPowerFor(6));
    const half = roll.len / 2;
    const mid = at(roll.pts, half);
    // the sideways offset of the line from the straight aim, at the end of the shown half
    const off = (mid.x - b[0]) * -uy + (mid.y - b[1]) * ux;
    expect(Math.sign(off)).toBe(Math.sign(lat));
    expect(Math.abs(off)).toBeGreaterThan(0.3);
  });

  it("the shown part is half the roll's length, dotted to the tick", () => {
    const H = holes[5].green;
    const { b, ux, uy } = breakSpot(H);
    const hole = holes[5];
    const p = newPutt();
    puttBegin(p, H, b, 0, { pickUp: 9, onDone: () => {} }, 0, true);
    p.kAngle = Math.atan2(uy, ux);
    p.kCharging = true;
    p.kPower = puttPowerFor(6);
    const r3 = createPutt3D();
    r3.update(hole, p, 0, true);
    const dots = r3.group.children.find((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const roll = puttRoll(H, b[0], b[1], ux, uy, p.kPower);
    expect(dots.visible).toBe(true);
    expect(Math.abs(dots.count * DOT_GAP - roll.len / 2)).toBeLessThan(DOT_GAP + 0.01);
    r3.dispose();
  });

  it("at address it shows faintly at the suggested pace; while lined up it is full; a moving ball hides it", () => {
    const hole = holes[5];
    const H = hole.green;
    const { b } = breakSpot(H);
    const r3 = createPutt3D();
    const p = newPutt();
    puttBegin(p, H, b, 0, { pickUp: 9, onDone: () => {} }, 0, true);
    const dots = () => r3.group.children.find((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const opacity = () => (dots().material as THREE.MeshBasicMaterial).opacity;
    r3.update(hole, p, 0, true);
    expect(dots().visible).toBe(true);
    expect(opacity()).toBeCloseTo(0.6, 5);
    // the suggested pace (the one that rolls it to the cup on a flat green), shown as the first half of its roll
    const pace = puttCupPow(p);
    const roll = puttRoll(H, b[0], b[1], Math.cos(p.kAngle), Math.sin(p.kAngle), pace);
    expect(Math.abs(dots().count * DOT_GAP - roll.len / 2)).toBeLessThan(DOT_GAP + 0.01);
    p.kCharging = true;
    p.kPower = 0.5;
    r3.update(hole, p, 0, true);
    expect(opacity()).toBeGreaterThan(0.8);
    p.kCharging = false;
    p.ball.moving = true;
    r3.update(hole, p, 0, true);
    expect(dots().visible).toBe(false);
    r3.dispose();
  });
});

describe("the meter reads the real roll, and the cup's tick is the power that holes it", () => {
  /** the spots 6 m from the cup on hole 6's green, on the green all the way to the cup */
  function spotsOn(H: Hole) {
    const out: [number, number][] = [];
    for (let a = 0; a < 360; a += 10) {
      const r = (a * Math.PI) / 180;
      const b: [number, number] = [H.cup[0] + 6 * Math.cos(r), H.cup[1] + 6 * Math.sin(r)];
      if (b[0] < 1.5 || b[0] > GW - 1.5 || b[1] < 1.5 || b[1] > GH - 1.5) continue;
      let ok = true;
      for (let k = 0; k <= 20 && ok; k++) {
        const u = k / 20;
        if (zone(H, b[0] + (H.cup[0] - b[0]) * u, b[1] + (H.cup[1] - b[1]) * u) !== 0) ok = false;
      }
      if (ok) out.push(b);
    }
    return out;
  }
  /** the direction and distance from b to the cup */
  const toCup = (H: Hole, b: [number, number]) => {
    const d = Math.hypot(H.cup[0] - b[0], H.cup[1] - b[1]);
    return { ux: (H.cup[0] - b[0]) / d, uy: (H.cup[1] - b[1]) / d, d };
  };
  /** where a putt struck for real from b at this angle and power comes to rest, projected on the line to the cup, m */
  const realStop = (H: Hole, b: [number, number], ang: number, pow: number) => {
    const fr = realPutt(H, b, ang, pow);
    const last = fr[fr.length - 1];
    const { ux, uy } = toCup(H, b);
    return (last.x - b[0]) * ux + (last.y - b[1]) * uy;
  };
  const SLOPE_M = 0.3048;

  it("the cup's tick is the power that, rolled for real at the cup, stops at the cup's distance (uphill and downhill)", () => {
    const H = holes[5].green;
    const spots = spotsOn(H);
    expect(spots.length).toBeGreaterThan(6);
    for (const b of spots) {
      const p = newPutt();
      puttBegin(p, H, b, 0, { pickUp: 9, onDone: () => {} }, 0, true);
      const { ux, uy, d } = toCup(H, b);
      const pow = puttCupPow(p);
      expect(Math.abs(realStop(H, b, Math.atan2(uy, ux), pow) - d), `spot ${b.map((v) => v.toFixed(2))}`).toBeLessThan(SLOPE_M);
      expect(p.kMark).toBeCloseTo(pow, 9);
    }
  }, 60_000);

  it("the readout is the miss: how far the ball really stops short of or past the cup, or ON PACE within 1 ft", () => {
    const H = holes[5].green;
    for (const b of spotsOn(H).slice(0, 8)) {
      const { ux, uy, d } = toCup(H, b);
      const ang = Math.atan2(uy, ux);
      for (const pow of [0.5, 0.8]) {
        const p = newPutt();
        puttBegin(p, H, b, 0, { pickUp: 9, onDone: () => {} }, 0, true);
        p.kAngle = ang;
        p.kCharging = true;
        p.kPower = pow;
        const m = puttMeter(p, 0);
        const real = realStop(H, b, ang, pow);
        expect(Math.abs(m.miss - ftOf(real - d)), `pow ${pow}`).toBeLessThanOrEqual(1);
        const want = Math.abs(real - d) < SLOPE_M ? "ON PACE" : real < d ? "SHORT" : "LONG";
        expect(m.word, `pow ${pow} real ${real.toFixed(2)} cup ${d.toFixed(2)}`).toBe(want);
      }
    }
  }, 60_000);

  it("PLAYS is the flat distance of the cup's power: further uphill, nearer downhill", () => {
    // the steepest line from 6 m out, on any hole: uphill from the ball is the cup higher than the ball
    let up: { H: Hole; b: [number, number]; h: number } | null = null;
    let down: { H: Hole; b: [number, number]; h: number } | null = null;
    for (const hole of holes)
      for (const b of spotsOn(hole.green)) {
        const h = greenHeight(hole.green, hole.green.cup[0], hole.green.cup[1]) - greenHeight(hole.green, b[0], b[1]);
        if (!up || h > up.h) up = { H: hole.green, b, h };
        if (!down || h < down.h) down = { H: hole.green, b, h };
      }
    expect(up!.h).toBeGreaterThan(0.1);
    expect(down!.h).toBeLessThan(-0.1);
    const plays = (H: Hole, b: [number, number]) => {
      const p = newPutt();
      puttBegin(p, H, b, 0, { pickUp: 9, onDone: () => {} }, 0, true);
      return flatRoll(puttCupPow(p)) - toCup(H, b).d;
    };
    expect(plays(up!.H, up!.b)).toBeGreaterThan(0.05);
    expect(plays(down!.H, down!.b)).toBeLessThan(-0.05);
  }, 120_000);

  it("there is no ring on the green: the curved dots are the only line", () => {
    const hole = holes[5];
    const H = hole.green;
    const { b, ux, uy } = breakSpot(H);
    const r3 = createPutt3D();
    const p = newPutt();
    puttBegin(p, H, b, 0, { pickUp: 9, onDone: () => {} }, 0, true);
    p.kAngle = Math.atan2(uy, ux);
    p.kCharging = true;
    p.kPower = 0.6;
    r3.update(hole, p, 0, true);
    const rings = r3.group.children.filter((o) => (o as THREE.Mesh).geometry instanceof THREE.RingGeometry);
    expect(rings).toHaveLength(0);
    r3.dispose();
  });
});
