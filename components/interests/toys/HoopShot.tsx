"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Particles from "../fx/Particles";
import ScorePop from "../fx/ScorePop";
import StreakChip from "../fx/StreakChip";
import { useScreenShake } from "../fx/useScreenShake";
import { useSound } from "../SoundContext";

const W = 260;
const H = 180;
const HOOP = { x: W - 50, y: 60, w: 40, h: 4 };
const BACKBOARD = { x: W - 14, y: 30, w: 4, h: 50 };
const START = { x: 38, y: H - 36 };
const G = 0.16;
const T = 55; // flight frames (~1s at 60fps)

// Hornets — teal + purple
const HORNETS_PURPLE = "#1d1160";
const HORNETS_TEAL = "#00788c";

type TrailDot = { x: number; y: number };

export default function HoopShot() {
  const [made, setMade] = useState(0);
  const [taken, setTaken] = useState(0);
  const [streak, setStreak] = useState(0);
  const [ballPos, setBallPos] = useState({ x: START.x, y: START.y - 12 });
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null);
  const [trail, setTrail] = useState<TrailDot[]>([]);
  const [netKick, setNetKick] = useState(0);
  const [rimFlash, setRimFlash] = useState(false);
  const [particleTrig, setParticleTrig] = useState(0);
  const [scoreTrig, setScoreTrig] = useState(0);
  const [popValue, setPopValue] = useState("+1");

  const flyingRef = useRef(false);
  const ballRef = useRef({ x: START.x, y: START.y - 12, vx: 0, vy: 0 });
  const trailRef = useRef<TrailDot[]>([]);
  const rafRef = useRef<number | null>(null);
  const [result, setResult] = useState<"score" | "miss" | null>(null);

  const { transform: shakeTransform, shake } = useScreenShake({
    duration: 220,
    intensity: 3,
  });

  const sound = useSound();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseBufRef = useRef<AudioBuffer | null>(null);

  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (audioCtxRef.current) return audioCtxRef.current;
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AC) return null;
    const ctx = new AC();
    const len = Math.floor(ctx.sampleRate * 0.3);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    audioCtxRef.current = ctx;
    noiseBufRef.current = buf;
    return ctx;
  }, []);

  const playSwish = useCallback(() => {
    if (!sound.enabled) return;
    const ctx = ensureAudio();
    if (!ctx || !noiseBufRef.current) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = noiseBufRef.current;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(hp).connect(gain).connect(ctx.destination);
    n.start(t);
    n.stop(t + 0.25);
  }, [sound.enabled, ensureAudio]);

  const playClunk = useCallback(() => {
    if (!sound.enabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }, [sound.enabled, ensureAudio]);

  const shoot = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (flyingRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const tx = ((e.clientX - rect.left) / rect.width) * W;
      const ty = ((e.clientY - rect.top) / rect.height) * H;
      if (ty >= START.y) return;

      const startBallY = START.y - 12;
      const dx = tx - START.x;
      const dy = ty - startBallY;
      if (Math.hypot(dx, dy) < 35) return;

      const vx = dx / T;
      const vy = (dy - 0.5 * G * T * T) / T;

      ballRef.current = { x: START.x, y: startBallY, vx, vy };
      trailRef.current = [];
      flyingRef.current = true;
      setAim(null);
      setResult(null);
    },
    [],
  );

  // Compute aim arc preview (an array of points) when not flying
  const aimArc: TrailDot[] = (() => {
    if (flyingRef.current || !aim) return [];
    const dx = aim.x - START.x;
    const dy = aim.y - (START.y - 12);
    if (Math.hypot(dx, dy) < 35) return [];
    if (aim.y >= START.y) return [];
    const vx = dx / T;
    const vy = (dy - 0.5 * G * T * T) / T;
    const pts: TrailDot[] = [];
    let x = START.x;
    let y = START.y - 12;
    let cvy = vy;
    for (let i = 0; i < T; i += 4) {
      pts.push({ x, y });
      x += vx * 4;
      cvy += G * 4;
      y += cvy * 4 - 0.5 * G * 16; // approximate
    }
    return pts;
  })();

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (flyingRef.current) {
        frame++;
        const b = ballRef.current;
        b.vy += G;
        b.x += b.vx;
        b.y += b.vy;

        // Trail (downsample every other frame)
        if (frame % 2 === 0) {
          trailRef.current.push({ x: b.x, y: b.y });
          if (trailRef.current.length > 8) trailRef.current.shift();
          setTrail([...trailRef.current]);
        }

        // Backboard bounce
        if (
          b.x + 6 > BACKBOARD.x &&
          b.x < BACKBOARD.x + BACKBOARD.w &&
          b.y > BACKBOARD.y &&
          b.y < BACKBOARD.y + BACKBOARD.h &&
          b.vx > 0
        ) {
          b.vx = -b.vx * 0.6;
          b.x = BACKBOARD.x - 6;
          setRimFlash(true);
          setTimeout(() => setRimFlash(false), 140);
          playClunk();
          shake();
        }

        // Rim collision (front of rim) — bounce off
        const rimFrontX = HOOP.x;
        if (
          Math.abs(b.x - rimFrontX) < 4 &&
          Math.abs(b.y - (HOOP.y + HOOP.h / 2)) < 4 &&
          !(b.vy > 0 && b.x > HOOP.x + 4)
        ) {
          b.vy = -Math.abs(b.vy) * 0.5;
          b.vx *= 0.7;
          setRimFlash(true);
          setTimeout(() => setRimFlash(false), 140);
          playClunk();
        }

        // Through the hoop (falling)
        const inHoopX = b.x > HOOP.x + 2 && b.x < HOOP.x + HOOP.w - 2;
        if (inHoopX && b.y > HOOP.y - 2 && b.y < HOOP.y + 14 && b.vy > 0) {
          flyingRef.current = false;
          setMade((m) => m + 1);
          setTaken((t) => t + 1);
          setStreak((s) => s + 1);
          setResult("score");
          setNetKick((k) => k + 1);
          setParticleTrig((p) => p + 1);
          setScoreTrig((p) => p + 1);
          setPopValue(streak >= 2 ? `+${1 + streak} 🔥` : "+1");
          playSwish();
          setTimeout(resetBall, 800);
        }

        // Off screen / timeout — miss
        if (b.y > H + 20 || b.x < -20 || b.x > W + 20 || frame > 140) {
          flyingRef.current = false;
          setTaken((t) => t + 1);
          setStreak(0);
          setResult("miss");
          setTimeout(resetBall, 700);
        }

        setBallPos({ x: b.x, y: b.y });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetBall = () => {
    ballRef.current = { x: START.x, y: START.y - 12, vx: 0, vy: 0 };
    trailRef.current = [];
    setTrail([]);
    setBallPos({ x: START.x, y: START.y - 12 });
    setResult(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (flyingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    setAim({ x, y });
  };

  const onPointerLeave = () => setAim(null);

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div
        onPointerDown={shoot}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        className="relative cursor-crosshair select-none touch-none w-full max-w-[260px]"
        style={{
          height: H,
          aspectRatio: `${W} / ${H}`,
          background: "linear-gradient(to bottom, #1a1c2e 0%, #0a0a0a 100%)",
          border: `1px solid var(--border-strong)`,
          transform: shakeTransform,
        }}
      >
        <StreakChip streak={streak} threshold={3} />

        {/* Floor */}
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{ height: 14, background: "#1d1160", opacity: 0.4 }}
        />
        {/* Backboard */}
        <div
          className="absolute"
          style={{
            left: `${(BACKBOARD.x / W) * 100}%`,
            top: BACKBOARD.y,
            width: BACKBOARD.w,
            height: BACKBOARD.h,
            background: rimFlash ? "#fb923c" : "#fff",
            transition: "background 0.1s ease-out",
          }}
        />
        {/* Rim */}
        <motion.div
          animate={
            rimFlash
              ? { backgroundColor: ["#fb923c", "#ffffff", "#fb923c"] }
              : { backgroundColor: "#fb923c" }
          }
          transition={{ duration: 0.15 }}
          className="absolute"
          style={{
            left: `${(HOOP.x / W) * 100}%`,
            top: HOOP.y,
            width: HOOP.w,
            height: HOOP.h,
          }}
        />
        {/* Net — 4 lines, wiggle on swish */}
        <svg
          className="absolute pointer-events-none"
          style={{
            left: `${(HOOP.x / W) * 100}%`,
            top: HOOP.y + HOOP.h,
            width: HOOP.w,
            height: 14,
            overflow: "visible",
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const x1 = (i / 4) * HOOP.w;
            const x2 = x1 + (i % 2 === 0 ? 1.5 : -1.5);
            return (
              <motion.line
                key={`${i}-${netKick}`}
                x1={x1}
                y1={0}
                x2={x2}
                y2={14}
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="1"
                initial={netKick > 0 ? { y: -2 } : false}
                animate={netKick > 0 ? { y: [0, 4, -2, 1, 0] } : { y: 0 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
              />
            );
          })}
        </svg>

        {/* Aim preview arc */}
        {aimArc.length > 0 && (
          <>
            {aimArc.map((p, i) => (
              <div
                key={i}
                className="absolute rounded-full pointer-events-none"
                style={{
                  left: `${(p.x / W) * 100}%`,
                  top: p.y,
                  transform: "translate(-50%,-50%)",
                  width: 2,
                  height: 2,
                  background: "rgba(251,146,60,0.35)",
                  opacity: 1 - i / aimArc.length,
                }}
              />
            ))}
          </>
        )}

        {/* Ball trail */}
        {trail.map((p, i) => (
          <div
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              left: `${(p.x / W) * 100}%`,
              top: p.y - 4,
              transform: "translateX(-50%)",
              width: 8,
              height: 8,
              background: "#fb923c",
              opacity: ((i + 1) / trail.length) * 0.35,
            }}
          />
        ))}

        {/* Player (Hornets-coded) */}
        <div
          className="absolute"
          style={{
            left: START.x - 4,
            top: START.y - 28,
            width: 8,
            height: 28,
            background: HORNETS_TEAL,
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            left: START.x - 5,
            top: START.y - 36,
            width: 10,
            height: 10,
            background: HORNETS_PURPLE,
          }}
        />

        {/* Ball */}
        <div
          className="absolute rounded-full"
          style={{
            left: `${(ballPos.x / W) * 100}%`,
            top: ballPos.y - 6,
            transform: "translateX(-50%)",
            width: 12,
            height: 12,
            background: "#fb923c",
            boxShadow: "0 0 6px rgba(251,146,60,0.5)",
          }}
        />

        {/* Particles burst on swish */}
        <Particles
          trigger={particleTrig}
          x={HOOP.x + HOOP.w / 2}
          y={HOOP.y + 12}
          count={12}
          spread={26}
          color="#fb923c"
        />
        <ScorePop
          trigger={scoreTrig}
          x={HOOP.x + HOOP.w / 2}
          y={HOOP.y - 4}
          value={popValue}
          color="#fb923c"
        />

        {/* Score */}
        <div className="absolute top-2 right-2 font-mono text-[10px] uppercase tracking-wider text-white/80 tabular-nums">
          {made}/{taken}
        </div>

        {result && (
          <div
            className={`absolute inset-0 flex items-center justify-center pointer-events-none font-mono text-xs uppercase tracking-[0.2em] ${
              result === "score" ? "text-[#fb923c]" : "text-white/70"
            }`}
          >
            <span className="bg-black/70 px-3 py-1">
              {result === "score" ? "Splash" : "Brick"}
            </span>
          </div>
        )}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wider dim text-center">
        Click the hoop ↗ · further = harder
      </p>
    </div>
  );
}
