"use client";

import { useRef, useState } from "react";
import { useVisibleLoop } from "./useVisibleLoop";

// A record on a platter. Play spins it at 33⅓ rpm and drops the tonearm;
// grab the vinyl to scratch it. The light sheen is fixed while the grooves
// turn underneath, which is what sells the rotation.

const RPM_DEG_PER_S = (100 / 3 / 60) * 360; // 200°/s

export default function Vinyl({ playlistUrl }: { playlistUrl: string }) {
  const discRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const s = useRef({ angle: 0, speed: 0, dragging: false, lastPointer: 0 });

  const rootRef = useVisibleLoop<HTMLDivElement>((dt) => {
    const st = s.current;
    if (!st.dragging) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const target = playing && !reduce ? RPM_DEG_PER_S : 0;
      st.speed += (target - st.speed) * Math.min(1, dt * 3); // platter spin-up / brake
      if (Math.abs(st.speed) < 0.01 && !playing) return; // at rest: nothing to draw
      st.angle += st.speed * dt;
    }
    if (discRef.current) discRef.current.style.transform = `rotate(${st.angle.toFixed(2)}deg)`;
  });

  const angleAt = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    s.current.dragging = true;
    s.current.lastPointer = angleAt(e);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!s.current.dragging) return;
    const a = angleAt(e);
    let d = a - s.current.lastPointer;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    s.current.angle += d;
    s.current.lastPointer = a;
  };
  const onUp = () => {
    s.current.dragging = false;
  };

  return (
    <div ref={rootRef} className="absolute inset-0 bg-[#1a1918] flex items-center justify-center p-6">
      <div className="relative h-full max-h-[300px] aspect-square">
        {/* platter */}
        <div className="absolute inset-0 rounded-full bg-[#2a2927] shadow-[inset_0_0_0_2px_rgba(255,255,255,0.05)]" />
        {/* disc */}
        <div
          className="absolute inset-[3%] rounded-full touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden="true"
        >
          <div
            ref={discRef}
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "repeating-radial-gradient(circle at 50% 50%, #0d0d0d 0 1.2px, #161616 1.2px 2.4px)",
            }}
          >
            {/* label */}
            <div className="absolute inset-[33%] rounded-full bg-[var(--signal)] grid place-items-center text-[var(--ink)]">
              <div className="text-center leading-none">
                <p className="display text-[clamp(1rem,3.4vw,1.6rem)]">RP</p>
                <p className="font-mono text-[7px] tracking-[0.2em] mt-1">SIDE A · 33⅓</p>
              </div>
              <span className="absolute w-[9%] aspect-square rounded-full bg-[#1a1918]" />
            </div>
          </div>
          {/* fixed sheen */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none mix-blend-screen"
            style={{
              background:
                "conic-gradient(from 20deg, transparent 0 8%, rgba(255,255,255,0.10) 12%, transparent 18% 50%, rgba(255,255,255,0.08) 62%, transparent 68%)",
            }}
          />
        </div>
        {/* tonearm */}
        <div
          aria-hidden="true"
          className="absolute -right-[4%] top-[2%] w-[18%] h-[78%] origin-[50%_8%] transition-transform duration-700 ease-out"
          style={{ transform: `rotate(${playing ? 24 : 4}deg)` }}
        >
          <span className="absolute left-1/2 top-0 -translate-x-1/2 w-[46%] aspect-square rounded-full bg-[#cfcac0] shadow-md" />
          <span className="absolute left-1/2 top-[6%] -translate-x-1/2 w-[6%] h-[86%] bg-[#bdb8ae] rounded-full" />
          <span className="absolute left-1/2 bottom-0 -translate-x-[70%] w-[30%] h-[12%] bg-[#e8e4db] rounded-sm" />
        </div>
      </div>

      <button
        type="button"
        aria-pressed={playing}
        onClick={() => setPlaying((v) => !v)}
        className="absolute bottom-3 right-3 w-12 h-12 rounded-full bg-[var(--paper)] text-[var(--ink)] grid place-items-center hover:bg-[var(--signal)] transition-colors shadow-lg"
      >
        <span className="sr-only">{playing ? "Stop the record" : "Spin the record"}</span>
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2 L14 8 L4 14 Z" fill="currentColor" /></svg>
        )}
      </button>
      <a
        href={playlistUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-3 left-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#c9c5bc] hover:text-[var(--paper)] underline underline-offset-4"
      >
        Playlist ↗<span className="sr-only"> on Spotify (opens in a new tab)</span>
      </a>
    </div>
  );
}
