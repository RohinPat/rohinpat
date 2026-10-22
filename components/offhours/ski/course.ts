import { seeded } from "../useCanvas";

// The giant slalom course. Everything is in "slope coordinates": z runs down
// the fall line in metres, x across it, and height is measured from the
// slope plane (so rollers and kickers are small numbers). The terrain is a
// table, built once, so the sim and the renderer read exactly the same snow.

export const L = 1420; // finish line
export const HALF_W = 21; // the piste, from its centre line to the nets
export const GATE_HALF = 3.3; // half the gap between a gate's poles
export const ALPHA0 = 0.36; // slope angle in radians (about 20 degrees)
export const PENALTY = 1.5; // seconds per missed gate
export const RUNOUT = 95;

export type Gate = { i: number; z: number; x: number; color: 0 | 1 };
export type Tree = { x: number; z: number; h: number; v: number; r: number };
export type Kicker = { z: number; lip: number };

export type Terrain = {
  h(z: number): number;
  slope(z: number): number;
};

export type Course = {
  gates: Gate[];
  trees: Tree[];
  obstacles: Tree[];
  kickers: Kicker[];
  terrain: Terrain;
};

const DZ = 0.5;
const Z0 = -80;

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
/** 0 → 1 between a and b, 1 → 0 between c and d */
const win = (z: number, a: number, b: number, c: number, d: number) => smooth((z - a) / (b - a)) * (1 - smooth((z - c) / (d - c)));

const rawCx = (z: number) => 6 * Math.sin(z / 210 + 0.4) + 3.5 * Math.sin(z / 85 + 2);
const cx0 = rawCx(0);
/** the centre line of the piste */
export function centerX(z: number) {
  const k = smooth((z + 40) / 160);
  return (rawCx(z) - cx0) * k * (1 - 0.8 * smooth((z - L - 20) / 60));
}

const KICKERS = [868, 1352];
const KICK_R = [1.15, 1.25];

function kickerH(z: number, z0: number, R: number) {
  if (z < z0) return 0;
  if (z <= z0 + 8) return R * ((z - z0) / 8) ** 2;
  const t = z - z0 - 8;
  if (t < 9) return R + (-0.9 - R) * smooth(t / 9);
  if (t < 28) return -0.9 * (1 - smooth((t - 9) / 19));
  return 0;
}

function buildTerrain(): Terrain {
  const n = Math.ceil((L + RUNOUT + 460 - Z0) / DZ);
  const h = new Float32Array(n + 2);
  let base = 0;
  for (let i = 0; i < h.length; i++) {
    const z = Z0 + i * DZ;
    // long, gentle changes of pitch: a steep pitch, a flat, a flattening runout
    const sb = -0.06 * win(z, 430, 480, 660, 710) + 0.07 * win(z, 940, 990, 1030, 1075) + 0.1 * smooth((z - L - 20) / 70);
    base += sb * DZ;
    let v = base;
    v += 0.36 * Math.sin(((z - 720) / 27) * Math.PI * 2) * win(z, 720, 760, 800, 840);
    KICKERS.forEach((k, j) => (v += kickerH(z, k, KICK_R[j])));
    h[i] = v;
  }
  const idx = (z: number) => Math.max(0, Math.min(h.length - 2.001, (z - Z0) / DZ));
  const hf = (z: number) => {
    const f = idx(z);
    const i = Math.floor(f);
    return h[i] + (h[i + 1] - h[i]) * (f - i);
  };
  // slope by central difference, smooth between samples; the kicker lips stay sharp
  const sl = new Float32Array(h.length);
  for (let i = 1; i < h.length - 1; i++) sl[i] = (h[i + 1] - h[i - 1]) / (2 * DZ);
  sl[0] = sl[1];
  sl[h.length - 1] = sl[h.length - 2];
  const sf = (z: number) => {
    const f = idx(z);
    const i = Math.floor(f);
    return sl[i] + (sl[i + 1] - sl[i]) * (f - i);
  };
  return { h: hf, slope: sf };
}

let cached: Course | null = null;

export function getCourse(): Course {
  if (cached) return cached;
  const r = seeded(77);
  const zs: [number, number][] = []; // z, offset magnitude
  const add = (from: number, to: number, step: number, mag: number, spread: number) => {
    for (let z = from; z <= to + 0.01; z += step) zs.push([z, mag + r() * spread]);
  };
  add(70, 412, 38, 3.2, 2.4);
  add(458, 690, 46, 4, 2.2);
  add(745, 800, 55, 3.4, 2);
  add(850, 850, 1, 1.6, 0.8);
  add(946, 946, 1, 1.6, 0.8);
  add(985, 1025, 40, 4.4, 2);
  add(1075, 1320, 34, 3.2, 1.6);
  zs.sort((a, b) => a[0] - b[0]);
  const gates: Gate[] = zs.map(([z, m], i) => {
    const side = i % 2 ? -1 : 1;
    return { i, z, x: centerX(z) + side * m, color: (i % 2) as 0 | 1 };
  });

  const trees: Tree[] = [];
  for (let z = -70; z < L + RUNOUT + 260; z += 3.4 + r() * 2.4) {
    for (const side of [-1, 1]) {
      const off = HALF_W + 2.5 + r() * r() * 46;
      trees.push({ x: centerX(z) + side * off, z: z + (r() - 0.5) * 3, h: 6 + r() * 8, v: Math.floor(r() * 3), r: 0 });
    }
  }
  const obstacles: Tree[] = [];
  let guard = 0;
  while (obstacles.length < 30 && guard++ < 400) {
    const z = 140 + r() * (L - 260);
    const side = r() < 0.5 ? -1 : 1;
    const x = centerX(z) + side * (14.5 + r() * 4.2);
    if (gates.some((g) => Math.abs(g.z - z) < 30 && Math.abs(g.x - x) < 9)) continue;
    if (KICKERS.some((k) => z > k - 40 && z < k + 50)) continue;
    const t = { x, z, h: 5 + r() * 4, v: Math.floor(r() * 3), r: 0.8 };
    obstacles.push(t);
    trees.push(t);
  }
  trees.sort((a, b) => a.z - b.z);
  cached = {
    gates,
    trees,
    obstacles: obstacles.sort((a, b) => a.z - b.z),
    kickers: KICKERS.map((z) => ({ z, lip: z + 8 })),
    terrain: buildTerrain(),
  };
  return cached;
}
