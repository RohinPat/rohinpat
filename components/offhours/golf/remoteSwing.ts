// A swing that came from a linked phone, turned into the numbers the driving
// range's strike() takes. Pure, so it is unit-tested; and every constant that
// real recordings will need to tune is in GOLF_CAL, here and nowhere else.
//
// The phone's golf recogniser (lib/motion/golf.ts) reports clubSpeedMph (peak
// angular speed x an assumed pivot radius), tempo (backswing / downswing time)
// and faceAngleDeg (twist about the shaft from address to impact). The range
// wants a power (0..1 of a full backswing, up to 1.15), a start line (`face`),
// a curve and a contact quality.

export const GOLF_CAL = {
  /** pivot-to-clubhead radius the phone's recogniser assumes, metres (sets what "mph" means) */
  radiusM: 1.4,
  /**
   * The phone speed that is a full, pure swing with each club, mph, in the
   * range's club order (driver, 3 wood, 5 iron, 7 iron, PW, SW). A casual
   * 85-95 mph swing is a full driver or wood; shorter clubs are fuller at lower speeds.
   */
  fullMph: [92, 90, 86, 82, 76, 70],
  /** below this fraction of full speed the ball is barely moved (the range's own floor: 30% of ball speed) */
  floorRatio: 0.3,
  /** how much of a swing past full speed counts (so an enthusiastic wedge isn't a mishit) */
  overRatioGain: 0.25,
  /** the most that over-speed adds to power */
  overPowerMax: 0.06,
  /** the tempo (backswing : downswing) that costs nothing, and the cost per unit of difference, capped */
  idealTempo: 3,
  tempoCostPerUnit: 0.08,
  tempoCostMax: 0.3,
  /** face angle at impact that sends the ball as wide as the range goes, degrees */
  faceFullDeg: 12,
  /** +1 if a positive faceAngleDeg opens the face (ball goes right); -1 if real recordings say it closes it */
  faceSign: 1 as 1 | -1,
  /** how far a full face error moves the start line (range's `face`, -1..1) and the curve */
  startLineGain: 0.7,
  curveGain: 0.8,
  /** face error (0..1) beyond which contact suffers, and by how much per unit */
  faceSlack: 0.55,
  faceCost: 0.5,
  /** a swing slower than this isn't taken as a swing at all (mph) */
  minMph: 15,
};

export type RemoteSwing = { speedMph: number; tempo: number; faceDeg: number };

export type RemoteShot = {
  /** range power: 0..1 is the backswing fraction, a little over 1 is over-swinging */
  power: number;
  face: number;
  curve: number;
  /** 1 pure ... lower thin or fat (the range applies its own over-power penalty after this) */
  contact: number;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Read a `golf-swing` gesture's data, or null if it isn't one. */
export function parseSwing(data: Record<string, number | string | boolean>): RemoteSwing | null {
  const speedMph = Number(data.speedMph);
  const tempo = Number(data.tempo);
  const faceDeg = Number(data.faceDeg);
  if (!Number.isFinite(speedMph) || speedMph < GOLF_CAL.minMph || speedMph > 300) return null;
  return {
    speedMph,
    tempo: Number.isFinite(tempo) ? tempo : GOLF_CAL.idealTempo,
    faceDeg: Number.isFinite(faceDeg) ? faceDeg : 0,
  };
}

/** Speed -> range power for a club. Ball speed follows club speed, so power is the fraction of full speed, re-expressed in the range's 0.3 + 0.7 * power terms. */
export function powerFromSpeed(speedMph: number, club: number): number {
  const full = GOLF_CAL.fullMph[clamp(Math.round(club), 0, GOLF_CAL.fullMph.length - 1)];
  const ratio = speedMph / full;
  if (ratio <= 1) return Math.max(0.05, (ratio - GOLF_CAL.floorRatio) / (1 - GOLF_CAL.floorRatio));
  return 1 + Math.min(GOLF_CAL.overPowerMax, (ratio - 1) * GOLF_CAL.overRatioGain);
}

export function shotFromSwing(swing: RemoteSwing, club: number): RemoteShot {
  const c = GOLF_CAL;
  const power = powerFromSpeed(swing.speedMph, club);
  const f = clamp((swing.faceDeg * c.faceSign) / c.faceFullDeg, -1, 1);
  let contact = 1;
  contact -= Math.min(c.tempoCostMax, Math.abs(swing.tempo - c.idealTempo) * c.tempoCostPerUnit);
  contact -= Math.max(0, Math.abs(f) - c.faceSlack) * c.faceCost;
  return { power, face: f * c.startLineGain, curve: f * c.curveGain, contact: clamp(contact, 0.35, 1) };
}

/** The inverse of powerFromSpeed: the phone speed (mph) that gives a range power with this club. The touch controller uses it. */
export function speedForPower(power: number, club: number): number {
  const full = GOLF_CAL.fullMph[clamp(Math.round(club), 0, GOLF_CAL.fullMph.length - 1)];
  if (power <= 1) return full * (GOLF_CAL.floorRatio + (1 - GOLF_CAL.floorRatio) * Math.max(0, power));
  return full * (1 + (power - 1) / GOLF_CAL.overRatioGain);
}
