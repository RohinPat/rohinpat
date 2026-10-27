// The laptop end of a continuous phone control (an `axis` message). The phone
// sends a value only when it changes, so between messages the last one holds;
// the game reads `value` every frame, and it eases toward the target so a
// 30 Hz stream does not turn into steps. Pure, so it is unit-tested.

export interface AxisSmoother {
  /** the latest value the phone sent */
  set(target: number): void;
  /** call once a frame; returns the smoothed value */
  update(dt: number): number;
  /** where it is now */
  readonly value: number;
  /** snap to 0 (phone gone, game restarted) */
  reset(): void;
}

/** `tauS`: seconds to cover ~63% of a jump. 0 = no smoothing. */
export function createAxisSmoother(tauS: number): AxisSmoother {
  let target = 0;
  let v = 0;
  return {
    set(t) {
      target = Number.isFinite(t) ? t : 0;
    },
    update(dt) {
      v = tauS <= 0 ? target : v + (target - v) * (1 - Math.exp(-Math.max(0, dt) / tauS));
      if (Math.abs(v - target) < 1e-4) v = target;
      return v;
    },
    get value() {
      return v;
    },
    reset() {
      target = 0;
      v = 0;
    },
  };
}

/** Dead zone, then a power curve: fine control near the middle, full travel at the edge. v is -1..1. */
export function shape(v: number, deadZone: number, curve: number): number {
  const a = Math.min(1, Math.abs(v));
  if (a <= deadZone) return 0;
  return Math.sign(v) * Math.pow((a - deadZone) / (1 - deadZone), curve);
}

/** A 0..1 control read as pressed/released, with hysteresis so noise at the threshold does not flutter. */
export function hysteresis(prev: boolean, v: number, on: number, off: number): boolean {
  return prev ? v > off : v >= on;
}
