"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ENGINE_CAL, READY_VIEW, parseNightState, type NightView } from "@/components/offhours/engineRemote";
import { createFlickDetector, createWheelFilter } from "@/lib/motion";
import type { MotionSample } from "@/lib/motion";
import { createAxes } from "./axes";
import { ghostButton } from "./Shell";
import type { ControllerProps } from "./types";
import { useMotionSamples } from "./useMotionSamples";

// Night run's controller. Hold the phone landscape like a steering wheel,
// screen toward you, and turn it: clockwise steers right (the same wheel filter
// as the slalom's handlebars: a dead zone, and it re-centres to however you
// held it when it opened, from the button, and by itself if the wheel sits far
// past lock for a while). The right thumb is the Gas, the left is the Brake. A
// flick, or the Drift button, is the handbrake. By hand the gearbox gets shift
// paddles. The laptop sends the run back (speed, gear, drift combo, the clock),
// and the phone buzzes at a checkpoint and on a hit (where the browser allows).
// Touch, for a phone with no motion data (or one that said no): two steer
// halves, left and right, no tilt.
//
// Sends   axis    steer  -1..1   (+ = right)
//         axis    gas    0..1    held
//         axis    brake  0..1    held
//         axis    hand   0..1    the Drift button, held
//         gesture night-handbrake {ms}   a flick
//         gesture night-shift     {dir}  +1 up, -1 down (manual)
//         gesture night-auto      {on}   automatic or manual gearbox
//         gesture night-again     {}     start, or drive again
//         gesture engine-sync     {}     "tell me the mode and the run" (Engine.tsx does, on mount)
// Hears   gesture night-state {phase, speed, gear, auto, combo, pending, score, time, cp, cps, cpN, hitN, count, miles, best}

type Mode = "wheel" | "touch";

const buzz = (ms: number | number[]) => {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    /* no haptics here */
  }
};

const grouped = (n: number) => Math.round(n).toLocaleString("en-US");
const W = ENGINE_CAL.wheel;

export default function EngineNightController({ send, subscribe, motionOk }: ControllerProps) {
  const [mode, setMode] = useState<Mode>(motionOk ? "wheel" : "touch");
  const [view, setView] = useState<NightView>(READY_VIEW);
  const [heard, setHeard] = useState(false);
  const [upright, setUpright] = useState(true);
  const [fed, setFed] = useState(false);
  const [down, setDown] = useState({ gas: false, brake: false, hand: false, left: false, right: false });

  const sendRef = useRef(send);
  sendRef.current = send;
  const axes = useMemo(() => createAxes((m) => sendRef.current(m), ["steer", "gas", "brake", "hand"], { step: 0.02 }), []);
  const wheel = useRef({ steer: 0, deg: 0 });
  const held = useRef({ gas: false, brake: false, hand: false });

  // the laptop says where the run is; buzz at a gate and at a hit
  const seen = useRef({ cpN: -1, hitN: -1 });
  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture" || m.name !== "night-state") return;
      const v = parseNightState(m.data);
      if (!v) return;
      setView(v);
      setHeard(true);
      const s = seen.current;
      if (s.cpN >= 0 && v.cpN > s.cpN) buzz([40, 70, 40]);
      if (s.hitN >= 0 && v.hitN > s.hitN) buzz(90);
      s.cpN = v.cpN;
      s.hitN = v.hitN;
    });
    return off;
  }, [subscribe]);

  const rest = useCallback(() => {
    held.current = { gas: false, brake: false, hand: false };
    setDown({ gas: false, brake: false, hand: false, left: false, right: false });
    wheel.current = { steer: 0, deg: 0 };
    axes.zero();
  }, [axes]);
  useEffect(() => {
    const hide = () => document.hidden && rest();
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      axes.zero();
      axes.dispose();
    };
  }, [axes, rest]);

  // ---- the wheel: the filter and the flick, only while this mode is up
  const wheelOn = mode === "wheel" && motionOk;
  const filter = useRef(createWheelFilter({ maxAngleDeg: W.rangeDeg, deadZoneDeg: W.deadDeg, smoothingS: W.smoothingS }));
  const flick = useRef(createFlickDetector());
  const far = useRef<number | null>(null);
  const uprightRef = useRef(true);
  useEffect(() => {
    filter.current.reset(); // the pose it opens in (or comes back to) is straight ahead
    flick.current.reset();
    far.current = null;
    wheel.current = { steer: 0, deg: 0 };
    axes.set("steer", 0);
  }, [wheelOn, axes]);
  const onSample = useCallback(
    (s: MotionSample) => {
      const st = filter.current.push(s);
      setFed(true);
      if (st.valid !== uprightRef.current) {
        uprightRef.current = st.valid;
        setUpright(st.valid);
      }
      if (!st.valid) {
        wheel.current = { steer: 0, deg: 0 };
        axes.set("steer", 0);
        return;
      }
      // turned the phone to another orientation after opening: take the pose it settles in as straight ahead
      if (Math.abs(st.wheelDeg) >= W.autoRecentreDeg) {
        far.current ??= s.t;
        if (s.t - far.current >= W.autoRecentreS) {
          filter.current.recalibrate();
          far.current = null;
        }
      } else far.current = null;
      wheel.current = { steer: st.steer, deg: st.wheelDeg };
      axes.set("steer", st.steer);
      for (const o of flick.current.push(s)) {
        if (o.kind === "event") {
          sendRef.current({ type: "gesture", name: "night-handbrake", data: { ms: ENGINE_CAL.handbrakeMs } });
          buzz(25);
        }
      }
    },
    [axes],
  );
  const { receiving } = useMotionSamples(wheelOn, onSample);
  const noSensor = mode === "wheel" && motionOk && receiving === false && !fed;
  // no samples arrived: fall back to the steer buttons, and say why
  const [fellBack, setFellBack] = useState(false);
  useEffect(() => {
    if (noSensor) {
      setMode("touch");
      setFellBack(true);
    }
  }, [noSensor]);

  // ---- touch: hold a half to steer, the lock ramps up while you hold
  const dir = useRef(0);
  useEffect(() => {
    if (mode !== "touch") return;
    let raf = 0;
    let last = performance.now();
    let v = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const want = dir.current;
      const rate = dt / (want === 0 ? 0.1 : ENGINE_CAL.touchRampS);
      v += Math.max(-rate, Math.min(rate, want - v));
      if (want === 0 && Math.abs(v) < 0.01) v = 0;
      wheel.current = { steer: v, deg: v * W.rangeDeg };
      axes.set("steer", v);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      dir.current = 0;
    };
  }, [mode, axes]);

  const press = (name: "gas" | "brake" | "hand" | "left" | "right", on: boolean) => {
    if (name === "left" || name === "right") {
      const d = dir.current;
      const l = name === "left" ? on : d < 0;
      const r = name === "right" ? on : d > 0;
      dir.current = (r ? 1 : 0) - (l ? 1 : 0);
    } else {
      held.current[name] = on;
      axes.set(name, on ? 1 : 0);
      if (name === "hand" && on) send({ type: "gesture", name: "night-handbrake", data: { ms: ENGINE_CAL.handbrakeMs } });
    }
    setDown((d) => ({ ...d, [name]: on }));
    if (on) buzz(8);
  };
  const hold = (name: "gas" | "brake" | "hand" | "left" | "right") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      press(name, true);
    },
    onPointerUp: () => press(name, false),
    onPointerCancel: () => press(name, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const shift = (d: 1 | -1) => {
    send({ type: "gesture", name: "night-shift", data: { dir: d } });
    buzz(14);
  };
  const setAuto = (on: boolean) => send({ type: "gesture", name: "night-auto", data: { on } });
  const start = () => send({ type: "gesture", name: "night-again", data: {} });
  const recentre = () => {
    filter.current.recalibrate();
    buzz(20);
  };

  const gearLabel = view.phase === "ready" || view.phase === "count" ? "N" : String(view.gear + 1);
  const running = view.phase === "run";
  const low = running && view.time < 10;
  const driving = view.combo > 0;
  const head = (noSensor || (fellBack && mode === "touch" && view.phase === "ready"))
    ? { text: "No motion data", sub: "This phone isn't sending motion. Use the steer buttons.", warn: true }
    : wheelOn && !upright
      ? { text: "Hold it up", sub: "Upright, screen toward you, like a wheel.", warn: true }
      : !heard
        ? { text: "Waiting for the laptop…", sub: "", warn: false }
        : view.phase === "ready"
          ? { text: "Ready", sub: "Hold Gas to start.", warn: false }
          : view.phase === "count"
            ? { text: String(view.count || "Go"), sub: "Get set.", warn: false }
            : view.phase === "done"
              ? { text: grouped(view.score), sub: `${view.miles.toFixed(2)} mi · best drift ${grouped(view.best)}`, warn: false }
              : driving
                ? { text: `×${view.combo} · ${grouped(view.pending)}`, sub: "Straighten out to bank it.", warn: false }
                : { text: `Checkpoint ${Math.min(view.cp + 1, view.cps)} / ${view.cps}`, sub: view.auto ? "Lift or brake into a corner, flick for the handbrake." : "Shift with the paddles.", warn: false };

  const zone = (name: "gas" | "brake" | "hand" | "left" | "right", label: string, cls: string, testid: string) => (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={down[name]}
      className={`touch-none select-none rounded-[24px] text-[1.5rem] font-extrabold transition-colors active:scale-[0.99] ${cls} ${
        down[name] ? "bg-[var(--paper)] text-[var(--ink)]" : name === "gas" ? "bg-[var(--mint)] text-[var(--ink)]" : "bg-white/10 border border-white/15 text-[var(--paper)]"
      }`}
      {...hold(name)}
    >
      {label}
    </button>
  );

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto flex flex-col pb-2"
      data-testid="night-controller"
      data-mode={mode}
      data-phase={view.phase}
      data-gas={down.gas}
      data-brake={down.brake}
      data-hand={down.hand}
    >
      <p className="mt-1 hidden portrait:block rounded-[14px] bg-[#d9b44a]/15 border border-[#d9b44a]/40 px-3 py-2 text-[0.95rem] leading-snug text-[#f0dc9d]" data-testid="night-rotate">
        Turn the phone sideways and hold it like a steering wheel.
      </p>

      <div className="mt-2 flex-1 min-h-0 grid gap-2.5 grid-cols-[1fr_1.25fr_1fr] landscape:grid-cols-[1fr_1.35fr_1fr] landscape:grid-rows-[minmax(0,1fr)] portrait:grid-cols-2 portrait:grid-rows-[auto_1fr]">
        {/* the middle: the run, and the wheel */}
        <section
          aria-label="Run"
          data-testid="night-view"
          className="landscape:col-start-2 landscape:row-start-1 portrait:col-span-2 rounded-[22px] bg-white/10 border border-white/15 px-3 py-2 flex flex-col items-center justify-center text-center min-h-0"
        >
          <div className="flex items-baseline gap-4">
            <p className="text-[2.6rem] landscape:text-[2.3rem] leading-none font-extrabold tabular-nums" data-testid="night-speed">
              {Math.round(view.speed)}
              <span className="ml-1 text-[0.8rem] font-semibold text-[#a3a69c]">mph</span>
            </p>
            <p className={`font-mono text-[1.15rem] font-bold ${view.auto ? "text-[#a3a69c]" : "text-[#ffc24b]"}`} data-testid="night-gear">
              {view.auto ? "D" : "M"} {gearLabel}
            </p>
            <p className={`text-[1.7rem] leading-none font-extrabold tabular-nums ${low ? "text-[#ff6a55]" : ""}`} data-testid="night-time">
              {running || view.phase === "done" ? view.time.toFixed(1) : "–"}
              <span className="ml-0.5 text-[0.8rem] font-semibold text-[#a3a69c]">s</span>
            </p>
          </div>
          {wheelOn && <Wheel wheel={wheel} />}
          <div
            role="status"
            data-testid="night-status"
            className={`mt-1 w-full rounded-[14px] px-2 py-1.5 ${head.warn ? "bg-[#d9b44a]/15 border border-[#d9b44a]/40" : driving ? "bg-[var(--mint)] text-[var(--ink)]" : ""}`}
          >
            <p className="text-[1.25rem] leading-tight font-extrabold tabular-nums">{head.text}</p>
            {head.sub && <p className={`text-[0.85rem] leading-snug ${driving ? "text-[var(--ink)]/80" : "text-[#c9c6b6]"}`}>{head.sub}</p>}
          </div>
        </section>

        {/* left thumb */}
        <div className="landscape:col-start-1 landscape:row-start-1 portrait:row-start-2 flex flex-col gap-2.5 min-h-[190px] landscape:min-h-0">
          {mode === "touch" ? (
            <div className="flex-1 grid grid-cols-2 gap-2.5">
              {zone("left", "◀", "min-h-[120px] landscape:min-h-[56px]", "night-left")}
              {zone("right", "▶", "min-h-[120px] landscape:min-h-[56px]", "night-right")}
            </div>
          ) : (
            zone("brake", "Brake", "flex-1 min-h-[120px] landscape:min-h-[56px]", "night-brake")
          )}
          {mode === "touch" ? zone("brake", "Brake", "min-h-[56px] landscape:min-h-[44px] !text-[1.15rem]", "night-brake") : zone("hand", "Drift", "min-h-[56px] landscape:min-h-[44px] !text-[1.15rem]", "night-hand")}
        </div>

        {/* right thumb */}
        <div className="landscape:col-start-3 landscape:row-start-1 portrait:row-start-2 flex flex-col gap-2.5 min-h-[190px] landscape:min-h-0">
          {zone("gas", "Gas", "flex-1 min-h-[120px] landscape:min-h-[56px] !text-[2rem]", "night-gas")}
          {mode === "touch" ? zone("hand", "Drift", "min-h-[56px] landscape:min-h-[44px] !text-[1.15rem]", "night-hand") : view.phase === "ready" || view.phase === "done" ? (
            <button type="button" data-testid="night-start" onClick={start} className={`${ghostButton} !min-h-[56px] landscape:!min-h-[44px]`}>
              {view.phase === "done" ? "Drive again" : "Start"}
            </button>
          ) : (
            <button type="button" data-testid="night-recentre" onClick={recentre} disabled={!wheelOn} className={`${ghostButton} !min-h-[56px] landscape:!min-h-[44px] disabled:opacity-40`}>
              Reset middle
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 grid gap-2 grid-cols-[1fr_auto_auto] items-center" role="group" aria-label="Controls">
        <div className="grid grid-cols-2 gap-2">
          {(["wheel", "touch"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              data-mode-btn={m}
              disabled={m === "wheel" && !motionOk}
              onClick={() => {
                rest();
                setMode(m);
              }}
              className={`${ghostButton} !min-h-[44px] !py-1.5 !text-[1rem] ${mode === m ? "!bg-[var(--mint)] !text-[var(--ink)] !border-transparent" : ""} disabled:opacity-40`}
            >
              {m === "wheel" ? "Wheel" : "Touch"}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="night-auto"
          aria-pressed={!view.auto}
          onClick={() => setAuto(!view.auto)}
          className={`${ghostButton} !min-h-[44px] !w-auto !py-1.5 !text-[1rem] ${!view.auto ? "!bg-[#ffc24b] !text-[var(--ink)] !border-transparent" : ""}`}
        >
          {view.auto ? "Auto" : "Manual"}
        </button>
        {!view.auto ? (
          <div className="flex gap-2">
            <button type="button" data-testid="night-down" aria-label="Shift down" onClick={() => shift(-1)} className={`${ghostButton} !min-h-[44px] !w-14 !px-0 !py-1.5`}>
              −
            </button>
            <button type="button" data-testid="night-up" aria-label="Shift up" onClick={() => shift(1)} className={`${ghostButton} !min-h-[44px] !w-14 !px-0 !py-1.5`}>
              +
            </button>
          </div>
        ) : (
          <span />
        )}
      </div>
      {!motionOk && <p className="mt-1.5 text-[0.9rem] leading-snug text-[#a3a69c]">Motion is off on this phone, so the wheel isn&apos;t available. Reload this page and allow motion to turn it on.</p>}
    </div>
  );
}

/** A steering wheel that turns as the phone does. */
function Wheel({ wheel }: { wheel: React.MutableRefObject<{ steer: number; deg: number }> }) {
  const rim = useRef<SVGGElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = wheel.current;
      if (rim.current) rim.current.style.transform = `rotate(${Math.max(-90, Math.min(90, v.deg * 1.4))}deg)`;
      if (bar.current) {
        bar.current.style.width = `${Math.abs(v.steer) * 50}%`;
        bar.current.style.left = v.steer < 0 ? `${50 + v.steer * 50}%` : "50%";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [wheel]);
  return (
    <div className="mt-0.5 w-full" data-testid="night-wheel">
      <svg viewBox="-60 -40 120 80" className="mx-auto h-[68px] landscape:h-[46px] w-auto" aria-hidden="true">
        <g ref={rim} style={{ transformOrigin: "0px 0px", willChange: "transform" }}>
          <circle r="34" fill="none" stroke="rgba(242,234,215,0.85)" strokeWidth="7" />
          <path d="M-34 0 H34 M0 0 V34" stroke="rgba(242,234,215,0.85)" strokeWidth="6" strokeLinecap="round" />
          <rect x="-3" y="-38" width="6" height="12" rx="3" fill="#8ad9a8" />
        </g>
      </svg>
      <div className="relative h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
        <div ref={bar} className="absolute inset-y-0 rounded-full bg-[var(--mint)]" style={{ left: "50%", width: 0 }} />
      </div>
    </div>
  );
}
