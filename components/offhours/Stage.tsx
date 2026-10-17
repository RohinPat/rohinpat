"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isMuted, onMuteChange, setMuted } from "./audio";

// Full-screen stage a piece opens into. It grows out of the tile you clicked
// (a clip-path from the tile's rect to the whole window) and shrinks back on
// close. A modal dialog: focus moves in and is kept in, Escape closes, the
// page behind doesn't scroll.

export type StageMeta = { index: number; label: string; title: string; how: string[] };

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const MS = 440;

function useMuted() {
  return useSyncExternalStore(onMuteChange, isMuted, () => false);
}

export default function Stage({
  meta,
  origin,
  onClose,
  children,
}: {
  meta: StageMeta;
  origin: DOMRect | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const muted = useMuted();
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, reduce ? 0 : MS - 40);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const id = requestAnimationFrame(() => setShown(true));
    // focus the piece once it has grown in
    const f = window.setTimeout(
      () => (root.current?.querySelector<HTMLElement>("[data-autofocus]") ?? closeBtn.current)?.focus({ preventScroll: true }),
      reduce ? 0 : MS,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !root.current) return;
      const items = Array.from(root.current.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])')).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    // Keys belong to the game. A mouse click on a button or a slider inside
    // the stage (pick a solver, a club, Play...) would leave focus on that
    // control and the game would stop hearing the keyboard, so hand focus
    // back. Keyboard users tabbing through controls keep their focus.
    const game = () => root.current?.querySelector<HTMLElement>("[data-autofocus]") ?? null;
    const refocus = (e: Event) => {
      const t = e.target as HTMLElement;
      const ctl = t.closest("button, input, [role=slider]");
      if (!ctl || ctl === closeBtn.current || ctl.getAttribute("role") === "slider") return;
      const g = game();
      if (g && g !== ctl && !g.contains(ctl)) window.setTimeout(() => g.focus({ preventScroll: true }), 0);
    };
    const onClick = (e: MouseEvent) => e.detail > 0 && refocus(e);
    const onPointerUp = (e: PointerEvent) => (e.target as HTMLElement).matches?.("input[type=range]") && refocus(e);
    // and if focus has fallen out to the page, the next key goes to the game
    const onStray = (e: KeyboardEvent) => {
      const a = document.activeElement;
      if (e.key === "Escape" || e.key === "Tab" || !root.current) return;
      if (a === document.body || a === root.current) {
        const g = game();
        if (!g) return;
        e.preventDefault();
        g.focus({ preventScroll: true });
        g.dispatchEvent(new KeyboardEvent(e.type, { key: e.key, code: e.code, shiftKey: e.shiftKey, repeat: e.repeat, bubbles: true, cancelable: true }));
      }
    };
    const el = root.current;
    el?.addEventListener("click", onClick, true);
    el?.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("keydown", onStray);
    window.addEventListener("keyup", onStray);
    return () => {
      html.style.overflow = prev;
      cancelAnimationFrame(id);
      window.clearTimeout(f);
      window.removeEventListener("keydown", onKey, true);
      el?.removeEventListener("click", onClick, true);
      el?.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("keydown", onStray);
      window.removeEventListener("keyup", onStray);
    };
  }, [reduce]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const from = origin
    ? `inset(${origin.top}px ${vw - origin.right}px ${vh - origin.bottom}px ${origin.left}px round 4px)`
    : "inset(0px 0px 0px 0px round 0px)";
  const open = shown && !closing;

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-title"
      className="fixed inset-0 z-[90] flex flex-col bg-[var(--ink)] text-[var(--paper)]"
      style={{
        clipPath: open || reduce ? "inset(0px 0px 0px 0px round 0px)" : from,
        transition: reduce ? "none" : `clip-path ${MS}ms ${EASE}`,
      }}
    >
      <header className="flex items-start justify-between gap-4 px-4 md:px-8 pt-4 md:pt-5 pb-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--mint)]">
            {String(meta.index).padStart(2, "0")} — {meta.label}
          </p>
          <h2 id="stage-title" className="hero-field mt-1 text-[clamp(1.9rem,4.2vw,3.4rem)]">
            {meta.title}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            aria-pressed={!muted}
            className="h-10 px-3.5 rounded-full border border-white/15 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-white/10"
          >
            Sound {muted ? "off" : "on"}
          </button>
          <button
            ref={closeBtn}
            type="button"
            onClick={close}
            aria-label="Close"
            className="w-10 h-10 rounded-full grid place-items-center bg-[var(--paper)] text-[var(--ink)] hover:scale-105 transition-transform"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 px-4 md:px-8 pb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#b5b6ab]">
        {meta.how.map((h, i) => (
          <li key={h} className={i ? "hidden sm:list-item" : undefined}>
            {h}
          </li>
        ))}
      </ul>
      <div className="relative flex-1 min-h-0 mx-2 mb-2 md:mx-4 md:mb-4 rounded-[14px] overflow-hidden border border-white/10">
        {children}
      </div>
    </div>,
    document.body,
  );
}
