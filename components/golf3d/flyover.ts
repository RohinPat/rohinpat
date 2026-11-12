import type { BuiltHole } from "@/components/offhours/golf/course";
import { heroOf, along, pathOf } from "@/components/offhours/golf/sightline";
import { terrainOf } from "@/components/offhours/golf/terrain";

// The hole from the air, while its card is up: the camera starts high over the
// green and glides back down the middle of the hole to the tee, looking ahead the
// whole way, and settles behind the golfer where the game's own camera waits.

export type View = { x: number; y: number; z: number; tx: number; ty: number; tz: number; F: number };

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** how long the flyover lasts, s: longer on a longer hole */
export const flyoverS = (yards: number) => clamp(2.6 + yards / 210, 3, 5);

type Path = ReturnType<typeof pathOf>;

const paths = new WeakMap<BuiltHole, Path>();
const pathFor = (hole: BuiltHole): Path => {
  let p = paths.get(hole);
  if (!p) paths.set(hole, (p = pathOf(hole)));
  return p;
};

/** how much of the flyover's time is spent near the hero shot: the eye is slowest, and lowest, at the crest or over the carry */
const LINGER = 1.8;
const bell = (u: number) => (u <= 0 ? 1 : u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u));

const warps = new WeakMap<BuiltHole, number[] | null>();
/**
 * The flyover's pace along a hole with a hero shot: where along the hole (0 at the green, 1 at the tee) the eye is at
 * each share of the time, slowed near the crest or the carry. A table, since it is the inverse of a density.
 */
function warpOf(hole: BuiltHole, hero: number): number[] {
  let t = warps.get(hole);
  if (t === undefined) {
    const p = pathFor(hole);
    const N = 64;
    const cum = [0];
    for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + 1 + LINGER * bell(Math.abs(p.total * (1 - (i - 0.5) / N) - hero) / 80));
    t = cum.map((c) => c / cum[N]);
    warps.set(hole, t);
  }
  return t!;
}
/** the share k of the way along the hole's path for the share f of the time, by the table */
const warp = (t: number[], f: number) => {
  let lo = 0;
  while (lo < t.length - 2 && t[lo + 1] < f) lo++;
  return (lo + (f - t[lo]) / Math.max(1e-9, t[lo + 1] - t[lo])) / (t.length - 1);
};

/**
 * The flyover at `u` (0 to 1) of the way through, ending at `end` (the game's camera at address). w and h set the zoom.
 */
export function flyoverView(hole: BuiltHole, u: number, w: number, h: number, end: View): View {
  const p = pathFor(hole);
  const F0 = Math.max(w * 0.9, h * 1.1);
  // a hole with a hero shot (a crest, a carry) lingers there, low, and the eye looks out over it
  const hero = heroOf(hole);
  const f = smooth(clamp(u / 0.86, 0, 1));
  const k = hero ? warp(warpOf(hole, hero.s), f) : f;
  // where the eye is along the hole: from short of the green, looking at it, back to the tee
  const s = p.total * (1 - k);
  const [ex, ez] = along(p, s - 75);
  const [tx, tz] = along(p, s + 25 * (1 - k) + 60 * k);
  let high = 10 + 30 * (1 - k) + 18 * Math.sin(Math.PI * k);
  // low over the crest or the water: close enough to feel the drop, high enough to clear the ground
  if (hero) high += (4 - high) * 0.95 * bell(Math.abs(s - hero.s) / 95);
  const G = terrainOf(hole).y;
  const v: View = { x: ex, y: Math.max(G(ex, ez), G(tx, tz)) + high, z: ez, tx, ty: G(tx, tz), tz, F: F0 };
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
  const p = pathFor(hole);
  const [mx, mz] = along(p, p.total * 0.55);
  const a = -2.4 + t * 0.045;
  const R = 150 + p.total * 0.3;
  const my = terrainOf(hole).y(mx, mz);
  return { x: mx + Math.sin(a) * R, y: my + 95 + p.total * 0.12, z: mz + Math.cos(a) * R, tx: mx, ty: my, tz: mz, F: Math.max(w * 0.9, h * 1.1) };
}
