"use client";

import { useEffect, useState } from "react";

// A 65% board in the site colourway. Keys go down when you type anywhere on
// the page (or tap them). A strip display above shows what you typed.
// Decorative: it never captures or blocks your keystrokes.

type Key = { code: string; label: string; u?: number; tone?: "alpha" | "mod" | "accent" };

const ROWS: Key[][] = [
  [
    { code: "Escape", label: "esc", tone: "accent" },
    ..."1234567890".split("").map((c) => ({ code: `Digit${c}`, label: c })),
    { code: "Minus", label: "-" },
    { code: "Equal", label: "=" },
    { code: "Backspace", label: "⌫", u: 2, tone: "mod" },
    { code: "Backquote", label: "`", tone: "mod" },
  ],
  [
    { code: "Tab", label: "tab", u: 1.5, tone: "mod" },
    ..."QWERTYUIOP".split("").map((c) => ({ code: `Key${c}`, label: c })),
    { code: "BracketLeft", label: "[" },
    { code: "BracketRight", label: "]" },
    { code: "Backslash", label: "\\", u: 1.5 },
    { code: "Delete", label: "del", tone: "mod" },
  ],
  [
    { code: "CapsLock", label: "caps", u: 1.75, tone: "mod" },
    ..."ASDFGHJKL".split("").map((c) => ({ code: `Key${c}`, label: c })),
    { code: "Semicolon", label: ";" },
    { code: "Quote", label: "'" },
    { code: "Enter", label: "enter", u: 2.25, tone: "accent" },
    { code: "PageUp", label: "pgup", tone: "mod" },
  ],
  [
    { code: "ShiftLeft", label: "shift", u: 2.25, tone: "mod" },
    ..."ZXCVBNM".split("").map((c) => ({ code: `Key${c}`, label: c })),
    { code: "Comma", label: "," },
    { code: "Period", label: "." },
    { code: "Slash", label: "/" },
    { code: "ShiftRight", label: "shift", u: 1.75, tone: "mod" },
    { code: "ArrowUp", label: "↑", tone: "mod" },
    { code: "PageDown", label: "pgdn", tone: "mod" },
  ],
  [
    { code: "ControlLeft", label: "ctrl", u: 1.25, tone: "mod" },
    { code: "MetaLeft", label: "⌘", u: 1.25, tone: "mod" },
    { code: "AltLeft", label: "alt", u: 1.25, tone: "mod" },
    { code: "Space", label: "", u: 6.25 },
    { code: "AltRight", label: "alt", tone: "mod" },
    { code: "Fn", label: "fn", tone: "mod" },
    { code: "ControlRight", label: "ctrl", tone: "mod" },
    { code: "ArrowLeft", label: "←", tone: "mod" },
    { code: "ArrowDown", label: "↓", tone: "mod" },
    { code: "ArrowRight", label: "→", tone: "mod" },
  ],
];

const TONES = {
  alpha: { cap: "#f1eee7", side: "#c9c4b8", text: "#0c0c0b" },
  mod: { cap: "#3a3936", side: "#22211f", text: "#e7e3da" },
  accent: { cap: "#ff4a1c", side: "#b8300e", text: "#0c0c0b" },
};

export default function Keyboard() {
  const [down, setDown] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");

  const press = (code: string, char?: string) => {
    setDown((s) => new Set(s).add(code));
    if (code === "Backspace") setTyped((t) => t.slice(0, -1));
    else if (char) setTyped((t) => (t + char).slice(-28));
  };
  const release = (code: string) =>
    setDown((s) => {
      const n = new Set(s);
      n.delete(code);
      return n;
    });

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      press(e.code, e.key.length === 1 ? e.key.toUpperCase() : undefined);
    };
    const onUp = (e: KeyboardEvent) => release(e.code);
    const clear = () => setDown(new Set());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    };
  }, []);

  return (
    <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-[#d8d3c8] [container-type:size]">
      {/* fit by width and height: the board is ~2.5:1 */}
      <div className="kb" style={{ width: "min(100cqw - 2rem, 720px, (100cqh - 2rem) * 2.5)" }}>
        <div className="rounded-[14px] bg-[#0c0c0b] p-[2.2%] shadow-[0_24px_40px_-18px_rgba(12,12,11,0.7),inset_0_1px_0_rgba(255,255,255,0.08)]">
          {/* display strip */}
          <div className="flex items-center justify-between mb-[1.6%] px-[1%]">
            <span className="font-mono text-[clamp(8px,1.4cqw,12px)] tracking-[0.2em] text-[#ff4a1c] truncate">
              {typed || "TYPE ANYTHING"}
              <span className="animate-pulse">▍</span>
            </span>
            <span className="flex gap-1.5">
              <i className="w-1.5 h-1.5 rounded-full bg-[#ff4a1c]" />
              <i className={`w-1.5 h-1.5 rounded-full ${down.size ? "bg-[#ff4a1c]" : "bg-[#3a3936]"}`} />
            </span>
          </div>
          <div className="flex flex-col gap-[0.5cqw]">
            {ROWS.map((row, r) => (
              <div key={r} className="flex gap-[0.5cqw]">
                {row.map((k) => {
                  const tone = TONES[k.tone ?? "alpha"];
                  const isDown = down.has(k.code);
                  return (
                    <span
                      key={k.code}
                      onPointerDown={() => press(k.code, k.label.length === 1 ? k.label : k.code === "Space" ? " " : undefined)}
                      onPointerUp={() => release(k.code)}
                      onPointerLeave={() => release(k.code)}
                      className="kb-key relative select-none cursor-pointer touch-none"
                      style={{ flex: `${k.u ?? 1} 1 0` }}
                    >
                      <span
                        className="absolute inset-0 rounded-[18%] transition-transform duration-75"
                        style={{
                          background: tone.side,
                          transform: isDown ? "translateY(8%)" : "translateY(0)",
                        }}
                      />
                      <span
                        className="absolute inset-x-[4%] top-[2%] bottom-[14%] rounded-[16%] flex items-start justify-start p-[10%] font-mono uppercase leading-none transition-transform duration-75"
                        style={{
                          background: `linear-gradient(180deg, ${tone.cap}, ${tone.cap} 60%, ${tone.side} 140%)`,
                          color: tone.text,
                          fontSize: "clamp(6px, 1.25cqw, 11px)",
                          transform: isDown ? "translateY(14%)" : "translateY(0)",
                          boxShadow: isDown ? "none" : "inset 0 1px 0 rgba(255,255,255,0.35)",
                        }}
                      >
                        {k.label}
                      </span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
