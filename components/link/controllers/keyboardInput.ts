// How the phone's keyboard controller reads a text field. The field always
// holds a hidden sentinel so a backspace on "nothing" still has something to
// delete (iOS fires no event on an empty field), and every input event is
// turned into the keys that got the field from what was already sent to what
// it holds now: a few Backspaces, then the new characters.

/** a zero-width space: the thing backspace deletes when the visitor has typed nothing */
export const SENTINEL = "\u200b";

/** The keys that turn `shown` into `cur`: Backspace for each character taken off the end, then what's new. */
export function diffTyped(shown: string, cur: string): string[] {
  const a = Array.from(shown);
  const b = Array.from(cur);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array<string>(a.length - i).fill("Backspace"), ...b.slice(i)];
}

/**
 * Read a field's value after an input event. `shown` is what has been sent so
 * far in this buffer (it only grows while an IME is composing; otherwise it is
 * empty because the field is reset after every event). Returns the keys to
 * send and the new `shown`.
 */
export function readField(value: string, shown: string, composing: boolean): { keys: string[]; shown: string } {
  const cur = value.split(SENTINEL).join("");
  // the sentinel is gone and nothing else is there: that was a backspace on an empty field
  const extra = !composing && !value.includes(SENTINEL) && value === "" ? ["Backspace"] : [];
  return { keys: [...extra, ...diffTyped(shown, cur)], shown: cur };
}
