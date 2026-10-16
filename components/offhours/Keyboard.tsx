"use client";

import { useEffect, useRef, useState } from "react";
import type { PieceProps } from "./useCanvas";
import { useVisibleLoop } from "./useVisibleLoop";
import { burst, getAudio, modal, tone } from "./audio";

// The 65% board I built, as the layers it's built from — case, PCB, plate,
// switches, keycaps — in CSS 3D. Pull it apart with the slider, orbit it by
// dragging, and type: every key goes down through cap and stem with a
// synthesized thock, and each keystroke presses the stack back together.
// The Konami code lights the underglow.

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

// lay the keys out in units
const KEYS = ROWS.flatMap((row, y) => {
  let x = 0;
  return row.map((k) => {
    const out = { ...k, x, y, w: k.u ?? 1 };
    x += out.w;
    return out;
  });
});
const BOARD_W = 16;
const BOARD_H = 5;

const TONES = {
  alpha: { cap: "#f2ead7", side: "#c9c4b8", text: "#0d100e" },
  mod: { cap: "#3a3936", side: "#22211f", text: "#e7e3da" },
  accent: { cap: "#1d5e3f", side: "#123b27", text: "#f2ead7" },
};

const LAYERS = [
  { id: "case", label: "Aluminium case" },
  { id: "pcb", label: "Hot-swap PCB" },
  { id: "plate", label: "Brass plate" },
  { id: "switches", label: "Linear switches, lubed" },
  { id: "caps", label: "PBT keycaps" },
] as const;

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "KeyB", "KeyA"];

export default function Keyboard({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [explode, setExplode] = useState(play ? 0.8 : 0.4);
  const [down, setDown] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [glow, setGlow] = useState(false);
  const S = useRef({ explode: play ? 0.8 : 0.4, orbit: { x: 0, y: 0 }, drag: false, last: { x: 0, y: 0 }, t: 0, nextAuto: 0.6, konami: [] as string[], glowT: -10 });
  const stage = useRef<HTMLDivElement>(null);
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const root = useRef<HTMLDivElement | null>(null);
  const explodeRef = useRef(explode);
  explodeRef.current = explode;

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
      modal(au, [[1050 * k, 9, 0.18], [2300 * k, 10, 0.1]], { gain: 0.5, lowpass: 5000 });
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
    burst(au, { freq: 5200, q: 0.7, type: "highpass", dur: 0.004, gain: 0.05 }); // the clack
    if (isLong(code)) burst(au, { freq: 3200, q: 3, dur: 0.012, gain: 0.05, at: 0.012 }); // stab wire
  };

  const press = (code: string, char?: string) => {
    setDown((s) => new Set(s).add(code));
    thock(code);
    if (code === "Backspace") setTyped((t) => t.slice(0, -1));
    else if (char) setTyped((t) => (t + char).slice(-32));
    // each keystroke presses the stack back together
    if (play) setExplode((e) => Math.max(0, e - 0.05));
    const s = S.current;
    s.konami = [...s.konami, code].slice(-KONAMI.length);
    if (s.konami.join() === KONAMI.join()) {
      setGlow(true);
      s.glowT = s.t;
      const au = getAudio();
      if (au) [523, 659, 784, 1047].forEach((f, i) => tone(au, { freq: f, dur: 0.18, gain: 0.12, at: i * 0.08, type: "square" }));
    }
  };
  const release = (code: string) =>
    setDown((s) => {
      const n = new Set(s);
      n.delete(code);
      return n;
    });

  // typing only while the stage has focus (play) — never steals keys from the page
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
    el.addEventListener("keydown", onDown);
    el.addEventListener("keyup", onUp);
    return () => {
      el.removeEventListener("keydown", onDown);
      el.removeEventListener("keyup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const loopRef = useVisibleLoop<HTMLDivElement>((dt) => {
    const s = S.current;
    s.t += dt;
    if (!play && s.t > 0.2 && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = play ? explodeRef.current : 0.5 - 0.5 * Math.cos(s.t * 0.55);
    s.explode += (target - s.explode) * Math.min(1, dt * 8);
    if (!play) {
      // preview: a ghost types
      s.nextAuto -= dt;
      if (s.nextAuto <= 0) {
        const k = KEYS[Math.floor(Math.random() * KEYS.length)];
        setDown(new Set([k.code]));
        window.setTimeout(() => setDown(new Set()), 110);
        s.nextAuto = 0.12 + Math.random() * 0.3;
      }
    }
    if (glow && s.t - s.glowT > 8) setGlow(false);
    const e = s.explode;
    const rx = 28 + e * 26 + s.orbit.y;
    const rz = -e * 18 + s.orbit.x;
    if (stage.current) stage.current.style.transform = `rotateX(${rx}deg) rotateZ(${rz}deg)`;
    layers.current.forEach((el, i) => {
      if (!el) return;
      el.style.transform = `translateZ(calc(var(--u) * ${(i * 0.22 + e * (i - 2) * 1.9).toFixed(3)}))`;
      const label = el.querySelector<HTMLElement>("[data-label]");
      if (label) {
        label.style.opacity = String(Math.max(0, (e - 0.3) / 0.4));
        label.style.transform = `rotateZ(${-rz}deg) rotateX(${-rx}deg)`;
      }
    });
  }, paused);

  const U = "var(--u)";
  const at = (x: number, y: number, w: number, h = 1, inset = 0.04) => ({
    left: `calc(${U} * ${x - BOARD_W / 2 + inset})`,
    top: `calc(${U} * ${y - BOARD_H / 2 + inset})`,
    width: `calc(${U} * ${w - inset * 2})`,
    height: `calc(${U} * ${h - inset * 2})`,
  });

  const onOrbitDown = (e: React.PointerEvent) => {
    if (!play || (e.target as HTMLElement).closest("[data-key]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    S.current.drag = true;
    S.current.last = { x: e.clientX, y: e.clientY };
  };
  const onOrbitMove = (e: React.PointerEvent) => {
    const s = S.current;
    if (!s.drag) return;
    s.orbit.x += (e.clientX - s.last.x) * 0.25;
    s.orbit.y = Math.max(-30, Math.min(25, s.orbit.y - (e.clientY - s.last.y) * 0.25));
    s.last = { x: e.clientX, y: e.clientY };
  };

  return (
    <div
      ref={(el) => {
        (loopRef as unknown as { current: HTMLDivElement | null }).current = el;
        root.current = el;
      }}
      tabIndex={play ? 0 : undefined}
      data-autofocus={play || undefined}
      role={play ? "application" : undefined}
      aria-label={play ? "A keyboard, in layers. Type to press keys and put it back together." : undefined}
      className="absolute inset-0 flex flex-col paper [container-type:size] outline-none"
    >
      <div
        className="relative flex-1 min-h-0 overflow-hidden touch-none select-none"
        style={{ perspective: "1600px", ["--u" as string]: play ? "min(4.3cqw, 7.4cqh)" : "min(5.4cqw, 13cqh)" } as React.CSSProperties}
        onPointerDown={onOrbitDown}
        onPointerMove={onOrbitMove}
        onPointerUp={() => (S.current.drag = false)}
      >
        <div ref={stage} className="absolute left-1/2 top-[52%] w-0 h-0" style={{ transformStyle: "preserve-3d" }}>
          {LAYERS.map((L, i) => (
            <div
              key={L.id}
              ref={(el) => {
                layers.current[i] = el;
              }}
              className="absolute left-0 top-0 w-0 h-0"
              style={{ transformStyle: "preserve-3d" }}
            >
              {L.id === "case" && (
                <>
                  <div
                    className="absolute rounded-[calc(var(--u)*0.35)]"
                    style={{
                      ...at(-0.45, -0.45, BOARD_W + 0.9, BOARD_H + 0.9, 0),
                      background: "linear-gradient(160deg,#2c2f30,#121414)",
                      boxShadow: `0 calc(${U} * 0.9) calc(${U} * 1.4) calc(${U} * -0.5) rgba(13,16,14,0.6), inset 0 1px 0 rgba(255,255,255,0.12)`,
                    }}
                  />
                  <div
                    className="absolute rounded-[calc(var(--u)*0.2)]"
                    style={{ ...at(-0.12, -0.12, BOARD_W + 0.24, BOARD_H + 0.24, 0), background: "#0b0c0c" }}
                  />
                </>
              )}
              {L.id === "pcb" && (
                <svg
                  viewBox={`0 0 ${BOARD_W * 10} ${BOARD_H * 10}`}
                  className="absolute"
                  style={{ ...at(0, 0, BOARD_W, BOARD_H, 0), filter: glow ? "drop-shadow(0 0 12px rgba(138,217,168,0.8))" : undefined }}
                >
                  <rect width={BOARD_W * 10} height={BOARD_H * 10} rx="3" fill="#145233" />
                  {KEYS.map((k, i) => {
                    const cx = (k.x + k.w / 2) * 10, cy = (k.y + 0.5) * 10;
                    return (
                      <g key={k.code}>
                        <path d={`M${cx} ${cy} h${(i % 3) + 2} v4`} stroke="#c9a24f" strokeWidth="0.5" fill="none" opacity="0.7" />
                        <circle cx={cx - 2} cy={cy - 1.5} r="1.1" fill="#d6b05c" />
                        <circle cx={cx + 2.2} cy={cy + 0.8} r="1.1" fill="#d6b05c" />
                        <rect
                          x={cx - 1}
                          y={cy - 4}
                          width="2"
                          height="1.2"
                          fill={glow ? `hsl(${(k.x * 22 + S.current.t * 120 + k.y * 30) % 360}, 80%, 65%)` : down.has(k.code) ? "#8ad9a8" : "#e8e8e8"}
                        />
                      </g>
                    );
                  })}
                  <text x="6" y={BOARD_H * 10 - 3} fontSize="3" fill="#8fc7a5" fontFamily="var(--font-mono), monospace">
                    RP65 · REV B · HOT-SWAP
                  </text>
                </svg>
              )}
              {L.id === "plate" && (
                <svg viewBox={`0 0 ${BOARD_W * 10} ${BOARD_H * 10}`} className="absolute" style={at(0, 0, BOARD_W, BOARD_H, 0)}>
                  <defs>
                    <linearGradient id={`brass-${mode}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#e2c27e" />
                      <stop offset="0.5" stopColor="#b48a42" />
                      <stop offset="1" stopColor="#d9b867" />
                    </linearGradient>
                  </defs>
                  <path
                    fillRule="evenodd"
                    fill={`url(#brass-${mode})`}
                    d={`M0 0 H${BOARD_W * 10} V${BOARD_H * 10} H0 Z ${KEYS.map((k) => {
                      const cx = (k.x + k.w / 2) * 10, cy = (k.y + 0.5) * 10;
                      return `M${cx - 3.5} ${cy - 3.5} h7 v7 h-7 Z`;
                    }).join(" ")}`}
                  />
                </svg>
              )}
              {L.id === "switches" &&
                KEYS.map((k) => {
                  const isDown = down.has(k.code);
                  return (
                    <div key={k.code} className="absolute" style={{ ...at(k.x + k.w / 2 - 0.4, k.y + 0.1, 0.8, 0.8, 0), transformStyle: "preserve-3d" }}>
                      <div className="absolute inset-0 rounded-[18%] bg-[#1a1b1c]" />
                      <div className="absolute inset-[14%] rounded-[16%] bg-[rgba(200,205,210,0.55)]" style={{ transform: `translateZ(calc(${U} * 0.08))` }} />
                      <div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[30%] h-[30%]"
                        style={{
                          transform: `translate(-50%,-50%) translateZ(calc(${U} * ${isDown ? 0.06 : 0.22}))`,
                          background: "linear-gradient(#e5484d,#e5484d) center/100% 34% no-repeat, linear-gradient(#e5484d,#e5484d) center/34% 100% no-repeat",
                          transition: "transform 60ms",
                        }}
                      />
                    </div>
                  );
                })}
              {L.id === "caps" &&
                KEYS.map((k) => {
                  const tn = TONES[k.tone ?? "alpha"];
                  const isDown = down.has(k.code);
                  return (
                    <div
                      key={k.code}
                      data-key
                      onPointerDown={(e) => {
                        if (!play) return;
                        e.stopPropagation();
                        press(k.code, k.label.length === 1 ? k.label : k.code === "Space" ? " " : undefined);
                      }}
                      onPointerUp={() => release(k.code)}
                      onPointerLeave={() => release(k.code)}
                      className="absolute rounded-[calc(var(--u)*0.14)] cursor-pointer"
                      style={{
                        ...at(k.x, k.y, k.w, 1, 0.05),
                        background: tn.side,
                        transform: `translateZ(calc(${U} * ${isDown ? 0.02 : 0.2}))`,
                        transition: "transform 55ms",
                        transformStyle: "preserve-3d",
                      }}
                    >
                      <div
                        className="absolute inset-[6%_8%_16%_8%] rounded-[calc(var(--u)*0.11)] font-mono uppercase leading-none p-[6%] flex"
                        style={{
                          background: `linear-gradient(180deg, ${tn.cap}, ${tn.cap} 65%, ${tn.side} 160%)`,
                          color: tn.text,
                          fontSize: `calc(${U} * 0.2)`,
                          transform: `translateZ(calc(${U} * 0.12))`,
                        }}
                      >
                        {k.label}
                      </div>
                    </div>
                  );
                })}
              {play && (
                <span
                  data-label
                  className="hidden md:block absolute whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em] text-[#0d100e] bg-[rgba(242,234,215,0.9)] px-2 py-1 rounded"
                  style={{ left: `calc(${U} * ${BOARD_W / 2 + 0.9})`, top: `calc(${U} * -0.4)`, opacity: 0 }}
                >
                  {L.label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {play && (
        <div className="shrink-0 flex flex-wrap items-center gap-4 px-4 py-3 bg-[var(--ink)] text-[var(--paper)]">
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
      )}
    </div>
  );
}
