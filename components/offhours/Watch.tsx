"use client";

import { useEffect, useRef, useState } from "react";
import type { PieceProps } from "./useCanvas";
import { burst, getAudio, modal } from "./audio";
import Exploded3D from "./Exploded3D";
import type { WatchState } from "./three/watch";

// A 40 mm automatic in fifteen parts, rendered in real 3D (three.js, loaded
// only when this piece is on screen): polished and brushed steel, sapphire,
// rubies, blued screws, Côtes de Genève and perlage. Turn the crown to wind
// it; orbit it and the rotor swings and winds it too; pull it apart with the
// slider; flip it to look through the caseback; pick a part to isolate it.
// The model and the movement's motion live in three/watch.ts.

const RESERVE = 75;
const PARTS = [
  ["crystal", "Crystal"],
  ["bezel", "Bezel"],
  ["second", "Seconds hand"],
  ["minute", "Minute hand"],
  ["hour", "Hour hand"],
  ["dial", "Dial"],
  ["case", "Case + crown"],
  ["plate", "Main plate"],
  ["barrel", "Barrel + mainspring"],
  ["train", "Gear train"],
  ["escapement", "Escapement"],
  ["balance", "Balance + hairspring"],
  ["bridges", "Bridges"],
  ["rotor", "Rotor"],
  ["caseback", "Caseback"],
] as const;

export default function Watch({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [explode, setExplode] = useState(play ? 0 : 0.5);
  const [flip, setFlip] = useState(false);
  const [reserve, setReserve] = useState(play ? 0.15 : 0.7);
  const [solo, setSolo] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const state = useRef<WatchState>({ power: play ? 0.15 : 0.7, crown: 0, rotorKick: 0, flip: false });
  const knob = useRef<HTMLDivElement>(null);
  const knobA = useRef<number | null>(null);
  const clickAcc = useRef(0);
  state.current.flip = flip;

  // ticks: a tiny high resonant click each beat (play only)
  useEffect(() => {
    if (!play) {
      state.current.power = 0.7;
      return;
    }
    state.current.onBeat = (beat) => {
      const au = getAudio();
      if (au && au.ctx.state === "running") modal(au, [[3800 + (beat % 2) * 500, 14, 0.06], [7200, 10, 0.03]], { gain: 0.6, excite: 0.0015, lowpass: 9000 });
    };
    const id = window.setInterval(() => setReserve(state.current.power), 200);
    return () => window.clearInterval(id);
  }, [play]);
  // previews stay wound
  useEffect(() => {
    if (play) return;
    const id = window.setInterval(() => (state.current.power = 0.7), 5000);
    return () => window.clearInterval(id);
  }, [play]);

  const wind = (deg: number) => {
    const s = state.current;
    if (deg <= 0) {
      s.crown += deg * 0.3;
      return;
    }
    s.crown += deg;
    clickAcc.current += deg;
    while (clickAcc.current >= 14) {
      clickAcc.current -= 14;
      const au = getAudio();
      if (s.power < 1) {
        s.power = Math.min(1, s.power + 0.018);
        if (au) modal(au, [[4600, 12, 0.25], [9000, 8, 0.1], [1900, 6, 0.08]], { excite: 0.002, gain: 0.7, lowpass: 12000 });
      } else if (au) burst(au, { freq: 1600, q: 2, dur: 0.02, gain: 0.12 });
    }
    if (knob.current) knob.current.style.transform = `rotate(${s.crown.toFixed(1)}deg)`;
    setReserve(s.power);
  };

  const angle = (e: React.PointerEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
  };

  return (
    <div className={`absolute inset-0 flex ${play ? "flex-col md:flex-row" : ""} bg-[#f2ead7]`}>
      <div className="relative flex-1 min-h-0">
        <Exploded3D
          build={async () => (await import("./three/watch")).buildWatch(state.current)}
          explode={explode}
          solo={solo}
          onSolo={setSolo}
          interactive={play}
          preview={!play}
          paused={paused}
          onReady={(m, v) => {
            state.current.impulse = v.orbitImpulse;
            setNotes(Object.fromEntries(m.parts.map((p) => [p.id, p.note])));
          }}
        />
      </div>

      {play && (
        <div className="shrink-0 md:w-[280px] p-4 md:p-5 flex md:flex-col items-center md:items-stretch gap-4 bg-[var(--ink)] text-[var(--paper)] overflow-y-auto">
          <div className="flex flex-col items-center gap-2">
            <div
              role="slider"
              tabIndex={0}
              data-autofocus
              aria-label="Crown. Drag it round clockwise, or press the up arrow, to wind the watch."
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(reserve * 100)}
              aria-valuetext={`Power reserve ${Math.round(reserve * 100)} percent`}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                knobA.current = angle(e);
              }}
              onPointerMove={(e) => {
                if (knobA.current === null) return;
                const a = angle(e);
                let d = a - knobA.current;
                while (d > Math.PI) d -= Math.PI * 2;
                while (d < -Math.PI) d += Math.PI * 2;
                knobA.current = a;
                wind((d * 180) / Math.PI);
              }}
              onPointerUp={() => (knobA.current = null)}
              onPointerCancel={() => (knobA.current = null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === " ") {
                  e.preventDefault();
                  wind(42);
                }
              }}
              className="relative w-24 h-24 rounded-full cursor-grab active:cursor-grabbing touch-none select-none outline-offset-4"
              style={{ background: "radial-gradient(circle at 35% 30%, #f4f2ec, #8f8b83 70%)", boxShadow: "inset 0 -6px 12px rgba(0,0,0,0.35), 0 10px 20px -8px rgba(0,0,0,0.6)" }}
            >
              <div
                ref={knob}
                className="absolute inset-0 rounded-full"
                style={{
                  background: "repeating-conic-gradient(#6f6b63 0 4deg, #d9d6cf 4deg 9deg)",
                  maskImage: "radial-gradient(circle, transparent 62%, black 63%)",
                  WebkitMaskImage: "radial-gradient(circle, transparent 62%, black 63%)",
                }}
              />
              <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase tracking-[0.18em] text-[#0d100e]">Wind ↻</span>
            </div>
          </div>
          <div className="flex-1 md:flex-none w-full">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab]">Power reserve</p>
            <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-[var(--mint)] transition-[width] duration-150" style={{ width: `${reserve * 100}%` }} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-[#b5b6ab]">{reserve > 0 ? `${Math.round(reserve * RESERVE)}s left · orbit it to swing the rotor` : "Stopped. Wind it."}</p>
          </div>
          <label className="w-full font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab]">
            Explode
            <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} className="mt-2 w-full accent-[#8ad9a8]" />
          </label>
          <button type="button" onClick={() => setFlip((f) => !f)} aria-pressed={flip} className="h-9 px-4 rounded-full border border-white/20 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-white/10">
            {flip ? "Show the dial" : "Flip it over"}
          </button>
          <div className="hidden md:block">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab] mb-2">Parts · pick one</p>
            <ul className="grid grid-cols-2 gap-x-1 gap-y-0.5">
              {PARTS.map(([id, label]) => (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={solo === id}
                    onClick={() => {
                      setSolo(solo === id ? null : id);
                      if (explode < 0.5) setExplode(0.85);
                    }}
                    className={`w-full text-left px-2 py-0.5 rounded text-[11px] leading-tight ${solo === id ? "bg-[var(--paper)] text-[var(--ink)]" : "hover:bg-white/10"}`}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
            <p aria-live="polite" className="mt-3 text-[12px] leading-snug text-[#cfd0c6] min-h-[3.5em]">
              {(solo && notes[solo]) || "Pick a part to isolate it. Drag the watch to turn it."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
