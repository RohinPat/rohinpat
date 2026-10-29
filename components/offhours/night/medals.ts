// Medals: three score marks to chase on any run, so a second run has a next
// thing to go for (not only "beat your best"). Scores only: nothing is stored,
// the visit's best lives in game.ts. The marks come from driving the canyon
// with scripted drivers of different care (tests/unit/night-run.test.ts keeps
// them honest): a driver who floors it and never steers scores under the first,
// one who follows the racing line at the target driver's pace is a little over
// it, and the top mark takes drifting the corners on purpose.

export type Medal = { name: string; score: number };

export const MEDALS: Medal[] = [
  { name: "BRONZE", score: 20_000 },
  { name: "SILVER", score: 40_000 },
  { name: "GOLD", score: 65_000 },
];

/** How many medals this score has earned (0 to 3). */
export function medalsAt(score: number): number {
  let n = 0;
  for (const m of MEDALS) if (score >= m.score) n++;
  return n;
}

/** The next medal to earn from this score, or null at the top. */
export function nextMedal(score: number): Medal | null {
  return MEDALS[medalsAt(score)] ?? null;
}
