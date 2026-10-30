import { ENGINE_CAL, type NightInput } from "../engineRemote";
import { steerToLine, type Plan } from "./ai";
import type { Car } from "./car";
import type { Road } from "./road";

// The steering assist: a lane-keep for the keys and the touch pads. It blends the player's steering toward the wheel that
// would hold the car on the racing line (night/ai.ts steers the target driver with the same function), Off, Light or Full.
// It gives way to the player's own steering (a key held is mostly theirs; let go and it holds the line), and fades out while the car slides (a big body angle) or the handbrake is held, so a drift is still the player's own and still
// what scores, and comes back as the car straightens. Pure, so it is unit-tested; the numbers are ENGINE_CAL.assist.

const A = ENGINE_CAL.assist;

/** 0 off, 1 light, 2 full */
export type AssistLevel = 0 | 1 | 2;
export const ASSIST_NAMES = ["Off", "Light", "Full"] as const;
/** the level a keys or touch player starts on */
export const ASSIST_DEFAULT: AssistLevel = 1;

/** what the assist remembers between steps: how much of it is on (0..1), and how long it is held off after the handbrake */
export type AssistState = { fade: number; hold: number };
export const newAssist = (): AssistState => ({ fade: 1, hold: 0 });

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** The share of the way to the line's wheel each level goes at full fade. */
export const assistGain = (level: AssistLevel) => (level === 2 ? A.full : level === 1 ? A.light : 0);

/** Move the fade on `dt` seconds: down fast when the car slides, the handbrake is held or a clutch kick is on; up slowly when it is straight. */
export function stepFade(st: AssistState, slip: number, hand: boolean, kicked: boolean, dt: number): number {
  if (hand || kicked) st.hold = A.holdS;
  else st.hold = Math.max(0, st.hold - dt);
  const target = hand || kicked ? 0 : 1 - smooth((Math.abs(slip) - A.slipFrom) / (A.slipTo - A.slipFrom));
  if (target < st.fade) st.fade = Math.max(target, st.fade - dt * A.downPerS);
  else if (st.hold <= 0) st.fade = Math.min(target, st.fade + dt / A.upS);
  return st.fade;
}

/**
 * The steering the car gets for these inputs: the player's wheel, pulled toward the line by the level's share, as much as the
 * fade lets it. Call it every step, whatever the level, so the fade is always where the slide has left it.
 */
export function assistSteer(st: AssistState, level: AssistLevel, c: Car, road: Road, plan: Plan, inp: NightInput, dt: number): number {
  const fade = stepFade(st, c.slip, inp.hand > 0.5, c.kickT > 0, dt);
  const base = assistGain(level);
  if (base <= 0) return inp.steer;
  // near the rail the pull grows (from `guardFromM` off the middle to the rail's foot), and it lets go of the slide later than the rest of the assist does
  const near = smooth((Math.abs(c.lat) - A.guardFromM) / Math.max(0.1, road.railHalf - A.guardFromM));
  const edge = near * (1 - smooth((Math.abs(c.slip) - A.edgeFrom) / (A.edgeTo - A.edgeFrom)));
  const line = steerToLine(c, road, A.centre ? null : plan.line);
  const pull = line - inp.steer;
  // the player's hands come first: where the assist would take steering away from what they ask for, it gives way the more
  // they ask (pulling the whole wheel to the line made a key press do little, or even turn the car the other way); where it
  // only adds to a turn they are already making, it helps in full
  const against = pull * inp.steer < 0;
  const yieldTo = against ? 1 - A.yield * Math.min(1, Math.abs(inp.steer)) : 1;
  // by the rail it only ever pulls away from it (steering right moves the car to +lat), and gives way to the hands less
  const away = pull * c.lat < 0 ? 1 : 0;
  const g = Math.min(1, base * fade * yieldTo + base * A.guard * edge * away * (1 - 0.5 * Math.min(1, Math.abs(inp.steer))));
  if (g <= 0) return inp.steer;
  return inp.steer + g * pull;
}
