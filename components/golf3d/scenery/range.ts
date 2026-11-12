import type { SceneryRecord } from "./types";

// Phase 3: the practice range (hole 10): a calm highland meadow. The skyline is three soft rolling layers all the way
// round, no peaks and nothing that moves, so the distances read against it. Do not import from scenes.ts.

export const RANGE: SceneryRecord | null = {
  id: "range",
  skin: { skyTop: "#5a9fe0", skyLow: "#bfdcf0", haze: "#dce9e6", glow: "#fff2d2" },
  hills: { base: 3, amp: 9, reach: 160 },
  palette: { base: "#7ca24c", high: "#bac47c", reach: 28 },
  rings: [
    { radius: 2400, color: "#7fa596", soft: true, sectors: [{ from: -180, to: 180, feather: 0, shape: "rolling", h: [250, 285], seed: 101 }] },
    { radius: 3100, color: "#9dbcb9", sectors: [{ from: -180, to: 180, feather: 0, shape: "rolling", h: [340, 395], seed: 102 }] },
    { radius: 3700, color: "#bad0d3", sectors: [{ from: -180, to: 180, feather: 0, shape: "rolling", h: [430, 500], seed: 103 }] },
  ],
};
