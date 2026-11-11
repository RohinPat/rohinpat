"use client";

import { useEffect, useRef, useState } from "react";
import type { Challenge } from "@/components/offhours/golf/play";
import { TARGETS } from "@/components/offhours/golf/scene";
import { challengeText, modeName, targetsRating, type Setup } from "./modes";

// The end of a range challenge: the score, each ball, and a way to send it to
// someone (text with a link that plays the same flags).

export default function ChallengeEnd({ ch, setup, onAgain, onMenu }: { ch: Challenge; setup: Setup; onAgain: () => void; onMenu: () => void }) {
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const again = useRef<HTMLButtonElement>(null);
  const text = challengeText(setup, ch, typeof location === "undefined" ? "" : location.origin);
  useEffect(() => again.current?.focus({ preventScroll: true }), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };
  const targets = ch.kind === "targets";
  const btn = "h-10 px-4 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8ad9a8]";

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0d100e]/60 backdrop-blur-[2px] p-3 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Challenge over">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d100e]/90 p-5 sm:p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8ad9a8]">{modeName(setup)}</p>
        <p className="mt-2 text-[64px] leading-none font-extrabold text-[#f2ead7]">{targets ? ch.score : `${ch.best} ft`}</p>
        <p className="mt-1 font-mono text-[12px] uppercase tracking-[0.14em] text-[#b5b6ab]">
          {targets ? `of ${ch.shots * 120} · ${targetsRating(ch.score, ch.shots)}` : `the ${TARGETS[ch.results[0]?.flag ?? 0].yd} yard flag, best of ${ch.shots}`}
        </p>
        <ol aria-label="Balls" className="mt-5 flex flex-wrap justify-center gap-2">
          {ch.results.map((r, i) => (
            <li key={i} className="flex flex-col items-center gap-1 font-mono text-[11px] min-w-8">
              <span className="text-[#b5b6ab]">{targets ? TARGETS[r.flag].yd : i + 1}</span>
              <span className={r.on ? "text-[#edbb00]" : "text-[#f2ead7]"}>{targets ? r.pts : `${r.ft}`}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#b5b6ab]/70">{targets ? "flag (yd) · points" : "ball · feet from the pin"}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button ref={again} type="button" onClick={onAgain} className={`${btn} bg-[#1d5e3f] text-[#f2ead7] hover:bg-[#237049]`}>
            Play again
          </button>
          <button type="button" onClick={copy} className={`${btn} border border-white/15 text-[#f2ead7] hover:border-[#8ad9a8]/60`}>
            {copied === "yes" ? "Copied" : "Copy result"}
          </button>
          <button type="button" onClick={onMenu} className={`${btn} text-[#b5b6ab] hover:text-[#f2ead7]`}>
            Modes
          </button>
        </div>
        {copied === "no" && <textarea readOnly value={text} rows={3} aria-label="Result" className="mt-3 w-full rounded-lg bg-black/40 p-2 font-mono text-[11px] text-[#f2ead7]" onFocus={(e) => e.currentTarget.select()} />}
      </div>
    </div>
  );
}
