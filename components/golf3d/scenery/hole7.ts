import type { SceneryRecord } from "./types";
import { COAST_ROCK } from "./rock";

// Phase 2: hole 7's backdrop (plan.md 3.10 and the world map, section 5). The Ridge heads south down a narrow spine of
// the peninsula: the open sea lies ahead and to the right behind cliffs, the clubhouse headland behind the tee. Long
// Water, on the left, is only a pale band on the far rings (one coast per record).
// Do not import from scenes.ts (it imports this file).

export const HOLE7: SceneryRecord | null = {
  id: "ridge",
  skin: { skyTop: "#4f93d2", skyLow: "#bfe0ee", haze: "#d8eaee", glow: "#fff1d0", fogFar: 3000, skySun: [0.25, 0.3, 0.92] },
  hills: { base: 2, amp: 9, reach: 150, fall: { bearing: 10, from: 30, to: 130, drop: 24 } },
  palette: { base: "#5f9244", high: "#a9bb6a", ramp: [30, 110] },
  ringY0: -24,
  coast: {
    sea: "left",
    seaY: -24,
    deep: 8,
    keepOut: 70,
    tones: { shallow: "#76cdc8", mid: "#3f9ab0", deep: "#1f6489", foam: "#f4fbfb" },
    glitter: 0.6,
    cliff: { rock: COAST_ROCK, foot: "#6f6656" },
    slope: { drop: 14, reach: 140 },
    line: [[-1400, 505], [-500, 500], [-100, 495], [80, 485], [140, 450], [155, 370], [160, 150], [165, -100], [175, -400]],
  },
  rings: [
    {
      radius: 2400,
      color: "#8fb0a4",
      soft: true,
      floor: -2,
      sectors: [
        // the clubhouse headland behind the tee
        { from: 120, to: 240, shape: "rolling", h: [90, 160], seed: 71 },
        // the far shore of Long Water, low
        { from: -120, to: -45, shape: "rolling", h: [12, 38], seed: 72 },
        // the bay itself, as a pale band
        { from: -75, to: -55, shape: "flat", h: [-3, -3], color: "#a7cfd8" },
      ],
    },
    {
      radius: 3200,
      color: "#b4cdd0",
      floor: -2,
      sectors: [
        { from: 110, to: 250, shape: "rolling", h: [150, 250], seed: 73 },
        { from: -110, to: -40, shape: "rolling", h: [40, 90], seed: 74 },
      ],
    },
  ],
  openings: [
    { kind: "beyond", halfWidth: 140, depth: 260, keep: 0 },
    { kind: "side", side: "right", from: 0.3, to: 1, keep: 0.1 },
  ],
};
