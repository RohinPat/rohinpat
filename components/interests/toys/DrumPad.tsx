"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSound } from "../SoundContext";

type PadId = "kick" | "snare" | "hat" | "clap";

type Pad = {
  id: PadId;
  label: string;
  key: string;
  detail: string;
};

const PADS: Pad[] = [
  { id: "kick",  label: "Kick",   key: "A", detail: "808 thud" },
  { id: "snare", label: "Snare",  key: "S", detail: "filtered crack" },
  { id: "hat",   label: "Hat",    key: "D", detail: "tight close" },
  { id: "clap",  label: "Clap",   key: "F", detail: "doubled noise" },
];

export default function DrumPad() {
  const [hit, setHit] = useState<PadId | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const noiseRef = useRef<AudioBuffer | null>(null);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hoverRef = useRef(false);
  const sound = useSound();

  const ensureAudio = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const AC = (window.AudioContext ||
      (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AC();
    ctxRef.current = ctx;
    // Pre-build noise buffer
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseRef.current = buf;
    return ctx;
  }, []);

  const trigger = useCallback(
    (id: PadId) => {
      // Always flash the pad — audio gated by sound toggle
      setHit(id);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setHit(null), 130);

      if (!sound.enabled) return;

      const ctx = ensureAudio();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      switch (id) {
        case "kick":
          playKick(ctx);
          break;
        case "snare":
          playSnare(ctx, noiseRef.current);
          break;
        case "hat":
          playHat(ctx, noiseRef.current);
          break;
        case "clap":
          playClap(ctx, noiseRef.current);
          break;
      }
    },
    [ensureAudio, sound.enabled],
  );

  // Keyboard support — only while hovering this card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const pad = PADS.find((p) => p.key.toLowerCase() === k);
      if (pad) {
        e.preventDefault();
        trigger(pad.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trigger]);

  // Cleanup audio context
  useEffect(() => {
    return () => {
      try {
        ctxRef.current?.close();
      } catch {
        /* no-op */
      }
    };
  }, []);

  return (
    <div
      onMouseEnter={() => {
        hoverRef.current = true;
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
      }}
      className="w-full max-w-[340px] mx-auto"
    >
      <div className="grid grid-cols-2 gap-2">
        {PADS.map((p) => {
          const active = hit === p.id;
          return (
            <button
              key={p.id}
              onPointerDown={() => trigger(p.id)}
              className={`relative aspect-square border-2 transition-all duration-100 select-none active:scale-95 ${
                active
                  ? "bg-accent border-accent text-white shadow-[0_0_20px_rgba(165,0,68,0.5)]"
                  : "border-[var(--border-strong)] hover:border-accent text-[var(--fg)]"
              }`}
            >
              <div className="absolute top-2 left-2 font-mono text-[10px] uppercase tracking-wider opacity-60">
                {p.key}
              </div>
              <div className="absolute bottom-2 left-2 right-2 text-left">
                <div className="text-2xl font-semibold tracking-tight">
                  {p.label}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider opacity-60">
                  {p.detail}
                </div>
              </div>
              {/* Pad indicator dot */}
              <motion.span
                className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${
                  active ? "bg-white" : "bg-accent/40"
                }`}
                animate={active ? { scale: [1, 2, 1] } : { scale: 1 }}
                transition={{ duration: 0.2 }}
              />
            </button>
          );
        })}
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider dim text-center">
        Tap · or hover + <span className="text-[var(--fg)]">A S D F</span>
        {!sound.enabled && <span className="ml-2 accent">· sound off</span>}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Synthesis                                                                  */
/* -------------------------------------------------------------------------- */

function playKick(ctx: AudioContext) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.9, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.5);
}

function playSnare(ctx: AudioContext, noise: AudioBuffer | null) {
  if (!noise) return;
  const t = ctx.currentTime;
  // Body — short triangle
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
  const oGain = ctx.createGain();
  oGain.gain.setValueAtTime(0.5, t);
  oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(oGain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);

  // Snares — filtered noise
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1200;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.5, t);
  nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  n.connect(hp).connect(nGain).connect(ctx.destination);
  n.start(t);
  n.stop(t + 0.2);
}

function playHat(ctx: AudioContext, noise: AudioBuffer | null) {
  if (!noise) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  hp.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.18, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  n.connect(hp).connect(gain).connect(ctx.destination);
  n.start(t);
  n.stop(t + 0.1);
}

function playClap(ctx: AudioContext, noise: AudioBuffer | null) {
  if (!noise) return;
  const t = ctx.currentTime;
  // Three quick bursts to simulate a clap
  [0, 0.015, 0.035].forEach((offset, i) => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 1.4;
    const gain = ctx.createGain();
    const peak = i === 2 ? 0.32 : 0.22;
    gain.gain.setValueAtTime(0, t + offset);
    gain.gain.linearRampToValueAtTime(peak, t + offset + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, t + offset + (i === 2 ? 0.18 : 0.06));
    n.connect(bp).connect(gain).connect(ctx.destination);
    n.start(t + offset);
    n.stop(t + offset + 0.2);
  });
}
