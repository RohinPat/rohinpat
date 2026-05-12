// Pure matchers for the site-wide easter eggs. Tested in isolation.

export const KONAMI_SEQUENCE = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
] as const;

export const WORD_TRIGGERS = [
  "siu",
  "barca",
  "barça",
  "neymar",
  "messi",
  "goal",
  "visca",
] as const;

export type WordTrigger = (typeof WORD_TRIGGERS)[number];

/** True iff buffer exactly matches the konami sequence (case-insensitive). */
export function isKonamiMatch(buffer: readonly string[]): boolean {
  if (buffer.length !== KONAMI_SEQUENCE.length) return false;
  return buffer.every(
    (k, i) => k.toLowerCase() === KONAMI_SEQUENCE[i].toLowerCase(),
  );
}

/** Push key onto buffer, trimming to length of konami sequence. */
export function pushKonamiKey(buffer: string[], key: string): string[] {
  const next = [...buffer, key];
  if (next.length > KONAMI_SEQUENCE.length) next.shift();
  return next;
}

/** Returns the trigger word if the buffer ends with one, else null. */
export function findWordTrigger(buffer: string): WordTrigger | null {
  for (const w of WORD_TRIGGERS) {
    if (buffer.endsWith(w)) return w;
  }
  return null;
}

/** True for any printable letter that the word buffer should accumulate. */
export function isLetterKey(key: string): boolean {
  return key.length === 1 && /[a-zçñ]/i.test(key);
}
