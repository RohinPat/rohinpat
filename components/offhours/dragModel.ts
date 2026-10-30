import { DRAG_GHOST_DT } from "./dragGhost";
import { IDLE, LIMIT, RATIOS, FINAL, SHIFT_AT, WHEEL, torque, wheelRpm } from "./engineModel";
import { rpmRate } from "./engineRemote";

// The drag strip's run, as numbers: the staging, the tree, the launch, the shifts
// and the quarter mile. It lives apart from the canvas so the same code is what a
// test and a scripted driver run (DragStrip.tsx draws it and plays the sound).
//
// What there is to get good at: the revs at the green (the launch), being on the
// throttle at the green (the reaction), and the shifts (change up in the window
// the shift light gives, not before it and not on the limiter). The result says
// how each of the three went, and what a run with all three right would have
// taken (par).

export const QUARTER = 402.3;
/** sixty feet, m */
export const SIXTY_FT = 18.29;

/**
 * The launch. The light goes green and the car goes with whatever the revs are
 * then: inside the band it is a launch, outside it is not (too few and it bogs,
 * too many and the tyres spin). Inside the band the best is near the middle:
 * the further from SWEET, the more the tyres slip off the line.
 */
export const LAUNCH = { lo: 3200, hi: 6500, sweet: 4900, perfect: 350, great: 900 };

/**
 * The tree. Staged, it waits a moment (not the same every run, so the green cannot be counted down to from the staging),
 * then three ambers a half second apart, then the green TREE_GREEN_S after the first amber.
 */
export const TREE_WAIT = { min: 0.25, spread: 0.7 };
export const TREE_STEP_S = 0.5;
export const TREE_GREEN_S = 1.6;
/** the green is this long after staging: the wait, then the amber sequence */
export const treeTime = (c: { wait: number }) => c.wait + TREE_GREEN_S;
/** seconds since the first amber (negative while the tree is still waiting) */
export const sinceAmber = (c: { tree: number; wait: number }) => c.tree - c.wait;

export type DragPhase = "idle" | "tree" | "run" | "done";

export type ShiftCounts = { perfect: number; good: number; early: number; late: number };

export type DragCar = {
  phase: DragPhase;
  rpm: number;
  v: number;
  x: number;
  gear: number;
  throttle: boolean;
  /** how far down the pedal is, 0..1: 1 for the keys and the button, anything for a phone */
  pedal: number;
  shiftT: number;
  /** seconds since staging, and how long the tree waited before the first amber */
  tree: number;
  wait: number;
  t: number;
  split60: number | null;
  /** the time to sixty feet from the green */
  sixtyFt: number | null;
  /** the shifts, graded: PERFECT is the shift light's window, GOOD a little under it, EARLY well under, LATE on the limiter */
  shifts: ShiftCounts;
  /** the count of PERFECT shifts (kept as it was for the phone and the tests) */
  perfect: number;
  call: string;
  callT: number;
  /** how the launch went (kept for the end card), and the revs at green */
  launch: string;
  launchRpm: number;
  /** seconds from the green to the throttle going down (0 when it was down at the green; null while it has not been) */
  reaction: number | null;
  /** seconds since the finish line, and what it did to the best time (null: a first run or a tile) */
  doneT: number;
  /** the speed over the line, mph */
  trap: number;
  vsBest: number | null;
  limiter: number;
  slip: number;
  best: number | null;
  stageHeld: number;
  pop: number;
};

export const freshCar = (best: number | null = null): DragCar => ({
  phase: "idle",
  rpm: IDLE,
  v: 0,
  x: 0,
  gear: 0,
  throttle: false,
  pedal: 0,
  shiftT: 0,
  tree: 0,
  wait: 0,
  t: 0,
  split60: null,
  sixtyFt: null,
  shifts: { perfect: 0, good: 0, early: 0, late: 0 },
  perfect: 0,
  call: "",
  callT: 0,
  launch: "",
  launchRpm: 0,
  reaction: null,
  doneT: 0,
  trap: 0,
  vsBest: null,
  limiter: 0,
  slip: 0,
  best,
  stageHeld: 0,
  pop: 0,
});

/** What a step did that the page plays or keeps: the green (with how hard the tyres spin) and the line. */
export type DragEvents = { green?: (slip: number) => void; finish?: () => void };

/** Change up a gear now (the dash's shift key). Returns true if it shifted. */
export function shiftUp(c: DragCar, t: number): boolean {
  if (c.phase !== "run" || c.gear >= RATIOS.length - 1 || c.shiftT > 0) return false;
  const rpm = c.rpm;
  c.call = rpm >= LIMIT - 20 ? "LATE" : rpm >= SHIFT_AT ? "PERFECT" : rpm < SHIFT_AT - 900 ? "EARLY" : "GOOD";
  if (c.call === "PERFECT") {
    c.perfect++;
    c.shifts.perfect++;
  } else if (c.call === "LATE") c.shifts.late++;
  else if (c.call === "EARLY") c.shifts.early++;
  else c.shifts.good++;
  c.callT = t;
  c.gear++;
  c.shiftT = c.call === "PERFECT" ? 0.09 : 0.16;
  c.pop = 1;
  return true;
}

/** Advance the run by `dt` seconds at clock time `t`; `path` is the run's distance every DRAG_GHOST_DT from the green (the ghost). */
export function stepDrag(c: DragCar, dt: number, t: number, path: number[], ev: DragEvents = {}, rand: () => number = Math.random) {
  if (c.phase === "idle") {
    // free revving: stage by holding the throttle
    c.rpm += rpmRate(c.pedal, 9000, 6000) * dt;
    c.stageHeld = c.throttle ? c.stageHeld + dt : 0;
    if (c.stageHeld > 0.35) {
      c.phase = "tree";
      c.tree = 0;
      c.wait = TREE_WAIT.min + rand() * TREE_WAIT.spread;
    }
  } else if (c.phase === "tree") {
    c.rpm += rpmRate(c.pedal, 7000, 6000) * dt;
    c.tree += dt;
    if (c.tree >= treeTime(c)) {
      c.phase = "run";
      c.t = 0;
      // launch: too few revs bogs, too many spins the tyres, and in between the tyres slip more the further from the sweet spot
      const off = Math.abs(c.rpm - LAUNCH.sweet);
      c.slip = c.rpm > LAUNCH.hi ? 0.9 : c.rpm < LAUNCH.lo ? -0.6 : 0.05 + 0.35 * Math.min(1, off / 1600);
      c.call = c.rpm > LAUNCH.hi ? "WHEELSPIN" : c.rpm < LAUNCH.lo ? "BOGGED" : off <= LAUNCH.perfect ? "PERFECT LAUNCH" : off <= LAUNCH.great ? "GREAT LAUNCH" : "GOOD LAUNCH";
      c.launch = c.call;
      c.launchRpm = c.rpm;
      c.callT = t;
      // on the throttle at the green is a reaction of nothing; off it, the clock is already running until the foot comes down
      c.reaction = c.throttle ? 0 : null;
      path.length = 0;
      path.push(0);
      ev.green?.(c.slip);
    }
  } else if (c.phase === "run") {
    c.t += dt;
    if (c.reaction === null && c.throttle) c.reaction = c.t;
    // the run as a path, for the ghost
    while (c.t >= path.length * DRAG_GHOST_DT && path.length < 1200) path.push(c.x);
    const coupled = wheelRpm(c.v, c.gear);
    c.shiftT = Math.max(0, c.shiftT - dt);
    // engine speed: tied to the wheels, plus launch slip that decays
    c.slip *= Math.exp(-dt * 2.2);
    const target = Math.max(IDLE + 1500 * Math.max(0, c.slip), coupled * (1 + Math.max(0, c.slip) * 0.35));
    c.rpm += (target - c.rpm) * Math.min(1, dt * (c.shiftT > 0 ? 18 : 10));
    const onLimiter = c.rpm >= LIMIT;
    c.limiter = onLimiter ? c.limiter + dt : 0;
    const drive =
      c.throttle && c.shiftT <= 0 && !(onLimiter && Math.floor(t * 30) % 2)
        ? Math.min(17500, (torque(c.rpm) * RATIOS[c.gear] * FINAL * 0.9) / WHEEL) * c.pedal // traction-limited
        : 0;
    const bog = c.slip < 0 ? 1 + c.slip * 0.9 : 1 - Math.max(0, c.slip) * 0.65;
    const drag = 0.39 * c.v * c.v + 180;
    const a = (drive * bog - drag) / 1550;
    c.v = Math.max(0, c.v + a * dt);
    c.x += c.v * dt;
    c.rpm = Math.min(LIMIT + 60, Math.max(IDLE, c.rpm));
    if (c.sixtyFt === null && c.x >= SIXTY_FT) c.sixtyFt = c.t;
    if (c.split60 === null && c.v * 2.237 >= 60) c.split60 = c.t;
    if (c.limiter > 0.15 && t - c.callT > 0.6) {
      c.call = "LIMITER";
      c.callT = t;
    }
    if (c.x >= QUARTER) {
      c.phase = "done";
      c.tree = 0;
      c.doneT = 0;
      c.trap = c.v * 2.237;
      c.vsBest = c.best === null ? null : c.t - c.best;
      c.best = c.best === null ? c.t : Math.min(c.best, c.t);
      if (c.reaction === null) c.reaction = c.t;
      ev.finish?.();
    }
  } else {
    c.doneT += dt;
    c.rpm += rpmRate(c.pedal, 7000, 4000) * dt;
    c.v = Math.max(0, c.v - 6 * dt);
  }
  if (c.phase !== "run") c.rpm = Math.min(LIMIT + 60, Math.max(IDLE, c.rpm));
  if (c.phase !== "run" && c.rpm >= LIMIT && c.throttle) c.rpm = LIMIT - 300 * rand(); // bounce off the limiter
  c.pop = Math.max(0, c.pop - dt * 4);
}

/**
 * What a run with every part right would have taken: the revs held at the sweet spot at the green, on the throttle, and every
 * shift in the shift light's window. The same model, driven that way (a few thousand steps, made once).
 */
let par: number | null = null;
export function parEt(): number {
  if (par !== null) return par;
  const c = freshCar();
  const path: number[] = [];
  const dt = 1 / 120;
  let t = 0;
  for (let i = 0; i < 120 * 40 && c.phase !== "done"; i++) {
    c.throttle = c.phase === "tree" ? c.rpm < LAUNCH.sweet : true;
    c.pedal = c.throttle ? 1 : 0;
    if (c.phase === "run" && c.shiftT <= 0 && c.rpm >= SHIFT_AT + 50) shiftUp(c, t);
    stepDrag(c, dt, t, path, {}, () => 0.5);
    t += dt;
  }
  par = c.t;
  return par;
}

/** The one line of advice under a finished run, in capitals: the first thing it did wrong, or how far off par it was. */
export function dragAdvice(c: Pick<DragCar, "launch" | "launchRpm" | "reaction" | "shifts" | "t">, p: number): string {
  const s = c.shifts;
  const plural = (n: number) => (n > 1 ? "S" : "");
  if (c.reaction !== null && c.reaction > 0.15) return `${c.reaction.toFixed(2)} S TO GET ON THE THROTTLE AT GREEN`;
  if (c.launch === "WHEELSPIN") return "TOO MANY REVS AT GREEN. TAP TO HOLD";
  if (c.launch === "BOGGED") return "TOO FEW REVS AT GREEN. HOLD THE MARK";
  if (s.early > 0) return `${s.early} EARLY SHIFT${plural(s.early)}. WAIT FOR BLUE`;
  if (s.late > 0) return `${s.late} LATE SHIFT${plural(s.late)}. SHIFT ON BLUE`;
  if (c.launch === "GOOD LAUNCH") return `LAUNCH ${Math.round(Math.abs(c.launchRpm - LAUNCH.sweet) / 50) * 50} RPM FROM THE MARK`;
  if (s.good > 0) return `${s.good} SHIFT${plural(s.good)} A LITTLE EARLY. WAIT FOR BLUE`;
  return `${Math.max(0, c.t - p).toFixed(2)} S OFF PAR. LAUNCH AND SHIFTS CLEAN`;
}
