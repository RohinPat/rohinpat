"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { formatCode } from "@/lib/link/code";
import { makeQr, qrBox, qrPath } from "@/lib/link/qr";
import type { LinkState } from "@/lib/link/session";

// The card on the laptop phone's lock screen (and the Duo's cover). Cream on
// the dark wallpaper. It opens out of the padlock (PairLock), which also
// announces its status, and out of the Pair chip on Off hours (PairChip).
// Loaded on demand with the link code. The QR is all it shows at first; the
// address and code wait behind "Can't scan?". The home screen's widget
// (PairWidget) uses the same PairQr and CantScan.

export type PairInfo = {
  state: LinkState | "idle";
  /** a phone is on the other end and messages flow (see isPaired) */
  paired: boolean;
  code: string | null;
  pairUrl: string | null;
  /** the code died and we've stopped auto-replacing it */
  stale: boolean;
  renew: () => void;
};

/** The pairing page's address without the code, to type by hand. */
export function pairHost(pairUrl: string | null): string {
  if (!pairUrl) return "";
  try {
    const u = new URL(pairUrl);
    return `${u.host}${u.pathname}`;
  } catch {
    return "";
  }
}

/** The QR of `pairUrl`, black on white, or a placeholder while the code is being made. */
export function PairQr({ pairUrl, size, testId = "pair-qr" }: { pairUrl: string | null; size: number; testId?: string }) {
  const qr = useMemo(() => (pairUrl ? makeQr(pairUrl) : null), [pairUrl]);
  return (
    <div className="shrink-0 rounded-[10px] bg-white overflow-hidden grid place-items-center" style={{ width: size, height: size }}>
      {qr ? (
        <svg
          viewBox={`0 0 ${qrBox(qr)} ${qrBox(qr)}`}
          role="img"
          aria-label="QR code. Scan it with your phone's camera to link your phone to this page."
          data-testid={testId}
          width={size}
          height={size}
          shapeRendering="crispEdges"
        >
          <rect width="100%" height="100%" fill="#fff" />
          <path d={qrPath(qr)} fill="#0d100e" />
        </svg>
      ) : (
        <span className="text-[11px] text-[var(--paper-muted)]">Making a code…</span>
      )}
    </div>
  );
}

/**
 * "Can't scan?": the address and the code to type, kept out of sight until
 * asked for (a disclosure: the text is in the page, `hidden` until opened).
 * The card and the home-screen widget both use it.
 */
export function CantScan({ pairUrl, code, testId = "pair-code" }: { pairUrl: string | null; code: string | null; testId?: string }) {
  const [open, setOpen] = useState(false);
  const short = useMemo(() => pairHost(pairUrl), [pairUrl]);
  const id = useId();
  return (
    <div className="min-w-0">
      <p id={id} hidden={!open} className="mb-1 text-[12px] leading-snug text-[var(--paper-muted)]">
        Open <span className="font-mono text-[11.5px] text-[var(--ink)] break-all">{short}</span> and type
        <span className="block font-mono text-[19px] font-medium tracking-[0.08em] tabular-nums text-[var(--ink)]" data-testid={testId}>
          {code ? formatCode(code) : "…"}
        </span>
      </p>
      <button
        type="button"
        data-venom
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="-ml-1 px-1 py-0.5 text-[12px] font-semibold underline underline-offset-2 decoration-[var(--signal)] text-[var(--signal)] rounded"
      >
        {open ? "Hide the code" : "Can't scan?"}
      </button>
    </div>
  );
}

export default function PairCard({
  info,
  announce = true,
  linked = "Tilt your phone, then swipe up on it to unlock this one.",
}: {
  info: PairInfo;
  announce?: boolean;
  /** what to do once a phone is on (after "Linked.") */
  linked?: string;
}) {
  const { state, paired, code, pairUrl, stale, renew } = info;
  const dead = state === "closed" && stale;
  const status = paired ? `Phone linked. ${linked}` : dead ? "That code expired." : "";

  return (
    <section
      aria-labelledby="pair-title"
      data-testid="pair-card"
      data-state={state}
      className="w-[calc(100%-1rem)] max-w-[340px] rounded-[22px] bg-[var(--paper)] text-[var(--ink)] p-3.5 text-left shadow-[0_10px_30px_-14px_rgba(0,0,0,0.6)]"
    >
      <h2 id="pair-title" className="text-[15px] leading-tight font-semibold">
        This phone&apos;s a replica.{" "}
        <strong className="font-extrabold text-[var(--signal)]">Pick up yours.</strong>
      </h2>

      {announce && (
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
      )}

      {paired ? (
        <div className="mt-2.5 flex items-center gap-3" data-testid="pair-linked">
          <span aria-hidden="true" className="grid place-items-center w-12 h-12 shrink-0 rounded-full bg-[var(--ink)] text-[var(--mint)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <p className="text-[13px] leading-snug">
            <strong className="font-semibold">Linked.</strong> {linked}
          </p>
        </div>
      ) : dead ? (
        <div className="mt-2.5 flex flex-col items-start gap-2">
          <p className="text-[13px] leading-snug">The code timed out.</p>
          <button type="button" data-venom onClick={renew} className="rounded-full bg-[var(--ink)] text-[var(--paper)] px-4 py-2 text-[13px] font-semibold">
            Get a new code
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex gap-3">
          <PairQr pairUrl={pairUrl} size={112} />
          <div className="min-w-0 flex flex-col justify-end items-start gap-0.5">
            <CantScan pairUrl={pairUrl} code={code} />
            {/* a press on a link would start the lock layer's swipe and capture the pointer; stop it here */}
            <Link
              href="/projects/phone-link"
              data-venom
              onPointerDown={(e) => e.stopPropagation()}
              className="-ml-1 px-1 py-0.5 text-[12px] font-semibold text-[var(--paper-muted)] underline underline-offset-2 rounded"
            >
              How it works
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
