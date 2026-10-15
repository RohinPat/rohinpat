"use client";

import { useRef, useState } from "react";
import { useVisibleLoop } from "./useVisibleLoop";

// A dial on your local time. The seconds hand sweeps at 8 beats a second
// like an automatic movement. The case tilts toward the pointer with a
// moving highlight; hold it down to "charge" the lume, which fades out
// slowly after you let go.

const LUME = "#b9ffd6";

export default function Watch() {
  const hourRef = useRef<SVGGElement>(null);
  const minRef = useRef<SVGGElement>(null);
  const secRef = useRef<SVGGElement>(null);
  const caseRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState<number | null>(null);
  const [lume, setLume] = useState(false);

  // Hands are written straight to the SVG — no React render per frame.
  // Reduced motion: the seconds hand steps once a second instead of sweeping.
  const lastBeat = useRef(-1);
  const rootRef = useVisibleLoop<HTMLDivElement>(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const d = new Date();
    const beat = reduce ? d.getSeconds() : d.getSeconds() * 8 + Math.floor(d.getMilliseconds() / 125);
    if (beat === lastBeat.current) return;
    lastBeat.current = beat;
    const s = reduce ? d.getSeconds() : beat / 8;
    const m = d.getMinutes() + s / 60;
    const h = (d.getHours() % 12) + m / 60;
    const set = (el: SVGGElement | null, deg: number) =>
      el?.setAttribute("transform", `rotate(${deg.toFixed(2)} 100 100)`);
    set(secRef.current, s * 6);
    set(minRef.current, m * 6);
    set(hourRef.current, h * 30);
    setDate((prev) => (prev === d.getDate() ? prev : d.getDate()));
  });

  const tilt = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    if (caseRef.current) {
      caseRef.current.style.transform = `rotateX(${(-ny * 14).toFixed(2)}deg) rotateY(${(nx * 14).toFixed(2)}deg)`;
    }
    if (shineRef.current) {
      shineRef.current.style.background = `radial-gradient(circle at ${50 - nx * 80}% ${50 - ny * 80}%, rgba(255,255,255,0.35), transparent 55%)`;
    }
  };
  const settle = () => {
    if (caseRef.current) caseRef.current.style.transform = "";
    setLume(false);
  };

  const ink = lume ? LUME : "#0c0c0b";
  const glow = lume ? `drop-shadow(0 0 3px ${LUME})` : "none";

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 grid place-items-center paper paper-grid"
      style={{ perspective: "900px" }}
      onPointerMove={tilt}
      onPointerLeave={settle}
    >
      <button
        type="button"
        aria-label="Watch face. Press and hold to light up the lume."
        aria-pressed={lume}
        onPointerDown={() => setLume(true)}
        onPointerUp={() => setLume(false)}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setLume(true)}
        onKeyUp={() => setLume(false)}
        className="relative w-[min(78%,340px)] aspect-square rounded-full select-none touch-none"
      >
        <div
          ref={caseRef}
          className="relative w-full h-full rounded-full transition-transform duration-200 ease-out"
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* case + bezel */}
          <div className="absolute inset-0 rounded-full bg-[linear-gradient(145deg,#d9d6cf,#8f8b83_45%,#e9e6df_70%,#77736b)] shadow-[0_30px_50px_-20px_rgba(12,12,11,0.6)]" />
          {/* dial */}
          <div
            className="absolute inset-[6%] rounded-full overflow-hidden transition-colors duration-[2500ms]"
            style={{
              background: lume
                ? "radial-gradient(circle at 50% 40%, #1a1d1b, #050605)"
                : "radial-gradient(circle at 50% 35%, #fbfaf6, #e4e0d6)",
              transitionDuration: lume ? "150ms" : "2500ms",
            }}
          >
            <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full" aria-hidden="true">
              {/* minute track */}
              {Array.from({ length: 60 }, (_, i) => (
                <line
                  key={i}
                  x1="100"
                  y1="8"
                  x2="100"
                  y2={i % 5 === 0 ? 8 : 12}
                  stroke={lume ? "rgba(185,255,214,0.35)" : "rgba(12,12,11,0.55)"}
                  strokeWidth="0.8"
                  transform={`rotate(${i * 6} 100 100)`}
                />
              ))}
              {/* applied batons */}
              {Array.from({ length: 12 }, (_, i) => (
                <g key={i} transform={`rotate(${i * 30} 100 100)`} style={{ filter: glow, transition: "all 0.4s" }}>
                  {i === 0 ? (
                    <>
                      <rect x="94.2" y="14" width="4.6" height="22" rx="0.8" fill={ink} />
                      <rect x="101.2" y="14" width="4.6" height="22" rx="0.8" fill={ink} />
                    </>
                  ) : i === 3 ? null : (
                    <rect x="97.4" y="14" width="5.2" height={i % 3 === 0 ? 22 : 16} rx="0.8" fill={ink} />
                  )}
                </g>
              ))}
              {/* date window at 3 */}
              <rect x="152" y="93" width="22" height="14" rx="1.5" fill={lume ? "#0b0c0b" : "#fff"} stroke={lume ? "rgba(185,255,214,0.4)" : "rgba(12,12,11,0.6)"} strokeWidth="0.8" />
              <text x="163" y="103.6" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono), monospace" fill={lume ? LUME : "#0c0c0b"}>
                {date ?? ""}
              </text>
              {/* wordmark */}
              <text x="100" y="62" textAnchor="middle" fontSize="11" fontWeight="800" letterSpacing="1" fontFamily="var(--font-display), sans-serif" style={{ fontStretch: "70%" }} fill={lume ? "rgba(185,255,214,0.5)" : "#0c0c0b"}>
                RP
              </text>
              <text x="100" y="140" textAnchor="middle" fontSize="5.5" letterSpacing="1.6" fontFamily="var(--font-mono), monospace" fill={lume ? "rgba(185,255,214,0.4)" : "#ff4a1c"}>
                AUTOMATIC
              </text>
              {/* hands */}
              <g ref={hourRef} style={{ filter: glow }}>
                <path d="M100 52 L104.5 100 L95.5 100 Z" fill={ink} />
              </g>
              <g ref={minRef} style={{ filter: glow }}>
                <path d="M100 22 L103.6 100 L96.4 100 Z" fill={ink} />
              </g>
              <g ref={secRef}>
                <line x1="100" y1="118" x2="100" y2="16" stroke="#ff4a1c" strokeWidth="1.1" />
                <circle cx="100" cy="40" r="3.2" fill="#ff4a1c" />
                <rect x="98.2" y="104" width="3.6" height="14" rx="1.2" fill="#ff4a1c" />
              </g>
              <circle cx="100" cy="100" r="3.6" fill="#0c0c0b" stroke="#ff4a1c" strokeWidth="1.2" />
            </svg>
            {/* crystal reflection */}
            <div ref={shineRef} className="absolute inset-0 pointer-events-none mix-blend-screen" />
          </div>
        </div>
      </button>
    </div>
  );
}
