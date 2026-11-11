import type { BuiltHole } from "@/components/offhours/golf/course";
import { smooth } from "./geo";
import type { HillsSpec } from "./types";

// Phase 2, hole 7: the land beyond the green falling away toward the sea (HillsSpec.fall). Returns the height to add
// (negative to fall) at a point `m` metres past the rough. height.ts multiplies it by a gate that is 0 inside 30 m.
// The fall is strongest straight on toward `bearing` from the end of the hole and fades to nothing at the sides, so a
// ridge is left standing along both flanks while the land ahead drops away.

export function fallLift(hole: BuiltHole, H: HillsSpec, x: number, z: number, m: number): number {
  const f = H.fall;
  if (!f) return 0;
  const along = smooth(f.from, f.to, m);
  if (along <= 0) return 0;
  const end = hole.line[hole.line.length - 1];
  const dx = x - end[0], dz = z - end[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  const a = (f.bearing * Math.PI) / 180;
  const cos = (dx * Math.sin(a) + dz * Math.cos(a)) / len;
  return -f.drop * along * smooth(0.1, 0.6, cos);
}
