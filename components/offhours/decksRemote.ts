// A scratch from a linked phone, turned into how fast the record is dragged.
// Pure, so it is unit-tested; every tunable is in DECKS_CAL.
//
// The phone sends axis "scratch": the angular velocity of the hand on its
// platter, rad/s, clockwise positive (the way the laptop's record turns).
// It sends gesture "decks-grab" {on} when the hand lands on or leaves the
// record. Between, a missing message means "no change" until staleMs.

export const RPM = 33.333;
/** rad/s of the platter at normal speed */
export const OMEGA = (RPM / 60) * Math.PI * 2;

export const DECKS_CAL = {
  /** the fastest the record can be dragged, in multiples of normal speed (the pointer's own cap) */
  maxRate: 10,
  /** angular velocities this slow (rad/s) count as holding the record still */
  deadRadS: 0.1,
  /** laptop: if no scratch value arrives for this long the held record decays like a still pointer, ms */
  staleMs: 140,
  /** phone: how often the scratch value is sent at most, Hz */
  sendHz: 30,
  /** phone: weight of the newest reading when smoothing the finger's speed (0..1) */
  smooth: 0.6,
  /** phone: finger moves this close to the platter's centre (fraction of its radius) are ignored; the angle is all noise there */
  centreDead: 0.12,
  /** phone: how far past the record's edge a touch still grabs it (fraction of the radius) */
  grabSlack: 0.14,
  /** phone twist: -1 because the gyro counts counter-clockwise as positive and the record turns clockwise */
  twistSign: -1 as 1 | -1,
  /** phone twist: wrist twists are small next to a hand on a record, so scale them up */
  twistGain: 1.6,
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The record's speed (1 = normal) for an angular velocity from the phone. */
export function scratchRate(v: number): number {
  if (!Number.isFinite(v) || Math.abs(v) < DECKS_CAL.deadRadS) return 0;
  return clamp(v / OMEGA, -DECKS_CAL.maxRate, DECKS_CAL.maxRate);
}

/** The signed shortest angle from a to b, radians. */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
