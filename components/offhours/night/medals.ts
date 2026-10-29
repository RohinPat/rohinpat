// Medals: three score marks to chase on any run, so a second run has a next
// thing to go for (not only "beat your best"). Scores only: nothing is stored,
// the visit's best lives in game.ts. The marks come from driving the canyon
// with scripted keyboard drivers of different care (tests/unit/cars-polish.test.ts
// keeps them honest): a driver who floors it and never steers is out of time
// before the end and scores about 3,500; one who steers but never brakes, or
// brakes only for the warning, is a little under bronze; a careful one, or one
// at the target driver's pace, is around it; one that kicks the handbrake into
// the corners is past silver; gold is what a clean, committed drifter reaches on
// a good run. A person will do better or worse than any of them: the marks are a
// guess at what feels earned.

export type Medal = { name: string; score: number };

export const MEDALS: Medal[] = [
  { name: "BRONZE", score: 15_000 },
  { name: "SILVER", score: 25_000 },
  { name: "GOLD", score: 34_000 },
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
