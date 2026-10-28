"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isMuted, onMuteChange, setMuted } from "./audio";
import SoundPrompt from "./SoundPrompt";

// Full-screen stage a piece opens into. It grows out of the tile you clicked
// (a clip-path from the tile's rect to the whole window) and shrinks back on
// close. A modal dialog: focus moves in and is kept in, Escape closes, the
// page behind doesn't scroll. On phones nothing pans, bounces or zooms either:
// a drag inside a game would otherwise scroll the page, collapse the browser
// bar and resize the canvas mid-shot.

export type StageMeta = { index: number; label: string; title: string; how: string[] };

/** What a piece with modes can say about itself while it is open: the heading and hints follow the mode. */
export type StageLabel = { title: string; how?: string[] };
const StageLabelContext = createContext<((l: StageLabel | null) => void) | null>(null);

/** Call from inside a piece (play mode only): the stage's heading and hints show this instead of the piece's own. */
export function useStageLabel(label: StageLabel | null) {
  const set = useContext(StageLabelContext);
  const title = label?.title;
  const how = label?.how ? JSON.stringify(label.how) : undefined;
  useEffect(() => {
    if (!set || title === undefined) return;
    set({ title, how: how ? (JSON.parse(how) as string[]) : undefined });
    return () => set(null);
  }, [set, title, how]);
}

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const MS = 440;

// On a touch screen the keyboard half of a hint is noise: drop "(or Space)",
// "(keys 1-7)" and keyboard-only lines, and say tap instead of click.
function forTouch(how: string[]) {
  return how
    .filter((h) => !h.startsWith("Keyboard:"))
    .map((h) => h.replace(/\s*\((?:or |keys )[^)]*\)/g, "").replace(/^Click/, "Tap").replace("arrows, WASD, or drag", "drag"));
}

function useMuted() {
  return useSyncExternalStore(onMuteChange, isMuted, () => false);
}

export default function Stage({
  meta,
  origin,
  onClose,
  closeSignal = 0,
  children,
}: {
  meta: StageMeta;
  origin: DOMRect | null;
  onClose: () => void;
  /** bump to close it as if the close button was pressed (the phone's Back button does) */
  closeSignal?: number;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const muted = useMuted();
  const [label, setLabel] = useState<StageLabel | null>(null);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const title = label?.title ?? meta.title;
  const hints = label?.how ?? meta.how;
  const how = touch ? forTouch(hints) : hints;

  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, reduce ? 0 : MS - 40);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  // only a bump after this stage opened closes it: a stage opened after an earlier Back
  // is mounted with the page's counter already above 0 and must not close itself
  const openedAt = useRef(closeSignal);
  useEffect(() => {
    if (closeSignal > openedAt.current) closeRef.current();
  }, [closeSignal]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const y = window.scrollY;
    const prev = [html.style.overflow, body.style.position, body.style.top, body.style.width];
    // overflow alone doesn't stop iOS Safari; pinning the body does
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.width = "100%";
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
    // the only touch drags allowed are inside something that really scrolls
    // (a panel of controls) or on a slider; no pinch zoom
    const scrolls = (n: Element | null) => {
      for (; n && n !== root.current; n = n.parentElement) {
        if (n instanceof HTMLInputElement) return true;
        const cs = getComputedStyle(n);
        if ((/auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) || (/auto|scroll/.test(cs.overflowX) && n.scrollWidth > n.clientWidth)) return true;
      }
      return false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1 || !scrolls(e.target as Element)) e.preventDefault();
    };
    const noGesture = (e: Event) => e.preventDefault();
    const el = root.current;
    el?.addEventListener("touchmove", onTouchMove, { passive: false });
    el?.addEventListener("gesturestart", noGesture);
    el?.addEventListener("click", onClick, true);
    el?.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("keydown", onStray);
    window.addEventListener("keyup", onStray);
    return () => {
      [html.style.overflow, body.style.position, body.style.top, body.style.width] = prev;
      window.scrollTo({ top: y, behavior: "instant" });
      cancelAnimationFrame(id);
      window.clearTimeout(f);
      window.removeEventListener("keydown", onKey, true);
      el?.removeEventListener("touchmove", onTouchMove);
      el?.removeEventListener("gesturestart", noGesture);
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
        touchAction: "manipulation",
        overscrollBehavior: "contain",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >
      <header className="flex items-start justify-between gap-4 px-4 md:px-8 pt-3 md:pt-5 pb-2 md:pb-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--mint)]">
            {String(meta.index).padStart(2, "0")} — {meta.label}
          </p>
          <h2 id="stage-title" className="hero-field mt-1 text-[clamp(1.6rem,4.2vw,3.4rem)] leading-[0.92]">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SoundPrompt returnFocus={() => root.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true })} />
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            aria-pressed={!muted}
            aria-label="Sound"
            className="h-10 w-10 sm:w-auto sm:px-3.5 grid place-items-center rounded-full border border-white/15 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-white/10"
          >
            {/* phones get the speaker alone so the title keeps the width */}
            <svg className="sm:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9z" />
              {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
            </svg>
            <span className="hidden sm:inline" aria-hidden="true">
              Sound {muted ? "off" : "on"}
            </span>
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
        {how.map((h, i) => (
          <li key={h} className={i ? "hidden sm:list-item" : undefined}>
            {h}
          </li>
        ))}
      </ul>
      <div className="relative flex-1 min-h-0 mx-2 mb-2 md:mx-4 md:mb-4 rounded-[14px] overflow-hidden border border-white/10">
        <StageLabelContext.Provider value={setLabel}>{children}</StageLabelContext.Provider>
      </div>
    </div>,
    document.body,
  );
}
