// A headless shootout for the keeper tests and the tuning reports: the same
// steps Penalty.tsx takes (idle while you aim, run-up, flight, contact, line),
// with nothing drawn. Seeded, so a number here is a number every time.

import {
  GW, KEEPER_Z, RUNUP, SPOT_Z, GOAL_Z, SHOTS, atLineResult, clamp, contact, keeperIdle, keeperRun, keeperStartPlan,
  favourite, launch, missesFrame, makeStrike, newBall, newKeeper, remember, resolveContact, saveNote, shotById, stepBall, tellOf, think,
  type Brain, type KeeperState, type Plan, type ShotId, type Strike, type Vec,
} from "@/components/offhours/penaltyModel";

export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Kick = { shot: ShotId; aim: Vec; power: number; /** seconds the reticle sat still before release */ dwell?: number };
export type Outcome = {
  result: "goal" | "save" | "miss" | "post";
  detail: string;
  how: string;
  st: Strike;
  plan: Plan;
  /** where the ball was when it was stopped or crossed */
  at: Vec;
  keeper: KeeperState;
};

/** the shootout's difficulty ramp, as the component computes it */
export function difficulty(kicks: string[]) {
  const i = kicks.length;
  const goals = kicks.filter((k) => k === "goal").length;
  return clamp(0.26 + 0.06 * Math.min(i, 4) + 0.05 * Math.max(0, goals - (i - goals) - 1) + 0.09 * Math.max(0, i - 5), 0.2, 0.92);
}

export function playKick(brain: Brain, diff: number, kick: Kick, rnd: () => number): Outcome {
  const k = newKeeper();
  k.ph = rnd() * 20;
  const dwell = kick.dwell ?? 0.6 + rnd() * 1.2;
  const tell = tellOf(dwell);
  const bias = favourite(brain, diff);
  // he has been watching you aim: a few seconds of it, the last `dwell` of them with the reticle still
  for (let t = 0; t < 3 + dwell; t += 1 / 60) keeperIdle(k, 1 / 60, kick.aim.x, tellOf(Math.max(0, t - 3)), true, { bias, rnd });
  const st = makeStrike(shotById(kick.shot), kick.aim, kick.power, rnd);
  const plan = think(brain, diff, st, tell, k.x, rnd, { bait: k.bait });
  keeperStartPlan(k, plan);
  while (k.tk < RUNUP) keeperRun(k, 1 / 60);
  const b = newBall();
  launch(b, st);
  let graze = false;
  let contactDone = false;
  let out: Outcome | null = null;
  for (let guard = 0; guard < 4000 && !out; guard++) {
    keeperRun(k, st.h);
    const pz = b.z;
    stepBall(b, st, st.h);
    if (!contactDone && pz < KEEPER_Z && b.z >= KEEPER_Z) {
      contactDone = true;
      const c = missesFrame(st) ? null : contact(k.joints, b.x, b.y);
      if (c) {
        const r = resolveContact(b, st, k.joints, c, graze, rnd);
        if (r.kind === "graze") graze = true;
        else {
          out = { result: "save", detail: saveNote(plan, { x: b.x, y: b.y }, r.detail), how: r.how, st, plan, at: { x: b.x, y: b.y }, keeper: k };
          break;
        }
      }
    }
    if (pz < GOAL_Z && b.z >= GOAL_Z) {
      const r = atLineResult(b, st, k.plan, graze);
      out = { result: r.result, detail: r.detail, how: graze ? "graze" : "", st, plan, at: { x: b.x, y: b.y }, keeper: k };
    }
  }
  if (!out) throw new Error("the ball never reached the line");
  remember(brain, out.result, st, out.at.x, out.at.y);
  return out;
}

// ───────────────────────────── players ─────────────────────────────

export type Player = (i: number, rnd: () => number, hist: Outcome[]) => Kick;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** where a good kick of this type is aimed: the corners, bar or floor, with a metre or two to spare */
function cornerAim(shot: ShotId, rnd: () => number, side: -1 | 1, high: boolean): Vec {
  if (shot === "panenka") return { x: (rnd() - 0.5) * 0.5, y: 1.0 + rnd() * 0.3 };
  const x = side * (2.7 + rnd() * 0.65);
  const y = high ? (shot === "dipper" ? 2.0 + rnd() * 0.25 : 1.75 + rnd() * 0.45) : 0.3 + rnd() * 0.5;
  return { x, y };
}

/** inside this kick's clean band and toward its fast end (a Panenka stays at its soft sweet spot), as a player who has learned the dial would */
export function goodPower(shot: ShotId, rnd: () => number) {
  const s = shotById(shot);
  if (shot === "panenka") return clamp(s.sweet + (rnd() - 0.5) * s.width * 0.8, 0.1, 1);
  return clamp(s.sweet + s.width * (0.35 + 0.5 * rnd()), 0.1, 0.87);
}

/** a player who uses one shot type well and mixes the corners (and never the same one twice running) */
export const STANDARD: ShotId[] = ["placed", "driven", "curlL", "curlR", "dipper"];
export function goodWith(shot: ShotId | "mixed" | "all"): Player {
  let last = { side: 1 as -1 | 1, high: false };
  return (_i, rnd) => {
    const sh = shot === "all" ? SHOTS[Math.floor(rnd() * SHOTS.length)].id : shot === "mixed" ? STANDARD[Math.floor(rnd() * STANDARD.length)] : shot;
    // alternate: switch side or height every time
    const flipSide = rnd() < 0.6;
    // a curler is aimed to the side it bends toward (the other way it starts outside the post)
    const side = (sh === "curlL" ? -1 : sh === "curlR" ? 1 : flipSide ? -last.side : last.side) as -1 | 1;
    const high = flipSide ? rnd() < 0.5 : !last.high;
    last = { side, high };
    return { shot: sh, aim: cornerAim(sh, rnd, side, high), power: goodPower(sh, rnd), dwell: 0.3 + rnd() * 0.6 + 0.6 };
  };
}

/** knows only: the goal is big, the ball goes where you point. Any shot, anywhere in the frame, any power but the softest. */
export const casual: Player = (_i, rnd) => ({
  shot: SHOTS[Math.floor(rnd() * SHOTS.length)].id,
  aim: { x: (rnd() * 2 - 1) * GW, y: 0.2 + rnd() * 2.1 },
  power: 0.3 + rnd() * 0.65,
  dwell: 0.4 + rnd() * 2 + 0.6,
});

/** the same placed kick, to the same corner, at its best power, every time */
export function stubborn(shot: ShotId = "placed", x = 3.0, y = 0.55): Player {
  return (_i, rnd) => ({ shot, aim: { x, y }, power: goodPower(shot, rnd), dwell: 0.3 + rnd() * 0.6 + 0.6 });
}

export type Shootout = { kicks: Outcome[]; goals: number };

export function shootout(player: Player, rnd: () => number, n = 5): Shootout {
  const brain: Brain = { hist: [] };
  const kicks: Outcome[] = [];
  const marks: string[] = [];
  for (let i = 0; i < n; i++) {
    const o = playKick(brain, difficulty(marks), player(i, rnd, kicks), rnd);
    kicks.push(o);
    marks.push(o.result);
  }
  return { kicks, goals: marks.filter((m) => m === "goal").length };
}

export { lerp, SPOT_Z, GW };

/** a good mixed player who, at kick `at`, uses `shot` once (a Panenka or a knuckleball is a one-off, not a plan) */
export function oneOff(shot: ShotId, at: number): Player {
  const base = goodWith("mixed");
  const sh = goodWith(shot);
  return (i, rnd, hist) => (i === at ? sh(i, rnd, hist) : base(i, rnd, hist));
}
