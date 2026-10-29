// Medals: three score marks to chase on any run, so a second run has a next
// thing to go for (not only "beat your best"). Scores only: nothing is stored,
// the visit's best lives in game.ts. The marks come from driving the canyon
// with scripted drivers of different care (tests/unit/cars-polish.test.ts keeps
// them honest): a driver who floors it and never steers scores about 17,800
// and gets nothing; one who follows the racing line at the target driver's pace
// is a little over bronze; a careful one on the keys clears silver; and one that
// flicks the handbrake into the corners reaches gold. A person will do better
// or worse than any of them: the marks are a guess at what feels earned.

export type Medal = { name: string; score: number };

export const MEDALS: Medal[] = [
  { name: "BRONZE", score: 20_000 },
  { name: "SILVER", score: 40_000 },
  { name: "GOLD", score: 60_000 },
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
