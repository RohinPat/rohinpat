"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HOOPS_CAL, flickShot, swipeShot } from "@/components/offhours/hoopsRemote";
import { createFlickDetector, createSwipeTracker } from "@/lib/motion";
import type { FlickEvent, MotionSample, TouchPoint } from "@/lib/motion";
import { ghostButton } from "./Shell";
import type { ControllerProps } from "./types";
import { useMotionSamples } from "./useMotionSamples";

// The basketball controller. Flick: hold the phone flat in your palm like a
// ball, top edge toward the screen, and snap it upward like a shot. Only the
// flick recogniser runs. Touch: swipe up on the ball, for a phone without
// motion sensors (or one that said no); that is the laptop's mouse swipe.
//
// Sends   gesture hoops-flick {power, aim}    a finished flick: 0..1, -1..1
//         gesture hoops-swipe {vx, vy}        a screen swipe, pad heights per second (y down)
//         gesture hoops-sync  {}              "tell me the score" (on mount)
// Hears   gesture hoops-state {score, makes, shots, streak, clock, best, over, running, result, pts}
//                             result is "swish" | "make" | "miss" for the shot that just ended, else ""

type Mode = "flick" | "touch";
type Game = { score: number; makes: number; shots: number; streak: number; clock: number; best: number; over: boolean; running: boolean };
/** power as the game sees it (100% is spot on) and aim -1..1 */
type Last = { power: number; aim: number } | null;

const REASONS: Record<string, string> = {
  "too-sharp": "Smoother: that was a bump, not a flick.",
  "too-slow": "Snap it up faster.",
  repetitive: "One clean flick, no shaking.",
  "not-vertical": "Flick straight up, like a shot.",
  mirrored: "Flick up without dropping it first.",
  ringing: "One clean flick.",
};
const SWIPE_REASONS: Record<string, string> = {
  "too-short": "Swipe up from the ball, further.",
  "too-slow": "Swipe quicker: flick it.",
  "too-few-points": "Swipe up from the ball.",
};

const START: Game = { score: 0, makes: 0, shots: 0, streak: 0, clock: 30, best: 0, over: false, running: false };
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const aimWord = (a: number) => (Math.abs(a) < 0.15 ? "straight" : `${a < 0 ? "left" : "right"} ${Math.round(Math.abs(a) * 100)}%`);

export default function HoopsController({ send, subscribe, motionOk }: ControllerProps) {
  const [mode, setMode] = useState<Mode>(motionOk ? "flick" : "touch");
  const [game, setGame] = useState<Game>(START);
  const [last, setLast] = useState<Last>(null);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<{ text: string; kind: "good" | "bad"; n: number } | null>(null);
  const [launched, setLaunched] = useState(false);
  const launchTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(launchTimer.current), []);

  // the laptop says how the game stands, and how each shot went
  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture" || m.name !== "hoops-state" || !m.data) return;
      const d = m.data;
      setGame({
        score: num(d.score),
        makes: num(d.makes),
        shots: num(d.shots),
        streak: num(d.streak),
        clock: num(d.clock, 30),
        best: num(d.best),
        over: !!d.over,
        running: !!d.running,
      });
      const r = String(d.result ?? "");
      if (r === "swish" || r === "make") setFlash({ text: `${r === "swish" ? "Swish" : "Bucket"} +${num(d.pts)}`, kind: "good", n: Date.now() });
      else if (r === "miss") setFlash({ text: "No good", kind: "bad", n: Date.now() });
      else if (d.over) setFlash({ text: `Final: ${num(d.score)}`, kind: "good", n: Date.now() });
    });
    send({ type: "gesture", name: "hoops-sync", data: {} });
    return off;
  }, [send, subscribe]);

  const launch = useCallback(() => {
    setNote("");
    setLaunched(true);
    window.clearTimeout(launchTimer.current);
    launchTimer.current = window.setTimeout(() => setLaunched(false), 600);
    try {
      navigator.vibrate?.(30);
    } catch {
      /* no haptics here */
    }
  }, []);

  // ---- flick mode: the recogniser, only while this mode is up ----
  const flickOn = mode === "flick" && motionOk;
  const det = useRef(createFlickDetector());
  useEffect(() => {
    det.current.reset();
  }, [flickOn]);
  const onSample = useCallback(
    (s: MotionSample) => {
      for (const o of det.current.push(s)) {
        if (o.kind === "event") {
          const e: FlickEvent = o.event;
          const power = Math.round(e.power * 1000) / 1000;
          const aim = Math.round(e.aim * 1000) / 1000;
          send({ type: "gesture", name: "hoops-flick", data: { power, aim } });
          setLast({ power: flickShot(power, aim, 0).power, aim });
          launch();
        } else setNote(REASONS[o.reason] ?? "Didn't catch that. One clean flick up.");
      }
    },
    [send, launch],
  );
  const { receiving } = useMotionSamples(flickOn, onSample);
  const noSensor = mode === "flick" && motionOk && receiving === false;
  const touch = mode === "touch" || noSensor;

  const onSwipe = useCallback(
    (vx: number, vy: number) => {
      send({ type: "gesture", name: "hoops-swipe", data: { vx: Math.round(vx * 100) / 100, vy: Math.round(vy * 100) / 100 } });
      setLast({ power: swipeShot(vx, vy, 0, 0, 1, HOOPS_CAL.phoneSwipeGain)?.power ?? 0, aim: Math.max(-1, Math.min(1, vx / -vy)) });
      launch();
    },
    [send, launch],
  );

  const status = game.over ? `Time! ${touch ? "Swipe" : "Flick"} to go again.` : !game.running && !game.shots ? "Your first shot starts the clock." : "";
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-testid="hoops-controller" data-mode={touch ? "touch" : "flick"}>
      <h1 className="mt-4 text-[1.55rem] leading-tight font-extrabold text-balance">{touch ? "Swipe up on the ball." : "Hold it like a ball. Flick up."}</h1>
      <p className="mt-1.5 text-[1.05rem] leading-snug text-[#c9c6b6]">
        {touch
          ? "Swipe toward the hoop. Faster is longer; angle it to aim."
          : "Flat in your palm, top edge toward the screen. Snap up like a shot; lean left or right to aim."}
      </p>

      <section aria-label="Game" className="mt-3 grid grid-cols-3 gap-2 text-center" data-testid="hoops-game">
        <Stat label="Score" value={`${game.score}`} unit={game.shots ? `${game.makes} of ${game.shots}` : ""} />
        <Stat label="Time" value={game.running || game.over ? `0:${String(game.clock).padStart(2, "0")}` : "0:30"} unit="" hot={game.running && game.clock <= 5} />
        <Stat label="Streak" value={game.streak >= 3 ? "×2" : `${game.streak}`} unit={game.streak >= 3 ? "On fire" : ""} />
      </section>
      <div className="relative mt-3 rounded-[24px] border border-white/15 bg-white/10 overflow-hidden" data-testid="hoops-stage">
        {touch ? <SwipePad launched={launched} onSwipe={onSwipe} onNote={setNote} /> : <BallStage launched={launched} noSensor={noSensor} />}
        {flash && (
          <p
            key={flash.n}
            role="status"
            data-testid="hoops-flash"
            className={`absolute left-1/2 top-3 -translate-x-1/2 rounded-full px-4 py-1.5 text-[1.15rem] font-extrabold whitespace-nowrap pointer-events-none ${
              flash.kind === "good" ? "bg-[var(--mint)] text-[var(--ink)]" : "bg-[#e5484d]/90 text-white"
            }`}
          >
            {flash.text}
          </p>
        )}
      </div>

      {noSensor && (
        <p role="status" data-testid="hoops-nosensor" className="mt-3 rounded-[14px] bg-[#d9b44a]/15 border border-[#d9b44a]/40 px-3.5 py-2.5 text-[1rem] text-[#f0dc9d]">
          This phone isn&apos;t sending motion, so you can swipe the ball instead.
        </p>
      )}
      {note && (
        <p role="status" data-testid="hoops-note" className="mt-3 rounded-[14px] bg-[#d9b44a]/15 border border-[#d9b44a]/40 px-3.5 py-2.5 text-[1rem] text-[#f0dc9d]">
          {note}
        </p>
      )}

      <p className="mt-2 text-center text-[0.95rem] text-[#a3a69c]" data-testid="hoops-last">
        {status || (last ? `Last shot: power ${Math.round(last.power * 100)}% (100 is spot on), ${aimWord(last.aim)}` : "No shots yet.")}
        {game.best ? ` · Best ${game.best}` : ""}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Control">
        {(["flick", "touch"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            data-mode-btn={m}
            disabled={m === "flick" && !motionOk}
            onClick={() => {
              setMode(m);
              setNote("");
            }}
            className={`${ghostButton} !min-h-[52px] ${mode === m ? "!bg-[var(--mint)] !text-[var(--ink)] !border-transparent" : ""} disabled:opacity-40`}
          >
            {m === "flick" ? "Flick" : "Swipe"}
          </button>
        ))}
      </div>
      {!motionOk && (
        <p className="mt-2 text-[0.95rem] leading-snug text-[#a3a69c]">
          Motion is off on this phone, so flicking isn&apos;t available. Reload this page and allow motion to turn it on.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, unit, hot }: { label: string; value: string; unit: string; hot?: boolean }) {
  return (
    <div className="rounded-[16px] bg-white/10 border border-white/15 px-2 py-2.5">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a69c]">{label}</p>
      <p className={`mt-1 text-[1.5rem] leading-none font-extrabold tabular-nums ${hot ? "text-[#ff8a7a]" : ""}`}>{value}</p>
      <p className="mt-1 text-[12px] text-[#a3a69c] min-h-[1.1em] leading-tight">{unit}</p>
    </div>
  );
}

/** A basketball, drawn: the seams are what make it a ball and not an orange circle. */
function Ball({ size, style, className = "" }: { size: number; style?: React.CSSProperties; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true" style={style} className={className}>
      <defs>
        <radialGradient id="hb-g" cx="-0.3" cy="-0.35" r="1.1">
          <stop offset="0" stopColor="#ffa057" />
          <stop offset="1" stopColor="#b9461a" />
        </radialGradient>
        <clipPath id="hb-c">
          <circle r="46" />
        </clipPath>
      </defs>
      <circle r="46" fill="url(#hb-g)" />
      <g clipPath="url(#hb-c)" stroke="rgba(30,15,10,0.75)" strokeWidth="3" fill="none">
        <path d="M-50 0H50M0 -50V50" />
        <path d="M-30 -40Q-8 0 -30 40M30 -40Q8 0 30 40" />
      </g>
    </svg>
  );
}

const flightStyle = (launched: boolean): React.CSSProperties => ({
  transform: launched ? "translateY(-130px) scale(0.45)" : "translateY(0) scale(1)",
  opacity: launched ? 0 : 1,
  transition: launched ? "transform 0.45s cubic-bezier(.2,.7,.3,1), opacity 0.45s ease-in" : "transform 0.3s ease-out 0.1s, opacity 0.3s ease-out 0.1s",
});

/** Flick mode: the ball you are holding. The phone itself is the ball, so this is only a picture of the palm and the direction of the throw. */
function BallStage({ launched, noSensor }: { launched: boolean; noSensor: boolean }) {
  return (
    <div className="flex flex-col items-center justify-end h-[210px] pb-4" data-testid="hoops-ball">
      <svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true" className="text-[var(--mint)] mb-2 opacity-80">
        <path d="M32 54V12M18 26l14-14 14 14" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <Ball size={112} style={flightStyle(launched)} className={noSensor ? "opacity-50" : ""} />
      <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.16em] text-[#a3a69c]">{noSensor ? "No motion data" : "Ready"}</p>
    </div>
  );
}

/** Touch mode: the same shot as the laptop's mouse swipe, measured in pad heights per second. */
function SwipePad({ launched, onSwipe, onNote }: { launched: boolean; onSwipe: (vx: number, vy: number) => void; onNote: (n: string) => void }) {
  const pad = useRef<HTMLDivElement>(null);
  const tracker = useRef(createSwipeTracker({ minLength: 36, minPeakSpeed: 400 }));
  const [trail, setTrail] = useState<readonly TouchPoint[]>([]);
  const active = useRef<number | null>(null);

  const at = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    return { t: performance.now() / 1000, x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep the swipe if the finger leaves the pad
    } catch {
      /* not an active pointer (a synthetic event): the pad still tracks it */
    }
    active.current = e.pointerId;
    const p = at(e);
    tracker.current.down(p.t, p.x, p.y);
    setTrail([{ t: p.t, x: p.x, y: p.y }]);
    onNote("");
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    const p = at(e);
    tracker.current.move(p.t, p.x, p.y);
    setTrail(tracker.current.points().slice());
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    const p = at(e);
    const out = tracker.current.up(p.t, p.x, p.y);
    setTrail([]);
    if (out.kind === "reject") {
      onNote(SWIPE_REASONS[out.reason] ?? "Swipe up from the ball.");
      return;
    }
    const ev = out.event;
    const h = pad.current!.clientHeight || 1;
    // the heading is measured off straight up; a shot needs to be mostly up
    if (Math.abs(ev.directionDeg) > 70) {
      onNote("Swipe up, toward the hoop.");
      return;
    }
    onSwipe((ev.peakSpeed * Math.sin(ev.direction)) / h, (-ev.peakSpeed * Math.cos(ev.direction)) / h);
  };

  return (
    <div
      ref={pad}
      data-testid="hoops-pad"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        active.current = null;
        tracker.current.cancel();
        setTrail([]);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="relative h-[260px] touch-none select-none flex flex-col items-center justify-end pb-5"
    >
      <svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true" className="text-[var(--mint)] mb-2 opacity-60">
        <path d="M32 54V12M18 26l14-14 14 14" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <Ball size={112} style={flightStyle(launched)} />
      {trail.length > 1 && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          <polyline points={trail.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="var(--mint)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        </svg>
      )}
    </div>
  );
}
