import { speedOf, type Car } from "../night/car";
import type { Road } from "../night/road";
import { curvatureAt } from "../night/road";
import { N_IN } from "./net";

// What a learner sees: nine numbers, each scaled to about -1..1. Where it is
// (across the road, the angle of its nose to the road), how it moves (speed,
// slide, yaw), and the road's bend ahead: the signed curvature 20, 50 and 100
// metres on, and the sharpest bend anywhere in the next 40 to 160 metres (how
// hard the braking will have to be). Nothing here is a plan or a racing line:
// it is the road's own shape, read off the same arrays the renderer draws.

/** metres ahead the signed curvature is read at */
export const LOOK_M = [20, 50, 100];
/** a bend of this radius (m) reads as 1 */
const BEND_R = 90;
const BEND_K = BEND_R;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function sense(c: Car, road: Road, out: Float64Array): Float64Array {
  const s = c.s;
  out[0] = speedOf(c) / 45 - 0.5;
  out[1] = clamp(c.lat / road.half, -1.4, 1.4);
  out[2] = clamp(c.psi * 2.5, -2, 2);
  out[3] = clamp(c.slip * 3, -2, 2);
  out[4] = clamp(curvatureAt(road, s + LOOK_M[0]) * BEND_K, -1.5, 1.5);
  out[5] = clamp(curvatureAt(road, s + LOOK_M[1]) * BEND_K, -1.5, 1.5);
  out[6] = clamp(curvatureAt(road, s + LOOK_M[2]) * BEND_K, -1.5, 1.5);
  out[7] = clamp(c.r * 1.5, -2, 2);
  let worst = 0;
  for (let d = 40; d <= 160; d += 20) {
    const k = Math.abs(curvatureAt(road, s + d));
    if (k > worst) worst = k;
  }
  out[8] = clamp(worst * BEND_K, 0, 1.5);
  return out;
}

export const newSenses = () => new Float64Array(N_IN);
