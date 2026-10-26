// A penalty swipe that came from a linked phone, turned into what Penalty's
// strike() takes: which kick, where on the goal plane, how hard. Pure, so it is
// unit-tested; every number real thumbs will need tuning on is in PENALTY_CAL.
//
// The phone's swipe recogniser (lib/motion/swipe.ts) reports a heading, a peak
// finger speed (power, 0..1), the path's bend (curl, -1..1, + = the ball bends
// right) and how long the swipe was. The laptop's own aiming is a point on the
// goal plane and a held power; this makes the same two things from the swipe,
// then the kick is struck by the same function the mouse uses.

import type { ShotId } from "./penaltyModel";

export const PENALTY_CAL = {
  /** half the goal's width, m. Must equal GW in penaltyModel (a unit test checks) */
  goalHalfWidthM: 3.66,
  /** swipe heading (degrees off straight up) that reaches `reachM` either side of the middle */
  dirFullDeg: 40,
  /** how far either side of the middle that heading aims, m (a little wider than the post, so a wild swipe goes wide) */
  reachM: 4.26,
  /** swipe length, as a fraction of the pad's height, for the lowest and the highest shot: a short flick stays low, a long sweep goes up */
  lenLow: 0.22,
  lenHigh: 0.72,
  /** the heights those lengths aim at, m (the crossbar is 2.44) */
  yLowM: 0.35,
  yHighM: 2.2,
  /** finger speeds (px/s) that are power 0 and power 1: the phone's recogniser uses these */
  speedLow: 300,
  speedHigh: 2800,
  /** the turn (radians, whole path) that is a full bend, and the per-hand baseline taken off it. A thumb pivots, so every swipe curves a little: measure yours and put it in curlBias */
  curlRange: Math.PI / 2,
  curlBias: 0,
  /** how much bend (0..1) turns an Auto swipe into a curler, left or right */
  curlThreshold: 0.3,
  /** in Auto, a swipe this hard (power 0..1) is driven rather than placed */
  driveAbove: 0.84,
  /** the weakest power passed on (a lighter swipe is no swipe at all in the recogniser, so this is a floor, not a gate) */
  powerMin: 0.06,
};

/** the phone's shot picker: Auto reads the swipe, the rest force that kick */
export type PhoneShot = "auto" | Exclude<ShotId, "curlL" | "curlR">;
export const PHONE_SHOTS: { id: PhoneShot; name: string }[] = [
  { id: "auto", name: "Auto" },
  { id: "placed", name: "Placed" },
  { id: "driven", name: "Driven" },
  { id: "dipper", name: "Dipper" },
  { id: "knuckle", name: "Knuckle" },
  { id: "panenka", name: "Panenka" },
];
export const isPhoneShot = (v: unknown): v is PhoneShot => PHONE_SHOTS.some((s) => s.id === v);

export type Kick = { shot: ShotId; aim: { x: number; y: number }; power: number };
export type Swipe = { dirDeg: number; len: number; power: number; curl: number };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Which kick a swipe is, given the phone's picker. Auto: a bent swipe curls, a very hard one is driven, the rest is placed. */
export function chooseShot(choice: PhoneShot, power: number, curl: number): ShotId {
  if (choice !== "auto") return choice;
  const c = PENALTY_CAL;
  if (curl >= c.curlThreshold) return "curlR";
  if (curl <= -c.curlThreshold) return "curlL";
  return power >= c.driveAbove ? "driven" : "placed";
}

export function kickFromSwipe(s: Swipe, choice: PhoneShot): Kick {
  const c = PENALTY_CAL;
  const x = clamp(s.dirDeg / c.dirFullDeg, -1.25, 1.25) * c.reachM;
  const y = c.yLowM + clamp((s.len - c.lenLow) / (c.lenHigh - c.lenLow), 0, 1) * (c.yHighM - c.yLowM);
  const power = clamp(s.power, c.powerMin, 1);
  return { shot: chooseShot(choice, power, s.curl), aim: { x, y }, power };
}

type Data = Record<string, number | string | boolean>;

/** Read a `penalty-kick` gesture, or null if it isn't one. */
export function parseKick(data: Data): Swipe | null {
  const dirDeg = Number(data.dirDeg);
  const len = Number(data.len);
  const power = Number(data.power);
  const curl = Number(data.curl);
  if (![dirDeg, len, power, curl].every(Number.isFinite)) return null;
  return { dirDeg: clamp(dirDeg, -90, 90), len: clamp(len, 0, 3), power: clamp(power, 0, 1), curl: clamp(curl, -1, 1) };
}
