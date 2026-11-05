import { FINISH_BASE, FINISH_PER_S, START_S } from "./run";

// The numbers the page shows: a fitness as a height on the little chart, and
// the best so far as a short caps line. Pure, so they are unit-tested.

/**
 * A fitness as 0..1 for the chart. Short of the finish the height is how far
 * along the road the car got (up to 0.7); a finish lifts it to 0.7, and a
 * quicker one climbs from there.
 */
export function chartValue(fitness: number, length: number, capS: number): number {
  const finishAt = length - START_S + FINISH_BASE;
  if (fitness >= finishAt) {
    const underCap = Math.min(1, (fitness - finishAt) / (FINISH_PER_S * capS));
    return 0.7 + 0.3 * Math.min(1, underCap * 2);
  }
  return Math.max(0, Math.min(0.7, (0.7 * fitness) / length));
}

/** seconds as m:ss.t */
export function clock(s: number): string {
  const t = Math.round(s * 10);
  const m = Math.floor(t / 600);
  const r = t - m * 600;
  return `${m}:${String(Math.floor(r / 10)).padStart(2, "0")}.${r % 10}`;
}

/** the best so far: its time once a car has finished, else how far it has got */
export function bestText(c: { finished: boolean; time: number; dist: number } | null): string {
  if (!c) return "BEST -";
  return c.finished ? `BEST ${clock(c.time)}` : `BEST ${(c.dist / 1000).toFixed(1)} KM`;
}
