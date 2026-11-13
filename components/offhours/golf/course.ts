import { seeded } from "../useCanvas";
import type { Surface } from "./flight";
import type { Prop } from "./solids";
import { GH, GW, makeGreen, shapeR, zone, type Hole } from "./green";
import { compileFeatures, type Feature } from "./features";
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

export type Blob = {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot?: number;
  /** how deep a bunker is dug, m (default 0.35); a `pot` feature shapes its own */
  depth?: number;
  /** shore wobble seed (water only): a lobed, natural shore instead of an ellipse */
  lobe?: number;
};
/** a creek: water along a path (yd), `w` yd wide; the path is smoothed into a meander */
export type Creek = { path: [number, number][]; w: number; /** width (yd) at each path point (eased between them), so the carry varies along the creek */ ws?: number[] };
/** a lake: water inside a closed shore (yd, the points are smoothed into a curve), lying level in ground at `level` m (the ground at its shore; else the ground at its middle), its surface a lip under that */
export type Lake = {
  shore: [number, number][];
  level?: number;
  /** how deep the bed is dug under the ground at the shore, m (default 1.1). A deep tarn: 2 to 4. The waterline sits on the shore when `level` is the ground there, plus 0.22, less 0.19 x depth */
  depth?: number;
};
export type Water = Blob | Creek | Lake;
const isCreek = (w: Water): w is Creek => "path" in w;
const isLake = (w: Water): w is Lake => "shore" in w;

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
/** true if a tree may stand at (x, z) m: outside every `trees.clear` polygon */
export const treeClear = (def: HoleDef) => {
  const polys = (def.trees.clear ?? []).map((p) => p.map(([x, z]) => [x * YD, z * YD] as [number, number]));
  return (x: number, z: number) => !polys.some((p) => inPoly(p, x, z));
};
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
  trees: {
    seed: number;
    /** yd of clear ground beyond the rough before the trees */
    edge: number;
    /** yd between trees along the edge */
    spacing: number;
    /** polygons (yd) kept clear of every tree: the edge rows, the rows behind the green and the woods. Open a view with them */
    clear?: [number, number][][];
    /** 0..1, [left, right] (looking down the hole): the share of the edge trees kept on each side (default 1: a full row) */
    sides?: [number, number];
    /** rows of trees behind the green (default 3); 0 leaves the view past the green open */
    behind?: number;
  };
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
  /** landforms on top of the ground (features.ts): ridges, mounds, bowls, pot bunkers, channels, shelves, faces, terraces */
  features?: Feature[];
  /** placed props, in yd like the rest of the hole (solids.ts): boulders, walls, posts, stakes, a bridge, reeds. The solid ones stop and turn a ball; components/golf3d/props3d.ts draws them all. */
  props?: Prop[];
  /**
   * Yards of fescue, gorse, waste or out of bounds (see Area). surfaceAt reads them in this order: water, then out of
   * bounds, then the green and its fringe, then the bunkers (those four are authored objects and always win over a field
   * they sit in), then gorse, waste, fescue (that order where they overlap), then the fairway, the rough and the woods,
   * which a field replaces where it lies. The 3D ground paints them; wave 2 holes author their own.
   */
  areas?: Area[];
  /**
   * Drop zones, [x, z] in yd: where a ball is dropped when it is in water, in the woods or unplayable on a cliff (flight.ts
   * `steep`), for a stroke, instead of back along its line or beside where it stopped. The one nearest where the ball
   * went in is used. Put them on dry, flat ground in play, short of the hazard; none: the ordinary drops (lie.ts).
   */
  drops?: [number, number][];
};

/** hole 2's rock knoll: the brink of the cliff round the tee, walked clockwise on the plan so the drop is outside (yd) */
const KNOLL_2: [number, number][] = [[-0.6, 19.5], [7.9, 19.8], [16.7, 16.1], [22.8, 6.5], [26, 3.4], [24.2, -4.6], [23.9, -11.9], [22.4, -17.9], [13.1, -21.8], [8.2, -27.3], [1, -24.2], [-6.4, -23.5], [-14, -20.8], [-25.3, -17.4], [-24.1, -10.9], [-29.5, -7.7], [-28.4, 3.2], [-23, 8.6], [-16.5, 16.4], [-10.2, 19.3]];

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
    // off a rock ledge 30 m over a mountain tarn, 150 yd to a green on a peninsula under the falls. All carry: the tee is a
    // knoll with a cliff all round it (a face of 30 m in 3 yd), the tarn fills the valley floor, and the green is a tongue of
    // land out into it. Short, left and long-left are the tarn; the safe line is the bench on the right, 100 yd out, with
    // a pitch to the green. A ball in the tarn, or one that goes off the ledge and lands on the rock, is dropped on the bench.
    n: 2,
    name: "Short Straw",
    par: 3,
    yards: 150,
    line: [[0, 0], [0, 152]],
    half: [10, 30],
    rough: 12,
    pin: [-3, 150],
    green: { c: [0, 152], seed: 4202, severity: 0.75 },
    bunkers: [{ x: 31, z: 152, rx: 5, rz: 6.5, rot: 0.2 }],
    water: [
      {
        shore: [[-46, 40], [-12, 35], [14, 40], [17, 62], [15, 92], [18, 114], [21, 125], [14, 129], [0, 130], [-14, 130], [-21, 138], [-22, 158], [-21, 172], [-30, 178], [-48, 172], [-52, 120], [-50, 75]],
        // a deep tarn (4 m under its waterline), its surface on the shore
        level: -30.3,
        depth: 2.6,
      },
    ],
    trees: {
      seed: 23,
      edge: 6,
      spacing: 6,
      // the valley is open: a stand of pines at its far sides and none between the ledge and the falls
      clear: [[[-62, -34], [62, -34], [62, 200], [-62, 200]]],
      sides: [0.3, 0.3],
      behind: 0,
    },
    wind: { speed: 2, dir: Math.PI / 2 },
    landing: [-3, 150],
    // the ledge is level, the valley floor 30 m under it (the cliff below does that), and the green's tongue stands
    // most of a metre over the tarn
    ground: { rise: [[0, 0], [118, 0], [146, 0.8], [152, 0.8]], swell: 0.15, sigma: 9, teeFlat: 9, teeEase: 4, greenEase: 4, cell: 0.75, baseY: 52 },
    features: [
      { k: "cliff", path: KNOLL_2, closed: true, drop: 30, run: 3, talus: 10, scree: 0.1, ledges: 6, seed: 7 },
    ],
    // drop zone: on the bench, a short pitch to the green
    drops: [[28, 137]],
    props: [
      { kind: "boulder", at: [-14, 34], size: 2.1, seed: 3 },
      { kind: "boulder", at: [15, 33], size: 1.6, seed: 5 },
      { kind: "rocks", at: [4, 33.5], r: 3, n: 9, seed: 2 },
      { kind: "rocks", at: [-23, 26], r: 3, n: 8, seed: 11 },
      { kind: "rocks", at: [-30, 176], r: 3, n: 8, seed: 6 },
      { kind: "reeds", at: [17.5, 100], r: 4, n: 30, seed: 4 },
      { kind: "reeds", at: [-17.5, 165], r: 4, n: 22, seed: 9 },
    ],
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
    // the corner bunker is a pot: a sod face round a floor 1.7 m down, and a lip toward the green
    features: [{ k: "pot", b: 0, d: 1.7 }],
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
    water: [{ path: [[-64, 333], [-44, 324], [-24, 329], [0, 328], [20, 322.5], [42, 328], [66, 326]], w: 14, ws: [12, 13, 15, 13.5, 11, 14, 12] }],
    trees: { seed: 41, edge: 6, spacing: 6 },
    wind: { speed: 2.5, dir: 0.3 },
    landing: [0, 255],
    // the fairway runs down to the creek, so a lay-up keeps rolling toward it; then up again to a raised green
    ground: { rise: [[0, 0], [110, 2], [230, 0], [300, -2], [327, -3.5], [370, -1.5], [430, 2], [474, 3.5]], tilt: [[200, 0.02], [300, 0], [420, -0.015]] },
    // a footbridge over the creek on the right, past the fairway's edge, yellow stakes on both banks, reeds, rocks
    props: [
      { kind: "bridge", a: [30, 316], b: [30, 339], w: 2.6 },
      ...[-24, -10, 12, 22].flatMap((x): Prop[] => [
        { kind: "stake", at: [x, 318.5], color: "yellow" },
        { kind: "stake", at: [x, 336.5], color: "yellow" },
      ]),
      { kind: "reeds", at: [14, 320.5], r: 4, n: 34, seed: 1 },
      { kind: "reeds", at: [-34, 321], r: 5, n: 34, seed: 2 },
      { kind: "reeds", at: [24, 335], r: 4, n: 30, seed: 3 },
      { kind: "reeds", at: [-4, 335], r: 5, n: 34, seed: 7 },
      { kind: "rocks", at: [27.5, 317], r: 2, n: 8, seed: 3 },
      { kind: "rocks", at: [32.5, 338.5], r: 2, n: 8, seed: 4 },
      { kind: "tuft", at: [34, 322], r: 4, n: 20, seed: 5 },
    ],
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
    water: [{ path: [[-54, 189], [-64, 213], [-88, 238], [-92, 259], [-116, 282], [-119, 306], [-138, 330], [-146, 346]], w: 11, ws: [8, 9, 12, 13, 9, 11, 14, 9] }],
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
    // a field wall down the right of the climb with a gated gap, and a striped post on the crest to aim by
    props: [
      { kind: "wall", path: [[29, 100], [30, 205], [31, 262], [29, 308]], h: 1.2, gaps: [[95, 103]], seed: 7 },
      { kind: "gatepost", at: [30, 199], yaw: 0, gap: 8 * YD },
      { kind: "post", at: [0, 246], h: 6.5, r: 0.14 },
      { kind: "tuft", at: [31, 150], r: 4, n: 22, seed: 2 },
      { kind: "tuft", at: [31, 240], r: 4, n: 22, seed: 3 },
      { kind: "bench", at: [-7, 5], yaw: Math.PI / 2 },
      { kind: "sign", at: [6, 4], yaw: -0.3 },
    ],
    // gorse on the left of the climb and the right of the crest: a ball in it is unplayable
    areas: [
      { kind: "gorse", poly: [[-28, 160], [-34, 168], [-38, 184], [-34, 202], [-28, 198], [-26, 178]] },
      { kind: "gorse", poly: [[28, 262], [35, 268], [37, 284], [32, 298], [26, 290], [25, 274]] },
    ],
  },
  {
    // a climb up the bay's shore to a green on an island in a lake that lies on the bluff beside the bay, 17 m over the tee.
    // The drive carries about 240 yd to the foot of the plateau. From there the island is 235 yd across the water: the brave
    // line is a driver at 95 to 100% on a true line (a 3 wood is 15 yd short, in the lake). Or lay up left, to the lake's
    // near bank 390 yd out, and pitch 105 yd over the water to the island (a footbridge crosses the channel behind it, for
    // show). Short, long and wide of the island are the lake, and the ball is dropped on the lay-up bank for a stroke
    n: 8,
    name: "Long Water",
    par: 5,
    yards: 492,
    line: [[0, 0], [0, 245], [-14, 380], [-4, 447], [30, 482]],
    half: [15, 21, 20, 18, 17],
    rough: 14,
    pin: [30, 480],
    green: { c: [30, 481], seed: 4808, severity: 0.7 },
    bunkers: [
      { x: -24, z: 250, rx: 5, rz: 10 },
      { x: -36, z: 376, rx: 5, rz: 9, rot: 0.2 },
    ],
    water: [
      // the lake: a bay of the sea loch lifted onto the plateau, wrapped round the island on three sides (open to the west)
      {
        shore: [[8, 332], [22, 322], [45, 318], [70, 324], [96, 336], [116, 356], [128, 384], [132, 418], [129, 454], [124, 488], [112, 518], [92, 538], [64, 548], [36, 544], [14, 532], [8, 516], [12, 506], [26, 503], [42, 499], [52, 491], [55, 480], [51, 470], [41, 463], [26, 461], [12, 462], [6, 452], [5, 438], [3, 412], [4, 382], [6, 354]],
        level: 16.8,
        depth: 2.2,
      },
      // the channel on the island's west side, which the footbridge crosses
      {
        shore: [[2, 438], [10, 446], [15, 458], [15, 472], [14, 488], [13, 504], [12, 516], [10, 526], [1, 530], [-7, 522], [-8, 496], [-8, 472], [-4, 454], [-2, 443]],
        level: 16.8,
        depth: 2.2,
      },
    ],
    trees: { seed: 83, edge: 6, spacing: 6, clear: [[[24, -60], [220, -60], [220, 700], [24, 700]], [[-80, 530], [220, 530], [220, 700], [-80, 700]]], sides: [0.4, 0.15], behind: 0 },
    wind: { speed: 2, dir: 1.2 },
    landing: [0, 245],
    ground: { rise: [[0, 0], [60, 2], [150, 6], [235, 11], [290, 15], [325, 17], [405, 17.4], [495, 17.8]], swell: 0.5 },
    // drop zones: along the fairway for the trees; at the lake, the lay-up bank on the left, a short pitch from the island
    drops: [[0, 70], [0, 150], [0, 225], [-14, 390]],
    props: [
      { kind: "bridge", a: [-12, 484], b: [19, 480], w: 2.6 },
      { kind: "reeds", at: [-12, 442], r: 4, n: 14, seed: 4 },
      { kind: "reeds", at: [3, 520], r: 3, n: 9, seed: 6 },
      { kind: "rocks", at: [112, 524], r: 5, n: 9, seed: 3 },
      { kind: "bench", at: [-7, 5], yaw: Math.PI / 2 },
      { kind: "sign", at: [6, 4], yaw: -0.3 },
    ],
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
    water: [{ x: -93, z: 428, rx: 10, rz: 7, rot: 0.4, lobe: 5.2 }],
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
  const a = u / (b.rx * YD), e = v / (b.rz * YD);
  return Math.hypot(a, e) < lobeK(b.lobe, Math.atan2(e, a));
};
/** shore wobble: radius scale at angle a for a lobe seed (1 for none) */
export const lobeK = (seed: number | undefined, a: number) => {
  if (!seed) return 1;
  let k = 1;
  for (let h = 2; h <= 5; h++) k += (0.16 / (h - 1)) * Math.sin(h * a + seed * h * 1.7 + h);
  return k;
};
const blobRing = (b: Blob, n = b.lobe ? 48 : 20): [number, number][] => {
  const c = Math.cos(b.rot ?? 0), s = Math.sin(b.rot ?? 0);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = lobeK(b.lobe, a);
    const u = Math.cos(a) * b.rx * YD * k, v = Math.sin(a) * b.rz * YD * k;
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
/** a creek as a dense smooth polyline in metres, with the half width at each point */
export type CreekPt = { x: number; z: number; hw: number; s: number };
export const creekPoly = (c: Creek): CreekPt[] => {
  const P = c.path.map(([x, z]) => [x * YD, z * YD]);
  const W = (c.ws ?? c.path.map(() => c.w)).map((w) => (w * YD) / 2);
  const out: CreekPt[] = [];
  const at = (i: number) => Math.max(0, Math.min(P.length - 1, i));
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[at(i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[at(i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), z: f(p0[1], p1[1], p2[1], p3[1]), hw: W[i] + (W[i + 1] - W[i]) * (t * t * (3 - 2 * t)), s: 0 });
    }
  }
  const l = P[P.length - 1];
  out.push({ x: l[0], z: l[1], hw: W[W.length - 1], s: 0 });
  for (let i = 1; i < out.length; i++) out[i].s = out[i - 1].s + Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
  return out;
};
/** metres from the creek's bank (negative: in the water) */
export const creekSd = (poly: CreekPt[], x: number, z: number) => {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (a.x + dx * u), z - (a.z + dz * u)) - (a.hw + (b.hw - a.hw) * u));
  }
  return best;
};
const polyCache = new WeakMap<Creek, CreekPt[]>();
export const polyOf = (c: Creek) => { let p = polyCache.get(c); if (!p) { p = creekPoly(c); polyCache.set(c, p); } return p; };
/** a lake's shore as a smooth closed curve in metres (Catmull-Rom through the points, a point about every 2.5 m) */
export const lakeRing = (l: Lake): [number, number][] => {
  const P = l.shore.map(([x, z]) => [x * YD, z * YD]);
  const n = P.length, out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i + n - 1) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const m = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2.5));
    for (let k = 0; k < m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
};
/** metres from a closed ring's edge (negative: inside) */
export const ringSd = (ring: [number, number][], x: number, z: number) => {
  let best = Infinity, inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax, dz = bz - az;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + dx * u), z - (az + dz * u)));
  }
  return inside ? -best : best;
};
const lakeCache = new WeakMap<Lake, [number, number][]>();
export const lakeOf = (l: Lake) => { let r = lakeCache.get(l); if (!r) { r = lakeRing(l); lakeCache.set(l, r); } return r; };
const waterHit = (w: Water, x: number, z: number) => (isCreek(w) ? creekSd(polyOf(w), x, z) < 0 : isLake(w) ? ringSd(lakeOf(w), x, z) < 0 : blobHit(w, x, z));
const creekRing = (c: Creek): [number, number][] => {
  const P = polyOf(c);
  const left: [number, number][] = [], right: [number, number][] = [];
  P.forEach((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = (b.z - a.z) / l, nz = -(b.x - a.x) / l;
    left.push([p.x + nx * p.hw, p.z + nz * p.hw]);
    right.push([p.x - nx * p.hw, p.z - nz * p.hw]);
  });
  return [...left, ...right.reverse()];
};
const waterRing = (w: Water) => (isCreek(w) ? creekRing(w) : isLake(w) ? lakeOf(w) : blobRing(w));

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
  /** the drop zones in metres (HoleDef.drops), empty without any */
  drops: [number, number][];
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

  // a cliff's rock face is no ground to play from: a ball that stops on it is "out" (and, being steep, unplayable: flight.ts)
  const cliffs = (def.features ?? []).some((f) => f.k === "cliff") ? compileFeatures(def.features, def.bunkers) : null;
  const surfaceAt = (x: number, z: number): Surface => {
    for (const b of def.water) if (waterHit(b, x, z)) return "water";
    if (areas.length && areaAt(x, z, ["oob"])) return "oob";
    if (cliffs && cliffs.rock(x, z)) return "out";
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
    // and never in water, in a clearing, or on a side the hole thins (a hash, so the draws, and the rest, do not move)
    const open = treeClear(def);
    const sides = def.trees.sides;
    const keep = (t: Tree, s = 0) => {
      if (margin(t.x, t.z) <= rough + 3 * YD || !open(t.x, t.z) || surfaceAt(t.x, t.z) === "water") return;
      if (s && sides) {
        const k = sides[s < 0 ? 0 : 1], h = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
        if (h >= k) return;
      }
      trees.push(t);
    };
    for (let i = 0; i < samples.length; i++) {
      if (i % Math.max(1, Math.round(sp / (5 * YD))) !== 0) continue;
      const a = samples[i];
      for (const s of [-1, 1]) {
        const d = a.hw + out + r() * 4;
        keep({ x: a.x + s * a.nx * d, z: a.z + s * a.nz * d + (r() - 0.5) * 3, h: 11 + r() * 9, kind: Math.floor(r() * 4), flip: r() > 0.5 }, s);
        if (r() > 0.45) keep({ x: a.x + s * a.nx * (d + 9 + r() * 14), z: a.z + s * a.nz * (d + 9 + r() * 14) + r() * 4, h: 15 + r() * 10, kind: Math.floor(r() * 4), flip: r() > 0.5 }, s);
      }
    }
    // the copse: trees a ball in the air can hit, set where the hole's decision is
    for (const [x, z, h] of def.copse ?? []) trees.push({ x: x * YD, z: z * YD, h, kind: Math.floor(r() * 3), flip: r() > 0.5 });
    const end = pts[pts.length - 1];
    for (let row = 0; row < (def.trees.behind ?? 3); row++)
      for (let x = -130; x < 130; x += 6 + r() * 4) {
        const t = { x: end[0] + x, z: end[1] + 22 + row * 14 + r() * 6, h: 15 + r() * 12 + row * 3, kind: Math.floor(r() * 4), flip: r() > 0.5 };
        if (open(t.x, t.z) && surfaceAt(t.x, t.z) !== "water") trees.push(t);
      }
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
  const dropsM = (def.drops ?? []).map(([x, z]) => [x * YD, z * YD] as [number, number]);
  /** the drop zone nearest a point, or null */
  const dropNear = (x: number, z: number): [number, number] | null => {
    let best: [number, number] | null = null, bd = Infinity;
    for (const q of dropsM) {
      const d = Math.hypot(q[0] - x, q[1] - z);
      if (d < bd) [best, bd] = [q, d];
    }
    return best;
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
    // (no ground in play on the way to the line: the nearest drop zone, if the hole has one)
    const zone = dropNear(x, z);
    return zone ?? best;
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
    drops: dropsM,
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
