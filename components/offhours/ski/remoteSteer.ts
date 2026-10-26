// The slalom when a linked phone is the controller: the phone's handlebar roll
// becomes the same steer the arrow keys feed (-1..1), and its tuck the same
// tuck the Down arrow / Space holds. Pure, so it is unit-tested; everything
// real use will need to tune is in POWDER_CAL.
//
// Phone: held upright like handlebars, landscape or portrait. Turning it like
// a steering wheel carves (clockwise = right); tipping the top edge away from
// you ("leaning over the bars"), or holding the big on-screen button, tucks.
// The phone sends axes:
//   "steer"  -1..1  wheel angle (or the touch halves)
//   "tuck"    0..1  forward lean, or 1 while the button is held

export const POWDER_CAL = {
  /** Phone side. Wheel angle (deg) that is full lock, and the dead zone around the neutral pose. */
  steerRangeDeg: 38,
  steerDeadDeg: 5,
  /** Phone side: forward tilt (deg) that is a full tuck, and its dead zone */
  tuckRangeDeg: 22,
  tuckDeadDeg: 7,
  /** Phone side: smoothing of the wheel before it is sent, s */
  phoneSmoothingS: 0.07,
  /** Phone side: a wheel angle past this (deg) for this long (s) means the phone was turned to another orientation after opening, so its pose becomes straight ahead */
  autoRecentreDeg: 60,
  autoRecentreS: 1.2,
  /** Phone side: touch halves take this long (s) to ramp from 0 to full lock, so a tap is a nudge and a hold a carve */
  touchRampS: 0.28,
  /** Laptop side. Ease toward what the phone last said, s */
  smoothingS: 0.07,
  /** Laptop side: dead zone and response curve of the steer (1 = linear, higher = gentler near the middle) */
  deadZone: 0.03,
  curve: 1.35,
  /** Laptop side: the tuck axis is "tucked" above `tuckOn` and released below `tuckOff` (hysteresis) */
  tuckOn: 0.5,
  tuckOff: 0.3,
};
