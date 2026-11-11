import type { SceneryRecord } from "./types";

// Phase 2: hole 5's backdrop (plan.md 3.10 and the world map, section 5). Do not import from scenes.ts (it imports this file).
// The Collar plays south into the dunes. Ahead, past the green, a gap in the dune ridges shows the head of Long Water as
// a thin band of sea; the estuary marsh lies to the right-ahead (the map puts it south-west) and the mesas far to the left.

/** where the sea lies, degrees from downrange */
const SEA = { from: -14, to: 20 };

export const HOLE5: SceneryRecord | null = {
  id: "collar",
  skin: { skyTop: "#4a97dc", skyLow: "#bddff0", haze: "#e4eeea", glow: "#fff1cf" },
  // low rolling sand with dune ridges on top; the ridges fall away inside a window toward the sea
  hills: { base: 1.5, amp: 5, reach: 140, ridged: { amp: 8, freq: 0.02, seed: 5, window: { bearing: (SEA.from + SEA.to) / 2, half: 26, k: 0.2 } } },
  // marram green in the hollows, pale sand on the crests
  palette: { base: "#8e9a55", high: "#dccb97", reach: 11, ramp: [30, 100] },
  rings: [
    {
      radius: 2300,
      color: "#b4b88a",
      sectors: [{ from: 22, to: 78, shape: "rolling", h: [6, 20], seed: 21, color: "#a9b284" }],
    },
    {
      // the kept layer: dune country all round, with the head of Long Water as a gap of sea in it
      radius: 2700,
      color: "#d6cfaa",
      soft: true,
      sectors: [
        { from: -180, to: 180, feather: 0, shape: "rolling", h: [70, 115], seed: 22 },
        { from: SEA.from, to: SEA.to, feather: 5, shape: "flat", h: [62, 62], color: "#8fc6d2" },
      ],
    },
    {
      radius: 3400,
      color: "#cdbeab",
      sectors: [
        { from: -130, to: -55, shape: "mesa", h: [120, 170], seed: 23, color: "#c9ae98" },
        { from: 110, to: 250, shape: "jagged", h: [230, 330], seed: 24, snow: 0.7, color: "#c3d1d6" },
      ],
    },
  ],
  openings: [{ kind: "beyond", halfWidth: 75, depth: 320, keep: 0.05 }],
};
