"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PairInfo } from "./PairCard";

// The padlock on the lock screen, above the date. On a phone or a tablet it is
// only the glyph an iPhone shows there. Where the phone link is on, it is the
// way in: press it and it opens out into the pairing card (a disclosure: the
// card is a popover under the padlock, Escape or a press outside closes it).
// When a phone links, the shackle swings open like Face ID unlocking.
//
// The lock layer reads a press as the start of a swipe and a scroll as an
// unlock, so the open card opts out of both (data-no-swipe, and a wheel
// listener that stops here). The card itself (and its QR code) is fetched as
// soon as the link starts.

const loadCard = () => import("./PairCard");
const PairCard = dynamic(loadCard, { ssr: false });

const CLOSE_MS = 200; // matches pl-pop-out in globals.css
const NUDGE_AFTER_MS = 5000;
// one wiggle per visit, even if the lock screen remounts (the window crossed a breakpoint)
let nudged = false;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Glyph({ open, wiggle }: { open?: boolean; wiggle?: boolean }) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      overflow="visible"
      aria-hidden="true"
      className={`block drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)] ${wiggle ? "pl-wiggle" : ""}`}
    >
      <path
        className="pl-shackle"
        data-testid="pair-shackle"
        data-state={open ? "open" : "closed"}
        d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6.5 10.5h11a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2ZM12 13.4a1.45 1.45 0 0 0-.6 2.77V17.6a.6.6 0 0 0 1.2 0v-1.43A1.45 1.45 0 0 0 12 13.4Z"
      />
    </svg>
  );
}

export default function PairLock({ info, locked }: { info: PairInfo | null; locked: boolean }) {
  // `info` is only there when the link is on (a wide screen with a mouse)
  if (!info) {
    return (
      <div className="mt-[88px] md:mt-[62px] text-center" aria-hidden="true">
        <div className="mx-auto w-fit px-3 py-1">
          <Glyph />
        </div>
        {/* the room the label takes once the link starts, so the date doesn't move */}
        <div className="hidden md:block h-4 mt-1" />
      </div>
    );
  }
  return <Interactive info={info} locked={locked} />;
}

function Interactive({ info, locked }: { info: PairInfo; locked: boolean }) {
  const { paired, state, stale } = info;
  const dead = state === "closed" && stale;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [wiggle, setWiggle] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();

  const label = paired ? "Linked · swipe up on your phone" : dead ? "Code expired" : "Scan to pair";
  const status = paired ? "Phone linked. Tilt it, then swipe up on it to unlock." : dead ? "That code expired." : "";

  // the card is fetched before the first press
  useEffect(() => void loadCard(), []);

  const close = useCallback(() => {
    // focus inside the card would be lost with it: hand it back to the padlock
    if (pop.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);

  // mounted a moment longer than open, so the card can close the way it opened
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), reducedMotion() ? 0 : CLOSE_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  // a phone linking closes the card (and unlocking the screen does too)
  useEffect(() => {
    if (paired || !locked) close();
  }, [paired, locked, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close]);

  // a scroll over the card isn't the lock layer's: it neither unlocks nor scrolls the page
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const stop = (e: WheelEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, [mounted]);

  // nobody touched the lock screen for a few seconds: one small wiggle, once
  const touched = useRef(false);
  useEffect(() => {
    if (nudged || !locked) return;
    const seen = () => {
      touched.current = true;
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach((n) => window.addEventListener(n, seen, { passive: true }));
    const id = window.setTimeout(() => {
      if (touched.current || reducedMotion()) return;
      nudged = true;
      setWiggle(true);
    }, NUDGE_AFTER_MS);
    return () => {
      events.forEach((n) => window.removeEventListener(n, seen));
      window.clearTimeout(id);
    };
  }, [locked]);

  return (
    <div ref={box} className="z-10 mt-[88px] md:mt-[62px] flex flex-col items-center">
      {/* the rest of the lock screen steps back while the card is out */}
      {mounted && <div aria-hidden="true" data-state={open ? "open" : "closing"} className="pl-scrim pointer-events-none absolute inset-0" />}
      <button
        ref={trigger}
        type="button"
        data-testid="pair-lock"
        data-wiggle={wiggle || undefined}
        aria-expanded={open}
        aria-controls={popId}
        aria-label="Pair your phone with this one"
        onClick={() => setOpen((v) => !v)}
        onPointerEnter={() => (touched.current = true)}
        className="flex flex-col items-center gap-1 rounded-2xl px-3 py-1 transition-colors duration-150 hover:bg-[rgba(242,234,215,0.1)] active:bg-[rgba(242,234,215,0.16)]"
      >
        <Glyph open={paired} wiggle={wiggle} />
        <span data-testid="pair-lock-label" aria-hidden="true" className="h-4 text-[12px] leading-4 opacity-75 whitespace-nowrap">
          {label}
        </span>
      </button>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      {/* a point just under the padlock, for the card to hang from */}
      <div className="relative w-0 h-0">
        {mounted && (
          <div
            ref={pop}
            id={popId}
            data-no-swipe
            data-state={open ? "open" : "closing"}
            className="pl-pop absolute left-0 top-2 -ml-[178px] w-[356px] flex justify-center select-text cursor-auto"
          >
            <PairCard info={info} announce={false} />
          </div>
        )}
      </div>
    </div>
  );
}
