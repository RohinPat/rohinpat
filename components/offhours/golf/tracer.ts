import { at, type Shot } from "./flight";
import type { Cam } from "./scene";

type V = [number, number, number];

/**
 * A ball's flight as a line in the picture: a soft glow under a bright core, up to time `upTo`. The line is clipped in
 * camera space against a near plane, so nothing behind (or beside) the camera can wrap around the screen. `ox`, `oz`
 * move a shot that was flown from the ball into the world it is drawn in; `yOf` turns a point's height (over the ground
 * it was struck from) into the height it is drawn at (by default, never under 0).
 */
export function trace(ctx: CanvasRenderingContext2D, cam: Cam, sh: Shot, upTo: number, glow: number, core: number, col: string, ox = 0, oz = 0, yOf: (x: number, y: number, z: number) => number = (_x, y) => Math.max(0, y)) {
  const pts = sh.pts, n = sh.n;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const draw = (lw: number, style: string) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    ctx.beginPath();
    const NEARZ = 1.2;
    let prev: V | null = null;
    let pen = false;
    const emit = (c: V, first: boolean) => {
      const k = cam.F / c[2];
      const x = cam.cx + c[0] * k, y = cam.cy - c[1] * k;
      if (first) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    };
    const toCam = (x: number, y: number, z: number): V => {
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      return [dx * cam.rx + dy * cam.ry + dz * cam.rz, dx * cam.ux + dy * cam.uy + dz * cam.uz, dx * cam.fx + dy * cam.fy + dz * cam.fz];
    };
    const feed = (x: number, y: number, z: number) => {
      const c = toCam(x + ox, yOf(x + ox, y, z + oz), z + oz);
      if (prev) {
        const a = prev, inA = a[2] >= NEARZ, inB = c[2] >= NEARZ;
        if (inA !== inB) {
          const u = (NEARZ - a[2]) / (c[2] - a[2]);
          const m: V = [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, NEARZ];
          if (inA) {
            if (!pen) emit(a, true);
            emit(m, false);
            pen = false;
          } else {
            emit(m, true);
            pen = true;
          }
        }
        if (inB) {
          if (!pen) {
            emit(c, true);
            pen = true;
          } else emit(c, false);
        } else pen = false;
      } else if (c[2] >= NEARZ) {
        emit(c, true);
        pen = true;
      }
      prev = c;
    };
    for (let i = 0; i < n; i++) {
      const i4 = i * 4;
      if (pts[i4] > upTo) break;
      feed(pts[i4 + 1], pts[i4 + 2], pts[i4 + 3]);
    }
    if (upTo < pts[(n - 1) * 4]) {
      const e = at(sh, upTo);
      feed(e[0], e[1], e[2]);
    }
    ctx.stroke();
  };
  if (glow) draw(glow, "rgba(255,70,50,0.22)");
  draw(core, col);
}
