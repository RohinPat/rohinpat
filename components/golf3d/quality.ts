// How much the course draws, and a governor that turns it down when frames run
// slow. Each level has its own pixel budget and shadows. A phone starts lower
// than a desktop, and a phone with few cores or little memory lower again. The
// governor watches the frame times and drops one level when the median frame of
// a stretch of play is slower than about 48 fps. It never steps back up, so it
// cannot see-saw between two levels. A frame longer than LONG_MS (a new hole
// being built, the tab hidden) is not counted, and nothing is judged for a
// moment after a change.

export type Shadows = "soft" | "hard" | "off";
export type Level = { pixels: number; shadows: Shadows; shadowMap: number; tier: "high" | "low" | "soft" };

/** from the best picture to the cheapest; `pixels` is a cap in device pixels (the desktop's own cap applies at 0) */
export const LEVELS: Level[] = [
  { pixels: 2.4e6, shadows: "soft", shadowMap: 2048, tier: "high" },
  { pixels: 1.0e6, shadows: "hard", shadowMap: 1024, tier: "low" },
  { pixels: 0.6e6, shadows: "hard", shadowMap: 512, tier: "low" },
  { pixels: 0.36e6, shadows: "off", shadowMap: 512, tier: "soft" },
];

/** frames judged at a time */
export const WINDOW = 90;
/** a median frame slower than this (ms) drops a level */
export const SLOW_MS = 21;
/** a frame longer than this (ms) is a hitch, not the frame rate */
export const LONG_MS = 120;
/** after a change, frames are not judged for this long (ms) */
export const SETTLE_MS = 1200;

export type DeviceHints = { touch: boolean; cores?: number; memoryGB?: number };

/** where a device starts: a desktop at the top, a phone one down, a small phone two down */
export function startLevel(d: DeviceHints): number {
  if (!d.touch) return 0;
  const small = (d.cores !== undefined && d.cores <= 4) || (d.memoryGB !== undefined && d.memoryGB <= 3);
  return small ? 2 : 1;
}

export class Governor {
  level: number;
  private frames: number[] = [];
  private settle = SETTLE_MS;
  constructor(start: number) {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, start));
  }
  /** a frame took `ms`; true when the level dropped */
  frame(ms: number): boolean {
    if (!(ms > 0) || ms > LONG_MS) return false;
    if (this.settle > 0) {
      this.settle -= ms;
      return false;
    }
    this.frames.push(ms);
    if (this.frames.length < WINDOW) return false;
    const sorted = [...this.frames].sort((a, b) => a - b);
    this.frames = [];
    if (sorted[sorted.length >> 1] <= SLOW_MS || this.level >= LEVELS.length - 1) return false;
    this.level++;
    this.settle = SETTLE_MS;
    return true;
  }
  /** something else stalled the frames for a while (a new hole): start the count again */
  hold() {
    this.frames = [];
    this.settle = SETTLE_MS;
  }
}
