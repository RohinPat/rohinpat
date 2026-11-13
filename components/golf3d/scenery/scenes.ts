import type { SceneryRecord, WallSpec } from "./types";
import { HOLE1 } from "./hole1";
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
