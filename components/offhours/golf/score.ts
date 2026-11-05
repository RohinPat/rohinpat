import { callFor } from "./green";

// Strokes against par for a round: a hole ends in the cup or with a pick-up
// five over par (so a round always ends), the call for each hole, and the best
// round of this visit, kept in a variable (nothing is stored).

/** the ball is picked up at par plus this */
export const PICK_UP_OVER = 5;

export type HoleScore = { strokes: number; pickedUp: boolean; call: string };

/** the score for a hole that took `played` strokes (a pick-up caps it at par + 5) */
export function holeScore(played: number, par: number, pickedUp = false): HoleScore {
  const cap = par + PICK_UP_OVER;
  const up = pickedUp || played >= cap;
  const strokes = Math.min(played, cap);
  return { strokes, pickedUp: up && played >= cap, call: up && played >= cap ? "PICK UP" : callFor(strokes, par) };
}

export const shouldPickUp = (played: number, par: number) => played >= par + PICK_UP_OVER;

/** "E", "+3", "-1" */
export const toPar = (strokes: number, par: number) => (strokes === par ? "E" : strokes > par ? `+${strokes - par}` : `${strokes - par}`);

/** a line for the live region and the card: "4 OVER PAR", "EVEN PAR" */
export const overUnder = (strokes: number, par: number) => (strokes === par ? "EVEN PAR" : strokes > par ? `${strokes - par} OVER PAR` : `${par - strokes} UNDER PAR`);

// ---- best of this visit: a module variable, gone on reload
const best = new Map<number, number>();

/** record a finished round of `holes` holes; says whether it is the best of this visit so far, and the best before it */
export function recordRound(total: number, holes: number): { isBest: boolean; previous: number | null; best: number } {
  const previous = best.get(holes) ?? null;
  const isBest = previous === null || total < previous;
  if (isBest) best.set(holes, total);
  return { isBest, previous, best: best.get(holes)! };
}
export const bestRound = (holes: number) => best.get(holes) ?? null;
export function forgetBest() {
  best.clear();
}
