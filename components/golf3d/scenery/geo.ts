import type { CoastSpec, P } from "./types";

// Plane geometry the backdrop is made of: distances to a polyline, which side of it a point is on, offsets of it, and
// small deterministic noises (nothing here draws from Math.random).

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, v: number) => {
  const u = clamp((v - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

/** an integer hash of two numbers, 0 up to (not including) 1; the same on every machine */
export function hash2(x: number, z: number, seed = 0): number {
  let h = (Math.floor(x * 7.31) * 374761393 + Math.floor(z * 5.77) * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hash1 = (i: number, seed = 0) => hash2(i, 0.5, seed);

/** smooth one-dimensional value noise, -1 to 1 */
export function noise1(t: number, seed = 0): number {
  const i = Math.floor(t), f = t - i;
  const a = hash1(i, seed) * 2 - 1, b = hash1(i + 1, seed) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

export function pathLength(line: P[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return s;
}

type Near = { d: number; seg: number; u: number; px: number; pz: number };
/** the nearest point of a polyline to (x, z) */
export function nearest(line: P[], x: number, z: number): Near {
  let best: Near = { d: Infinity, seg: 0, u: 0, px: line[0][0], pz: line[0][1] };
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const u = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const px = ax + dx * u, pz = az + dz * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, seg: i, u, px, pz };
  }
  return best;
}

/** the unit normal to the left of a segment's direction of travel (for +z that is -x) */
const leftNormal = (a: P, b: P): P => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
};

/**
 * Where a point is against a polyline: `s` metres along it to the nearest point, `lat` the signed distance from it
 * (positive on the right of the direction of travel), `d` the distance, `seg` the segment.
 */
export function lineFrame(line: P[], x: number, z: number): { s: number; lat: number; d: number; seg: number } {
  const n = nearest(line, x, z);
  let s = 0;
  for (let i = 0; i < n.seg; i++) s += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  const [ax, az] = line[n.seg], [bx, bz] = line[n.seg + 1];
  s += n.u * Math.hypot(bx - ax, bz - az);
  const side = sideOf(line, n, x, z);
  return { s, lat: -side * n.d, d: n.d, seg: n.seg };
}

/** +1 when the point is on the left of the polyline's direction of travel, -1 on the right (joints use the mean normal) */
function sideOf(line: P[], n: Near, x: number, z: number): number {
  const last = line.length - 2;
  let nl = leftNormal(line[n.seg], line[n.seg + 1]);
  let ox = x - n.px, oz = z - n.pz;
  if (n.u <= 0 && n.seg > 0) {
    const p = leftNormal(line[n.seg - 1], line[n.seg]);
    nl = [nl[0] + p[0], nl[1] + p[1]];
  } else if (n.u >= 1 && n.seg < last) {
    const q = leftNormal(line[n.seg + 1], line[n.seg + 2]);
    nl = [nl[0] + q[0], nl[1] + q[1]];
  }
  const l = Math.hypot(nl[0], nl[1]) || 1;
  const v = (ox * nl[0] + oz * nl[1]) / l;
  return v >= 0 ? 1 : -1;
}

/** metres from the lip of a coast: positive on the sea side, negative on land */
export function signedDist(c: CoastSpec, x: number, z: number): number {
  const n = nearest(c.line, x, z);
  const left = sideOf(c.line, n, x, z);
  const sea = c.sea === "left" ? left : -left;
  return sea * n.d;
}

/** a polyline moved sideways by `dist` (positive to the right); joints are mitred, with the stretch limited */
export function offsetLine(line: P[], dist: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[i], c = line[Math.min(line.length - 1, i + 1)];
    const n0 = i > 0 ? leftNormal(a, b) : leftNormal(b, c);
    const n1 = i < line.length - 1 ? leftNormal(b, c) : n0;
    const mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    const nx = mx / ml, nz = mz / ml;
    const stretch = Math.min(1.6, 1 / Math.max(0.01, nx * n0[0] + nz * n0[1]));
    out.push([b[0] - nx * dist * stretch, b[1] - nz * dist * stretch]);
  }
  return out;
}

/** a polyline resampled to points `step` m apart (both ends kept) */
export function resample(line: P[], step: number): P[] {
  const total = pathLength(line);
  const n = Math.max(1, Math.ceil(total / step));
  const out: P[] = [];
  let seg = 0, acc = 0;
  for (let k = 0; k <= n; k++) {
    const target = (total * k) / n;
    while (seg < line.length - 2 && acc + Math.hypot(line[seg + 1][0] - line[seg][0], line[seg + 1][1] - line[seg][1]) < target) {
      acc += Math.hypot(line[seg + 1][0] - line[seg][0], line[seg + 1][1] - line[seg][1]);
      seg++;
    }
    const [ax, az] = line[seg], [bx, bz] = line[seg + 1];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const u = clamp((target - acc) / l, 0, 1);
    out.push([ax + (bx - ax) * u, az + (bz - az) * u]);
  }
  return out;
}

/** the bearing from (cx, cz) to (x, z), radians: 0 is +z, positive toward +x */
export const bearingOf = (cx: number, cz: number, x: number, z: number) => Math.atan2(x - cx, z - cz);

/** a degrees difference wrapped to -180..180 */
export const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** whether two segments cross (touching ends do not count) */
export function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** the polygon's area, positive when counter-clockwise (x right, z up) */
export function polygonArea(poly: P[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** whether no two edges of a closed polygon cross */
export function isSimple(poly: P[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  return true;
}
