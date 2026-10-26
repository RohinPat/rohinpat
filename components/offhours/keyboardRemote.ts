// A keystroke that came from a linked phone, turned into the key the 3D board
// presses. Pure, so it is unit-tested; the tunables are in KEYS_CAL.
//
// The phone sends gesture "key" {k}: k is one typed character ("a", "A", "!", " ")
// or a name ("Backspace", "Enter"). The board wants a KeyboardEvent-style code
// ("KeyA", "Digit1", "Space") to press, whether Shift is part of it, and the
// character the typed strip should show.

export const KEYS_CAL = {
  /** how long a phone keystroke stays down on the 3D board, ms (a quick typist's dwell) */
  holdMs: 75,
  /** the most keys one input burst is played (a paste or a predictive-text insert), phone side */
  maxBurst: 24,
};

export type RemoteKey = {
  /** KeyboardEvent.code of the key to press */
  code: string;
  /** what the typed strip shows (undefined: not a character) */
  char?: string;
  /** the character needs Shift (capitals, ! @ # ...) */
  shift: boolean;
};

const PLAIN: Record<string, string> = {
  " ": "Space",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "`": "Backquote",
};
const SHIFTED: Record<string, string> = {
  "!": "Digit1",
  "@": "Digit2",
  "#": "Digit3",
  $: "Digit4",
  "%": "Digit5",
  "^": "Digit6",
  "&": "Digit7",
  "*": "Digit8",
  "(": "Digit9",
  ")": "Digit0",
  _: "Minus",
  "+": "Equal",
  "{": "BracketLeft",
  "}": "BracketRight",
  "|": "Backslash",
  ":": "Semicolon",
  '"': "Quote",
  "<": "Comma",
  ">": "Period",
  "?": "Slash",
  "~": "Backquote",
};
const NAMED = new Set(["Backspace", "Enter", "Tab", "Escape", "Delete"]);

/** The key for a phone's `k`, or null if the board has no such key (an emoji, an accent, junk). */
export function keyFromRemote(k: unknown): RemoteKey | null {
  if (typeof k !== "string" || !k) return null;
  if (NAMED.has(k)) return { code: k, shift: false };
  if (Array.from(k).length !== 1) return null;
  if (/^[a-z]$/.test(k)) return { code: `Key${k.toUpperCase()}`, char: k.toUpperCase(), shift: false };
  if (/^[A-Z]$/.test(k)) return { code: `Key${k}`, char: k, shift: true };
  if (/^[0-9]$/.test(k)) return { code: `Digit${k}`, char: k, shift: false };
  if (PLAIN[k]) return { code: PLAIN[k], char: k, shift: false };
  if (SHIFTED[k]) return { code: SHIFTED[k], char: k, shift: true };
  return null;
}
