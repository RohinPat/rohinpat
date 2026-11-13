import type { SceneryRecord } from "./types";
import { HOLE1 } from "./hole1";
import { HOLE2 } from "./hole2";
import { HOLE3 } from "./hole3";
import { HOLE4 } from "./hole4";
import { HOLE5 } from "./hole5";
import { HOLE6 } from "./hole6";
import { HOLE7 } from "./hole7";
import { HOLE8 } from "./hole8";
import { RANGE } from "./range";

// One record per hole that has a backdrop. A hole without one is drawn exactly as it always was. The nine sit on one
// stretch of coast (see the plan's map), so what lies beyond one hole is the same country seen from another.

export const LEGACY: SceneryRecord = { id: "legacy" };

import { COAST_ROCK } from "./rock";

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

const PHASE2: Record<number, SceneryRecord | null> = { 2: HOLE2, 3: HOLE3, 4: HOLE4, 5: HOLE5, 6: HOLE6, 7: HOLE7, 8: HOLE8, 10: RANGE };
const SCENES: Record<number, SceneryRecord> = { 1: HOLE1, 9: HOLE9 };
for (const [n, r] of Object.entries(PHASE2)) if (r) SCENES[Number(n)] = r;

export function sceneryFor(n: number): SceneryRecord {
  return SCENES[n] ?? LEGACY;
}
export const SCENERY_HOLES = Object.keys(SCENES).map(Number);
