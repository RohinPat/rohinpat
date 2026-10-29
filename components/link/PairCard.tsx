"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCode } from "@/lib/link/code";
import { makeQr, qrBox, qrPath } from "@/lib/link/qr";
import type { LinkState } from "@/lib/link/session";

// The card on the laptop phone's lock screen (and the Duo's cover). Cream on
// the dark wallpaper. It opens out of the padlock (PairLock), which also
// announces its status, and out of the Pair chip on Off hours (PairChip).
// Loaded on demand with the link code. The home screen's widget (PairWidget)
// shows the same code with PairQr and pairHost.

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
  const [how, setHow] = useState(false);
  const { state, paired, code, pairUrl, stale, renew } = info;
  const short = useMemo(() => pairHost(pairUrl), [pairUrl]);

  const live = paired;
  const dead = state === "closed" && stale;
  const status = live ? `Phone linked. ${linked}` : dead ? "That code expired." : "";

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

      {how ? (
        <div className="mt-2.5 min-h-[112px] text-[12.5px] leading-snug">
          <ul className="space-y-1.5 list-disc pl-4 marker:text-[var(--signal)]">
            <li>Scan the code with your phone&apos;s camera. It opens a page that streams your phone&apos;s tilt to this tab.</li>
            <li>Tilt to tilt this phone, swipe up to unlock it, tap an app to open it here.</li>
            <li>Devices talk directly when they can, through this site&apos;s relay when not. Nothing is stored; no accounts.</li>
          </ul>
          {/* a press on a link would start the lock layer's swipe and capture the pointer; stop it here */}
          <Link
            href="/projects/phone-link"
            data-venom
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-1.5 inline-block py-0.5 font-semibold underline underline-offset-2 decoration-[var(--signal)] text-[var(--signal)]"
          >
            Read how it works
          </Link>
        </div>
      ) : live ? (
        <div className="mt-2.5 min-h-[112px] flex items-center gap-3" data-testid="pair-linked">
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
          <PairQr pairUrl={pairUrl} size={112} />
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
