"use client";

import { useEffect, useRef, useState } from "react";
import type { CourseGame } from "@/components/offhours/golf/play";
import { overUnder } from "@/components/offhours/golf/score";
import { highlights, modeName, roundStats, shareText, type Setup } from "./modes";

// The end of a round: the score, the card, how it was played, and a way to send
// it to someone (text with a link that replays the round).

export default function RoundEnd({ game, setup, onAgain, onMenu }: { game: CourseGame; setup: Setup; onAgain: () => void; onMenu: () => void }) {
  const r = game.round!;
  const s = roundStats(game);
  const best = highlights(game);
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const again = useRef<HTMLButtonElement>(null);
  const text = shareText(setup, game.scores, typeof location === "undefined" ? "" : location.origin);
  useEffect(() => again.current?.focus({ preventScroll: true }), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };
  const cell = (d: { n: number; par: number }, i: number) => {
    const sc = game.scores[i];
    const tone = !sc ? "" : sc.strokes < d.par ? "text-[#edbb00] ring-1 ring-[#edbb00] rounded-full" : sc.strokes > d.par ? "text-[#ff9a8f] ring-1 ring-[#ff9a8f]/70" : "text-[#f2ead7]";
    return (
      <div key={d.n} className="flex flex-col items-center gap-1.5 font-mono text-[11px]">
        <span className="text-[#b5b6ab]">{d.n}</span>
        <span className="text-[#b5b6ab]/70">{d.par}</span>
        <span className={`w-7 h-7 inline-flex items-center justify-center text-[13px] ${tone}`}>{sc?.strokes ?? ""}</span>
      </div>
    );
  };
  const stat = (k: string, v: string) => (
    <div className="flex flex-col">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#b5b6ab]">{k}</dt>
      <dd className="text-xl font-bold text-[#f2ead7]">{v}</dd>
    </div>
  );
  const btn = "h-10 px-4 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8ad9a8]";

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0d100e]/60 backdrop-blur-[2px] p-3 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Round over">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d100e]/90 p-5 sm:p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8ad9a8]">{modeName(setup)}</p>
        <p className="mt-2 text-[64px] leading-none font-extrabold text-[#f2ead7]">{r.total}</p>
        <p className={`mt-1 font-mono text-[12px] uppercase tracking-[0.14em] ${r.total <= r.par ? "text-[#edbb00]" : "text-[#b5b6ab]"}`}>{overUnder(r.total, r.par)}</p>
        <div className="mt-5 flex justify-center gap-3">{setup.defs.map(cell)}</div>
        <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-left border-t border-white/10 pt-4">
          {stat("Fairways", s.fairways)}
          {stat("Greens", s.greens)}
          {stat("Putts", String(s.putts))}
          {stat("Longest", s.drive === null ? "–" : `${s.drive} yd`)}
        </dl>
        {best.length > 0 && <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]">{best.join(" · ")}</p>}
        {r.isBest && r.previous !== null && <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#edbb00]">Best this visit</p>}
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
