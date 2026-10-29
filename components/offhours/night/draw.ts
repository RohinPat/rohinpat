import { ENGINE_CAL } from "../engineRemote";
import { BUCKETS, bucketOf, type Assets, type Pano } from "./assets";
import { carPoint, drawCar, EXHAUST, TAIL_LAMPS, type CarLook, type CarPose } from "./carMesh";
import { fontFamilies } from "../font";
import { MARK_N, SMOKE_N, SPARK_N } from "./fx";
import { BRIDGE, ROCK_L, ROCK_R, TUNNEL, heightAt, pointAt, type Point } from "./road";
import type { Scene } from "./scene";
import { BOULDER, HOUSE, LAMP, PINE, getScenery, type Scenery } from "./scenery";
import { P, newView, project, type View } from "./view";

// The road, in the classic arcade way but properly projected: every node of the
// centre line is turned into the camera's frame (so the camera may point where
// it likes: a drift swings it), and the pieces at a handful of distances across
// the road are projected once per node. Segments that a crest hides are never
// drawn. What is left is painted far to near in passes (rock, road, edge lines,
// dashes, rail, posts, reflectors, signs, gates), and a run of segments that
// share a distance step share one path and one fill, so a frame is a few dozen
// fills rather than a thousand.
//
// The light is the colour tables of assets.ts, stepped by distance; the car's
// headlights are soft additive pools on the road ahead of it and a wedge of light
// in the air. What stands beside the road (scenery.ts: pines, houses, lamps,
// boulders and the landmarks) is sprites and a few lines, placed far to near.
// Nothing is allocated in a frame: typed arrays and module scratch.

const CAM = ENGINE_CAL.cam;

const MAXN = 210;
/** the road's tone changes every this many segments */
const BAND = 3;
// the stations across the road each node is projected at
const S_ROADL = 0, S_ROADR = 1, S_EDGE_L0 = 2, S_EDGE_L1 = 3, S_EDGE_R0 = 4, S_EDGE_R1 = 5, S_DASH_L = 6, S_DASH_R = 7, S_RAIL0_L = 8, S_RAIL0_R = 9, S_RAIL1_L = 10, S_RAIL1_R = 11, S_RAIL2_L = 12, S_RAIL2_R = 13;
const S_ROCK_L = 14, S_ROCK_R = 15, S_TUN_LB = 16, S_TUN_RB = 17, S_TUN_LT = 18, S_TUN_RT = 19;
// the polished lanes the wheels run in, the cliff's ledge, the tunnel's reflective strip (two heights a side) and its lamps
const S_WL0 = 20, S_WL1 = 21, S_WR0 = 22, S_WR1 = 23, S_LEDGE_L = 24, S_LEDGE_R = 25;
const S_TUN_LS0 = 26, S_TUN_RS0 = 27, S_TUN_LS1 = 28, S_TUN_RS1 = 29, S_TUN_LL = 30, S_TUN_RL = 31;
const NS = 32;
const SX = new Float32Array(NS * MAXN);
const SY = new Float32Array(NS * MAXN);
// the node in the camera's frame
const NCX = new Float32Array(MAXN);
const NCY = new Float32Array(MAXN);
const NCZ = new Float32Array(MAXN);
const NNX = new Float32Array(MAXN);
const NNZ = new Float32Array(MAXN);
const NB = new Uint8Array(MAXN);
const VIS = new Int16Array(MAXN);
/** which nodes a crest has not hidden */
const SEEN = new Uint8Array(MAXN);
const YC = new Float32Array(MAXN);

const view: View = newView();
const tmp: Point = { x: 0, y: 0, z: 0, phi: 0 };
const tmp2 = { x: 0, y: 0, z: 0 };
let nVis = 0;

/** where a station of node k lands: written to SX/SY. Depth is clamped just ahead of the camera (what is behind never shows) */
function station(si: number, k: number, lat: number, yo: number, f: number, w2: number, hy: number) {
  let z = NCZ[k] + lat * NNZ[k];
  if (z < 0.7) z = 0.7;
  const x = NCX[k] + lat * NNX[k];
  SX[si * MAXN + k] = w2 + (f * x) / z;
  SY[si * MAXN + k] = hy - (f * (NCY[k] + yo)) / z;
}

function pano(ctx: CanvasRenderingContext2D, p: Pano, heading: number, pxPerRad: number, factor: number, bottomY: number, w: number, whole: boolean) {
  let off = (((heading * pxPerRad * factor) % p.W) + p.W) % p.W;
  let y = bottomY - p.H;
  // at a 1:1 blit a whole-pixel offset is a copy; a fractional one is a resample of the whole strip
  if (whole) {
    off = Math.round(off);
    y = Math.round(y);
  }
  ctx.drawImage(p.c, -off, y);
  if (p.W - off < w) ctx.drawImage(p.c, p.W - off, y);
}

/**
 * One frame of the world. `quality` (0 best to 2) is how far down the road is drawn; `decor` (0 to 3, by default the same number) is how
 * much of the picture beside it is: step 1 drops the vignette, the headlight wedge, the wear on the road, the ledges of the cliff and
 * the wet reflections; step 2 the speed lines, the two middle ranges and the city, and thins the roadside to the lamps, the near pines
 * and the slender landmarks; step 3 the rest of the roadside (but for the lamps). The tile draws a short road at decor 0, since its picture is the whole point.
 */
export function drawScene(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, quality: number, decor = quality) {
  const { w, h } = a;
  const cam = sc.cam;
  const road = sc.road;
  const pal = a.pal;
  const v = view;
  const w2 = w / 2;
  let f = w2 / Math.tan(cam.fov / 2);
  f = Math.max(f, h * 0.72);
  v.w = w;
  v.h = h;
  v.f = f;
  v.w2 = w2;
  let shx = 0;
  let shy = 0;
  if (!sc.reduce && cam.shake > 0.05) {
    shx = (Math.random() - 0.5) * cam.shake;
    shy = (Math.random() - 0.5) * cam.shake;
  } else if (!sc.reduce) {
    // a faint shudder at speed
    const sp = Math.min(1, sc.car.speed / 60);
    shy = (Math.random() - 0.5) * CAM.shakeSpeedPx * sp * sp;
  }
  const hy = a.hy0 + f * Math.tan(cam.pitch) + shy;
  v.hy = hy;
  v.camX = cam.x;
  v.camY = cam.y;
  v.camZ = cam.z;
  v.sinG = Math.sin(cam.heading);
  v.cosG = Math.cos(cam.heading);
  ctx.save();
  if (shx) ctx.translate(shx, 0);

  // ---- the sky and the far country (at 1x the strips are copied with whole-pixel offsets, no resampling; the quality steps drop the layers the eye misses least)
  const whole = a.dpr <= 1.01;
  if (whole) ctx.imageSmoothingEnabled = false;
  const bdPx = 1 / a.dpr;
  ctx.drawImage(a.backdrop, -a.backdropPad, Math.round((hy - a.hy0 - a.backdropTop) * a.dpr) * bdPx, a.backdrop.width * bdPx, a.backdrop.height * bdPx);
  pano(ctx, a.stars, cam.heading, a.px, 0.96, hy, w, whole);
  pano(ctx, a.far, cam.heading, a.px, 1.0, hy + 3, w, whole);
  if (decor < 2) {
    pano(ctx, a.city, cam.heading, a.px, 1.04, hy + h * 0.115, w, whole);
    pano(ctx, a.mid, cam.heading, a.px, 1.1, hy + h * 0.125, w, whole);
  }
  pano(ctx, a.near, cam.heading, a.px, 1.22, hy + h * 0.15, w, whole);
  ctx.imageSmoothingEnabled = true;

  // ---- the nodes in front of the camera
  const seg = road.segM;
  const carS = sc.car.s;
  const i0 = Math.max(0, Math.floor((carS - CAM.backM - 10) / seg));
  const N = Math.min(decor > 2 ? 76 : (CAM.drawSegs[quality] ?? 140), road.n - i0, MAXN - 2);
  const rh = road.half;
  const rail = road.railHalf;
  const sty = getScenery(road);
  for (let k = 0; k <= N; k++) {
    const i = i0 + k;
    const dx = road.x[i] - cam.x;
    const dz = road.z[i] - cam.z;
    NCX[k] = dx * v.cosG - dz * v.sinG;
    NCZ[k] = dx * v.sinG + dz * v.cosG;
    NCY[k] = road.y[i] - cam.y;
    const dphi = road.phi[i] - cam.heading;
    NNX[k] = Math.cos(dphi);
    NNZ[k] = -Math.sin(dphi);
    NB[k] = bucketOf(Math.max(0, NCZ[k]));
    station(S_ROADL, k, -rh, 0, f, w2, hy);
    station(S_ROADR, k, rh, 0, f, w2, hy);
    station(S_EDGE_L0, k, -(rh - 0.5), 0, f, w2, hy);
    station(S_EDGE_L1, k, -(rh - 0.14), 0, f, w2, hy);
    station(S_EDGE_R0, k, rh - 0.5, 0, f, w2, hy);
    station(S_EDGE_R1, k, rh - 0.14, 0, f, w2, hy);
    station(S_DASH_L, k, -0.12, 0, f, w2, hy);
    station(S_DASH_R, k, 0.12, 0, f, w2, hy);
    station(S_RAIL0_L, k, -rail, 0, f, w2, hy);
    station(S_RAIL0_R, k, rail, 0, f, w2, hy);
    station(S_RAIL1_L, k, -rail, 0.42, f, w2, hy);
    station(S_RAIL1_R, k, rail, 0.42, f, w2, hy);
    station(S_RAIL2_L, k, -rail, 0.9, f, w2, hy);
    station(S_RAIL2_R, k, rail, 0.9, f, w2, hy);
    station(S_WL0, k, -3.5, 0, f, w2, hy);
    station(S_WL1, k, -1.9, 0, f, w2, hy);
    station(S_WR0, k, 1.9, 0, f, w2, hy);
    station(S_WR1, k, 3.5, 0, f, w2, hy);
    const fl = road.flags[Math.min(i, road.n - 1)] | (i > 0 ? road.flags[i - 1] : 0);
    if (fl & (ROCK_L | ROCK_R)) {
      // the wall steps back as it climbs, in two faces with a ledge between; its top is ragged and, near the start and on the ridge, low enough to leave the sky
      const top = sty.rockTop[i];
      const out = sty.rockOut[i];
      const mid = 0.46 + 0.14 * sty.rockShade[i] / 3;
      station(S_ROCK_L, k, -(rail + out), top, f, w2, hy);
      station(S_ROCK_R, k, rail + out, top, f, w2, hy);
      station(S_LEDGE_L, k, -(rail + out * (0.34 + 0.1 * sty.rockShade[i] / 3)), top * mid, f, w2, hy);
      station(S_LEDGE_R, k, rail + out * (0.34 + 0.1 * sty.rockShade[i] / 3), top * mid, f, w2, hy);
    }
    if (fl & TUNNEL) {
      station(S_TUN_LB, k, -(rh + 1.4), 0, f, w2, hy);
      station(S_TUN_RB, k, rh + 1.4, 0, f, w2, hy);
      station(S_TUN_LT, k, -(rh + 1.4), 5.9, f, w2, hy);
      station(S_TUN_RT, k, rh + 1.4, 5.9, f, w2, hy);
      station(S_TUN_LS0, k, -(rh + 1.4), 0.85, f, w2, hy);
      station(S_TUN_RS0, k, rh + 1.4, 0.85, f, w2, hy);
      station(S_TUN_LS1, k, -(rh + 1.4), 1.2, f, w2, hy);
      station(S_TUN_RS1, k, rh + 1.4, 1.2, f, w2, hy);
      station(S_TUN_LL, k, -(rh + 1.25), 3.7, f, w2, hy);
      station(S_TUN_RL, k, rh + 1.25, 3.7, f, w2, hy);
    }
    let z = NCZ[k];
    if (z < 0.7) z = 0.7;
    YC[k] = hy - (f * NCY[k]) / z;
  }
  // which segments a crest has not hidden, near to far
  nVis = 0;
  let maxY = h + 400;
  SEEN.fill(0);
  for (let k = 0; k < N; k++) {
    if (NCZ[k + 1] < 0.9) continue;
    if (YC[k + 1] < maxY) {
      VIS[nVis++] = k;
      SEEN[k] = 1;
      maxY = YC[k + 1];
    }
  }

  const get = (si: number, k: number) => SX[si * MAXN + k];
  const gety = (si: number, k: number) => SY[si * MAXN + k];

  // ---- the rock: a cliff up the side where the flags say so, in two faces with a ledge between, painted far to near
  let cur = -1;
  for (let pass = 0; pass < 2; pass++) {
    const flag = pass === 0 ? ROCK_L : ROCK_R;
    const base = pass === 0 ? S_RAIL0_L : S_RAIL0_R;
    const ledge = pass === 0 ? S_LEDGE_L : S_LEDGE_R;
    const top = pass === 0 ? S_ROCK_L : S_ROCK_R;
    // lower face (lit by the lamps), then the upper face (further from them, leaning away)
    for (let face = 0; face < 2; face++) {
      cur = -1;
      const lo = face ? ledge : base;
      const hi = face ? top : ledge;
      for (let t = nVis - 1; t >= 0; t--) {
        const k = VIS[t];
        if (!(road.flags[i0 + k] & flag)) continue;
        const key = NB[k] * 4 + (face ? 0 : sty.rockShade[i0 + k]);
        if (key !== cur) {
          if (cur >= 0) ctx.fill();
          ctx.fillStyle = face ? pal.rockLo[NB[k]] : pal.rock[key];
          ctx.beginPath();
          cur = key;
        }
        ctx.moveTo(get(lo, k), gety(lo, k));
        ctx.lineTo(get(hi, k), gety(hi, k));
        ctx.lineTo(get(hi, k + 1), gety(hi, k + 1));
        ctx.lineTo(get(lo, k + 1), gety(lo, k + 1));
        ctx.closePath();
      }
      if (cur >= 0) ctx.fill();
    }
    // the ledge catches the light, and the skyline catches the moon; a few cracks run down the lower face
    if (decor < 1) {
      cur = -1;
      ctx.lineWidth = 1.4;
      for (let t = nVis - 1; t >= 0; t--) {
        const k = VIS[t];
        if (!(road.flags[i0 + k] & flag)) continue;
        if (NB[k] !== cur) {
          if (cur >= 0) ctx.stroke();
          ctx.strokeStyle = pal.rockHi[NB[k]];
          ctx.beginPath();
          cur = NB[k];
        }
        ctx.moveTo(get(ledge, k), gety(ledge, k));
        ctx.lineTo(get(ledge, k + 1), gety(ledge, k + 1));
        if (sty.rockShade[i0 + k] === 1 && NB[k] < 15) {
          ctx.moveTo(get(ledge, k), gety(ledge, k));
          ctx.lineTo(get(base, k), gety(base, k));
        }
      }
      if (cur >= 0) ctx.stroke();
      ctx.strokeStyle = "rgba(170,226,196,0.2)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let pen = false;
      for (let t = nVis - 1; t >= 0; t--) {
        const k = VIS[t];
        if (!(road.flags[i0 + k] & flag) || NB[k] > 17) {
          pen = false;
          continue;
        }
        if (!pen) ctx.moveTo(get(top, k), gety(top, k));
        ctx.lineTo(get(top, k + 1), gety(top, k + 1));
        pen = true;
      }
      ctx.stroke();
    }
  }

  // ---- the road itself, laid in bands of two tones (BAND segments each): they stream under the car, which is most of what a road at night says about speed
  cur = -1;
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const b = NB[k];
    const key = b * 2 + (Math.floor((i0 + k) / BAND) & 1);
    if (key !== cur) {
      if (cur >= 0) ctx.fill();
      ctx.fillStyle = key & 1 ? pal.roadAlt[b] : pal.road[b];
      ctx.beginPath();
      cur = key;
    }
    ctx.moveTo(get(S_ROADL, k), gety(S_ROADL, k));
    ctx.lineTo(get(S_ROADR, k), gety(S_ROADR, k));
    ctx.lineTo(get(S_ROADR, k + 1), gety(S_ROADR, k + 1));
    ctx.lineTo(get(S_ROADL, k + 1), gety(S_ROADL, k + 1));
    ctx.closePath();
  }
  if (cur >= 0) ctx.fill();

  // ---- the wear: two polished tracks in each lane, a patch of tar every so often, and the line the grid starts on
  if (decor < 1) {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    for (let t = nVis - 1; t >= 0; t--) {
      const k = VIS[t];
      if (NB[k] > 16) continue;
      for (let side = 0; side < 2; side++) {
        const a0 = side ? S_WR0 : S_WL0;
        const a1 = side ? S_WR1 : S_WL1;
        ctx.moveTo(get(a0, k), gety(a0, k));
        ctx.lineTo(get(a1, k), gety(a1, k));
        ctx.lineTo(get(a1, k + 1), gety(a1, k + 1));
        ctx.lineTo(get(a0, k + 1), gety(a0, k + 1));
        ctx.closePath();
      }
    }
    ctx.fill();
    // the patches: a darker seam across the road every 36 m, a few lighter
    ctx.lineCap = "butt";
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? "rgba(255,244,214,0.07)" : "rgba(0,0,0,0.38)";
      ctx.beginPath();
      for (let t = nVis - 1; t >= 0; t--) {
        const k = VIS[t];
        if (NB[k] > 17) continue;
        const i = i0 + k;
        const h9 = i % 9;
        if (pass ? h9 !== 4 : h9 !== 0) continue;
        if (road.flags[i] & TUNNEL) continue;
        ctx.moveTo(get(S_ROADL, k), gety(S_ROADL, k));
        ctx.lineTo(get(S_ROADR, k), gety(S_ROADR, k));
      }
      ctx.lineWidth = pass ? 2.2 : 1.4;
      ctx.stroke();
    }
    ctx.lineCap = "round";
  }

  // ---- lane markings: reflective paint reaches further than the asphalt
  cur = -1;
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const b = NB[k];
    if (b !== cur) {
      if (cur >= 0) ctx.fill();
      ctx.fillStyle = pal.edge[b];
      ctx.beginPath();
      cur = b;
    }
    for (let side = 0; side < 2; side++) {
      const a0 = side ? S_EDGE_R0 : S_EDGE_L0;
      const a1 = side ? S_EDGE_R1 : S_EDGE_L1;
      ctx.moveTo(get(a0, k), gety(a0, k));
      ctx.lineTo(get(a1, k), gety(a1, k));
      ctx.lineTo(get(a1, k + 1), gety(a1, k + 1));
      ctx.lineTo(get(a0, k + 1), gety(a0, k + 1));
      ctx.closePath();
    }
    if (((i0 + k) & 3) === 0) {
      ctx.moveTo(get(S_DASH_L, k), gety(S_DASH_L, k));
      ctx.lineTo(get(S_DASH_R, k), gety(S_DASH_R, k));
      ctx.lineTo(get(S_DASH_R, k + 1), gety(S_DASH_R, k + 1));
      ctx.lineTo(get(S_DASH_L, k + 1), gety(S_DASH_L, k + 1));
      ctx.closePath();
    }
  }
  if (cur >= 0) ctx.fill();

  // ---- the start line, across both lanes
  if (carS < 60) startLine(ctx, v, road);

  // ---- the rubber the car has laid
  if (!sc.reduce) drawMarks(ctx, sc, v, carS - 10, carS + 140);

  // ---- the roadside beyond the rail, far to near: pines, houses, boulders, lamps and the landmarks (the nearest are drawn after the rail)
  const sFar = carS + N * seg;
  const sFar0 = sFar;
  drawProps(ctx, a, sc, v, i0, sty, false, decor);
  if (decor < 3) drawLandmarks(ctx, a, sc, v, sty, carS, decor > 1 ? Math.min(sFar, carS + 170) : sFar, false, decor);

  // ---- the guardrail (a solid parapet on the bridge, walls in the tunnel)
  cur = -1;
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const fl = road.flags[i0 + k];
    if (fl & TUNNEL) continue;
    const b = NB[k];
    const key = fl & BRIDGE ? b + BUCKETS : b;
    if (key !== cur) {
      if (cur >= 0) ctx.fill();
      ctx.fillStyle = key >= BUCKETS ? pal.parapet[b] : pal.rail[b];
      ctx.beginPath();
      cur = key;
    }
    const bridge = (fl & BRIDGE) !== 0;
    for (let side = 0; side < 2; side++) {
      const lo = bridge ? (side ? S_RAIL0_R : S_RAIL0_L) : side ? S_RAIL1_R : S_RAIL1_L;
      const hi = side ? S_RAIL2_R : S_RAIL2_L;
      ctx.moveTo(get(lo, k), gety(lo, k));
      ctx.lineTo(get(hi, k), gety(hi, k));
      ctx.lineTo(get(hi, k + 1), gety(hi, k + 1));
      ctx.lineTo(get(lo, k + 1), gety(lo, k + 1));
      ctx.closePath();
    }
  }
  if (cur >= 0) ctx.fill();
  // the top lip of the rail catches the light
  cur = -1;
  ctx.lineWidth = 1.2;
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const fl = road.flags[i0 + k];
    if (fl & TUNNEL) continue;
    const b = NB[k];
    if (b !== cur) {
      if (cur >= 0) ctx.stroke();
      ctx.strokeStyle = pal.railHi[b];
      ctx.beginPath();
      cur = b;
    }
    ctx.moveTo(get(S_RAIL2_L, k), gety(S_RAIL2_L, k));
    ctx.lineTo(get(S_RAIL2_L, k + 1), gety(S_RAIL2_L, k + 1));
    ctx.moveTo(get(S_RAIL2_R, k), gety(S_RAIL2_R, k));
    ctx.lineTo(get(S_RAIL2_R, k + 1), gety(S_RAIL2_R, k + 1));
  }
  if (cur >= 0) ctx.stroke();

  // ---- the tunnel: walls, a ceiling and its lamps
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const fl = road.flags[i0 + k];
    if (!(fl & TUNNEL)) continue;
    const b = NB[k];
    ctx.fillStyle = pal.tunnel[b];
    ctx.beginPath();
    for (let side = 0; side < 2; side++) {
      const lo = side ? S_TUN_RB : S_TUN_LB;
      const hi = side ? S_TUN_RT : S_TUN_LT;
      ctx.moveTo(get(lo, k), gety(lo, k));
      ctx.lineTo(get(hi, k), gety(hi, k));
      ctx.lineTo(get(hi, k + 1), gety(hi, k + 1));
      ctx.lineTo(get(lo, k + 1), gety(lo, k + 1));
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = pal.ceiling[b];
    ctx.beginPath();
    ctx.moveTo(get(S_TUN_LT, k), gety(S_TUN_LT, k));
    ctx.lineTo(get(S_TUN_RT, k), gety(S_TUN_RT, k));
    ctx.lineTo(get(S_TUN_RT, k + 1), gety(S_TUN_RT, k + 1));
    ctx.lineTo(get(S_TUN_LT, k + 1), gety(S_TUN_LT, k + 1));
    ctx.closePath();
    ctx.fill();
    if (((i0 + k) & 3) === 0) {
      // a strip of lamps down the middle of the ceiling
      ctx.fillStyle = pal.lamp[b];
      const mx0 = (get(S_TUN_LT, k) + get(S_TUN_RT, k)) * 0.5;
      const mx1 = (get(S_TUN_LT, k + 1) + get(S_TUN_RT, k + 1)) * 0.5;
      const my0 = (gety(S_TUN_LT, k) + gety(S_TUN_RT, k)) * 0.5;
      const my1 = (gety(S_TUN_LT, k + 1) + gety(S_TUN_RT, k + 1)) * 0.5;
      const wd0 = Math.max(1, (get(S_TUN_RT, k) - get(S_TUN_LT, k)) * 0.16);
      const wd1 = Math.max(1, (get(S_TUN_RT, k + 1) - get(S_TUN_LT, k + 1)) * 0.16);
      ctx.beginPath();
      ctx.moveTo(mx0 - wd0, my0);
      ctx.lineTo(mx0 + wd0, my0);
      ctx.lineTo(mx1 + wd1, my1);
      ctx.lineTo(mx1 - wd1, my1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---- the tunnel's reflective strip along the foot of each wall, its wall lamps, and the mouths
  if (sty.tunnel && sFar0 > sty.tunnel[0] - 20 && carS < sty.tunnel[1] + 10) {
    cur = -1;
    for (let t = nVis - 1; t >= 0; t--) {
      const k = VIS[t];
      if (!(road.flags[i0 + k] & TUNNEL)) continue;
      const b = NB[k];
      if (b !== cur) {
        if (cur >= 0) ctx.fill();
        ctx.fillStyle = pal.edge[b];
        ctx.beginPath();
        cur = b;
      }
      for (let side = 0; side < 2; side++) {
        const lo = side ? S_TUN_RS0 : S_TUN_LS0;
        const hi = side ? S_TUN_RS1 : S_TUN_LS1;
        ctx.moveTo(get(lo, k), gety(lo, k));
        ctx.lineTo(get(hi, k), gety(hi, k));
        ctx.lineTo(get(hi, k + 1), gety(hi, k + 1));
        ctx.lineTo(get(lo, k + 1), gety(lo, k + 1));
        ctx.closePath();
      }
    }
    if (cur >= 0) ctx.fill();
    if (decor < 1) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.8;
      for (let t = nVis - 1; t >= 0; t--) {
        const k = VIS[t];
        if (!(road.flags[i0 + k] & TUNNEL) || (i0 + k) % 6 || NCZ[k] > 200) continue;
        const g = Math.min(200, Math.max(8, (6.5 * f) / Math.max(1, NCZ[k])));
        for (let side = 0; side < 2; side++) {
          const lamp = side ? S_TUN_RL : S_TUN_LL;
          ctx.drawImage(a.sprites.sodium, get(lamp, k) - g / 2, gety(lamp, k) - g / 2, g, g);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    // only the near mouth, and only from outside: from inside, a frame at the far end would be painted over the walls that are nearer
    if (carS + 4 < sty.tunnel[0]) portal(ctx, a, v, road, sty.tunnel[0], rh);
  }

  // ---- posts and reflectors, far to near
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const i = i0 + k;
    const fl = road.flags[i];
    if (fl & (TUNNEL | BRIDGE)) continue;
    if (i & 1) continue;
    const b = NB[k];
    ctx.fillStyle = pal.post[b];
    const z = Math.max(1, NCZ[k]);
    const pw = Math.max(1, (0.13 * f) / z);
    for (let side = 0; side < 2; side++) {
      const lo = side ? S_RAIL0_R : S_RAIL0_L;
      const hi = side ? S_RAIL2_R : S_RAIL2_L;
      const x = get(lo, k);
      ctx.fillRect(x - pw / 2, gety(hi, k), pw, gety(lo, k) - gety(hi, k));
    }
  }
  // reflectors: the dots that make a road at night. Amber on the left, white on the right.
  for (let side = 0; side < 2; side++) {
    cur = -1;
    const mid = side ? S_RAIL1_R : S_RAIL1_L;
    const hi = side ? S_RAIL2_R : S_RAIL2_L;
    for (let t = nVis - 1; t >= 0; t--) {
      const k = VIS[t];
      const i = i0 + k;
      const fl = road.flags[i];
      if (fl & TUNNEL) continue;
      if (i & 1) continue;
      const b = NB[k];
      if (b !== cur) {
        ctx.fillStyle = side ? pal.reflR[b] : pal.reflL[b];
        cur = b;
      }
      const z = Math.max(1, NCZ[k]);
      const sz = Math.max(1.5, (0.2 * f) / z);
      const x = get(mid, k);
      const y = (gety(mid, k) + gety(hi, k)) * 0.5;
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz * 0.8);
    }
  }

  // ---- lamps on the bridge
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const i = i0 + k;
    if (!(road.flags[i] & BRIDGE) || i % 7) continue;
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      pointAt(road, i * seg, sg * (rail + 0.2), tmp);
      if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
      const bx = P.x, by = P.y, z = P.z;
      if (!project(v, tmp.x, tmp.y + 7.2, tmp.z)) continue;
      const tx = P.x, ty = P.y;
      ctx.fillStyle = pal.post[NB[k]];
      const pw = Math.max(1, (0.2 * f) / z);
      ctx.fillRect(bx - pw / 2, ty, pw, by - ty);
      const g = Math.min(280, Math.max(10, (11 * f) / z));
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.95;
      ctx.drawImage(a.sprites.sodium, tx - g / 2, ty - g / 2, g, g);
      if (decor < 1 && z < 170) {
        // its pool on the deck, and its reflection in the wet
        const fall = Math.min(1, 80 / z);
        const rw = Math.min(520, (14 * f) / z);
        ctx.globalAlpha = 0.45 * fall;
        ctx.drawImage(a.sprites.sodium, bx - rw / 2, by - rw * 0.06, rw, rw * 0.12);
        if (by - ty > 4) {
          const sw = Math.max(3, (1.1 * f) / z);
          ctx.drawImage(a.sprites.streak, tx - sw / 2, by, sw, (by - ty) * 0.9);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ---- the nearest of the roadside, over the rail
  drawProps(ctx, a, sc, v, i0, sty, true, decor);
  if (decor < 3) drawLandmarks(ctx, a, sc, v, sty, carS, decor > 1 ? Math.min(sFar, carS + 170) : sFar, true, decor);

  // ---- chevron boards on the outside of the corners
  for (const sign of road.signs) {
    if (sign.s < carS - 6 || sign.s > sFar) continue;
    const lat = sign.side * (rail + 1.0);
    pointAt(road, sign.s, lat, tmp);
    const b = bucketOf(Math.max(0, (tmp.x - cam.x) * v.sinG + (tmp.z - cam.z) * v.cosG));
    // the pole, the board
    const y0 = tmp.y;
    const nx = Math.cos(tmp.phi);
    const nz = -Math.sin(tmp.phi);
    if (!project(v, tmp.x, y0, tmp.z)) continue;
    const bx = P.x, by = P.y, z = P.z;
    const half = 0.95;
    if (!project(v, tmp.x - nx * half, y0 + 2.5, tmp.z - nz * half)) continue;
    const x0 = P.x, yT = P.y;
    if (!project(v, tmp.x + nx * half, y0 + 1.15, tmp.z + nz * half)) continue;
    const x1 = P.x, yB = P.y;
    ctx.fillStyle = a.pal.post[b];
    const pw = Math.max(1, (0.14 * f) / z);
    ctx.fillRect(bx - pw / 2, yT, pw, by - yT);
    ctx.fillStyle = pal.board[b];
    ctx.fillRect(Math.min(x0, x1), yT, Math.abs(x1 - x0), yB - yT);
    // the arrow points the way the road turns
    const cx = (x0 + x1) / 2;
    const cy = (yT + yB) / 2;
    const ww = Math.abs(x1 - x0) * 0.26;
    const hh = (yB - yT) * 0.3;
    const d = sign.dir;
    ctx.strokeStyle = pal.edge[b];
    ctx.lineWidth = Math.max(1.2, (0.17 * f) / z);
    ctx.lineJoin = "miter";
    ctx.beginPath();
    ctx.moveTo(cx - d * ww, cy - hh);
    ctx.lineTo(cx + d * ww, cy);
    ctx.lineTo(cx - d * ww, cy + hh);
    ctx.stroke();
  }

  // ---- the gates
  for (let g = 0; g < road.checks.length; g++) {
    const gs = road.checks[g];
    if (gs < carS - 3 || gs > sFar) continue;
    drawGate(ctx, a, sc, v, gs, g === road.checks.length - 1, g < sc.cp, g + 1);
  }

  // ---- the headlights: a warm pool on the road ahead, as an additive gradient
  headlights(ctx, a, sc, v, decor);

  // ---- the things on the road, far to near: the ghosts, the car, and what it throws
  drawFxSmoke(ctx, a, sc, v);
  const car = sc.car;
  const carPose = poseOf(road, car.s, car.lat, car.psi, car.ay, CAR_POSE);
  const dz = (x: number, z: number) => (x - cam.x) * v.sinG + (z - cam.z) * v.cosG;
  const dCar = dz(carPose.x, carPose.z);
  // the ghosts farther off than the car, the car, then the ghosts nearer
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 1) {
      drawMainCar(ctx, a, sc, v, carPose);
      continue;
    }
    for (const g of sc.ghosts) {
      if (!g.show) continue;
      const gp = poseOf(road, g.pose.s, g.pose.lat, g.pose.psi, 0, GHOST_POSE);
      const d = dz(gp.x, gp.z);
      // a ghost right on top of the car is the same place: not worth drawing
      if (Math.abs(d - dCar) < 0.7 && Math.abs(g.pose.lat - car.lat) < 0.9) continue;
      if ((pass === 0) !== d > dCar) continue;
      if (d < 3 || d > 330) continue;
      drawCar(ctx, v, gp, g.kind === 0 ? GHOST_TARGET : GHOST_BEST);
      if (d > 7 && d < 140) tag(ctx, v, gp, g.kind === 0 ? "TARGET" : "YOUR BEST", g.kind === 0 ? "#8ad9a8" : "#f2ead7", d);
    }
  }
  drawSparks(ctx, sc, v);

  // ---- a soft shade around the edges, and speed lines
  ctx.restore();
  if (decor < 1) ctx.drawImage(a.vignette, 0, 0, a.vignette.width / a.dpr, a.vignette.height / a.dpr);
  if (!sc.reduce && decor < 2) speedLines(ctx, a, sc, hy, shx);
}

/** the point `lat` m across the road and `yo` m above it at node k, in the camera's frame this frame, to P (no trigonometry: the node is already turned) */
function nodeProj(k: number, lat: number, yo: number, v: View): boolean {
  const z = NCZ[k] + lat * NNZ[k];
  if (z < 0.35) return false;
  P.x = v.w2 + (v.f * (NCX[k] + lat * NNX[k])) / z;
  P.y = v.hy - (v.f * (NCY[k] + yo)) / z;
  P.z = z;
  return true;
}

/** nearer than this the roadside is drawn after the rail (it can stand in front of it), farther before it */
const NEAR_Z = 42;

/** the pines, houses and boulders beside the road, and its lamps, far to near */
function drawProps(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View, i0: number, sty: Scenery, near: boolean, decor: number) {
  const road = sc.road;
  const rail = road.railHalf;
  const f = v.f;
  const maxZ = decor === 0 ? 330 : decor === 1 ? 190 : 100;
  const sp = a.sprites;
  let alpha = 1;
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const z0 = NCZ[k];
    if (z0 < NEAR_Z !== near || z0 > maxZ) continue;
    const i = i0 + k;
    for (let slot = 0; slot < 4; slot++) {
      const kd = sty.kind[i * 4 + slot];
      if (kd === 0) continue;
      const side = slot < 2 ? -1 : 1;
      if (kd === LAMP) {
        drawLamp(ctx, a, v, k, side, decor, rail);
        alpha = 1;
        continue;
      }
      if (decor > 2) continue;
      // far ones thin out: every other tree beyond 140 m
      if ((z0 > 140 || decor > 1) && (i & 1) && kd === PINE) continue;
      if (z0 < 12 && kd !== LAMP) continue;
      if (kd === BOULDER && z0 > 150) continue;
      if (!nodeProj(k, side * (rail + sty.out[i * 4 + slot] * 0.25), 0, v)) continue;
      const z = P.z;
      const sz = sty.size[i * 4 + slot] / 255;
      let img: HTMLCanvasElement;
      let wm: number;
      if (kd === PINE) {
        img = sp.pine[(sty.size[i * 4 + slot] >> 2) % 3];
        wm = 3.6 + 3.8 * sz;
      } else if (kd === HOUSE) {
        if (decor > 0 || z0 < 26) continue;
        img = sp.house[sty.size[i * 4 + slot] & 1];
        wm = 7 + 4 * sz;
      } else {
        if (decor > 0) continue;
        img = sp.rock;
        wm = 1.4 + 3 * sz;
      }
      const pw = (wm * f) / z;
      const ph = (pw * img.height) / img.width;
      if (ph < 2 || P.x + pw / 2 < 0 || P.x - pw / 2 > v.w || P.y - ph > v.h) continue;
      const al = z < 110 ? 1 : Math.max(0, 1 - (z - 110) / (maxZ + 30 - 110));
      if (al !== alpha) {
        ctx.globalAlpha = al;
        alpha = al;
      }
      ctx.drawImage(img, P.x - pw / 2, P.y - ph * 0.98, pw, ph);
    }
  }
  ctx.globalAlpha = 1;
}

const tmpB: Point = { x: 0, y: 0, z: 0, phi: 0 };

/** a sodium lamp on a pole with an arm over the road: its glow, the pool of light it throws down, and its reflection in the asphalt */
function drawLamp(ctx: CanvasRenderingContext2D, a: Assets, v: View, k: number, side: number, decor: number, rail: number) {
  const f = v.f;
  if (!nodeProj(k, side * (rail + 1.1), 0, v)) return;
  const bx = P.x, by = P.y, z = P.z;
  // a lamp wholly off to the side of the picture is not drawn
  if (bx < -300 || bx > v.w + 300) return;
  const b = bucketOf(z);
  if (!nodeProj(k, side * (rail + 1.1), 7.6, v)) return;
  const tx = P.x, ty = P.y;
  // the arm reaches over the rail toward the road
  if (!nodeProj(k, side * (rail - 0.9), 8.0, v)) return;
  const hx = P.x, hyy = P.y;
  const pw = Math.max(1, (0.22 * f) / z);
  ctx.fillStyle = a.pal.post[b];
  ctx.fillRect(bx - pw / 2, ty, pw, by - ty);
  ctx.strokeStyle = a.pal.post[b];
  ctx.lineWidth = Math.max(1, pw * 0.7);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx, hyy);
  ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  const g = Math.min(decor > 1 ? 110 : 240, Math.max(9, (10 * f) / z));
  ctx.globalAlpha = 0.95;
  ctx.drawImage(a.sprites.sodium, hx - g / 2, hyy - g / 2, g, g);
  if (decor < 1 && z < 190 && nodeProj(k, side * (rail - 0.9), 0, v)) {
    // the pool on the road under it, and the lamp upside down in the wet
    const gx = P.x, gy = P.y;
    const rw = Math.min(520, (15 * f) / z);
    const fall = Math.min(1, 70 / z);
    ctx.globalAlpha = 0.5 * fall;
    ctx.drawImage(a.sprites.sodium, gx - rw / 2, gy - rw * 0.06, rw, rw * 0.12);
    const len = gy - hyy;
    if (len > 3 && z < 150) {
      const sw = Math.max(3, (1.1 * f) / z);
      ctx.drawImage(a.sprites.streak, gx - sw / 2, gy, sw, len * 0.9);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** the things the canyon is told by: each is drawn on the pass its distance belongs to */
function drawLandmarks(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View, sty: Scenery, carS: number, sFar: number, near: boolean, decor: number) {
  const road = sc.road;
  const rail = road.railHalf;
  const f = v.f;
  const sp = a.sprites;
  for (const lm of sty.landmarks) {
    if (lm.s < carS - 10 || lm.s > sFar) continue;
    const lat = lm.side * (rail + lm.out);
    pointAt(road, lm.s, lat, tmp);
    if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
    const bx = P.x, by = P.y, z = P.z;
    if (z < NEAR_Z !== near) continue;
    if (z > 700 || bx < -v.w * 0.6 || bx > v.w * 1.6) continue;
    const phi = tmp.phi;
    const y0 = tmp.y;
    const nx = Math.cos(phi);
    const nz = -Math.sin(phi);
    const wx = tmp.x, wz = tmp.z;
    switch (lm.kind) {
      case "canopy": {
        if (decor > 1) break;
        // set back from the road: the sprite's own width is 15 m
        pointAt(road, lm.s, lm.side * (rail + lm.out + 7), tmp);
        if (!project(v, tmp.x, tmp.y, tmp.z)) break;
        const pw = (15 * f) / P.z;
        const ph = (pw * sp.canopy.height) / sp.canopy.width;
        if (P.x + pw / 2 < 0 || P.x - pw / 2 > v.w) break;
        ctx.drawImage(sp.canopy, P.x - pw / 2, P.y - ph * 0.96, pw, ph);
        break;
      }
      case "stand": {
        if (decor > 1) break;
        pointAt(road, lm.s, lm.side * (rail + lm.out + 17), tmp);
        if (!project(v, tmp.x, tmp.y, tmp.z)) break;
        const pw = (34 * f) / P.z;
        const ph = (pw * sp.stand.height) / sp.stand.width;
        if (P.x + pw / 2 < 0 || P.x - pw / 2 > v.w) break;
        ctx.drawImage(sp.stand, P.x - pw / 2, P.y - ph * 0.98, pw, ph);
        break;
      }
      case "mast": {
        if (!project(v, wx, y0 + 36, wz)) break;
        const tx = P.x, ty = P.y;
        const w = Math.max(1.3, (0.32 * f) / z);
        ctx.fillStyle = a.pal.rock[bucketOf(z) * 4 + 2];
        ctx.fillRect(bx - w / 2, ty, w, by - ty);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = Math.max(1, w * 0.5);
        ctx.beginPath();
        for (const hh of [0.5, 0.78]) {
          const yy = by + (ty - by) * hh;
          const half = (2.4 * (1 - hh * 0.5) * f) / z;
          ctx.moveTo(bx - half, yy);
          ctx.lineTo(bx + half, yy);
        }
        ctx.stroke();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.95;
        for (const hh of [1, 0.78, 0.5]) {
          const g = Math.max(7, (6 * f) / z);
          ctx.drawImage(sp.red, bx - g / 2, by + (ty - by) * hh - g / 2, g, g);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        break;
      }
      case "flood": {
        // a floodlight mast: a bank of lamps on top, a wide wash of light on the road under it
        if (!project(v, wx, y0 + 17, wz)) break;
        const tx = P.x, ty = P.y;
        const w = Math.max(1.3, (0.3 * f) / z);
        ctx.fillStyle = a.pal.rock[bucketOf(z) * 4 + 2];
        ctx.fillRect(bx - w / 2, ty, w, by - ty);
        const bw = (3.2 * f) / z;
        ctx.fillRect(tx - bw / 2, ty - bw * 0.3, bw, bw * 0.34);
        ctx.globalCompositeOperation = "lighter";
        const g = Math.min(420, Math.max(18, (20 * f) / z));
        ctx.globalAlpha = 0.9;
        ctx.drawImage(sp.white, tx - g / 2, ty - g / 2, g, g);
        pointAt(road, lm.s, lm.side * (rail - 3), tmpB);
        if (decor < 2 && project(v, tmpB.x, tmpB.y, tmpB.z)) {
          const rw = Math.min(900, (30 * f) / P.z);
          ctx.globalAlpha = 0.38 * Math.min(1, 90 / P.z);
          ctx.drawImage(sp.white, P.x - rw / 2, P.y - rw * 0.06, rw, rw * 0.12);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        break;
      }
      case "pylons": {
        // a pair of lattice towers either side of the road, three cables slung across above it
        const arms = [23, 19, 15];
        for (let sd = -1; sd <= 1; sd += 2) {
          const px = wx + (sd * (rail + lm.out) - lat) * nx;
          const pz = wz + (sd * (rail + lm.out) - lat) * nz;
          if (!project(v, px, y0, pz)) continue;
          const lx = P.x, ly = P.y, lz = P.z;
          if (!project(v, px, y0 + 24, pz)) continue;
          const ty = P.y;
          const lw = Math.max(1, (0.3 * f) / lz);
          ctx.strokeStyle = a.pal.rock[bucketOf(lz) * 4 + 3];
          ctx.lineWidth = lw;
          ctx.beginPath();
          const base = (2.8 * f) / lz;
          ctx.moveTo(lx - base, ly);
          ctx.lineTo(lx, ty);
          ctx.lineTo(lx + base, ly);
          for (const hh of arms) {
            const yy = ly + (ty - ly) * (hh / 24);
            const half = (4.2 * (0.35 + 0.65 * (hh / 24)) * f) / lz;
            ctx.moveTo(lx - half, yy);
            ctx.lineTo(lx + half, yy);
          }
          ctx.stroke();
        }
        ctx.strokeStyle = a.pal.post[bucketOf(z)];
        ctx.lineWidth = Math.max(1, (0.1 * f) / z);
        for (const hh of arms) {
          const l0 = (-(rail + lm.out) + 3.2) * 1;
          const r0 = (rail + lm.out - 3.2) * 1;
          if (!project(v, wx + (l0 - lat) * nx, y0 + hh, wz + (l0 - lat) * nz)) continue;
          const x0 = P.x, y0s = P.y;
          if (!project(v, wx + (r0 - lat) * nx, y0 + hh, wz + (r0 - lat) * nz)) continue;
          const x1 = P.x, y1s = P.y;
          if (!project(v, wx + (0 - lat) * nx, y0 + hh - 3.2, wz + (0 - lat) * nz)) continue;
          ctx.beginPath();
          ctx.moveTo(x0, y0s);
          ctx.quadraticCurveTo(P.x, P.y + (P.y - (y0s + y1s) / 2), x1, y1s);
          ctx.stroke();
        }
        break;
      }
      case "towers": {
        // the bridge's two towers and their cables down to the deck
        const hgt = 38;
        let txL = 0, txR = 0;
        for (let sd = -1; sd <= 1; sd += 2) {
          pointAt(road, lm.s, sd * (rail + lm.out), tmpB);
          if (!project(v, tmpB.x, tmpB.y, tmpB.z)) break;
          const lx = P.x, ly = P.y, lz = P.z;
          if (!project(v, tmpB.x, tmpB.y + hgt, tmpB.z)) break;
          const ty = P.y;
          if (sd < 0) txL = P.x;
          else txR = P.x;
          const lw = Math.min(26, Math.max(1.5, (1.1 * f) / lz));
          ctx.fillStyle = a.pal.rail[bucketOf(lz)];
          ctx.fillRect(lx - lw / 2, ty, lw, ly - ty);
          // a lit edge
          ctx.fillStyle = "rgba(242,234,215,0.35)";
          ctx.fillRect(lx - lw / 2, ty, Math.max(1, lw * 0.18), ly - ty);
          // the cables from the top to the deck, either way along it
          ctx.strokeStyle = "rgba(220,230,222,0.42)";
          ctx.lineWidth = Math.min(3, Math.max(1, (0.12 * f) / lz));
          ctx.beginPath();
          for (let j = -6; j <= 6; j++) {
            if (!j) continue;
            pointAt(road, lm.s + j * 11, sd * (rail + lm.out), tmp);
            if (!project(v, tmp.x, tmp.y + 1.0, tmp.z)) continue;
            ctx.moveTo(lx, ty);
            ctx.lineTo(P.x, P.y);
          }
          ctx.stroke();
        }
        // the beam across the top and a lower one
        if (txL && txR) {
          for (const hh of [hgt, hgt - 9]) {
            pointAt(road, lm.s, -(rail + lm.out), tmpB);
            if (!project(v, tmpB.x, tmpB.y + hh, tmpB.z)) continue;
            const x0 = P.x, y0s = P.y, z0 = P.z;
            pointAt(road, lm.s, rail + lm.out, tmpB);
            if (!project(v, tmpB.x, tmpB.y + hh, tmpB.z)) continue;
            ctx.strokeStyle = a.pal.rail[bucketOf(z0)];
            ctx.lineWidth = Math.min(14, Math.max(1.5, (0.9 * f) / z0));
            ctx.beginPath();
            ctx.moveTo(x0, y0s);
            ctx.lineTo(P.x, P.y);
            ctx.stroke();
          }
        }
        break;
      }
    }
  }
}

/** a tunnel mouth: a concrete frame round the opening with a reflective rim, and the lamps' light spilling out of it */
function portal(ctx: CanvasRenderingContext2D, a: Assets, v: View, road: Scene["road"], s: number, rh: number) {
  const f = v.f;
  const o = rh + 1.4;
  const ow = rh + 3.6;
  pointAt(road, s, -ow, tmp);
  if (!project(v, tmp.x, tmp.y, tmp.z)) return;
  const lx = P.x, ly = P.y, z = P.z;
  if (z > 420) return;
  pointAt(road, s, ow, tmp);
  if (!project(v, tmp.x, tmp.y, tmp.z)) return;
  const rx = P.x, ry = P.y;
  pointAt(road, s, -o, tmp);
  project(v, tmp.x, tmp.y + 5.9, tmp.z);
  const ilx = P.x, ilt = P.y;
  project(v, tmp.x, tmp.y, tmp.z);
  const ilb = P.y;
  pointAt(road, s, o, tmp);
  project(v, tmp.x, tmp.y + 5.9, tmp.z);
  const irx = P.x, irt = P.y;
  project(v, tmp.x, tmp.y, tmp.z);
  const irb = P.y;
  const top = Math.min(ilt, irt) - (2.3 * f) / z;
  const b = bucketOf(z);
  // the frame: the lintel and a pillar either side, in concrete
  ctx.fillStyle = a.pal.parapet[b];
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(lx, top);
  ctx.lineTo(rx, top);
  ctx.lineTo(rx, ry);
  ctx.lineTo(irx, irb);
  ctx.lineTo(irx, irt);
  ctx.lineTo(ilx, ilt);
  ctx.lineTo(ilx, ilb);
  ctx.closePath();
  ctx.fill();
  // the rim along the opening, in reflective paint
  ctx.strokeStyle = a.pal.edge[b];
  ctx.lineWidth = Math.max(1.4, (0.3 * f) / z);
  ctx.lineJoin = "miter";
  ctx.beginPath();
  ctx.moveTo(ilx, ilb);
  ctx.lineTo(ilx, ilt);
  ctx.lineTo(irx, irt);
  ctx.lineTo(irx, irb);
  ctx.stroke();
  // light leaks out of the mouth into the night
  ctx.globalCompositeOperation = "lighter";
  const g = Math.abs(irx - ilx) * 2.4;
  ctx.globalAlpha = 0.5 * Math.min(1, 160 / z);
  ctx.drawImage(a.sprites.sodium, (ilx + irx) / 2 - g / 2, (ilt + ilb) / 2 - g / 2 - g * 0.06, g, g);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** the grid's line: two cream bars across the road, and a box either side of the car's lane */
function startLine(ctx: CanvasRenderingContext2D, v: View, road: Scene["road"]) {
  const rh = road.half;
  ctx.fillStyle = "rgba(242,234,215,0.9)";
  for (const [s0, s1] of [[17.2, 18.1], [18.8, 19.1]]) {
    pointAt(road, s0, -(rh - 0.5), tmp);
    if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
    const ax = P.x, ay = P.y;
    pointAt(road, s0, rh - 0.5, tmp);
    if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
    const bx = P.x, by = P.y;
    pointAt(road, s1, rh - 0.5, tmp);
    if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
    const cx = P.x, cy = P.y;
    pointAt(road, s1, -(rh - 0.5), tmp);
    if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.lineTo(P.x, P.y);
    ctx.closePath();
    ctx.fill();
  }
}

/** a name over a ghost car, small and fading with distance */
function tag(ctx: CanvasRenderingContext2D, v: View, p: CarPose, text: string, color: string, dist: number) {
  if (!project(v, p.x, p.y + 1.9, p.z)) return;
  const size = Math.max(9, Math.min(13, (v.f * 0.34) / P.z));
  ctx.font = `700 ${size.toFixed(1)}px ${fontFamilies().mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = Math.max(0.25, Math.min(0.9, (140 - dist) / 90));
  ctx.fillStyle = "rgba(6,9,8,0.7)";
  const tw = ctx.measureText(text).width;
  ctx.fillRect(P.x - tw / 2 - 5, P.y - size - 3, tw + 10, size + 7);
  ctx.fillStyle = color;
  ctx.fillText(text, P.x, P.y);
  ctx.globalAlpha = 1;
}

/** Skid marks: two dark ribbons of quads, one path and one fill per darkness. Points are in road coordinates, newest first in the ring. */
function drawMarks(ctx: CanvasRenderingContext2D, sc: Scene, v: View, sLo: number, sHi: number) {
  const fx = sc.fx;
  if (fx.markN === 0) return;
  const road = sc.road;
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)";
    ctx.beginPath();
    for (let wh = 0; wh < 2; wh++) {
      const ms = fx.ms[wh];
      const ml = fx.ml[wh];
      const ma = fx.ma[wh];
      let have = false;
      let px = 0, py = 0, pw = 0;
      for (let n = 0; n < fx.markN; n++) {
        const i = (fx.markI[wh] - 1 - n + MARK_N * 2) % MARK_N;
        const dk = ma[i];
        const s = ms[i];
        if (dk <= 0 || s < sLo || s > sHi) {
          have = false;
          continue;
        }
        pointAt(road, s, ml[i], tmp);
        if (!project(v, tmp.x, tmp.y, tmp.z)) {
          have = false;
          continue;
        }
        const x = P.x, y = P.y, hw = Math.max(0.5, (0.12 * v.f) / P.z);
        if (have && (dk > 0.72) === (pass === 1) && Math.abs(y - py) < 90) {
          ctx.moveTo(px - pw, py);
          ctx.lineTo(px + pw, py);
          ctx.lineTo(x + hw, y);
          ctx.lineTo(x - hw, y);
          ctx.closePath();
        }
        have = true;
        px = x;
        py = y;
        pw = hw;
      }
    }
    ctx.fill();
  }
}

const GHOST_TARGET: CarLook = { brake: 0, ghost: true, alpha: 1, tint: "#8ad9a8" };
const GHOST_BEST: CarLook = { brake: 0, ghost: true, alpha: 1, tint: "#f2ead7" };

const CAR_POSE: CarPose = { x: 0, y: 0, z: 0, heading: 0, roll: 0, slope: 0 };
const GHOST_POSE: CarPose = { x: 0, y: 0, z: 0, heading: 0, roll: 0, slope: 0 };
function poseOf(road: Scene["road"], s: number, lat: number, psi: number, ay: number, out: CarPose): CarPose {
  pointAt(road, s, lat, tmp);
  out.x = tmp.x;
  out.z = tmp.z;
  out.y = tmp.y;
  out.heading = tmp.phi + psi;
  out.roll = Math.max(-0.07, Math.min(0.07, ay * 0.0045));
  out.slope = (heightAt(road, s + 1.5) - heightAt(road, s - 1.5)) / 3;
  return out;
}

const lampW: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
const SHADOW_PTS: [number, number, number][] = [[-1.2, 0.02, -2.5], [1.2, 0.02, -2.5], [1.2, 0.02, 2.4], [-1.2, 0.02, 2.4]];

function drawMainCar(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View, pose: CarPose) {
  const car = sc.car;
  // a soft dark pool under it first: the footprint's box, with the shadow stretched to fill it
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
  let sOk = true;
  for (let q = 0; q < 4; q++) {
    carPoint(pose, SHADOW_PTS[q], lampW);
    if (!project(v, lampW.x, lampW.y, lampW.z)) {
      sOk = false;
      break;
    }
    if (P.x < sx0) sx0 = P.x;
    if (P.x > sx1) sx1 = P.x;
    if (P.y < sy0) sy0 = P.y;
    if (P.y > sy1) sy1 = P.y;
  }
  if (sOk) {
    const sw = (sx1 - sx0) * 1.22;
    const sh = (sy1 - sy0) * 1.5 + 4;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(a.sprites.shadow, (sx0 + sx1) / 2 - sw / 2, (sy0 + sy1) / 2 - sh / 2 + sh * 0.04, sw, sh);
    ctx.globalAlpha = 1;
  }
  // the red wash on the road behind: the tail lights lighting the asphalt
  ctx.globalCompositeOperation = "lighter";
  const wash = Math.min(1, 0.35 + car.brake * 0.65);
  carPoint(pose, [0, 0.05, -3.4], lampW);
  if (project(v, lampW.x, lampW.y, lampW.z)) {
    const g = (9.5 * v.f) / P.z;
    ctx.globalAlpha = 0.34 * wash;
    ctx.drawImage(a.sprites.red, P.x - g / 2, P.y - g * 0.22, g, g * 0.44);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";
  drawCar(ctx, v, pose, { brake: Math.max(0.3, car.brake), ghost: false, alpha: 1, tint: "" });
  // the tail lights bloom
  ctx.globalCompositeOperation = "lighter";
  for (const lamp of TAIL_LAMPS) {
    carPoint(pose, lamp, lampW);
    if (!project(v, lampW.x, lampW.y, lampW.z)) continue;
    const g = ((1.7 + car.brake * 1.9) * v.f) / P.z;
    ctx.globalAlpha = 0.55 + 0.45 * car.brake;
    ctx.drawImage(a.sprites.red, P.x - g / 2, P.y - g / 2, g, g);
  }
  // the exhaust: a flame on an upshift pop
  if (car.pop > 0.05) {
    for (const tip of EXHAUST) {
      carPoint(pose, tip, lampW);
      if (!project(v, lampW.x, lampW.y, lampW.z)) continue;
      const g = ((0.8 + car.pop * 1.8) * v.f) / P.z;
      ctx.globalAlpha = Math.min(1, car.pop * 1.4);
      ctx.drawImage(a.sprites.orange, P.x - g / 2, P.y - g / 2, g, g);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** the beams: a wide pool well down the road and a hotter one just ahead of the bonnet, from the one sprite (no gradient built in a frame) */
function headlights(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View, decor: number) {
  const car = sc.car;
  ctx.globalCompositeOperation = "lighter";
  // the beams in the air: a wedge of light from the bonnet down the road
  pointAt(sc.road, car.s + 4, car.lat, tmp);
  if (decor < 1 && project(v, tmp.x, tmp.y + 0.3, tmp.z)) {
    const y0 = P.y;
    pointAt(sc.road, car.s + 46, car.lat * 0.8, tmp);
    if (project(v, tmp.x, tmp.y + 0.3, tmp.z) && y0 - P.y > 6) {
      const wTop = (19 * v.f) / P.z;
      ctx.globalAlpha = 0.2;
      ctx.drawImage(a.sprites.cone, P.x - wTop / 2, P.y, wTop, y0 - P.y);
    }
  }
  for (let i = 0; i < 2; i++) {
    pointAt(sc.road, car.s + (i ? 11 : 24), car.lat * (i ? 0.85 : 0.7), tmp);
    if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
    const rw = (v.f * (i ? 6.5 : 11)) / P.z;
    ctx.globalAlpha = i ? 0.5 : 0.62;
    ctx.drawImage(a.sprites.white, P.x - rw, P.y - rw * 0.2, rw * 2, rw * 0.4);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawGate(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View, s: number, finish: boolean, passed: boolean, num: number) {
  const road = sc.road;
  const rail = road.railHalf;
  const sprites = a.sprites;
  for (let side = -1; side <= 1; side += 2) {
    pointAt(road, s, side * (rail + 0.5), tmp);
    if (!project(v, tmp.x, tmp.y, tmp.z)) return;
    const bx = P.x, by = P.y, z = P.z;
    if (!project(v, tmp.x, tmp.y + 6.4, tmp.z)) return;
    const pw = Math.max(1.5, (0.5 * v.f) / z);
    ctx.fillStyle = passed ? "#2c3434" : "#26332f";
    ctx.fillRect(bx - pw / 2, P.y, pw, by - P.y);
  }
  // the beam across the top
  pointAt(road, s, -(rail + 0.5), tmp);
  if (!project(v, tmp.x, tmp.y + 6.9, tmp.z)) return;
  const lx = P.x, lyT = P.y, z = P.z;
  if (!project(v, tmp.x, tmp.y + 5.7, tmp.z)) return;
  const lyB = P.y;
  pointAt(road, s, rail + 0.5, tmp);
  if (!project(v, tmp.x, tmp.y + 6.9, tmp.z)) return;
  const rx = P.x, ryT = P.y;
  if (!project(v, tmp.x, tmp.y + 5.7, tmp.z)) return;
  const ryB = P.y;
  ctx.fillStyle = passed ? "#262d2d" : "#16201c";
  ctx.beginPath();
  ctx.moveTo(lx, lyT);
  ctx.lineTo(rx, ryT);
  ctx.lineTo(rx, ryB);
  ctx.lineTo(lx, lyB);
  ctx.closePath();
  ctx.fill();
  if (finish) {
    // a chequered band
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      for (let r = 0; r < 2; r++) {
        if ((i + r) & 1) continue;
        const ya0 = lyT + (lyB - lyT) * (r / 2), ya1 = lyT + (lyB - lyT) * ((r + 1) / 2);
        const yb0 = ryT + (ryB - ryT) * (r / 2), yb1 = ryT + (ryB - ryT) * ((r + 1) / 2);
        ctx.fillStyle = "#f2ead7";
        ctx.beginPath();
        ctx.moveTo(lx + (rx - lx) * t0, ya0 + (yb0 - ya0) * t0);
        ctx.lineTo(lx + (rx - lx) * t1, ya0 + (yb0 - ya0) * t1);
        ctx.lineTo(lx + (rx - lx) * t1, ya1 + (yb1 - ya1) * t1);
        ctx.lineTo(lx + (rx - lx) * t0, ya1 + (yb1 - ya1) * t0);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else {
    // a band of light: mint until you have been through it
    ctx.fillStyle = passed ? "rgba(242,234,215,0.28)" : "#8ad9a8";
    const inset = 0.2;
    ctx.beginPath();
    ctx.moveTo(lx, lyT + (lyB - lyT) * inset);
    ctx.lineTo(rx, ryT + (ryB - ryT) * inset);
    ctx.lineTo(rx, ryT + (ryB - ryT) * (1 - inset));
    ctx.lineTo(lx, lyT + (lyB - lyT) * (1 - inset));
    ctx.closePath();
    ctx.fill();
    // which gate it is, in the middle of the band
    const size = Math.abs(lyB - lyT) * 0.5 + Math.abs(ryB - ryT) * 0.5;
    const px = size * 0.5;
    if (px >= 8) {
      ctx.font = `800 ${px.toFixed(1)}px ${fontFamilies().display}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = passed ? "rgba(242,234,215,0.55)" : "#0d100e";
      ctx.fillText(String(num), (lx + rx) / 2, (lyT + lyB + ryT + ryB) / 4 + px * 0.04);
      ctx.textBaseline = "alphabetic";
    }
  }
  if (!passed) {
    ctx.globalCompositeOperation = "lighter";
    const gw = Math.abs(rx - lx) * 1.1;
    const cx = (lx + rx) / 2;
    const cy = (lyT + lyB + ryT + ryB) / 4;
    ctx.globalAlpha = finish ? 0.35 : 0.6;
    ctx.drawImage(sprites.mint, cx - gw / 2, cy - gw * 0.18, gw, gw * 0.36);
    // and a wash of it on the road under the gate
    pointAt(road, s, 0, tmp);
    if (project(v, tmp.x, tmp.y, tmp.z)) {
      const rw = (v.f * 12) / P.z;
      ctx.globalAlpha = 0.2;
      ctx.drawImage(sprites.mint, P.x - rw / 2, P.y - rw * 0.08, rw, rw * 0.16);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

function drawFxSmoke(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View) {
  const fx = sc.fx;
  for (let i = 0; i < SMOKE_N; i++) {
    const age = fx.sage[i];
    const life = fx.slife[i];
    if (age >= life) continue;
    if (!project(v, fx.sx[i], fx.sy[i], fx.sz[i])) continue;
    const t = age / life;
    const size = ((fx.ssize[i] * (0.6 + 2.2 * t)) * v.f) / P.z;
    if (size < 2) continue;
    ctx.globalAlpha = 0.5 * (1 - t) * Math.min(1, age * 7);
    ctx.drawImage(a.sprites.smoke, P.x - size / 2, P.y - size / 2, size, size * 0.8);
  }
  ctx.globalAlpha = 1;
}

function drawSparks(ctx: CanvasRenderingContext2D, sc: Scene, v: View) {
  const fx = sc.fx;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? "rgba(255,244,200,0.95)" : "rgba(255,150,50,0.9)";
    ctx.lineWidth = pass ? 1.2 : 2.2;
    ctx.beginPath();
    for (let i = 0; i < SPARK_N; i++) {
      if (fx.plife[i] <= 0) continue;
      if (!project(v, fx.px[i], fx.py[i], fx.pz[i])) continue;
      const x0 = P.x, y0 = P.y;
      if (!project(v, fx.px[i] - fx.pvx[i] * 0.04, fx.py[i] - fx.pvy[i] * 0.04, fx.pz[i] - fx.pvz[i] * 0.04)) continue;
      ctx.moveTo(x0, y0);
      ctx.lineTo(P.x, P.y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** streaks racing out of the vanishing point at the edges of the screen: more of them, brighter, as the speed climbs */
function speedLines(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, hy: number, shx: number) {
  const sp = sc.car.speed;
  const k = (sp - 28) / 36;
  if (k <= 0) return;
  const amount = Math.min(1, k);
  const { w, h } = a;
  const cx = w / 2 + shx;
  const cy = hy + h * 0.06;
  const t = sc.clock;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  const n = Math.round(10 + 22 * amount);
  for (let i = 0; i < n; i++) {
    // each line has a fixed angle and a phase that runs outward with time
    const ang = (i * 2.399963 + 0.7) % (Math.PI * 2);
    const run = (t * (1.2 + 1.8 * amount) + i * 0.137) % 1;
    const r0 = Math.hypot(w, h) * (0.3 + 0.55 * run * run);
    const len = Math.hypot(w, h) * (0.04 + 0.12 * run) * (0.5 + amount);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    // keep them off the road ahead: only the edges of the picture
    const x0 = cx + ca * r0 * 1.2;
    const y0 = cy + sa * r0 * 0.75;
    if (x0 < -20 || x0 > w + 20 || y0 < -20 || y0 > h + 20) continue;
    if (Math.abs(ca) < 0.35 && sa > 0) continue;
    ctx.strokeStyle = `rgba(226,240,230,${(0.05 + 0.15 * amount * run).toFixed(3)})`;
    ctx.lineWidth = 1 + run * 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + ca * len * 1.2, y0 + sa * len * 0.75);
    ctx.stroke();
  }
  ctx.restore();
}
