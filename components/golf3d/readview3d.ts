import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { GH, GW, shapeR, zone } from "@/components/offhours/golf/green";
import { reliefOf } from "./relief";

// The hold-to-read view's ground: on the map, the green's height in bands (a calm ramp from deep blue-green, low, to warm
// yellow, high) with a thin contour where each band ends, and on the low view a grid of 1 m squares draped on the
// green. Two meshes at most (the map's bands and its contours, or the grid), built for a hole the first time they are
// wanted, and hidden (no draw calls) when the view is not up.

export type ReadLook = { kind: "map" | "low"; k: number };
export type ReadOverlay = {
  group: THREE.Group;
  /** the overlay for this frame: null when the view is not up; `look.k` is how far in it is (its fade) */
  update: (hole: BuiltHole, look: ReadLook | null) => void;
  dispose: () => void;
};

/** the bands, low to high: deep blue-green to warm yellow */
const RAMP = ["#17465a", "#1f6a6b", "#3a8a72", "#7aa86a", "#b9b962", "#e0c35e", "#f6d966"];
const BANDS = RAMP.length;
/** the grid of the map, m: 20 cm, fine enough that the bands follow the ground */
const CELL = 0.2;
/** how far each layer sits above the ground, m (the arrows are 1 cm above it) */
const LIFT_BANDS = 0.003, LIFT_LINE = 0.005, LIFT_GRID = 0.004;
const ON_GROUND = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 } as const;

const sstep = (a: number, b: number, v: number) => {
  const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * The contour segments of a grid of heights at one level, by marching squares: each point is written as (i, j, level) in
 * grid units, so a point sits at the height it belongs to. A cell's corners are
 * v0 (i, j), v1 (i+1, j), v2 (i+1, j+1), v3 (i, j+1); the edges are E0 bottom, E1 right, E2 top, E3 left. Saddles (5, 10)
 * are drawn as two segments, which reads the same at this size.
 */
const CASES: number[][][] = [[], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 2], [0, 1]], [[0, 2]], [[3, 2]], [[2, 3]], [[0, 2]], [[3, 0], [1, 2]], [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], []];
function contour(V: Float32Array, M: Float32Array, nx: number, nz: number, level: number, out: number[]) {
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
      // only where the whole cell is on the green (the fringe is faded out, not cut)
      if (M[a] < 0.5 || M[b] < 0.5 || M[c] < 0.5 || M[d] < 0.5) continue;
      const v = [V[a], V[b], V[c], V[d]];
      const code = (v[0] > level ? 1 : 0) | (v[1] > level ? 2 : 0) | (v[2] > level ? 4 : 0) | (v[3] > level ? 8 : 0);
      const at = (e: number): [number, number] => {
        const t = (p: number, q: number) => (level - p) / (q - p);
        if (e === 0) return [i + t(v[0], v[1]), j];
        if (e === 1) return [i + 1, j + t(v[1], v[2])];
        if (e === 2) return [i + t(v[3], v[2]), j + 1];
        return [i, j + t(v[0], v[3])];
      };
      for (const [e0, e1] of CASES[code]) {
        const p = at(e0), q = at(e1);
        out.push(p[0], p[1], level, q[0], q[1], level);
      }
    }
}

export function createReadOverlay(): ReadOverlay {
  const group = new THREE.Group();
  group.visible = false;
  const disposables: { dispose: () => void }[] = [];
  let built: BuiltHole | null = null;

  // the bands and their contours (the map)
  const bandM = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, ...ON_GROUND });
  const lineM = new THREE.LineBasicMaterial({ color: "#0d2a2a", transparent: true, opacity: 0.5, depthWrite: false, ...ON_GROUND });
  // the grid (the low view)
  const gridM = new THREE.LineBasicMaterial({ color: "#f4fbf2", transparent: true, opacity: 0.5, depthWrite: false, ...ON_GROUND });
  const bands = new THREE.Mesh(new THREE.BufferGeometry(), bandM);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineM);
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), gridM);
  for (const o of [bands, lines, grid]) {
    o.frustumCulled = false;
    group.add(o);
  }
  disposables.push(bandM, lineM, gridM, bands.geometry, lines.geometry, grid.geometry);

  /** the map's bands and contours of this hole's green */
  const buildMap = (hole: BuiltHole) => {
    const rel = reliefOf(hole);
    const H = hole.green;
    const nx = Math.round(GW / CELL) + 1, nz = Math.round(GH / CELL) + 1;
    const hgt = new Float32Array(nx * nz), alp = new Float32Array(nx * nz);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const gx = i * CELL, gy = j * CELL;
        const dx = gx - GW / 2, dy = gy - GH / 2;
        // how far outside the green's edge, m (negative inside), for the fade over the fringe
        const rho = Math.hypot(dx / (GW / 2), dy / (GH / 2));
        const e = rho > 1e-9 ? (rho - shapeR(H, Math.atan2(dy / (GH / 2), dx / (GW / 2)))) * (Math.hypot(dx, dy) / rho) : -1;
        const a = j * nx + i;
        alp[a] = 1 - sstep(0.02, 0.4, e);
        hgt[a] = rel.yG(gx, gy);
        if (alp[a] > 0.9) {
          lo = Math.min(lo, hgt[a]);
          hi = Math.max(hi, hgt[a]);
        }
      }
    const span = Math.max(0.06, hi - lo);
    const ramp = RAMP.map((c) => new THREE.Color(c));
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 4);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * nx + i;
        const [x, z] = hole.fromGreen(i * CELL, j * CELL);
        pos.set([x, hgt[a] + LIFT_BANDS, z], a * 3);
        const band = Math.max(0, Math.min(BANDS - 1, Math.floor(((hgt[a] - lo) / span) * BANDS)));
        col.set([ramp[band].r, ramp[band].g, ramp[band].b, alp[a]], a * 4);
      }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = bands.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);

    // the contours at the band edges, each point on the ground at its own level
    const seg: number[] = [];
    for (let b = 1; b < BANDS; b++) contour(hgt, alp, nx, nz, lo + (span * b) / BANDS, seg);
    const lp = new Float32Array((seg.length / 3) * 3);
    for (let k = 0; k < seg.length; k += 3) {
      const [x, z] = hole.fromGreen(seg[k] * CELL, seg[k + 1] * CELL);
      lp.set([x, seg[k + 2] + LIFT_LINE, z], k);
    }
    lines.geometry.setAttribute("position", new THREE.BufferAttribute(lp, 3));
  };

  /** the grid of 1 m squares on the green, drawn in 25 cm pieces so it follows the ground */
  const buildGrid = (hole: BuiltHole) => {
    const rel = reliefOf(hole);
    const H = hole.green;
    const out: number[] = [];
    const piece = 0.25;
    const pt = (gx: number, gy: number) => {
      const [x, z] = hole.fromGreen(gx, gy);
      return [x, rel.yG(gx, gy) + LIFT_GRID, z];
    };
    const inside = (gx: number, gy: number) => zone(H, gx, gy) === 0;
    // lines along y at each whole metre of x, and along x at each whole metre of y
    for (let k = 0; k <= GW; k++)
      for (let s = 0; s < GH; s += piece) {
        if (!inside(k, s) || !inside(k, s + piece)) continue;
        out.push(...pt(k, s), ...pt(k, s + piece));
      }
    for (let k = 0; k <= GH; k++)
      for (let s = 0; s < GW; s += piece) {
        if (!inside(s, k) || !inside(s + piece, k)) continue;
        out.push(...pt(s, k), ...pt(s + piece, k));
      }
    grid.geometry.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  };

  return {
    group,
    update: (hole, look) => {
      if (!look) {
        group.visible = false;
        return;
      }
      if (built !== hole) {
        built = hole;
        buildMap(hole);
        buildGrid(hole);
      }
      group.visible = true;
      const map = look.kind === "map";
      bands.visible = lines.visible = map;
      grid.visible = !map;
      bandM.opacity = 0.9 * look.k;
      lineM.opacity = 0.5 * look.k;
      gridM.opacity = 0.5 * look.k;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
