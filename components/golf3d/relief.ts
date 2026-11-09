import type { BuiltHole } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";

// The ground the 3D course stands on, as the putting pieces (putt3d, puttcam,
// hole3d's green) ask for it: the terrain's (terrain.ts), which the ball plays on
// too, with the green's own height field raised on its pad.

export { PAD } from "@/components/offhours/golf/terrain";

export type Relief = {
  /** the ground's height at a course point, m */
  y: (x: number, z: number) => number;
  /** the same in the green's own coordinates */
  yG: (gx: number, gy: number) => number;
  /** the green's rise above its pad, m (0 off its raised ground) */
  rise: (gx: number, gy: number) => number;
};

export function reliefOf(hole: BuiltHole): Relief {
  const t = terrainOf(hole);
  return { y: t.y, yG: t.yG, rise: t.rise };
}
