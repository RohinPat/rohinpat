// A phone's twist (or a thumb on its crown), turned into the winding the watch
// takes. Pure, so it is unit-tested; every constant that real hands will need
// tuning is in WATCH_CAL, here and nowhere else.
//
// The phone sends `crown` gestures, {deg}: how far the crown turned since the
// last one, clockwise positive, in crown degrees. A wrist only turns about 60
// degrees, so a twist is geared up (twistGain) and a winding stroke is a
// clockwise twist then back, like a ratchet: the watch ignores the turn back
// (it only spins the crown the other way a little, with no power).

export const WATCH_CAL = {
  /** crown degrees per degree of wrist twist: three wrist-degrees wind like ten fingers' worth */
  twistGain: 3,
  /** the watch clicks (and a little power goes in) every this many crown degrees: the laptop's own detent, and the phone's buzz */
  detentDeg: 14,
  /** at most this many crown messages a second, and not for less turn than this (crown degrees) */
  sendHz: 30,
  minDeg: 0.5,
  /** the laptop takes at most this much turn from one message (a stalled link must not wind it in one go), crown degrees */
  maxStepDeg: 120,
  /** the phone buzz for each detent, ms (where the browser has a vibration motor) */
  buzzMs: 7,
  /** the laptop tells the phone its power reserve and explode setting at most this often, ms */
  stateEveryMs: 200,
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Read a `crown` gesture's data: the crown degrees to turn, or null if it isn't one. */
export function parseCrown(data: Record<string, number | string | boolean>): number | null {
  const deg = Number(data.deg);
  if (!Number.isFinite(deg) || deg === 0) return null;
  return clamp(deg, -WATCH_CAL.maxStepDeg, WATCH_CAL.maxStepDeg);
}

/** Wrist twist (degrees, clockwise positive) to crown degrees. */
export const crownFromTwist = (wristDeg: number, cal = WATCH_CAL) => wristDeg * cal.twistGain;

/**
 * Batches crown turns for the wire: `add` as often as you like (every motion
 * sample, every pointer move); a message goes out at most `sendHz` times a
 * second, once at least `minDeg` has built up. `flush` sends what is left.
 */
export function createCrownSender(emit: (deg: number) => void, cal = WATCH_CAL, now: () => number = () => performance.now()) {
  let acc = 0;
  let lastAt = -Infinity;
  const go = () => {
    const deg = Math.round(acc * 10) / 10;
    acc = 0;
    lastAt = now();
    if (deg !== 0) emit(deg);
  };
  return {
    add(deg: number) {
      acc += deg;
      if (Math.abs(acc) >= cal.minDeg && now() - lastAt >= 1000 / cal.sendHz) go();
    },
    flush() {
      if (Math.abs(acc) >= 0.1) go();
      else acc = 0;
    },
    /** crown degrees waiting to go */
    pending: () => acc,
  };
}

/** Counts detents as the crown winds: `add` crown degrees (clockwise positive), get how many clicks that crossed. */
export function createDetents(cal = WATCH_CAL) {
  let acc = 0;
  return {
    add(deg: number): number {
      if (deg <= 0) return 0;
      acc += deg;
      const n = Math.floor(acc / cal.detentDeg);
      acc -= n * cal.detentDeg;
      return n;
    },
  };
}
