"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Particles from "../fx/Particles";
import ScorePop from "../fx/ScorePop";
import StreakChip from "../fx/StreakChip";
import { useSound } from "../SoundContext";

const W = 220;
const H = 240;
const START = { x: W / 2, y: H - 28 };
const HOLE = { x: W / 2, y: 44, r: 7 };

export default function PuttPutt() {
  const [pos, setPos] = useState({ x: START.x, y: START.y });
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null);
  const [ballAngle, setBallAngle] = useState(0);
  const posRef = useRef({ x: START.x, y: START.y });
  const velRef = useRef({ vx: 0, vy: 0 });
  const movingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [made, setMade] = useState(0);
  const [taken, setTaken] = useState(0);
  const [streak, setStreak] = useState(0);
  const [result, setResult] = useState<"in" | "out" | "lip" | null>(null);
  const [dropTrig, setDropTrig] = useState(0);
  const [popTrig, setPopTrig] = useState(0);
  const [flagKick, setFlagKick] = useState(0);
  const [popValue, setPopValue] = useState("In!");

  const sound = useSound();
  const audioCtxRef = useRef<AudioContext | null>(null);

  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (audioCtxRef.current) return audioCtxRef.current;
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AC) return null;
    audioCtxRef.current = new AC();
    return audioCtxRef.current;
  }, []);

  const playPlop = useCallback(() => {
    if (!sound.enabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }, [sound.enabled, ensureAudio]);

  const putt = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (movingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tx = ((e.clientX - rect.left) / rect.width) * W;
    const ty = ((e.clientY - rect.top) / rect.height) * H;
    const dx = tx - START.x;
    const dy = ty - START.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 25) return;

    const scale = Math.min(0.085, 0.04 + mag * 0.0003);
    velRef.current = { vx: dx * scale, vy: dy * scale };
    movingRef.current = true;
    setResult(null);
    setAim(null);
  }, []);

  useEffect(() => {
    const tick = () => {
      if (movingRef.current) {
        velRef.current.vx *= 0.965;
        velRef.current.vy *= 0.965;
        posRef.current.x += velRef.current.vx;
        posRef.current.y += velRef.current.vy;

        const p = posRef.current;
        const v = velRef.current;
        const speed = Math.hypot(v.vx, v.vy);

        // Roll: rotate ball proportional to speed
        setBallAngle((a) => a + speed * 5);

        const dHole = Math.hypot(p.x - HOLE.x, p.y - HOLE.y);

        // Drop in (slow enough)
        if (dHole < HOLE.r * 0.7 && speed < 3.5) {
          movingRef.current = false;
          setMade((m) => m + 1);
          setTaken((t) => t + 1);
          setStreak((s) => s + 1);
          setResult("in");
          setDropTrig((p) => p + 1);
          setFlagKick((p) => p + 1);
          setPopTrig((p) => p + 1);
          setPopValue("Drained");
          playPlop();
          setTimeout(reset, 850);
        }
        // Lip-out — close to hole but too fast: deflect away
        else if (
          dHole < HOLE.r + 3 &&
          dHole > HOLE.r * 0.5 &&
          speed >= 3.5
        ) {
          // Deflect: bounce off hole rim
          const nx = (p.x - HOLE.x) / dHole;
          const ny = (p.y - HOLE.y) / dHole;
          const dot = v.vx * nx + v.vy * ny;
          if (dot < 0) {
            // Heading toward hole — deflect
            v.vx = (v.vx - 2 * dot * nx) * 0.85;
            v.vy = (v.vy - 2 * dot * ny) * 0.85;
            setResult("lip");
            setTimeout(() => setResult(null), 400);
          }
        }

        // Out of bounds
        if (p.x < -5 || p.x > W + 5 || p.y < -5 || p.y > H + 5) {
          movingRef.current = false;
          setTaken((t) => t + 1);
          setStreak(0);
          setResult("out");
          setTimeout(reset, 700);
        }

        // Stopped without scoring
        if (speed < 0.06 && movingRef.current) {
          movingRef.current = false;
          setTaken((t) => t + 1);
          setStreak(0);
          setResult("out");
          setTimeout(reset, 700);
        }

        setPos({ x: p.x, y: p.y });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    posRef.current = { x: START.x, y: START.y };
    velRef.current = { vx: 0, vy: 0 };
    setPos({ x: START.x, y: START.y });
    setResult(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (movingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    setAim({ x, y });
  };

  // Aim metrics
  const aimDx = aim ? aim.x - START.x : 0;
  const aimDy = aim ? aim.y - START.y : 0;
  const aimMag = aim ? Math.hypot(aimDx, aimDy) : 0;
  const aimValid = aim && aimMag >= 25;
  const power = aim ? Math.min(1, aimMag / 180) : 0;

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div
        onPointerDown={putt}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setAim(null)}
        className="relative cursor-crosshair select-none touch-none w-full max-w-[220px]"
        style={{
          height: H,
          aspectRatio: `${W} / ${H}`,
          background:
            "radial-gradient(ellipse at center, #1a5c2a 0%, #0d3b1f 70%, #082815 100%)",
          border: "1px solid var(--border-strong)",
          overflow: "hidden",
        }}
      >
        <StreakChip streak={streak} threshold={3} />

        {/* Subtle grain */}
        <div
          className="absolute inset-0 pointer-events-none opacity-25 mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(35deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 4px)",
          }}
        />

        {/* Aim line + power segment */}
        {aimValid && !movingRef.current && (
          <svg
            className="absolute inset-0 pointer-events-none"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
          >
            <line
              x1={START.x}
              y1={START.y}
              x2={START.x + aimDx}
              y2={START.y + aimDy}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              x1={START.x}
              y1={START.y}
              x2={START.x + aimDx * power}
              y2={START.y + aimDy * power}
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Power dot at end */}
            <circle
              cx={START.x + aimDx * power}
              cy={START.y + aimDy * power}
              r="2"
              fill="var(--accent)"
            />
          </svg>
        )}

        {/* Hole */}
        <div
          className="absolute rounded-full bg-black"
          style={{
            left: HOLE.x - HOLE.r,
            top: HOLE.y - HOLE.r,
            width: HOLE.r * 2,
            height: HOLE.r * 2,
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7)",
          }}
        />
        {/* Flag pole */}
        <div
          className="absolute"
          style={{
            left: HOLE.x - 0.5,
            top: HOLE.y - 28,
            width: 1,
            height: 28,
            background: "#fff",
          }}
        />
        {/* Flag — idle sway + kick on score */}
        <motion.div
          className="absolute bg-accent"
          style={{ left: HOLE.x, top: HOLE.y - 28, width: 9, height: 6, transformOrigin: "left center" }}
          animate={
            flagKick > 0
              ? { rotate: [0, -22, 14, -8, 4, 0], scaleX: [1, 1.15, 0.95, 1.05, 1] }
              : { rotate: [0, 4, -2, 0] }
          }
          transition={
            flagKick > 0
              ? { duration: 0.7, ease: "easeOut" }
              : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
          }
          key={`flag-${flagKick}`}
        />

        {/* Ball shadow */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            left: pos.x - 4,
            top: pos.y - 1,
            width: 8,
            height: 4,
            background: "rgba(0,0,0,0.45)",
            filter: "blur(1.5px)",
          }}
        />
        {/* Ball — SVG so we can rotate dimples */}
        <svg
          className="absolute pointer-events-none"
          style={{
            left: pos.x - 5,
            top: pos.y - 5,
            width: 10,
            height: 10,
            transform: `rotate(${ballAngle}deg)`,
          }}
          viewBox="0 0 10 10"
        >
          <circle cx="5" cy="5" r="4.5" fill="white" />
          <circle cx="3.5" cy="3.5" r="0.55" fill="rgba(0,0,0,0.25)" />
          <circle cx="6.5" cy="3.5" r="0.55" fill="rgba(0,0,0,0.25)" />
          <circle cx="5" cy="6.5" r="0.55" fill="rgba(0,0,0,0.25)" />
        </svg>

        {/* Drop particles */}
        <Particles
          trigger={dropTrig}
          x={HOLE.x}
          y={HOLE.y}
          count={10}
          spread={22}
          color="var(--accent)"
          size={2.5}
        />
        <ScorePop
          trigger={popTrig}
          x={HOLE.x}
          y={HOLE.y - 38}
          value={popValue}
        />

        {/* HUD */}
        <div className="absolute top-2 right-2 font-mono text-[10px] uppercase tracking-wider text-white/80 tabular-nums">
          {made}/{taken}
        </div>
        {result && result !== "lip" && (
          <div
            className={`absolute inset-0 flex items-center justify-center pointer-events-none font-mono text-xs uppercase tracking-[0.2em] ${
              result === "in" ? "text-accent" : "text-white/70"
            }`}
          >
            <span className="bg-black/70 px-3 py-1">
              {result === "in" ? "Drained" : "Miss"}
            </span>
          </div>
        )}
        {result === "lip" && (
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 pointer-events-none font-mono text-[10px] uppercase tracking-[0.2em] text-white/80 bg-black/70 px-2 py-0.5">
            Lip-out!
          </div>
        )}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wider dim text-center">
        Aim · click your line · further = harder
      </p>
    </div>
  );
}
