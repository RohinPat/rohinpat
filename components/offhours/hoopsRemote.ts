// A shot that came from a linked phone, turned into the (aimX, power) that
// Hoops' shoot() takes, so a phone shot and a mouse swipe run the same physics.
// Pure, so it is unit-tested; every number real flicks will need tuning on is
// in HOOPS_CAL, here and nowhere else.
//
// Two ways in. A flick of the phone (lib/motion/flick.ts: `power` 0..1 from the
// release speed, `aim` -1..1 from the sideways part of the pulse) and a swipe on
// the phone's screen, which is the mouse swipe exactly: the same speed -> power
// log curve and the same slope -> aim, with speeds counted in pad-heights per
// second so the pad's size doesn't matter.

export const HOOPS_CAL = {
  /** swipe speed, in pad heights per second, that is a perfect shot (the mouse swipe uses 1.6 canvas heights) */
  swipePerfect: 1.6,
  /** game power per doubling of swipe speed (shoot()'s power 1 is perfect) */
  swipeSlope: 0.45,
  /** slower than this (pad heights per second), or not upward, and it isn't a shot */
  swipeMin: 0.5,
  /**
   * A phone swipe's speed (its fastest moment, on a pad ~300 px tall) is scaled by this first. The mouse
   * swipe is the average of its last 160 ms across a canvas twice as tall, and a thumb flick is ~2000 px/s,
   * so without it every phone swipe would be a hard overshoot.
   */
  phoneSwipeGain: 0.3,
  /** the flick power (0..1) that is a perfect shot. A relaxed hand flick has an impulse of ~1.4 m/s, about 0.4 of the recogniser's range */
  flickPerfect: 0.45,
  /** game power per unit of flick power: how much a harder or softer flick lands long or short */
  flickGain: 0.9,
  /** the weakest and strongest shot power that is passed on (shoot() copes with either, and misses) */
  powerMin: 0.45,
  powerMax: 1.5,
  /** sideways reach, metres at the hoop line, of a full left or right flick (aim = +-1) */
  aimRangeM: 1.6,
  /** below this much aim a flick counts as straight, so a nearly straight flick isn't pushed off the rim by wrist noise */
  aimDead: 0.06,
};

export type HoopsShot = { aimX: number; power: number };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The mouse swipe's maths, shared with the phone's touch swipe. `vx` and `vy`
 * are the finger's velocity in screen heights per second (y down, so a shot has
 * vy < 0). Returns null for anything that isn't a fast enough swipe up.
 */
export function swipeShot(vx: number, vy: number, ballX: number, ballZ: number, hoopZ: number, gain = 1): HoopsShot | null {
  const c = HOOPS_CAL;
  vx *= gain;
  vy *= gain;
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || -vy < c.swipeMin) return null;
  // a natural flick is "right"; much faster or slower drifts long/short, on a log scale so the sweet spot is wide
  const power = 1 + c.swipeSlope * Math.log2(-vy / c.swipePerfect);
  return { power, aimX: ballX + (vx / -vy) * (hoopZ - ballZ) };
}

/** A flick of the phone: power 0..1 and aim -1..1 from the recogniser. */
export function flickShot(flickPower: number, aim: number, ballX: number): HoopsShot {
  const c = HOOPS_CAL;
  const a = Math.abs(aim) < c.aimDead ? 0 : aim;
  return {
    power: clamp(1 + (flickPower - c.flickPerfect) * c.flickGain, c.powerMin, c.powerMax),
    aimX: ballX + clamp(a, -1, 1) * c.aimRangeM,
  };
}

type Data = Record<string, number | string | boolean>;

/** Read a `hoops-flick` gesture ({power, aim}), or null. */
export function parseFlick(data: Data): { power: number; aim: number } | null {
  const power = Number(data.power);
  const aim = Number(data.aim);
  if (!Number.isFinite(power) || !Number.isFinite(aim)) return null;
  return { power: clamp(power, 0, 1), aim: clamp(aim, -1, 1) };
}

/** Read a `hoops-swipe` gesture ({vx, vy} in pad heights per second), or null. */
export function parseSwipe(data: Data): { vx: number; vy: number } | null {
  const vx = Number(data.vx);
  const vy = Number(data.vy);
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || Math.abs(vx) > 50 || Math.abs(vy) > 50) return null;
  return { vx, vy };
}
