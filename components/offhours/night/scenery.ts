import { seeded } from "../useCanvas";
import { BRIDGE, ROCK_L, ROCK_R, TUNNEL, type Road } from "./road";

// What stands beside the road. Laid out once from the road and a seed of its own
// (the road's own random numbers are untouched, so every driver and every ghost
// still gets the same road): which segment has a pine, a house, a boulder, a
// lamp; how high and how far out the cliff is; where the landmarks stand. The
// renderer reads it per segment, so a frame decides nothing and allocates nothing.
//
// The canyon is told in stretches, so a driver knows roughly where they are
// without a map: lamps and a grandstand at the start, pines, a petrol canopy
// before the first gate, a radio mast before the second, the cliffs and the
// tunnel, an open ridge with pylons, the bridge with its towers, a village, rock
// cuts, and a floodlit finish with stands either side.

export const NONE = 0;
export const PINE = 1;
export const HOUSE = 2;
export const BOULDER = 3;
export const LAMP = 4;

export type LandmarkKind = "canopy" | "mast" | "pylons" | "stand" | "flood" | "towers";
export type Landmark = { s: number; side: -1 | 1; kind: LandmarkKind; /** metres outside the rail */ out: number };

export type Scenery = {
  /** four slots a segment (left, left, right, right): what stands in each, how far outside the rail (quarter metres) and its size (0..255) */
  kind: Uint8Array;
  out: Uint8Array;
  size: Uint8Array;
  /** the cliff: how high its top is above the road (m), how far out the top is (m), and a shade (0..3) for each segment */
  rockTop: Float32Array;
  rockOut: Float32Array;
  rockShade: Uint8Array;
  landmarks: Landmark[];
  /** the span of the tunnel and of the bridge, m along the road (or null) */
  tunnel: [number, number] | null;
  bridge: [number, number] | null;
};

/** a cheap hash of two integers in 0..1 */
export function hash(i: number, k: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** smooth value noise along the road, in 0..1: `scale` segments between lattice points */
function vnoise(i: number, scale: number, k: number): number {
  const u = i / scale;
  const a = Math.floor(u);
  const t = u - a;
  const s = t * t * (3 - 2 * t);
  return hash(a, k) * (1 - s) + hash(a + 1, k) * s;
}

/** which stretch of the canyon a distance is in (0 start, 1 pines, 2 cliffs and tunnel, 3 ridge, 4 bridge, 5 village, 6 rock cuts, 7 finish) */
export function stretchAt(road: Road, s: number): number {
  const every = road.checks.length > 1 ? road.checks[1] - road.checks[0] : 720;
  return Math.max(0, Math.min(7, Math.floor(s / every)));
}

const DENSITY_PINE = [0.1, 0.62, 0.16, 0.04, 0.2, 0.22, 0.1, 0.1];
const DENSITY_HOUSE = [0.025, 0.005, 0, 0, 0.004, 0.07, 0, 0.02];
const DENSITY_BOULDER = [0.05, 0.04, 0.03, 0.09, 0.05, 0.03, 0.12, 0.03];

const made = new WeakMap<Road, Scenery>();
/** The scenery of a road (made on first use, and kept with it). */
export function getScenery(road: Road): Scenery {
  let s = made.get(road);
  if (!s) {
    s = buildScenery(road);
    made.set(road, s);
  }
  return s;
}

export function buildScenery(road: Road): Scenery {
  const n = road.n;
  const seg = road.segM;
  const rng = seeded(4_417_001);
  const kind = new Uint8Array(n * 4);
  const out = new Uint8Array(n * 4);
  const size = new Uint8Array(n * 4);
  const rockTop = new Float32Array(n + 1);
  const rockOut = new Float32Array(n + 1);
  const rockShade = new Uint8Array(n + 1);

  // the zones that are not open ground
  let tun: [number, number] | null = null;
  let bri: [number, number] | null = null;
  for (let i = 0; i < n; i++) {
    const f = road.flags[i];
    if (f & TUNNEL) tun = tun ? [tun[0], (i + 1) * seg] : [i * seg, (i + 1) * seg];
    if (f & BRIDGE) bri = bri ? [bri[0], (i + 1) * seg] : [i * seg, (i + 1) * seg];
  }

  // the cliff: a ragged top (low near the start and on the ridge, so the sky and the moon show), ledges that step in
  for (let i = 0; i <= n; i++) {
    const s = i * seg;
    const b = stretchAt(road, s);
    const big = b === 2 || b === 6 ? 1 : b === 3 ? 0.35 : 0.7;
    const early = Math.min(1, Math.max(0.25, (s - 40) / 420));
    const base = 6 + 15 * vnoise(i, 7, 1) + 7 * vnoise(i, 2.2, 2) + 3 * hash(i, 3);
    rockTop[i] = Math.max(4, base * big * early);
    rockOut[i] = 6 + 7 * vnoise(i, 9, 4) + 2 * hash(i, 5);
    // a tone for a run of segments, not each (neighbours of one tone are one fill)
    rockShade[i] = Math.floor(hash(Math.floor(i / 5), 6) * 4);
  }

  const lamp = (i: number, side: number) => {
    const slot = side < 0 ? 0 : 2;
    kind[i * 4 + slot] = LAMP;
    out[i * 4 + slot] = 0;
  };

  for (let i = 0; i < n; i++) {
    const s = i * seg;
    const f = road.flags[i];
    if (f & (TUNNEL | BRIDGE)) continue;
    const b = stretchAt(road, s);
    for (let side = 0; side < 2; side++) {
      const rock = f & (side ? ROCK_R : ROCK_L);
      if (rock) continue;
      for (let j = 0; j < 2; j++) {
        const slot = side * 2 + j;
        const r = hash(i, 10 + slot);
        const o = hash(i, 20 + slot);
        const v = hash(i, 30 + slot);
        if (j === 0 && r < DENSITY_PINE[b]) {
          kind[i * 4 + slot] = PINE;
          out[i * 4 + slot] = Math.round((1.4 + o * o * 15) * 4);
          size[i * 4 + slot] = Math.floor(v * 255);
        } else if (r > 1 - DENSITY_HOUSE[b] && j === 1) {
          kind[i * 4 + slot] = HOUSE;
          out[i * 4 + slot] = Math.round((8 + o * 12) * 4);
          size[i * 4 + slot] = Math.floor(v * 255);
        } else if (r > 0.5 && r < 0.5 + DENSITY_BOULDER[b]) {
          kind[i * 4 + slot] = BOULDER;
          out[i * 4 + slot] = Math.round((1.3 + o * 4) * 4);
          size[i * 4 + slot] = Math.floor(v * 255);
        }
      }
    }
  }

  // lamps: the start, the finish, a floodlit stretch round each gate and along the bridge's approaches, and the village
  const lampsEvery = (a: number, c: number, step: number, both: boolean) => {
    for (let s = a; s < c; s += step * seg) {
      const i = Math.round(s / seg);
      if (i < 0 || i >= n || road.flags[i] & (TUNNEL | BRIDGE)) continue;
      const side = Math.round(s / (step * seg)) & 1 ? 1 : -1;
      if (!(road.flags[i] & (side < 0 ? ROCK_L : ROCK_R))) lamp(i, side);
      if (both && !(road.flags[i] & (side < 0 ? ROCK_R : ROCK_L))) lamp(i, -side as -1 | 1);
    }
  };
  lampsEvery(30, 300, 7, false);
  for (const g of road.checks) lampsEvery(g - 110, g + 70, 6, true);
  lampsEvery(road.checks[road.checks.length - 1] - 160, road.length - 40, 7, true);
  const every = road.checks.length > 1 ? road.checks[1] - road.checks[0] : 720;
  lampsEvery(every * 5, every * 6, 8, false);
  if (bri) {
    lampsEvery(bri[0] - 120, bri[0] - 8, 8, false);
    lampsEvery(bri[1] + 8, bri[1] + 120, 8, false);
  }

  // the landmarks, each a little before its gate: on the nearest stretch of ground that has room (no cliff on that side, no tunnel or bridge)
  const lm: Landmark[] = [];
  const at = (k: number) => road.checks[Math.min(k, road.checks.length) - 1];
  const free = (s: number, side: -1 | 1) => {
    const c = Math.round(s / seg);
    for (let j = c - 3; j <= c + 3; j++) {
      const f = road.flags[Math.max(0, Math.min(n - 1, j))];
      if (f & (TUNNEL | BRIDGE | (side < 0 ? ROCK_L : ROCK_R))) return false;
    }
    return true;
  };
  /** the first place from `s` (away from it by `dir`, up to `reach` m) where `side`, or failing that the other side, is clear */
  const find = (s: number, side: -1 | 1, dir: 1 | -1, reach: number): { s: number; side: -1 | 1 } | null => {
    for (let d = 0; d <= reach; d += 8) {
      const at_ = s + dir * d;
      if (at_ < 20 || at_ > road.length - 20) continue;
      if (free(at_, side)) return { s: at_, side };
      if (free(at_, -side as -1 | 1)) return { s: at_, side: -side as -1 | 1 };
    }
    return null;
  };
  const place = (k: number, back: number, side: -1 | 1, kindL: LandmarkKind, out_: number) => {
    const spot = find(at(k) - back, side, -1, 420);
    // a gorge with walls both sides for the whole approach: a mast can stand on the cliff top, the rest are left out
    if (spot) lm.push({ s: spot.s, side: spot.side, kind: kindL, out: out_ });
    else if (kindL === "mast" || kindL === "flood") lm.push({ s: at(k) - back, side, kind: kindL, out: out_ + 6 });
  };
  place(1, 70, 1, "canopy", 6);
  place(2, 95, -1, "mast", 13);
  place(3, 60, 1, "canopy", 8);
  place(4, 80, -1, "pylons", 12);
  place(5, 60, -1, "canopy", 6);
  place(6, 90, 1, "mast", 14);
  place(7, 60, -1, "flood", 4);
  place(7, 60, 1, "flood", 4);
  place(8, 70, -1, "flood", 4);
  place(8, 70, 1, "flood", 4);
  place(8, 28, -1, "stand", 7);
  place(8, 28, 1, "stand", 7);
  // the start: a stand, so the opening picture has somewhere to be, and a floodlight either side of the line
  for (const [s0, side, kindL, o] of [[130, 1, "stand", 8], [40, -1, "flood", 4], [110, 1, "flood", 4]] as const) {
    const spot = find(s0, side, 1, 160);
    if (spot) lm.push({ s: spot.s, side: spot.side, kind: kindL, out: o });
  }
  // the bridge's towers stand over the middle of the deck
  if (bri) lm.push({ s: Math.round((bri[0] + bri[1]) / 2 / seg) * seg, side: 1, kind: "towers", out: 0.8 });
  void rng;

  return { kind, out, size, rockTop, rockOut, rockShade, landmarks: lm, tunnel: tun, bridge: bri };
}
