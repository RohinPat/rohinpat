"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSound } from "../SoundContext";

const IDLE_RPM = 800;
const MAX_RPM = 9000;
const REDLINE = 7500;

// Sweep range for the needle, in degrees.
const ARC_START = -135; // 0 RPM
const ARC_END = 135;    // MAX_RPM
const ARC_SPAN = ARC_END - ARC_START;

export default function Tachometer() {
  const [rpm, setRpm] = useState(IDLE_RPM);
  const throttleRef = useRef(false);
  const rpmRef = useRef(IDLE_RPM);
  const rafRef = useRef<number | null>(null);

  // Web Audio refs
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // Only listen for Space when the user is hovering this card
  const hoverRef = useRef(false);

  const sound = useSound();
  const soundRef = useRef(sound.enabled);
  useEffect(() => {
    soundRef.current = sound.enabled;
    // When muted, kill audio immediately
    if (!sound.enabled && gainRef.current && ctxRef.current) {
      gainRef.current.gain.setTargetAtTime(0, ctxRef.current.currentTime, 0.02);
    }
  }, [sound.enabled]);

  const ensureAudio = useCallback(() => {
    if (ctxRef.current) return;
    const AC = (window.AudioContext ||
      (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 60;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    ctxRef.current = ctx;
    oscRef.current = osc;
    gainRef.current = gain;
  }, []);

  // Physics + audio update loop
  useEffect(() => {
    const tick = () => {
      const target = throttleRef.current ? MAX_RPM : IDLE_RPM;
      const r = rpmRef.current;
      const diff = target - r;
      // Faster spool-up, slower spool-down
      const step = throttleRef.current ? diff * 0.07 : diff * 0.045;
      const next = Math.max(IDLE_RPM, Math.min(MAX_RPM, r + step));
      rpmRef.current = next;
      setRpm(next);

      // Audio sync — gated by global sound toggle
      const ctx = ctxRef.current;
      const osc = oscRef.current;
      const gain = gainRef.current;
      if (ctx && osc && gain) {
        const freq = 55 + (next / MAX_RPM) * 130;
        osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
        const g = soundRef.current
          ? Math.max(
              0,
              Math.min(0.22, ((next - IDLE_RPM) / (MAX_RPM - IDLE_RPM)) * 0.22),
            )
          : 0;
        gain.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      try {
        oscRef.current?.stop();
        ctxRef.current?.close();
      } catch {
        /* no-op */
      }
    };
  }, []);

  const start = useCallback(() => {
    ensureAudio();
    if (ctxRef.current?.state === "suspended") {
      ctxRef.current.resume().catch(() => {});
    }
    throttleRef.current = true;
  }, [ensureAudio]);

  const stop = useCallback(() => {
    throttleRef.current = false;
  }, []);

  // Keyboard support — space to rev, only while hovering the card
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        if (!hoverRef.current) return;
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            (t as any).isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        start();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [start, stop]);

  const angle = ARC_START + (rpm / MAX_RPM) * ARC_SPAN;
  const isRedline = rpm > REDLINE;

  const rad = ((angle - 90) * Math.PI) / 180;
  const nx = 100 + Math.cos(rad) * 62;
  const ny = 100 + Math.sin(rad) * 62;

  return (
    <div
      onMouseEnter={() => {
        hoverRef.current = true;
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
      }}
      className="flex flex-col items-center gap-5 w-full max-w-[340px] mx-auto"
    >
      <svg viewBox="0 0 200 200" className="w-full">
        {/* Outer ring */}
        <circle cx="100" cy="100" r="88" fill="#0a0a0a" stroke="#1a1a1a" strokeWidth="1.5" />

        {/* Tick marks */}
        {[...Array(10)].map((_, i) => {
          const a = ARC_START + (i / 9) * ARC_SPAN;
          const r1 = 72;
          const r2 = 82;
          const ra = ((a - 90) * Math.PI) / 180;
          const x1 = 100 + Math.cos(ra) * r1;
          const y1 = 100 + Math.sin(ra) * r1;
          const x2 = 100 + Math.cos(ra) * r2;
          const y2 = 100 + Math.sin(ra) * r2;
          const labelX = 100 + Math.cos(ra) * 64;
          const labelY = 100 + Math.sin(ra) * 64 + 2;
          const isRed = i >= 8; // top half of dial
          return (
            <g key={i}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isRed ? "#a50044" : "#9ca3af"}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                fill={isRed ? "#a50044" : "#6b6b6b"}
                fontSize="7"
                fontFamily="monospace"
                fontWeight={600}
              >
                {i}
              </text>
            </g>
          );
        })}

        {/* Redline arc */}
        <path
          d={describeArc(100, 100, 76, REDLINE / MAX_RPM, 1)}
          stroke="#a50044"
          strokeWidth="2.5"
          fill="none"
        />

        {/* Needle */}
        <line
          x1="100"
          y1="100"
          x2={nx}
          y2={ny}
          stroke={isRedline ? "#a50044" : "#ededed"}
          strokeWidth="2.6"
          strokeLinecap="round"
          style={{ filter: isRedline ? "drop-shadow(0 0 4px rgba(165,0,68,0.6))" : "none" }}
        />
        <circle cx="100" cy="100" r="7" fill={isRedline ? "#a50044" : "#ededed"} />
        <circle cx="100" cy="100" r="2" fill="#0a0a0a" />

        {/* RPM × 1000 label */}
        <text x="100" y="148" textAnchor="middle" fill="#6b6b6b" fontSize="7" fontFamily="monospace" letterSpacing="2">
          RPM × 1000
        </text>
      </svg>

      <div className="font-mono text-xs uppercase tracking-wider muted text-center min-h-[16px]">
        {isRedline ? <span className="accent">redline</span> : "idle"} ·{" "}
        <span className="tabular-nums text-[var(--fg)]">{Math.round(rpm).toLocaleString()}</span> rpm
      </div>

      <button
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        className="select-none px-6 py-3 border border-[var(--border-strong)] hover:border-accent hover:accent transition-colors font-mono text-xs uppercase tracking-[0.2em] active:bg-accent active:text-white active:border-accent touch-none"
      >
        Hold to rev
      </button>
      <p className="font-mono text-[10px] uppercase tracking-wider dim text-center">
        or hold space (hover the card) · {sound.enabled ? "engine on" : "muted · flip sound on ↑"}
      </p>
    </div>
  );
}

// SVG arc helper (start fraction → end fraction of the full ARC_SPAN)
function describeArc(cx: number, cy: number, r: number, startFrac: number, endFrac: number) {
  const startA = ARC_START + startFrac * ARC_SPAN;
  const endA = ARC_START + endFrac * ARC_SPAN;
  const sRad = ((startA - 90) * Math.PI) / 180;
  const eRad = ((endA - 90) * Math.PI) / 180;
  const x1 = cx + Math.cos(sRad) * r;
  const y1 = cy + Math.sin(sRad) * r;
  const x2 = cx + Math.cos(eRad) * r;
  const y2 = cy + Math.sin(eRad) * r;
  const large = endA - startA > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}
