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
    ctx.strokeStyle = "rgba(242,234,215,0.07)";
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
    ctx.strokeStyle = "#8ad9a8";
    ctx.shadowColor = "rgba(138,217,168,0.55)";
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
    ctx.fillStyle = "#f2ead7";
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
            <p className="font-mono text-xs uppercase tracking-[0.2em] mb-4">Lab</p>
            <h2 id="lab-title" className="display t-l">
              Never miss
              <br />a beat.
            </h2>
          </div>
          <p className="md:col-span-5 text-base md:text-lg leading-relaxed text-pretty">
            Your pulse on screen the moment the strap finds it. Push it, add noise,
            feel the tick. Synthesized in your browser, not real data.
          </p>
        </div>

        {/* Monitor */}
        <div className="relative bg-[var(--ink)] text-[var(--paper)] h-[340px] md:h-[420px] overflow-hidden">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Synthesized heart-rate trace at ${bpm} beats per minute, ${noise}% motion noise`}
            className="absolute inset-0 w-full h-full"
          />
          <div className="relative flex items-start justify-between p-5 md:p-7 pointer-events-none">
            <p className="flex items-baseline gap-2">
              <span
                key={beat}
                className="display tabular-nums text-[var(--accent-text)] inline-block animate-[beat_0.35s_ease-out]"
                style={{ fontSize: "clamp(4.5rem, 12vw, 9rem)", fontStretch: "75%" }}
              >
                {String(bpm).padStart(3, "0")}
              </span>
              <span className="font-mono text-sm uppercase tracking-widest">bpm</span>
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#b5b6ab] text-right">
              Live · synthesized
              <span className="block text-[var(--paper)] text-sm mt-1 tabular-nums">{quality}% quality</span>
            </p>
          </div>
        </div>

        {/* Control bar */}
        <form
          aria-label="Signal controls"
          onSubmit={(e) => e.preventDefault()}
          className="grid sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] gap-x-8 gap-y-5 items-end border-2 border-t-0 border-[var(--border-strong)] px-5 md:px-7 py-5"
        >
          <Slider id="lab-bpm" label="Heart rate" unit="bpm" min={40} max={190} value={bpm} onChange={setBpm} />
          <Slider id="lab-noise" label="Motion noise" unit="%" min={0} max={100} value={noise} onChange={setNoise} />
          <div className="flex items-center gap-6 sm:col-span-2 lg:col-span-1">
            <label className="flex items-center gap-3 cursor-pointer font-mono text-xs uppercase tracking-wider">
              <input
                type="checkbox"
                checked={haptics}
                onChange={(e) => setHaptics(e.target.checked)}
                className="w-6 h-6 accent-[var(--paper)]"
              />
              Haptic tick
            </label>
            <button
              type="button"
              onClick={reset}
              className="min-h-6 px-1 font-mono text-xs uppercase tracking-wider underline underline-offset-4 hover:no-underline"
            >
              Reset
            </button>
          </div>
        </form>
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
        <output htmlFor={id} className="font-mono text-sm tabular-nums font-medium">
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
        className="fader w-full h-6 cursor-pointer"
      />
    </div>
  );
}
