// Pairing codes: what the host shows as text and the phone types or reads from
// `#c=CODE`. The relay decides the real format; this only tidies what a person
// types (case, spaces, dashes) and says whether a string could be a code.

/** Upper-case letters and digits only, so "k7q-f2x" and "K7Q F2X" both work. */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function looksLikeCode(code: string): boolean {
  return /^[A-Z0-9]{4,12}$/.test(code);
}

/** `#c=CODE` (or `c=CODE&x=y`) from a URL fragment, or null. */
export function codeFromHash(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of h.split("&")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === "c") {
      let raw = part.slice(eq + 1);
      try {
        raw = decodeURIComponent(raw);
      } catch {
        /* keep it as typed */
      }
      const code = normaliseCode(raw);
      return looksLikeCode(code) ? code : null;
    }
  }
  return null;
}

/** "K7QF2X" -> "K7Q F2X": easier to read aloud and to type. */
export function formatCode(code: string): string {
  return code.length > 4 ? code.replace(/(.{3})(?=.)/g, "$1 ") : code;
}
