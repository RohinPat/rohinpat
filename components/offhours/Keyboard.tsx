"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PieceProps } from "./useCanvas";
import { useVisibleLoop } from "./useVisibleLoop";
import { burst, getAudio, modal, tone } from "./audio";

// The 65% board I built, in the thirteen layers it's built from, in CSS 3D:
// brass weight, case, case foam, hot-swap PCB (sockets, diodes, LEDs, the
// MCU, the USB-C port), plate foam, brass plate with flex cuts, gasket
// strips, stabilisers, and every switch in its four pieces (bottom housing,
// spring, stem, top housing) under the keycaps. Pull it apart with the
// slider, orbit it by dragging, pick a part to isolate it, and type: each
// key goes down through cap, stem and spring with a synthesized thock and
// comes back up with its own upstroke, and every keystroke presses the
// stack back together. The Konami code lights the underglow.

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

// lay the keys out in units; cx/cy is the switch position
const KEYS = ROWS.flatMap((row, y) => {
  let x = 0;
  return row.map((k) => {
    const w = k.u ?? 1;
    const out = { ...k, x, y, w, cx: x + w / 2, cy: y + 0.5 };
    x += w;
    return out;
  });
});
const STABBED = KEYS.filter((k) => k.w >= 2);
const BOARD_W = 16;
const BOARD_H = 5;

const TONES = {
  alpha: { cap: "#f2ead7", side: "#c9c4b8", text: "#0d100e" },
  mod: { cap: "#3a3936", side: "#22211f", text: "#e7e3da" },
  accent: { cap: "#1d5e3f", side: "#123b27", text: "#f2ead7" },
};

type Part = { id: string; label: string; note: string };
const PARTS: Part[] = [
  { id: "weight", label: "Brass weight", note: "A slab of brass in the bottom of the case: heft, and a deeper sound." },
  { id: "case", label: "Aluminium case", note: "CNC-milled, anodised. Everything else floats inside it on gaskets." },
  { id: "casefoam", label: "Case foam", note: "Poron between the PCB and the case. Kills the hollow ping." },
  { id: "pcb", label: "Hot-swap PCB", note: "Sockets so switches pull out without soldering, a diode and LED per key, the MCU running QMK, USB-C." },
  { id: "platefoam", label: "Plate foam", note: "Thin foam between plate and PCB. Tightens up the bottom-out." },
  { id: "plate", label: "Brass plate", note: "Holds the switches. The flex cuts let it give a little under your fingers." },
  { id: "gaskets", label: "Gasket strips", note: "Rubber tabs the plate sits on. Gasket mount: soft, even, no hard metal-on-metal." },
  { id: "stabs", label: "Stabilisers", note: "Keep the long keys level. Clipped, lubed and band-aid modded so they don't rattle." },
  { id: "bottoms", label: "Switch bottoms", note: "Nylon bottom housings. Nylon is the deeper, rounder sounding half." },
  { id: "springs", label: "Springs", note: "62 g, slow-curve. Lubed so they don't ping." },
  { id: "stems", label: "Stems", note: "POM stems: smooth, self-lubricating, and the cross mount the keycap sits on." },
  { id: "tops", label: "Switch tops", note: "Polycarbonate top housings, clear so the per-key LEDs shine through." },
  { id: "caps", label: "PBT keycaps", note: "Thick PBT, doubleshot legends. The colourway is the site's: cream, ink, racing green." },
];

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "KeyB", "KeyA"];

export default function Keyboard({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const uid = `k` + useId().replace(/[^a-zA-Z0-9]/g, ""); // SSR-stable, safe in url(#…)
  const [explode, setExplode] = useState(play ? 0.75 : 0.4);
  const [down, setDown] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [glow, setGlow] = useState(false);
  const [solo, setSolo] = useState<string | null>(null);
  const S = useRef({ explode: play ? 0.75 : 0.4, orbit: { x: 0, y: 0 }, drag: false, last: { x: 0, y: 0 }, t: 0, nextAuto: 0.6, konami: [] as string[], glowT: -10 });
  const held = useRef(new Set<string>());
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
    burst(au, { freq: 5200, q: 0.7, type: "highpass", dur: 0.004, gain: 0.05 }); // the clack
    if (isLong(code)) burst(au, { freq: 3200, q: 3, dur: 0.012, gain: 0.05, at: 0.012 }); // stab wire
  };

  const press = (code: string, char?: string) => {
    if (held.current.has(code)) return;
    held.current.add(code);
    setDown(new Set(held.current));
    thock(code);
    if (code === "Backspace") setTyped((t) => t.slice(0, -1));
    else if (char) setTyped((t) => (t + char).slice(-32));
    // each keystroke presses the stack back together
    if (play) setExplode((e) => Math.max(0, e - 0.04));
    const s = S.current;
    s.konami = [...s.konami, code].slice(-KONAMI.length);
    if (s.konami.join() === KONAMI.join()) {
      setGlow(true);
      s.glowT = s.t;
      const au = getAudio();
      if (au) [523, 659, 784, 1047].forEach((f, i) => tone(au, { freq: f, dur: 0.18, gain: 0.12, at: i * 0.08, type: "square" }));
    }
  };
  const release = (code: string) => {
    if (!held.current.has(code)) return;
    held.current.delete(code);
    setDown(new Set(held.current));
    thock(code, true);
  };

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

  const loopRef = useVisibleLoop<HTMLDivElement>((dt) => {
    const s = S.current;
    s.t += dt;
    if (!play && s.t > 0.2 && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = play ? explodeRef.current : 0.5 - 0.5 * Math.cos(s.t * 0.5);
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
    const rx = 26 + e * 36 + s.orbit.y;
    const rz = -e * 16 + s.orbit.x;
    if (stage.current) stage.current.style.transform = `rotateX(${rx}deg) rotateZ(${rz}deg)`;
    const mid = (PARTS.length - 1) / 2;
    const show = String(Math.max(0, Math.min(1, (e - 0.3) / 0.35)));
    layers.current.forEach((el, i) => {
      if (!el) return;
      el.style.transform = `translateZ(calc(var(--u) * ${(i * 0.07 + e * (i - mid) * 1.35).toFixed(3)}))`;
      const label = el.querySelector<HTMLElement>("[data-label]");
      const leader = el.querySelector<HTMLElement>("[data-leader]");
      if (label) {
        label.style.opacity = show;
        label.style.transform = `translate(0, -50%) rotateZ(${-rz}deg) rotateX(${-rx}deg)`;
      }
      if (leader) leader.style.opacity = show;
    });
  }, paused);

  const U = "var(--u)";
  // a rectangle in board units, centred on (cx, cy)
  const at = (cx: number, cy: number, w: number, h: number) => ({
    left: `calc(${U} * ${cx - w / 2 - BOARD_W / 2})`,
    top: `calc(${U} * ${cy - h / 2 - BOARD_H / 2})`,
    width: `calc(${U} * ${w})`,
    height: `calc(${U} * ${h})`,
  });
  const board = (pad = 0) => at(BOARD_W / 2, BOARD_H / 2, BOARD_W + pad * 2, BOARD_H + pad * 2);
  const svgBox = (pad = 0) => ({ viewBox: `${-pad * 10} ${-pad * 10} ${(BOARD_W + pad * 2) * 10} ${(BOARD_H + pad * 2) * 10}`, style: board(pad) });

  const onOrbitDown = (e: React.PointerEvent) => {
    if (!play || (e.target as HTMLElement).closest("[data-key], button")) return;
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

  const art: Record<string, React.ReactNode> = {
    weight: (
      <div
        className="absolute rounded-[calc(var(--u)*0.25)] grid place-items-center"
        style={{ ...at(BOARD_W / 2, BOARD_H / 2 + 0.6, 9, 2.6), background: "linear-gradient(135deg,#e7c77e,#b48a42 55%,#d9b867)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }}
      >
        <span className="font-mono uppercase tracking-[0.3em] text-[#5b4520]" style={{ fontSize: `calc(${U} * 0.32)` }}>
          RP65 · 2026
        </span>
      </div>
    ),
    case: (
      <>
        <div
          className="absolute rounded-[calc(var(--u)*0.35)]"
          style={{
            ...board(0.45),
            background: "linear-gradient(160deg,#2c2f30,#121414)",
            boxShadow: `0 calc(${U} * 0.9) calc(${U} * 1.4) calc(${U} * -0.5) rgba(13,16,14,0.6), inset 0 1px 0 rgba(255,255,255,0.12)`,
          }}
        />
        <div className="absolute rounded-[calc(var(--u)*0.2)]" style={{ ...board(0.15), background: "#0b0c0c", boxShadow: "inset 0 0 0 2px #1d2021" }} />
        {/* USB-C cutout */}
        <div className="absolute rounded-full bg-[#050606]" style={at(BOARD_W - 1.8, -0.32, 0.7, 0.2)} />
      </>
    ),
    casefoam: (
      <svg {...svgBox(0)} className="absolute" aria-hidden="true">
        <rect x="2" y="2" width={BOARD_W * 10 - 4} height={BOARD_H * 10 - 4} rx="3" fill={`url(#${uid}-foam)`} />
        <rect x={(BOARD_W - 3) * 10} y="0" width="22" height="9" fill="#0b0c0c" />
      </svg>
    ),
    pcb: (
      <svg {...svgBox(0)} className="absolute" aria-hidden="true" style={{ ...board(0), filter: glow ? "drop-shadow(0 0 14px rgba(138,217,168,0.85))" : undefined }}>
        <rect width={BOARD_W * 10} height={BOARD_H * 10} rx="3" fill="#145233" />
        {/* traces */}
        {KEYS.map((k, i) => (
          <path key={`t${k.code}`} d={`M${k.cx * 10 + 2} ${k.cy * 10 + 2.6} h${3 + (i % 3)} v${2 + (i % 2) * 2}`} stroke="#2d7a4f" strokeWidth="0.45" fill="none" />
        ))}
        {KEYS.map((k) => {
          const x = k.cx * 10, y = k.cy * 10;
          const lit = glow ? `hsl(${Math.round((k.x * 22 + k.y * 30) % 360)}, 85%, 65%)` : down.has(k.code) ? "#8ad9a8" : "#f4f4f2";
          return (
            <g key={k.code}>
              {/* hot-swap socket */}
              <path d={`M${x - 3.6} ${y + 1.2} a1.3 1.3 0 1 1 2.6 0 h3.2 a1.3 1.3 0 1 1 2.6 0 v1.6 h-8.4 z`} fill="#141414" />
              {/* switch pin holes */}
              <circle cx={x} cy={y} r="1.1" fill="#0b2b1a" stroke="#d6b05c" strokeWidth="0.35" />
              <circle cx={x - 2.4} cy={y - 1.2} r="0.55" fill="#0b2b1a" stroke="#d6b05c" strokeWidth="0.3" />
              <circle cx={x + 2.4} cy={y - 1.2} r="0.55" fill="#0b2b1a" stroke="#d6b05c" strokeWidth="0.3" />
              {/* diode */}
              <rect x={x + 2.6} y={y + 2.6} width="2.2" height="1" fill="#1a1a1a" />
              <rect x={x + 4.2} y={y + 2.6} width="0.4" height="1" fill="#d9d9d9" />
              {/* LED */}
              <rect x={x - 1} y={y - 4.1} width="2" height="1.2" fill={lit} />
            </g>
          );
        })}
        {/* MCU + crystal + USB-C */}
        <g transform={`translate(${(BOARD_W - 2.6) * 10} 6)`}>
          <rect x="-4" y="-4" width="8" height="8" fill="#1b1b1b" />
          {Array.from({ length: 7 }, (_, i) => (
            <g key={i}>
              <rect x={-3.4 + i} y="-4.8" width="0.4" height="0.8" fill="#c9ccd0" />
              <rect x={-3.4 + i} y="4" width="0.4" height="0.8" fill="#c9ccd0" />
              <rect x="-4.8" y={-3.4 + i} width="0.8" height="0.4" fill="#c9ccd0" />
              <rect x="4" y={-3.4 + i} width="0.8" height="0.4" fill="#c9ccd0" />
            </g>
          ))}
          <circle cx="-2.6" cy="-2.6" r="0.5" fill="#444" />
          <rect x="6" y="-1.5" width="2.6" height="1.4" rx="0.3" fill="#c9ccd0" />
        </g>
        <rect x={(BOARD_W - 2.15) * 10} y="-1" width="9" height="3.4" rx="1" fill="#c9ccd0" stroke="#8a8f96" strokeWidth="0.4" />
        <text x="5" y={BOARD_H * 10 - 2.5} fontSize="2.6" fill="#8fc7a5" fontFamily="var(--font-mono), monospace">
          RP65 · REV B · HOT-SWAP · QMK/VIA
        </text>
      </svg>
    ),
    platefoam: (
      <svg {...svgBox(0)} className="absolute" aria-hidden="true">
        <path
          fillRule="evenodd"
          fill="rgba(236,236,230,0.92)"
          d={`M1 1 H${BOARD_W * 10 - 1} V${BOARD_H * 10 - 1} H1 Z ${KEYS.map((k) => `M${k.cx * 10 - 3.6} ${k.cy * 10 - 3.6} h7.2 v7.2 h-7.2 Z`).join(" ")}`}
        />
      </svg>
    ),
    plate: (
      <svg {...svgBox(0)} className="absolute" aria-hidden="true">
        <path
          fillRule="evenodd"
          fill={`url(#${uid}-brass)`}
          d={`M0 0 H${BOARD_W * 10} V${BOARD_H * 10} H0 Z ${KEYS.map((k) => `M${k.cx * 10 - 3.5} ${k.cy * 10 - 3.5} h7 v7 h-7 Z`).join(" ")} ${STABBED.map((k) =>
            [-1, 1].map((sd) => `M${k.cx * 10 + sd * (k.w * 10 * 0.36) - 1.6} ${k.cy * 10 - 3} h3.2 v6 h-3.2 Z`).join(" "),
          ).join(" ")} ${[1, 2, 3, 4].map((r) => `M${12 + r * 8} ${r * 10 - 0.5} h${BOARD_W * 10 - 40 - r * 16} v1 h-${BOARD_W * 10 - 40 - r * 16} Z`).join(" ")}`}
        />
      </svg>
    ),
    gaskets: (
      <>
        {[
          [2.5, -0.08, 1.4, 0.3],
          [8, -0.08, 1.4, 0.3],
          [13.5, -0.08, 1.4, 0.3],
          [2.5, 5.08, 1.4, 0.3],
          [8, 5.08, 1.4, 0.3],
          [13.5, 5.08, 1.4, 0.3],
          [-0.08, 1.5, 0.3, 1.2],
          [-0.08, 3.5, 0.3, 1.2],
          [16.08, 1.5, 0.3, 1.2],
          [16.08, 3.5, 0.3, 1.2],
        ].map(([cx, cy, w, h], i) => (
          <div key={i} className="absolute rounded-[3px] bg-[#e5484d]" style={at(cx, cy, w, h)} />
        ))}
      </>
    ),
    stabs: (
      <svg {...svgBox(0)} className="absolute overflow-visible" aria-hidden="true">
        {STABBED.map((k) => {
          const dx = k.w * 10 * 0.36;
          const x = k.cx * 10, y = k.cy * 10;
          return (
            <g key={k.code}>
              <path d={`M${x - dx} ${y + 2.6} V${y + 4.2} H${x + dx} V${y + 2.6}`} stroke="#c9ccd0" strokeWidth="0.7" fill="none" />
              {[-1, 1].map((sd) => (
                <g key={sd} transform={`translate(${x + sd * dx} ${y})`}>
                  <rect x="-1.8" y="-3.2" width="3.6" height="6.4" rx="0.6" fill="#1b1b1b" />
                  <rect x="-1" y="-2" width="2" height="2.4" fill="#e5484d" />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    ),
    bottoms: KEYS.map((k) => (
      <div key={k.code} className="absolute rounded-[18%]" style={{ ...at(k.cx, k.cy, 0.62, 0.62), background: "#2a2b2e", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}>
        <div className="absolute inset-[30%] rounded-full bg-[#1a1b1d]" />
      </div>
    )),
    springs: KEYS.map((k) => {
      const isDown = down.has(k.code);
      return (
        <div
          key={k.code}
          className="absolute rounded-full"
          style={{
            ...at(k.cx, k.cy, 0.3, 0.3),
            background: "repeating-radial-gradient(circle, #e6e8ea 0 1.2px, #8a8f96 1.2px 2.4px)",
            transform: `scale(${isDown ? 0.82 : 1})`,
            transition: "transform 60ms",
          }}
        />
      );
    }),
    stems: KEYS.map((k) => {
      const isDown = down.has(k.code);
      return (
        <div key={k.code} className="absolute" style={{ ...at(k.cx, k.cy, 0.34, 0.34), transform: `translateZ(calc(${U} * ${isDown ? -0.5 : 0}))`, transition: "transform 60ms" }}>
          <div className="absolute inset-[18%] rounded-[2px] bg-[#c94147]" />
          <div className="absolute left-[42%] top-0 w-[16%] h-full bg-[#e5484d]" />
          <div className="absolute top-[42%] left-0 h-[16%] w-full bg-[#e5484d]" />
        </div>
      );
    }),
    tops: KEYS.map((k) => (
      <div
        key={k.code}
        className="absolute rounded-[16%]"
        style={{ ...at(k.cx, k.cy, 0.66, 0.66), background: "rgba(220,230,240,0.38)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.55)" }}
      >
        <div className="absolute left-1/2 top-[8%] -translate-x-1/2 w-[30%] h-[16%] rounded-sm bg-white/50" />
        <div className="absolute inset-[34%] rounded-[2px] bg-[rgba(13,16,14,0.25)]" />
      </div>
    )),
    caps: KEYS.map((k) => {
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
            ...at(k.cx, k.cy, k.w - 0.1, 0.9),
            background: tn.side,
            transform: `translateZ(calc(${U} * ${isDown ? -0.18 : 0}))`,
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
    }),
  };

  const active = PARTS.find((p) => p.id === solo);

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
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-brass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e2c27e" />
            <stop offset="0.5" stopColor="#b48a42" />
            <stop offset="1" stopColor="#d9b867" />
          </linearGradient>
          <pattern id={`${uid}-foam`} width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="#5d6163" />
            <circle cx="1" cy="1" r="0.6" fill="#4b4f51" />
            <circle cx="3" cy="2.6" r="0.5" fill="#6b6f71" />
          </pattern>
        </defs>
      </svg>
      <div
        className="relative flex-1 min-h-0 overflow-hidden touch-none select-none"
        style={{ perspective: "1800px", ["--u" as string]: play ? "min(3.1cqw, 4.6cqh)" : "min(4.6cqw, 10cqh)" } as React.CSSProperties}
        onPointerDown={onOrbitDown}
        onPointerMove={onOrbitMove}
        onPointerUp={() => (S.current.drag = false)}
      >
        <div ref={stage} className="absolute left-[46%] top-1/2 w-0 h-0" style={{ transformStyle: "preserve-3d" }}>
          {PARTS.map((p, i) => (
            <div
              key={p.id}
              ref={(el) => {
                layers.current[i] = el;
              }}
              className="absolute left-0 top-0 w-0 h-0 transition-opacity duration-300"
              style={{ transformStyle: "preserve-3d", opacity: solo && solo !== p.id ? 0.08 : 1, filter: solo === p.id ? "drop-shadow(0 0 8px rgba(29,94,63,0.6))" : undefined }}
            >
              {art[p.id]}
              {play && (
                <>
                  <div
                    data-leader
                    className="hidden md:block absolute h-px bg-[#0d100e]/50"
                    style={{ left: `calc(${U} * ${BOARD_W / 2 + 0.2})`, top: `calc(${U} * -0.5)`, width: `calc(${U} * 1.6)`, opacity: 0 }}
                  />
                  <button
                    type="button"
                    data-label
                    tabIndex={-1}
                    onClick={() => setSolo(solo === p.id ? null : p.id)}
                    className={`hidden md:block absolute whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded ${
                      solo === p.id ? "bg-[#0d100e] text-[#f2ead7]" : "bg-[rgba(242,234,215,0.92)] text-[#0d100e]"
                    }`}
                    style={{ left: `calc(${U} * ${BOARD_W / 2 + 1.9})`, top: `calc(${U} * -0.5)`, opacity: 0 }}
                  >
                    {p.label}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
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
            {[...PARTS].reverse().map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={solo === p.id}
                onClick={() => {
                  setSolo(solo === p.id ? null : p.id);
                  if (explode < 0.5) setExplode(0.8);
                }}
                className={`h-7 px-2.5 rounded-full text-[11px] ${solo === p.id ? "bg-[var(--paper)] text-[var(--ink)]" : "text-[#cfd0c6] hover:bg-white/10"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p aria-live="polite" className="hidden md:block text-[12px] text-[#cfd0c6] min-h-[1.4em]">
            {active?.note ?? "Pick a part to isolate it. Type to put it back together."}
          </p>
        </div>
      )}
    </div>
  );
}
