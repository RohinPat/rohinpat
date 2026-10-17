"use client";

import { useEffect, useRef, useState } from "react";
import type { PieceProps } from "./useCanvas";
import { burst, getAudio, modal, tone } from "./audio";
import Exploded3D from "./Exploded3D";
import type { KeyboardState } from "./three/keyboard";

// The 65% board I built, in thirteen parts, rendered in real 3D (three.js,
// loaded only when this piece is on screen): sculpted PBT caps, clear
// polycarbonate switch tops, red POM stems and steel springs, a brass plate
// with flex cuts, foams, the PCB with its MCU and LEDs, the anodised case
// and its brass weight. Type (or click keys) and each one goes down with a
// synthesized thock and comes back with its upstroke, and every keystroke
// presses the stack back together. The Konami code lights the underglow.
// The model lives in three/keyboard.ts.

const PARTS = [
  ["caps", "PBT keycaps"],
  ["tops", "Switch tops"],
  ["stems", "Stems"],
  ["springs", "Springs"],
  ["bottoms", "Switch bottoms"],
  ["stabs", "Stabilisers"],
  ["gaskets", "Gasket strips"],
  ["plate", "Brass plate"],
  ["platefoam", "Plate foam"],
  ["pcb", "Hot-swap PCB"],
  ["casefoam", "Case foam"],
  ["case", "Aluminium case"],
  ["weight", "Brass weight"],
] as const;

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "KeyB", "KeyA"];
const CHARS: Record<string, string> = { Space: " " };

export default function Keyboard({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [explode, setExplode] = useState(play ? 0 : 0.5);
  const [typed, setTyped] = useState("");
  const [solo, setSolo] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const state = useRef<KeyboardState>({ down: new Set(), glow: false });
  const held = useRef(new Set<string>());
  const konami = useRef<string[]>([]);
  const picked = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Sound: modal synthesis of a lubed linear on a gasket-mount board. The
  // bottom-out rings the case and plate (low, damped modes) with a little
  // plastic clack on top; letting go is a quieter, higher upstroke. Every
  // key gets its own slight tuning, and the long keys rattle their stabs.
  const tuning = (code: string) => {
    let h = 0;
    for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
    return 0.94 + ((h % 1000) / 1000) * 0.12;
  };
  const isLong = (code: string) => code === "Space" || code === "Enter" || code.startsWith("Shift") || code === "Backspace";
  const thock = (code: string, up = false) => {
    if (!play) return;
    const au = getAudio();
    if (!au) return;
    const k = tuning(code) * (isLong(code) ? 0.78 : 1) * (0.98 + Math.random() * 0.04);
    if (up) {
      modal(au, [[1050 * k, 9, 0.18], [2300 * k, 10, 0.1]], { gain: 0.45, lowpass: 5000 });
      return;
    }
    modal(
      au,
      [
        [210 * k, 5, 1.0],
        [470 * k, 7, 0.7],
        [1180 * k, 9, 0.32],
        [2650 * k, 8, 0.14],
      ],
      { gain: isLong(code) ? 0.95 : 0.8, lowpass: 4200 },
    );
    tone(au, { freq: 110 * k, to: 70 * k, dur: 0.05, gain: 0.12 });
    burst(au, { freq: 5200, q: 0.7, type: "highpass", dur: 0.004, gain: 0.05 });
    if (isLong(code)) burst(au, { freq: 3200, q: 3, dur: 0.012, gain: 0.05, at: 0.012 });
  };

  const press = (code: string, char?: string) => {
    if (held.current.has(code)) return;
    held.current.add(code);
    state.current.down = new Set(held.current);
    thock(code);
    if (code === "Backspace") setTyped((t) => t.slice(0, -1));
    else if (char) setTyped((t) => (t + char).slice(-32));
    if (play) setExplode((e) => Math.max(0, e - 0.04)); // each keystroke presses it back together
    konami.current = [...konami.current, code].slice(-KONAMI.length);
    if (konami.current.join() === KONAMI.join()) {
      state.current.glow = true;
      window.setTimeout(() => (state.current.glow = false), 8000);
      const au = getAudio();
      if (au) [523, 659, 784, 1047].forEach((f, i) => tone(au, { freq: f, dur: 0.18, gain: 0.12, at: i * 0.08, type: "square" }));
    }
  };
  const release = (code: string) => {
    if (!held.current.has(code)) return;
    held.current.delete(code);
    state.current.down = new Set(held.current);
    thock(code, true);
  };

  // clicking a key in 3D presses it
  state.current.onPick = (code, isDown) => {
    if (!play) return;
    if (isDown) {
      picked.current = code;
      press(code, code.startsWith("Key") || code.startsWith("Digit") ? code.slice(-1) : CHARS[code]);
    } else if (picked.current) {
      release(picked.current);
      picked.current = null;
    }
  };

  // typing only while the stage has focus — never steals keys from the page
  useEffect(() => {
    if (!play) return;
    const el = root.current;
    if (!el) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "BUTTON") return;
      e.preventDefault();
      if (!e.repeat) press(e.code, e.key.length === 1 ? e.key.toUpperCase() : undefined);
    };
    const onUp = (e: KeyboardEvent) => release(e.code);
    const onBlur = () => Array.from(held.current).forEach(release);
    el.addEventListener("keydown", onDown);
    el.addEventListener("keyup", onUp);
    el.addEventListener("blur", onBlur);
    return () => {
      el.removeEventListener("keydown", onDown);
      el.removeEventListener("keyup", onUp);
      el.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  // preview: a ghost types
  useEffect(() => {
    if (play) return;
    const id = window.setInterval(() => {
      const codes = ["KeyR", "KeyO", "KeyH", "KeyI", "KeyN", "Space", "KeyP", "KeyA", "KeyT", "KeyE", "KeyL"];
      const c = codes[Math.floor(Math.random() * codes.length)];
      state.current.down = new Set([c]);
      window.setTimeout(() => (state.current.down = new Set()), 120);
    }, 260);
    return () => window.clearInterval(id);
  }, [play]);

  return (
    <div
      ref={root}
      tabIndex={play ? 0 : undefined}
      data-autofocus={play || undefined}
      role={play ? "application" : undefined}
      aria-label={play ? "A keyboard, in layers. Type to press keys and put it back together." : undefined}
      className="absolute inset-0 flex flex-col bg-[#f2ead7] outline-none"
    >
      <div className="relative flex-1 min-h-0">
        <Exploded3D
          build={async () => (await import("./three/keyboard")).buildKeyboard(state.current)}
          explode={explode}
          solo={solo}
          onSolo={setSolo}
          interactive={play}
          preview={!play}
          paused={paused}
          onReady={(m) => setNotes(Object.fromEntries(m.parts.map((p) => [p.id, p.note])))}
        />
      </div>

      {play && (
        <div className="shrink-0 flex flex-col gap-2 px-4 py-3 bg-[var(--ink)] text-[var(--paper)]">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-mono text-[12px] tracking-[0.2em] text-[var(--mint)] min-w-[16ch]">
              {typed || "TYPE ANYTHING"}
              <span className="animate-pulse">▍</span>
            </span>
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab] ml-auto">
              Explode
              <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} className="w-40 accent-[#8ad9a8]" />
            </label>
            <button
              type="button"
              onClick={() => setExplode(explode > 0.5 ? 0 : 1)}
              className="h-9 px-4 rounded-full border border-white/20 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-white/10"
            >
              {explode > 0.5 ? "Assemble" : "Take apart"}
            </button>
          </div>
          <div className="hidden md:flex flex-wrap items-center gap-1">
            {PARTS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={solo === id}
                onClick={() => {
                  setSolo(solo === id ? null : id);
                  if (explode < 0.5) setExplode(0.85);
                }}
                className={`h-7 px-2.5 rounded-full text-[11px] ${solo === id ? "bg-[var(--paper)] text-[var(--ink)]" : "text-[#cfd0c6] hover:bg-white/10"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p aria-live="polite" className="hidden md:block text-[12px] text-[#cfd0c6] min-h-[1.4em]">
            {(solo && notes[solo]) || "Pick a part to isolate it. Type, or click keys, to put it back together."}
          </p>
        </div>
      )}
    </div>
  );
}
