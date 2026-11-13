import type { SceneryRecord, WallSpec } from "./types";
import { HOLE2 } from "./hole2";
import { HOLE4 } from "./hole4";
import { HOLE5 } from "./hole5";
import { HOLE6 } from "./hole6";
import { HOLE7 } from "./hole7";
import { HOLE8 } from "./hole8";
import { HOLE9 } from "./hole9";
import { RANGE } from "./range";

// One record per hole that has a backdrop. A hole without one is drawn exactly as it always was. The nine sit on one
// stretch of coast (see the plan's map), so what lies beyond one hole is the same country seen from another.

export const LEGACY: SceneryRecord = { id: "legacy" };

import { CANYON, COAST_ROCK } from "./rock";

/** Open Door: out of the tee, a gap in the foothills with a lone snow peak in it; the title's 360 degrees */
const HOLE1: SceneryRecord = {
  id: "open-door",
  skin: { skyTop: "#5a9ad6", skyLow: "#b4d6ee", haze: "#d6e6ea" },
  palette: { base: "#4f8a3f", high: "#a2b86a" },
  rings: [
    {
      radius: 2400,
      color: "#7fa6a3",
      notch: { bearing: 0, half: 12, depth: 1 },
      sectors: [
        { from: -180, to: 180, feather: 0, shape: "rolling", h: [250, 330], seed: 1 },
        { from: 160, to: 200, shape: "flat", h: [-3, -3], color: "#a7cfd8" },
      ],
    },
    {
      radius: 2900,
      color: "#9bbcc0",
      soft: true,
      notch: { bearing: 0, half: 14, depth: 0.6 },
      sectors: [
        { from: -180, to: 180, feather: 0, shape: "rolling", h: [330, 420], seed: 2 },
        { from: -140, to: -10, shape: "jagged", h: [420, 520], seed: 3, snow: 0.8 },
        { from: 20, to: 55, shape: "mesa", h: [260, 300], seed: 4, color: "#b9a79a" },
      ],
    },
    {
      radius: 3400,
      color: "#b6cfd4",
      sectors: [
        { from: -140, to: -10, shape: "jagged", h: [560, 700], seed: 5, snow: 0.8 },
        { from: -9, to: 9, shape: "cone", h: [10, 760], seed: 6, snow: 0.7 },
      ],
    },
    {
      radius: 3800,
      color: "#cfe0e3",
      sectors: [{ from: -8, to: 8, shape: "flat", h: [30, 30], color: "#a7cfd8" }],
    },
  ],
  openings: [{ kind: "beyond", halfWidth: 45, depth: 340, keep: 0.15 }],
};

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

const PHASE2: Record<number, SceneryRecord | null> = { 2: HOLE2, 4: HOLE4, 5: HOLE5, 6: HOLE6, 7: HOLE7, 8: HOLE8, 9: HOLE9, 10: RANGE };
const SCENES: Record<number, SceneryRecord> = { 1: HOLE1, 3: HOLE3 };
for (const [n, r] of Object.entries(PHASE2)) if (r) SCENES[Number(n)] = r;

export function sceneryFor(n: number): SceneryRecord {
  return SCENES[n] ?? LEGACY;
}
export const SCENERY_HOLES = Object.keys(SCENES).map(Number);
