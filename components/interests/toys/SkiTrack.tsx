"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Particles from "../fx/Particles";
import ScorePop from "../fx/ScorePop";
import { useScreenShake } from "../fx/useScreenShake";

const W = 220;
const H = 240;
const SKIER_Y = H - 50;

type Tree = {
  id: number;
  x: number;
  y: number;
  size: number;
  layer: "near" | "far";
  scoredNearMiss?: boolean;
};
type TrackPoint = { x: number; y: number };
type Puff = { id: number; x: number; y: number };

let _treeSeq = 1;
let _puffSeq = 1;

export default function SkiTrack() {
  const [skierX, setSkierX] = useState(W / 2);
  const skierXRef = useRef(W / 2);
  const prevSkierXRef = useRef(W / 2);
  const treesRef = useRef<Tree[]>([]);
  const trackRef = useRef<TrackPoint[]>([]);
  const puffsRef = useRef<Puff[]>([]);
  const [, force] = useState(0);
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(2);

  const [distance, setDistance] = useState(0);
  const [bestDistance, setBestDistance] = useState(0);
  const [wipeoutTrig, setWipeoutTrig] = useState(0);
  const [nearMissTrig, setNearMissTrig] = useState(0);
  const [nearMissPos, setNearMissPos] = useState({ x: W / 2, y: SKIER_Y });
  const [scorePopTrig, setScorePopTrig] = useState(0);
  const [wipeoutCount, setWipeoutCount] = useState(0);
  const distanceRef = useRef(0);

  const { transform: shakeTransform, shake } = useScreenShake({
    duration: 280,
    intensity: 5,
  });

  // Load best distance
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("interests.ski.best");
    if (raw) setBestDistance(parseInt(raw, 10) || 0);
  }, []);

  useEffect(() => {
    const tick = () => {
      const speed = speedRef.current;

      // Distance
      distanceRef.current += speed * 0.05;
      const distInt = Math.floor(distanceRef.current);
      if (distInt !== distance) setDistance(distInt);

      // Trees move down at speed for near, half-speed for far
      treesRef.current = treesRef.current
        .map((t) => ({
          ...t,
          y: t.y + speed * (t.layer === "far" ? 0.55 : 1),
        }))
        .filter((t) => t.y < H + 20);

      // Spawn trees — more near, fewer far
      if (Math.random() < 0.085) {
        const isFar = Math.random() < 0.35;
        treesRef.current.push({
          id: _treeSeq++,
          x: Math.random() * (W - 14) + 7,
          y: -10,
          size: isFar ? 2.5 + Math.random() * 2 : 4 + Math.random() * 4,
          layer: isFar ? "far" : "near",
        });
      }

      // Track points
      trackRef.current.push({ x: skierXRef.current, y: SKIER_Y });
      if (trackRef.current.length > 60) trackRef.current.shift();

      // Snow puffs when carving (skier velocity high)
      const carve = Math.abs(skierXRef.current - prevSkierXRef.current);
      if (carve > 2) {
        puffsRef.current.push({
          id: _puffSeq++,
          x: skierXRef.current + (Math.random() - 0.5) * 6,
          y: SKIER_Y + 4 + Math.random() * 4,
        });
      }
      puffsRef.current = puffsRef.current
        .map((p) => ({ ...p, y: p.y + 0.8 }))
        .filter((_, i, arr) => arr.length - i < 14);
      prevSkierXRef.current = skierXRef.current;

      // Collision + near-miss detection (only near-layer trees)
      const sx = skierXRef.current;
      const sy = SKIER_Y;
      for (const t of treesRef.current) {
        if (t.layer === "far") continue;
        const dx = Math.abs(t.x - sx);
        const dy = Math.abs(t.y - sy);
        // Hit
        if (dx < 8 && dy < 10) {
          // Wipeout
          shake();
          speedRef.current = 1.4;
          setWipeoutTrig((p) => p + 1);
          setWipeoutCount((c) => c + 1);
          // Save best
          if (distanceRef.current > bestDistance) {
            setBestDistance(Math.floor(distanceRef.current));
            try {
              window.localStorage.setItem(
                "interests.ski.best",
                String(Math.floor(distanceRef.current)),
              );
            } catch {
              /* no-op */
            }
          }
          // Clear nearby trees so we don't double-hit
          treesRef.current = treesRef.current.filter(
            (tt) => Math.hypot(tt.x - sx, tt.y - sy) > 25,
          );
          break;
        }
        // Near-miss bonus once per tree
        if (
          !t.scoredNearMiss &&
          t.y > sy - 6 &&
          t.y < sy + 6 &&
          dx >= 9 &&
          dx < 18
        ) {
          t.scoredNearMiss = true;
          setNearMissTrig((p) => p + 1);
          setScorePopTrig((p) => p + 1);
          setNearMissPos({ x: t.x, y: t.y });
          distanceRef.current += 5;
        }
      }

      // Slowly accelerate
      if (speedRef.current < 2.8) speedRef.current += 0.0025;

      force((n) => n + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestDistance, distance]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const clamped = Math.max(12, Math.min(W - 12, px));
    skierXRef.current = clamped;
    setSkierX(clamped);
  };

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div
        onPointerMove={onPointerMove}
        className="relative cursor-pointer select-none touch-none w-full max-w-[220px]"
        style={{
          height: H,
          aspectRatio: `${W} / ${H}`,
          background:
            "linear-gradient(to bottom, #1a2438 0%, #2a3a5a 30%, #d6e3f2 100%)",
          border: "1px solid var(--border-strong)",
          overflow: "hidden",
          transform: shakeTransform,
        }}
      >
        {/* Far trees (parallax) */}
        {treesRef.current
          .filter((t) => t.layer === "far")
          .map((t) => (
            <div
              key={`f-${t.id}`}
              className="absolute"
              style={{
                left: `${(t.x / W) * 100}%`,
                top: t.y,
                width: 0,
                height: 0,
                borderLeft: `${t.size}px solid transparent`,
                borderRight: `${t.size}px solid transparent`,
                borderBottom: `${t.size * 2}px solid #2a4a3a`,
                opacity: 0.55,
                transform: "translateX(-50%)",
              }}
            />
          ))}

        {/* Tracks — older points sink below the skier, matching tree scroll */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          <polyline
            points={trackRef.current
              .map(
                (p, i) =>
                  `${p.x - 2},${p.y + (trackRef.current.length - i) * 2.6}`,
              )
              .join(" ")}
            stroke="rgba(255,255,255,0.6)"
            strokeWidth="1.2"
            fill="none"
          />
          <polyline
            points={trackRef.current
              .map(
                (p, i) =>
                  `${p.x + 2},${p.y + (trackRef.current.length - i) * 2.6}`,
              )
              .join(" ")}
            stroke="rgba(255,255,255,0.6)"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>

        {/* Near trees */}
        {treesRef.current
          .filter((t) => t.layer === "near")
          .map((t) => (
            <div
              key={`n-${t.id}`}
              className="absolute"
              style={{
                left: `${(t.x / W) * 100}%`,
                top: t.y,
                width: 0,
                height: 0,
                borderLeft: `${t.size}px solid transparent`,
                borderRight: `${t.size}px solid transparent`,
                borderBottom: `${t.size * 2}px solid #1a3a25`,
                transform: "translateX(-50%)",
              }}
            />
          ))}

        {/* Snow puffs */}
        {puffsRef.current.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-full pointer-events-none"
            style={{
              left: `${(p.x / W) * 100}%`,
              top: p.y,
              width: 3,
              height: 3,
              background: "rgba(255,255,255,0.6)",
              opacity: 0.6,
              transform: "translate(-50%,-50%)",
            }}
          />
        ))}

        {/* Skier */}
        <div
          className="absolute text-xl"
          style={{
            left: `${(skierX / W) * 100}%`,
            top: SKIER_Y - 14,
            transform: "translateX(-50%)",
          }}
        >
          ⛷️
        </div>

        {/* Near-miss particles + score pop */}
        <Particles
          trigger={nearMissTrig}
          x={nearMissPos.x}
          y={nearMissPos.y}
          count={6}
          spread={14}
          color="rgba(255,255,255,0.85)"
          size={2}
          duration={0.4}
        />
        <ScorePop
          trigger={scorePopTrig}
          x={nearMissPos.x}
          y={nearMissPos.y - 8}
          value="+5"
        />

        {/* Wipeout flash */}
        <AnimatePresence>
          {wipeoutTrig > 0 && (
            <motion.div
              key={wipeoutTrig}
              initial={{ opacity: 0.55 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 bg-accent pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* HUD */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-white/85 tabular-nums">
          <span>
            <span className="dim">d</span> {distance}m
          </span>
          {bestDistance > 0 && (
            <span>
              <span className="dim">best</span> {bestDistance}m
            </span>
          )}
        </div>

        {/* Wipeout toast */}
        <AnimatePresence>
          {wipeoutTrig > 0 && (
            <motion.div
              key={`toast-${wipeoutTrig}`}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: [0, 1, 1, 0], y: 0 }}
              transition={{ duration: 1.0, times: [0, 0.1, 0.7, 1] }}
              className="absolute top-1/3 left-1/2 -translate-x-1/2 bg-accent text-white font-mono text-[10px] uppercase tracking-[0.25em] px-2 py-0.5 pointer-events-none"
            >
              Wipeout
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wider dim text-center">
        Move mouse · thread the trees
      </p>
    </div>
  );
}
