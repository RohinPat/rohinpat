"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cardSummary, proofPoints } from "@/app/resume/data";
import { site } from "@/lib/site";

// The lock screen's name notification, made a button: it opens "the
// 30-second version", a card for someone who has half a minute. It is a
// modal dialog (focus stays inside, Escape closes it, focus goes back to the
// notification) and it never unlocks the phone: pointer events stop here, and
// it lives outside the lock layer, so its scrolling isn't read as a swipe.
//
// Where it opens: inside the phone's own screen when the phone is framed (the
// desktop phone, the Duo's cover); full screen on a phone, over the site nav.
// All copy lives in app/resume/data.ts.

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function QuickCard({ dark }: { dark: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const close = useCallback(() => setHost(null), []);
  const open = () => {
    const framed = window.matchMedia("(min-width: 768px)").matches;
    const screen = framed ? trigger.current?.closest<HTMLElement>(".dev-screen, .duo-outer") : null;
    setHost(screen ?? document.body);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        data-venom
        className={`mt-6 block rounded-[22px] px-4 py-3 text-center backdrop-blur-xl transition-transform duration-150 active:scale-[0.98] ${
          dark ? "bg-[rgba(242,234,215,0.12)]" : "bg-[rgba(242,234,215,0.6)]"
        }`}
      >
        <span className="block font-semibold">{site.name}</span>
        <span className="block text-sm opacity-80">
          {site.role} · {site.employer}
        </span>
        <span className="sr-only">. Opens the 30-second summary.</span>
      </button>
      {host && createPortal(<Card framed={host !== document.body} onClose={close} returnTo={trigger} />, host)}
    </>
  );
}

function Card({
  framed,
  onClose,
  returnTo,
}: {
  framed: boolean;
  onClose: () => void;
  returnTo: React.RefObject<HTMLButtonElement>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const leaving = useRef(false); // following a link: do not pull focus back
  const titleId = useId();

  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // the trap: if focus gets out (shift-tab from the first control, or the
    // site nav beside a framed phone), bring it back in
    const onFocusIn = (e: FocusEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) closeBtn.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    const back = returnTo.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      if (!leaving.current) back?.focus({ preventScroll: true });
    };
  }, [onClose, returnTo]);

  const onTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !root.current) return;
    const els = Array.from(root.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const go = () => {
    leaving.current = true;
  };

  const cta = "flex-1 text-center px-4 py-3 rounded-full font-semibold text-[15px] transition-colors";

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onTab}
      // the phone underneath reads pointer movement as a swipe-to-unlock
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className={`${framed ? "absolute z-[45]" : "fixed z-[95]"} inset-0 flex flex-col bg-[rgba(13,16,14,0.94)] backdrop-blur-xl text-[var(--paper)] animate-[rise_0.25s_ease-out]`}
    >
      <div
        className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 ${
          framed ? "pt-[54px]" : "pt-[max(env(safe-area-inset-top),18px)]"
        } pb-5`}
      >
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#f5c542]">The 30-second version</p>
          <button
            ref={closeBtn}
            type="button"
            onClick={onClose}
            data-venom
            aria-label="Close the card"
            className="w-10 h-10 -mr-2 rounded-full grid place-items-center bg-white/10 hover:bg-white/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <h2 id={titleId} className="display mt-3 text-[3.25rem] leading-[0.9]">
          {site.name}
        </h2>
        <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.14em] opacity-80">
          {site.role} · {site.employer}
        </p>
        <p className="mt-4 text-[17px] leading-snug text-pretty">{cardSummary}</p>

        <ul className="mt-5 border-t border-white/15">
          {proofPoints.map((p) => (
            <li key={p.lead} className="py-3 border-b border-white/15">
              <p className="text-[15px] font-semibold leading-tight">
                {p.href ? (
                  <Link href={p.href} onClick={go} data-venom className="underline underline-offset-2 decoration-white/40 hover:decoration-current">
                    {p.lead}
                  </Link>
                ) : (
                  p.lead
                )}
              </p>
              <p className="mt-1 text-[13.5px] leading-snug opacity-80 text-pretty">{p.text}</p>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[15px]">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] opacity-70 mr-2">Email</span>
          <a href={`mailto:${site.email}`} data-venom className="underline underline-offset-2 break-all">
            {site.email}
          </a>
        </p>
      </div>

      {/* pinned, so the two ways onward are on screen even where the card scrolls */}
      <div className={`shrink-0 flex gap-3 px-6 pt-3 border-t border-white/10 ${framed ? "pb-7" : "pb-[max(env(safe-area-inset-bottom),20px)]"}`}>
        <Link href="/resume" onClick={go} data-venom className={`${cta} bg-[var(--paper)] text-[var(--ink)] hover:bg-white`}>
          Resume
        </Link>
        <Link href="/projects" onClick={go} data-venom className={`${cta} border border-white/40 hover:bg-white/10`}>
          See the work
        </Link>
      </div>
    </div>
  );
}
