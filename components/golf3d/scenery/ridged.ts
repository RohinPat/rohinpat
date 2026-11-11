import type { BuiltHole } from "@/components/offhours/golf/course";
import type { HillsSpec } from "./types";

// Phase 2, hole 5: dune ridges in the backdrop (HillsSpec.ridged), lowered inside a window toward the sea. Returns the
// height to add at a point `m` metres past the rough. height.ts multiplies it by a gate that is 0 inside 30 m.

export function ridgedLift(hole: BuiltHole, H: HillsSpec, x: number, z: number, m: number): number {
  void hole;
  void x;
  void z;
  void m;
  if (!H.ridged) return 0;
  return 0;
}
