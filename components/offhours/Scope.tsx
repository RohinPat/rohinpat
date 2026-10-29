"use client";

import { useRef, useState } from "react";
import { analyser } from "./audio";
import { mono } from "./font";
import { bandLevels, F_MAX, F_MIN, formatHz, logBands, logX, loudest } from "./scopeBands";
import { useVisibleLoop } from "./useVisibleLoop";

// "Scope": what the piece is playing, drawn live as a spectrum (scopeBands.ts has
// the arithmetic). Low notes on the left, high on the right, on a log scale,
// so an engine's harmonics climb rightward as it revs. Off until the visitor
// turns it on (ScopeToggle), and it reads the shared bus before the sound
// switch, so it still draws with the sound off. It never makes a sound or an
// AudioContext of its own: until a piece has played something it says so.

const MINT = "#8ad9a8";
const MUTED = "#b5b6ab";
const GRID = [100, 1000, 10_000];
const READOUT_MS = 200; // the "loudest" number changes five times a second, not every frame

export default function Scope({ paused = false, compact = false }: { paused?: boolean; compact?: boolean }) {
  const [peak, setPeak] = useState<string>("");
  const bins = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const bands = useRef<{ key: string; list: [number, number][] } | null>(null);
  const lastReadout = useRef(0);

  const ref = useVisibleLoop<HTMLCanvasElement>(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const axis = 14; // room for the Hz labels
    const plot = h - axis;
    mono(ctx, 9);
    ctx.textBaseline = "top";
    for (const f of GRID) {
      const x = logX(f) * w;
      ctx.fillStyle = "rgba(242,234,215,0.12)";
      ctx.fillRect(Math.round(x), 0, 1, plot);
      ctx.fillStyle = MUTED;
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      // right of its line, unless that would run off the edge
      const tx = Math.round(x) + 3 + ctx.measureText(label).width > w ? Math.round(x) - 3 - ctx.measureText(label).width : Math.round(x) + 3;
      ctx.fillText(label, tx, plot + 3);
    }
    ctx.fillStyle = "rgba(242,234,215,0.2)";
    ctx.fillRect(0, plot, w, 1);

    const an = analyser();
    if (!an) {
      ctx.fillStyle = MUTED;
      ctx.textBaseline = "middle";
      ctx.fillText("Nothing playing yet", 8, plot / 2);
      return;
    }
    if (!bins.current || bins.current.length !== an.frequencyBinCount) bins.current = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(bins.current);

    const bars = Math.max(24, Math.floor(w / 4));
    const key = `${bars}:${an.context.sampleRate}:${an.fftSize}`;
    if (bands.current?.key !== key) bands.current = { key, list: logBands(bars, an.context.sampleRate, an.fftSize) };
    const levels = bandLevels(bins.current, bands.current.list);
    const bw = w / bars;
    ctx.fillStyle = MINT;
    levels.forEach((v, i) => {
      const bh = Math.round(v * plot);
      if (bh > 0) ctx.fillRect(i * bw + 0.5, plot - bh, Math.max(1, bw - 1), bh);
    });

    const now = performance.now();
    if (now - lastReadout.current > READOUT_MS) {
      lastReadout.current = now;
      const f = loudest(bins.current, an.context.sampleRate, an.fftSize);
      setPeak(f === null ? "" : formatHz(f));
    }
  }, paused);

  return (
    <div className="rounded-[10px] border border-white/15 bg-[#0d100e]/85 px-3 pt-2 pb-1.5" data-testid="scope">
      <div className="flex items-baseline justify-between gap-3 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-[#b5b6ab]">
        {/* the axis carries the range; a narrow scope's title leaves it there */}
        <span>{compact ? "Spectrum" : `Spectrum · ${F_MIN} Hz – ${F_MAX / 1000} kHz`}</span>
        <span aria-hidden="true" className="tabular-nums text-[#f2ead7]" data-testid="scope-peak">
          {peak && `Loudest ${peak}`}
        </span>
      </div>
      <canvas
        ref={ref}
        role="img"
        aria-label="A live spectrum of the sound this piece is making, low notes on the left and high on the right."
        className="mt-1 block w-full h-[84px]"
      />
    </div>
  );
}

/** The switch for it: the size of the piece's other buttons, or `small` to sit over a game (Cars' mode switch). */
export function ScopeToggle({ on, onChange, small = false }: { on: boolean; onChange: (on: boolean) => void; small?: boolean }) {
  const size = small ? "h-8 px-3.5 text-[11px] tracking-[0.14em]" : "h-10 px-4 text-xs tracking-[0.18em]";
  const look = on
    ? "border-[var(--mint)] bg-[var(--mint)] text-[var(--ink)]"
    : `border-white/20 hover:bg-white/10 ${small ? "bg-[#0d100e]/80 text-[#f2ead7]" : ""}`;
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="scope-toggle"
      onClick={(e) => {
        onChange(!on);
        // a mouse click hands the keys straight back to the game, so Space is the throttle again, not this button
        if (e.detail > 0) e.currentTarget.closest('[role="dialog"]')?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
      }}
      className={`rounded-full border font-mono uppercase ${size} ${look}`}
    >
      Scope
    </button>
  );
}
