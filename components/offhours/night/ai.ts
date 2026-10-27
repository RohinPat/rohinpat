import { ENGINE_CAL, type NightInput } from "../engineRemote";
import { lockOf, roadSteer, type Car } from "./car";
import type { Road } from "./road";

// The target driver: it follows a racing line at a pace set by the corners. The
// plan is built once from the road: a speed for every point (the fastest the
// tyres allow through the bend there, braked back from the next one), and a
// line (inside through a corner, back to the middle on the straights). The
// driver then steers to the line, and brakes and throttles to the speed. It is
// the same car and the same physics the player has: it is recorded once, and
// that run is both the ghost to chase and the tile's attract mode.

export type Plan = {
  /** the speed the tyres allow at each node (m/s), at pace 1 */
  vmax: Float32Array;
  /** the line, m right of the centre, at each node */
  line: Float32Array;
};

const G = 9.81;
const V_TOP = 68;
/** sideways acceleration the planner trusts the tyres with, m/s^2, and the braking it plans on */
const A_LAT = ENGINE_CAL.car.gripG * G * 0.86;
const A_BRAKE = 8.2;

export function buildPlan(road: Road): Plan {
  const n = road.n;
  const seg = road.segM;
  // how bent the road is around each node: the worst curvature a little ahead and behind
  const bend = new Float32Array(n + 1);
  const back = Math.round(6 / seg);
  const fwd = Math.round(30 / seg);
  for (let i = 0; i <= n; i++) {
    let m = 0;
    for (let j = Math.max(0, i - back); j <= Math.min(n, i + fwd); j++) m = Math.max(m, Math.abs(road.kappa[j]));
    bend[i] = m;
  }
  const vmax = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) vmax[i] = Math.min(V_TOP, Math.sqrt(A_LAT / Math.max(bend[i], 1e-5)));
  // braking: it can only come down so fast
  for (let i = n - 1; i >= 0; i--) {
    const v1 = vmax[i + 1];
    vmax[i] = Math.min(vmax[i], Math.sqrt(v1 * v1 + 2 * A_BRAKE * seg));
  }

  // the line: toward the inside of the corner, with the curvature smoothed over a short stretch
  const line = new Float32Array(n + 1);
  const w = Math.round(36 / seg);
  const reach = road.half - 1.9;
  for (let i = 0; i <= n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n, i + w); j++) {
      sum += road.kappa[j];
      cnt++;
    }
    line[i] = Math.max(-reach, Math.min(reach, (sum / cnt) * 380));
  }
  return { vmax, line };
}

const at = (a: Float32Array, s: number, seg: number) => {
  const u = Math.min(Math.max(s / seg, 0), a.length - 1.001);
  const i = Math.floor(u);
  return a[i] + (a[i + 1] - a[i]) * (u - i);
};

/** The speed the plan allows at `s`, m/s. */
export const planSpeed = (plan: Plan, road: Road, s: number) => at(plan.vmax, s, road.segM);

/**
 * What the driver does this instant: written into `out`. `pace` is the share of
 * the plan's speed it will use (1 = at the limit of the tyres).
 */
export function drive(c: Car, road: Road, plan: Plan, pace: number, out: NightInput): NightInput {
  const v = Math.max(1, Math.hypot(c.u, c.w));
  const seg = road.segM;
  // steer to the line a little ahead, by pointing the direction of travel (not the nose) at it
  const look = Math.max(5, Math.min(26, 0.4 * v));
  const lineAhead = at(plan.line, c.s + look, seg);
  const eLat = lineAhead - c.lat;
  const want = Math.max(-0.3, Math.min(0.3, Math.atan2(eLat, look * 1.6)));
  const travel = c.psi + c.slip;
  const wheel = 0.55 * (want - travel);
  const kap = at(road.kappa, c.s, seg);
  out.steer = Math.max(-1, Math.min(1, (wheel - roadSteer(kap, c.u)) / lockOf(c)));
  // speed: the plan a little ahead, since the brakes take time
  const target = at(plan.vmax, c.s + 0.25 * v, seg) * pace;
  const e = target - v;
  if (e >= 0) {
    out.throttle = Math.max(0.25, Math.min(1, e / 3));
    out.brake = 0;
  } else {
    out.throttle = 0;
    out.brake = Math.min(1, -e / 4);
  }
  out.hand = 0;
  return out;
}
