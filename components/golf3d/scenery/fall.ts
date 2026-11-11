import type { BuiltHole } from "@/components/offhours/golf/course";
import type { HillsSpec } from "./types";

// Phase 2, hole 7: the land beyond the green falling away toward the sea (HillsSpec.fall). Returns the height to add
// (negative to fall) at a point `m` metres past the rough. height.ts multiplies it by a gate that is 0 inside 30 m.

export function fallLift(hole: BuiltHole, H: HillsSpec, x: number, z: number, m: number): number {
  void hole;
  void x;
  void z;
  void m;
  if (!H.fall) return 0;
  return 0;
}
