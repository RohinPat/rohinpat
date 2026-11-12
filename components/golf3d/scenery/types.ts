// The backdrop of a hole: what lies beyond the trees. A scene is a plain record (scenes.ts); the modules next to this
// one turn it into heights, colours, rings of far mountains, a sea and rock walls. Course metres throughout: x right,
// z downrange, tee at (0, 0), y up; bearings are degrees from downrange (0 = +z), positive toward +x (screen right).

export type P = [number, number];
export type Tier = "high" | "low" | "soft";
export type RGB = [number, number, number];

/** Sky, haze and fog for one hole. Everything is overwritten on every hole, merged over DEFAULT_SKIN. */
export type Skin = {
  /** the dome's gradient; the haze also colours the background and the fog */
  skyTop?: string;
  skyLow?: string;
  haze?: string;
  fogNear?: number;
  fogFar?: number;
  /** the colour of the sun's glow in the sky */
  glow?: string;
  /** towards the sun, in the course's frame: drives only the sky's glow and the sea's glitter, never the light */
  skySun?: [number, number, number];
};

export type SectorShape = "rolling" | "jagged" | "mesa" | "cone" | "flat";
export type Sector = {
  /** bearings in degrees, from < to (may run past 180) */
  from: number;
  to: number;
  /** degrees blended in and out at the edges, default 8 */
  feather?: number;
  shape: SectorShape;
  /** least and greatest height above the layer's base, m */
  h: [number, number];
  seed?: number;
  /** replaces the layer's colour here */
  color?: string;
  /** 0 to 1: the share of the height above which a peak is white */
  snow?: number;
};
export type RingLayer = {
  /** 2300 to 3900 m (the sky dome is 5000) */
  radius: number;
  /** already mixed toward the haze by the author */
  color: string;
  sectors: Sector[];
  /** the height outside every sector, m above the rings' base (default 0) */
  floor?: number;
  /** a V cut through the layer: depth 0 to 1 */
  notch?: { bearing: number; half: number; depth: number };
  /** kept on the cheapest tier (exactly one layer per record) */
  soft?: boolean;
};

export type Palette = {
  /** the colour of plain backdrop ground, and the colour `reach` metres above the hole's own ground */
  base: string;
  high: string;
  reach?: number;
  /** metres beyond the playing area where it fades in, default [30, 90] */
  ramp?: [number, number];
  /** phase 3: blotches of a second colour over the ground (gold aspen, willow): the share of ground they cover, their size in m */
  patches?: { color: string; share: number; scale?: number; seed?: number };
  /** the ground between the rough and the hills is painted in `base` instead of woodland green, so a hole whose trees are cleared has no dark band (dune country) */
  paintOut?: boolean;
};

export type HillsSpec = {
  base: number;
  amp: number;
  reach?: number;
  /** phase 2 (fall.ts): the land past the green falls away toward `bearing` (deg), `drop` m over [from, to] m past the rough */
  fall?: { bearing: number; from: number; to: number; drop: number };
  /** phase 2 (ridged.ts): dune ridges, `amp` m, `freq` per m; inside `window` (deg about a bearing) the ridges are scaled by `k` */
  ridged?: { amp: number; freq?: number; seed?: number; window?: { bearing: number; half: number; k: number } };
};

export type CoastSpec = {
  /** the lip, in order, running past the hole at both ends */
  line: P[];
  /** the side of the direction of travel that is water */
  sea: "left" | "right";
  /** the water's level, m over the tee */
  seaY: number;
  /** the sea bed this far below the water past the lip */
  deep: number;
  /** the land falls this much (m) over `reach` m toward the lip, so the sea shows over it from a low eye */
  slope?: { drop: number; reach: number };
  /** the lip stays this far (m) from the rough, water and sand */
  keepOut: number;
  tones: { shallow: string; mid: string; deep: string; foam: string };
  glitter?: number;
  /** the steep ground at the lip is painted in these bands of rock, darker at the water */
  cliff?: { rock: string[]; foot: string };
  /** phase 2 (ocean.ts): 0 to 1, sand bars showing through shallow water (tidal flats) */
  sandBars?: number;
};

/** phase 2 (props.ts): things standing in the backdrop, always outside the gate */
export type PropsSpec = {
  /** sea stacks off a coast: how many, placed on the sea side between sd[0] and sd[1] m from the lip */
  stacks?: { count: number; seed: number; sd?: [number, number]; height?: [number, number] };
  /** one lighthouse: at a point (course m), or found on the coast near a bearing from the green */
  lighthouse?: { at?: P; bearing?: number; distance?: number };
};

export type WallSpec = {
  /** along the hole's line, or an arc behind the green */
  follow: "line" | "beyond";
  side?: "left" | "right";
  /** m from the line (line) or from the end of the hole (beyond) */
  offset: number;
  from?: number;
  to?: number;
  halfWidth?: number;
  curve?: number;
  /** m above the local ground */
  height: number;
  rows?: number;
  rock: string[];
  cap: string;
  foot: string;
  capDepth?: number;
  seed?: number;
};

/** phase 3 (waterfall.ts): a fall down one of the scene's walls into a pool of its own at the foot */
export type WaterfallSpec = {
  /** which of the scene's walls it comes down (index into `walls`) */
  wall: number;
  /** where along that wall, 0 to 1 */
  at: number;
  /** m wide at the lip and at the foot */
  width: [number, number];
  /** the pool at the foot: its radius, m */
  pool: number;
  /** the water: its body and its froth (hex) */
  tones?: { water: string; froth: string; pool: string };
};

/** phase 3 (mist.ts): low banks of mist lying round the hole beyond the trees, in rings at a few distances */
export type MistSpec = {
  color: string;
  /** each ring: its distance from the middle of the hole, how high it stands above the hole's ground, its strength 0 to 1 */
  layers: { radius: number; top: number; alpha: number }[];
  seed?: number;
};

export type OpeningSpec =
  | { kind: "side"; side: "left" | "right"; from?: number; to?: number; /** the share of trees kept */ keep: number }
  | { kind: "beyond"; halfWidth: number; depth: number; keep: number };

export type SceneryRecord = {
  id: string;
  skin?: Skin;
  hills?: HillsSpec;
  palette?: Palette;
  coast?: CoastSpec;
  walls?: WallSpec[];
  rings?: RingLayer[];
  ringY0?: number;
  openings?: OpeningSpec[];
  props?: PropsSpec;
  waterfall?: WaterfallSpec;
  mist?: MistSpec;
};
