import type { SceneryRecord } from "./types";
import { HOLE1 } from "./hole1";
import { HOLE2 } from "./hole2";
import { HOLE3 } from "./hole3";
import { HOLE4 } from "./hole4";
import { HOLE5 } from "./hole5";
import { HOLE6 } from "./hole6";
import { HOLE7 } from "./hole7";
import { HOLE8 } from "./hole8";
import { HOLE9 } from "./hole9";
import { RANGE } from "./range";

// One record per hole that has a backdrop. A hole without one is drawn exactly as it always was. The nine sit on one
// stretch of coast (see the plan's map), so what lies beyond one hole is the same country seen from another.

export const LEGACY: SceneryRecord = { id: "legacy" };

const PHASE2: Record<number, SceneryRecord | null> = { 2: HOLE2, 3: HOLE3, 4: HOLE4, 5: HOLE5, 6: HOLE6, 7: HOLE7, 8: HOLE8, 9: HOLE9, 10: RANGE };
const SCENES: Record<number, SceneryRecord> = { 1: HOLE1 };
for (const [n, r] of Object.entries(PHASE2)) if (r) SCENES[Number(n)] = r;

export function sceneryFor(n: number): SceneryRecord {
  return SCENES[n] ?? LEGACY;
}
export const SCENERY_HOLES = Object.keys(SCENES).map(Number);
