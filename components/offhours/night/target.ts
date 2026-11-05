import { ENGINE_CAL, type NightInput } from "../engineRemote";
import { buildPilot, buildPlan, newPilotState, pilotDrive, type Pilot, type PilotStyle, type Plan } from "./ai";
import { newCar, stepCar, type Car } from "./car";
import { createRecorder, newPose, timeAt, type Ghost, type Pose } from "./ghost";
import { getRoad, type Road } from "./road";
import { TRACKS, type TrackId } from "./tracks";

// Two runs of the same driver (ai.ts: the pilot, on a racing line, sliding its medium
// corners), each recorded once: the road and the pilot are fixed, so the same run comes
// out every time. The target run is the slow one and is the yardstick for the clock:
// the time on offer at the start and at each checkpoint is a share of what it needs
// for the leg, so a driver as good as the target always has a little in hand, and a
// ragged one runs out. The rival run is the same pilot at a pace a player can race:
// it is the ghost on the road, the reference for the gap box and the tile's attract mode.

const STEP = 1 / 120;
/** how long the car coasts on after the finish, s (so the ghost does not vanish at the line) */
const COAST_S = 3;

export type Target = {
  road: Road;
  /** the tyres' limit at each node (the corner warning reads it) and the pilot's own line and speeds */
  plan: Plan;
  pilot: Pilot;
  /** the target's own run: the clock's yardstick (the start time, the gate bonuses and the medals come from it) */
  ghost: Ghost;
  /** the rival's run: the ghost drawn on the road, the gap box's reference and the tile's attract mode */
  rival: Ghost;
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

/** Drive the AI around the road and record it (`onStep` sees the car and its inputs after each step: the tests measure with it). */
export function recordAI(road: Road, pilot: Pilot, style: PilotStyle, onStep?: (c: Car, inp: NightInput, t: number) => void): Ghost {
  const c = newCar(12, 0);
  const inp: NightInput = { steer: 0, throttle: 0, brake: 0, hand: 0 };
  const st = newPilotState();
  const rec = createRecorder();
  const pose = newPose();
  let t = 0;
  let endAt = Infinity;
  while (t < 400 && t < endAt) {
    pilotDrive(st, c, road, pilot, style, STEP, inp);
    if (c.s >= road.finish && endAt === Infinity) endAt = t + COAST_S;
    if (c.s >= road.finish) {
      // past the line it lets the car roll on, on the line
      inp.throttle = 0;
      inp.brake = 0.25;
    }
    stepCar(c, inp, road, STEP);
    t += STEP;
    onStep?.(c, inp, t);
    c.hit = 0;
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
  const pilot = buildPilot(road, TRACKS[track].pilot, run.targetPace);
  const ghost = recordAI(road, pilot, TRACKS[track].pilot);
  const legT: number[] = [];
  const bonusS: number[] = [];
  for (let k = 0; k < road.checks.length; k++) {
    const t = timeAt(ghost, road.checks[k]) ?? ghost.time;
    legT.push(t);
    const next = k + 1 < road.checks.length ? (timeAt(ghost, road.checks[k + 1]) ?? ghost.time) - t : 0;
    bonusS.push(k + 1 < road.checks.length ? Math.round((next * run.legShare + run.legFlatS) * 2) / 2 : 0);
  }
  const startS = Math.round((legT[0] * run.startShare + run.startFlatS) * 2) / 2;
  const rivalStyle = TRACKS[track].rival.pilot;
  const rival = recordAI(road, buildPilot(road, rivalStyle, TRACKS[track].rival.pace), rivalStyle);
  return (cached[track] = { road, plan, pilot, ghost, rival, startS, bonusS, legT });
}
