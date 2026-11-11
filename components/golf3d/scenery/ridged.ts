import type { BuiltHole } from "@/components/offhours/golf/course";
import { hash2, lerp, smooth, wrapDeg } from "./geo";
import { ringCentre } from "./rings";
import type { HillsSpec } from "./types";

// Phase 2, hole 5: dune ridges in the backdrop (HillsSpec.ridged), lowered inside a window toward the sea. Returns the
// height to add at a point `m` metres past the rough. height.ts multiplies it by a gate that is 0 inside 30 m.

/** smooth value noise on a lattice, 0 to 1 */
function vnoise(x: number, z: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** 1 - |2n - 1|: a crease line along every contour of n at one half, so the noise becomes ridges */
const ridge = (n: number) => 1 - Math.abs(2 * n - 1);

/** how much of the ridges a bearing keeps: `k` inside the window, easing back to 1 over its outer third */
export function ridgedWindow(hole: BuiltHole, H: HillsSpec, x: number, z: number): number {
  const w = H.ridged?.window;
  if (!w) return 1;
  const [cx, cz] = ringCentre(hole);
  const d = Math.abs(wrapDeg((Math.atan2(x - cx, z - cz) * 180) / Math.PI - w.bearing));
  return lerp(w.k, 1, smooth(w.half * 0.65, w.half, d));
}

export function ridgedLift(hole: BuiltHole, H: HillsSpec, x: number, z: number, m: number): number {
  const R = H.ridged;
  if (!R || m <= 0) return 0;
  const f = R.freq ?? 0.02, seed = R.seed ?? 5;
  // the dunes run as long crests: the field is stretched along one direction, with a second finer pass on top
  const u = (x * 0.94 + z * 0.34) * f, v = (-x * 0.34 + z * 0.94) * f * 1.7;
  const r = 0.72 * ridge(vnoise(u, v, seed)) + 0.28 * ridge(vnoise(u * 2.3 + 7, v * 2.3 + 3, seed + 1));
  return R.amp * r * r * ridgedWindow(hole, H, x, z);
}
