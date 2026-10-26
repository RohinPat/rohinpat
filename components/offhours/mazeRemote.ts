// The maze when a linked phone is the controller: the phone's two axes become
// the same turn / walk the arrow keys and the drag-stick feed. Pure, so it is
// unit-tested; everything real use will need to tune is in MAZE_CAL.
//
// Phone: held flat, screen up, like a tray with a marble on it. Tilting the
// top edge down rolls the "ball" away from you = walk forward; right edge
// down = turn right. The phone sends two axes, -1..1:
//   "x"  turn  (+ = right)
//   "y"  walk  (+ = forward, - = back)

export const MAZE_CAL = {
  /** Phone side. Tilt (deg) from the neutral pose that is full turn / full walk, and the dead zone. */
  turnRangeDeg: 20,
  walkRangeDeg: 18,
  deadZoneDeg: 3,
  /** +1 if tipping the top edge down (screen toward the floor) walks forward; -1 flips it */
  forwardSign: 1 as 1 | -1,
  /** Phone side: smoothing of the tilt before it is sent, s */
  phoneSmoothingS: 0.08,
  /** Phone side: the touch joystick's travel, px (full deflection) and its dead zone, px */
  stickRadiusPx: 78,
  stickDeadPx: 8,
  /** Laptop side. Ease toward what the phone last said, s (about 2 frames of the 30 Hz stream) */
  smoothingS: 0.06,
  /** Laptop side: dead zone and response curve (1 = linear, higher = gentler near the middle) */
  deadZone: 0.04,
  curve: 1.5,
  /** Laptop side: how hard a full tilt drives, as a multiple of the keys' turn / walk speed */
  turnGain: 1,
  walkGain: 1,
  /** A phone tilt this big takes over from a solver that is running (switches to "You") */
  engageAt: 0.3,
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Tilt angles (deg from neutral, + = right edge down / top edge down) to the phone's two axes. */
export function tiltAxes(leanDeg: number, forwardDeg: number, cal = MAZE_CAL): { x: number; y: number } {
  const dz = cal.deadZoneDeg;
  const one = (d: number, range: number) => {
    const a = Math.abs(d);
    return a <= dz ? 0 : Math.sign(d) * clamp((a - dz) / (range - dz), 0, 1);
  };
  // the filter forwardDeg is + when the top edge is lowered (tipped away from you): that rolls the marble forward
  return { x: one(leanDeg, cal.turnRangeDeg), y: one(forwardDeg * cal.forwardSign, cal.walkRangeDeg) };
}

/** The touch joystick: a thumb offset from where it came down (px, y down) to the same two axes. */
export function stickAxes(dx: number, dy: number, cal = MAZE_CAL): { x: number; y: number } {
  const one = (d: number) => (Math.abs(d) < cal.stickDeadPx ? 0 : clamp(d / cal.stickRadiusPx, -1, 1));
  return { x: one(dx), y: one(-dy) };
}
