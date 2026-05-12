import { describe, it, expect } from "vitest";
import {
  KONAMI_SEQUENCE,
  findWordTrigger,
  isKonamiMatch,
  isLetterKey,
  pushKonamiKey,
} from "@/lib/easter-eggs/matchers";

describe("isKonamiMatch", () => {
  it("matches the exact sequence", () => {
    expect(isKonamiMatch([...KONAMI_SEQUENCE])).toBe(true);
  });

  it("matches case-insensitively for the BA suffix", () => {
    const upper = [...KONAMI_SEQUENCE.slice(0, 8), "B", "A"];
    expect(isKonamiMatch(upper)).toBe(true);
  });

  it("rejects a wrong-length buffer", () => {
    expect(isKonamiMatch(KONAMI_SEQUENCE.slice(0, 9))).toBe(false);
    expect(isKonamiMatch([...KONAMI_SEQUENCE, "extra"])).toBe(false);
  });

  it("rejects an out-of-order sequence", () => {
    const scrambled = [...KONAMI_SEQUENCE.slice(0, 8), "x", "a"];
    expect(isKonamiMatch(scrambled)).toBe(false);
  });

  it("rejects an empty buffer", () => {
    expect(isKonamiMatch([])).toBe(false);
  });
});

describe("pushKonamiKey", () => {
  it("appends a key when under capacity", () => {
    expect(pushKonamiKey(["a"], "b")).toEqual(["a", "b"]);
  });

  it("slides the window when over capacity", () => {
    const full = [...KONAMI_SEQUENCE];
    const next = pushKonamiKey(full, "z");
    expect(next).toHaveLength(KONAMI_SEQUENCE.length);
    expect(next[next.length - 1]).toBe("z");
    expect(next[0]).toBe(KONAMI_SEQUENCE[1]); // first element fell off
  });

  it("does not mutate the input buffer", () => {
    const buf = ["a", "b"];
    pushKonamiKey(buf, "c");
    expect(buf).toEqual(["a", "b"]);
  });
});

describe("findWordTrigger", () => {
  it("returns the trigger when buffer ends with one", () => {
    expect(findWordTrigger("hellobarca")).toBe("barca");
    expect(findWordTrigger("siu")).toBe("siu");
    expect(findWordTrigger("typingneymar")).toBe("neymar");
  });

  it("returns null when no trigger matches", () => {
    expect(findWordTrigger("hello world")).toBe(null);
    expect(findWordTrigger("barc")).toBe(null);
    expect(findWordTrigger("")).toBe(null);
  });

  it("matches accented barça variant", () => {
    expect(findWordTrigger("forçabarça")).toBe("barça");
  });

  it("only matches at the end of buffer", () => {
    expect(findWordTrigger("siuhello")).toBe(null);
  });
});

describe("isLetterKey", () => {
  it.each([
    ["a", true],
    ["Z", true],
    ["ç", true],
    ["ñ", true],
    ["1", false],
    [" ", false],
    ["ArrowUp", false],
    ["Enter", false],
    ["", false],
  ])("isLetterKey(%j) === %j", (key, expected) => {
    expect(isLetterKey(key)).toBe(expected);
  });
});
