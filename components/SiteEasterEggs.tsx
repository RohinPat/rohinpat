"use client";

import { useEffect, useRef, useState } from "react";
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
      "color:#8ad9a8;font-size:20px;font-weight:600;font-family:Menlo,monospace;line-height:1.4";
    const dim = "color:#9ca3af;font-family:Menlo,monospace;line-height:1.6";
    const accent = "color:#8ad9a8;font-family:Menlo,monospace;line-height:1.6";

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

  if (!active) return null;

  // Visible for 2.4s; the fade-out is baked into the keyframes.
  return (
    <div
      key={active}
      className="fixed inset-0 pointer-events-none flex items-center justify-center animate-[egg-life_2.4s_ease-out_forwards]"
      style={{ zIndex: 55 }}
    >
      <Confetti />
      <div className="flex flex-col items-center gap-3 animate-[egg-pop_0.5s_cubic-bezier(0.2,1.4,0.4,1)]">
        <div
          className="display bg-[var(--signal)] text-[var(--on-signal)] px-8 pt-3 pb-2 shadow-2xl"
          style={{ fontSize: "clamp(3.5rem, 10vw, 8rem)" }}
        >
          Goallllll
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--paper)] bg-[var(--ink)] px-3 py-1.5">
          {flavor}
        </p>
      </div>
    </div>
  );
}

function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: 60 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.3,
      dur: 1.6 + Math.random() * 1.1,
      w: 6 + Math.random() * 4,
      h: 10 + Math.random() * 6,
      accent: i % 2 === 0,
    })),
  );
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((c, i) => (
        <span
          key={i}
          className={`absolute -top-5 ${c.accent ? "bg-[var(--signal)]" : "bg-[var(--paper)]"}`}
          style={{
            left: `${c.left}%`,
            width: c.w,
            height: c.h,
            animation: `egg-fall ${c.dur}s ${c.delay}s ease-in forwards`,
          }}
        />
      ))}
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
