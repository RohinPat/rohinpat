import { ENGINE_CAL } from "./engineRemote";

// The engine both Cars modes share: a torque curve, six gear ratios, an engine
// speed that follows the wheels (with a little clutch slip off the line), and
// an automatic gearbox for Night run. Pure numbers in, numbers out. The drag
// strip drives it by hand; Night run's car drives it through its wheels.
//
// Every number is in ENGINE_CAL (engine, gearbox).

const E = ENGINE_CAL.engine;
const GB = ENGINE_CAL.gearbox;

export const RATIOS = E.ratios;
export const FINAL = E.final;
export const WHEEL = E.wheelM;
export const IDLE = E.idle;
export const SHIFT_AT = E.shiftAt;
export const REDLINE = E.redline;
export const LIMIT = E.limit;
export const TOP_GEAR = RATIOS.length - 1;

/** Engine speed (rpm) the wheels would turn it at, at road speed `v` (m/s) in gear `g`. */
export const wheelRpm = (v: number, g: number) => (v / (2 * Math.PI * WHEEL)) * 60 * RATIOS[g] * FINAL;

/** Road speed (m/s) at `rpm` in gear `g`. */
export const speedAt = (rpm: number, g: number) => (rpm / 60 / (RATIOS[g] * FINAL)) * 2 * Math.PI * WHEEL;

/** Nm: builds to a broad peak around 5.5k, falls off past 7k. */
export function torque(rpm: number) {
  const x = rpm / 1000;
  return Math.max(0, 420 + 95 * x - 9.5 * x * x - (x > 7 ? (x - 7) * 260 : 0));
}

/** Force at the tyres (N) with the pedal `pedal` (0..1) down at `rpm` in gear `g`, before any limit on grip. */
export const tractiveForce = (rpm: number, g: number, pedal: number) => ((torque(rpm) * RATIOS[g] * FINAL * 0.9) / WHEEL) * pedal;

/**
 * Where the engine speed goes next: tied to the wheels, but never under idle,
 * and with some clutch slip off the line (the revs hold up against the pedal
 * until the car is rolling), smoothed so a shift dips and recovers.
 */
export function engineRpm(rpm: number, v: number, gear: number, pedal: number, dt: number, shifting: boolean): number {
  const coupled = wheelRpm(v, gear);
  const launch = IDLE + pedal * 4300 * Math.max(0, 1 - v / 9);
  const target = Math.max(coupled, launch);
  const next = rpm + (target - rpm) * Math.min(1, dt * (shifting ? 18 : 10));
  return Math.min(LIMIT + 60, Math.max(IDLE, next));
}

/** The automatic gearbox: the gear it wants (the same one to stay put). */
export function autoGear(gear: number, rpm: number, pedal: number, braking: boolean): number {
  const p = Math.max(0, Math.min(1, pedal));
  const up = GB.upRpmLight + (GB.upRpmFull - GB.upRpmLight) * p;
  const down = GB.downRpmLight + (GB.downRpmFull - GB.downRpmLight) * p;
  if (gear < TOP_GEAR && rpm >= up) return gear + 1;
  if (gear > 0) {
    const after = (rpm * RATIOS[gear - 1]) / RATIOS[gear];
    if (rpm < down) return gear - 1;
    // braking in a gear that is lugging: take the lower one while it will not over-rev
    if (braking && rpm < GB.brakeDownRpm && after < LIMIT - 900) return gear - 1;
  }
  return gear;
}

/** Torque is cut for this long after a shift, s. */
export const SHIFT_CUT_S = GB.cutS;
/** The gearbox leaves a shift alone for this long, s. */
export const SHIFT_HOLD_S = GB.holdS;
