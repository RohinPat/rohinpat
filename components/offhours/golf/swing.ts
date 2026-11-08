import { CLUBS, simulate, type Surface } from "./flight";
import { lieFor } from "./lie";
import type { RemoteShot } from "./remoteSwing";

// What a swing turns into. The range and the course both swing the same three
// ways (a drag down and back up, three presses of Space, a linked phone) and
// the strike is the same numbers either way: power, start line, curve and
// contact, then a thin or fat lie on the poor ones. This file holds those
// numbers and the club table that goes with them (what each club carries, which
// club suits a distance). Pure, so it is unit-tested against recorded values.

export type SwingSrc = "gesture" | "meter" | "auto" | "remote";

/** an over-the-top swing carries at most about this fraction of a pure swing with the same club */
export const OVER_CARRY = 0.7;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------ club table
const carryCache = new Map<string, number>();
const flatSurf = () => "fairway" as const;
function carryFor(club: number, sf: number): number {
  const key = `${club}:${sf.toFixed(3)}`;
  let v = carryCache.get(key);
  if (v === undefined) {
    v = simulate({ club: CLUBS[club], speed: sf, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: flatSurf }).carry;
    carryCache.set(key, v);
  }
  return v;
}
export const fullCarry = (club: number) => carryFor(club, 1);
/** the no-wind carry (yd) of a swing of `power` (a backswing fraction, 0..1) with this club, in steps of 2% so a drag does not fill the cache */
export const carryAtPower = (club: number, power: number) => carryFor(club, sfOf(Math.round(clamp(power, 0, 1) * 50) / 50));
/** the swing fraction (0..1 backswing) that carries `yd` with this club, or null if it can't */
export function powerFor(club: number, yd: number): number | null {
  if (yd > fullCarry(club) + 1) return null;
  let lo = 0.3, hi = 1;
  for (let i = 0; i < 9; i++) {
    const m = (lo + hi) / 2;
    if (carryFor(club, m) < yd) lo = m;
    else hi = m;
  }
  return (hi - 0.3) / 0.7;
}
const lieCache = new Map<string, number>();
/** the share of a pure swing's carry this lie leaves with this club (the fairway and the tee: 1) */
export function lieCarry(surface: Surface, club: number): number {
  const lie = lieFor(surface, club);
  if (!lie) return 1;
  const key = `${surface}:${club}`;
  let v = lieCache.get(key);
  if (v === undefined) {
    const c = simulate({ club: CLUBS[club], speed: 1, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: flatSurf, lie: { ...lie, faceNoise: 0 } }).carry;
    v = c / fullCarry(club);
    lieCache.set(key, v);
  }
  return v;
}
/** `k` is the share of the carry each club keeps from the lie (lieCarry), so the club asked for really gets there */
export function suggest(yd: number, k: (club: number) => number = () => 1): { club: number; power: number } {
  // the shortest club that gets there, with a little in hand
  for (let i = CLUBS.length - 1; i >= 0; i--) {
    const p = powerFor(i, yd / k(i));
    if (p !== null && p >= 0.62) return { club: i, power: p };
  }
  return { club: 0, power: Math.min(1, powerFor(0, yd / k(0)) ?? 1) };
}
/** suggest(), but a short shot takes the sand wedge at the swing that carries it, not a driver at 17% */
export function suggestCourse(yd: number, k: (club: number) => number = () => 1): { club: number; power: number } {
  const sw = CLUBS.length - 1;
  const p = powerFor(sw, yd / k(sw));
  if (p !== null && p < 0.62) return { club: sw, power: Math.max(0.05, p) };
  return suggest(yd, k);
}
/** a backswing fraction as the fraction of the club's ball speed */
export const sfOf = (b: number) => 0.3 + 0.7 * clamp(b, 0, 1);

// The short game. The meter's power is the time between two presses of Space, and nobody presses twice in under about
// 0.15 s, so a full-swing meter cannot carry less than about 15 yd. Inside CHIP_YD of the pin the meter (and a drag)
// is scaled to the distance instead: its full travel carries CHIP_FULL_YD with the sand wedge, and the shortest press
// carries a few yards. A phone's swing is its own power and is not scaled.
export const CHIP_YD = 40;
export const CHIP_FULL_YD = 48;
const CHIP_LOW = 0.18;
/** the share of the club's ball speed at the top of a chip meter */
export const chipTop = (club: number) => Math.min(1, Math.sqrt(CHIP_FULL_YD / fullCarry(club)));
export const sfOfChip = (club: number, b: number) => chipTop(club) * (CHIP_LOW + (1 - CHIP_LOW) * clamp(b, 0, 1));
/** the no-wind carry (yd) of a chip meter at `b` (steps of 2%) and at the top */
export const carryAtChip = (club: number, b: number) => carryFor(club, sfOfChip(club, Math.round(clamp(b, 0, 1) * 50) / 50));
export const chipCarry = (club: number) => carryAtChip(club, 1);
/** the chip meter fraction that carries `yd` with this club (1 if it cannot) */
export function chipPowerFor(club: number, yd: number): number {
  if (yd >= chipCarry(club)) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 9; i++) {
    const m = (lo + hi) / 2;
    if (carryFor(club, sfOfChip(club, m)) < yd) lo = m;
    else hi = m;
  }
  return hi;
}

// An over-the-top swing always has the same contact, hook and (random) thin or fat lift, so its
// speed is found once per club: the best of those lies (fat, which flies highest) carries OVER_CARRY.
export const OVER_CONTACT = 0.4;
const OVER_FACE = -0.6, OVER_CURVE = -0.9;
const overCache = new Map<number, number>();
export function overSpeed(club: number): number {
  let v = overCache.get(club);
  if (v === undefined) {
    const goal = OVER_CARRY * fullCarry(club);
    const carry = (sf: number) => simulate({ club: CLUBS[club], speed: sf, yaw: 0, face: OVER_FACE, curve: OVER_CURVE, contact: OVER_CONTACT, lift: 1.15, wind: [0, 0], surfaceAt: flatSurf }).carry;
    let lo = 0.3, hi = 1.05;
    for (let i = 0; i < 12; i++) {
      const m = (lo + hi) / 2;
      if (carry(m) < goal) lo = m;
      else hi = m;
    }
    v = (lo + hi) / 2;
    overCache.set(club, v);
  }
  return v;
}

// ------------------------------------------------------------ the strike
/** a press this close to the ideal impact (s) is square: a frame either way, which a keyboard cannot promise */
export const METER_SQUARE = 0.015;
/** how far past that (s) the face is as open or closed as it gets */
const METER_SPAN = 0.3;
/** how far the second press is from the ideal impact (seconds, + late) as the meter swing's face: -1..1 */
export const meterFace = (tau: number) => (Math.abs(tau) <= METER_SQUARE ? 0 : clamp((tau - Math.sign(tau) * METER_SQUARE) / METER_SPAN, -1, 1));

/** the swing as it stood at impact */
export type SwingIn = {
  src: SwingSrc;
  /** the top of the backswing, 0..1.15 */
  peak: number;
  /** a gesture: where the press landed, the top of the backswing, and the pointer now (px) */
  x0: number;
  xTop: number;
  xNow: number;
  /** the swing length the gesture was measured against, px */
  lastL: number;
  /** a gesture: seconds from the reversal to impact */
  td: number;
  /** a meter or auto swing: how far off the line the second press was, -1..1 */
  autoFace: number;
  /** a linked phone's swing */
  remote: RemoteShot | null;
  /** the club went over the top (one press, then waiting) */
  over: boolean;
};

export type Strike = {
  power: number;
  face: number;
  curve: number;
  contact: number;
  /** thin (low) or fat (high) lift on a poor strike, else 1 */
  lift: number;
  label: "PURE" | "SOLID" | "THIN" | "FAT";
  /** the fraction of the club's ball speed */
  speed: number;
  /** the over-the-top swing: its timing says nothing */
  overTop: boolean;
};

/** `rng` decides thin or fat on a poor strike (the range uses Math.random; the course passes its seeded hand) */
export function strikeNumbers(s: SwingIn, club: number, rng: () => number = Math.random, chip = false): Strike {
  const power = clamp(s.peak, 0.05, 1.15);
  let face = 0, curve = 0, contact = 1;
  if (s.src === "gesture") {
    const lenPx = s.lastL || 160;
    const ox = clamp((s.xNow - s.x0) / (0.34 * lenPx), -1, 1);
    const path = clamp(((s.xNow - s.xTop) / (0.34 * lenPx)) * 0.6, -1, 1);
    face = ox;
    curve = clamp((ox - path) * 0.8, -1, 1);
    const td = s.td;
    let q = 1;
    if (td > 0.6) q -= (td - 0.6) * 0.9;
    if (td < 0.1) q -= (0.1 - td) * 2.5;
    q -= Math.max(0, Math.abs(ox) - 0.55) * 0.5;
    contact = q;
  } else if (s.src === "remote" && s.remote) {
    ({ face, curve, contact } = s.remote);
  } else {
    const f = s.autoFace;
    face = f * 0.6;
    curve = f * 0.9;
    // the strike falls off with the timing as it did before the line was widened: from 56 ms off, to 0.7 at 140 ms
    const f0 = (0.056 - METER_SQUARE) / METER_SPAN, f1 = (0.14 - METER_SQUARE) / METER_SPAN;
    contact = 1 - 0.3 * clamp((Math.abs(f) - f0) / (f1 - f0), 0, 1);
  }
  if (power > 1.04) contact -= (power - 1.04) * 2.2;
  contact = clamp(contact, 0.35, 1);
  let lift = 1;
  let label: Strike["label"];
  if (contact > 0.93) label = "PURE";
  else if (contact > 0.8) label = "SOLID";
  else {
    if (rng() > 0.5) {
      label = "THIN";
      lift = 0.55;
    } else {
      label = "FAT";
      lift = 1.15;
      contact -= 0.06;
    }
  }
  const sp = Math.abs(power) > 1 ? 1 : power;
  const chipped = chip && s.src !== "remote";
  let speed = (chipped ? sfOfChip(club, sp) : sfOf(sp)) * (1 + clamp(power - 1, 0, 0.15) * 0.15);
  const overTop = s.over && s.src !== "gesture";
  if (overTop) {
    // over the top: the same hooked, poor contact every time, and never more than OVER_CARRY of a pure swing
    contact = Math.min(contact, OVER_CONTACT);
    speed = overSpeed(club) * (chipped ? chipTop(club) : 1);
  }
  return { power, face, curve, contact, lift, label, speed, overTop };
}
