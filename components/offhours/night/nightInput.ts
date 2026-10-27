import { ENGINE_CAL, NO_INPUT, parsePedal, parseSteer, shapeSteer, type NightInput } from "../engineRemote";

// How the player's hands become the car's inputs. Three sources can be live at
// once and the biggest wins: the keyboard (steering ramps, so a tap is a nudge
// and a hold is lock), a linked phone (the steer axis is smoothed and shaped;
// the pedals are smoothed), and the on-screen pads for touch. Pure, so it is
// unit-tested.

const C = ENGINE_CAL;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** A keyboard's steering: `dir` is -1, 0 or 1 (the keys held). It ramps up, comes back faster, and crosses centre faster still. */
export function stepKeySteer(v: number, dir: number, dt: number, upS = C.keySteerS, returnS = C.keyReturnS): number {
  if (dir === 0) {
    const d = dt / returnS;
    return Math.abs(v) <= d ? 0 : v - Math.sign(v) * d;
  }
  const crossing = v !== 0 && Math.sign(v) !== dir;
  const d = dt / (crossing ? returnS * 0.7 : upS);
  return clamp(v + dir * d, -1, 1);
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
  keyGas: boolean;
  keyBrake: boolean;
  keyHand: boolean;
  /** the phone, already smoothed */
  phoneSteer: number;
  phoneGas: number;
  phoneBrake: number;
  phoneHand: number;
  /** the on-screen pads: a steer ramp -1..1, and the buttons */
  padSteer: number;
  padGas: boolean;
  padBrake: boolean;
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
  out.throttle = Math.max(s.keyGas ? 1 : 0, s.phoneGas, s.padGas ? 1 : 0);
  out.brake = Math.max(s.keyBrake ? 1 : 0, s.phoneBrake, s.padBrake ? 1 : 0);
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
