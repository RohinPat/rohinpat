import { describe, expect, it } from "vitest";
import { KEYS_CAL, keyFromRemote } from "@/components/offhours/keyboardRemote";
import { DECKS_CAL, OMEGA, angleDelta, scratchRate } from "@/components/offhours/decksRemote";
import { SENTINEL, diffTyped, readField } from "@/components/link/controllers/keyboardInput";

// keyboard: what a phone's typing becomes on the laptop's board

describe("keyFromRemote", () => {
  it("maps letters to their keys, capitals with Shift", () => {
    expect(keyFromRemote("a")).toEqual({ code: "KeyA", char: "A", shift: false });
    expect(keyFromRemote("Z")).toEqual({ code: "KeyZ", char: "Z", shift: true });
  });
  it("maps digits, space and plain punctuation", () => {
    expect(keyFromRemote("7")).toEqual({ code: "Digit7", char: "7", shift: false });
    expect(keyFromRemote(" ")).toEqual({ code: "Space", char: " ", shift: false });
    expect(keyFromRemote(".")).toEqual({ code: "Period", char: ".", shift: false });
    expect(keyFromRemote("'")).toEqual({ code: "Quote", char: "'", shift: false });
  });
  it("maps shifted symbols to the key under them, with Shift", () => {
    expect(keyFromRemote("!")).toEqual({ code: "Digit1", char: "!", shift: true });
    expect(keyFromRemote("?")).toEqual({ code: "Slash", char: "?", shift: true });
    expect(keyFromRemote("_")).toEqual({ code: "Minus", char: "_", shift: true });
  });
  it("names the special keys and has no character for them", () => {
    expect(keyFromRemote("Backspace")).toEqual({ code: "Backspace", shift: false });
    expect(keyFromRemote("Enter")).toEqual({ code: "Enter", shift: false });
  });
  it("has nothing for what the board lacks, or for junk", () => {
    for (const k of ["é", "😀", "ab", "", "Foo", 3, null, undefined, {}]) expect(keyFromRemote(k)).toBeNull();
  });
  it("covers every key a US keyboard types, each to a code the 3D board has", () => {
    const board = new Set([
      ..."1234567890".split("").map((c) => `Digit${c}`),
      ..."QWERTYUIOPASDFGHJKLZXCVBNM".split("").map((c) => `Key${c}`),
      "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash", "Backquote", "Space", "Backspace", "Enter", "Tab", "Escape", "Delete",
    ]);
    for (const k of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -=[]\;',./`!@#$%^&*()_+{}|:\"<>?~") {
      const key = keyFromRemote(k);
      expect(key, JSON.stringify(k)).not.toBeNull();
      expect(board.has(key!.code), `${k} -> ${key!.code}`).toBe(true);
    }
  });
  it("keeps a keystroke down for a believable beat", () => {
    expect(KEYS_CAL.holdMs).toBeGreaterThan(30);
    expect(KEYS_CAL.holdMs).toBeLessThan(200);
  });
});

describe("the phone's field -> keys", () => {
  it("diffs: appends, backspaces, and replacements (an autocorrect swap)", () => {
    expect(diffTyped("", "hi")).toEqual(["h", "i"]);
    expect(diffTyped("hi", "h")).toEqual(["Backspace"]);
    expect(diffTyped("teh", "the")).toEqual(["Backspace", "Backspace", "h", "e"]);
    expect(diffTyped("a", "a")).toEqual([]);
    expect(diffTyped("a😀", "a")).toEqual(["Backspace"]);
  });
  it("one character on the sentinel is one key", () => {
    expect(readField(`${SENTINEL}a`, "", false)).toEqual({ keys: ["a"], shown: "a" });
    expect(readField(`${SENTINEL}A`, "", false).keys).toEqual(["A"]);
  });
  it("backspace on an empty field (the sentinel gone) is a Backspace", () => {
    expect(readField("", "", false).keys).toEqual(["Backspace"]);
  });
  it("a predictive insert is every character, in order", () => {
    expect(readField(`${SENTINEL}hello `, "", false).keys).toEqual(["h", "e", "l", "l", "o", " "]);
  });
  it("while an IME composes a word it sends only what changed, and backspaces edits", () => {
    let shown = "";
    const keys: string[] = [];
    for (const v of ["h", "he", "hel", "he", "hey"]) {
      const r = readField(SENTINEL + v, shown, true);
      shown = r.shown;
      keys.push(...r.keys);
    }
    expect(keys).toEqual(["h", "e", "l", "Backspace", "y"]);
    // the word is committed: nothing more to send
    expect(readField(`${SENTINEL}hey`, shown, false).keys).toEqual([]);
  });
  it("a sentinel that was typed before is never a key", () => {
    expect(readField(`a${SENTINEL}`, "", false).keys).toEqual(["a"]);
  });
});

// decks: what a phone's hand on the platter does to the record

describe("scratchRate", () => {
  it("is the angular velocity as a multiple of normal speed", () => {
    expect(scratchRate(OMEGA)).toBeCloseTo(1, 6);
    expect(scratchRate(-2 * OMEGA)).toBeCloseTo(-2, 6);
  });
  it("holding still is zero, and junk is ignored", () => {
    expect(scratchRate(0)).toBe(0);
    expect(scratchRate(DECKS_CAL.deadRadS * 0.9)).toBe(0);
    expect(scratchRate(Number.NaN)).toBe(0);
    expect(scratchRate(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it("caps at the pointer's own limit, both ways", () => {
    expect(scratchRate(1000)).toBe(DECKS_CAL.maxRate);
    expect(scratchRate(-1000)).toBe(-DECKS_CAL.maxRate);
  });
});

describe("angleDelta", () => {
  it("takes the short way round", () => {
    expect(angleDelta(0.1, 0.3)).toBeCloseTo(0.2, 9);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 9);
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 9);
  });
});
