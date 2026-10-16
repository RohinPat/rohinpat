// A deliberately tiny syntax highlighter for the code excerpts in write-ups.
// It runs at build time (server components), ships no client JS and makes no
// requests. It knows comments, strings, numbers, keywords, decorators and the
// name after def/class/function — enough to make an excerpt scannable, which
// is all an excerpt needs.

export type TokenType = "plain" | "comment" | "string" | "number" | "keyword" | "name" | "decorator";
export type Token = { type: TokenType; text: string };
export type Lang = "python" | "ts";

const KEYWORDS: Record<Lang, Set<string>> = {
  python: new Set(
    "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False".split(" "),
  ),
  ts: new Set(
    "as async await break case catch class const continue default do else export extends false finally for from function if import in instanceof let new null of return switch this throw true try type typeof undefined var void while yield".split(" "),
  ),
};

// One alternation, tried left to right at each position. Order matters:
// triple-quoted strings before single-quoted, comments before operators.
const RULES: Record<Lang, RegExp> = {
  python:
    /("""[\s\S]*?"""|'''[\s\S]*?''')|(#[^\n]*)|([rbfu]{0,2}"(?:\\.|[^"\\\n])*"|[rbfu]{0,2}'(?:\\.|[^'\\\n])*')|(@[A-Za-z_][\w.]*)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_]\w*)/g,
  ts: /(\/\*[\s\S]*?\*\/)|(\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[A-Za-z_][\w.]*)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g,
};

export function tokenize(code: string, lang: Lang): Token[] {
  const out: Token[] = [];
  const push = (type: TokenType, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };

  const re = new RegExp(RULES[lang].source, "g");
  const keywords = KEYWORDS[lang];
  let cursor = 0;
  let afterDef = false;
  let m: RegExpExecArray | null;

  while ((m = re.exec(code))) {
    push("plain", code.slice(cursor, m.index));
    const [text, docstring, comment, str, deco, num, word] = m;
    if (docstring) {
      // triple quotes in Python, block comments in TS: both read as commentary
      push(lang === "python" ? "string" : "comment", text);
    } else if (comment) push("comment", text);
    else if (str) push("string", text);
    else if (deco) push("decorator", text);
    else if (num) push("number", text);
    else if (word) {
      if (afterDef) {
        push("name", text);
        afterDef = false;
        cursor = re.lastIndex;
        continue;
      }
      if (keywords.has(word)) {
        push("keyword", text);
        afterDef = word === "def" || word === "class" || word === "function";
      } else push("plain", text);
    }
    cursor = re.lastIndex;
  }
  push("plain", code.slice(cursor));
  return out;
}
