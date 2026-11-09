import type { BuiltHole } from "@/components/offhours/golf/course";

// The hole from the air, while its card is up: the camera starts high over the
// green and glides back down the middle of the hole to the tee, looking ahead the
// whole way, and settles behind the golfer where the game's own camera waits.

export type View = { x: number; y: number; z: number; tx: number; ty: number; tz: number; F: number };

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** how long the flyover lasts, s: longer on a longer hole */
export const flyoverS = (yards: number) => clamp(2.6 + yards / 210, 3, 5);

type Path = { pts: [number, number][]; len: number[]; total: number };

const paths = new WeakMap<BuiltHole, Path>();

/** the middle of the hole from the tee to the pin, with the distance along it at each point */
function pathOf(hole: BuiltHole): Path {
  const got = paths.get(hole);
  if (got) return got;
  const [px, pz] = hole.pin;
  let cut = hole.line.length - 1, best = Infinity;
  hole.line.forEach(([x, z], i) => {
    const d = Math.hypot(x - px, z - pz);
    if (d < best) [best, cut] = [d, i];
  });
  const pts: [number, number][] = [[0, 0], ...hole.line.slice(1, cut + 1), [px, pz]];
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const p = { pts, len, total: len[len.length - 1] };
  paths.set(hole, p);
  return p;
}

/** the point `s` metres along the path (past either end, the end) */
function along(p: Path, s: number): [number, number] {
  s = clamp(s, 0, p.total);
  let i = 1;
  while (i < p.len.length - 1 && p.len[i] < s) i++;
  const a = p.pts[i - 1], b = p.pts[i];
  const k = (s - p.len[i - 1]) / Math.max(1e-6, p.len[i] - p.len[i - 1]);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/**
 * The flyover at `u` (0 to 1) of the way through, ending at `end` (the game's camera at address). w and h set the zoom.
 */
export function flyoverView(hole: BuiltHole, u: number, w: number, h: number, end: View): View {
  const p = pathOf(hole);
  const F0 = Math.max(w * 0.9, h * 1.1);
  const k = smooth(clamp(u / 0.86, 0, 1));
  // where the eye is along the hole: from short of the green, looking at it, back to the tee
  const s = p.total * (1 - k);
  const [ex, ez] = along(p, s - 75);
  const [tx, tz] = along(p, s + 25 * (1 - k) + 60 * k);
  const high = 10 + 30 * (1 - k) + 18 * Math.sin(Math.PI * k);
  const v: View = { x: ex, y: high, z: ez, tx, ty: 0, tz, F: F0 };
  // the last stretch eases into the game's camera
  const m = smooth(clamp((u - 0.72) / 0.28, 0, 1));
  if (m <= 0) return v;
  if (m >= 1) return { ...end };
  return mixView(v, end, m);
}

/** a view part of the way from a to b */
export function mixView(a: View, b: View, m: number): View {
  const l = (p: number, q: number) => p + (q - p) * m;
  return { x: l(a.x, b.x), y: l(a.y, b.y), z: l(a.z, b.z), tx: l(a.tx, b.tx), ty: l(a.ty, b.ty), tz: l(a.tz, b.tz), F: l(a.F, b.F) };
}

/** the title screen: a slow circle high over the hole, looking at its middle (t in seconds) */
export function titleView(hole: BuiltHole, t: number, w: number, h: number): View {
  const p = pathOf(hole);
  const [mx, mz] = along(p, p.total * 0.55);
  const a = -2.4 + t * 0.045;
  const R = 150 + p.total * 0.3;
  return { x: mx + Math.sin(a) * R, y: 95 + p.total * 0.12, z: mz + Math.cos(a) * R, tx: mx, ty: 0, tz: mz, F: Math.max(w * 0.9, h * 1.1) };
}
