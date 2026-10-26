"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KEYS_CAL } from "@/components/offhours/keyboardRemote";
import { ghostButton } from "./Shell";
import { readField, SENTINEL } from "./keyboardInput";
import type { ControllerProps } from "./types";

// The keyboard board's controller: the phone's own keyboard types on the
// laptop's 3D one. A real text field takes the typing (so the phone's keyboard
// opens, with its own sounds and haptics) and every key is sent as it is hit.
// The field is clear, laid over a big card that shows what you typed, so tapping
// the card is tapping the field. No motion is involved, so there is no fallback.
//
// Sends   gesture key {k}   one character ("a", "A", "!", " ") or a name ("Backspace", "Enter")
// Hears   nothing
//
// The field is kept at a hidden sentinel (keyboardInput.ts) and reset after
// every input event, so backspace on an empty field still gets an event, and
// autocorrect, capitals and an IME composing a word all come out as the keys
// that were actually hit.

const ECHO_LEN = 28;
const KEY_LABEL: Record<string, string> = { Backspace: "Delete", Enter: "Return", " ": "Space" };
const toCaretEnd = (el: HTMLInputElement) => {
  try {
    el.setSelectionRange(el.value.length, el.value.length);
  } catch {
    /* some input types refuse; this one shouldn't */
  }
};
const codepoints = (s: string) => Array.from(s);

export default function KeyboardController({ send }: ControllerProps) {
  const input = useRef<HTMLInputElement>(null);
  const shown = useRef("");
  const composing = useRef(false);
  const [focused, setFocused] = useState(false);
  const [echo, setEcho] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  const emit = useCallback(
    (keys: string[]) => {
      if (!keys.length) return;
      // a paste or a predictive-text insert can be many at once; play the first few
      const batch = keys.slice(0, KEYS_CAL.maxBurst);
      for (const k of batch) send({ type: "gesture", name: "key", data: { k } });
      setLast(batch[batch.length - 1]);
      setCount((c) => c + batch.length);
      setEcho((e) => {
        const t = codepoints(e);
        for (const k of batch) {
          if (k === "Backspace") t.pop();
          else if (codepoints(k).length === 1) t.push(k);
        }
        return t.slice(-ECHO_LEN).join("");
      });
      try {
        navigator.vibrate?.(6);
      } catch {
        /* no haptics here */
      }
    },
    [send],
  );

  const reset = useCallback((el: HTMLInputElement) => {
    el.value = SENTINEL;
    shown.current = "";
    toCaretEnd(el);
  }, []);

  const read = (el: HTMLInputElement, isComposing: boolean) => {
    const r = readField(el.value, shown.current, isComposing);
    shown.current = r.shown;
    emit(r.keys);
    if (!isComposing) reset(el);
  };

  useEffect(() => {
    if (input.current) reset(input.current);
  }, [reset]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-testid="keyboard-controller" data-focused={focused}>
      <h1 className="mt-3 text-[1.35rem] leading-tight font-extrabold text-balance">Type. The keys press on the laptop.</h1>
      <p className="mt-1.5 text-[1.05rem] leading-snug text-[#c9c6b6]">Every key you hit goes down on the 3D board, with its sound.</p>

      <div
        className={`relative mt-4 rounded-[24px] border-2 transition-colors ${
          focused ? "bg-white/10 border-[var(--mint)]" : "bg-[var(--mint)]/10 border-[var(--mint)]/50"
        }`}
      >
        {/* until it has focus the card breathes, so it reads as the thing to tap */}
        {!focused && <span aria-hidden="true" className="pointer-events-none absolute -inset-[2px] rounded-[24px] border-2 border-[var(--mint)] animate-pulse" />}
        <div className="min-h-[148px] px-5 py-5 flex flex-col justify-center" aria-hidden="true">
          {focused || echo ? (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mint)]">{focused ? "Typing" : "Typed"}</p>
              <p data-testid="keyboard-echo" className="mt-2 font-mono text-[1.6rem] leading-tight tracking-[0.06em] break-all min-h-[2.4rem] text-[var(--paper)]">
                {echo}
                {focused && <span className="text-[var(--mint)] animate-pulse">▍</span>}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center text-center">
              <svg width="56" height="40" viewBox="0 0 56 40" fill="none" stroke="var(--mint)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <rect x="2" y="2" width="52" height="36" rx="7" />
                <path d="M10 12h4M18 12h4M26 12h4M34 12h4M42 12h4M10 20h4M18 20h4M26 20h4M34 20h4M42 20h4M16 29h24" />
              </svg>
              <p className="mt-3 text-[1.5rem] leading-none font-extrabold">Tap here to type</p>
              <p className="mt-2 text-[1rem] text-[#c9c6b6]">Your keyboard opens.</p>
            </div>
          )}
        </div>
        <input
          ref={input}
          type="text"
          aria-label="Type here. Each key you press goes to the laptop's keyboard."
          data-testid="keyboard-input"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="enter"
          data-1p-ignore
          data-lpignore="true"
          // 16px stops iOS zooming the page in on focus; the card draws what was typed
          className="absolute inset-0 h-full w-full rounded-[22px] bg-transparent text-[16px] text-transparent caret-transparent outline-none cursor-text"
          onFocus={(e) => {
            setFocused(true);
            toCaretEnd(e.currentTarget);
          }}
          onBlur={() => setFocused(false)}
          onSelect={(e) => {
            // typing before the sentinel would leave it behind; keep the caret at the end
            const el = e.currentTarget;
            if (!composing.current && el.selectionStart !== el.value.length) toCaretEnd(el);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            read(e.currentTarget, false);
          }}
          onInput={(e) => read(e.currentTarget, composing.current || (e.nativeEvent as InputEvent).isComposing === true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              emit(["Enter"]);
            }
          }}
        />
      </div>

      <section aria-label="Last key" className="mt-3 grid grid-cols-2 gap-2 text-center" data-testid="keyboard-last">
        <div className="rounded-[16px] bg-white/10 border border-white/15 px-2 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a69c]">Last key</p>
          <p className="mt-1 text-[1.35rem] leading-none font-extrabold min-h-[1.35rem]">{last === null ? "–" : (KEY_LABEL[last] ?? last.toUpperCase())}</p>
        </div>
        <div className="rounded-[16px] bg-white/10 border border-white/15 px-2 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a69c]">Keys sent</p>
          <p className="mt-1 text-[1.35rem] leading-none font-extrabold tabular-nums">{count}</p>
        </div>
      </section>

      <button
        type="button"
        data-testid="keyboard-toggle"
        // keep focus where it is on press so the keyboard doesn't flicker shut before this click lands
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => (focused ? input.current?.blur() : input.current?.focus())}
        className={`${ghostButton} mt-3`}
      >
        {focused ? "Done typing" : "Open keyboard"}
      </button>
      <p className="mt-2 text-[0.95rem] leading-snug text-[#a3a69c]">Return and delete work too. Capitals and symbols press Shift for you.</p>
    </div>
  );
}
