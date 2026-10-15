"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// "Lab" block: a synthesized heart-rate trace you can tune. A toy nod to
// building live BLE heart-rate onboarding — no real data, no device, no
// network. Everything below is generated in the browser.

const DEFAULTS = { bpm: 72, noise: 12, haptics: false };
const WINDOW_SECONDS = 4;

// One beat of a stylised ECG: P wave, QRS complex, T wave as Gaussians.
const WAVES: Array<[centre: number, amp: number, width: number]> = [
  [0.2, 0.12, 0.025],
  [0.36, -0.12, 0.01],
  [0.4, 1, 0.012],
  [0.44, -0.25, 0.012],
  [0.62, 0.3, 0.05],
];

function ecg(phase: number) {
  let y = 0;
  for (const [c, a, w] of WAVES) y += a * Math.exp(-((phase - c) ** 2) / (2 * w * w));
  return y;
}

// Deterministic pseudo-noise so the trace doesn't shimmer between frames.
function hashNoise(t: number) {
  const x = Math.sin(Math.floor(t * 250) * 12.9898) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

function sample(t: number, bpm: number, noise: number) {
  const period = 60 / bpm;
  const phase = (t % period) / period;
  const n = noise / 100;
  const artifact =
    n * (0.35 * Math.sin(2 * Math.PI * 0.7 * t) + 0.2 * Math.sin(2 * Math.PI * 1.9 * t + 1)) +
    n * 0.25 * hashNoise(t);
  return ecg(phase) + artifact;
}

export default function SignalLab() {
  const [bpm, setBpm] = useState(DEFAULTS.bpm);
  const [noise, setNoise] = useState(DEFAULTS.noise);
  const [haptics, setHaptics] = useState(DEFAULTS.haptics);
  const [beat, setBeat] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const params = useRef({ bpm, noise, haptics });
  params.current = { bpm, noise, haptics };

  const quality = Math.max(0, Math.round(100 - noise * 0.7));
  const rr = Math.round(60000 / bpm);

  const draw = useCallback((tNow: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = "rgba(241,238,231,0.07)";
    ctx.lineWidth = 1;
    const step = 24;
    for (let x = (w % step) / 2; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = (h % step) / 2; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const { bpm, noise } = params.current;
    const mid = h * 0.62;
    const amp = h * 0.42;

    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ff4a1c";
    ctx.shadowColor = "rgba(255,74,28,0.55)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 1.5) {
      const t = tNow - WINDOW_SECONDS + (x / w) * WINDOW_SECONDS;
      const y = mid - sample(t, bpm, noise) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // leading dot
    const yEnd = mid - sample(tNow, bpm, noise) * amp;
    ctx.fillStyle = "#f1eee7";
    ctx.beginPath(); ctx.arc(w - 3, yEnd, 3.5, 0, Math.PI * 2); ctx.fill();
  }, []);

  // Animation loop: runs only while on screen, the tab is visible, and the
  // visitor hasn't asked for reduced motion.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = false;
    let raf = 0;
    let lastBeat = -1;
    const start = performance.now();

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      draw(t);
      const period = 60 / params.current.bpm;
      const b = Math.floor((t + period * 0.6) / period); // fire on the R peak
      if (b !== lastBeat) {
        lastBeat = b;
        setBeat(b);
        if (params.current.haptics && "vibrate" in navigator) navigator.vibrate?.(12);
      }
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden && !reduce) raf = requestAnimationFrame(frame);
    };

    draw(WINDOW_SECONDS); // still frame until it scrolls into view
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", run);
    const onResize = () => reduce && draw(WINDOW_SECONDS);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("resize", onResize);
    };
  }, [draw]);

  // Reduced motion: redraw the still frame whenever a control changes.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) draw(WINDOW_SECONDS);
  }, [bpm, noise, draw]);

  const reset = () => {
    setBpm(DEFAULTS.bpm);
    setNoise(DEFAULTS.noise);
    setHaptics(DEFAULTS.haptics);
  };

  return (
    <section aria-labelledby="lab-title" className="signal relative overflow-hidden px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-12 gap-8 items-end mb-10 md:mb-14">
          <div className="md:col-span-7">
            <p className="font-mono text-xs uppercase tracking-[0.2em] mb-4">Lab / 01 — the signal</p>
            <h2 id="lab-title" className="display" style={{ fontSize: "clamp(3.5rem, 11vw, 9.5rem)" }}>
              Never miss
              <br />a beat.
            </h2>
          </div>
          <p className="md:col-span-5 text-base md:text-lg leading-relaxed text-pretty">
            At WHOOP I worked on onboarding that streams your heart rate from the strap
            into SwiftUI the moment it registers, so the app feels alive before you&apos;ve
            done anything. This is a toy version of that idea. The trace is synthesized
            in your browser, not real data.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-4 md:gap-6">
          {/* Control panel */}
          <form
            className="lg:col-span-4 border-2 border-[var(--ink)] p-5 md:p-6 flex flex-col gap-6"
            onSubmit={(e) => e.preventDefault()}
            aria-label="Signal controls"
          >
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs uppercase tracking-[0.2em] font-semibold">Tune the signal</p>
              <button
                type="button"
                onClick={reset}
                className="font-mono text-[11px] uppercase tracking-wider underline underline-offset-4 hover:no-underline"
              >
                Reset
              </button>
            </div>

            <Slider
              id="lab-bpm"
              label="Heart rate"
              unit="bpm"
              min={40}
              max={190}
              value={bpm}
              onChange={setBpm}
            />
            <Slider
              id="lab-noise"
              label="Motion noise"
              unit="%"
              min={0}
              max={100}
              value={noise}
              onChange={setNoise}
            />

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="font-mono text-xs uppercase tracking-wider">
                Haptic tick on each beat
                <span className="block normal-case tracking-normal text-[11px] text-[var(--fg-muted)] mt-0.5">
                  Phones that support vibration only
                </span>
              </span>
              <input
                type="checkbox"
                checked={haptics}
                onChange={(e) => setHaptics(e.target.checked)}
                className="w-5 h-5 accent-[var(--ink)] shrink-0"
              />
            </label>

            <div className="mt-auto pt-5 border-t border-[var(--border-strong)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] font-semibold mb-3">
                The real version
              </p>
              <dl className="grid grid-cols-2 gap-y-3 gap-x-4">
              {[
                ["UI", "SwiftUI"],
                ["Transport", "Core Bluetooth"],
                ["Feedback", "Haptics"],
                ["Data", "Live from the strap"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">{k}</dt>
                  <dd className="text-sm font-medium">{v}</dd>
                </div>
              ))}
              </dl>
            </div>
          </form>

          {/* Monitor */}
          <div className="lg:col-span-8 relative bg-[var(--ink)] text-[var(--paper)] min-h-[320px] md:min-h-[380px] flex flex-col">
            <div className="flex items-start justify-between p-5 md:p-6 gap-6">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#b9b4aa]">Live · synthesized</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span
                    key={beat}
                    className="display tabular-nums text-[var(--signal)] inline-block animate-[beat_0.35s_ease-out]"
                    style={{ fontSize: "clamp(4rem, 10vw, 7.5rem)", fontStretch: "75%" }}
                  >
                    {String(bpm).padStart(3, "0")}
                  </span>
                  <span className="font-mono text-sm uppercase tracking-widest">bpm</span>
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-right">
                <Readout label="R–R" value={`${rr} ms`} />
                <Readout label="Quality" value={`${quality}%`} />
                <Readout label="Window" value={`${WINDOW_SECONDS} s`} />
                <Readout label="Source" value="Browser" />
              </dl>
            </div>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Synthesized heart-rate trace at ${bpm} beats per minute, ${noise}% motion noise`}
              className="flex-1 w-full min-h-[180px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Slider({
  id,
  label,
  unit,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label htmlFor={id} className="font-mono text-xs uppercase tracking-wider">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-sm tabular-nums font-semibold">
          {value} {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--ink)] cursor-pointer"
      />
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#b9b4aa]">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}
