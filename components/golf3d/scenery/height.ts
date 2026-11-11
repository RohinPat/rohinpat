import type { BuiltHole } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import { lerp, signedDist, smooth } from "./geo";
import { fallLift } from "./fall";
import { ridgedLift } from "./ridged";
import type { HillsSpec, SceneryRecord } from "./types";

// The drawn ground beyond the trees. Where the ball can be (and 30 m past it) it is exactly the hole's own ground:
// every term added here is multiplied by something that is exactly 0 there, so nothing a scene says can reach play.

/** the first thing past the rough that is not the hole's ground, m */
export const GATE = 30;

/** the hills' noise (the original four terms, unchanged) */
export function legacyNoise(n: number): (x: number, z: number) => number {
  return (x, z) => 0.5 + 0.22 * Math.sin(x * 0.013 + 1.7) * Math.cos(z * 0.011 - 0.4) + 0.18 * Math.sin((x + z) * 0.021 + n) + 0.1 * Math.cos((x - z) * 0.047);
}

export const LEGACY_HILLS: HillsSpec = { base: 5, amp: 26, reach: 150 };

export function makeHeight(hole: BuiltHole, ground: (x: number, z: number) => number, rec: SceneryRecord) {
  const rough = hole.def.rough * YD;
  const noise = legacyNoise(hole.def.n);
  const H = rec.hills ?? LEGACY_HILLS;
  const reach = H.reach ?? 150;
  const coast = rec.coast;
  const beyond = (x: number, z: number) => hole.margin(x, z) - rough;
  /** the height added to the ground at a point m past the rough */
  const liftAt = (m: number, x: number, z: number, groundY: number) => {
    let hills = smooth(GATE, reach, m) * (H.base + H.amp * noise(x, z));
    // phase 2 terms: each module returns a height; the gate is applied here as well, so play is untouched by construction
    if (H.fall || H.ridged) hills += smooth(GATE, 60, m) * (fallLift(hole, H, x, z, m) + ridgedLift(hole, H, x, z, m));
    if (!coast) return hills;
    const sd = signedDist(coast, x, z);
    const gate = smooth(GATE, 60, m);
    // the land eases down toward the lip, so the sea can be seen over it
    const land = coast.slope ? hills - coast.slope.drop * smooth(-coast.slope.reach, 0, sd) ** 2 * gate : hills;
    const k = smooth(0, 1, (sd + 2) / 22) * gate;
    if (k <= 0) return land;
    const target = coast.seaY - coast.deep - groundY;
    return lerp(land, target, k);
  };
  const heightAt = (x: number, z: number) => {
    const y = ground(x, z);
    const m = beyond(x, z);
    if (m < GATE) return y;
    return y + liftAt(m, x, z, y);
  };
  const lift = (x: number, z: number) => {
    const m = beyond(x, z);
    if (m < GATE) return 0;
    return liftAt(m, x, z, ground(x, z));
  };
  return { heightAt, lift, beyond };
}
