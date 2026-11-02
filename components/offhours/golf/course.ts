import { seeded } from "../useCanvas";
import type { Surface } from "./flight";
import { GH, GW, makeGreen, shapeR, zone, type Hole } from "./green";
import { C, YD, fogAt, mixc, poly, HAZE, type Cam, type Tree, type World } from "./scene";

// The course: hand-authored holes (the decision on each hole is the design) and
// what buildHole makes of one: where the ball stops (surfaceAt), the ground,
// the scenery as a World for drawWorld, and the green as a putting Hole.
//
// Frame: the tee is (0, 0), +z is downrange, +x is right. Yards in the data,
// metres at run time (YD converts). Only scenery and green contours come from
// seeds. Holes 3-9 are a later drop; the format takes nine.

type V3 = [number, number, number];

export type Blob = { x: number; z: number; rx: number; rz: number; rot?: number };

export type HoleDef = {
  n: number;
  name: string;
  par: 3 | 4 | 5;
  /** tee to pin, yd (the numbers the hole is sold by; a test checks the geometry agrees) */
  yards: number;
  /** the fairway's centre line, yd, 2-5 points: the ribbon follows it */
  line: [number, number][];
  /** the fairway's half width at each point of the line, yd */
  half: number[];
  /** the rough, beyond the fairway, yd */
  rough: number;
  pin: [number, number];
  green: { c: [number, number]; seed: number; severity: number };
  bunkers: Blob[];
  water: Blob[];
  trees: { seed: number; /** yd of clear ground beyond the rough before the trees */ edge: number; /** yd between trees along the edge */ spacing: number };
  /** where the wind blows to: 0 is straight downrange (a tailwind), pi/2 to the right; m/s */
  wind: { speed: number; dir: number };
  /** the aim for the tee shot on a par 4 or 5 (yd); a par 3 aims at the pin */
  landing: [number, number];
};

export const HOLE_DEFS: HoleDef[] = [
  {
    n: 1,
    name: "Open Door",
    par: 4,
    yards: 340,
    line: [[0, 0], [0, 230], [0, 342]],
    half: [14, 24, 22],
    rough: 14,
    pin: [4, 339.5],
    green: { c: [0, 341], seed: 4101, severity: 0.6 },
    bunkers: [{ x: -21, z: 235, rx: 6, rz: 10 }],
    water: [],
    trees: { seed: 11, edge: 6, spacing: 6 },
    wind: { speed: 1.5, dir: 0.6 },
    landing: [0, 252],
  },
  {
    n: 2,
    name: "Short Straw",
    par: 3,
    yards: 135,
    line: [[0, 0], [0, 137]],
    half: [10, 17],
    rough: 12,
    pin: [-3, 135],
    green: { c: [0, 137], seed: 4202, severity: 0.75 },
    bunkers: [{ x: 17, z: 134, rx: 6, rz: 8 }],
    water: [{ x: -17, z: 108, rx: 11, rz: 9, rot: 0.3 }],
    trees: { seed: 23, edge: 6, spacing: 6 },
    wind: { speed: 2, dir: Math.PI / 2 },
    landing: [-3, 135],
  },
];

const blobHit = (b: Blob, x: number, z: number) => {
  const dx = x - b.x * YD, dz = z - b.z * YD;
  const c = Math.cos(b.rot ?? 0), s = Math.sin(b.rot ?? 0);
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  return (u / (b.rx * YD)) ** 2 + (v / (b.rz * YD)) ** 2 < 1;
};
const blobRing = (b: Blob, n = 20): [number, number][] => {
  const c = Math.cos(b.rot ?? 0), s = Math.sin(b.rot ?? 0);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = Math.cos(a) * b.rx * YD, v = Math.sin(a) * b.rz * YD;
    out.push([b.x * YD + u * c - v * s, b.z * YD + u * s + v * c]);
  }
  return out;
};

type Sample = { x: number; z: number; nx: number; nz: number; hw: number };

export type BuiltHole = {
  def: HoleDef;
  surfaceAt: (x: number, z: number) => Surface;
  world: World;
  /** the green as a putting Hole, and the maps between the course (metres) and its coordinates */
  green: Hole;
  toGreen: (x: number, z: number) => [number, number];
  fromGreen: (gx: number, gy: number) => [number, number];
  /** pin and the aim for the tee shot, metres */
  pin: [number, number];
  landing: [number, number];
  /** metres from a point to the pin */
  toPin: (x: number, z: number) => number;
  /** the wind as a vector (m/s) before any drift */
  wind: [number, number];
  /** the nearest ground in play to a point in the woods, a little inside it */
  edgeDrop: (x: number, z: number) => [number, number];
  /** the fairway's half width where the line is nearest a point, m (for the tests) */
  fairHalfAt: (z: number) => number;
};

const built = new Map<number, BuiltHole>();

export function buildHole(def: HoleDef): BuiltHole {
  const cached = built.get(def.n);
  if (cached && cached.def === def) return cached;

  // the line in metres, run a little past both ends so the ribbon has a tee behind it and a collar past the green
  const L = def.line.map(([x, z]) => [x * YD, z * YD] as [number, number]);
  const hw0 = def.half.map((h) => h * YD);
  const ext = (a: [number, number], b: [number, number], by: number): [number, number] => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [b[0] + (dx / l) * by * YD, b[1] + (dz / l) * by * YD];
  };
  const pts: [number, number][] = [ext(L[1], L[0], 10), ...L, ext(L[L.length - 2], L[L.length - 1], 14)];
  const half = [hw0[0], ...hw0, hw0[hw0.length - 1]];
  const rough = def.rough * YD;

  /** how far (m) a point is outside the fairway ribbon: <= 0 on it */
  const margin = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(x - (ax + dx * u), z - (az + dz * u));
      const m = d - (half[i] + (half[i + 1] - half[i]) * u);
      if (m < best) best = m;
    }
    return best;
  };

  const cx = def.green.c[0] * YD, cz = def.green.c[1] * YD;
  const toGreen = (x: number, z: number): [number, number] => [GW / 2 + (x - cx), GH / 2 - (z - cz)];
  const fromGreen = (gx: number, gy: number): [number, number] => [cx + gx - GW / 2, cz - (gy - GH / 2)];
  const pin: [number, number] = [def.pin[0] * YD, def.pin[1] * YD];
  const green = makeGreen(def.green.seed, def.green.severity, def.n, def.par);
  green.cup = toGreen(pin[0], pin[1]);
  green.tee = toGreen(0, 0);

  const surfaceAt = (x: number, z: number): Surface => {
    for (const b of def.water) if (blobHit(b, x, z)) return "water";
    // the green: only worth asking near it
    if (Math.abs(x - cx) < GW * 0.62 && Math.abs(z - cz) < GH * 0.7) {
      const [gx, gy] = toGreen(x, z);
      const zn = zone(green, gx, gy);
      if (zn === 0) return "green";
      if (zn === 1) return "fringe";
    }
    for (const b of def.bunkers) if (blobHit(b, x, z)) return "bunker";
    const m = margin(x, z);
    if (m <= 0) return "fairway";
    if (m <= rough) return "rough";
    return "out";
  };

  // ribbon samples: every 5 yd along the line, with a normal and the half width
  const samples: Sample[] = [];
  {
    const step = 5 * YD;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const u = k / n;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        samples.push({ x: ax + (bx - ax) * u, z: az + (bz - az) * u, nx: dz, nz: -dx, hw: half[i] + (half[i + 1] - half[i]) * u });
      }
    }
  }

  const ground = (ctx: CanvasRenderingContext2D, cam: Cam) => {
    const order: number[] = [];
    for (let i = 0; i < samples.length - 1; i++) order.push(i);
    const mid = (i: number) => Math.hypot((samples[i].x + samples[i + 1].x) / 2 - cam.x, (samples[i].z + samples[i + 1].z) / 2 - cam.z);
    order.sort((a, b) => mid(b) - mid(a));
    for (const i of order) {
      const a = samples[i], b = samples[i + 1];
      const fg = fogAt(mid(i));
      const rc = mixc(C.rough, HAZE, fg);
      for (const s of [-1, 1])
        poly(ctx, cam, [
          [a.x + s * a.nx * a.hw, 0, a.z + s * a.nz * a.hw],
          [a.x + s * a.nx * (a.hw + rough), 0, a.z + s * a.nz * (a.hw + rough)],
          [b.x + s * b.nx * (b.hw + rough), 0, b.z + s * b.nz * (b.hw + rough)],
          [b.x + s * b.nx * b.hw, 0, b.z + s * b.nz * b.hw],
        ] as V3[], rc);
      poly(ctx, cam, [
        [a.x - a.nx * a.hw, 0, a.z - a.nz * a.hw],
        [a.x + a.nx * a.hw, 0, a.z + a.nz * a.hw],
        [b.x + b.nx * b.hw, 0, b.z + b.nz * b.hw],
        [b.x - b.nx * b.hw, 0, b.z - b.nz * b.hw],
      ] as V3[], mixc(Math.floor(i / 2) % 2 ? C.fairB : C.fairA, HAZE, fg));
    }
  };

  // trees along both edges, and rows behind the green
  const trees: Tree[] = [];
  {
    const r = seeded(def.trees.seed);
    const out = rough + def.trees.edge * YD;
    const sp = def.trees.spacing * YD;
    for (let i = 0; i < samples.length; i++) {
      if (i % Math.max(1, Math.round(sp / (5 * YD))) !== 0) continue;
      const a = samples[i];
      for (const s of [-1, 1]) {
        const d = a.hw + out + r() * 4;
        trees.push({ x: a.x + s * a.nx * d, z: a.z + s * a.nz * d + (r() - 0.5) * 3, h: 11 + r() * 9, kind: Math.floor(r() * 4), flip: r() > 0.5 });
        if (r() > 0.45) trees.push({ x: a.x + s * a.nx * (d + 9 + r() * 14), z: a.z + s * a.nz * (d + 9 + r() * 14) + r() * 4, h: 15 + r() * 10, kind: Math.floor(r() * 4), flip: r() > 0.5 });
      }
    }
    const end = pts[pts.length - 1];
    for (let row = 0; row < 3; row++) for (let x = -130; x < 130; x += 6 + r() * 4) trees.push({ x: end[0] + x, z: end[1] + 22 + row * 14 + r() * 6, h: 15 + r() * 12 + row * 3, kind: Math.floor(r() * 4), flip: r() > 0.5 });
  }

  const fairHalfAt = (z: number) => {
    for (let i = 0; i < pts.length - 1; i++) if (z >= pts[i][1] && z <= pts[i + 1][1]) return half[i] + ((half[i + 1] - half[i]) * (z - pts[i][1])) / (pts[i + 1][1] - pts[i][1] || 1);
    return half[half.length - 1];
  };

  const greenRing = (rad: number): V3[] => {
    const o: V3[] = [];
    const k = rad / (GH / 2);
    for (let i = 0; i < 48; i++) {
      const th = (i / 48) * Math.PI * 2;
      const rr = shapeR(green, th) * k;
      o.push([cx + Math.cos(th) * rr * (GW / 2), 0.015, cz - Math.sin(th) * rr * (GH / 2)]);
    }
    return o;
  };

  const world: World = {
    surfaceAt,
    ground,
    tee: true,
    bunkers: [],
    sand: def.bunkers.map((b) => blobRing(b)),
    water: def.water.map((b) => blobRing(b)),
    greens: [{ x: cx, z: cz, r: GH / 2, ring: greenRing, fringe: 0.6, pin }],
    trees,
    boards: def.yards >= 250 ? [100, 150, 200, 250, 300] : [50, 100],
    halfW: fairHalfAt,
  };

  const edgeDrop = (x: number, z: number): [number, number] => {
    // walk from the ball toward the line until the ground is in play, then a little further in
    let best: [number, number] = [0, 0], bd = Infinity;
    for (const s of samples) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = [s.x, s.z];
      }
    }
    const dx = best[0] - x, dz = best[1] - z, l = Math.hypot(dx, dz) || 1;
    for (let d = 0; d <= l; d += 0.5) {
      const px = x + (dx / l) * d, pz = z + (dz / l) * d;
      const sf = surfaceAt(px, pz);
      if (sf !== "out" && sf !== "water") {
        const q = Math.min(l, d + 1.5);
        return [x + (dx / l) * q, z + (dz / l) * q];
      }
    }
    return best;
  };

  const b: BuiltHole = {
    def,
    surfaceAt,
    world,
    green,
    toGreen,
    fromGreen,
    pin,
    landing: [def.landing[0] * YD, def.landing[1] * YD],
    toPin: (x, z) => Math.hypot(pin[0] - x, pin[1] - z),
    wind: [Math.sin(def.wind.dir) * def.wind.speed, Math.cos(def.wind.dir) * def.wind.speed],
    edgeDrop,
    fairHalfAt,
  };
  built.set(def.n, b);
  return b;
}
