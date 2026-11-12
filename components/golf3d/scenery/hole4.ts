import type { SceneryRecord } from "./types";

// Phase 3: hole 4's backdrop (plan.md 3.11 and the world map, section 5). Reed Creek heads west across a meadow valley on a
// morning with low mist lying beyond the trees. The map has the dunes to the south (the left, facing west), the valley
// running up to the tarn and the snow range to the north (the right), the red canyon's mouth straight north of the tee and
// the mesas to the south-east, behind the tee on the left. Soft green and gold; the creek in play is not touched.
// Do not import from scenes.ts.

export const HOLE4: SceneryRecord | null = {
  id: "reed-creek",
  skin: { skyTop: "#68a7de", skyLow: "#dbe8e6", haze: "#ece6d0", glow: "#fff1c8" },
  hills: { base: 3, amp: 10, reach: 150, ridged: { amp: 15, freq: 0.014, seed: 41, window: { bearing: 80, half: 100, k: 0.12 } } },
  palette: { base: "#90ae4a", high: "#cdbf6c", reach: 26, patches: { color: "#d7c653", share: 0.3, scale: 90, seed: 8 } },
  mist: { color: "#f5eed6", seed: 4, layers: [{ radius: 620, top: 100, alpha: 0.55 }, { radius: 900, top: 140, alpha: 0.5 }, { radius: 1250, top: 190, alpha: 0.45 }] },
  rings: [
    {
      radius: 2500,
      color: "#9db9a2",
      soft: true,
      sectors: [
        { from: -180, to: 180, feather: 0, shape: "rolling", h: [330, 400], seed: 41 },
        // the dunes' gold, low, to the south
        { from: -105, to: -45, shape: "rolling", h: [320, 360], seed: 42, color: "#c3bb8c" },
        // the mesas, south-east, behind the tee
        { from: -178, to: -120, shape: "mesa", h: [340, 420], seed: 43, color: "#c4a58b" },
        // the red canyon's mouth, north, abeam of the tee
        { from: 75, to: 108, shape: "mesa", h: [340, 420], seed: 44, color: "#c28b6c" },
      ],
    },
    {
      radius: 3050,
      color: "#b2c9c6",
      sectors: [
        { from: 30, to: 165, shape: "jagged", h: [480, 650], seed: 45, snow: 0.7 },
        { from: -170, to: -110, shape: "mesa", h: [440, 540], seed: 46, color: "#cdb9a9" },
      ],
    },
    {
      radius: 3600,
      color: "#cddcdc",
      sectors: [
        { from: 50, to: 160, shape: "jagged", h: [660, 800], seed: 47, snow: 0.8 },
        // Door peak, far to the north-east
        { from: 128, to: 142, shape: "cone", h: [10, 860], seed: 48, snow: 0.7 },
      ],
    },
  ],
  openings: [
    { kind: "side", side: "left", from: 0.25, to: 1, keep: 0.35 },
    { kind: "side", side: "right", from: 0.15, to: 1, keep: 0.45 },
    { kind: "beyond", halfWidth: 90, depth: 260, keep: 0.2 },
  ],
};
