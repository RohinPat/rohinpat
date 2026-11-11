import type { SceneryRecord } from "./types";

// Phase 2: hole 8's backdrop (plan.md 3.10 and the world map, section 5). Do not import from scenes.ts (it imports this file).
// Long Water: heading north along the east shore of the peninsula, a broad sea loch on the right. The in-play lake sits at
// the rough's edge (x 44..72 m), the bay starts 70 m beyond it. The ridge and the open sea are on the left, the far side
// of the bay is mainland (low hills, then the dunes and the snow range far north), a lighthouse stands on a headland.

export const HOLE8: SceneryRecord | null = {
  id: "long-water",
  skin: { skyTop: "#4f93d8", skyLow: "#bfe0ee", haze: "#d3e7ea" },
  hills: { base: 3, amp: 10, reach: 150 },
  palette: { base: "#7d9a50", high: "#b4b46c" },
  ringY0: -8,
  coast: {
    sea: "right",
    seaY: -8,
    deep: 8,
    keepOut: 70,
    // the peninsula's tip behind the tee, up the east shore, and the bay's head bending east past the green
    line: [[-420, -340], [-120, -330], [60, -290], [125, -190], [135, -60], [132, 120], [138, 260], [146, 350], [152, 430], [172, 530], [235, 612], [360, 660], [700, 676], [1400, 690]],
    tones: { shallow: "#9fd6cf", mid: "#5aa7b5", deep: "#2f6f8f", foam: "#f4fbfb" },
    glitter: 0.4,
    slope: { drop: 16, reach: 220 },
  },
  rings: [
    {
      radius: 2400,
      color: "#82ab94",
      floor: 0,
      sectors: [
        // the mainland across the bay: low hills, dunes in the north-east
        { from: 18, to: 150, shape: "rolling", h: [30, 85], seed: 31 },
        // the open sea beyond the ridge on the left
        { from: -165, to: -62, shape: "flat", h: [-3, -3], color: "#a9d1d8" },
      ],
    },
    {
      radius: 2900,
      color: "#a3c1bf",
      soft: true,
      floor: 0,
      sectors: [
        { from: 24, to: 112, shape: "rolling", h: [70, 130], seed: 32 },
        { from: -60, to: -22, shape: "rolling", h: [40, 90], seed: 33 },
      ],
    },
    {
      radius: 3500,
      color: "#c3d7dc",
      floor: 0,
      sectors: [{ from: -75, to: 95, shape: "jagged", h: [300, 470], seed: 34, snow: 0.7 }],
    },
  ],
  // the right side from the lake onward, so the bay reads from the fairway
  openings: [{ kind: "side", side: "right", from: 0.45, to: 1, keep: 0.1 }],
  props: { lighthouse: { at: [-380, 1180] } },
};
