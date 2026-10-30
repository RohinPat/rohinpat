import { ENGINE_CAL, NO_INPUT, parsePedal, parseSteer, shapeSteer, type NightInput } from "../engineRemote";

// How the player's hands become the car's inputs. Three sources can be live at
// once and the biggest wins: the keyboard (steering ramps, so a tap is a nudge
// and a hold is lock), a linked phone (the steer axis is smoothed and shaped;
// the pedals are smoothed), and the on-screen pads for touch. Pure, so it is
// unit-tested.

const C = ENGINE_CAL;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * A keyboard's steering: `dir` is -1, 0 or 1 (the keys held). A key that has just gone down starts at a quarter of
 * lock (KEY_SNAP) and ramps from there, it comes back faster, and crosses centre faster still. Without the start a
 * quick tap at 120 mph took 0.37 s to turn the nose a degree, long enough to feel like the key had done nothing;
 * with it, 0.22 s, and a tap is still a nudge.
 */
export function stepKeySteer(v: number, dir: number, dt: number, upS = C.keySteerS, returnS = C.keyReturnS, snap = C.keySnap): number {
  if (dir === 0) {
    const d = dt / returnS;
    return Math.abs(v) <= d ? 0 : v - Math.sign(v) * d;
  }
  const crossing = v !== 0 && Math.sign(v) !== dir;
  const d = dt / (crossing ? returnS * 0.7 : upS);
  const next = v + dir * d;
  if (!crossing && next * dir < snap) return dir * snap;
  return clamp(next, -1, 1);
}

/**
 * How a keyboard steers at this speed (m/s): the first nudge and the ramp to lock. The wheel's lock closes with speed (a few
 * hundredths of a radian at 120 mph), so a quarter-lock tap there did too little to hold a line: scripted keyboard drivers
 * weaved along the opening straight and hit the rail twice as often as with the firmer nudge. From keyFastFromMs to
 * keyFastAtMs the first nudge grows and the ramp to lock quickens; below that the keys are as they were.
 */
export function keySteerFeel(speed: number): { snap: number; upS: number } {
  const f = clamp((speed - C.keyFastFromMs) / (C.keyFastAtMs - C.keyFastFromMs), 0, 1);
  return { snap: C.keySnap + (C.keySnapFast - C.keySnap) * f, upS: C.keySteerS + (C.keySteerFastS - C.keySteerS) * f };
}

/**
 * A keyboard pedal: 0 to 1, not on or off. A key that has just gone down starts at `snap` of the pedal (a tap is a touch of
 * gas or brake, which is what lets a tap trail the brakes into a corner or hold the tail on the throttle) and climbs to
 * full over `upS`; it comes off faster than it went on.
 */
export function stepKeyPedal(v: number, down: boolean, dt: number, upS: number, downS: number, snap: number): number {
  if (!down) return Math.max(0, v - dt / downS);
  if (v < snap) return snap;
  return Math.min(1, v + dt / upS);
}

/** The keyboard's three axes, smoothed: steer -1..1, gas and brake 0..1. */
export type KeyAxes = { steer: number; gas: number; brake: number };
export const newKeyAxes = (): KeyAxes => ({ steer: 0, gas: 0, brake: 0 });

/** Advance the keyboard's axes `dt` seconds with these keys held, at this speed (m/s). */
export function stepKeys(a: KeyAxes, held: { dir: number; gas: boolean; brake: boolean }, speed: number, dt: number): KeyAxes {
  const f = keySteerFeel(speed);
  a.steer = stepKeySteer(a.steer, held.dir, dt, f.upS, C.keyReturnS, f.snap);
  a.gas = stepKeyPedal(a.gas, held.gas, dt, C.keyGasS, C.keyGasOffS, C.keyGasSnap);
  a.brake = stepKeyPedal(a.brake, held.brake, dt, C.keyBrakeS, C.keyBrakeOffS, C.keyBrakeSnap);
  return a;
}

/** The phone's last word on each axis, and what is held: the smoothed values live here. */
export type Phone = {
  steer: number;
  gas: number;
  brake: number;
  hand: number;
  /** the handbrake is held (a flick, or the Drift button's tap) until this time, ms */
  handUntil: number;
};

export const newPhone = (): Phone => ({ steer: 0, gas: 0, brake: 0, hand: 0, handUntil: 0 });

/** what the phone asked for: raw axis values, parsed */
export function setPhoneAxis(p: Phone, name: string, v: unknown): boolean {
  if (name === "steer") p.steer = parseSteer(v);
  else if (name === "gas") p.gas = parsePedal(v);
  else if (name === "brake") p.brake = parsePedal(v);
  else if (name === "hand") p.hand = parsePedal(v);
  else return false;
  return true;
}

export type Sources = {
  /** the keyboard's smoothed steering, -1..1, and which pedals are held */
  keySteer: number;
  /** how far down the keyboard's pedals are (0..1; a plain true counts as 1) */
  keyGas: boolean | number;
  keyBrake: boolean | number;
  keyHand: boolean;
  /** the phone, already smoothed */
  phoneSteer: number;
  phoneGas: number;
  phoneBrake: number;
  phoneHand: number;
  /** the on-screen pads: a steer ramp -1..1, and the buttons */
  padSteer: number;
  padGas: boolean | number;
  padBrake: boolean | number;
  padHand: boolean;
};

export const noSources = (): Sources => ({ keySteer: 0, keyGas: false, keyBrake: false, keyHand: false, phoneSteer: 0, phoneGas: 0, phoneBrake: 0, phoneHand: 0, padSteer: 0, padGas: false, padBrake: false, padHand: false });

/** Merge the sources into the car's inputs (written into `out`). */
export function resolveInput(s: Sources, out: NightInput = { ...NO_INPUT }): NightInput {
  // the steering that is furthest from centre wins, so a thumb on a pad is not fought by a still keyboard
  let steer = s.keySteer;
  if (Math.abs(s.phoneSteer) > Math.abs(steer)) steer = s.phoneSteer;
  if (Math.abs(s.padSteer) > Math.abs(steer)) steer = s.padSteer;
  out.steer = clamp(steer, -1, 1);
  out.throttle = Math.max(Number(s.keyGas), s.phoneGas, Number(s.padGas));
  out.brake = Math.max(Number(s.keyBrake), s.phoneBrake, Number(s.padBrake));
  out.hand = Math.max(s.keyHand ? 1 : 0, s.phoneHand, s.padHand ? 1 : 0);
  return out;
}

/** Ease the phone's raw values toward what the car should see: the steer is shaped and smoothed, the pedals smoothed. */
export function smoothPhone(p: Phone, sm: { steer: number; gas: number; brake: number }, dt: number, now: number): Pick<Sources, "phoneSteer" | "phoneGas" | "phoneBrake" | "phoneHand"> {
  const k = (tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
  sm.steer += (shapeSteer(p.steer) - sm.steer) * k(C.steerSmoothS);
  sm.gas += (p.gas - sm.gas) * k(C.pedalSmoothS);
  sm.brake += (p.brake - sm.brake) * k(C.pedalSmoothS);
  if (Math.abs(sm.steer) < 1e-3) sm.steer = 0;
  return { phoneSteer: sm.steer, phoneGas: sm.gas < 0.02 ? 0 : sm.gas, phoneBrake: sm.brake < 0.02 ? 0 : sm.brake, phoneHand: p.hand > 0.5 || now < p.handUntil ? 1 : 0 };
}
