import { describe, expect, it } from "vitest";
import { tokenize } from "@/lib/highlight";

const kinds = (code: string, lang: "python" | "ts" = "python") =>
  tokenize(code, lang).filter((t) => t.type !== "plain").map((t) => [t.type, t.text]);

describe("tokenize", () => {
  it("round-trips the source exactly", () => {
    const code = 'def f(x):\n    # hi\n    return x * 2.5 + len("a#b")\n';
    expect(tokenize(code, "python").map((t) => t.text).join("")).toBe(code);
  });

  it("knows python keywords, names, comments, strings and numbers", () => {
    expect(kinds('def rotate(token):\n    return "ok", 30  # grace')).toEqual([
      ["keyword", "def"],
      ["name", "rotate"],
      ["keyword", "return"],
      ["string", '"ok"'],
      ["number", "30"],
      ["comment", "# grace"],
    ]);
  });

  it("does not treat a # inside a string as a comment", () => {
    expect(kinds('x = "a # b"')).toEqual([["string", '"a # b"']]);
  });

  it("handles f-strings, docstrings and decorators", () => {
    expect(kinds('@router.get("/x")\nf"{a}"\n"""doc\nstring"""')).toEqual([
      ["decorator", "@router.get"],
      ["string", '"/x"'],
      ["string", 'f"{a}"'],
      ["string", '"""doc\nstring"""'],
    ]);
  });

  it("doesn't highlight keywords inside identifiers", () => {
    expect(kinds("format_input = definition")).toEqual([]);
  });

  it("does TypeScript too", () => {
    expect(kinds("const n = 2; // two\nfunction go() {}", "ts")).toEqual([
      ["keyword", "const"],
      ["number", "2"],
      ["comment", "// two"],
      ["keyword", "function"],
      ["name", "go"],
    ]);
  });
});
