import { emaAlpha, norm, safeDt } from "./math";
import type { MotionSample } from "./types";

/**
 * "Is the phone being held still?" with exactly the smoothing the golf
 * recogniser uses to arm itself (smoothed |gyro| under quietRate for holdS),
 * so a UI saying "Swing!" agrees with a detector that is actually armed.
 */
export interface StillGate {
  /** feed one sample; returns true once it has been still long enough, and stays true until it moves */
  push(s: MotionSample): boolean;
  readonly ready: boolean;
  reset(): void;
}

export function createStillGate(options: { quietRate?: number; holdS?: number } = {}): StillGate {
  const quietRate = options.quietRate ?? 0.7;
  const holdS = options.holdS ?? 0.3;
  let sm = 0;
  let last: number | null = null;
  let quietFrom: number | null = null;
  let ready = false;
  return {
    push(s) {
      const dt = last === null ? 0.016 : safeDt(s.t - last);
      last = s.t;
      sm += emaAlpha(dt, 0.08) * (norm(s.gyro) - sm);
      if (sm < quietRate) {
        quietFrom ??= s.t;
        if (s.t - quietFrom >= holdS) ready = true;
      } else {
        quietFrom = null;
        ready = false;
      }
      return ready;
    },
    get ready() {
      return ready;
    },
    reset() {
      sm = 0;
      last = null;
      quietFrom = null;
      ready = false;
    },
  };
}
