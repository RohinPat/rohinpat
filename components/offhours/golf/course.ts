import { seeded } from "../useCanvas";
import type { Surface } from "./flight";
import { GH, GW, makeGreen, shapeR, zone, type Hole } from "./green";
import type { Ground } from "./terrain";
import { RANGE_WORLD, TARGETS, YD, fogAt, hex, mixc, poly, HAZE, type Cam, type Tree, type World } from "./scene";

// The course: hand-authored holes (the decision on each hole is the design) and
// what buildHole makes of one: where the ball stops (surfaceAt), the ground,
// the scenery as a World for drawWorld, and the green as a putting Hole.
//
// Frame: the tee is (0, 0), +z is downrange, +x is right. Yards in the data,
// metres at run time (YD converts). Only scenery and green contours come from
// seeds. The six holes are all here; the format takes nine.

type V3 = [number, number, number];

// The course's ground, three tones that read apart at any distance: the fairway light and mown in clear stripes, the
// rough darker with no stripes, the woods darker again. The green is lighter than the fairway, with a fringe between.
const FAIR_A = hex("#a2d870");
const FAIR_B = hex("#86bf5a");
const ROUGH = hex("#3f7a3b");
const DEEP = hex("#21472a");
const GREEN = hex("#c4f092");
const GREEN_B = hex("#b8ea85");
const FRINGE = hex("#8ccb64");
/** the crown of a tree that stops a ball, m */
const TREE_R = 1.8;
/** how far out (m) a ball is still low enough to hit a tree in the copse */
const LOW_M = 100;
/** the flag is at least this tall on screen, px */
const FLAG_MIN_PX = 34;

export type Blob = { x: number; z: number; rx: number; rz: number; rot?: number };
/** a creek: water along a path (yd), `w` yd wide */
export type Creek = { path: [number, number][]; w: number };
export type Water = Blob | Creek;
const isCreek = (w: Water): w is Creek => "path" in w;

/**
 * A course yard of one kind of ground, an outline in yd (a closed polygon, three points or more). Where it lies:
 * - "fescue": long wispy rough, a harsher lie than the rough, playable;
 * - "gorse": a bush, unplayable: a ball that stops in it is dropped beside it, no nearer the hole, for a stroke;
 * - "waste": firm sandy scrub, plays between the fairway and a bunker, no penalty;
 * - "oob": out of bounds: a ball that stops in it is played again from where it was struck, for a stroke.
 * `stakes` (oob): the boundary line in yd, where the white stakes stand and the line is painted.
 */
export type AreaKind = "fescue" | "gorse" | "waste" | "oob";
export type Area = { kind: AreaKind; poly: [number, number][]; stakes?: [number, number][] };
/** an Area in metres, as buildHole hands it on: its outline, and the points along its boundary line the stakes stand at */
export type AreaM = { kind: AreaKind; ring: [number, number][]; stakes: [number, number][] };
/** the stakes stand this far apart along the boundary line, m */
export const STAKE_GAP = 6;
/** which kind wins where areas overlap (first in the list wins) */
const AREA_ORDER: AreaKind[] = ["oob", "gorse", "waste", "fescue"];
const inPoly = (ring: [number, number][], x: number, z: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
/** points every `gap` m along a path (metres), the first and last included */
const along = (path: [number, number][], gap: number): [number, number][] => {
  const out: [number, number][] = [];
  if (!path.length) return out;
  out.push(path[0]);
  let carry = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = gap - carry; d <= len; d += gap) out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]);
    carry = (carry + len) % gap;
  }
  return out;
};

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
  water: Water[];
  trees: { seed: number; /** yd of clear ground beyond the rough before the trees */ edge: number; /** yd between trees along the edge */ spacing: number };
  /** trees that stop a ball in the air: x and z (yd) and the height (m). They are drawn with the rest. */
  copse?: [number, number, number][];
  /** where the wind blows to: 0 is straight downrange (a tailwind), pi/2 to the right; m/s */
  wind: { speed: number; dir: number };
  /** the aim for the tee shot on a par 4 or 5 (yd); a par 3 aims at the pin */
  landing: [number, number];
  /** the shape of the ground (terrain.ts); flat without one */
  ground?: Ground;
  /** the range's target greens (scene.ts TARGETS) stand on it: flat rounds of green in a fringe, each with a flag */
  targets?: boolean;
  /**
   * Yards of fescue, gorse, waste or out of bounds (see Area). surfaceAt reads them in this order: water, then out of
   * bounds, then the green and its fringe, then the bunkers (those four are authored objects and always win over a field
   * they sit in), then gorse, waste, fescue (that order where they overlap), then the fairway, the rough and the woods,
   * which a field replaces where it lies. The 3D ground paints them; wave 2 holes author their own.
   */
  areas?: Area[];
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
    // off a raised tee, down into a wide landing area that leans right, then up a little to the green
    ground: { rise: [[0, 0], [40, -1], [150, -5], [250, -6], [342, -4]], tilt: [[150, -0.02], [260, -0.03], [330, 0]], mounds: [[-30, 180, 9, 1.4], [32, 300, 10, 1.6]] },
    // a band of long fescue down the outside of the right rough: a drive that leaks right does not just find the rough
    areas: [{ kind: "fescue", poly: [[28, 140], [30, 185], [31.5, 230], [31, 275], [38, 275], [39, 230], [36, 185], [35.5, 140]] }],
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
    // a long way down to the green: it plays shorter than it reads
    ground: { rise: [[0, 0], [35, -1], [110, -7], [137, -8]], swell: 0.3 },
  },
  {
    // a dogleg right at 205 yd. The inside of the bend is a bunker and a stand of trees: a driver aimed over them gets home,
    // a 5 iron to the bend leaves about 165 in
    n: 3,
    name: "The Elbow",
    par: 4,
    yards: 365,
    line: [[0, 0], [0, 205], [100, 333]],
    half: [15, 21, 19],
    rough: 14,
    pin: [98, 331],
    green: { c: [99.5, 334], seed: 4303, severity: 0.8 },
    bunkers: [
      { x: 31, z: 196, rx: 5, rz: 9, rot: -0.15 },
      { x: 117, z: 341, rx: 5, rz: 5, rot: -0.8 },
    ],
    water: [],
    trees: { seed: 37, edge: 6, spacing: 6 },
    copse: [[44, 150, 17], [50, 160, 19], [42, 170, 16], [54, 176, 20], [46, 186, 18], [58, 192, 17], [47, 199, 19], [60, 206, 16]],
    wind: { speed: 2.5, dir: 0.9 },
    landing: [0, 180],
    // the bend banks to the right, toward the corner, and the green sits up on a hill
    ground: { rise: [[0, 0], [150, 1], [215, 2], [290, 6], [345, 9]], tilt: [[160, 0], [205, -0.04], [250, -0.02], [300, 0]], mounds: [[-26, 120, 10, 1.5]] },
  },
  {
    // a creek across the fairway, 320 to 334 yd from the tee, and the green 136 yd past it
    n: 4,
    name: "Reed Creek",
    par: 5,
    yards: 470,
    line: [[0, 0], [0, 300], [10, 474]],
    half: [14, 22, 20],
    rough: 14,
    pin: [9, 470],
    green: { c: [10, 472], seed: 4404, severity: 0.85 },
    bunkers: [
      { x: 23, z: 268, rx: 5, rz: 9 },
      { x: 33, z: 470, rx: 5, rz: 6 },
    ],
    water: [{ path: [[-56, 327.5], [-28, 326.5], [0, 327], [28, 327.5], [56, 326.5]], w: 14 }],
    trees: { seed: 41, edge: 6, spacing: 6 },
    wind: { speed: 2.5, dir: 0.3 },
    landing: [0, 255],
    // the fairway runs down to the creek, so a lay-up keeps rolling toward it; then up again to a raised green
    ground: { rise: [[0, 0], [110, 2], [230, 0], [300, -2], [327, -3.5], [370, -1.5], [430, 2], [474, 3.5]], tilt: [[200, 0.02], [300, 0], [420, -0.015]] },
  },
  {
    // the green ringed with sand, a pond on its left edge, the strongest wind of the six blowing toward the pond
    n: 5,
    name: "The Collar",
    par: 3,
    yards: 175,
    line: [[0, 0], [0, 177]],
    half: [10, 15],
    rough: 12,
    pin: [3, 174],
    green: { c: [0, 176], seed: 4505, severity: 0.9 },
    bunkers: [
      { x: 0, z: 164.5, rx: 6, rz: 3.6 },
      { x: 12, z: 168, rx: 5, rz: 4, rot: -0.7 },
      { x: 16.5, z: 176, rx: 3.8, rz: 5 },
      { x: 12, z: 184, rx: 5, rz: 4, rot: 0.7 },
      { x: 0, z: 187.5, rx: 6, rz: 3.6 },
      { x: -12, z: 184.5, rx: 4.5, rz: 3.6, rot: -0.7 },
      { x: -12, z: 167.5, rx: 4.5, rz: 3.6, rot: 0.7 },
    ],
    water: [{ x: -18.5, z: 176, rx: 5.5, rz: 7.5 }],
    trees: { seed: 53, edge: 6, spacing: 6 },
    wind: { speed: 4.2, dir: -1.2 },
    landing: [3, 174],
    // uphill to the green: it plays longer than it reads
    ground: { rise: [[0, 0], [80, 0.5], [150, 3], [177, 5]], swell: 0.3 },
    // a sandy waste off the right of the line, short of the bunkers: any club plays from it, but it is not the fairway
    areas: [{ kind: "waste", poly: [[13, 98], [22, 95], [32, 104], [37, 122], [35, 145], [28, 160], [18, 158], [14, 138], [15, 116]] }],
  },
  {
    // a long dogleg left with water along the inside of the bend and the wind in your face
    n: 6,
    name: "Last Light",
    par: 4,
    yards: 395,
    line: [[0, 0], [0, 175], [-110, 370.5]],
    half: [15, 22, 19],
    rough: 14,
    pin: [-107, 366.5],
    green: { c: [-109, 369], seed: 4606, severity: 1.0 },
    bunkers: [
      { x: -19, z: 263, rx: 4.5, rz: 8, rot: 0.515 },
      { x: -91, z: 355, rx: 5, rz: 4.5 },
    ],
    water: [{ path: [[-54, 189], [-81, 233], [-106, 276], [-130, 320], [-142, 342]], w: 11 }],
    trees: { seed: 67, edge: 6, spacing: 6 },
    copse: [[-47, 128, 18], [-53, 139, 20], [-45, 150, 16], [-58, 154, 19], [-50, 165, 17], [-60, 172, 18], [-52, 180, 20]],
    wind: { speed: 2.8, dir: 3.4 },
    landing: [-26, 225],
    // downhill off the tee; the ground at the bend leans left, toward the water, then rises to the green
    ground: { rise: [[0, 0], [170, -4], [260, -5], [330, -3], [372, -1]], tilt: [[150, 0], [210, 0.03], [280, 0.02], [340, 0]] },
  },
];

/** the back three, which make the six a nine (the 3D course plays all nine; the dialog's flat course the six) */
export const BACK_DEFS: HoleDef[] = [
  {
    // uphill to a ridge at 235 yd: a drive that clears its top runs down the far side and leaves a pitch; one short of it
    // stops on the climb and leaves a long, uphill second
    n: 7,
    name: "The Ridge",
    par: 4,
    yards: 385,
    line: [[0, 0], [0, 240], [-14, 387]],
    half: [14, 20, 18],
    rough: 14,
    pin: [-13, 383],
    green: { c: [-14, 386], seed: 4707, severity: 0.75 },
    bunkers: [
      { x: -18, z: 238, rx: 5, rz: 9 },
      { x: 19, z: 212, rx: 5, rz: 8 },
      { x: 0, z: 374, rx: 5, rz: 4, rot: -0.4 },
    ],
    water: [],
    trees: { seed: 71, edge: 6, spacing: 6 },
    wind: { speed: 2.2, dir: 2.6 },
    landing: [0, 235],
    ground: { rise: [[0, 0], [120, 4], [225, 9], [245, 9.5], [275, 7], [387, 3]], tilt: [[200, 0], [240, 0.02], [300, 0]] },
    // gorse on the left of the climb and the right of the crest: a ball in it is unplayable
    areas: [
      { kind: "gorse", poly: [[-28, 160], [-34, 168], [-38, 184], [-34, 202], [-28, 198], [-26, 178]] },
      { kind: "gorse", poly: [[28, 262], [35, 268], [37, 284], [32, 298], [26, 290], [25, 274]] },
    ],
  },
  {
    // a long right-hander with a lake down the right of the second shot and a pond off the front right of the green; the
    // ground and the wind both lean toward the water. Get home in two over the pond, or lay up left
    n: 8,
    name: "Long Water",
    par: 5,
    yards: 520,
    line: [[0, 0], [0, 280], [45, 522]],
    half: [15, 21, 19],
    rough: 14,
    pin: [44, 518],
    green: { c: [45, 521], seed: 4808, severity: 0.7 },
    bunkers: [
      { x: -20, z: 262, rx: 5, rz: 10 },
      { x: 29, z: 514, rx: 4, rz: 6 },
    ],
    water: [
      { x: 64, z: 400, rx: 15, rz: 34, rot: -0.18 },
      { x: 67, z: 499, rx: 8, rz: 10 },
    ],
    trees: { seed: 83, edge: 6, spacing: 6 },
    wind: { speed: 2, dir: 1.2 },
    landing: [0, 262],
    ground: { rise: [[0, 0], [150, -2], [280, -3], [420, -5], [522, -4]], tilt: [[300, 0], [400, -0.025], [480, 0]], swell: 0.7 },
  },
  {
    // home from a raised tee: down to a dogleg left with a stand of trees on the inside of the corner, the ground kicking
    // to the outside toward a bunker, and a green on a shelf with a pond long and left
    n: 9,
    name: "Homeward",
    par: 4,
    yards: 415,
    line: [[0, 0], [0, 200], [-70, 410]],
    half: [16, 22, 18],
    rough: 14,
    pin: [-68, 406],
    green: { c: [-70, 409], seed: 4909, severity: 0.85 },
    bunkers: [
      { x: 26, z: 212, rx: 5, rz: 9 },
      { x: -84, z: 397, rx: 5, rz: 4, rot: 0.5 },
      { x: -55, z: 421, rx: 4, rz: 5 },
    ],
    water: [{ x: -93, z: 428, rx: 10, rz: 7, rot: 0.4 }],
    trees: { seed: 97, edge: 6, spacing: 6 },
    copse: [[-38, 148, 17], [-44, 159, 19], [-36, 169, 16], [-48, 173, 18], [-40, 184, 20], [-52, 189, 17]],
    wind: { speed: 3, dir: -2.2 },
    landing: [-5, 215],
    ground: { rise: [[0, 0], [60, -2], [200, -7], [300, -8], [415, -6]], tilt: [[160, 0], [210, -0.03], [290, 0]] },
    // out of bounds down the left, past the rough and the copse: white stakes on the line, stroke and distance beyond
    areas: [
      {
        kind: "oob",
        poly: [[-34, 40], [-40, 100], [-60, 150], [-62, 190], [-68, 240], [-82, 300], [-96, 360], [-112, 360], [-98, 300], [-84, 240], [-80, 190], [-76, 150], [-56, 100], [-50, 40]],
        stakes: [[-34, 40], [-40, 100], [-60, 150], [-62, 190], [-68, 240], [-82, 300], [-96, 360]],
      },
    ],
  },
];

/** all nine */
export const NINE_DEFS: HoleDef[] = [...HOLE_DEFS, ...BACK_DEFS];

/** how far a target green's fringe reaches past its edge, m (the range's own) */
export const TARGET_FRINGE = 2.8;
/**
 * The driving range as a hole of the 3D course: a wide, gently falling field with the range's six target greens on
 * it, each guarded by sand, and a green at the far end. Practice is played on it (play.ts `practice: "range"`).
 */
export const RANGE_DEF: HoleDef = {
  n: 10,
  name: "The range",
  par: 4,
  yards: 300,
  line: [[0, 0], [0, 150], [0, 300]],
  half: [30, 40, 40],
  rough: 18,
  pin: [0, 300],
  green: { c: [0, 301], seed: 4999, severity: 0.3 },
  bunkers: TARGETS.flatMap((t, i) => {
    const side = i % 2 ? -1 : 1;
    return [
      { x: (t.gx + side * (t.gr + 2.5)) / YD, z: (t.gz - t.gr * 0.4) / YD, rx: (3.2 + (i % 3) * 0.6) / YD, rz: (3.2 + (i % 3) * 0.6) / YD },
      { x: (t.gx - side * (t.gr * 0.3)) / YD, z: (t.gz - t.gr - 2.2) / YD, rx: 2.6 / YD, rz: 2.6 / YD },
    ];
  }),
  water: [],
  trees: { seed: 77, edge: 10, spacing: 7 },
  wind: { speed: 1.2, dir: 0.5 },
  landing: [0, 150],
  ground: { rise: [[0, 0], [40, -0.5], [300, -2]], swell: 0.25 },
  targets: true,
};

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

/** metres from a point to the nearest part of a path (a list of points in metres) */
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
const creekPath = (c: Creek) => c.path.map(([x, z]) => [x * YD, z * YD] as [number, number]);
const waterHit = (w: Water, x: number, z: number) => (isCreek(w) ? pathDist(creekPath(w), x, z) < (w.w * YD) / 2 : blobHit(w, x, z));
/** a creek's outline: its bank on one side out, on the other back */
const creekRing = (c: Creek): [number, number][] => {
  const P = creekPath(c), hw = (c.w * YD) / 2;
  const left: [number, number][] = [], right: [number, number][] = [];
  P.forEach(([x, z], i) => {
    const [ax, az] = P[Math.max(0, i - 1)], [bx, bz] = P[Math.min(P.length - 1, i + 1)];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (bz - az) / l, nz = -(bx - ax) / l;
    left.push([x + nx * hw, z + nz * hw]);
    right.push([x - nx * hw, z - nz * hw]);
  });
  return [...left, ...right.reverse()];
};
const waterRing = (w: Water) => (isCreek(w) ? creekRing(w) : blobRing(w));

/** a point along the ribbon: its normal (to the right of the line), the half width, and how much to stretch an offset at a bend so the edge stays a constant distance from the line */
type Sample = { x: number; z: number; nx: number; nz: number; hw: number; m: number };

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
  /** how far (m) a point is outside the fairway: 0 or less on it */
  margin: (x: number, z: number) => number;
  /** trees that stop a ball in the air (metres: x, z, crown radius, height) */
  blockers: { x: number; z: number; r: number; h: number }[];
  /** the middle of the fairway from the tee to past the green, every 5 yd, metres */
  line: [number, number][];
  /** the hole's areas (fescue, gorse, waste, out of bounds) in metres, with the points the oob stakes stand at */
  areas: AreaM[];
  /** the hole drawn flat, metres: the rough and the fairway as outlines, and the box that holds all of it */
  shape: { rough: [number, number][]; fairway: [number, number][]; box: { x0: number; x1: number; z0: number; z1: number } };
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

  const areas: AreaM[] = (def.areas ?? [])
    .map((a) => ({ kind: a.kind, ring: a.poly.map(([x, z]) => [x * YD, z * YD] as [number, number]), stakes: along((a.stakes ?? []).map(([x, z]) => [x * YD, z * YD] as [number, number]), STAKE_GAP) }))
    .sort((a, b) => AREA_ORDER.indexOf(a.kind) - AREA_ORDER.indexOf(b.kind));
  const areaBox = areas.map((a) => ({ x0: Math.min(...a.ring.map((p) => p[0])), x1: Math.max(...a.ring.map((p) => p[0])), z0: Math.min(...a.ring.map((p) => p[1])), z1: Math.max(...a.ring.map((p) => p[1])) }));
  /** the kind of area at a point, if any (the earlier kind wins) */
  const areaAt = (x: number, z: number, kinds: AreaKind[]): AreaKind | null => {
    for (let i = 0; i < areas.length; i++) {
      const b = areaBox[i];
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !kinds.includes(areas[i].kind)) continue;
      if (inPoly(areas[i].ring, x, z)) return areas[i].kind;
    }
    return null;
  };

  const surfaceAt = (x: number, z: number): Surface => {
    for (const b of def.water) if (waterHit(b, x, z)) return "water";
    if (areas.length && areaAt(x, z, ["oob"])) return "oob";
    if (def.targets)
      for (const t of TARGETS) {
        const d = Math.hypot(x - t.gx, z - t.gz);
        if (d <= t.gr) return "green";
        if (d <= t.gr + TARGET_FRINGE) return "fringe";
      }
    // the green: only worth asking near it
    if (Math.abs(x - cx) < GW * 0.62 && Math.abs(z - cz) < GH * 0.7) {
      const [gx, gy] = toGreen(x, z);
      const zn = zone(green, gx, gy);
      if (zn === 0) return "green";
      if (zn === 1) return "fringe";
    }
    for (const b of def.bunkers) if (blobHit(b, x, z)) return "bunker";
    if (areas.length) {
      const k = areaAt(x, z, ["gorse", "waste", "fescue"]);
      if (k) return k;
    }
    const m = margin(x, z);
    if (m <= 0) return "fairway";
    if (m <= rough) return "rough";
    return "out";
  };

  // ribbon samples: every 5 yd along the line, with a normal and the half width. At a bend the normal is the mean of the
  // two segments' and the offsets are stretched, so the edges meet instead of gapping on the outside
  const samples: Sample[] = [];
  {
    const step = 5 * YD;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / step));
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const u = k / n;
        let nx = dz, nz = -dx, m = 1;
        if (k === n && i < pts.length - 2) {
          const [cx2, cz2] = pts[i + 2];
          const l2 = Math.hypot(cx2 - bx, cz2 - bz) || 1;
          const mx = nx + (cz2 - bz) / l2, mz = nz - (cx2 - bx) / l2;
          const ml = Math.hypot(mx, mz) || 1;
          nx = mx / ml;
          nz = mz / ml;
          m = Math.min(1.6, 1 / Math.max(0.01, nx * dz + nz * -dx));
        }
        samples.push({ x: ax + (bx - ax) * u, z: az + (bz - az) * u, nx, nz, hw: half[i] + (half[i + 1] - half[i]) * u, m });
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
      const rc = mixc(ROUGH, HAZE, fg);
      for (const s of [-1, 1])
        poly(ctx, cam, [
          [a.x + s * a.nx * a.hw * a.m, 0, a.z + s * a.nz * a.hw * a.m],
          [a.x + s * a.nx * (a.hw + rough) * a.m, 0, a.z + s * a.nz * (a.hw + rough) * a.m],
          [b.x + s * b.nx * (b.hw + rough) * b.m, 0, b.z + s * b.nz * (b.hw + rough) * b.m],
          [b.x + s * b.nx * b.hw * b.m, 0, b.z + s * b.nz * b.hw * b.m],
        ] as V3[], rc);
      poly(ctx, cam, [
        [a.x - a.nx * a.hw * a.m, 0, a.z - a.nz * a.hw * a.m],
        [a.x + a.nx * a.hw * a.m, 0, a.z + a.nz * a.hw * a.m],
        [b.x + b.nx * b.hw * b.m, 0, b.z + b.nz * b.hw * b.m],
        [b.x - b.nx * b.hw * b.m, 0, b.z - b.nz * b.hw * b.m],
      ] as V3[], mixc(Math.floor(i / 2) % 2 ? FAIR_B : FAIR_A, HAZE, fg));
    }
  };

  // trees along both edges, and rows behind the green
  const trees: Tree[] = [];
  {
    const r = seeded(def.trees.seed);
    const out = rough + def.trees.edge * YD;
    const sp = def.trees.spacing * YD;
    // inside a bend the offset from one segment can land on the other's rough: leave those out (the draws are still made, so the rest do not move)
    const keep = (t: Tree) => {
      if (margin(t.x, t.z) > rough + 3 * YD) trees.push(t);
    };
    for (let i = 0; i < samples.length; i++) {
      if (i % Math.max(1, Math.round(sp / (5 * YD))) !== 0) continue;
      const a = samples[i];
      for (const s of [-1, 1]) {
        const d = a.hw + out + r() * 4;
        keep({ x: a.x + s * a.nx * d, z: a.z + s * a.nz * d + (r() - 0.5) * 3, h: 11 + r() * 9, kind: Math.floor(r() * 4), flip: r() > 0.5 });
        if (r() > 0.45) keep({ x: a.x + s * a.nx * (d + 9 + r() * 14), z: a.z + s * a.nz * (d + 9 + r() * 14) + r() * 4, h: 15 + r() * 10, kind: Math.floor(r() * 4), flip: r() > 0.5 });
      }
    }
    // the copse: trees a ball in the air can hit, set where the hole's decision is
    for (const [x, z, h] of def.copse ?? []) trees.push({ x: x * YD, z: z * YD, h, kind: Math.floor(r() * 3), flip: r() > 0.5 });
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

  // yardage markers at 100, 150 and 200 yd from the middle of the green (along the line), on the edge of the fairway, never in a hazard
  const markers: { x: number; z: number; label: string }[] = [];
  {
    const cum = [0];
    for (let i = 1; i < L.length; i++) cum.push(cum[i - 1] + Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]));
    // where along the line the middle of the green is
    let sEnd = 0, bestD = Infinity;
    for (let i = 0; i < L.length - 1; i++) {
      const dx = L[i + 1][0] - L[i][0], dz = L[i + 1][1] - L[i][1], l2 = dx * dx + dz * dz;
      const u = Math.max(0, Math.min(1, ((cx - L[i][0]) * dx + (cz - L[i][1]) * dz) / l2));
      const d = Math.hypot(cx - (L[i][0] + dx * u), cz - (L[i][1] + dz * u));
      if (d < bestD) {
        bestD = d;
        sEnd = cum[i] + u * Math.sqrt(l2);
      }
    }
    for (const d of [100, 150, 200]) {
      const s0 = sEnd - d * YD;
      if (s0 < 12 * YD) continue;
      let i = 0;
      while (i < L.length - 2 && s0 > cum[i + 1]) i++;
      const len = cum[i + 1] - cum[i], u = (s0 - cum[i]) / len;
      const px = L[i][0] + (L[i + 1][0] - L[i][0]) * u, pz = L[i][1] + (L[i + 1][1] - L[i][1]) * u;
      const nx = (L[i + 1][1] - L[i][1]) / len, nz = -(L[i + 1][0] - L[i][0]) / len;
      const off = hw0[i] + (hw0[i + 1] - hw0[i]) * u + 3.5;
      for (const side of [-1, 1]) {
        const x = px + side * nx * off, z = pz + side * nz * off;
        let clear = true;
        for (let a = 0; a < 12 && clear; a++) for (const r of [0, 2.5]) if (!["fairway", "rough"].includes(surfaceAt(x + Math.cos(a) * r, z + Math.sin(a) * r))) clear = false;
        if (clear) markers.push({ x, z, label: String(d) });
      }
    }
  }

  const world: World = {
    surfaceAt,
    ground,
    tee: true,
    bunkers: [],
    sand: def.bunkers.map((b) => blobRing(b)),
    water: def.water.map((w) => waterRing(w)),
    greens: [{ x: cx, z: cz, r: GH / 2, ring: greenRing, fringe: 0.7, pin, plain: true }, ...(def.targets ? RANGE_WORLD.greens : [])],
    trees,
    boards: [],
    markers,
    flagMin: FLAG_MIN_PX,
    palette: { deep: DEEP, green: GREEN, greenB: GREEN_B, fringe: FRINGE },
  };

  const blockers = (def.copse ?? []).map(([x, z, h]) => ({ x: x * YD, z: z * YD, r: TREE_R, h: h * 0.92 }));
  // the copse is in the way of a shot from (x, z) to the pin while the ball is still low enough to hit it
  const blocked = (x: number, z: number) => {
    const dx = pin[0] - x, dz = pin[1] - z, l = Math.hypot(dx, dz) || 1;
    return blockers.some((b) => {
      const u = Math.max(0, Math.min(l, LOW_M, ((b.x - x) * dx + (b.z - z) * dz) / l));
      return Math.hypot(x + (dx / l) * u - b.x, z + (dz / l) * u - b.z) < b.r + 2;
    });
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
      if (sf !== "out" && sf !== "water" && sf !== "oob" && sf !== "gorse") {
        let q = Math.min(l, d + 1.5);
        // dropped behind the copse there would be no way out: further in, until the way to the pin is open
        while (q < l && blocked(x + (dx / l) * q, z + (dz / l) * q)) q = Math.min(l, q + 1);
        return [x + (dx / l) * q, z + (dz / l) * q];
      }
    }
    return best;
  };

  const edge = (k: number): [number, number][] => {
    const l: [number, number][] = [], r: [number, number][] = [];
    for (const q of samples) {
      l.push([q.x - q.nx * (q.hw + k) * q.m, q.z - q.nz * (q.hw + k) * q.m]);
      r.push([q.x + q.nx * (q.hw + k) * q.m, q.z + q.nz * (q.hw + k) * q.m]);
    }
    return [...l, ...r.reverse()];
  };
  const shape = { rough: edge(rough), fairway: edge(0), box: { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity } };
  {
    const bx = shape.box;
    const all: [number, number][] = [...shape.rough, ...world.water.flat(), ...(world.sand ?? []).flat(), ...areas.flatMap((a) => a.ring), ...greenRing(GH / 2 + 1).map(([x, , z]) => [x, z] as [number, number])];
    for (const [x, z] of all) {
      bx.x0 = Math.min(bx.x0, x);
      bx.x1 = Math.max(bx.x1, x);
      bx.z0 = Math.min(bx.z0, z);
      bx.z1 = Math.max(bx.z1, z);
    }
  }

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
    margin,
    blockers,
    line: samples.map((s) => [s.x, s.z] as [number, number]),
    areas,
    shape,
  };
  built.set(def.n, b);
  return b;
}
