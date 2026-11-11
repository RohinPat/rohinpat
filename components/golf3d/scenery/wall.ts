import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { hash2, lerp, nearest, noise1, offsetLine, pathLength, resample } from "./geo";
import type { P, Tier, WallSpec } from "./types";

// Rock: a wall of flat-shaded bands standing beyond the trees (a canyon's side). A ribbon of
// quads along a spine, each row stepped in a little, coloured in strata. Non-indexed triangles with vertex colours.

const STEP: Record<Tier, number> = { high: 12, low: 20, soft: 0 };
const ROWS: Record<Tier, number> = { high: 8, low: 5, soft: 0 };

const spines = new WeakMap<BuiltHole, Map<WallSpec, P[]>>();
/** the line a wall stands on, in the direction its face looks to the right of */
export function wallSpine(hole: BuiltHole, w: WallSpec): P[] {
  let m = spines.get(hole);
  if (!m) spines.set(hole, (m = new Map()));
  const got = m.get(w);
  if (got) return got;
  let out: P[];
  if (w.follow === "line") {
    const line = hole.line;
    const total = pathLength(line);
    const a = (w.from ?? 0) * total, b = (w.to ?? 1) * total;
    const pts: P[] = [];
    let s = 0;
    for (let i = 0; i < line.length; i++) {
      if (i) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      if (s >= a && s <= b) pts.push(line[i]);
    }
    out = offsetLine(pts, w.side === "right" ? w.offset : -w.offset);
    // a wall on the right looks back to the left: run it the other way so its face is on the right of travel
    if (w.side === "right") out = out.reverse();
  } else {
    const end = hole.line[hole.line.length - 1], prev = hole.line[hole.line.length - 2];
    const l = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
    const hx = (end[0] - prev[0]) / l, hz = (end[1] - prev[1]) / l;
    const cx = end[0] + hx * w.offset, cz = end[1] + hz * w.offset;
    const hw = w.halfWidth ?? 150, bow = w.curve ?? 0;
    out = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * 2 - 1;
      out.push([cx + hz * hw * t - hx * bow * t * t, cz - hx * hw * t - hz * bow * t * t]);
    }
  }
  m.set(w, out);
  return out;
}

const flareOf = (H: number) => Math.min(0.35 * H, 18);

/** whether a point stands in a wall's foot or on its cap (trees are cleared there) */
export function onWall(hole: BuiltHole, walls: WallSpec[], x: number, z: number): boolean {
  for (const w of walls) {
    const sp = wallSpine(hole, w);
    const n = nearest(sp, x, z);
    const ax = sp[n.seg], bx = sp[n.seg + 1];
    const dx = bx[0] - ax[0], dz = bx[1] - ax[1], l = Math.hypot(dx, dz) || 1;
    // to the right of travel is the face
    const front = ((x - n.px) * dz - (z - n.pz) * dx) / l;
    if (front >= 0 ? front < flareOf(w.height) + 8 : -front < (w.capDepth ?? 60) + 10) return true;
  }
  return false;
}

const c3 = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

type Wall = {
  spine: P[];
  face: 1 | -1;
  /** the foot and the height of the face at a station */
  foot: (i: number, x: number, z: number) => number;
  top: (i: number, x: number, z: number, foot: number) => number;
  rock: string[];
  cap: string;
  footColor: string;
  capDepth: number;
  rows: number;
  seed: number;
  /** flares at the foot (m) */
  flare?: number;
};

export function ribbonData(spec: WallSpec, heightAt: (x: number, z: number) => number, tier: Tier, spine: P[]): { positions: Float32Array; colors: Float32Array; tris: number } {
  const empty = { positions: new Float32Array(0), colors: new Float32Array(0), tris: 0 };
  if (tier === "soft") return empty;
  const step = STEP[tier];
  const wall: Wall = {
    spine,
    face: 1,
    foot: (_i, x, z) => {
      let lo = heightAt(x, z);
      for (const [ox, oz] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) lo = Math.min(lo, heightAt(x + ox, z + oz));
      return lo - 3;
    },
    top: (i, _x, _z, foot) => foot + spec.height * (0.85 + 0.3 * (noise1(i * 0.37, spec.seed ?? 1) * 0.5 + 0.5)),
    rock: spec.rock,
    cap: spec.cap,
    footColor: spec.foot,
    capDepth: spec.capDepth ?? 60,
    rows: tier === "high" ? spec.rows ?? ROWS.high : Math.min(spec.rows ?? ROWS.low, ROWS.low),
    seed: spec.seed ?? 1,
  };
  const pts = resample(wall.spine, step);
  const R = wall.rows;
  const rock = wall.rock.map(c3), cap = c3(wall.cap), footC = c3(wall.footColor);
  const N = pts.length;
  // stations: position, normal toward the face, foot, height
  const st = pts.map(([x, z], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
    // the right of travel is (tz, -tx)
    const nx = tz * wall.face, nz = -tx * wall.face;
    const f = wall.foot(i, x, z);
    const top = Math.max(f + 4, wall.top(i, x, z, f));
    return { x, z, nx, nz, f, H: top - f };
  });
  const quads = (N - 1) * (R + 1);
  const positions = new Float32Array(quads * 18), colors = new Float32Array(quads * 18);
  let k = 0;
  const vtx = (x: number, y: number, z: number, c: [number, number, number]) => {
    positions[k * 3] = x; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z;
    colors[k * 3] = c[0]; colors[k * 3 + 1] = c[1]; colors[k * 3 + 2] = c[2];
    k++;
  };
  const rowPos = (i: number, r: number): [number, number, number] => {
    const s = st[i], t = r / R;
    const flare = (wall.flare ?? flareOf(s.H)) * (1 - t) * (1 - t);
    const bench = (r % 2 ? -1.6 : 0) + (hash2(i, r, wall.seed) - 0.5) * 0.06 * s.H;
    const out = flare + bench - 0.04 * s.H * t;
    return [s.x + s.nx * out, s.f + s.H * Math.pow(t, 0.9), s.z + s.nz * out];
  };
  for (let i = 0; i < N - 1; i++) {
    const mix = noise1((i + 0.5) * 0.5, wall.seed + 7);
    for (let r = 0; r < R; r++) {
      const p00 = rowPos(i, r), p10 = rowPos(i + 1, r), p01 = rowPos(i, r + 1), p11 = rowPos(i + 1, r + 1);
      const t = (r + 0.5) / R;
      const bandH = (st[i].H / wall.rock.length) * 1.4;
      const band = Math.floor(((p00[1] - st[i].f + (p11[1] - st[i].f)) / 2 / bandH + 0.7 * mix) + 100) % wall.rock.length;
      let c = rock[band].slice() as [number, number, number];
      if (r % 3 === 0 && r > 0) c = [c[0] * 0.82, c[1] * 0.82, c[2] * 0.82];
      if (t < 0.15) for (let q = 0; q < 3; q++) c[q] = lerp(footC[q], c[q], t / 0.15);
      if (r === R - 1) for (let q = 0; q < 3; q++) c[q] = lerp(c[q], cap[q], 0.6);
      vtx(...p00, c); vtx(...p01, c); vtx(...p10, c);
      vtx(...p10, c); vtx(...p01, c); vtx(...p11, c);
    }
    // the cap: back from the top row, level
    const a = rowPos(i, R), b = rowPos(i + 1, R);
    const ba: [number, number, number] = [a[0] - st[i].nx * wall.capDepth, a[1], a[2] - st[i].nz * wall.capDepth];
    const bb: [number, number, number] = [b[0] - st[i + 1].nx * wall.capDepth, b[1], b[2] - st[i + 1].nz * wall.capDepth];
    vtx(...a, cap); vtx(...ba, cap); vtx(...b, cap);
    vtx(...b, cap); vtx(...ba, cap); vtx(...bb, cap);
  }
  return { positions, colors, tris: quads * 2 };
}

/** the rock walls of a scene as one mesh */
export function buildWalls(hole: BuiltHole, walls: WallSpec[], heightAt: (x: number, z: number) => number, tier: Tier): { mesh: THREE.Mesh; tris: number } | null {
  if (tier === "soft" || !walls.length) return null;
  const parts = walls.map((w) => ribbonData(w, heightAt, tier, wallSpine(hole, w)));
  const tris = parts.reduce((s, p) => s + p.tris, 0);
  if (!tris) return null;
  const pos = new Float32Array(tris * 9), col = new Float32Array(tris * 9);
  let o = 0;
  for (const p of parts) {
    pos.set(p.positions, o);
    col.set(p.colors, o);
    o += p.positions.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return { mesh, tris };
}
