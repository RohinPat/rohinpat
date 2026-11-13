import type { SceneryRecord } from "./types";

// Phase 3: hole 2's backdrop (plan.md 3.11 and the world map, section 5). Short Straw heads north, off an escarpment to a green on a
// peninsula in the tarn. Behind the tarn stands a cirque of granite with a waterfall coming down it into the tarn, the snow range above it and a lone peak in line with the green; the hills on the right lead toward the red
// canyon, the valley lies behind the tee. Gold aspen shows in patches on the slopes. Do not import from scenes.ts.

const GRANITE = ["#d9dcd8", "#bdc2c2", "#a3a9ad", "#848c93"];

export const HOLE2: SceneryRecord | null = {
  id: "short-straw",
  skin: { skyTop: "#4a8fd9", skyLow: "#bfdcf0", haze: "#dce9f1", glow: "#f6f8ff" },
  hills: { base: 10, amp: 20, reach: 110 },
  palette: { base: "#5c9660", high: "#b9bd9e", reach: 40, patches: { color: "#a8993f", share: 0.22, scale: 70, seed: 6 } },
  walls: [
    // the cirque's back wall, close behind the tarn: the waterfall comes down it into the tarn's far corner
    { follow: "beyond", offset: 30, halfWidth: 250, curve: 0, height: 75, rows: 8, rock: GRANITE, cap: "#9aa493", foot: "#aab0a2", capDepth: 70, seed: 21, keep: 0 },
    // its shoulders, left and right, closing the basin
    { follow: "line", side: "left", offset: 175, from: 0.5, to: 1, height: 50, rows: 6, rock: GRANITE, cap: "#9aa493", foot: "#aab0a2", capDepth: 60, seed: 22 },
    { follow: "line", side: "right", offset: 175, from: 0.5, to: 1, height: 50, rows: 6, rock: GRANITE, cap: "#9aa493", foot: "#aab0a2", capDepth: 60, seed: 23 },
  ],
  waterfall: { wall: 0, at: 0.41, width: [9, 14], pool: 13 },
  mist: { color: "#eaf3f5", layers: [{ radius: 170, top: 8, alpha: 0.4 }, { radius: 260, top: 16, alpha: 0.35 }], seed: 3 },
  rings: [
    {
      radius: 2400,
      color: "#7f9fa3",
      sectors: [
        { from: -180, to: 180, feather: 0, shape: "rolling", h: [240, 310], seed: 21 },
        // the valley behind the tee
        { from: 120, to: 240, shape: "rolling", h: [100, 160], seed: 22 },
        // the hills toward the canyon
        { from: 62, to: 112, shape: "mesa", h: [250, 320], seed: 23, color: "#b99a84" },
      ],
    },
    {
      radius: 2950,
      color: "#9db9c3",
      // the snow range, and the lone peak in line with the green; this layer is the one kept on the cheapest tier
      soft: true,
      sectors: [
        { from: -125, to: 125, shape: "jagged", h: [430, 600], seed: 24, snow: 0.72 },
        { from: -12, to: 12, shape: "cone", h: [10, 820], seed: 26, snow: 0.68 },
      ],
    },
    {
      radius: 3500,
      color: "#bcd0d9",
      sectors: [
        { from: -135, to: 115, shape: "jagged", h: [640, 880], seed: 25, snow: 0.8 },
      ],
    },
  ],
  openings: [{ kind: "beyond", halfWidth: 130, depth: 190, keep: 0.06 }],
};
