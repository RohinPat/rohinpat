"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  KONAMI_SEQUENCE,
  findWordTrigger,
  isKonamiMatch,
  isLetterKey,
  pushKonamiKey,
} from "@/lib/easter-eggs/matchers";

const FLAVOR: Record<string, string> = {
  siu: "Messi style",
  barca: "Força Barça",
  "barça": "Força Barça",
  neymar: "El Niño 11",
  messi: "GOAT mode",
  goal: "What a goal",
  visca: "Visca Barça!",
  konami: "you know the code",
};

export default function SiteEasterEggs() {
  const [active, setActive] = useState<string | null>(null);
  const keyBufRef = useRef<string[]>([]);
  const wordBufRef = useRef<string>("");
  const lockoutRef = useRef<number>(0);

  useEffect(() => {
    // Console signature — fires on first mount, sits at the top of devtools history.
    const heading =
      "color:#a50044;font-size:20px;font-weight:600;font-family:Menlo,monospace;line-height:1.4";
    const dim = "color:#9ca3af;font-family:Menlo,monospace;line-height:1.6";
    const accent = "color:#a50044;font-family:Menlo,monospace;line-height:1.6";

    console.log("%c👋  hey — rohin here.", heading);
    console.log(
      "%c    code: %chttps://github.com/RohinPat",
      dim,
      accent,
    );
    console.log(
      "%c    try the konami code on the page (%c↑↑↓↓←→←→ba%c)",
      dim,
      accent,
      dim,
    );
    console.log("%c    or type:  siu  ·  barca  ·  neymar  ·  messi", dim);

    const fire = (key: string) => {
      const now = performance.now();
      if (now < lockoutRef.current) return;
      lockoutRef.current = now + 2600;
      setActive(key);
      try {
        playWhistle();
      } catch {}
      setTimeout(() => setActive(null), 2400);
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          (t as any).isContentEditable)
      ) {
        return;
      }

      // Konami sequence
      keyBufRef.current = pushKonamiKey(keyBufRef.current, e.key);
      if (isKonamiMatch(keyBufRef.current)) {
        fire("konami");
        keyBufRef.current = [];
        return;
      }

      // Word triggers — accumulate letters only
      if (isLetterKey(e.key)) {
        wordBufRef.current = (wordBufRef.current + e.key.toLowerCase()).slice(-16);
        const match = findWordTrigger(wordBufRef.current);
        if (match) {
          fire(match);
          wordBufRef.current = "";
        }
      } else if (e.key.length === 1) {
        wordBufRef.current = "";
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flavor = active ? FLAVOR[active] ?? "Goallllll" : "";

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={active + Date.now()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 pointer-events-none flex items-center justify-center"
          style={{ zIndex: 55 }}
        >
          <Confetti />
          <motion.div
            initial={{ scale: 0.6, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 14 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="bg-accent text-white px-8 py-4 font-mono text-3xl md:text-5xl uppercase tracking-[0.2em] shadow-2xl">
              Goallllll
            </div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="font-mono text-xs uppercase tracking-[0.25em] text-white bg-black/70 px-3 py-1.5"
            >
              {flavor}
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Confetti() {
  const pieces = Array.from({ length: 60 });
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((_, i) => {
        const left = `${Math.random() * 100}%`;
        const delay = Math.random() * 0.3;
        const dur = 1.6 + Math.random() * 1.1;
        const isAccent = i % 2 === 0;
        const w = 6 + Math.random() * 4;
        const h = 10 + Math.random() * 6;
        return (
          <motion.span
            key={i}
            className={`absolute top-[-20px] ${isAccent ? "bg-accent" : "bg-white"}`}
            style={{ left, width: `${w}px`, height: `${h}px` }}
            initial={{ y: -20, rotate: 0, opacity: 1 }}
            animate={{
              y: typeof window === "undefined" ? 800 : window.innerHeight + 40,
              rotate: 540,
              opacity: 0,
            }}
            transition={{ duration: dur, delay, ease: "easeIn" }}
          />
        );
      })}
    </div>
  );
}

function playWhistle() {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  const ctx: AudioContext = new AC();
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(2200, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(2700, ctx.currentTime + 0.08);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.6);
  setTimeout(() => ctx.close(), 700);
}
