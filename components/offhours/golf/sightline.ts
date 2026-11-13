import type { BuiltHole } from "./course";
import { pathInfo } from "./features";
import { YD } from "./scene";
import { terrainOf } from "./terrain";

// What a player can see and be told about a hole, worked out from its ground and its hazards, never typed in:
//   peekRise   how high an eye must stand to see a point over a crest between them
//   analyse    the line of play's heights (the climb, the crest, the drop) and every hazard that crosses it
//   calloutsOf the tee card's call-outs ("climbs 12 m, drops 16 m", "carry 165 to clear")
//   heroOf     where along the hole its hero shot is (the crest, or the middle of the carry): the flyover lingers there
// Everything is a pure function of the hole, cached per hole. Metres in the hole's frame unless a name says yd.

type Ground = (x: number, z: number) => number;
type Pt = [number, number];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The height (m, in the world) an eye at (ex, ez) has to be at to see the point (ax, ay, az) over the ground between
 * them, or `floor` if it already does. Exact (no search): the ray from the eye to the point must pass over every sample
 * of the ground with room to spare, `margin` m at the eye shrinking to a hand's width at the point, so the eye must be
 * at least (g + room - ay * u) / (1 - u) over each sample at the share u of the way. The last stretch before the point
 * is left out (the point may sit on the slope).
 */
export function eyeFor(G: Ground, ex: number, ez: number, ax: number, ay: number, az: number, floor: number, margin = 0.5): number {
  const D = Math.hypot(ax - ex, az - ez);
  if (D < 12) return floor;
  let need = floor;
  const stop = Math.min(0.9, (D - 6) / D);
  for (let d = 5; d < D; d += 4) {
    const u = d / D;
    if (u > stop) break;
    const g = G(ex + ((ax - ex) * d) / D, ez + ((az - ez) * d) / D);
    const e = (g + 0.15 + margin * (1 - u) - ay * u) / (1 - u);
    if (e > need) need = e;
  }
  return need;
}

/** a hazard a shot down the line has to fly over: the distances (yd from the tee, along the line) it begins and ends at */
export type Carry = { from: number; to: number; kind: "water" | "gorse" | "waste" | "oob" | "ravine" };

export type Analysis = {
  /** the line of play from the tee to the pin, with the distance along it at each point, m */
  path: { pts: Pt[]; len: number[]; total: number };
  /** the ground's height at the tee, at the pin, and at its highest and lowest along the line, m */
  tee: number;
  pin: number;
  peak: number;
  low: number;
  /** where along the line (m) the highest ground is */
  peakS: number;
  /** the hazards that cross the line, in order */
  carries: Carry[];
};

const cache = new WeakMap<BuiltHole, Analysis>();

/** the middle of the hole from the tee to the pin, with the distance along it at each point */
export function pathOf(hole: BuiltHole) {
  const [px, pz] = hole.pin;
  let cut = hole.line.length - 1, best = Infinity;
  hole.line.forEach(([x, z], i) => {
    const d = Math.hypot(x - px, z - pz);
    if (d < best) [best, cut] = [d, i];
  });
  const pts: Pt[] = [[0, 0], ...hole.line.slice(1, cut + 1), [px, pz]];
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, len, total: len[len.length - 1] };
}

/** the point `s` metres along a path (past either end, the end) */
export function along(p: Analysis["path"], s: number): Pt {
  s = clamp(s, 0, p.total);
  let i = 1;
  while (i < p.len.length - 1 && p.len[i] < s) i++;
  const a = p.pts[i - 1], b = p.pts[i];
  const k = (s - p.len[i - 1]) / Math.max(1e-6, p.len[i] - p.len[i - 1]);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

export function analyse(hole: BuiltHole): Analysis {
  const got = cache.get(hole);
  if (got) return got;
  const T = terrainOf(hole);
  const path = pathOf(hole);
  const STEP = 2;
  // a ravine: the ground of a `channel` feature, its floor and the foot of its banks
  const ravines = (hole.def.features ?? []).flatMap((f) =>
    f.k === "channel" ? [{ path: f.path.map(([x, z]) => [x * YD, z * YD] as Pt), reach: (f.w / 2 + f.bank * 0.6) * YD }] : [],
  );
  const kindAt = (x: number, z: number): Carry["kind"] | null => {
    const s = hole.surfaceAt(x, z);
    if (s === "water" || s === "gorse" || s === "waste" || s === "oob") return s;
    for (const r of ravines) if (pathInfo(r.path, x, z).d < r.reach) return "ravine";
    return null;
  };
  let tee = T.y(0, 0), peak = -Infinity, low = Infinity, peakS = 0;
  const carries: Carry[] = [];
  let run: { from: number; kind: Carry["kind"] } | null = null;
  for (let s = 0; s <= path.total; s += STEP) {
    const [x, z] = along(path, s);
    const y = T.y(x, z);
    if (y > peak) [peak, peakS] = [y, s];
    if (y < low) low = y;
    const k = s < 4 ? null : kindAt(x, z);
    // (the green and its fringe end a run: a hazard on the pin's own ground is not one to carry)
    if (k && !run) run = { from: s, kind: k };
    else if (run && k !== run.kind) {
      carries.push({ from: run.from / YD, to: s / YD, kind: run.kind });
      run = k ? { from: s, kind: k } : null;
    }
  }
  if (run) carries.push({ from: run.from / YD, to: path.total / YD, kind: run.kind });
  const out: Analysis = { path, tee, pin: T.y(hole.pin[0], hole.pin[1]), peak, low, peakS, carries };
  cache.set(hole, out);
  return out;
}

/** the farthest a tee shot is asked to carry, yd: past this a hazard is the next shot's to worry about */
const REACH_YD = 270;

/** the first hazard on the line a tee shot has to clear (a bunker beside the line is none), or null */
export function firstCarry(hole: BuiltHole): Carry | null {
  const c = analyse(hole).carries.find((k) => k.to <= REACH_YD && k.to - k.from >= 4);
  return c ?? null;
}

/**
 * The tee card's call-outs, short and plain: the climb and the drop, and the carry. "climbs 12 m, drops 16 m" for a
 * hole that goes up to a crest and down the far side, else the net "drops 14 m" or "climbs 10 m" (under 5 m is not
 * said), and "carry 165 to clear" for the first hazard across the line.
 */
export function calloutsOf(hole: BuiltHole): string[] {
  const a = analyse(hole);
  const out: string[] = [];
  const up = a.peak - a.tee, down = a.peak - a.pin, net = a.pin - a.tee;
  const m = (v: number) => Math.round(v);
  if (up >= 5 && down >= 5 && a.peakS > a.path.total * 0.15 && a.peakS < a.path.total * 0.92) out.push(`climbs ${m(up)} m, drops ${m(down)} m`);
  else if (net <= -5) out.push(`drops ${m(-net)} m`);
  else if (net >= 5) out.push(`climbs ${m(net)} m`);
  const c = firstCarry(hole);
  if (c) out.push(`carry ${Math.round(c.to)} to clear`);
  return out;
}

/** where the hero shot is, metres along the line: the middle of the carry, else the crest; null on a hole with neither */
export function heroOf(hole: BuiltHole): { s: number; kind: "carry" | "crest" } | null {
  const a = analyse(hole);
  const c = firstCarry(hole);
  if (c) return { s: ((c.from + c.to) / 2) * YD, kind: "carry" };
  const up = a.peak - a.tee, down = a.peak - a.pin;
  if (up >= 5 && down >= 5 && a.peakS > a.path.total * 0.15 && a.peakS < a.path.total * 0.92) return { s: a.peakS, kind: "crest" };
  return null;
}
