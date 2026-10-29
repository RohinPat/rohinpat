"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { isPaired } from "@/lib/link/state";
import { onHostChange, peekHost, useLink } from "@/lib/link/useLink";
import { useLinkOk } from "@/lib/link/useLinkOk";
import type { PairInfo } from "./PairCard";

// "Pair": the phone link's way in away from the home page, in the corner of
// Off hours and of each game's stage. Press it and the pairing card opens
// under it (a disclosure, like the padlock's: Escape or a press outside
// closes it). Only on the screens the link is for (useLinkOk).
//
// It attaches to the link the home page made if there is one. Otherwise it
// starts one only when pressed, so a visitor who never presses it costs
// nothing: no network, no code on the relay. A phone that joins from here is
// told which screen the laptop is on by Off hours itself (useRemoteList, then
// the open game's useRemote).

const loadCard = () => import("./PairCard");
const PairCard = dynamic(loadCard, { ssr: false });

const CLOSE_MS = 200; // matches pl-pop-out in globals.css

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function PairChip({ tone }: { tone: "light" | "dark" }) {
  if (!useLinkOk()) return null;
  return <Chip tone={tone} />;
}

function Chip({ tone }: { tone: "light" | "dark" }) {
  const { state, path, code, pairUrl, start, stop } = useLink("host");
  const paired = isPaired(state, path);
  const dead = state === "closed";
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();

  // a link that already exists (made on the home page) is ours to show at once
  useEffect(() => {
    const sync = () => peekHost() && start();
    sync();
    return onHostChange(sync);
  }, [start]);

  const renew = useCallback(() => {
    stop();
    start();
  }, [stop, start]);

  const info: PairInfo = { state, paired, code, pairUrl, stale: dead, renew };

  const toggle = () => {
    if (open) return close();
    void loadCard();
    // an ended link (the phone left, or the code ran out) gets a fresh code
    if (dead) renew();
    else start();
    setOpen(true);
  };

  const close = useCallback(() => {
    if (pop.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), reducedMotion() ? 0 : CLOSE_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // the stage's own Escape (close the game) stands down while this is open: see data-pair-open in Stage
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

  const look =
    tone === "dark"
      ? "border-white/15 hover:bg-white/10"
      : "border-[var(--border-strong)] hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]";

  return (
    <div ref={box} className="relative" data-pair-open={open || undefined}>
      <button
        ref={trigger}
        type="button"
        data-testid="pair-chip"
        data-state={paired ? "linked" : "idle"}
        aria-expanded={open}
        aria-controls={popId}
        aria-label={paired ? "Phone linked" : "Pair your phone"}
        onClick={toggle}
        className={`h-10 px-3.5 inline-flex items-center gap-2 rounded-full border font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${look}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
          <path d="M10.5 18.5h3" />
        </svg>
        {paired && <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[var(--mint)]" />}
        <span aria-hidden="true">{paired ? "Linked" : "Pair"}</span>
      </button>

      {mounted && (
        <div
          ref={pop}
          id={popId}
          data-state={open ? "open" : "closing"}
          className="pl-pop absolute right-0 top-full mt-2 z-[95] w-[340px] flex justify-end select-text cursor-auto"
          style={{ transformOrigin: "calc(100% - 40px) -12px" }}
        >
          <PairCard info={info} linked="Pick a game on your phone, or open one here." />
        </div>
      )}
    </div>
  );
}
