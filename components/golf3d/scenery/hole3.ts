import type { SceneryRecord, WallSpec } from "./types";
import { CANYON } from "./rock";

// Wave 2: hole 3's backdrop. The Elbow is a red canyon cut into a plateau: the in-play cliffs (features.ts `cliff`, in the
// same four colours, 16 m) are the lowest step of it. Past the rim a shelf of plateau runs back some 40 m, and then the
// canyon's upper wall stands on it, on both sides and behind the green, so what the player sees from the floor is one
// canyon, tier on tier, and not a hole with a cliff beside a hill. The hills lift gently, so the shelf stays level.
// Do not import from scenes.ts.

/** the upper wall, on each side of the line, 85 m out (the in-play rim is at 42 m) */
const UPPER_L: WallSpec = { follow: "line", side: "left", offset: 108, from: 0, to: 1, height: 30, rows: 8, rock: CANYON, cap: "#c98a58", foot: "#d9a173", capDepth: 6, seed: 3 };
const UPPER_R: WallSpec = { follow: "line", side: "right", offset: 108, from: 0, to: 1, height: 28, rows: 8, rock: CANYON, cap: "#c98a58", foot: "#d9a173", capDepth: 6, seed: 5 };
/** the head of the canyon behind the green */
const HEAD: WallSpec = { follow: "beyond", offset: 88, halfWidth: 150, curve: 40, height: 34, rows: 8, rock: CANYON, cap: "#c98a58", foot: "#d9a173", capDepth: 6, seed: 4 };

export const HOLE3: SceneryRecord = {
  id: "elbow",
  skin: { skyTop: "#3f86cf", skyLow: "#a7d3ee", haze: "#e7d9c8" },
  palette: { base: "#b9703f", high: "#d89a62", deep: "#b9703f", reach: 40 },
  hills: { base: 4, amp: 14, reach: 190 },
  walls: [UPPER_L, UPPER_R, HEAD],
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
  // the plateau is bare: a few pines left on it, none beyond the green
  openings: [
    { kind: "side", side: "left", keep: 0.07 },
    { kind: "side", side: "right", keep: 0.07 },
    { kind: "beyond", halfWidth: 140, depth: 250, keep: 0.1 },
  ],
};
