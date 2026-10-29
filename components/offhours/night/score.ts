import { ENGINE_CAL } from "../engineRemote";

// Drift scoring. While the car slides (past a body angle, at speed) it earns
// points a second in proportion to the angle and the speed, and a combo
// multiplier climbs the longer the slide lasts. The points are not yours yet:
// they bank when the car has been straight for a moment. A new slide that
// starts before they bank chains onto the same combo (+1), which is how an
// S-bend becomes one long score. Hit the wall, or spin, and what was unbanked
// is lost. A slide pays more the faster it is (a slow one at the minimum speed
// pays a third of one at full tilt) and more in a corner than on a straight
// (a wiggle on straight road pays 40%: otherwise a slalom down the straights
// out-scores the canyon). Pure, so it is unit-tested; the numbers are ENGINE_CAL.drift.

const C = ENGINE_CAL.drift;

export type Drift = {
  /** points earned this chain, before the multiplier */
  base: number;
  /** the multiplier now (0 when there is nothing pending) */
  combo: number;
  sliding: boolean;
  /** seconds in this slide, and seconds since it ended */
  slideT: number;
  cleanT: number;
  /** time to the next combo step */
  stepT: number;
  /** banked this run, and the best single bank */
  total: number;
  best: number;
};

export const newDrift = (): Drift => ({ base: 0, combo: 0, sliding: false, slideT: 0, cleanT: 0, stepT: 0, total: 0, best: 0 });

/** What a step did, so the game can toast and sound it. */
export type DriftEvent = { kind: "none" | "chain" | "bank" | "lost"; points: number; combo: number };

const NONE: DriftEvent = { kind: "none", points: 0, combo: 0 };
const ev: DriftEvent = { kind: "none", points: 0, combo: 0 };
const out = (kind: DriftEvent["kind"], points: number, combo: number) => {
  ev.kind = kind;
  ev.points = points;
  ev.combo = combo;
  return ev;
};

/** Points waiting to be banked, with the multiplier. */
export const pending = (d: Drift) => Math.round(d.base * Math.max(1, d.combo));

/** Is a car at this body angle (rad) and speed (m/s) sliding? */
export const isSliding = (slip: number, speed: number) => Math.abs(slip) * (180 / Math.PI) >= C.minAngleDeg && speed >= C.minSpeedMs;

/** Points a second for a slide at this angle (rad) and speed, before the multiplier: the speed counts twice (once as the distance covered, once as the nerve it takes). */
export function driftRate(slip: number, speed: number): number {
  const deg = Math.min(C.maxAngleDeg, Math.abs(slip) * (180 / Math.PI));
  return C.pointsPerDegMs * deg * speed * (speed / C.refSpeedMs);
}

/** How much of a slide's pay it earns on road with this curvature (rad/m): all of it in a corner of radius refRadiusM or tighter, straightPay on the straight, and in between a share. */
export function cornerPay(kappa: number): number {
  const k = Math.min(1, Math.abs(kappa) * C.refRadiusM);
  return C.straightPay + (1 - C.straightPay) * k;
}

/** Advance the scoring `dt` seconds on road of curvature `kappa` (omitted: a corner). The returned event is reused: read it before the next call. */
export function stepDrift(d: Drift, slip: number, speed: number, dt: number, kappa?: number): DriftEvent {
  if (isSliding(slip, speed)) {
    let kind: DriftEvent["kind"] = "none";
    if (!d.sliding) {
      // a slide that starts before the last was banked chains onto it
      if (d.combo > 0) {
        d.combo = Math.min(C.comboMax, d.combo + 1);
        kind = "chain";
      } else d.combo = 1;
      d.sliding = true;
      d.slideT = 0;
      d.stepT = 0;
    }
    d.cleanT = 0;
    d.slideT += dt;
    d.stepT += dt;
    if (d.stepT >= C.comboEveryS) {
      d.stepT -= C.comboEveryS;
      d.combo = Math.min(C.comboMax, d.combo + 1);
      kind = "chain";
    }
    d.base += driftRate(slip, speed) * (kappa === undefined ? 1 : cornerPay(kappa)) * dt;
    return kind === "chain" ? out("chain", pending(d), d.combo) : NONE;
  }
  d.sliding = false;
  if (d.combo > 0) {
    d.cleanT += dt;
    if (d.cleanT >= C.bankStraightS) return bank(d);
  }
  return NONE;
}

function bank(d: Drift): DriftEvent {
  const pts = pending(d);
  const combo = d.combo;
  d.total += pts;
  d.best = Math.max(d.best, pts);
  d.base = 0;
  d.combo = 0;
  d.cleanT = 0;
  d.sliding = false;
  return out("bank", pts, combo);
}

/** Bank what is waiting right now (the run ended while it was pending). */
export function bankNow(d: Drift): DriftEvent {
  return d.combo > 0 ? bank(d) : NONE;
}

/** The wall, or a spin: everything unbanked is gone. Returns what was lost. */
export function loseDrift(d: Drift): DriftEvent {
  const lost = pending(d);
  const combo = d.combo;
  d.base = 0;
  d.combo = 0;
  d.sliding = false;
  d.slideT = 0;
  d.cleanT = 0;
  return lost > 0 ? out("lost", lost, combo) : NONE;
}
