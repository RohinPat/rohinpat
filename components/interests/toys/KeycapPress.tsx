"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSound } from "../SoundContext";

type Entry = { id: number; key: string };

let _entrySeq = 1;

export default function KeycapPress() {
  const [last, setLast] = useState<string>("RP");
  const [pressed, setPressed] = useState(false);
  const [count, setCount] = useState(0);
  const [history, setHistory] = useState<Entry[]>([]);
  const [ripples, setRipples] = useState<number[]>([]);
  const [wpm, setWpm] = useState(0);

  const releaseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hoverRef = useRef(false);
  const recentStrokesRef = useRef<number[]>([]); // timestamps

  const sound = useSound();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseBufRef = useRef<AudioBuffer | null>(null);

  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (audioCtxRef.current) return audioCtxRef.current;
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AC) return null;
    const ctx = new AC();
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    audioCtxRef.current = ctx;
    noiseBufRef.current = buf;
    return ctx;
  }, []);

  const playThock = useCallback(() => {
    if (!sound.enabled) return;
    const ctx = ensureAudio();
    if (!ctx || !noiseBufRef.current) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    // Body — short low triangle
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.05);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.18, t);
    oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(oGain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
    // Click — filtered noise
    const n = ctx.createBufferSource();
    n.buffer = noiseBufRef.current;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 1.5;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.08, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    n.connect(bp).connect(nGain).connect(ctx.destination);
    n.start(t);
    n.stop(t + 0.05);
  }, [sound.enabled, ensureAudio]);

  const tap = useCallback(
    (key: string) => {
      setLast(key);
      setPressed(true);
      setCount((c) => c + 1);
      setHistory((h) => {
        const next = [{ id: _entrySeq++, key }, ...h].slice(0, 5);
        return next;
      });
      // Ripple
      setRipples((r) => [...r.slice(-3), _entrySeq]);
      // WPM
      const now = performance.now();
      recentStrokesRef.current.push(now);
      // Trim to last 5 seconds
      recentStrokesRef.current = recentStrokesRef.current.filter(
        (ts) => now - ts < 5000,
      );
      setWpm(Math.round((recentStrokesRef.current.length / 5) * 12));

      playThock();
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = setTimeout(() => setPressed(false), 110);
    },
    [playThock],
  );

  // Decay WPM when not typing
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      recentStrokesRef.current = recentStrokesRef.current.filter(
        (ts) => now - ts < 5000,
      );
      setWpm(Math.round((recentStrokesRef.current.length / 5) * 12));
    }, 500);
    return () => clearInterval(id);
  }, []);

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

      let display: string;
      if (e.key === " ") display = "␣";
      else if (e.key.length === 1) display = e.key.toUpperCase();
      else if (e.key.startsWith("Arrow"))
        display =
          { Up: "↑", Down: "↓", Left: "←", Right: "→" }[
            e.key.replace("Arrow", "")
          ] ?? e.key;
      else if (e.key === "Enter") display = "↵";
      else if (e.key === "Backspace") display = "⌫";
      else if (e.key === "Tab") display = "⇥";
      else if (e.key === "Escape") display = "Esc";
      else display = e.key.slice(0, 4);

      tap(display);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap]);

  return (
    <div
      onMouseEnter={() => {
        hoverRef.current = true;
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
      }}
      className="flex flex-col items-center gap-3"
    >
      <div className="relative flex items-center gap-2">
        {/* Ghost history strip (oldest → newest, right-to-left) */}
        <div className="flex items-center gap-1 mr-1">
          {history
            .slice(1, 5)
            .reverse()
            .map((h, idx) => {
              const fade = 0.15 + idx * 0.12;
              return (
                <motion.div
                  key={h.id}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: fade, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="w-7 h-7 flex items-center justify-center border border-[var(--border-strong)] bg-[var(--bg-elevated)] font-mono text-xs"
                  style={{ color: `rgba(237,237,237,${fade + 0.4})` }}
                >
                  {h.key.length > 2 ? h.key.slice(0, 2) : h.key}
                </motion.div>
              );
            })}
        </div>

        <button
          onPointerDown={() => tap("CLK")}
          className="block select-none cursor-pointer relative"
          style={{ width: 96, height: 96 }}
        >
          {/* Ripples */}
          <AnimatePresence>
            {ripples.map((rid) => (
              <motion.span
                key={rid}
                initial={{ opacity: 0.7, scale: 0.6 }}
                animate={{ opacity: 0, scale: 2.2 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
                className="absolute inset-0 rounded-md border border-accent pointer-events-none"
                onAnimationComplete={() => {
                  setRipples((r) => r.filter((x) => x !== rid));
                }}
              />
            ))}
          </AnimatePresence>

          <div
            className={`relative w-full h-full bg-[var(--bg-elevated)] border-2 transition-all duration-100 rounded-md ${
              pressed
                ? "translate-y-1 border-accent shadow-none"
                : "border-[var(--border-strong)] shadow-[0_5px_0_var(--border-strong)]"
            }`}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.span
                key={`${last}-${count}`}
                initial={{ scale: 0.85 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 600, damping: 20 }}
                className={`font-mono font-semibold ${
                  pressed ? "accent" : "text-[var(--fg)]"
                } ${last.length > 2 ? "text-base" : "text-3xl"}`}
              >
                {last}
              </motion.span>
            </div>
            {/* Indicator dot */}
            <span
              className={`absolute top-1.5 right-1.5 w-1 h-1 rounded-full ${
                pressed ? "bg-accent" : "bg-[var(--border-strong)]"
              }`}
            />
          </div>
        </button>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-wider dim text-center">
        hover · type anything · or tap
      </p>
      <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-wider dim tabular-nums">
        <span>
          strokes <span className="text-[var(--fg)]">{count}</span>
        </span>
        <span className="text-[var(--border-strong)]">·</span>
        <span>
          wpm <span className={wpm > 0 ? "accent" : "text-[var(--fg)]"}>{wpm}</span>
        </span>
      </div>
    </div>
  );
}
