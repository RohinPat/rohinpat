import { P, project, type View } from "./view";

// The car, drawn from a few dozen flat faces and the same camera as the road, so
// when it slides its flank swings into view with real perspective. An original
// shape: a low coupe with a ducktail wing, dark graphite with a mint belt line,
// no badge, no model. Faces are culled by which way they face, sorted far to
// near, and filled from a small palette (a handful of brightness steps per
// kind), so a frame builds no strings. The tail lights are glow sprites on top.

type Kind = 0 | 1 | 2 | 3 | 4 | 5;
const BODY = 0, GLASS = 1, WHEEL = 2, MINT = 3, TAIL = 4, WING = 5;

type Face = { k: Kind; p: number[]; n: [number, number, number] };

const m = (p: number[]) => p;
/** a face and its mirror about the middle of the car (the right side of a left side) */
function both(k: Kind, pts: number[][], n: [number, number, number], out: Face[]) {
  out.push({ k, p: m(pts.flat()), n });
  out.push({ k, p: m(pts.map(([x, y, z]) => [-x, y, z]).reverse().flat()), n: [-n[0], n[1], n[2]] });
}

const FACES: Face[] = [];
// body: a lower slab with a chamfered shoulder, so the roofline reads as a shape and not a box
FACES.push({ k: BODY, p: [-0.86, 0.26, -2.25, 0.86, 0.26, -2.25, 0.86, 0.62, -2.25, -0.86, 0.62, -2.25], n: [0, 0, -1] });
FACES.push({ k: BODY, p: [-0.86, 0.62, -2.25, 0.86, 0.62, -2.25, 0.78, 0.82, -2.05, -0.78, 0.82, -2.05], n: [0, 0.7, -0.7] });
both(BODY, [[-0.86, 0.26, -2.25], [-0.86, 0.62, -2.25], [-0.9, 0.62, -1.9], [-0.9, 0.26, -1.9]], [-0.8, 0, -0.6], FACES);
both(BODY, [[-0.9, 0.26, -1.9], [-0.9, 0.6, -1.9], [-0.9, 0.6, 0.8], [-0.9, 0.26, 0.8]], [-1, 0, 0], FACES);
both(BODY, [[-0.9, 0.6, -1.9], [-0.78, 0.82, -2.05], [-0.78, 0.82, 0.8], [-0.9, 0.6, 0.8]], [-0.86, 0.5, 0], FACES);
both(BODY, [[-0.9, 0.26, 0.8], [-0.9, 0.6, 0.8], [-0.82, 0.58, 2.2], [-0.84, 0.26, 2.25]], [-0.98, 0.05, 0.1], FACES);
FACES.push({ k: BODY, p: [-0.78, 0.82, -2.05, 0.78, 0.82, -2.05, 0.78, 0.82, 0.8, -0.78, 0.82, 0.8], n: [0, 1, 0] });
FACES.push({ k: BODY, p: [-0.78, 0.82, 0.8, 0.78, 0.82, 0.8, 0.74, 0.62, 2.2, -0.74, 0.62, 2.2], n: [0, 0.9, 0.43] });
FACES.push({ k: BODY, p: [-0.84, 0.26, 2.25, 0.84, 0.26, 2.25, 0.82, 0.58, 2.2, -0.82, 0.58, 2.2], n: [0, 0, 1] });
// the cabin
FACES.push({ k: GLASS, p: [-0.76, 0.82, -1.15, 0.76, 0.82, -1.15, 0.6, 1.24, -0.62, -0.6, 1.24, -0.62], n: [0, 0.55, -0.83] });
both(GLASS, [[-0.76, 0.82, -1.15], [-0.6, 1.24, -0.62], [-0.6, 1.24, 0.35], [-0.76, 0.82, 0.75]], [-0.95, 0.3, 0], FACES);
FACES.push({ k: BODY, p: [-0.6, 1.24, -0.62, 0.6, 1.24, -0.62, 0.6, 1.24, 0.35, -0.6, 1.24, 0.35], n: [0, 1, 0] });
FACES.push({ k: GLASS, p: [-0.76, 0.82, 0.75, 0.76, 0.82, 0.75, 0.6, 1.24, 0.35, -0.6, 1.24, 0.35], n: [0, 0.55, 0.83] });
// the ducktail wing
FACES.push({ k: WING, p: [-0.86, 1.07, -2.28, 0.86, 1.07, -2.28, 0.86, 1.05, -1.78, -0.86, 1.05, -1.78], n: [0, 1, 0] });
FACES.push({ k: WING, p: [-0.86, 0.97, -2.28, 0.86, 0.97, -2.28, 0.86, 1.07, -2.28, -0.86, 1.07, -2.28], n: [0, 0, -1] });
// two struts hold it up
both(WING, [[-0.5, 0.8, -2.2], [-0.5, 1.05, -2.22], [-0.46, 1.05, -2.22], [-0.46, 0.8, -2.2]], [0, 0, -1], FACES);
both(MINT, [[-0.86, 0.84, -2.28], [-0.86, 1.1, -2.28], [-0.86, 1.1, -1.78], [-0.86, 0.84, -1.78]], [-1, 0, 0], FACES);
// the belt line: a thin mint stripe down each side
both(MINT, [[-0.905, 0.44, -1.88], [-0.905, 0.49, -1.88], [-0.905, 0.49, 0.8], [-0.905, 0.44, 0.8]], [-1, 0, 0], FACES);
// the tail lights
FACES.push({ k: TAIL, p: [-0.82, 0.4, -2.262, -0.36, 0.4, -2.262, -0.36, 0.56, -2.262, -0.82, 0.56, -2.262], n: [0, 0, -1] });
FACES.push({ k: TAIL, p: [0.36, 0.4, -2.262, 0.82, 0.4, -2.262, 0.82, 0.56, -2.262, 0.36, 0.56, -2.262], n: [0, 0, -1] });
FACES.push({ k: TAIL, p: [-0.36, 0.465, -2.262, 0.36, 0.465, -2.262, 0.36, 0.5, -2.262, -0.36, 0.5, -2.262], n: [0, 0, -1] });
// wheels: the tread seen from behind, and the sidewall
for (const z of [-1.95, 1.1]) {
  FACES.push({ k: WHEEL, p: [-0.93, 0, z, -0.64, 0, z, -0.64, 0.66, z, -0.93, 0.66, z], n: [0, 0, -1] });
  FACES.push({ k: WHEEL, p: [0.64, 0, z, 0.93, 0, z, 0.93, 0.66, z, 0.64, 0.66, z], n: [0, 0, -1] });
}
for (const [z0, z1] of [[-1.95, -1.1], [1.1, 1.95]]) {
  both(WHEEL, [[-0.93, 0, z0], [-0.93, 0.66, z0], [-0.93, 0.66, z1], [-0.93, 0, z1]], [-1, 0, 0], FACES);
}

const NF = FACES.length;
/** the lamps are the faces of kind TAIL: their centres in the car's frame, for the glow */
export const TAIL_LAMPS: [number, number, number][] = [[-0.6, 0.48, -2.28], [0.6, 0.48, -2.28]];
/** the exhaust tips */
export const EXHAUST: [number, number, number][] = [[-0.5, 0.34, -2.3], [0.5, 0.34, -2.3]];

// ---- the palette: kind x brightness step
const STEPS = 8;
const BASE: Record<Kind, [number, number, number]> = {
  [BODY]: [52, 62, 78],
  [GLASS]: [11, 15, 21],
  [WHEEL]: [7, 8, 10],
  [MINT]: [118, 190, 146],
  [TAIL]: [0, 0, 0],
  [WING]: [36, 43, 54],
};
const PAL: string[][] = [];
for (let k = 0; k < 6; k++) {
  const row: string[] = [];
  for (let s = 0; s < STEPS; s++) {
    const mult = 0.5 + (s / (STEPS - 1)) * 1.15;
    const [r, g, b] = BASE[k as Kind];
    row.push(`rgb(${Math.min(255, Math.round(r * mult))},${Math.min(255, Math.round(g * mult))},${Math.min(255, Math.round(b * mult))})`);
  }
  PAL.push(row);
}
/** red, dim to blazing: the tail lights by how hard the brakes are on */
const TAIL_PAL: string[] = [];
for (let s = 0; s < STEPS; s++) {
  const t = s / (STEPS - 1);
  TAIL_PAL.push(`rgb(${Math.round(120 + 135 * t)},${Math.round(14 + 40 * t)},${Math.round(14 + 30 * t)})`);
}

const L = { x: -0.5, y: 0.78, z: -0.38 };
const wx = new Float32Array(NF * 4);
const wy = new Float32Array(NF * 4);
const wz = new Float32Array(NF * 4);
const sx = new Float32Array(NF * 4);
const sy = new Float32Array(NF * 4);
const sd = new Float32Array(NF);
const order: number[] = Array.from({ length: NF }, (_, i) => i);
const level = new Uint8Array(NF);
const alive = new Uint8Array(NF);
/** far faces first */
const byDepth = (a: number, b: number) => sd[b] - sd[a];

export type CarPose = {
  /** the car's centre on the ground */
  x: number;
  y: number;
  z: number;
  /** the heading of the nose, rad (clockwise from +z) */
  heading: number;
  /** lean toward the outside of a turn (rad) and the slope of the road under it (rise per metre) */
  roll: number;
  slope: number;
};

export type CarLook = {
  /** 0..1: how hard the brakes are on (the tail lights) */
  brake: number;
  /** ghosts are flat, translucent and outlined */
  ghost: boolean;
  alpha: number;
  /** the ghost's colour */
  tint: string;
};

/**
 * Draw a car. Returns whether anything of it was on screen; the tail-light and
 * exhaust glows are left to the caller (they need the sprites): see
 * `lampPoint` and `exhaustPoint`.
 */
export function drawCar(ctx: CanvasRenderingContext2D, v: View, pose: CarPose, look: CarLook): boolean {
  const sinT = Math.sin(pose.heading);
  const cosT = Math.cos(pose.heading);
  // car frame -> world: right = (cosT, -sinT), forward = (sinT, cosT)
  const lr = cosT * L.x - sinT * L.z;
  const lf = sinT * L.x + cosT * L.z;
  const roll = pose.roll;
  let seen = false;
  for (let f = 0; f < NF; f++) {
    const face = FACES[f];
    const p = face.p;
    let ok = 1;
    for (let q = 0; q < 4; q++) {
      const x = p[q * 3];
      const y = p[q * 3 + 1] + x * roll + p[q * 3 + 2] * pose.slope;
      const z = p[q * 3 + 2];
      const i = f * 4 + q;
      wx[i] = pose.x + cosT * x + sinT * z;
      wz[i] = pose.z - sinT * x + cosT * z;
      wy[i] = pose.y + y;
      if (!project(v, wx[i], wy[i], wz[i])) ok = 0;
      sx[i] = P.x;
      sy[i] = P.y;
      if (q === 0) sd[f] = P.z;
    }
    // which way does it face? the face's normal in the world, against the way to the camera
    const n = face.n;
    const nxw = cosT * n[0] + sinT * n[2];
    const nzw = -sinT * n[0] + cosT * n[2];
    const i0 = f * 4;
    const cxw = (wx[i0] + wx[i0 + 2]) * 0.5;
    const czw = (wz[i0] + wz[i0 + 2]) * 0.5;
    const cyw = (wy[i0] + wy[i0 + 2]) * 0.5;
    const toCam = nxw * (v.camX - cxw) + n[1] * (v.camY - cyw) + nzw * (v.camZ - czw);
    alive[f] = ok && toCam > 0 ? 1 : 0;
    if (alive[f]) {
      seen = true;
      const diff = Math.max(0, n[0] * lr + n[2] * lf + n[1] * L.y);
      level[f] = Math.max(0, Math.min(STEPS - 1, Math.round((0.18 + diff * 0.9) * (STEPS - 1))));
      sd[f] = (cxw - v.camX) * v.sinG + (czw - v.camZ) * v.cosG;
    }
  }
  if (!seen) return false;

  // far to near
  order.sort(byDepth);
  if (look.ghost) {
    ctx.globalAlpha = look.alpha * 0.34;
    ctx.fillStyle = look.tint;
    for (let o = 0; o < NF; o++) {
      const f = order[o];
      if (!alive[f] || FACES[f].k === WHEEL) continue;
      const i = f * 4;
      ctx.beginPath();
      ctx.moveTo(sx[i], sy[i]);
      ctx.lineTo(sx[i + 1], sy[i + 1]);
      ctx.lineTo(sx[i + 2], sy[i + 2]);
      ctx.lineTo(sx[i + 3], sy[i + 3]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = look.alpha * 0.9;
    ctx.strokeStyle = look.tint;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let o = 0; o < NF; o++) {
      const f = order[o];
      const k = FACES[f].k;
      if (!alive[f] || k === WHEEL || k === TAIL || k === MINT) continue;
      const i = f * 4;
      ctx.moveTo(sx[i], sy[i]);
      ctx.lineTo(sx[i + 1], sy[i + 1]);
      ctx.lineTo(sx[i + 2], sy[i + 2]);
      ctx.lineTo(sx[i + 3], sy[i + 3]);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    return true;
  }

  const bs = Math.max(0, Math.min(STEPS - 1, Math.round(look.brake * (STEPS - 1))));
  for (let o = 0; o < NF; o++) {
    const f = order[o];
    if (!alive[f]) continue;
    const k = FACES[f].k;
    ctx.fillStyle = k === TAIL ? TAIL_PAL[bs] : PAL[k][level[f]];
    const i = f * 4;
    ctx.beginPath();
    ctx.moveTo(sx[i], sy[i]);
    ctx.lineTo(sx[i + 1], sy[i + 1]);
    ctx.lineTo(sx[i + 2], sy[i + 2]);
    ctx.lineTo(sx[i + 3], sy[i + 3]);
    ctx.closePath();
    ctx.fill();
  }
  return true;
}

/** A point on the car (its own frame) in the world, written to out[0..2]. */
export function carPoint(pose: CarPose, local: [number, number, number], out: { x: number; y: number; z: number }) {
  const sinT = Math.sin(pose.heading);
  const cosT = Math.cos(pose.heading);
  const [x, y0, z] = local;
  out.x = pose.x + cosT * x + sinT * z;
  out.z = pose.z - sinT * x + cosT * z;
  out.y = pose.y + y0 + x * pose.roll + z * pose.slope;
}
