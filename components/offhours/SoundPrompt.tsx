"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRemoteReport } from "@/lib/link/remote";
import { audioBlocked, isMuted, onAudioState, onMuteChange, resumeAudio } from "./audio";

// "Click for sound". A game opened from a linked phone can start making sound
// before the visitor has touched the laptop, and the browser keeps audio
// suspended until it has had a click or a key. This says so, next to the
// stage's sound switch (clear of every game's own readouts), and goes away
// the moment audio runs. It never takes focus: a click on it hands focus
// straight back to the game (Stage does that for every button), and Enter on
// it does the same by hand. Any click or key anywhere also resumes audio, so
// the pill is a hint, not the only way. The phone is told too (the "audio"
// gesture), so its controller can say the same.

const subscribe = (f: () => void) => {
  const a = onAudioState(f);
  const b = onMuteChange(f);
  return () => {
    a();
    b();
  };
};
// blocked, and the visitor hasn't turned sound off on purpose
const snapshot = () => audioBlocked() && !isMuted();

export default function SoundPrompt({ returnFocus }: { returnFocus: () => void }) {
  const waiting = useSyncExternalStore(subscribe, snapshot, () => false);
  // a context that is only a moment from running (a click just happened) shouldn't flash a pill
  const [show, setShow] = useState(false);

  useRemoteReport("audio", "audio-sync", { blocked: waiting });

  useEffect(() => {
    if (!waiting) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), 400);
    const go = () => resumeAudio();
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
    };
  }, [waiting]);

  const on = waiting && show;
  return (
    <div role="status">
      <span className="sr-only">{on ? "Sound is waiting for a click or a key press." : ""}</span>
      {on && (
        <button
          type="button"
          data-testid="sound-prompt"
          onClick={(e) => {
            resumeAudio();
            // a mouse click is already handed back to the game by the stage; a key press is not
            if (e.detail === 0) returnFocus();
          }}
          className="sound-prompt inline-flex h-10 items-center gap-2 rounded-full border border-[var(--mint)]/50 pl-3 pr-3 sm:pr-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--paper)] hover:bg-white/10"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9z" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
          </svg>
          <span className="hidden sm:inline">Click for sound</span>
          <span className="sm:hidden">Sound?</span>
        </button>
      )}
    </div>
  );
}
