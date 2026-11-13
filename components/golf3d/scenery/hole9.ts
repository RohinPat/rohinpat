import { BRINK_9 } from "@/components/offhours/golf/coast9";
import type { P, SceneryRecord } from "./types";
import { COAST_ROCK } from "./rock";

// Hole 9, Homeward: the finale (plan.md 3.12 and the world map, section 5). The hole runs north along the sea cliffs with
// the sea on the left, and a cove cut into the cliffs across the line: the cove, the cliff walls round it and the sea
// beyond it are the in-play `cliff` feature and its water (course.ts), whose brink is the same line as this record's coast
// (coast9.ts), so the cliffs you play over and the coast behind them are one. The lighthouse stands on the headland past
// the green, the clubhouse on the rise behind it, and the sun is low over the sea. Do not import from scenes.ts.

const YD = 0.9144;
const m = (p: P): P => [p[0] * YD, p[1] * YD];

/** the coast in metres: the cliff's brink, run out past it at both ends (south along the cliff, east along the cape's north shore) */
const LINE: P[] = [[-118, -520], ...BRINK_9, [60, 524], [150, 515], [300, 490], [500, 440]].map((p) => m(p as P));

export const HOLE9: SceneryRecord | null = {
  id: "homeward",
  skin: { skyTop: "#6f6fa6", skyLow: "#f3b27a", haze: "#efc0a0", glow: "#ffd9a0", skySun: [-0.55, 0.12, 0.83] },
  // (the land does not ease down toward the lip: the cliff in play is the lip, at the ground's own height)
  hills: { base: 2, amp: 7, reach: 150 },
  palette: { base: "#6a9a48", high: "#9bb05a", ramp: [30, 110] },
  // the tee stands 34 m over the sea (HoleDef.ground.baseY)
  ringY0: -34,
  coast: {
    sea: "left",
    seaY: -34,
    deep: 8,
    // the cove's water is the sea: the coast comes right up to the cliff foot in play
    keepOut: 0,
    tones: { shallow: "#6fc1c0", mid: "#3f95a8", deep: "#1f5f86", foam: "#f4fbfb" },
    glitter: 0.8,
    cliff: { rock: COAST_ROCK, foot: "#6f6656" },
    line: LINE,
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
  props: {
    stacks: { count: 7, seed: 9, sd: [30, 150], height: [24, 46] },
    // on the headland past the green (about 135 m on, a little left of the line of the flag) ...
    lighthouse: { bearing: -8, distance: 135 },
    // ... and the clubhouse on the rise behind the green, its veranda facing back down the hole
    clubhouse: { at: m([-30, 462]), rot: 0 },
  },
};
