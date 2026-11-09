import type { BuiltHole } from "@/components/offhours/golf/course";
import { GH, GW, greenHeight, shapeR } from "@/components/offhours/golf/green";

// The green's shape in 3D: the putting surface is the putt's own height field
// (green.ts), so what you see is what the ball rolls on, raised a little above the
// flat course and eased down to it in a short bank past the fringe. Everywhere
// else the ground is flat, as the shots' physics has it.

/** past the fringe the surface holds its height this far, m (a ball putted from just off the green rolls on it), then banks down over BANK m */
export const HOLD = 1;
export const BANK = 2.5;
/** the bank's outer edge: the extent of the raised ground around the middle of the green, in green coordinates */
export const PAD = 6.5;

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export type Relief = {
  /** the ground's height at a course point, m: 0 away from the green */
  y: (x: number, z: number) => number;
  /** the same in the green's own coordinates */
  yG: (gx: number, gy: number) => number;
  /** the lowest point of the green's height field under the raised ground (the surface sits on it) */
  base: number;
};

const cache = new WeakMap<BuiltHole, Relief>();

/** how far outside the fringe a green point is, m, measured out from the middle of the green (negative inside) */
function outside(hole: BuiltHole, gx: number, gy: number) {
  const dx = gx - GW / 2, dy = gy - GH / 2;
  const u = dx / (GW / 2), v = dy / (GH / 2);
  const rho = Math.hypot(u, v);
  if (rho < 1e-9) return -GH / 2;
  // the green is an oval: a step in rho is longer along its long axis
  return ((rho - shapeR(hole.green, Math.atan2(v, u)) - 0.085) * Math.hypot(dx, dy)) / rho;
}

export function reliefOf(hole: BuiltHole): Relief {
  const got = cache.get(hole);
  if (got) return got;
  const H = hole.green;
  const fade = (gx: number, gy: number) => 1 - smooth((outside(hole, gx, gy) - HOLD) / BANK);
  let base = Infinity;
  for (let gy = -PAD; gy <= GH + PAD; gy += 0.25)
    for (let gx = -PAD; gx <= GW + PAD; gx += 0.25) if (fade(gx, gy) > 0) base = Math.min(base, greenHeight(H, gx, gy));
  if (!Number.isFinite(base)) base = 0;
  const yG = (gx: number, gy: number) => {
    if (gx < -PAD || gx > GW + PAD || gy < -PAD || gy > GH + PAD) return 0;
    const f = fade(gx, gy);
    return f > 0 ? f * (greenHeight(H, gx, gy) - base + 0.03) : 0;
  };
  const r: Relief = {
    yG,
    y: (x, z) => {
      const [gx, gy] = hole.toGreen(x, z);
      return yG(gx, gy);
    },
    base,
  };
  cache.set(hole, r);
  return r;
}
