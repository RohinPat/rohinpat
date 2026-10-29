"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PairCard, { type PairInfo } from "@/components/link/PairCard";
import { AirPointer, DEFAULT_TUNING, POINTER_SCREEN, type PointerTuning } from "@/lib/link/pointer";
import { isPaired } from "@/lib/link/state";
import { useLink } from "@/lib/link/useLink";

// Lab: can a phone be a laser pointer for the laptop? Pair, aim the phone's
// top edge at the screen, press Center on the phone, then:
//   - the drill: one target at a time in three sizes (24, 44, 72 px). It
//     records how long each hit took and how many clicks missed, per size.
//   - the drift test: hold the phone still on the middle for 30 s and it
//     reports how far the dot wandered, in degrees a minute.
//   - the sliders tune reach (degrees across the screen) and smoothing live.
// Nothing is stored; reload and it's gone.

const SIZES = [24, 44, 72] as const;
type Size = (typeof SIZES)[number];
type Stat = { hits: number; misses: number; times: number[] };
const DRIFT_MS = 30_000;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export default function PointerLab() {
  const { session, state, path, code, pairUrl, start, stop } = useLink("host");
  const paired = isPaired(state, path);
  const pointer = useRef(new AirPointer());
  const dot = useRef<HTMLDivElement>(null);
  const pos = useRef<{ x: number; y: number } | null>(null);
  const arena = useRef<HTMLDivElement>(null);
  const [tuning, setTuning] = useState<PointerTuning>(DEFAULT_TUNING);
  const [target, setTarget] = useState<{ x: number; y: number; size: Size; shownAt: number } | null>(null);
  const [stats, setStats] = useState<Record<Size, Stat>>(() => ({ 24: { hits: 0, misses: 0, times: [] }, 44: { hits: 0, misses: 0, times: [] }, 72: { hits: 0, misses: 0, times: [] } }));
  const [readout, setReadout] = useState({ hz: 0, dx: 0, dy: 0, centered: false });
  const [drift, setDrift] = useState<{ running: boolean; startedAt: number; from: { dx: number; dy: number } | null; result: string | null }>({ running: false, startedAt: 0, from: null, result: null });
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 8));

  useEffect(() => start(), [start]);

  // a code that ran out (or a phone that left): a fresh one
  useEffect(() => {
    if (state !== "closed") return;
    stop();
    start();
  }, [state, start, stop]);

  const tellScreen = useCallback(() => session?.send({ type: "screen", name: "piece", piece: POINTER_SCREEN }), [session]);
  useEffect(() => {
    if (paired) tellScreen();
  }, [paired, tellScreen]);

  const nextTarget = useCallback(() => {
    const el = arena.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const size = SIZES[Math.floor(Math.random() * SIZES.length)];
    const pad = 16;
    setTarget({
      x: pad + Math.random() * (r.width - size - 2 * pad),
      y: pad + Math.random() * (r.height - size - 2 * pad),
      size,
      shownAt: performance.now(),
    });
  }, []);

  const clickAtDot = useCallback(() => {
    const p = pos.current;
    if (!p) return;
    const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
    const hit = el?.closest<HTMLElement>("button, a, input, [data-pointer-target]");
    if (hit) hit.click();
    else if (el && arena.current?.contains(el) && target) {
      setStats((s) => ({ ...s, [target.size]: { ...s[target.size], misses: s[target.size].misses + 1 } }));
    }
  }, [target]);
  const clickRef = useRef(clickAtDot);
  clickRef.current = clickAtDot;

  // phone -> laptop
  useEffect(() => {
    if (!session) return;
    const offO = session.onOrient((o) => pointer.current.push(o));
    const offM = session.onMessage((m) => {
      if (m.type === "hello") tellScreen();
      if (m.type !== "gesture") return;
      if (m.name === "pointer-center") {
        pointer.current.center();
        note("centered");
      } else if (m.name === "pointer-click") clickRef.current();
      else if (m.name === "pointer-scroll" && typeof m.data.dy === "number") window.scrollBy({ top: m.data.dy });
    });
    return () => {
      offO();
      offM();
    };
  }, [session, tellScreen]);

  // the dot, once a frame; the readout four times a second
  useEffect(() => {
    let raf = 0;
    let lastRead = 0;
    let lastSamples = 0;
    const frame = (now: number) => {
      const p = pointer.current.position(window.innerWidth, window.innerHeight, now);
      pos.current = p;
      const d = dot.current;
      if (d && p) {
        d.style.transform = `translate(${p.x}px, ${p.y}px)`;
        d.style.opacity = "1";
        const under = document.elementFromPoint(p.x, p.y)?.closest("button, a, input, [data-pointer-target]");
        document.querySelectorAll("[data-pointer-hover]").forEach((n) => n !== under && n.removeAttribute("data-pointer-hover"));
        under?.setAttribute("data-pointer-hover", "");
      }
      if (now - lastRead > 250) {
        const n = pointer.current.samples;
        const off = pointer.current.offset();
        setReadout({ hz: Math.round(((n - lastSamples) * 1000) / (now - lastRead || 1)), dx: off?.dx ?? 0, dy: off?.dy ?? 0, centered: pointer.current.centered });
        lastSamples = n;
        lastRead = now;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => pointer.current.tune(tuning), [tuning]);

  // the drift test
  useEffect(() => {
    if (!drift.running) return;
    const id = window.setTimeout(() => {
      const off = pointer.current.offset();
      if (!off || !drift.from) return setDrift((d) => ({ ...d, running: false, result: "no samples" }));
      const mins = DRIFT_MS / 60_000;
      const dx = (off.dx - drift.from.dx) / mins;
      const dy = (off.dy - drift.from.dy) / mins;
      const result = `${dx.toFixed(1)}°/min sideways, ${dy.toFixed(1)}°/min up-down`;
      setDrift((d) => ({ ...d, running: false, result }));
      note(`drift: ${result}`);
    }, DRIFT_MS);
    return () => window.clearTimeout(id);
  }, [drift.running, drift.from]);

  const info: PairInfo = { state, paired, code, pairUrl, stale: state === "closed", renew: () => (stop(), start()) };

  return (
    <main className="min-h-[200vh] bg-[var(--ink)] text-[var(--paper)] px-6 pt-24 pb-24">
      <div className="max-w-6xl mx-auto grid gap-6 lg:grid-cols-[1fr_340px]">
        <section>
          <h1 className="text-[2.2rem] font-extrabold leading-none">Air pointer lab</h1>
          <p className="mt-3 max-w-prose text-[#c9c6b6]">
            Pair, then point the top of your phone at this screen like a TV remote. Aim at the middle and press Center on the phone. Tap the phone to click, drag on
            it to scroll.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={nextTarget} className="h-11 px-5 rounded-full bg-[var(--mint)] text-[var(--ink)] font-semibold">
              {target ? "Skip target" : "Start the drill"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDrift({ running: true, startedAt: performance.now(), from: pointer.current.offset(), result: null });
                note("drift test: hold still on the middle for 30 s");
              }}
              disabled={drift.running || !readout.centered}
              className="h-11 px-5 rounded-full border border-white/25 font-semibold disabled:opacity-40"
            >
              {drift.running ? "Hold still… 30 s" : "Drift test"}
            </button>
            <button
              type="button"
              onClick={() => setStats({ 24: { hits: 0, misses: 0, times: [] }, 44: { hits: 0, misses: 0, times: [] }, 72: { hits: 0, misses: 0, times: [] } })}
              className="h-11 px-5 rounded-full border border-white/25 font-semibold"
            >
              Reset stats
            </button>
          </div>

          <div ref={arena} data-testid="pointer-arena" className="relative mt-5 h-[460px] rounded-[18px] border border-white/15 bg-white/[0.03] overflow-hidden">
            {target && (
              <button
                type="button"
                data-pointer-target
                data-testid="pointer-target"
                aria-label={`Target, ${target.size} pixels`}
                onClick={() => {
                  const ms = performance.now() - target.shownAt;
                  setStats((s) => ({ ...s, [target.size]: { ...s[target.size], hits: s[target.size].hits + 1, times: [...s[target.size].times, ms] } }));
                  nextTarget();
                }}
                className="absolute rounded-full bg-[#d9b44a] data-[pointer-hover]:bg-[var(--mint)] data-[pointer-hover]:scale-110 transition-transform"
                style={{ left: target.x, top: target.y, width: target.size, height: target.size }}
              />
            )}
            {!target && <p className="absolute inset-0 grid place-items-center text-[#a3a69c]">Start the drill, then click targets with the phone.</p>}
          </div>

          <table className="mt-5 w-full max-w-xl font-mono text-[13px]" data-testid="pointer-stats">
            <thead className="text-left text-[#a3a69c]">
              <tr>
                <th className="py-1 font-normal">size</th>
                <th className="font-normal">hits</th>
                <th className="font-normal">misses</th>
                <th className="font-normal">median time</th>
              </tr>
            </thead>
            <tbody>
              {SIZES.map((s) => {
                const m = median(stats[s].times);
                return (
                  <tr key={s}>
                    <td className="py-1">{s} px</td>
                    <td>{stats[s].hits}</td>
                    <td>{stats[s].misses}</td>
                    <td>{m === null ? "–" : `${(m / 1000).toFixed(2)} s`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-10 space-y-3 text-[#a3a69c]">
            <h2 className="text-[1.3rem] font-bold text-[var(--paper)]">Scroll test</h2>
            {Array.from({ length: 30 }, (_, i) => (
              <p key={i}>
                Row {i + 1}. Drag on the phone to scroll this page; a link to check small targets:{" "}
                <a href="#top" onClick={(e) => (e.preventDefault(), note(`link ${i + 1} clicked`))} className="underline text-[var(--mint)] data-[pointer-hover]:bg-white/15">
                  link {i + 1}
                </a>
              </p>
            ))}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-24 self-start">
          {!paired ? (
            <PairCard info={info} />
          ) : (
            <div className="rounded-[18px] border border-white/15 p-4 font-mono text-[13px]" data-testid="pointer-readout">
              <p className="text-[var(--mint)]">Linked · {path}</p>
              <p className="mt-2">samples {readout.hz} / s</p>
              <p>
                off centre {readout.dx.toFixed(1)}° sideways, {readout.dy.toFixed(1)}° up-down
              </p>
              {drift.result && <p className="mt-2">drift: {drift.result}</p>}
            </div>
          )}
          <div className="rounded-[18px] border border-white/15 p-4 space-y-3 text-[13px]">
            <label className="flex items-center justify-between gap-3">
              <span>Reach (° across the screen)</span>
              <span className="tabular-nums">{tuning.reach}</span>
            </label>
            <input type="range" min={15} max={90} step={1} value={tuning.reach} onChange={(e) => setTuning((t) => ({ ...t, reach: Number(e.target.value) }))} className="w-full accent-[#8ad9a8]" />
            <label className="flex items-center justify-between gap-3">
              <span>Steadiness (min cutoff, Hz)</span>
              <span className="tabular-nums">{tuning.minCutoff.toFixed(2)}</span>
            </label>
            <input type="range" min={0.2} max={4} step={0.05} value={tuning.minCutoff} onChange={(e) => setTuning((t) => ({ ...t, minCutoff: Number(e.target.value) }))} className="w-full accent-[#8ad9a8]" />
            <label className="flex items-center justify-between gap-3">
              <span>Speed boost (beta)</span>
              <span className="tabular-nums">{tuning.beta.toFixed(3)}</span>
            </label>
            <input type="range" min={0} max={0.03} step={0.001} value={tuning.beta} onChange={(e) => setTuning((t) => ({ ...t, beta: Number(e.target.value) }))} className="w-full accent-[#8ad9a8]" />
          </div>
          {log.length > 0 && (
            <ul className="rounded-[18px] border border-white/15 p-4 font-mono text-[12px] text-[#a3a69c] space-y-1">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* the dot */}
      <div
        ref={dot}
        aria-hidden="true"
        data-testid="pointer-dot"
        className="pointer-events-none fixed left-0 top-0 z-[100] -ml-2 -mt-2 w-4 h-4 rounded-full bg-[#ff4d3d] shadow-[0_0_0_3px_rgba(255,77,61,0.3),0_0_18px_rgba(255,77,61,0.7)] opacity-0"
      />
    </main>
  );
}
