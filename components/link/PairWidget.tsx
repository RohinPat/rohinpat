"use client";

import Link from "next/link";
import { CantScan, PairQr, type PairInfo } from "./PairCard";

// The pairing code as a home-screen widget, under the app icons, so the code
// is still there once the lock screen (and its padlock) has gone. Full width,
// two rows tall, cream like the pairing card. It says nothing to a screen
// reader on its own: the padlock announces a phone linking, and once the
// screen is unlocked the status pill does (LinkHost).

export default function PairWidget({ info, i }: { info: PairInfo; i: number }) {
  const { state, paired, code, pairUrl, stale, renew } = info;
  const dead = state === "closed" && stale;

  return (
    <section
      aria-labelledby="pair-widget-title"
      data-testid="pair-widget"
      data-state={paired ? "linked" : dead ? "expired" : "waiting"}
      className="col-span-4 row-span-2 rounded-[24px] bg-[var(--paper)] text-[var(--ink)] p-3.5 flex items-center gap-3.5 shadow-[0_10px_30px_-14px_rgba(13,16,14,0.5),inset_0_0_0_1px_rgba(13,16,14,0.08)]"
      style={{ ["--i" as string]: i } as React.CSSProperties}
    >
      {paired ? (
        <span aria-hidden="true" className="grid place-items-center w-14 h-14 ml-1 shrink-0 rounded-full bg-[var(--ink)] text-[var(--mint)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>
      ) : (
        !dead && <PairQr pairUrl={pairUrl} size={128} testId="pair-widget-qr" />
      )}
      <div className="min-w-0 flex flex-col items-start gap-1">
        <h2 id="pair-widget-title" className="text-[14px] leading-tight font-semibold">
          This phone&apos;s a replica.{" "}
          <strong className="font-extrabold text-[var(--signal)]">Pick up yours.</strong>
        </h2>
        {paired ? (
          <p className="text-[12.5px] leading-snug">
            <strong className="font-semibold">Linked.</strong> Tap an app on your phone to open it here.
          </p>
        ) : dead ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[12.5px] leading-snug">The code timed out.</p>
            <button type="button" data-venom onClick={renew} className="rounded-full bg-[var(--ink)] text-[var(--paper)] px-4 py-1.5 text-[13px] font-semibold">
              Get a new code
            </button>
          </div>
        ) : (
          <CantScan pairUrl={pairUrl} code={code} testId="pair-widget-code" />
        )}
        <Link href="/projects/phone-link" data-venom className="-ml-1 self-start px-1 py-0.5 text-[12px] font-semibold text-[var(--paper-muted)] underline underline-offset-2 rounded">
          How it works
        </Link>
      </div>
    </section>
  );
}
