import type { SceneryRecord } from "./types";

// Hole 1's backdrop. The green lies 6.8 degrees right of the line from the tee (the fairway turns gently right), so the
// Door, the gap in the foothills with the lone snow peak in it, is cut at that bearing: from the tee the peak stands
// behind the green, between the two gateposts. (Do not import from scenes.ts: it imports this file.)
/** degrees from downrange to the green, from the tee */
export const DOOR = 7;

/** Open Door: out of the tee, a gap in the foothills with a lone snow peak in it; the title's 360 degrees */
export const HOLE1: SceneryRecord = {
  id: "open-door",
  skin: { skyTop: "#5a9ad6", skyLow: "#b4d6ee", haze: "#d6e6ea" },
  palette: { base: "#4f8a3f", high: "#a2b86a" },
  rings: [
    {
      radius: 2400,
      color: "#7fa6a3",
      notch: { bearing: DOOR, half: 12, depth: 1 },
      sectors: [
        { from: -180, to: 180, feather: 0, shape: "rolling", h: [250, 330], seed: 1 },
        { from: 160, to: 200, shape: "flat", h: [-3, -3], color: "#a7cfd8" },
      ],
    },
    {
      radius: 2900,
      color: "#9bbcc0",
      soft: true,
      notch: { bearing: DOOR, half: 14, depth: 0.6 },
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
        { from: DOOR - 9, to: DOOR + 9, shape: "cone", h: [10, 760], seed: 6, snow: 0.7 },
      ],
    },
    {
      radius: 3800,
      color: "#cfe0e3",
      sectors: [{ from: DOOR - 8, to: DOOR + 8, shape: "flat", h: [30, 30], color: "#a7cfd8" }],
    },
  ],
  openings: [{ kind: "beyond", halfWidth: 45, depth: 340, keep: 0.15 }],
};
