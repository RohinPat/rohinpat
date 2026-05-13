"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import Particles from "../fx/Particles";
import StreakChip from "../fx/StreakChip";
import { useScreenShake } from "../fx/useScreenShake";

const PITCH_W = 320;
const PITCH_H = 420;
const GOAL_LEFT = 100;
const GOAL_RIGHT = 220;
const GOAL_LINE = 30;
const BALL_R = 9;
const START = { x: PITCH_W / 2, y: PITCH_H - 50 };
const FLIGHT_MS = 650;

type Phase = "idle" | "flying" | "result";
type Result = "goal" | "miss" | null;

export default function PitchKicker() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ball, setBall] = useState(START);
  const [result, setResult] = useState<Result>(null);
  const [score, setScore] = useState({ goals: 0, taken: 0 });
  const [streak, setStreak] = useState(0);
  const [goalTrig, setGoalTrig] = useState(0);
  const [goalPos, setGoalPos] = useState({ x: PITCH_W / 2, y: GOAL_LINE });
  const flightRef = useRef<{ ex: number; ey: number; curl: number; t0: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const { transform: shakeTransform, shake } = useScreenShake({
    duration: 240,
    intensity: 4,
  });

  const shoot = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (phase !== "idle") return;
      const rect = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * PITCH_W;
      const py = ((e.clientY - rect.top) / rect.height) * PITCH_H;
      // Don't shoot if click is below the ball (you're aiming backwards)
      if (py >= START.y - 10) return;

      // Ignore taps right next to the ball — would barely move and miss.
      const dx = px - START.x;
      const dy = py - START.y;
      if (Math.hypot(dx, dy) < 50) return;

      // Curl = horizontal component of click relative to start, scaled
      const curl = (px - START.x) * 0.25;
      flightRef.current = { ex: px, ey: py, curl, t0: performance.now() };
      setPhase("flying");
    },
    [phase],
  );

  useEffect(() => {
    if (phase !== "flying" || !flightRef.current) return;
    const { ex, ey, curl, t0 } = flightRef.current;

    const step = (now: number) => {
      const t = Math.min((now - t0) / FLIGHT_MS, 1);
      // Lerp + perpendicular sine for curl
      const lerpX = START.x + (ex - START.x) * t;
      const lerpY = START.y + (ey - START.y) * t;
      const dx = ex - START.x;
      const dy = ey - START.y;
      const mag = Math.hypot(dx, dy) || 1;
      const px = -dy / mag;
      const py = dx / mag;
      const bend = Math.sin(t * Math.PI) * curl;
      const x = lerpX + px * bend;
      const y = lerpY + py * bend;
      setBall({ x, y });

      // Goal line crossed?
      if (y < GOAL_LINE) {
        const inGoal = x > GOAL_LEFT + 4 && x < GOAL_RIGHT - 4;
        finishShot(inGoal ? "goal" : "miss");
        return;
      }
      if (t >= 1) {
        finishShot("miss");
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finishShot = (r: Result) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setResult(r);
    setScore((s) => ({
      goals: s.goals + (r === "goal" ? 1 : 0),
      taken: s.taken + 1,
    }));
    if (r === "goal") {
      setStreak((s) => s + 1);
      setGoalPos({ x: ball.x, y: ball.y });
      setGoalTrig((p) => p + 1);
      shake();
    } else {
      setStreak(0);
    }
    setPhase("result");
    setTimeout(() => {
      setResult(null);
      setBall(START);
      setPhase("idle");
    }, 900);
  };

  const reset = () => setScore({ goals: 0, taken: 0 });

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-[320px] mx-auto">
      <div
        onPointerDown={shoot}
        className="relative cursor-crosshair select-none touch-none border border-[var(--border-strong)]"
        style={{
          width: PITCH_W,
          height: PITCH_H,
          background: "#0d1f0d",
          maxWidth: "100%",
          transform: shakeTransform,
        }}
      >
        <StreakChip streak={streak} threshold={3} />
        {/* Pitch markings */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Goal box */}
          <div
            className="absolute border-x border-b border-white/15"
            style={{ left: 70, top: 0, width: PITCH_W - 140, height: 70 }}
          />
          {/* Six-yard */}
          <div
            className="absolute border-x border-b border-white/15"
            style={{ left: 120, top: 0, width: PITCH_W - 240, height: 28 }}
          />
          {/* Penalty spot */}
          <div
            className="absolute w-1 h-1 rounded-full bg-white/30"
            style={{ left: PITCH_W / 2 - 2, top: 56 }}
          />
          {/* Free-kick mark */}
          <div
            className="absolute w-1.5 h-1.5 border border-white/40 rounded-full"
            style={{ left: START.x - 3, top: START.y - 3 }}
          />
        </div>

        {/* Goal */}
        <div
          className="absolute pointer-events-none"
          style={{ left: 0, top: 0, width: PITCH_W, height: GOAL_LINE + 4 }}
        >
          <div
            className="absolute"
            style={{
              left: GOAL_LEFT,
              top: 0,
              width: GOAL_RIGHT - GOAL_LEFT,
              height: GOAL_LINE,
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "8px 8px",
            }}
          />
          <div className="absolute bg-white" style={{ left: GOAL_LEFT, top: 0, width: 3, height: GOAL_LINE }} />
          <div className="absolute bg-white" style={{ left: GOAL_RIGHT - 3, top: 0, width: 3, height: GOAL_LINE }} />
          <div className="absolute bg-white" style={{ left: GOAL_LEFT, top: GOAL_LINE, width: GOAL_RIGHT - GOAL_LEFT, height: 3 }} />
        </div>

        {/* Ball */}
        <div
          className="absolute rounded-full bg-white border-2 border-black"
          style={{
            left: ball.x - BALL_R,
            top: ball.y - BALL_R,
            width: BALL_R * 2,
            height: BALL_R * 2,
            boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
          }}
        />

        {/* Goal particles */}
        <Particles
          trigger={goalTrig}
          x={goalPos.x}
          y={goalPos.y}
          count={16}
          spread={48}
          color="var(--accent)"
          size={3}
          duration={0.7}
        />

        {/* Result overlay */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div
                className={`px-4 py-2 font-mono text-base uppercase tracking-[0.25em] ${
                  result === "goal"
                    ? "bg-accent text-white"
                    : "bg-black/70 text-white"
                }`}
              >
                {result === "goal" ? "Goal!" : "Off target"}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-baseline justify-between w-full font-mono text-xs uppercase tracking-wider">
        <div className="muted">
          Goals <span className="accent text-base tabular-nums">{score.goals}</span> / {score.taken}
        </div>
        {score.taken > 0 && (
          <button
            onClick={reset}
            className="dim hover:accent transition-colors"
          >
            reset
          </button>
        )}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wider dim text-center">
        Click anywhere on the pitch · sideways aim adds curl
      </p>
    </div>
  );
}
