// The line of advice on the end card: one thing to do better, picked from how
// the run went. Pure, so it is unit-tested. It reads only what the result holds.

export type AdviceInput = {
  finished: boolean;
  checkpoints: number;
  rails: number;
  railS: number;
  spins: number;
  driftTotal: number;
  bestDrift: number;
  score: number;
  vsTargetS: number | null;
};

/** this many rail incidents in a run is what the advice is about */
export const MANY_RAILS = 5;

const secs = (s: number) => `${Math.round(s)} S`;

/** The advice for a run, in capitals, short enough for one line of the card. `touch` names the drift button and not the key. */
export function adviceFor(r: AdviceInput, touch: boolean): string {
  if (r.rails >= MANY_RAILS) return `${r.rails} RAIL HITS TOOK ${secs(r.railS)}. BRAKE AT THE WARNING`;
  if (!r.finished) return "BRAKE LATER AND GET BACK ON THE GAS SOONER";
  if (r.spins >= 2) return "TWO SPINS. LESS HANDBRAKE, MORE COUNTER-STEER";
  if (r.score > 0 && r.driftTotal < r.score * 0.22) return touch ? "TAP DRIFT AS YOU TURN IN TO SLIDE FOR POINTS" : "TAP SHIFT AS YOU TURN IN TO SLIDE FOR POINTS";
  if (r.vsTargetS !== null && r.vsTargetS > 3) return `THE TARGET WAS ${secs(r.vsTargetS)} AHEAD. BRAKE LATER`;
  if (r.rails >= 1) return `${r.rails} RAIL HIT${r.rails > 1 ? "S" : ""} TOOK ${secs(r.railS)}. CLEAN LEGS PAY EXTRA`;
  return "A CLEAN RUN. LONGER SLIDES BANK MORE";
}
