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
};

export type HillsSpec = { base: number; amp: number; reach?: number };

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
};
