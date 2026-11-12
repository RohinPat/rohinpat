import { creekSd, lakeOf, lobeK, polyOf, ringSd, type BuiltHole, type CreekPt } from "./course";
import { GH, GW, greenHeight, shapeR } from "./green";
import { YD } from "./scene";

// The ground's shape: one height for every point of a hole, the same for the
// ball (flight.ts bounces and rolls on it) and for the 3D course (which draws
// it). A hole says how the ground rises and falls along its line and how it
// tilts across it; on top go gentle swells and the odd mound. The tee and the
// ground around the green are levelled, ponds sit in a level hollow, creeks and
// bunkers are dug a little in, and the green is the putt's own height field
// (green.ts), raised on its pad and eased down to the ground around it.
//
// Metres, the hole's frame (x right, z downrange); the tee is at height 0.

export type Ground = {
  /** the height of the ground along the line: [yd from the tee, m], in order */
  rise: [number, number][];
  /** how the ground tilts across the line: [yd from the tee, rise per metre to the right], in order */
  tilt?: [number, number][];
  /** the size of the swells, m (default 0.6) */
  swell?: number;
  /** mounds (a negative height a hollow): x, z, radius (yd) and height (m) */
  mounds?: [number, number, number, number][];
};

export type Terrain = {
  /** the ground's height at a course point, m */
  y: (x: number, z: number) => number;
  /** its slope there: the rise per metre to +x and to +z */
  slope: (x: number, z: number) => [number, number];
  /** the ground's height at a point of the green (its own coordinates) */
  yG: (gx: number, gy: number) => number;
  /** the height of the water's surface at a point of a pond or creek */
  waterY: (x: number, z: number) => number;
  /** the height the green's pad is levelled to */
  pad: number;
  /** the green's own rise above its pad at a point of the green, m (0 off its raised ground) */
  rise: (gx: number, gy: number) => number;
};

/** past the fringe the green's surface holds its height this far, m (a ball putted from just off the green rolls on it), then banks down over BANK m */
export const HOLD = 1;
export const BANK = 2.5;
/** the green's raised ground stays inside this much past its box, in its own coordinates */
export const PAD = 6.5;
/** the ground's swells, how far the line's height reaches across (a Gaussian, m), and how far a tilt keeps tilting from the line, m */
const SIGMA = 22;
const TILT_REACH = 40;
/** the levelled ground: the tee out to this radius, then eased over TEE_EASE; around the green over GREEN_EASE */
const TEE_FLAT = 7, TEE_EASE = 9, GREEN_EASE = 14;
/** depths, m: a pond's bed, a creek's, a bunker's */
const POND_DIP = 1.1, CREEK_DIP = 0.95, SAND_DIP = 0.35;
/** a creek's or lake's bank run from the level ground to the waterline, m */
const BANK_RUN = 2.4;
/** how far a pond's surface lies under the ground it is dug into (the bank's lip), m */
const POND_LIP = 0.22;
/** a creek's surface under the ground beside it, as a share of CREEK_DIP (the bank's waterline) */
const CREEK_LINE = 0.6;
/** the baked grid's cell, m */
const CELL = 1.5;

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** a monotone cubic through the points (no overshoot between them), flat past either end */
function pchip(pts: [number, number][]) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const linear = (pts: [number, number][]) => (x: number) => {
  if (!pts.length) return 0;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]));
  return pts[pts.length - 1][1];
};

/** how far outside the green's fringe a green point is, m, measured out from its middle (negative inside) */
export function outsideGreen(hole: BuiltHole, gx: number, gy: number) {
  const dx = gx - GW / 2, dy = gy - GH / 2;
  const u = dx / (GW / 2), v = dy / (GH / 2);
  const rho = Math.hypot(u, v);
  if (rho < 1e-9) return -GH / 2;
  // the green is an oval: a step in rho is longer along its long axis
  return ((rho - shapeR(hole.green, Math.atan2(v, u)) - 0.085) * Math.hypot(dx, dy)) / rho;
}

const cache = new WeakMap<BuiltHole, Terrain>();
/** no ground at all: every hole without a `ground` (and every hole in a flat game) */
export const FLAT: Pick<Terrain, "y" | "slope"> = { y: () => 0, slope: () => [0, 0] };

export function terrainOf(hole: BuiltHole): Terrain {
  const got = cache.get(hole);
  if (got) return got;
  const def = hole.def;
  const G = def.ground ?? { rise: [[0, 0]] as [number, number][] };
  const rise = pchip(G.rise.map(([s, h]) => [s * YD, h] as [number, number]));
  const tilt = linear((G.tilt ?? []).map(([s, t]) => [s * YD, t] as [number, number]));
  const swell = G.swell ?? 0.6;
  const mounds = (G.mounds ?? []).map(([x, z, r, h]) => ({ x: x * YD, z: z * YD, r: r * YD, h }));

  // the line, every 5 yd, with how far along it each sample is from the tee and its normal
  const L = hole.line;
  const cum = [0];
  for (let i = 1; i < L.length; i++) cum.push(cum[i - 1] + Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]));
  let tee = 0;
  L.forEach(([x, z], i) => {
    if (Math.hypot(x, z) < Math.hypot(L[tee][0], L[tee][1])) tee = i;
  });
  const S = L.map(([x, z], i) => {
    const a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const s = cum[i] - cum[tee];
    return { x, z, nx: (b[1] - a[1]) / l, nz: -(b[0] - a[0]) / l, h: rise(s), t: tilt(s) };
  });

  /** the line's height and tilt carried out across the hole, blended between samples so a bend has no seam */
  const line = (x: number, z: number) => {
    let sw = 0, sv = 0, near = Infinity, nearV = 0;
    const R2 = 16 * SIGMA * SIGMA;
    for (const p of S) {
      const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
      const lat = Math.max(-TILT_REACH, Math.min(TILT_REACH, dx * p.nx + dz * p.nz));
      const v = p.h + p.t * lat;
      if (d2 < near) [near, nearV] = [d2, v];
      if (d2 > R2) continue;
      const w = Math.exp(-d2 / (SIGMA * SIGMA));
      sw += w;
      sv += w * v;
    }
    return sw > 1e-9 ? sv / sw : nearV;
  };
  // swells: a few long, low waves with this hole's own phases
  const ph = [def.n * 1.37, def.n * 2.11 + 0.5, def.n * 0.73 + 1.9];
  const swells = (x: number, z: number) =>
    swell * (0.55 * Math.sin(x * 0.071 + ph[0]) * Math.cos(z * 0.053 + ph[1]) + 0.3 * Math.sin((0.6 * x + z) * 0.043 + ph[2]) + 0.15 * Math.cos((x - 0.7 * z) * 0.09 + ph[0]));
  const raw = (x: number, z: number) => {
    let y = line(x, z) + swells(x, z);
    for (const m of mounds) {
      const dx = x - m.x, dz = z - m.z;
      y += m.h * Math.exp((-2 * (dx * dx + dz * dz)) / (m.r * m.r));
    }
    return y;
  };

  // levelled: the tee, the green's pad
  const teeY = line(0, 0);
  const [gcx, gcz] = hole.fromGreen(GW / 2, GH / 2);
  const pad = line(gcx, gcz);
  /** how much of the green's level pad there is at a point: 1 on it, easing to 0 */
  const onPad = (x: number, z: number) => {
    const [gx, gy] = hole.toGreen(x, z);
    if (gx < -40 || gx > GW + 40 || gy < -40 || gy > GH + 40) return 0;
    return 1 - smooth((outsideGreen(hole, gx, gy) - (HOLD + BANK + 0.5)) / GREEN_EASE);
  };
  const levelled = (x: number, z: number) => {
    const y = lerp(raw(x, z), teeY, 1 - smooth((Math.hypot(x, z) - TEE_FLAT) / TEE_EASE));
    return lerp(y, pad, onPad(x, z));
  };

  // water: a pond lies level in a hollow; a creek follows the ground, dug in
  type Pond = { x: number; z: number; rx: number; rz: number; c: number; s: number; level: number; lobe?: number };
  const ponds: Pond[] = [];
  const creeks: CreekPt[][] = [];
  const lakes: { ring: [number, number][]; level: number }[] = [];
  for (const w of def.water) {
    if ("path" in w) creeks.push(polyOf(w));
    else if ("shore" in w) {
      const ring = lakeOf(w);
      const mx = ring.reduce((a, p) => a + p[0], 0) / ring.length, mz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      lakes.push({ ring, level: w.level ?? levelled(mx, mz) });
    } else ponds.push({ x: w.x * YD, z: w.z * YD, rx: w.rx * YD, rz: w.rz * YD, c: Math.cos(w.rot ?? 0), s: Math.sin(w.rot ?? 0), level: levelled(w.x * YD, w.z * YD), lobe: w.lobe });
  }
  const blobR = (b: { x: number; z: number; rx: number; rz: number; c: number; s: number; lobe?: number }, x: number, z: number) => {
    const dx = x - b.x, dz = z - b.z;
    const u = dx * b.c + dz * b.s, v = -dx * b.s + dz * b.c;
    const a = u / b.rx, e = v / b.rz;
    return Math.hypot(a, e) / lobeK(b.lobe, Math.atan2(e, a));
  };
  const pathDist = (path: [number, number][], x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const dx = bx - ax, dz = bz - az;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - (ax + dx * u), z - (az + dz * u)));
    }
    return best;
  };
  const sand = def.bunkers.map((b) => ({ x: b.x * YD, z: b.z * YD, rx: b.rx * YD, rz: b.rz * YD, c: Math.cos(b.rot ?? 0), s: Math.sin(b.rot ?? 0) }));

  /** the ground before anything is dug into it (a creek's water sits just under it) */
  const wet = (x: number, z: number) => {
    let y = levelled(x, z);
    // (never over the green's pad: the putt's surface stays exactly the putt's)
    if (ponds.length) {
      const k = 1 - onPad(x, z);
      for (const p of ponds) y = lerp(y, p.level, k * (1 - smooth((blobR(p, x, z) - 1.1) / 0.9)));
      for (const l of lakes) y = lerp(y, l.level, k * (1 - smooth((ringSd(l.ring, x, z) - 2) / 14)));
    }
    return y;
  };
  /** how deep anything may be dug here: nothing on the green and its fringe, nor so near them that the grid's cells reach in */
  const digs = (x: number, z: number) => {
    const [gx, gy] = hole.toGreen(x, z);
    if (gx < -40 || gx > GW + 40 || gy < -40 || gy > GH + 40) return 1;
    return smooth((outsideGreen(hole, gx, gy) - (CELL * 1.5 + 0.2)) / 1);
  };
  const full = (x: number, z: number) => {
    let dig = 0;
    // (a pond's waterline is where the bed has dropped POND_LIP under its level: r = 1, the edge the ball is lost at)
    for (const p of ponds) dig += POND_DIP * smooth((1.085 - blobR(p, x, z)) / 0.3);
    for (const l of lakes) dig += POND_DIP * smooth((0.67 - ringSd(l.ring, x, z)) / BANK_RUN);
    for (const c of creeks) {
      const sd = creekSd(c, x, z);
      // the bed dips a little more toward the middle (a pool), the bank runs up in BANK_RUN
      dig += CREEK_DIP * smooth((BANK_RUN * 0.55 - sd) / BANK_RUN) + (sd < 0 ? 0.35 * smooth(-sd / 3) : 0);
    }
    for (const b of sand) dig += SAND_DIP * smooth((1.08 - blobR(b, x, z)) / 0.45);
    return wet(x, z) - (dig > 0 ? dig * digs(x, z) : 0);
  };

  // baked on a grid over the hole (the line's blend is the slow part), read back bilinearly
  const box = hole.shape.box;
  const X0 = box.x0 - 60, Z0 = box.z0 - 60;
  const nx = Math.ceil((box.x1 + 60 - X0) / CELL) + 1, nz = Math.ceil((box.z1 + 60 - Z0) / CELL) + 1;
  let grid: Float32Array | null = null;
  const bake = () => {
    const g = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = full(X0 + i * CELL, Z0 + j * CELL);
    return g;
  };
  const base = (x: number, z: number) => {
    const fi = (x - X0) / CELL, fj = (z - Z0) / CELL;
    if (fi < 0 || fj < 0 || fi >= nx - 1 || fj >= nz - 1) return full(x, z);
    grid ??= bake();
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const k = j * nx + i;
    return lerp(lerp(grid[k], grid[k + 1], u), lerp(grid[k + nx], grid[k + nx + 1], u), v);
  };

  // the green: the putt's height field raised on the pad, held past the fringe, then banked down
  const H = hole.green;
  const fade = (gx: number, gy: number) => 1 - smooth((outsideGreen(hole, gx, gy) - HOLD) / BANK);
  let low = Infinity;
  for (let gy = -PAD; gy <= GH + PAD; gy += 0.25) for (let gx = -PAD; gx <= GW + PAD; gx += 0.25) if (fade(gx, gy) > 0) low = Math.min(low, greenHeight(H, gx, gy));
  if (!Number.isFinite(low)) low = 0;
  const relief = (gx: number, gy: number) => {
    if (gx < -PAD || gx > GW + PAD || gy < -PAD || gy > GH + PAD) return 0;
    const f = fade(gx, gy);
    return f > 0 ? f * (greenHeight(H, gx, gy) - low + 0.03) : 0;
  };

  const y = (x: number, z: number) => {
    const [gx, gy] = hole.toGreen(x, z);
    return base(x, z) + relief(gx, gy);
  };
  const E = 0.2;
  const t: Terrain = {
    y,
    slope: (x, z) => [(y(x + E, z) - y(x - E, z)) / (2 * E), (y(x, z + E) - y(x, z - E)) / (2 * E)],
    yG: (gx, gy) => {
      const [x, z] = hole.fromGreen(gx, gy);
      return base(x, z) + relief(gx, gy);
    },
    waterY: (x, z) => {
      for (const c of creeks) if (creekSd(c, x, z) < 1.5) return wet(x, z) - CREEK_LINE * CREEK_DIP;
      for (const l of lakes) if (ringSd(l.ring, x, z) < 1.5) return l.level - POND_LIP;
      return wet(x, z) - POND_LIP;
    },
    pad,
    rise: relief,
  };
  cache.set(hole, t);
  return t;
}

