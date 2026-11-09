import type { BuiltHole } from "@/components/offhours/golf/course";
import type { Putt } from "@/components/offhours/golf/green";
import { reliefOf } from "./relief";
import type { View } from "./flyover";

// The camera on the green (no three.js here: the page steps it, render3d draws
// through it). Low behind the ball, looking down the line to the cup.

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** the focal length for the putting camera: a little longer than the course's, so the line reads */
export const puttF = (w: number, h: number) => Math.max(h * 0.85, Math.min(h * 1.15, w * 0.9));

/**
 * The camera behind a ball on the green, looking along `yaw` (radians, in the green's coordinates): higher and further
 * back on a longer putt, the ball low in the frame and the line running up it to the cup.
 */
export function puttView(hole: BuiltHole, ball: [number, number], yaw: number, w: number, h: number): View {
  const rel = reliefOf(hole);
  const [cx, cy] = hole.green.cup;
  const dist = Math.min(18, Math.hypot(cx - ball[0], cy - ball[1]));
  const [bx, bz] = hole.fromGreen(ball[0], ball[1]);
  const by = rel.yG(ball[0], ball[1]);
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);
  const back = 1.7 + 0.2 * dist, up = 0.95 + 0.11 * dist;
  const F = puttF(w, h);
  // aim the camera so the ball sits about 70% of the way down the frame (the projection centre is at 40%)
  const down = Math.atan2(up, back) - Math.atan2(0.3 * h, F);
  const D = down > 0.035 ? up / Math.tan(down) : 30;
  return { x: bx - ux * back, y: by + up, z: bz - uz * back, tx: bx + ux * (D - back), ty: by, tz: bz + uz * (D - back), F };
}

/** a view part of the way from a to b, with `k` the share of the way */
function toward(a: View, b: View, k: number): View {
  const l = (p: number, q: number) => p + (q - p) * k;
  return { x: l(a.x, b.x), y: l(a.y, b.y), z: l(a.z, b.z), tx: l(a.tx, b.tx), ty: l(a.ty, b.ty), tz: l(a.tz, b.tz), F: l(a.F, b.F) };
}

/**
 * The putting camera from one frame to the next: it eases in from wherever the game's camera was, turns with the aim
 * keys, holds still while a putt is pulled back (the pull is measured on screen), and watches the ball once it rolls.
 */
export class PuttCam {
  private v: View | null = null;
  /** where the camera stands for the putt being played (it may not have got there yet) */
  private addr: View | null = null;
  private yaw = 0;
  reset() {
    this.v = null;
    this.addr = null;
  }
  step(hole: BuiltHole, p: Putt, w: number, h: number, dt: number, from: View, reduce: boolean): View {
    const b = p.ball;
    if (!this.v || !this.addr) {
      this.v = { ...from };
      this.yaw = p.kAngle;
      this.addr = puttView(hole, [b.x, b.y], this.yaw, w, h);
    }
    const rolling = b.moving || b.sunk || !!p.tap || (!!p.putter && p.putter.hit);
    let want: View;
    if (rolling) {
      // stand where the putt was played from and turn to follow the ball, looking a little past it toward the cup so
      // both stay in the frame
      const [cx, cy] = hole.green.cup;
      const lx = b.x + (cx - b.x) * 0.4, ly = b.y + (cy - b.y) * 0.4;
      const [fx, fz] = hole.fromGreen(lx, ly);
      // half way to the address view's own look point, so a short putt does not tip the camera down into the cup
      const a = this.addr;
      want = { ...a, tx: (a.tx + fx) / 2, ty: (a.ty + reliefOf(hole).yG(lx, ly)) / 2, tz: (a.tz + fz) / 2 };
    } else if (p.aiming || p.putter) {
      want = this.v;
    } else {
      this.yaw += wrap(p.kAngle - this.yaw) * (reduce ? 1 : 1 - Math.exp(-dt * 7));
      want = this.addr = puttView(hole, [b.x, b.y], this.yaw, w, h);
    }
    this.v = reduce ? want : toward(this.v, want, 1 - Math.exp(-dt * (rolling ? 5 : 3.2)));
    return this.v;
  }
}
