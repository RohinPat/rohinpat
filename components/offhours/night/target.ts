import { ENGINE_CAL, type NightInput } from "../engineRemote";
import { buildPlan, drive, type Plan } from "./ai";
import { newCar, stepCar, type Car } from "./car";
import { createRecorder, newPose, timeAt, type Ghost, type Pose } from "./ghost";
import { getRoad, type Road } from "./road";
import { TRACKS, type TrackId } from "./tracks";

// The target driver's run, recorded once from the AI at the pace the road
// allows it. It is the ghost to chase, the tile's attract mode, and the yardstick
// for the clock: the time on offer at the start and at each checkpoint is a
// share of what this driver needs for the leg, so a driver as good as the
// target always has a little in hand, and a ragged one runs out.

const RUN = ENGINE_CAL.run;
const STEP = 1 / 120;
/** how long the car coasts on after the finish, s (so the ghost does not vanish at the line) */
const COAST_S = 3;

export type Target = {
  road: Road;
  plan: Plan;
  ghost: Ghost;
  /** seconds on the clock at the start, and added at each checkpoint (the last gives none) */
  startS: number;
  bonusS: number[];
  /** the target's time at each checkpoint, s */
  legT: number[];
};

export function poseOf(c: Car, out: Pose): Pose {
  out.s = c.s;
  out.lat = c.lat;
  out.psi = c.psi;
  out.speed = Math.hypot(c.u, c.w);
  out.slip = c.slip;
  out.skid = c.skid;
  out.brake = c.brake;
  return out;
}

/** Drive the AI around the road and record it. */
export function recordAI(road: Road, plan: Plan, pace = RUN.targetPace): Ghost {
  const c = newCar(12, 0);
  const inp: NightInput = { steer: 0, throttle: 0, brake: 0, hand: 0 };
  const rec = createRecorder();
  const pose = newPose();
  let t = 0;
  let endAt = Infinity;
  while (t < 400 && t < endAt) {
    drive(c, road, plan, pace, inp);
    if (c.s >= road.finish && endAt === Infinity) endAt = t + COAST_S;
    if (c.s >= road.finish) {
      inp.throttle = 0;
      inp.brake = 0.25;
      inp.steer = 0;
    }
    stepCar(c, inp, road, STEP);
    c.hit = 0;
    t += STEP;
    rec.push(t, poseOf(c, pose));
  }
  const finishT = timeAt(rec.snapshot(t, true), road.finish) ?? t;
  return rec.snapshot(finishT, true);
}

const cached: Partial<Record<TrackId, Target>> = {};

/** A track's target run (built on first use: a few milliseconds of driving; the canyon's unless told). */
export function getTarget(track: TrackId = "canyon"): Target {
  const had = cached[track];
  if (had) return had;
  const road = getRoad(track);
  const run = TRACKS[track].run;
  const plan = buildPlan(road);
  const ghost = recordAI(road, plan);
  const legT: number[] = [];
  const bonusS: number[] = [];
  for (let k = 0; k < road.checks.length; k++) {
    const t = timeAt(ghost, road.checks[k]) ?? ghost.time;
    legT.push(t);
    const next = k + 1 < road.checks.length ? (timeAt(ghost, road.checks[k + 1]) ?? ghost.time) - t : 0;
    bonusS.push(k + 1 < road.checks.length ? Math.round((next * run.legShare + run.legFlatS) * 2) / 2 : 0);
  }
  const startS = Math.round((legT[0] * run.startShare + run.startFlatS) * 2) / 2;
  return (cached[track] = { road, plan, ghost, startS, bonusS, legT });
}
