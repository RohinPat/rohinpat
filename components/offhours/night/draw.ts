import { ENGINE_CAL } from "../engineRemote";
import { BUCKETS, bucketOf, type Assets, type Pano } from "./assets";
import { carPoint, drawCar, EXHAUST, TAIL_LAMPS, type CarLook, type CarPose } from "./carMesh";
import { SMOKE_N, SPARK_N } from "./fx";
import { BRIDGE, ROCK_L, ROCK_R, TUNNEL, heightAt, pointAt, type Point } from "./road";
import type { Scene } from "./scene";
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
// headlights are one soft additive pool on the road ahead of it. Nothing is
// allocated in a frame: typed arrays and module scratch.

const CAM = ENGINE_CAL.cam;

const MAXN = 210;
// the stations across the road each node is projected at
const S_ROADL = 0, S_ROADR = 1, S_EDGE_L0 = 2, S_EDGE_L1 = 3, S_EDGE_R0 = 4, S_EDGE_R1 = 5, S_DASH_L = 6, S_DASH_R = 7, S_RAIL0_L = 8, S_RAIL0_R = 9, S_RAIL1_L = 10, S_RAIL1_R = 11, S_RAIL2_L = 12, S_RAIL2_R = 13;
const S_ROCK_L = 14, S_ROCK_R = 15, S_TUN_LB = 16, S_TUN_RB = 17, S_TUN_LT = 18, S_TUN_RT = 19;
const NS = 20;
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

function pano(ctx: CanvasRenderingContext2D, p: Pano, heading: number, pxPerRad: number, factor: number, bottomY: number, w: number) {
  const off = (((heading * pxPerRad * factor) % p.W) + p.W) % p.W;
  const y = bottomY - p.H;
  ctx.drawImage(p.c, -off, y);
  if (p.W - off < w) ctx.drawImage(p.c, p.W - off, y);
}

/** one frame of the world */
export function drawScene(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, quality: number) {
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

  // ---- the sky and the far country
  ctx.drawImage(a.backdrop, -4, hy - a.hy0 - a.backdropTop, w + 8, a.backdrop.height);
  pano(ctx, a.stars, cam.heading, a.px, 0.96, hy, w);
  pano(ctx, a.far, cam.heading, a.px, 1.0, hy + 3, w);
  pano(ctx, a.city, cam.heading, a.px, 1.04, hy + h * 0.115, w);
  pano(ctx, a.mid, cam.heading, a.px, 1.1, hy + h * 0.125, w);
  pano(ctx, a.near, cam.heading, a.px, 1.22, hy + h * 0.15, w);

  // ---- the nodes in front of the camera
  const seg = road.segM;
  const carS = sc.car.s;
  const i0 = Math.max(0, Math.floor((carS - CAM.backM - 10) / seg));
  const N = Math.min(CAM.drawSegs[quality] ?? 140, road.n - i0, MAXN - 2);
  const rh = road.half;
  const rail = road.railHalf;
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
    const fl = road.flags[Math.min(i, road.n - 1)] | (i > 0 ? road.flags[i - 1] : 0);
    if (fl & (ROCK_L | ROCK_R)) {
      // the wall leans back as it climbs: its top is further out and well above the lamps
      station(S_ROCK_L, k, -(rail + 10), 26, f, w2, hy);
      station(S_ROCK_R, k, rail + 10, 26, f, w2, hy);
    }
    if (fl & TUNNEL) {
      station(S_TUN_LB, k, -(rh + 1.4), 0, f, w2, hy);
      station(S_TUN_RB, k, rh + 1.4, 0, f, w2, hy);
      station(S_TUN_LT, k, -(rh + 1.4), 5.9, f, w2, hy);
      station(S_TUN_RT, k, rh + 1.4, 5.9, f, w2, hy);
    }
    let z = NCZ[k];
    if (z < 0.7) z = 0.7;
    YC[k] = hy - (f * NCY[k]) / z;
  }
  // which segments a crest has not hidden, near to far
  nVis = 0;
  let maxY = h + 400;
  for (let k = 0; k < N; k++) {
    if (NCZ[k + 1] < 0.9) continue;
    if (YC[k + 1] < maxY) {
      VIS[nVis++] = k;
      maxY = YC[k + 1];
    }
  }

  const get = (si: number, k: number) => SX[si * MAXN + k];
  const gety = (si: number, k: number) => SY[si * MAXN + k];

  // ---- the rock: a wall up the side where the flags say so, painted far to near
  let cur = -1;
  for (let pass = 0; pass < 2; pass++) {
    const flag = pass === 0 ? ROCK_L : ROCK_R;
    const base = pass === 0 ? S_RAIL0_L : S_RAIL0_R;
    const top = pass === 0 ? S_ROCK_L : S_ROCK_R;
    cur = -1;
    for (let t = nVis - 1; t >= 0; t--) {
      const k = VIS[t];
      if (!(road.flags[i0 + k] & flag)) continue;
      const key = NB[k] * 2 + ((i0 + k) & 1);
      if (key !== cur) {
        if (cur >= 0) ctx.fill();
        ctx.fillStyle = key & 1 ? pal.rockAlt[key >> 1] : pal.rock[key >> 1];
        ctx.beginPath();
        cur = key;
      }
      ctx.moveTo(get(base, k), gety(base, k));
      ctx.lineTo(get(top, k), gety(top, k));
      ctx.lineTo(get(top, k + 1), gety(top, k + 1));
      ctx.lineTo(get(base, k + 1), gety(base, k + 1));
      ctx.closePath();
    }
    if (cur >= 0) ctx.fill();
  }

  // ---- the road itself
  cur = -1;
  for (let t = nVis - 1; t >= 0; t--) {
    const k = VIS[t];
    const b = NB[k];
    if (b !== cur) {
      if (cur >= 0) ctx.fill();
      ctx.fillStyle = pal.road[b];
      ctx.beginPath();
      cur = b;
    }
    ctx.moveTo(get(S_ROADL, k), gety(S_ROADL, k));
    ctx.lineTo(get(S_ROADR, k), gety(S_ROADR, k));
    ctx.lineTo(get(S_ROADR, k + 1), gety(S_ROADR, k + 1));
    ctx.lineTo(get(S_ROADL, k + 1), gety(S_ROADL, k + 1));
    ctx.closePath();
  }
  if (cur >= 0) ctx.fill();

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
      const g = Math.max(10, (11 * f) / z);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.95;
      ctx.drawImage(a.sprites.sodium, tx - g / 2, ty - g / 2, g, g);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ---- chevron boards on the outside of the corners
  const sFar = carS + N * seg;
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
    drawGate(ctx, a, sc, v, gs, g === road.checks.length - 1, g < sc.cp);
  }

  // ---- the headlights: a warm pool on the road ahead, as an additive gradient
  headlights(ctx, a, sc, v);

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
    }
  }
  drawSparks(ctx, sc, v);

  // ---- a soft shade around the edges, and speed lines
  ctx.restore();
  ctx.drawImage(a.vignette, 0, 0, w, h);
  if (!sc.reduce) speedLines(ctx, a, sc, hy, shx);
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

function drawMainCar(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View, pose: CarPose) {
  const car = sc.car;
  // a dark pool under it first
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  carPoint(pose, [-1.15, 0.02, -2.4], lampW);
  if (project(v, lampW.x, lampW.y, lampW.z)) {
    const x0 = P.x, y0 = P.y;
    carPoint(pose, [1.15, 0.02, -2.4], lampW);
    if (project(v, lampW.x, lampW.y, lampW.z)) {
      const x1 = P.x, y1 = P.y;
      carPoint(pose, [1.15, 0.02, 2.3], lampW);
      project(v, lampW.x, lampW.y, lampW.z);
      const x2 = P.x, y2 = P.y;
      carPoint(pose, [-1.15, 0.02, 2.3], lampW);
      project(v, lampW.x, lampW.y, lampW.z);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(P.x, P.y);
      ctx.closePath();
      ctx.fill();
    }
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

function headlights(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View) {
  const car = sc.car;
  pointAt(sc.road, car.s + 22, car.lat * 0.7, tmp);
  if (!project(v, tmp.x, tmp.y, tmp.z)) return;
  const x = P.x, y = P.y, z = P.z;
  const rw = (v.f * 9) / z;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(x, y);
  ctx.scale(1, 0.3);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rw * 1.5);
  g.addColorStop(0, "rgba(255,240,205,0.30)");
  g.addColorStop(0.35, "rgba(255,230,190,0.13)");
  g.addColorStop(1, "rgba(255,225,180,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-rw * 1.6, -rw * 1.6, rw * 3.2, rw * 3.2);
  ctx.restore();
}

function drawGate(ctx: CanvasRenderingContext2D, a: Assets, sc: Scene, v: View, s: number, finish: boolean, passed: boolean) {
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
    ctx.strokeStyle = `rgba(190,215,255,${(0.05 + 0.16 * amount * run).toFixed(3)})`;
    ctx.lineWidth = 1 + run * 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + ca * len * 1.2, y0 + sa * len * 0.75);
    ctx.stroke();
  }
  ctx.restore();
}
