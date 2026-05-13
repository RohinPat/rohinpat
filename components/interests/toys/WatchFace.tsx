"use client";

import { useEffect, useRef, useState } from "react";

const LUME_DURATION_MS = 4000;

export default function WatchFace() {
  const [now, setNow] = useState<Date | null>(null);
  const [lumed, setLumed] = useState(false);
  const lumeTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const triggerLume = () => {
    setLumed(true);
    if (lumeTimerRef.current) clearTimeout(lumeTimerRef.current);
    lumeTimerRef.current = setTimeout(() => setLumed(false), LUME_DURATION_MS);
  };

  // Pre-mount fallback hands (12:00) until clock syncs to avoid hydration drift.
  const h = now ? now.getHours() % 12 : 0;
  const m = now ? now.getMinutes() : 0;
  const s = now ? now.getSeconds() : 0;
  const secDeg = (s / 60) * 360;
  const minDeg = ((m + s / 60) / 60) * 360;
  const hourDeg = ((h + m / 60) / 12) * 360;

  // Polar→Cartesian helper
  const tip = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [50 + Math.cos(rad) * r, 50 + Math.sin(rad) * r];
  };
  const [hX, hY] = tip(hourDeg, 24);
  const [mX, mY] = tip(minDeg, 34);
  const [sX, sY] = tip(secDeg, 38);

  const markerColor = lumed ? "#86efac" : "#ededed";
  const minorColor = lumed ? "#4ade80" : "#3a3a3a";
  const handColor = lumed ? "#bbf7d0" : "#ededed";
  const lumeShadow = lumed ? "drop-shadow(0 0 1.5px #4ade80)" : "none";

  return (
    <button
      onClick={triggerLume}
      aria-label="Expose to light"
      className="block w-full max-w-[320px] aspect-square mx-auto group focus:outline-none"
    >
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {/* Case */}
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="#0a0a0a"
          stroke={lumed ? "#1a3a25" : "#1a1a1a"}
          strokeWidth="1.2"
          style={{ transition: "all 0.6s ease" }}
        />
        {/* Inner ring */}
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke={lumed ? "rgba(74,222,128,0.15)" : "#0f0f0f"}
          strokeWidth="0.4"
          style={{ transition: "all 0.6s ease" }}
        />

        {/* Hour markers */}
        {[...Array(60)].map((_, i) => {
          const isHour = i % 5 === 0;
          const angle = (i * 6 * Math.PI) / 180;
          const r1 = isHour ? 36 : 39.5;
          const r2 = 41;
          const x1 = 50 + Math.sin(angle) * r1;
          const y1 = 50 - Math.cos(angle) * r1;
          const x2 = 50 + Math.sin(angle) * r2;
          const y2 = 50 - Math.cos(angle) * r2;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isHour ? markerColor : minorColor}
              strokeWidth={isHour ? 1.1 : 0.4}
              strokeLinecap="round"
              style={{ filter: isHour ? lumeShadow : "none", transition: "all 0.6s ease" }}
            />
          );
        })}

        {/* Brand wordmark */}
        <text
          x="50"
          y="32"
          textAnchor="middle"
          fill={lumed ? "#86efac" : "#6b6b6b"}
          fontSize="3.2"
          fontFamily="monospace"
          letterSpacing="0.4"
          style={{ transition: "all 0.6s ease" }}
        >
          RP
        </text>

        {/* Date window */}
        <rect x="63" y="48" width="9" height="4.5" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="0.3" />
        <text
          x="67.5"
          y="51.5"
          textAnchor="middle"
          fill="#ededed"
          fontSize="3"
          fontFamily="monospace"
        >
          {now ? now.getDate() : "—"}
        </text>

        {/* Hour hand */}
        <line
          x1="50"
          y1="50"
          x2={hX}
          y2={hY}
          stroke={handColor}
          strokeWidth="2.2"
          strokeLinecap="round"
          style={{ filter: lumeShadow, transition: "filter 0.6s ease, stroke 0.6s ease" }}
        />
        {/* Minute hand */}
        <line
          x1="50"
          y1="50"
          x2={mX}
          y2={mY}
          stroke={handColor}
          strokeWidth="1.4"
          strokeLinecap="round"
          style={{ filter: lumeShadow, transition: "filter 0.6s ease, stroke 0.6s ease" }}
        />
        {/* Second hand — blaugrana accent always */}
        <line
          x1="50"
          y1="50"
          x2={sX}
          y2={sY}
          stroke="#a50044"
          strokeWidth="0.5"
          strokeLinecap="round"
        />
        <circle cx="50" cy="50" r="1.6" fill="#ededed" />
        <circle cx="50" cy="50" r="0.6" fill="#a50044" />

        {/* Crown */}
        <rect x="92" y="48" width="3" height="4" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="0.2" />
      </svg>
    </button>
  );
}
