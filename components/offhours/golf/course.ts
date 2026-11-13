import { seeded } from "../useCanvas";
import type { Surface } from "./flight";
import { onDeck, type Prop } from "./solids";
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
export type Creek = {
  path: [number, number][];
  w: number;
  /** width (yd) at each path point (eased between them), so the carry varies along the creek */
  ws?: number[];
  /** how deep the bed is dug below the ground beside it, m (default 0.95): a burn in a real channel, with banks to climb */
  deep?: number;
};
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

/**
 * hole 2's escarpment: the brink of the cliff, a pit walked counter-clockwise so the basin (the low side) is inside: along the
 * front of the tee, then up both sides like the rim of a cirque, closing behind the waterfall wall (yd). Outside it the
 * ground stays high: the mountainside goes on up behind the tee
 */
const RIM_2: [number, number][] = [[-95, 42], [-55, 23], [-22, 17], [0, 16], [22, 17], [55, 23], [95, 42], [118, 75], [126, 120], [122, 170], [105, 205], [0, 208], [-105, 205], [-122, 170], [-126, 120], [-118, 75]];

export const HOLE_DEFS: HoleDef[] = [
  {
    // a raised tee by the clubhouse looks down a wide fairway that turns gently right, round a lone oak on the inside of the
    // bend. The ground climbs from the swale, up a face (a false front: a short approach rolls back down) to a plateau green
    // framed by two stone gateposts, with the Door peak behind it
    n: 1,
    name: "Open Door",
    par: 4,
    yards: 340,
    line: [[0, 0], [0, 172], [9, 262], [40, 338]],
    half: [17, 33, 32, 17],
    rough: 14,
    pin: [42, 337.4],
    green: { c: [40, 339], seed: 4101, severity: 0.6 },
    bunkers: [{ x: -29, z: 258, rx: 5, rz: 9, rot: -0.12 }],
    water: [],
    trees: {
      seed: 11,
      edge: 6,
      spacing: 6,
      // open country: a thin screen of trees down the left, thinner on the right, and none past the landing area, none behind the
      // green, so the plateau and the Door stand clear
      sides: [0.4, 0.22],
      behind: 0,
      clear: [
        [[48, 262], [48, 440], [320, 440], [320, 262]],
        [[-320, 290], [-320, 440], [-36, 440], [-36, 290]],
        [[-320, 340], [-320, 440], [320, 440], [320, 340]],
      ],
    },
    // the oak, 26 m, a little right of the line at 206 yd: a driver flies over it, a 3 wood aimed at it goes in and drops short
    copse: [[15, 206, 26]],
    wind: { speed: 1.5, dir: 0.6 },
    landing: [0, 240],
    ground: {
      rise: [[0, 0], [24, -0.3], [52, -3.2], [110, -4.4], [190, -5.6], [235, -5.4], [258, -4.2], [284, -0.6], [306, 5.2], [324, 8.8], [342, 9.7]],
      tilt: [[150, 0], [200, -0.025], [262, -0.03], [310, 0]],
      mounds: [[-30, 180, 9, 1.2], [44, 262, 10, 1.1], [41, 354, 12, 2.6]],
      sigma: 11,
      greenEase: 10,
      baseY: 30,
    },
    props: [
      // two stone gateposts frame the green, with the peak between them
      { kind: "gatepost", at: [40, 357], yaw: Math.PI / 2, gap: 34, h: 4.2 },
      { kind: "bench", at: [-7, 5], yaw: Math.PI / 2 },
      { kind: "sign", at: [6, 4], yaw: -0.3 },
    ],
    areas: [
      // a sandy scrape in the rough off the right of the landing area, on the inside of the bend: a drive that leaks right is not lost
      { kind: "waste", poly: [[46, 178], [54, 192], [57, 214], [55, 240], [48, 238], [45, 214], [42, 194]] },
      // long fescue in the rough on both flanks of the face, so a miss either side of the plateau is a harder lie
      { kind: "fescue", poly: [[52, 264], [60, 282], [65, 304], [64, 322], [54, 320], [49, 300], [47, 278]] },
      { kind: "fescue", poly: [[-8, 284], [2, 288], [4, 300], [10, 318], [14, 328], [6, 330], [0, 322], [-4, 310], [-9, 296]] },
    ],
  },
  {
    // off the brink of an escarpment 30 m over a mountain tarn, 150 yd to a green on a peninsula under the falls. All carry.
    // The tee is the edge of high ground (the mountainside goes on up behind it); the cliff is a long open wall curving round the
    // basin like a cirque; the tarn fills the basin, wraps the green on its west, south and east, and takes the fall. Short, left
    // and long-left are the tarn; the safe line is the bench on the right, 100 yd out, with a pitch to the green. A ball in the tarn
    // or unplayable on the rock is dropped on the bench. The basin is open heather and scree (a fescue field with the ribbon under
    // it); the trees stand on the high ground round it
    n: 2,
    name: "Short Straw",
    par: 3,
    yards: 150,
    line: [[0, 0], [0, 16], [0, 26], [0, 152]],
    half: [12, 12, 85, 85],
    rough: 10,
    pin: [-3, 150],
    green: { c: [0, 152], seed: 4202, severity: 0.75 },
    bunkers: [{ x: 38, z: 163, rx: 5, rz: 6.5, rot: 0.2 }],
    water: [
      {
        shore: [[-56, 46], [-26, 41], [4, 39], [22, 42], [30, 60], [28, 92], [29, 116], [32, 134], [31, 146], [25, 146], [22, 137], [11, 130], [-12, 130], [-22, 138], [-24, 156], [-23, 174], [-36, 197], [-64, 193], [-84, 156], [-86, 104], [-76, 66]],
        // a deep tarn (4 m under its waterline), its surface on the shore
        level: -30.15,
        depth: 2.6,
      },
    ],
    trees: {
      seed: 23,
      edge: 6,
      spacing: 7,
      // none in front of the tee or over the basin; stunted ones on its rim
      clear: [[[-60, -4], [60, -4], [60, 30], [-60, 30]]],
      sides: [0.4, 0.4],
      behind: 0,
    },
    // pines on the high ground behind the tee and along the brink (they are far from every line of play)
    copse: [[-6, -29, 17], [-6, -19, 13], [-39, -31, 13], [-50, -38, 11], [5, -18, 11], [12, -35, 17], [19, -27, 13], [15, -20, 11], [-55, -42, 13], [12, -22, 15], [-7, -19, 13], [17, -31, 11], [-5, -39, 11], [26, -37, 13], [2, -47, 11], [-12, -19, 17], [-54, -47, 11], [-36, -16, 11], [-4, -15, 17], [-10, -29, 13], [35, -39, 11], [-23, -47, 17], [32, -44, 13], [26, -48, 17], [37, -42, 13], [-7, -42, 13], [-36, -5, 10], [-36, 5, 10], [40, -4, 10], [30, 3, 10]],
    wind: { speed: 2, dir: Math.PI / 2 },
    landing: [-3, 150],
    // the ledge is level, the basin floor 30 m under it (the cliff does that), and the green's tongue stands most of a metre
    // over the tarn
    ground: { rise: [[0, 0], [130, 0], [148, 0.8], [152, 0.8]], swell: 0.25, sigma: 9, teeFlat: 8, teeEase: 4, greenEase: 4, cell: 0.75, baseY: 52 },
    features: [
      { k: "cliff", path: RIM_2, closed: true, drop: 30, run: 3, talus: 10, scree: 0.1, ledges: 6, seed: 7 },
      // the mountainside goes on up behind the tee
      { k: "ridge", path: [[-70, -46], [0, -60], [70, -46]], w: 40, h: 10 },
      // knolls on the bench and the shore
      { k: "mound", x: 46, z: 82, r: 13, rz: 9, h: 2.6 },
      { k: "mound", x: 58, z: 124, r: 12, h: 2.4 },
      { k: "mound", x: 44, z: 176, r: 11, h: 2 },
    ],
    // the basin floor round the tarn is heather and fescue, mown only round the green
    areas: [
      {
        kind: "fescue",
        poly: [[-96, 22], [0, 22], [96, 22], [96, 204], [22, 204], [22, 178], [19, 160], [16, 144], [8, 135], [0, 134], [-8, 135], [-16, 144], [-19, 160], [-22, 178], [-22, 204], [-96, 204]],
      },
    ],
    // drop zone: east of the green's inlet, a pitch of 37 yd across land
    drops: [[34, 152]],
    props: [
      { kind: "boulder", at: [-14, 33], size: 2.1, seed: 3 },
      { kind: "boulder", at: [15, 32], size: 1.6, seed: 5 },
      { kind: "rocks", at: [4, 33], r: 3, n: 9, seed: 2 },
      { kind: "rocks", at: [-40, 33], r: 3, n: 8, seed: 11 },
      { kind: "rocks", at: [32, 34], r: 3, n: 8, seed: 12 },
      { kind: "boulder", at: [31, 74], size: 2.4, seed: 13 },
      { kind: "rocks", at: [31, 100], r: 3, n: 9, seed: 14 },
      { kind: "boulder", at: [33, 124], size: 1.8, seed: 15 },
      { kind: "rocks", at: [-26, 150], r: 3, n: 8, seed: 16 },
      { kind: "boulder", at: [-30, 182], size: 2.2, seed: 17 },
      { kind: "rocks", at: [-88, 110], r: 3, n: 8, seed: 18 },
      { kind: "rocks", at: [-60, 188], r: 3, n: 8, seed: 19 },
      { kind: "tuft", at: [40, 100], r: 8, n: 30, seed: 1 },
      { kind: "tuft", at: [-90, 130], r: 6, n: 24, seed: 2 },
      { kind: "reeds", at: [29, 104], r: 4, n: 26, seed: 4 },
      { kind: "reeds", at: [-24, 166], r: 4, n: 22, seed: 9 },
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
    // one burn crosses the hole twice: over the fairway at 200 to 260 yd, down the right between, and back across in front of the green
    n: 4,
    name: "Reed Creek",
    par: 4,
    yards: 410,
    line: [[0, 0], [0, 300], [6, 414]],
    half: [16, 26, 20],
    rough: 14,
    pin: [6, 410],
    green: { c: [6, 412], seed: 4404, severity: 0.85 },
    bunkers: [
      { x: 14, z: 282, rx: 5, rz: 9, rot: 0.1, depth: 0.5 },
      { x: 25, z: 408, rx: 5, rz: 6 },
      { x: -19, z: 404, rx: 4.5, rz: 5.5, rot: 0.4, depth: 0.7 },
    ],
    water: [
      {
        path: [[-72, 192], [-52, 198], [-26, 207], [0, 227], [24, 247], [38, 270], [40, 300], [36, 334], [22, 362], [0, 376], [-26, 378], [-52, 373], [-76, 380]],
        w: 11,
        ws: [6, 11, 12, 14, 15, 11, 9, 10, 9, 11, 13, 10, 8, 6],
        deep: 1.5,
      },
    ],
    trees: {
      seed: 41,
      edge: 6,
      spacing: 6,
      sides: [0.5, 0.5],
      behind: 1,
      clear: [
        [[-160, 150], [-24, 150], [-24, 430], [-160, 430]],
        [[24, 150], [160, 150], [160, 430], [24, 430]],
      ],
    },
    wind: { speed: 2.5, dir: 0.3 },
    // dense stands where the burn goes into the woods, so it comes from somewhere and goes somewhere
    copse: [
      [-74, 186, 18], [-80, 196, 20], [-68, 200, 17], [-84, 188, 19], [-76, 205, 18], [-62, 189, 16], [-86, 200, 17],
      [-78, 374, 18], [-84, 384, 20], [-72, 388, 17], [-88, 376, 19], [-80, 392, 18], [-68, 384, 16], [-90, 386, 17],
    ],
    landing: [-12, 258],
    ground: {
      rise: [[0, 0], [20, -0.3], [45, -2.4], [80, -5.5], [120, -8.3], [170, -9.8], [205, -10.4], [232, -10.8], [262, -9.2], [300, -8.4], [340, -8.8], [375, -9.7], [395, -9.2], [414, -8.6]],
      tilt: [[240, 0], [270, -0.012], [340, -0.012], [380, 0]],
      baseY: 50,
    },
    // a bank behind the green to hold a ball that runs on, and mounds that pen the left rough on the first fairway
    features: [
      { k: "ridge", path: [[-40, 436], [-12, 441], [18, 442], [48, 436]], w: 14, h: 1.8 },
      { k: "mound", x: -34, z: 270, r: 11, rz: 16, h: 1.1 },
    ],
    props: [
      // the stone bridge over the second crossing, on the line to the green: a ball that lands on the deck rolls over it
      { kind: "bridge", a: [0, 364], b: [0, 389], w: 3.2, arch: 0.45 },
      { kind: "reeds", at: [-31, 198.5], r: 4, n: 34, seed: 1 },
      { kind: "reeds", at: [-46, 190], r: 5, n: 34, seed: 2 },
      { kind: "reeds", at: [-42, 206], r: 4, n: 28, seed: 3 },
      { kind: "reeds", at: [46, 266], r: 4, n: 34, seed: 4 },
      { kind: "reeds", at: [47, 298], r: 5, n: 40, seed: 5 },
      { kind: "reeds", at: [43, 330], r: 4, n: 30, seed: 6 },
      { kind: "reeds", at: [-40, 368], r: 4, n: 30, seed: 7 },
      { kind: "reeds", at: [-52, 386], r: 4, n: 28, seed: 8 },
      { kind: "reeds", at: [9, 361], r: 3, n: 18, seed: 9 },
      { kind: "rocks", at: [30, 255], r: 2, n: 8, seed: 3 },
      { kind: "rocks", at: [34, 340], r: 2, n: 8, seed: 4 },
      { kind: "rocks", at: [-62, 366], r: 2, n: 8, seed: 5 },
      { kind: "rocks", at: [-5, 360], r: 2, n: 6, seed: 6 },
      { kind: "tuft", at: [14, 372], r: 4, n: 20, seed: 5 },
    ],
  },
  {
    // blind over a dune: a drive aimed at the marker post on the crest has to carry a sandy waste and the dune's face, and
    // drops to a short pitch into a punchbowl green; the safe line round the dune's low left shoulder leaves a longer one
    n: 5,
    name: "The Collar",
    par: 4,
    yards: 362,
    line: [[0, 0], [0, 205], [0, 262], [0, 362]],
    half: [13, 25, 20, 14],
    rough: 12,
    pin: [3, 359],
    green: { c: [0, 361], seed: 4505, severity: 0.9 },
    // (no bunkers: the waste and the bowl are the hazards)
    bunkers: [],
    water: [],
    trees: {
      seed: 53,
      edge: 6,
      spacing: 6,
      sides: [0.45, 0.45],
      behind: 0,
      // dune country: the trees fall back from the waste, the dune and the bowl, and stand only by the tee
      clear: [[[-420, 100], [-420, 760], [420, 760], [420, 100]]],
    },
    wind: { speed: 3, dir: -1.2 },
    landing: [8, 238],
    // a steady climb to the dune, a drop behind it, and the green down in the bowl
    ground: {
      rise: [[0, 0], [70, 0.3], [150, 0.8], [200, 1.3], [222, 1.8], [250, 0.2], [290, -1.6], [330, -2.8], [362, -2.8]],
      swell: 0.3,
      sigma: 9,
      greenEase: 10,
    },
    features: [
      // the dune: a long ridge across the corridor that is low at its left end (the safe way) and high at the post
      { k: "ridge", path: [[0, 214], [22, 212], [50, 214], [86, 222]], w: 34, h: 3.4, h2: 4 },
      { k: "mound", x: 18, z: 212, r: 26, rz: 24, h: 4.8 },
      // the dunes to either side of the corridor, beyond the rough: the tee shot plays down a dune valley
      { k: "ridge", path: [[-80, 150], [-86, 220], [-78, 300]], w: 30, h: 6 },
      { k: "ridge", path: [[84, 140], [94, 220], [86, 300]], w: 30, h: 8 },
      // dunes to either side down the lee, so the bowl sits in dune country
      { k: "ridge", path: [[58, 290], [68, 330], [62, 380]], w: 20, h: 3 },
      { k: "ridge", path: [[-58, 296], [-66, 340], [-60, 384]], w: 20, h: 2.6 },
      // the punchbowl: a flat floor round the green, a rim that feeds the ball down, a gap at the front and a high back
      { k: "bowl", x: 0, z: 361, r: 28, rz: 26, d: 1.3, flat: 0.55, rim: 2, rimW: 12 },
      { k: "hollow", x: 0, z: 337, r: 6, rz: 8, d: 1.6 },
      { k: "mound", x: 0, z: 392, r: 18, rz: 12, h: 2.2 },
      // hummocks in the waste
      { k: "mound", x: -24, z: 160, r: 8, rz: 5, rot: 0.4, h: 0.8 },
      { k: "mound", x: 14, z: 172, r: 9, rz: 5, rot: -0.5, h: 0.9 },
      { k: "mound", x: 30, z: 152, r: 7, rz: 5, rot: 0.2, h: 0.7 },
      { k: "mound", x: -8, z: 190, r: 8, rz: 4, rot: 0.1, h: 0.7 },
    ],
    // a striped post on the crest to aim by
    props: [{ kind: "post", at: [18, 212], h: 6.5, r: 0.14 }],
    areas: [
      // the waste across the fairway, short of the dune
      { kind: "waste", poly: [[-44, 146], [-22, 140], [4, 144], [30, 138], [46, 142], [49, 172], [47, 204], [32, 214], [6, 212], [-14, 198], [-30, 187], [-47, 181], [-48, 160]] },
      // the dune's face and crest in fescue, but for the notch on its low left shoulder
      { kind: "fescue", poly: [[4, 214], [22, 216], [46, 216], [64, 218], [66, 230], [44, 232], [20, 230], [4, 226]] },
      // sandy faces on the rim of the bowl, the rest left to the fairway and the rough
      { kind: "waste", poly: [[16, 344], [28, 350], [31, 366], [26, 378], [19, 368], [17, 354]] },
      { kind: "fescue", poly: [[-32, 346], [-24, 338], [-19, 356], [-24, 378], [-34, 370]] },
    ],
  },
  {
    // a cape hole at golden hour: the tee is a dune edge 22 m over the estuary flats, and an arm of the tide cuts across
    // the line, a short carry on the right (about 145 yd) and a long one on the left (about 245), where it opens into the
    // estuary. The green is on the far bank, round to the left: the more of the arm a drive carries, the shorter the approach
    n: 6,
    name: "Last Light",
    par: 4,
    yards: 395,
    line: [[0, 0], [1, 105], [4, 160], [-60, 272], [-110, 370.5]],
    half: [15, 48, 46, 38, 20],
    rough: 18,
    pin: [-107, 366.5],
    green: { c: [-109, 369], seed: 4606, severity: 1.0 },
    bunkers: [
      { x: -19, z: 296, rx: 4.5, rz: 8, rot: 0.5 },
      { x: -91, z: 355, rx: 5, rz: 4.5 },
    ],
    // the arm: from the dune's foot on the right, across the line, into the estuary on the left, which runs down the
    // left of the far bank to the green (its level is the flats': the water lies in them)
    water: [
      {
        shore: [
          [82, 150], [56, 144], [30, 140], [8, 142], [-14, 160], [-40, 192], [-66, 236], [-92, 258], [-112, 268],
          [-125, 285], [-136, 316], [-148, 353], [-154, 375], [-159, 400], [-164, 430],
          [-190, 442], [-210, 420], [-212, 330], [-210, 260], [-205, 218],
          [-165, 213], [-132, 203], [-104, 190], [-78, 172], [-52, 142], [-26, 116], [0, 98], [28, 91], [56, 92], [82, 96],
        ],
        level: -20.6,
      },
    ],
    trees: {
      seed: 67,
      edge: 6,
      spacing: 6,
      // the left of the far bank and the arm are open to the estuary; the right keeps its dune trees
      clear: [[[-20, 100], [-300, 100], [-300, 470], [-118, 470], [-110, 372], [-60, 272], [4, 160]]],
      sides: [0.45, 0.55],
      behind: 0,
    },
    wind: { speed: 2.8, dir: 3.4 },
    // the safe line: a 3 wood over the arm's narrow end (151 yd of water at 2 degrees left), which leaves a 7 iron
    landing: [-14, 236],
    // the long fall: off the dune edge down to the flats, which then ease on down to the green
    ground: { rise: [[0, 0], [12, 0], [62, -9], [112, -18], [150, -20.4], [250, -20.8], [330, -21.5], [372, -22]], swell: 0.35 },
    props: [
      { kind: "bench", at: [-9, -3], yaw: Math.PI / 2 },
      { kind: "sign", at: [8, 3], yaw: -0.3 },
      { kind: "reeds", at: [2, 95], r: 5, n: 30, seed: 1 },
      { kind: "reeds", at: [-26, 112], r: 4, n: 26, seed: 2 },
      { kind: "reeds", at: [-52, 138], r: 4, n: 26, seed: 3 },
      { kind: "reeds", at: [24, 146], r: 4, n: 26, seed: 4 },
      { kind: "reeds", at: [-14, 165], r: 3, n: 22, seed: 5 },
      { kind: "reeds", at: [-40, 197], r: 3, n: 22, seed: 6 },
      { kind: "reeds", at: [-118, 281], r: 4, n: 26, seed: 7 },
    ],
    // tidal sand: two bars on the far bank, where the arm shoals (a ball that only just carries lands in them: firm, no penalty)
    areas: [
      { kind: "waste", poly: [[37, 139], [27, 137], [19, 137], [10, 139], [1, 143], [-7, 150], [-16, 158], [-25, 169], [-35, 181], [-30, 185], [-19, 174], [-7, 166], [0, 158], [7, 152], [14, 151], [19, 147], [26, 146], [35, 146]] },
      { kind: "waste", poly: [[-71, 238], [-81, 247], [-90, 254], [-99, 259], [-107, 263], [-105, 269], [-95, 267], [-84, 263], [-75, 255], [-67, 242]] },
    ],
  },
];

/** the back three, which make the six a nine (the 3D course plays all nine; the dialog's flat course the six) */
export const BACK_DEFS: HoleDef[] = [
  {
    // The hero shot. A long climb to a crest 11.5 m over the tee: the drive is blind, aimed at the striped post on the top.
    // Over it the ridge opens to the sea and falls 15 m in steps to a green on a shelf on the cliff top, the sea behind
    // it. A drive that clears the crest runs down the far face and leaves a pitch; one that stops on the climb leaves a
    // long blind second over the top; past the green is over the cliff
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
    // the sea side is opened from the climb on and behind the green, the left stays wooded but for a gap at the crest
    trees: {
      seed: 71,
      edge: 6,
      spacing: 6,
      sides: [0.6, 0.35],
      behind: 0,
      clear: [
        [[34, 150], [200, 150], [200, 520], [-130, 520], [-130, 396], [34, 396]],
        [[-130, 230], [-34, 230], [-34, 340], [-130, 340]],
      ],
    },
    wind: { speed: 2.2, dir: 2.6 },
    landing: [0, 235],
    // the plan's profile, held by a small `sigma`: the crest and the far face stay sharp. Tee 22 m above the sea
    ground: {
      rise: [[0, 0], [60, 1], [150, 6], [212, 10.5], [236, 11.8], [262, 7.5], [300, 3.5], [345, 0], [387, -1]],
      tilt: [[200, 0], [240, 0.02], [300, 0]],
      sigma: 9,
      greenEase: 8,
      baseY: 22,
    },
    features: [
      // hollows either side of the spine: a drive that leaves the ridge goes down into them
      { k: "hollow", x: -46, z: 190, r: 16, rz: 56, d: 2.8 },
      { k: "hollow", x: 48, z: 215, r: 16, rz: 48, d: 2.8 },
      // the far side falls in steps, each a face and a tread: the drop reads from above and from the crest
      { k: "terrace", path: [[-50, 292], [84, 292]], h: -4, n: 2, tread: 20, riser: 14, reach: 150 },
      // the green on its shelf, and the cliff edge behind it
      { k: "shelf", x: -14, z: 386, r: 19, rz: 16, h: 1.2, edge: 8 },
      { k: "face", path: [[-60, 410], [84, 410]], h: -22, w: 8, reach: 120 },
    ],
    // a field wall down the right of the climb, over the crest and down the far side, with a gated gap; a striped post on
    // the crest to aim by
    props: [
      { kind: "wall", path: [[29, 100], [30, 205], [31, 262], [29, 308], [27, 346]], h: 1.2, gaps: [[95, 103]], seed: 7 },
      { kind: "gatepost", at: [30, 199], yaw: 0, gap: 8 * YD },
      { kind: "post", at: [0, 239], h: 7.5, r: 0.2 },
      { kind: "tuft", at: [31, 150], r: 4, n: 22, seed: 2 },
      { kind: "tuft", at: [31, 240], r: 4, n: 22, seed: 3 },
      { kind: "bench", at: [-7, 5], yaw: Math.PI / 2 },
      { kind: "sign", at: [6, 4], yaw: -0.3 },
    ],
    // gorse on the left of the climb, the right of the far face and the left of the green: a ball in it is unplayable.
    // Behind the green the cliff: out of bounds
    areas: [
      { kind: "gorse", poly: [[-28, 160], [-34, 168], [-38, 184], [-34, 202], [-28, 198], [-26, 178]] },
      { kind: "gorse", poly: [[28, 262], [35, 268], [37, 284], [32, 298], [26, 290], [25, 274]] },
      { kind: "gorse", poly: [[-42, 366], [-34, 362], [-32, 376], [-36, 392], [-44, 386]] },
      { kind: "fescue", poly: [[34, 150], [78, 150], [78, 405], [34, 405]] },
      { kind: "oob", poly: [[-70, 407], [90, 407], [90, 440], [-70, 440]], stakes: [[-45, 407], [-30, 407], [-15, 407], [0, 407], [15, 407], [30, 407], [45, 407]] },
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
/**
 * Is a point in a lake? surfaceAt asks this for every step of every ball (and the tests ask it for every cell of a hole), and a
 * lake's ring has a point every 2.5 m: so the ring is sorted once into a coarse grid, a cell known to be wholly in or wholly out
 * answers at once, and only the cells the shore passes through test the ring.
 */
const HIT_CELL = 6;
const lakeHitCache = new WeakMap<Lake, (x: number, z: number) => boolean>();
const lakeHit = (l: Lake) => {
  let f = lakeHitCache.get(l);
  if (f) return f;
  const ring = lakeOf(l);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) [x0, x1, z0, z1] = [Math.min(x0, x), Math.max(x1, x), Math.min(z0, z), Math.max(z1, z)];
  const nx = Math.ceil((x1 - x0) / HIT_CELL) + 1, nz = Math.ceil((z1 - z0) / HIT_CELL) + 1;
  // 0 out, 1 in, 2 the shore passes through: found by the ring's own points and the cells between them
  const kind = new Uint8Array(nx * nz).fill(3);
  const mark = (i: number, j: number) => { if (i >= 0 && j >= 0 && i < nx && j < nz) kind[j * nx + i] = 2; };
  for (let k = 0; k < ring.length; k++) {
    const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (HIT_CELL / 2)));
    for (let q = 0; q <= n; q++) {
      const fx = (ax + ((bx - ax) * q) / n - x0) / HIT_CELL, fz = (az + ((bz - az) * q) / n - z0) / HIT_CELL;
      for (const di of [-1, 0, 1]) for (const dj of [-1, 0, 1]) mark(Math.floor(fx) + di, Math.floor(fz) + dj);
    }
  }
  const poly = (x: number, z: number) => inPoly(ring, x, z);
  f = (x, z) => {
    const i = Math.floor((x - x0) / HIT_CELL), j = Math.floor((z - z0) / HIT_CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const k = kind[j * nx + i];
    if (k === 2) return poly(x, z);
    // (a cell the shore does not touch is all in or all out: its first visit decides)
    if (k === 3) {
      const cx = x0 + (i + 0.5) * HIT_CELL, cz = z0 + (j + 0.5) * HIT_CELL;
      kind[j * nx + i] = poly(cx, cz) ? 1 : 0;
      return kind[j * nx + i] === 1;
    }
    return k === 1;
  };
  lakeHitCache.set(l, f);
  return f;
};
const waterHit = (w: Water, x: number, z: number) => (isCreek(w) ? creekSd(polyOf(w), x, z) < 0 : isLake(w) ? lakeHit(w)(x, z) : blobHit(w, x, z));
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
  const bridged = !!def.props && def.props.some((p) => p.kind === "bridge");
  const surfaceAt = (x: number, z: number): Surface => {
    // a bridge's deck is dry: a ball that comes down on it rolls on it (solids.ts `withDecks` lifts the ground to the deck)
    if (bridged && onDeck(def.props, x, z)) return "fairway";
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
