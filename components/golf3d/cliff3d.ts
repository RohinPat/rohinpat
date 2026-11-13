import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import type { CliffGeo } from "@/components/offhours/golf/features";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { hash1, hash2, noise1 } from "./scenery/geo";

// Cliffs (features.ts `cliff`) in the 3D course. A face a few yards wide and 30 m high cannot be drawn by the ground
// mesh (whose cells are 2.5 m, and whose texture is painted from above), so each cliff is a mesh of its own: a ribbon
// of quads laid along its brink, row after row from the turf behind the lip, down the face and out over the scree,
// every row at a step of height so the rock reads in bands of strata, the bands pushed in and out a little for crags,
// each triangle its own flat colour. The ground mesh is let down under it (`cliffSink`) and has no cells where the
// ribbon covers it (`cliffCovers`), so nothing of it shows through, and the top-down texture is painted with the same
// turf, rock and scree (`paintCliffs`) wherever the two meet.
// One draw call for all the hole's cliffs, a few thousand triangles. It is seen from every side, so it draws both.

type P = [number, number];
type Tier = "high" | "low" | "soft";

/** metres between columns along the brink */
const STEP: Record<Tier, number> = { high: 1.8, low: 2.6, soft: 4 };
/** rows on the face (equal steps of height) and on the scree */
const FACE_ROWS: Record<Tier, number> = { high: 15, low: 10, soft: 6 };
const SCREE_ROWS: Record<Tier, number> = { high: 6, low: 4, soft: 3 };
/** the turf behind the lip the ribbon starts on, m behind the brink (also where the ground mesh stops being let down) */
const BACK = 3.3;
/** how far the ground mesh is let down under the ribbon, m */
const SINK = 3;

// bands of strata alternate cool grey and warm sandstone, with a dark stained band now and then; the face is lit by the sky
// more than the sun, so the stone is painted a step brighter than it should read
// (`rock: "canyon"`: the red and orange strata of hole 3's country, with dry ground on the rim and a rust-coloured scree)
const STONE = {
  cool: ["#a3a5a8", "#9396a0", "#b0b1ac"],
  warm: ["#c4b497", "#b5a281", "#cdbda0"],
  dark: "#7b7774",
  scree: ["#a29887", "#ab9f8c", "#9a9080"],
  turf: "#587f43",
  lip: "#7d8f5c",
  paint: { rock: "#8d897f", scree: "#938a7b" },
};
const CANYON_STONE: typeof STONE = {
  cool: ["#c4673f", "#b85a38", "#d27a4a"],
  warm: ["#e6ae78", "#dc9a62", "#eec28c"],
  dark: "#7e4034",
  scree: ["#c8946a", "#bb8660", "#d3a27a"],
  turf: "#b8784a",
  lip: "#cf9460",
  paint: { rock: "#c0693f", scree: "#c8946a" },
};
const stoneOf = (g: CliffGeo) => (g.rock === "canyon" ? CANYON_STONE : STONE);

const smooth = (a: number, b: number, v: number) => {
  const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const cOf = new WeakMap<CliffGeo, number>();
/** where the scree ends, m out from the brink */
const reachOf = (g: CliffGeo) => {
  let v = cOf.get(g);
  if (v === undefined) cOf.set(g, (v = g.run + g.talus));
  return v;
};

/** how far the ground mesh is to be let down at a point, m (0 away from every cliff) */
export function cliffSink(hole: BuiltHole): (x: number, z: number) => number {
  const cl = terrainOf(hole).fx.cliffs;
  if (!cl.length) return () => 0;
  return (x, z) => {
    let s = 0;
    for (const g of cl) {
      const a = g.at(x, z);
      if (a.along < 0.999) continue;
      s = Math.max(s, SINK * smooth(-BACK, -BACK + 0.9, a.c) * (1 - smooth(reachOf(g) - 2, reachOf(g) - 0.3, a.c)));
    }
    return s;
  };
}

/** true where a cliff's ribbon covers the ground for good, so the ground mesh needs no cell there */
export function cliffCovers(hole: BuiltHole): ((x: number, z: number) => boolean) | null {
  const cl = terrainOf(hole).fx.cliffs;
  if (!cl.length) return null;
  return (x, z) => {
    for (const g of cl) {
      const a = g.at(x, z);
      if (a.along >= 0.999 && a.c > -1 && a.c < reachOf(g) - 2.6) return true;
    }
    return false;
  };
}

/** the brink as a smooth dense polyline (Chaikin, then even steps), with the unit normal toward the low side */
function brink(g: CliffGeo, step: number) {
  let pts: P[] = g.path;
  for (let k = 0; k < 1; k++) {
    const out: P[] = [];
    const n = pts.length;
    for (let i = 0; i < (g.closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = g.closed ? out : [pts[0], ...out, pts[n - 1]];
  }
  // even steps along it
  const ring = g.closed ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const total = cum[cum.length - 1];
  const N = Math.max(3, Math.round(total / step));
  const at = (s: number): P => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const k = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return [ring[i - 1][0] + (ring[i][0] - ring[i - 1][0]) * k, ring[i - 1][1] + (ring[i][1] - ring[i - 1][1]) * k];
  };
  const cnt = g.closed ? N : N + 1;
  const p: P[] = [];
  for (let i = 0; i < cnt; i++) p.push(at((total * i) / N));
  const nrm: P[] = p.map((q, i) => {
    const a = p[g.closed ? (i + cnt - 1) % cnt : Math.max(0, i - 1)], b = p[g.closed ? (i + 1) % cnt : Math.min(cnt - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // the low side is on the left of travel: (-dz, dx)
    void q;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  });
  return { p, nrm, closed: g.closed };
}

/** out from the brink (m) at which the share of the drop is `f` */
function cAt(g: CliffGeo, f: number) {
  let lo = -0.5, hi = reachOf(g);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (g.frac(mid) < f) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** the rows of a cliff's ribbon: distances out from the brink (m) and the share of the drop they stand at */
function rowsOf(g: CliffGeo, tier: Tier) {
  const rows: { c: number; f: number }[] = [];
  for (const c of [-BACK, -BACK * 0.62, -BACK * 0.3, -0.35]) rows.push({ c, f: 0 });
  const F = FACE_ROWS[tier], top = 0.97;
  for (let k = 0; k <= F; k++) {
    const f = 0.006 + (top - 0.006) * (k / F);
    rows.push({ c: cAt(g, f), f: g.frac(cAt(g, f)) });
  }
  const c0 = rows[rows.length - 1].c, S = SCREE_ROWS[tier], end = reachOf(g);
  for (let k = 1; k <= S; k++) {
    const c = c0 + (end - c0) * (k / S);
    rows.push({ c, f: g.frac(c) });
  }
  return rows;
}

const col = (hex: string) => new THREE.Color(hex);
const mix = (a: THREE.Color, b: THREE.Color, k: number) => a.clone().lerp(b, Math.max(0, Math.min(1, k)));

/** the ribbon of every cliff of the hole as one mesh, or null if it has none (or the cheapest tier, where the ground mesh must do) */
export function buildCliffs(hole: BuiltHole, tier: Tier, disposables: { dispose: () => void }[]): { mesh: THREE.Mesh; tris: number } | null {
  const T = terrainOf(hole);
  const cl = T.fx.cliffs;
  if (!cl.length) return null;
  const pos: number[] = [], clr: number[] = [];
  const push = (a: number[], b: number[], c: number[], k: THREE.Color) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) clr.push(k.r, k.g, k.b);
  };
  for (const g of cl) {
    const st = stoneOf(g);
    const cool = st.cool.map(col), warm = st.warm.map(col), dark = col(st.dark), scree = st.scree.map(col), turf = col(st.turf), lip = col(st.lip);
    const { p, nrm, closed } = brink(g, STEP[tier]);
    const rows = rowsOf(g, tier);
    const R = rows.length, N = p.length;
    const strata = g.ledges * 2 + 1;
    // the bands are not all one thickness: where each ends along the drop (shares of it, rising to 1)
    const cut: number[] = [];
    {
      let acc = 0;
      const w = Array.from({ length: strata }, (_, b) => 0.5 + hash1(b, g.seed + 17));
      const tot = w.reduce((a, b) => a + b, 0);
      for (const v of w) cut.push((acc += v / tot));
    }
    // and the strata dip a little, slowly, along the brink
    const dip = (i: number) => 0.05 * noise1(i * 0.045, g.seed + 31);
    const bandOf = (f: number, i: number) => Math.max(0, Math.min(strata - 1, cut.findIndex((v) => v >= f / 0.97 + dip(i))));
    // the crags: the face is cut into blocks along the brink (columnar joints), each standing out or sitting back by its own
    // amount, and each band of strata steps in or out a little within a block: blocks and ledges, not waves
    const blk: number[] = [];
    {
      let b = 0, left = 0;
      for (let i = 0; i < p.length; i++) {
        if (left <= 0) {
          b++;
          left = 2 + Math.floor(hash1(b, g.seed + 23) * 5);
        }
        left--;
        blk.push(b);
      }
    }
    const bulge = (i: number, f: number) => {
      const band = bandOf(f, i), k = blk[i % p.length];
      const w = smooth(0.04, 0.2, f) * (1 - smooth(0.82, 0.98, f));
      return w * (0.36 * (hash1(k, g.seed + 29) - 0.5) + 0.2 * (hash2(band, k, g.seed + 37) - 0.5) + 0.05 * noise1(i * 0.9 + band * 3.3, g.seed * 3 + band));
    };
    const vtx = (i: number, j: number): number[] => {
      const q = p[i % N], n = nrm[i % N], r = rows[j];
      // the height is the ground's own at the row's place on the profile (where the ball plays is what is drawn); the crags
      // push the stone in or out from there
      const y = T.y(q[0] + n[0] * r.c, q[1] + n[1] * r.c);
      const o = r.c + bulge(i, r.f);
      return [q[0] + n[0] * o, y, q[1] + n[1] * o];
    };
    const grid: number[][][] = [];
    for (let i = 0; i < (closed ? N : N); i++) {
      const rowv: number[][] = [];
      for (let j = 0; j < R; j++) rowv.push(vtx(i, j));
      grid.push(rowv);
    }
    const cols = closed ? N : N - 1;
    for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % N;
      // a vertical joint now and then darkens the column, and each column has its own light
      const colLum = 0.9 + 0.2 * hash1(i, g.seed + 11) - (hash1(Math.floor(i / 2), g.seed + 3) > 0.9 ? 0.12 : 0);
      for (let j = 0; j < R - 1; j++) {
        const r0 = rows[j], r1 = rows[j + 1];
        const fm = (r0.f + r1.f) / 2;
        let base: THREE.Color;
        if (r1.c <= 0) {
          // the lip: turf on the top, bare rock at the edge
          base = mix(turf, lip, (r1.c + BACK) / BACK);
        } else if (fm < 0.955 * (1 - 0.02 * hash1(i, g.seed + 4))) {
          const band = bandOf(fm, i);
          const h = hash1(band, g.seed + 5);
          base = (h > 0.82 ? dark : (band % 2 ? warm : cool)[Math.floor(h * 7) % 3]).clone();
          // each column has its own light, and water stains run down from the lip in streaks
          const stain = smooth(0.45, 0.8, noise1(i * 0.41 + 3, g.seed + 2)) * (0.35 + 0.65 * (1 - fm));
          base.multiplyScalar(colLum * (0.95 + 0.1 * hash2(i, band, g.seed)) * (1 - 0.3 * stain));
        } else {
          base = mix(scree[0], scree[1], 0.5 + 0.5 * noise1(i * 0.21 + j * 0.31, g.seed + 9)).lerp(scree[2], 0.5 + 0.5 * noise1(i * 0.13 - j * 0.5, g.seed + 19));
          base.multiplyScalar(0.97 + 0.06 * hash2(i, j, g.seed + 2));
          // moss and grass at the foot of the scree
          if (j >= R - 3) base = mix(base, turf, 0.35 * smooth(0, 1, (j - (R - 3)) / 2));
        }
        const a = grid[i][j], b = grid[i1][j], c = grid[i][j + 1], d = grid[i1][j + 1];
        // (the diagonal runs the other way on alternate columns, so the facets do not line up)
        if ((i + j) % 2) {
          push(a, c, b, base);
          push(b, c, d, base.clone().multiplyScalar(0.97 + 0.06 * hash2(i, j, g.seed + 21)));
        } else {
          push(a, c, d, base);
          push(a, d, b, base.clone().multiplyScalar(0.97 + 0.06 * hash2(i, j, g.seed + 21)));
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(clr), 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  disposables.push(geo, mat);
  return { mesh, tris: pos.length / 9 };
}

/**
 * Paint a cliff's bands into the top-down texture (turf behind the lip, rock, scree), so the ground that is left round the
 * ribbon matches it. `path` and `fill` are hole3d's own drawing of a closed outline; `tx` and `tz` map metres to pixels.
 */
export function paintCliffs(c: CanvasRenderingContext2D, hole: BuiltHole, tx: (x: number) => number, tz: (z: number) => number) {
  const T = terrainOf(hole);
  for (const g of T.fx.cliffs) {
    const { p, nrm, closed } = brink(g, 2);
    const off = (d: number) => p.map((q, i) => [q[0] + nrm[i][0] * d, q[1] + nrm[i][1] * d] as P);
    const draw = (pts: P[]) => {
      pts.forEach(([x, z], i) => (i ? c.lineTo(tx(x), tz(z)) : c.moveTo(tx(x), tz(z))));
    };
    const band = (c0: number, c1: number, color: string) => {
      c.beginPath();
      const a = off(c0), b = off(c1);
      if (closed) {
        draw(a);
        c.closePath();
        draw(b);
        c.closePath();
        c.fillStyle = color;
        c.fill("evenodd");
      } else {
        draw(a);
        draw(b.reverse());
        c.closePath();
        c.fillStyle = color;
        c.fill();
      }
    };
    const st = stoneOf(g);
    band(-BACK - 0.6, -0.3, st.turf);
    band(-0.3, g.run + 0.5, st.paint.rock);
    band(g.run + 0.5, reachOf(g) + 0.4, st.paint.scree);
  }
}
