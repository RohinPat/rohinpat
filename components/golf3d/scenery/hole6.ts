import type { SceneryRecord } from "./types";

// Phase 2: hole 6's backdrop (plan.md 3.10 and the world map, section 5): golden hour. The hole heads west and bends
// left (south); on the left lies the estuary and the head of Long Water, a shallow basin with tidal flats; ahead, over
// the peninsula's neck, the low sun; to the right, the peninsula and dunes. Wave 2: the tee stands 22 m over the flats,
// the arm of the tide that crosses the line is the hole's own water (a Lake), and it opens into this estuary, so the
// coast lies on the arm's left end (keepOut 0) and the sea stands just over the arm's surface (-20.65 m under the tee), so it covers the arm's open end. Do not import
// from scenes.ts (it imports this file).

export const HOLE6: SceneryRecord | null = {
  id: "last-light",
  skin: { skyTop: "#6b7db4", skyLow: "#f0c98a", haze: "#e8d4b0", glow: "#ffd08a", skySun: [-0.42, 0.09, 0.9] },
  hills: { base: 2, amp: 7, reach: 150 },
  palette: { base: "#8d9a50", high: "#b9ac62", ramp: [30, 110] },
  ringY0: -21,
  coast: {
    sea: "left",
    seaY: -20.65,
    deep: 6,
    keepOut: 0,
    tones: { shallow: "#7fb9ae", mid: "#68a4b0", deep: "#6a7fae", foam: "#fff0d4" },
    glitter: 0.9,
    sandBars: 0.8,
    slope: { drop: 12, reach: 220 },
    line: [[-192, -250], [-184, -190], [-196, -130], [-186, -70], [-198, -10], [-184, 40], [-190, 85], [-174, 125], [-182, 160], [-166, 195], [-176, 240], [-168, 285], [-181, 330], [-176, 380], [-186, 420], [-168, 465], [-150, 520], [-120, 600], [-90, 700], [-40, 800], [20, 900]],
  },
  rings: [
    {
      radius: 2500,
      color: "#c9a888",
      soft: true,
      floor: -3,
      sectors: [
        { from: -30, to: 180, feather: 14, shape: "rolling", h: [14, 60], seed: 21 },
        { from: 40, to: 180, feather: 10, shape: "rolling", h: [30, 90], seed: 22, color: "#bf9f80" },
      ],
    },
    { radius: 3300, color: "#d8bc9c", floor: -3, sectors: [{ from: -50, to: 170, feather: 12, shape: "rolling", h: [30, 110], seed: 23 }] },
  ],
  openings: [
    { kind: "side", side: "left", from: 0.1, to: 1, keep: 0.1 },
    { kind: "beyond", halfWidth: 70, depth: 300, keep: 0.2 },
  ],
  props: { lighthouse: { at: [-70, 700] } },
};
