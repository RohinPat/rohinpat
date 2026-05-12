"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Phase = "idle" | "loading" | "ready" | "celebrating" | "error";
type Keypoint = { x: number; y: number; score: number; name?: string };
type PoseKey = "wide" | "up" | "point" | "fist" | "heart";
type Detected = { key: PoseKey; label: string; flavor: string };

const TARGET_HOLD_MS = 600;
const LOCKOUT_MS = 2400;

// Connections for skeleton rendering — upper body only (laptop framing).
const EDGES: [string, string][] = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "nose"],
  ["right_shoulder", "nose"],
];

function kpByName(kps: Keypoint[]): Record<string, Keypoint> {
  const m: Record<string, Keypoint> = {};
  for (const k of kps) if (k.name) m[k.name] = k;
  return m;
}

// Detect any of several goal celebrations.
// Designed to work seated at a laptop — only requires head + shoulders + wrists.
// Returns the most specific match if multiple apply.
function detectCelebration(kps: Keypoint[]): Detected | null {
  const m = kpByName(kps);
  const need = ["left_shoulder", "right_shoulder", "left_wrist", "right_wrist", "nose"];
  for (const k of need) {
    if (!m[k] || m[k].score < 0.3) return null;
  }
  const ls = m.left_shoulder!, rs = m.right_shoulder!;
  const lw = m.left_wrist!, rw = m.right_wrist!;
  const nose = m.nose!;

  const shoulderY = (ls.y + rs.y) / 2;
  const shoulderSpread = Math.abs(ls.x - rs.x) || 60;
  const headY = nose.y;

  const leftAboveHead   = lw.y < headY - 10;
  const rightAboveHead  = rw.y < headY - 10;
  const leftAboveShoulder  = lw.y < shoulderY - 10;
  const rightAboveShoulder = rw.y < shoulderY - 10;

  // ---- Most specific first ----

  // HEART hands: both wrists near each other above shoulders.
  const wristDistance = Math.hypot(lw.x - rw.x, lw.y - rw.y);
  if (leftAboveShoulder && rightAboveShoulder && wristDistance < shoulderSpread * 0.55) {
    return { key: "heart", label: "Heart hands", flavor: "for the curva sud" };
  }

  // ARMS WIDE (Messi): both wrists above shoulders, spread wider than shoulders.
  const wristSpread = Math.abs(lw.x - rw.x);
  if (leftAboveShoulder && rightAboveShoulder && wristSpread > shoulderSpread * 1.15) {
    return { key: "wide", label: "Arms wide", flavor: "Messi style" };
  }

  // BOTH ARMS UP (jubilation, works seated): both wrists above head.
  if (leftAboveHead && rightAboveHead) {
    return { key: "up", label: "Both arms up", flavor: "pure jubilation" };
  }

  // POINT TO SKY: one wrist way above head, other low.
  const oneFar = (leftAboveHead && !rightAboveShoulder) || (rightAboveHead && !leftAboveShoulder);
  if (oneFar) {
    return { key: "point", label: "Point to the sky", flavor: "for someone watching" };
  }

  // FIST PUMP: one wrist between shoulder and head, other low.
  const leftFist  = lw.y < shoulderY - 10 && lw.y > headY - 40 && !rightAboveShoulder;
  const rightFist = rw.y < shoulderY - 10 && rw.y > headY - 40 && !leftAboveShoulder;
  if (leftFist || rightFist) {
    return { key: "fist", label: "Fist pump", flavor: "Eto'o energy" };
  }

  return null;
}

export default function PoseCelebrate() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [goals, setGoals] = useState(0);
  const [hint, setHint] = useState<"none" | "almost" | "yes">("none");
  const [scoredPose, setScoredPose] = useState<Detected | null>(null);
  const [currentPose, setCurrentPose] = useState<Detected | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const matchStartRef = useRef<number | null>(null);
  const lastMatchKeyRef = useRef<PoseKey | null>(null);
  const lockoutByPoseRef = useRef<Record<PoseKey, number>>({
    wide: 0, up: 0, point: 0, fist: 0, heart: 0,
  });

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    detectorRef.current?.dispose?.();
    detectorRef.current = null;
    setPhase("idle");
    setCurrentPose(null);
  }, []);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    try {
      const tf = await import("@tensorflow/tfjs");
      await import("@tensorflow/tfjs-backend-webgl");
      const poseDetection = await import("@tensorflow-models/pose-detection");
      await tf.ready();

      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING },
      );
      detectorRef.current = detector;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      setPhase("ready");

      const loop = async () => {
        if (!detectorRef.current || !videoRef.current || !canvasRef.current) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        const v = videoRef.current;
        const c = canvasRef.current;
        const ctx = c.getContext("2d")!;
        const poses = await detectorRef.current.estimatePoses(v, {
          maxPoses: 1,
          flipHorizontal: false,
        });

        ctx.clearRect(0, 0, c.width, c.height);
        if (poses[0]) {
          drawSkeleton(ctx, poses[0].keypoints);
          const now = performance.now();
          const detected = detectCelebration(poses[0].keypoints);
          setCurrentPose(detected);

          if (detected && (lockoutByPoseRef.current[detected.key] ?? 0) < now) {
            if (lastMatchKeyRef.current !== detected.key) {
              matchStartRef.current = now;
              lastMatchKeyRef.current = detected.key;
            } else if (matchStartRef.current == null) {
              matchStartRef.current = now;
            }
            const held = now - (matchStartRef.current ?? now);
            setHint(held > 200 ? "yes" : "almost");
            if (held >= TARGET_HOLD_MS) {
              triggerGoal(detected);
              matchStartRef.current = null;
              lastMatchKeyRef.current = null;
              lockoutByPoseRef.current[detected.key] = now + LOCKOUT_MS;
            }
          } else {
            matchStartRef.current = null;
            lastMatchKeyRef.current = null;
            setHint("none");
          }
        } else {
          setCurrentPose(null);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(
        e?.name === "NotAllowedError"
          ? "Camera permission denied."
          : "Could not load pose detector. (WebGL or camera unavailable.)",
      );
      setPhase("error");
    }
  }, []);

  const triggerGoal = (pose: Detected) => {
    setGoals((g) => g + 1);
    setScoredPose(pose);
    setPhase("celebrating");
    playWhistle();
    setTimeout(() => {
      setPhase("ready");
      setScoredPose(null);
    }, 2200);
  };

  return (
    <section id="pose" className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            01 — Pose-to-celebrate
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / score a goal
          </span>
        </div>
        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight mb-4">
          Strike a pose. Score a goal.
        </h2>
        <p className="muted max-w-prose mb-10 text-pretty">
          Real on-device pose detection (TensorFlow.js MoveNet, no server, no video uploaded).
          Five celebrations work — even sitting at a laptop. Hold one for a beat.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
          <div className="md:col-span-8">
            <div className="relative aspect-[4/3] border border-[var(--border-strong)] bg-[var(--bg-elevated)] overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
              <canvas
                ref={canvasRef}
                width={640}
                height={480}
                className="absolute inset-0 w-full h-full"
                style={{ transform: "scaleX(-1)" }}
              />

              {(phase === "ready" || phase === "celebrating") && (
                <div className="absolute top-3 left-3 border border-[var(--border-strong)] bg-[var(--bg)]/80 backdrop-blur px-3 py-2 font-mono text-[10px] leading-snug min-w-[180px]">
                  <p className="accent">MoveNet · lightning</p>
                  <p className="muted">on-device · webgl</p>
                  <p className="dim">
                    pose: {currentPose?.label ?? "—"}
                  </p>
                  <p className="dim">
                    state: {hint === "yes" ? "holding…" : hint === "almost" ? "almost" : "scan"}
                  </p>
                </div>
              )}

              {/* Live hold meter at bottom of frame */}
              {phase === "ready" && currentPose && hint !== "none" && (
                <div className="absolute bottom-3 left-3 right-3">
                  <div className="bg-[var(--bg)]/80 backdrop-blur border border-[var(--border-strong)] p-2">
                    <div className="flex items-baseline justify-between mb-1.5 font-mono text-[10px] uppercase tracking-wider">
                      <span className="accent">{currentPose.label}</span>
                      <span className="dim">{currentPose.flavor}</span>
                    </div>
                    <div className="h-1 bg-[var(--border)] overflow-hidden">
                      <motion.div
                        className="h-full bg-accent"
                        initial={{ width: 0 }}
                        animate={{ width: hint === "yes" ? "100%" : "40%" }}
                        transition={{ duration: 0.4 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {phase === "celebrating" && scoredPose && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center flex-col gap-3"
                  >
                    <Confetti />
                    <motion.div
                      initial={{ scale: 0.6, y: 20 }}
                      animate={{ scale: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 220, damping: 14 }}
                      className="bg-accent text-white px-6 py-3 font-mono text-2xl uppercase tracking-[0.2em] shadow-2xl"
                    >
                      Goallllll
                    </motion.div>
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.15 }}
                      className="font-mono text-xs uppercase tracking-[0.25em] text-white bg-black/60 px-3 py-1.5"
                    >
                      {scoredPose.label} · {scoredPose.flavor}
                    </motion.p>
                  </motion.div>
                )}
              </AnimatePresence>

              {(phase === "idle" || phase === "loading" || phase === "error") && (
                <div className="absolute inset-0 bg-[var(--bg)]/95 backdrop-blur-sm flex items-center justify-center flex-col gap-4 p-8 text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.2em] accent">
                    {phase === "loading"
                      ? "Loading model…"
                      : phase === "error"
                        ? "Couldn't start"
                        : "Camera required"}
                  </p>
                  <p className="muted text-sm max-w-sm">
                    {phase === "loading"
                      ? "First load is ~3 MB (cached afterward)."
                      : phase === "error"
                        ? errorMsg
                        : "Runs entirely in your browser. No video leaves your device."}
                  </p>
                  {phase !== "loading" && (
                    <button
                      onClick={start}
                      className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--fg)] text-[var(--bg)] font-medium hover:bg-accent hover:text-white transition-colors"
                    >
                      {phase === "error" ? "Try again" : "Enable camera"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <p className="mt-3 font-mono text-xs dim">
              Built with MoveNet (single-pose Lightning). ~3 MB model, ~30 FPS on a laptop, all on-device.
            </p>
          </div>

          <div className="md:col-span-4 flex flex-col gap-6">
            <div className="border border-[var(--border-strong)] p-5">
              <p className="font-mono text-xs uppercase tracking-wider dim">Goals scored</p>
              <p className="text-6xl font-semibold accent tabular-nums leading-none mt-1">{goals}</p>
              <p className="font-mono text-xs muted mt-2">
                {goals === 0 ? "Strike a pose to score." : "Stack more, different ones."}
              </p>
            </div>

            <div className="border border-[var(--border)] p-5">
              <p className="font-mono text-xs uppercase tracking-wider accent mb-3">
                Celebrations
              </p>
              <ol className="space-y-2.5 text-sm">
                <li className="flex gap-2.5">
                  <span className="accent font-mono shrink-0">①</span>
                  <span>
                    <span className="text-[var(--fg)]">Both arms up</span>{" "}
                    <span className="muted">— easiest, works seated.</span>
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="accent font-mono shrink-0">②</span>
                  <span>
                    <span className="text-[var(--fg)]">Arms wide (Messi)</span>{" "}
                    <span className="muted">— needs some shoulder room.</span>
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="accent font-mono shrink-0">③</span>
                  <span>
                    <span className="text-[var(--fg)]">Point to sky</span>{" "}
                    <span className="muted">— one arm up high.</span>
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="accent font-mono shrink-0">④</span>
                  <span>
                    <span className="text-[var(--fg)]">Fist pump</span>{" "}
                    <span className="muted">— one hand near your face.</span>
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="accent font-mono shrink-0">⑤</span>
                  <span>
                    <span className="text-[var(--fg)]">Heart hands</span>{" "}
                    <span className="muted">— hands together above chest.</span>
                  </span>
                </li>
              </ol>
              <p className="mt-4 font-mono text-xs dim">
                Hold ~0.6 s. Each pose has its own short cooldown so you can stack them.
              </p>
            </div>

            {phase !== "idle" && phase !== "error" && (
              <button
                onClick={stop}
                className="self-start font-mono text-xs uppercase tracking-wider muted hover:text-[var(--fg)] transition-colors link-underline"
              >
                Stop camera ↗
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function drawSkeleton(ctx: CanvasRenderingContext2D, kps: Keypoint[]) {
  const m: Record<string, Keypoint> = {};
  for (const k of kps) if (k.name) m[k.name] = k;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(237,237,237,0.6)";
  ctx.lineWidth = 2;
  for (const [a, b] of EDGES) {
    const A = m[a], B = m[b];
    if (!A || !B || A.score < 0.3 || B.score < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }
  const upperBody = new Set([
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
  ]);
  for (const k of kps) {
    if (k.score < 0.3 || !k.name || !upperBody.has(k.name)) continue;
    ctx.fillStyle = "#a50044";
    ctx.beginPath();
    ctx.arc(k.x, k.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function Confetti() {
  const pieces = Array.from({ length: 48 });
  return (
    <div className="absolute inset-0 pointer-events-none">
      {pieces.map((_, i) => {
        const left = `${Math.random() * 100}%`;
        const delay = Math.random() * 0.25;
        const isAccent = i % 2 === 0;
        return (
          <motion.span
            key={i}
            className={`absolute top-0 w-2 h-3 ${isAccent ? "bg-accent" : "bg-white"}`}
            style={{ left }}
            initial={{ y: -20, rotate: 0, opacity: 1 }}
            animate={{ y: 600, rotate: 540, opacity: 0 }}
            transition={{ duration: 1.7, delay, ease: "easeIn" }}
          />
        );
      })}
    </div>
  );
}

function playWhistle() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(2200, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(2700, ctx.currentTime + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 700);
  } catch {
    /* no-op */
  }
}
