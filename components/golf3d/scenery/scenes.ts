import type { SceneryRecord, WallSpec } from "./types";
import { HOLE1 } from "./hole1";
import { HOLE2 } from "./hole2";
import { HOLE4 } from "./hole4";
import { HOLE5 } from "./hole5";
import { HOLE6 } from "./hole6";
import { HOLE7 } from "./hole7";
import { HOLE8 } from "./hole8";
import { RANGE } from "./range";

// One record per hole that has a backdrop. A hole without one is drawn exactly as it always was. The nine sit on one
// stretch of coast (see the plan's map), so what lies beyond one hole is the same country seen from another.

export const LEGACY: SceneryRecord = { id: "legacy" };

import { CANYON, COAST_ROCK } from "./rock";

const WALL_A: WallSpec = { follow: "line", side: "left", offset: 105, from: 0.1, to: 0.8, height: 48, rows: 8, rock: CANYON, cap: "#c98a58", foot: "#d9a173", capDepth: 60, seed: 3 };
const WALL_B: WallSpec = { follow: "beyond", offset: 130, halfWidth: 170, curve: 30, height: 38, rows: 8, rock: CANYON, cap: "#c98a58", foot: "#d9a173", capDepth: 60, seed: 4 };

/** The Elbow: red country, a canyon wall on the outside of the bend, mesas ahead on the left */
const HOLE3: SceneryRecord = {
  id: "elbow",
  skin: { skyTop: "#3f86cf", skyLow: "#a7d3ee", haze: "#e7d9c8" },
  palette: { base: "#b9703f", high: "#d89a62" },
  hills: { base: 6, amp: 18, reach: 160 },
  walls: [WALL_A, WALL_B],
  rings: [
    {
      radius: 2600,
      color: "#c98f6c",
      soft: true,
      sectors: [
        { from: -180, to: 180, feather: 0, shape: "rolling", h: [160, 230], seed: 7 },
        { from: -65, to: -15, shape: "mesa", h: [240, 300], seed: 8 },
      ],
    },
    {
      radius: 3300,
      color: "#d9b9a5",
      sectors: [
        { from: -100, to: 100, shape: "mesa", h: [380, 460], seed: 9 },
        { from: -50, to: -30, shape: "cone", h: [10, 520], seed: 10 },
      ],
    },
  ],
  openings: [{ kind: "beyond", halfWidth: 60, depth: 250, keep: 0.3 }],
};

/** Homeward: the finale, with the sea on the left and behind the green */
const HOLE9: SceneryRecord = {
  id: "homeward",
  skin: { skyTop: "#6f6fa6", skyLow: "#f3b27a", haze: "#efc0a0", glow: "#ffd9a0", skySun: [-0.55, 0.12, 0.83] },
  hills: { base: 2, amp: 7, reach: 150 },
  palette: { base: "#6a9a48", high: "#9bb05a", ramp: [30, 110] },
  ringY0: -56,
  coast: {
    sea: "left",
    seaY: -56,
    deep: 8,
    keepOut: 90,
    tones: { shallow: "#6fc1c0", mid: "#3f95a8", deep: "#1f5f86", foam: "#f4fbfb" },
    glitter: 0.8,
    cliff: { rock: COAST_ROCK, foot: "#6f6656" },
    slope: { drop: 22, reach: 260 },
    line: [[-210, -150], [-195, -20], [-195, 110], [-134, 112], [-132, 190], [-195, 194], [-200, 290], [-195, 400], [-170, 470], [-110, 520], [-30, 540], [60, 545], [150, 560], [260, 620], [330, 720]],
  },
  rings: [
    {
      radius: 2700,
      color: "#8a6a88",
      soft: true,
      floor: -3,
      sectors: [
        { from: 28, to: 172, shape: "rolling", h: [200, 300], seed: 11 },
        { from: -72, to: -28, shape: "cone", h: [-3, 230], seed: 12, color: "#76607f" },
      ],
    },
    { radius: 3400, color: "#b98c9a", floor: -3, sectors: [{ from: 28, to: 172, shape: "rolling", h: [260, 380], seed: 13 }] },
  ],
  openings: [
    { kind: "side", side: "left", from: 0, to: 1, keep: 0.1 },
    { kind: "beyond", halfWidth: 110, depth: 260, keep: 0.12 },
  ],
  props: { stacks: { count: 7, seed: 9, sd: [30, 150], height: [24, 46] }, lighthouse: { bearing: -48, distance: 450 } },
};

const PHASE2: Record<number, SceneryRecord | null> = { 2: HOLE2, 4: HOLE4, 5: HOLE5, 6: HOLE6, 7: HOLE7, 8: HOLE8, 10: RANGE };
const SCENES: Record<number, SceneryRecord> = { 1: HOLE1, 3: HOLE3, 9: HOLE9 };
for (const [n, r] of Object.entries(PHASE2)) if (r) SCENES[Number(n)] = r;

export function sceneryFor(n: number): SceneryRecord {
  return SCENES[n] ?? LEGACY;
}
export const SCENERY_HOLES = Object.keys(SCENES).map(Number);
