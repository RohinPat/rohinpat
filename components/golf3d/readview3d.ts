import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { GH, GW, shapeR, zone } from "@/components/offhours/golf/green";
import { reliefOf } from "./relief";
import type { View } from "./flyover";

// The hold-to-read view's ground. On the map: the green's height in bands (a calm ramp from deep blue-green, low, to warm
// yellow, high), a thin contour where each band ends, and a cup marker the same size on screen at any zoom. On the low
// view: a grid of 1 m squares draped on the green, tinted by the same bands so the fall reads as colour, and bolder
// near the ball. Two draw calls at most (the map's bands with the cup marker, and its contours; or the grid), built for
// a hole (and a ball, for the grid) the first time they are wanted, and hidden (no draw calls) when the view is not up.

export type ReadOverlay = {
  group: THREE.Group;
  /** the overlay for this frame, from the camera: nothing unless it is a read view (`c.look`), `c.look.k` is how far in (its fade) */
  update: (hole: BuiltHole, c: View | null, ball: [number, number]) => void;
  dispose: () => void;
};

/** the bands, low to high: deep blue-green to warm yellow */
const RAMP = ["#17465a", "#1f6a6b", "#3a8a72", "#7aa86a", "#b9b962", "#e0c35e", "#f6d966"];
const BANDS = RAMP.length;
const RAMP_RGB = RAMP.map((c) => new THREE.Color(c));
/** the grid of the map, m: 20 cm, fine enough that the bands follow the ground */
const CELL = 0.2;
/** how far each layer sits above the ground, m (the arrows are 1 cm above it) */
const LIFT_BANDS = 0.003, LIFT_LINE = 0.005, LIFT_GRID = 0.004, LIFT_CUP = 0.006;
/** the cup marker's radius on screen, px, and its ring: dark from 0.55 to 1 of that, white out to 1.2 */
const CUP_PX = 9;
const RING_SEG = 32;
const RING_R = [0.55, 1, 1, 1.2];
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
  // the band scale of the green (the map and the grid share it)
  let lo = 0, span = 1;
  const bandOf = (h: number) => Math.max(0, Math.min(BANDS - 1, Math.floor(((h - lo) / span) * BANDS)));

  // the bands, the cup marker and the contours (the map)
  const bandM = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, ...ON_GROUND });
  const lineM = new THREE.LineBasicMaterial({ color: "#0d2a2a", transparent: true, opacity: 0.5, depthWrite: false, ...ON_GROUND });
  // the grid (the low view): its own colours by band, and its alpha by distance from the ball
  const gridM = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false, ...ON_GROUND });
  const bands = new THREE.Mesh(new THREE.BufferGeometry(), bandM);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineM);
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), gridM);
  for (const o of [bands, lines, grid]) {
    o.frustumCulled = false;
    group.add(o);
  }
  disposables.push(bandM, lineM, gridM, bands.geometry, lines.geometry, grid.geometry);

  // the cup marker: rings of RING_R around the cup, in the bands' own geometry (after its grid), redrawn for the zoom
  let ringBase = 0;
  let cupAt = [0, 0, 0] as [number, number, number];

  /** the map's bands, the contours, and the cup's ring of this hole's green */
  const buildMap = (hole: BuiltHole) => {
    const rel = reliefOf(hole);
    const H = hole.green;
    const nx = Math.round(GW / CELL) + 1, nz = Math.round(GH / CELL) + 1;
    const hgt = new Float32Array(nx * nz), alp = new Float32Array(nx * nz);
    let hi = -Infinity;
    let lowest = Infinity;
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
          lowest = Math.min(lowest, hgt[a]);
          hi = Math.max(hi, hgt[a]);
        }
      }
    lo = lowest;
    span = Math.max(0.06, hi - lo);
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 4);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * nx + i;
        const [x, z] = hole.fromGreen(i * CELL, j * CELL);
        pos.set([x, hgt[a] + LIFT_BANDS, z], a * 3);
        const c = RAMP_RGB[bandOf(hgt[a])];
        col.set([c.r, c.g, c.b, alp[a]], a * 4);
      }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    // the cup marker's rings after the grid: RING_SEG angles, RING_R radii, two quads per angle
    ringBase = nx * nz;
    const ringPos = new Float32Array(RING_SEG * RING_R.length * 3);
    const ringCol = new Float32Array(RING_SEG * RING_R.length * 4);
    const dark = [0.05, 0.1, 0.1], white = [0.96, 0.95, 0.88];
    for (let s = 0; s < RING_SEG; s++)
      for (let k = 0; k < RING_R.length; k++) {
        const c = k < 2 ? dark : white;
        ringCol.set([c[0], c[1], c[2], 1], (s * RING_R.length + k) * 4);
      }
    for (let s = 0; s < RING_SEG; s++) {
      const p = (a: number, k: number) => ringBase + a * RING_R.length + k;
      for (const k of [0, 2]) {
        const s1 = (s + 1) % RING_SEG;
        idx.push(p(s, k), p(s1, k), p(s, k + 1), p(s, k + 1), p(s1, k), p(s1, k + 1));
      }
    }
    const [cx0, cz0] = hole.fromGreen(H.cup[0], H.cup[1]);
    cupAt = [cx0, rel.yG(H.cup[0], H.cup[1]) + LIFT_CUP, cz0];
    const g = bands.geometry;
    const allPos = new Float32Array(pos.length + ringPos.length);
    allPos.set(pos, 0);
    g.setAttribute("position", new THREE.BufferAttribute(allPos, 3));
    const allCol = new Float32Array(col.length + ringCol.length);
    allCol.set(col, 0);
    allCol.set(ringCol, col.length);
    g.setAttribute("color", new THREE.BufferAttribute(allCol, 4));
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

  /** the cup's ring, the same size on screen at any zoom: its radius is CUP_PX at the distance from the camera */
  const placeRing = (c: View) => {
    const eyeD = Math.hypot(cupAt[0] - c.x, cupAt[1] - c.y, cupAt[2] - c.z);
    const R = (eyeD * CUP_PX) / c.F;
    const pa = bands.geometry.attributes.position as THREE.BufferAttribute;
    for (let s = 0; s < RING_SEG; s++) {
      const th = (s / RING_SEG) * Math.PI * 2;
      for (let k = 0; k < RING_R.length; k++) {
        const r = R * RING_R[k];
        pa.setXYZ(ringBase + s * RING_R.length + k, cupAt[0] + Math.cos(th) * r, cupAt[1], cupAt[2] + Math.sin(th) * r);
      }
    }
    pa.needsUpdate = true;
  };

  /** the grid of 1 m squares on the green, drawn in 25 cm pieces so it follows the ground; tinted by band, bolder near the ball */
  const buildGrid = (hole: BuiltHole, ball: [number, number]) => {
    const rel = reliefOf(hole);
    const H = hole.green;
    const pos: number[] = [], col: number[] = [];
    const piece = 0.25;
    const pt = (gx: number, gy: number): void => {
      const [x, z] = hole.fromGreen(gx, gy);
      const h = rel.yG(gx, gy);
      const c = RAMP_RGB[bandOf(h)];
      const d = Math.hypot(gx - ball[0], gy - ball[1]);
      // bold enough that the bands read on the grass, and a touch bolder by the ball, fading out by 6 m
      const a = 0.6 + 0.4 * Math.exp(-d / 3);
      pos.push(x, h + LIFT_GRID, z);
      col.push(c.r, c.g, c.b, a);
    };
    const inside = (gx: number, gy: number) => zone(H, gx, gy) === 0;
    // lines along y at each whole metre of x, and along x at each whole metre of y
    for (let k = 0; k <= GW; k++)
      for (let s = 0; s < GH; s += piece) {
        if (!inside(k, s) || !inside(k, s + piece)) continue;
        pt(k, s);
        pt(k, s + piece);
      }
    for (let k = 0; k <= GH; k++)
      for (let s = 0; s < GW; s += piece) {
        if (!inside(s, k) || !inside(s + piece, k)) continue;
        pt(s, k);
        pt(s + piece, k);
      }
    grid.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    grid.geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  };

  let gridKey = "";
  return {
    group,
    update: (hole, c, ball) => {
      const look = c?.look;
      if (!c || !look) {
        group.visible = false;
        return;
      }
      if (built !== hole) {
        built = hole;
        buildMap(hole);
        gridKey = "";
      }
      group.visible = true;
      const map = look.kind === "map";
      bands.visible = lines.visible = map;
      grid.visible = !map;
      bandM.opacity = 0.9 * look.k;
      lineM.opacity = 0.5 * look.k;
      gridM.opacity = look.k;
      if (map) placeRing(c);
      else {
        // the grid is redone when the ball has moved (it is the same at address)
        const key = `${ball[0].toFixed(2)},${ball[1].toFixed(2)}`;
        if (key !== gridKey) {
          gridKey = key;
          buildGrid(hole, ball);
        }
      }
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
