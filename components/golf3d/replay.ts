import type { BuiltHole } from "@/components/offhours/golf/course";
import { at } from "@/components/offhours/golf/flight";
import type { Replay } from "@/components/offhours/golf/play";
import { terrainOf } from "@/components/offhours/golf/terrain";
import type { View } from "./flyover";

// A great shot played again (play.ts decides which): the camera stands low just
// past and beside where the ball finished, the way a camera by the green would,
// and turns to follow it in from the air to where it stops.

const P: [number, number, number] = [0, 0, 0];

/** where the ball is in the replay, in the hole's frame (heights over the ground it was struck from added to that ground's) */
export function replayBall(r: Replay): [number, number, number] {
  const s = r.shot;
  at(s, Math.min(r.t, s.restT), P);
  return [s.ox + P[0], s.oy + P[1], s.oz + P[2]];
}

export function replayView(hole: BuiltHole, r: Replay, w: number, h: number): View {
  const s = r.shot;
  const G = terrainOf(hole).y;
  const n = s.n - 1;
  const ex = s.ox + s.pts[n * 4 + 1], ez = s.oz + s.pts[n * 4 + 3];
  // along the shot and to its right
  const dl = Math.hypot(ex - s.ox, ez - s.oz) || 1;
  const ux = (ex - s.ox) / dl, uz = (ez - s.oz) / dl;
  const rx = uz, rz = -ux;
  // a long drive is watched from further off, so its last bounces fit
  const back = r.why === "long" ? 16 : 7, side = r.why === "long" ? 12 : 6;
  const cx = ex + ux * back + rx * side, cz = ez + uz * back + rz * side;
  const cy = Math.max(G(cx, cz), G(ex, ez)) + (r.why === "long" ? 3 : 1.5);
  // look at the ball, held a little toward where it ends, so a ball high in the air does not tip the camera over
  const [bx, by, bz] = replayBall(r);
  const k = 0.3;
  const tx = bx + (ex - bx) * k, tz = bz + (ez - bz) * k;
  const ty = Math.min(by + (G(ex, ez) - by) * k, cy + Math.hypot(tx - cx, tz - cz) * 0.6);
  return { x: cx, y: cy, z: cz, tx, ty, tz, F: Math.max(w * 0.9, h * 1.1) * 1.25 };
}
