// The drag strip's ghost: the best quarter mile of this visit, kept as how far
// along the strip the car was every DRAG_GHOST_DT seconds, in memory only. The
// next run races it: a car in the other lane, and a live gap in seconds at the
// same distance. Pure, so it is unit-tested.

export const DRAG_GHOST_DT = 0.05;

/** a run as samples of distance (m) every DRAG_GHOST_DT seconds from the green, ending on the line */
export type DragPath = Float32Array;

/** how far along the strip the ghost is at run time `t` (it waits on the line when it has finished) */
export function ghostAt(path: DragPath, t: number): number {
  if (path.length === 0) return 0;
  const x = Math.max(0, t / DRAG_GHOST_DT);
  const i = Math.floor(x);
  if (i >= path.length - 1) return path[path.length - 1];
  return path[i] + (path[i + 1] - path[i]) * (x - i);
}

/** when the ghost was `m` metres along (s), or null if it never got that far */
export function ghostTimeAt(path: DragPath, m: number): number | null {
  const n = path.length;
  if (n === 0 || path[n - 1] < m) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (path[mid] < m) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  const a = path[lo - 1];
  const b = path[lo];
  return (lo - 1 + (b > a ? (m - a) / (b - a) : 0)) * DRAG_GHOST_DT;
}

/** seconds behind (+) or ahead (-) of the ghost, at this car's distance `m` at run time `t` (null before the ghost has anything to compare) */
export function gapToGhost(path: DragPath, t: number, m: number): number | null {
  const tg = ghostTimeAt(path, m);
  return tg === null ? null : t - tg;
}
