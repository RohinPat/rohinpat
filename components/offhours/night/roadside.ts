import { BRIDGE, ROCK_L, ROCK_R, flagsAt, pointAt, type Point, type Road } from "./road";
import { BOULDER, HOUSE, LAMP, PINE, stretchAt, type Scenery } from "./scenery";
import { P, project, type View } from "./view";

// What stands beside the road, and where it shows. The renderer paints the roadside
// far to near, and a later paint lands over an earlier one, so nothing can hide a
// thing behind a crest or a cliff by being drawn after it. This module decides that
// first: it lists each thing that shows at all, with the line it is cut at (the
// crest or the cliff's top in front of it) and how far it fades out. The painter
// draws the list and nothing else decides.
//
// The solids are the road's own surface (a crest hides what is behind it, across the
// whole picture) and the cliff walls (across their own columns). The drawn road ends
// at a fixed distance, and the roadside fades out over its last share, so nothing
// pops in at the edge. The guard (tests/unit/cars-roadside.test.ts) checks the list.

/** the sprites' proportions (height over width), see assets.ts */
export const PINE_HW = 2.33;
export const HOUSE_HW = 0.8;
export const ROCK_HW = 0.63;
/** a thing shows only if at least this many px of it are above the line in front of it */
const MIN_SHOW_PX = 2;
/** the share of the drawn distance the far end fades over */
export const FADE_SHARE = 0.3;
/** the land beside the road is a treeline as high as the roadside pines (2.33 x their mean width of 5.5 m, assets.ts), a verge out from the rail, and it is thick in depth: a thing behind less of it than this is not hidden by it */
export const TREE_TOP = PINE_HW * 5.5;
export const VERGE_M = 1.5;
export const TREE_THICK = 20;
/** how far out (m) the land goes: past any picture */
export const LAND_FAR_M = 400;

/** a thing that shows: a prop (`slot`, `k` the node in the window), a landmark, a sign or a gate (`i` indexes its list) */
export type Shown = {
  what: "prop" | "landmark" | "sign" | "gate";
  i: number;
  slot: number;
  k: number;
  /** depth (m), the screen top and base (px from the top), the screen columns it covers (px) */
  z: number;
  top: number;
  base: number;
  x0: number;
  x1: number;
  /** 0..1, how far it has faded: the object and any glow it has are painted at this one number, so a glow is never brighter than its object */
  fade: number;
  /** the picture is cut at this screen line (px): the crest or cliff in front of it; Infinity: all of it shows */
  clip: number;
};

/** the haze of the far country: the road's own fog (assets.ts tones the road by it), as the share of a thing's strength that is lost to it */
export function hazeAt(z: number): number {
  const t = Math.min(1, Math.max(0, (z - 90) / 620));
  return 0.78 * t * t * (3 - 2 * t);
}

/** the fade of a thing at depth z, when the drawn road reaches `reach` m */
export function fadeAt(z: number, reach: number): number {
  const from = reach * (1 - FADE_SHARE);
  if (z <= from) return 1;
  if (z >= reach) return 0;
  return (reach - z) / (reach - from);
}

// the solids the roadside is hidden by: flat arrays, rebuilt each frame
const SKY_MAX = 1024;
const skyZ = new Float64Array(SKY_MAX);
const skyX0 = new Float64Array(SKY_MAX);
const skyX1 = new Float64Array(SKY_MAX);
const skyTop = new Float64Array(SKY_MAX);
const skyT = new Float64Array(SKY_MAX);
let skyM = 0;
// the depth of each node in the window, rebuilt each frame
const nodeZ = new Float32Array(1024);
const pt: Point = { x: 0, y: 0, z: 0, phi: 0 };

function addSolid(z: number, x0: number, x1: number, top: number, thick = 0) {
  if (skyM >= SKY_MAX) return;
  skyZ[skyM] = z;
  skyX0[skyM] = x0;
  skyX1[skyM] = x1;
  skyTop[skyM] = top;
  skyT[skyM] = thick;
  skyM++;
}

/** the screen line that hides a thing at depth z over columns x0..x1: the highest top edge of the solids nearer than it (Infinity: none) */
export function horizonAt(z: number, x0: number, x1: number): number {
  let h = Infinity;
  for (let j = 0; j < skyM; j++) {
    // a solid of thickness hides only what is more than that far behind it
    if (skyZ[j] + skyT[j] >= z || skyX1[j] < x0 || skyX0[j] > x1) continue;
    if (skyTop[j] < h) h = skyTop[j];
  }
  return h;
}

/** the road point at s, `lat` right of its centre, `yo` above it, projected into P (false: behind the camera) */
function proj(v: View, road: Road, s: number, lat: number, yo: number): boolean {
  pointAt(road, s, lat, pt);
  return project(v, pt.x, pt.y + yo, pt.z);
}

/** the screen line of the treeline that hides a thing at world point (qx, qy, qz) from the camera: the highest treeline top the sightline meets on the land beside the road, or Infinity. The sightline is sampled against the centre-line nodes, nearest first, so it costs a few dozen steps; a sample only counts once it is a few metres nearer than the thing, as a treeline is. */
function treeClip(road: Road, v: View, qx: number, qy: number, qz: number, iLo: number, iHi: number): number {
  const zQ = (qx - v.camX) * v.sinG + (qz - v.camZ) * v.cosG;
  const seg = road.segM;
  const rail = road.railHalf;
  let clip = Infinity;
  let j = iLo;
  for (let k = 1; k < 30; k++) {
    const t = k / 30;
    const rx = v.camX + (qx - v.camX) * t;
    const ry = v.camY + (qy - v.camY) * t;
    const rz = v.camZ + (qz - v.camZ) * t;
    const zR = (rx - v.camX) * v.sinG + (rz - v.camZ) * v.cosG;
    if (zQ - zR < TREE_THICK) continue;
    let best = Infinity;
    let bj = j;
    for (let n = Math.max(iLo, j - 2); n <= Math.min(iHi, road.n - 1, j + 12); n++) {
      const d = (road.x[n] - rx) ** 2 + (road.z[n] - rz) ** 2;
      if (d < best) {
        best = d;
        bj = n;
      }
    }
    j = bj;
    const phi = road.phi[j];
    const lat = (rx - road.x[j]) * Math.cos(phi) - (rz - road.z[j]) * Math.sin(phi);
    if (Math.abs(lat) <= rail + VERGE_M || openGround(road, j * seg) || ry >= road.y[j] + TREE_TOP) continue;
    const topY = road.y[j] + TREE_TOP;
    const y = v.hy - (v.f * (topY - v.camY)) / zR;
    if (y < clip) clip = y;
  }
  return clip;
}

/** the treeline clip for the ground point at s, `lat` across the road. The road's corridor is open: what stands on it (a gate, a board, a lamp on the shoulder) is not hidden by the land beside it, as the road itself is not. */
function treeAt(road: Road, v: View, s: number, lat: number, i0: number, N: number): number {
  if (Math.abs(lat) <= road.railHalf + VERGE_M) return Infinity;
  pointAt(road, s, lat, treePt);
  return treeClip(road, v, treePt.x, treePt.y, treePt.z, i0, Math.min(i0 + N, Math.floor(s / road.segM) + 3, road.n - 1));
}
const treePt: Point = { x: 0, y: 0, z: 0, phi: 0 };

/** open ground, where the land beside the road is in view: the bridge is over a valley, the start is a clearing, the finish has its stands, the canyon's ridge is bare, and the climb is above the tree line */
export function openGround(road: Road, s: number): boolean {
  if (flagsAt(road, s) & BRIDGE) return true;
  if (s < 200 || s > road.finish - 280) return true;
  const k = stretchAt(road, s);
  return road.track === "climb" ? k >= 4 : k === 3;
}

/** the road's crest, cliffs and treeline over nodes i0..i0+N (the same nodes the road is drawn from) */
function buildSky(road: Road, sc: Scenery, v: View, i0: number, N: number) {
  skyM = 0;
  const seg = road.segM;
  const rail = road.railHalf;
  for (let k = 0; k <= N; k++) {
    const i = i0 + k;
    if (i >= road.n) break;
    if (!proj(v, road, i * seg, 0, 0) || P.z < 0.9) continue;
    const z = P.z;
    addSolid(z, -Infinity, Infinity, P.y);
    const fl = road.flags[i] | (i > 0 ? road.flags[i - 1] : 0);
    for (const side of [-1, 1] as const) {
      if (!(fl & (side < 0 ? ROCK_L : ROCK_R))) continue;
      if (!proj(v, road, i * seg, side * rail, 0)) continue;
      const xa = P.x;
      if (!proj(v, road, i * seg, side * (rail + sc.rockOut[i]), sc.rockTop[i])) continue;
      addSolid(z, Math.min(xa, P.x), Math.max(xa, P.x), P.y);
    }
  }
}

/** Places the roadside for a camera at `carS` (the view `v` is set), nodes i0..i0+N drawn, at `decor` detail. Fills `out` (its entries are reused) far to near within each kind, and returns how many. */
export function planRoadside(road: Road, sc: Scenery, v: View, carS: number, i0: number, N: number, decor: number, out: Shown[]): number {
  let n = 0;
  const seg = road.segM;
  const rail = road.railHalf;
  const f = v.f;
  const w = v.w;
  const farS = (i0 + N) * seg;
  const reach = farS - carS;
  // `tc` is the treeline's clip, worked out only when the crest or cliff has not already hidden the thing: it is the costly part
  const put = (what: Shown["what"], i: number, slot: number, k: number, z: number, top: number, base: number, x0: number, x1: number, fade: number, tc: () => number) => {
    // hidden when less than a couple of pixels of it is above the line in front of it (a sliver is not worth a clip)
    const hc = horizonAt(z, x0, x1);
    if (top > hc - MIN_SHOW_PX) return;
    const hz = Math.min(hc, tc());
    if (top > hz - MIN_SHOW_PX) return;
    if (n === out.length) out.push({ what, i, slot, k, z, top, base, x0, x1, fade, clip: Infinity });
    const it = out[n++];
    it.what = what;
    it.i = i;
    it.slot = slot;
    it.k = k;
    it.z = z;
    it.top = top;
    it.base = base;
    it.x0 = x0;
    it.x1 = x1;
    it.fade = fade;
    it.clip = base > hz ? hz : Infinity;
  };

  buildSky(road, sc, v, i0, N);
  for (let k = 0; k <= N; k++) {
    const i = i0 + k;
    nodeZ[k] = i < road.n && proj(v, road, i * seg, 0, 0) ? P.z : NaN;
  }

  // the roadside: pines, houses, boulders and lamps, far to near
  const maxZ = decor === 0 ? 330 : decor === 1 ? 190 : 100;
  for (let k = N; k >= 0; k--) {
    const i = i0 + k;
    if (i >= road.n) continue;
    const z0 = nodeZ[k];
    if (Number.isNaN(z0)) continue;
    for (let slot = 0; slot < 4; slot++) {
      const kd = sc.kind[i * 4 + slot];
      if (kd === 0) continue;
      const side = slot < 2 ? -1 : 1;
      const s = i * seg;
      // every prop and lamp is faded out past 110 m, and gone by maxZ + 30 (the same reach as before, the fade now shows it)
      if (z0 > maxZ + 30) continue;
      if (kd === LAMP) {
        // the pole, its arm over the rail and the glow at the arm
        if (!proj(v, road, s, side * (rail + 1.1), 0)) continue;
        const bx = P.x, base = P.y, z = P.z;
        if (bx < -300 || bx > w + 300) continue;
        if (!proj(v, road, s, side * (rail - 0.9), 8.0)) continue;
        const g = Math.min(decor > 1 ? 110 : 240, Math.max(9, (10 * f) / z));
        const fade = Math.min(z < 110 ? 1 : Math.max(0, 1 - (z - 110) / (maxZ + 30 - 110)), fadeAt(z, reach)) * (1 - hazeAt(z));
        if (fade <= 0) continue;
        put("prop", i, slot, k, z, P.y - g / 2, base, P.x - g / 2, P.x + g / 2, fade, () => treeAt(road, v, s, side * (rail + 1.1), i0, N));
        continue;
      }
      if (z0 < 12 || decor > 2) continue;
      // far ones thin out: every other tree beyond 140 m
      if ((z0 > 140 || decor > 1) && (i & 1) && kd === PINE) continue;
      if (kd === BOULDER && (z0 > 150 || decor > 0)) continue;
      if (kd === HOUSE && (decor > 0 || z0 < 26)) continue;
      if (!proj(v, road, s, side * (rail + sc.out[i * 4 + slot] * 0.25), 0)) continue;
      const z = P.z;
      const sz = sc.size[i * 4 + slot] / 255;
      const wm = kd === PINE ? 3.6 + 3.8 * sz : kd === HOUSE ? 7 + 4 * sz : 1.4 + 3 * sz;
      const pw = (wm * f) / z;
      const ph = pw * (kd === PINE ? PINE_HW : kd === HOUSE ? HOUSE_HW : ROCK_HW);
      if (ph < 2 || P.x + pw / 2 < 0 || P.x - pw / 2 > w || P.y - ph > v.h) continue;
      // the trees fade out past 110 m, and every thing fades at the end of the drawn road
      const fade = Math.min(z < 110 ? 1 : Math.max(0, 1 - (z - 110) / (maxZ + 30 - 110)), fadeAt(z, reach)) * (1 - hazeAt(z));
      if (fade <= 0) continue;
      put("prop", i, slot, k, z, P.y - ph * 0.98, P.y, P.x - pw / 2, P.x + pw / 2, fade, () => treeAt(road, v, s, side * (rail + sc.out[i * 4 + slot] * 0.25), i0, N));
    }
  }

  // the landmarks: each is placed on the ground it stands on, and its extent is the picture it draws
  // (at the bare road's level of detail the landmarks are not drawn)
  for (let li = 0; decor < 3 && li < sc.landmarks.length; li++) {
    const lm = sc.landmarks[li];
    if (lm.s < carS - 10 || lm.s > farS) continue;
    const ext = landmarkExtent(road, lm.kind, lm.s, lm.side, rail + lm.out, v, decor, i0, N);
    // a landmark is placed by its middle: one wholly off to the side of the picture is not drawn
    if (!ext || (ext.x0 + ext.x1) / 2 < -w * 0.6 || (ext.x0 + ext.x1) / 2 > w * 1.6) continue;
    // a landmark is hazed by distance as the road is, and fades out at the end of the drawn road
    const fade = fadeAt(ext.z, reach) * (1 - hazeAt(ext.z));
    if (fade <= 0) continue;
    put("landmark", li, 0, 0, ext.z, ext.top, ext.base, ext.x0, ext.x1, fade, ext.tc);
  }

  // the boards on the outside of the corners
  for (let si = 0; si < road.signs.length; si++) {
    const sg = road.signs[si];
    if (sg.s < carS - 6 || sg.s > farS) continue;
    pointAt(road, sg.s, sg.side * (rail + 1.0), pt);
    if (!project(v, pt.x, pt.y, pt.z)) continue;
    const z = P.z, base = P.y;
    const nx = Math.cos(pt.phi), nz = -Math.sin(pt.phi);
    if (!project(v, pt.x - nx * 0.95, pt.y + 2.5, pt.z - nz * 0.95)) continue;
    const xa = P.x, top = P.y;
    if (!project(v, pt.x + nx * 0.95, pt.y + 1.15, pt.z + nz * 0.95)) continue;
    const fade = fadeAt(z, reach) * (1 - hazeAt(z));
    if (fade <= 0) continue;
    put("sign", si, 0, 0, z, top, base, Math.min(xa, P.x), Math.max(xa, P.x), fade, () => treeAt(road, v, sg.s, sg.side * (rail + 1.0), i0, N));
  }

  // the gates: a gantry across the road, its posts either side
  for (let g = 0; g < road.checks.length; g++) {
    const gs = road.checks[g];
    if (gs < carS - 3 || gs > farS) continue;
    if (!proj(v, road, gs, -(rail + 0.5), 0)) continue;
    const z = P.z, base = P.y, lx = P.x;
    if (!proj(v, road, gs, rail + 0.5, 0)) continue;
    const rx = P.x;
    if (!proj(v, road, gs, -(rail + 0.5), 6.9)) continue;
    const top = P.y;
    const fade = fadeAt(z, reach) * (1 - hazeAt(z));
    if (fade <= 0) continue;
    put("gate", g, 0, 0, z, top, base, Math.min(lx, rx), Math.max(lx, rx), fade, () => treeAt(road, v, gs, -(rail + 0.5), i0, N));
  }
  return n;
}

/** a landmark's picture, and the treeline clip at its feet as a thunk (a pylon or tower has one foot either side of the road) */
function landmarkExtent(road: Road, kind: string, s: number, side: -1 | 1, lat: number, v: View, decor: number, i0: number, N: number): { z: number; base: number; top: number; x0: number; x1: number; tc: () => number } | null {
  const pic = landmarkPicture(road, kind, s, side, lat, v, decor);
  if (!pic) return null;
  const back = kind === "canopy" ? 7 : kind === "stand" ? 17 : 0;
  const tc = () => (kind === "pylons" || kind === "towers" ? Math.min(treeAt(road, v, s, -lat, i0, N), treeAt(road, v, s, lat, i0, N)) : treeAt(road, v, s, side * (lat + back), i0, N));
  return { ...pic, tc };
}

function landmarkPicture(road: Road, kind: string, s: number, side: -1 | 1, lat: number, v: View, decor: number): { z: number; base: number; top: number; x0: number; x1: number } | null {
  const f = v.f;
  switch (kind) {
    case "canopy": {
      // set back from the road: the sprite's own width is 15 m, and its height is that times 72/176
      if (decor > 1 || !proj(v, road, s, side * (lat + 7), 0)) return null;
      const pw = (15 * f) / P.z;
      return { z: P.z, base: P.y, top: P.y - (pw * 72) / 176, x0: P.x - pw / 2, x1: P.x + pw / 2 };
    }
    case "stand": {
      if (decor > 1 || !proj(v, road, s, side * (lat + 17), 0)) return null;
      const pw = (34 * f) / P.z;
      return { z: P.z, base: P.y, top: P.y - (pw * 108) / 400, x0: P.x - pw / 2, x1: P.x + pw / 2 };
    }
    case "mast": {
      if (!proj(v, road, s, side * lat, 0)) return null;
      const z = P.z, base = P.y, hw = Math.max(1.3, (0.32 * f) / z) / 2, x = P.x;
      if (!proj(v, road, s, side * lat, 36)) return null;
      return { z, base, top: P.y, x0: x - hw, x1: x + hw };
    }
    case "flood": {
      // the lamp bank, and the glow above it
      if (!proj(v, road, s, side * lat, 0)) return null;
      const base = P.y;
      if (!proj(v, road, s, side * lat, 17)) return null;
      const g = Math.min(420, Math.max(18, (20 * f) / P.z));
      return { z: P.z, base, top: P.y - g / 2, x0: P.x - g / 2, x1: P.x + g / 2 };
    }
    case "pylons":
    case "towers": {
      // a tower either side of the road, and the span between them
      const hgt = kind === "towers" ? 38 : 24;
      if (!proj(v, road, s, -lat, 0)) return null;
      const lz = P.z, lb = P.y;
      if (!proj(v, road, s, -lat, hgt)) return null;
      const lx = P.x, lt = P.y;
      if (!proj(v, road, s, lat, 0)) return null;
      const rz = P.z, rb = P.y;
      if (!proj(v, road, s, lat, hgt)) return null;
      return { z: Math.min(lz, rz), base: Math.max(lb, rb), top: Math.min(lt, P.y), x0: Math.min(lx, P.x), x1: Math.max(lx, P.x) };
    }
  }
  return null;
}
