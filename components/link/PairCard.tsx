"use client";

import { useMemo, useState } from "react";
import { formatCode } from "@/lib/link/code";
import { makeQr, qrBox, qrPath } from "@/lib/link/qr";
import type { LinkState } from "@/lib/link/session";

// The card on the laptop phone's lock screen (and the Duo's cover). Cream on
// the dark wallpaper, like the name card above it. It sits inside the lock
// layer, so a swipe or a scroll that starts on it still unlocks; only its own
// button swallows a press. Loaded on demand with the link code.

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

export default function PairCard({ info }: { info: PairInfo }) {
  const [how, setHow] = useState(false);
  const { state, paired, code, pairUrl, stale, renew } = info;

  const qr = useMemo(() => (pairUrl ? makeQr(pairUrl) : null), [pairUrl]);
  const short = useMemo(() => {
    if (!pairUrl) return "";
    try {
      const u = new URL(pairUrl);
      return `${u.host}${u.pathname}`;
    } catch {
      return "";
    }
  }, [pairUrl]);

  const live = paired;
  const dead = state === "closed" && stale;
  const status = live ? "Phone linked. Tilt it, then swipe up on it to unlock." : dead ? "That code expired." : "";

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

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      {how ? (
        <div className="mt-2.5 min-h-[112px] text-[12.5px] leading-snug">
          <ul className="space-y-1.5 list-disc pl-4 marker:text-[var(--signal)]">
            <li>Scan the code with your phone&apos;s camera. It opens a page that streams your phone&apos;s tilt to this tab.</li>
            <li>Tilt to tilt this phone, swipe up to unlock it, tap an app to open it here.</li>
            <li>Devices talk directly when they can, through this site&apos;s relay when not. Nothing is stored; no accounts.</li>
          </ul>
        </div>
      ) : live ? (
        <div className="mt-2.5 min-h-[112px] flex items-center gap-3" data-testid="pair-linked">
          <span aria-hidden="true" className="grid place-items-center w-12 h-12 shrink-0 rounded-full bg-[var(--ink)] text-[var(--mint)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <p className="text-[13px] leading-snug">
            <strong className="font-semibold">Linked.</strong> Tilt your phone, then swipe up on it to unlock this one.
          </p>
        </div>
      ) : dead ? (
        <div className="mt-2.5 min-h-[112px] flex flex-col items-start justify-center gap-2">
          <p className="text-[13px] leading-snug">The code timed out waiting for a phone.</p>
          <button
            type="button"
            data-venom
            onClick={renew}
            className="rounded-full bg-[var(--ink)] text-[var(--paper)] px-4 py-2 text-[13px] font-semibold"
          >
            Get a new code
          </button>
        </div>
      ) : (
        <div className="mt-2.5 min-h-[112px] flex items-center gap-3">
          <div className="w-[112px] h-[112px] shrink-0 rounded-[10px] bg-white overflow-hidden grid place-items-center">
            {qr ? (
              <svg
                viewBox={`0 0 ${qrBox(qr)} ${qrBox(qr)}`}
                role="img"
                aria-label="QR code. Scan it with your phone's camera to link your phone to this page."
                data-testid="pair-qr"
                width="112"
                height="112"
                shapeRendering="crispEdges"
              >
                <rect width="100%" height="100%" fill="#fff" />
                <path d={qrPath(qr)} fill="#0d100e" />
              </svg>
            ) : (
              <span className="text-[11px] text-[var(--paper-muted)]">Making a code…</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[12px] leading-snug text-[var(--paper-muted)]">Scan with your phone&apos;s camera, or open</p>
            <p className="font-mono text-[11.5px] break-all">{short}</p>
            <p className="mt-1.5 text-[12px] leading-snug text-[var(--paper-muted)]">and type</p>
            <p className="font-mono text-[19px] font-medium tracking-[0.08em] tabular-nums" data-testid="pair-code">
              {code ? formatCode(code) : "…"}
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        data-venom
        aria-expanded={how}
        onClick={() => setHow((v) => !v)}
        className="mt-1.5 -mb-1 -ml-1 px-1 py-1 text-[12px] font-semibold underline underline-offset-2 decoration-[var(--signal)] text-[var(--signal)] rounded"
      >
        {how ? "Back to the code" : "How this works"}
      </button>
    </section>
  );
}
