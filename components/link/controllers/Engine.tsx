"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ENGINE_CAL, IDLE_VIEW, createAxisSender, createThrottleTrack, parseEngineState, type EngineView } from "@/components/offhours/engineRemote";
import { createFlickDetector, createTwistFilter } from "@/lib/motion";
import type { MotionSample } from "@/lib/motion";
import { ghostButton } from "./Shell";
import type { ControllerProps } from "./types";
import { useMotionSamples } from "./useMotionSamples";

// The race dash's controller. Twist: hold the phone upright, screen toward you,
// and turn it clockwise like a motorbike grip to open the throttle, back to
// close it; flick it up (or tap Shift) to change gear. Only the twist and flick
// recognisers run. Touch: a throttle lever under the thumb, for a phone without
// motion sensors (or one that said no). The shift button is always there.
//
// Sends   axis    throttle      {v: 0..1}      where the grip is, on change, 30 Hz at most
//         gesture engine-shift  {}             change up
//         gesture engine-again  {}             run again, once the quarter mile is done
//         gesture engine-sync   {}             "tell me the revs and gear" (on mount)
// Hears   gesture engine-state  {rpm, gear, phase, shift, call, time}   ten times a second at most

type Mode = "twist" | "touch";

const buzz = (ms: number | number[]) => {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    /* no haptics here */
  }
};

const PHASE_LINE: Record<string, string> = {
  idle: "Hold the throttle to stage.",
  tree: "Staged. Launch between 3.2k and 6.5k.",
  run: "Go. Shift when the light comes on.",
};

export default function EngineController({ send, subscribe, motionOk }: ControllerProps) {
  const [mode, setMode] = useState<Mode>(motionOk ? "twist" : "touch");
  const [throttle, setThrottle] = useState(0);
  const [view, setView] = useState<EngineView>(IDLE_VIEW);
  const [heard, setHeard] = useState(false);
  const [shifted, setShifted] = useState(0);

  const sendRef = useRef(send);
  sendRef.current = send;
  const axis = useRef(createAxisSender((v) => sendRef.current({ type: "axis", name: "throttle", v })));
  const track = useRef(createThrottleTrack());
  const shown = useRef(0);

  const setPos = useCallback((v: number, flush = false) => {
    if (Math.abs(v - shown.current) >= 0.01 || v === 0 || v === 1) {
      shown.current = v;
      setThrottle(v);
    }
    if (flush) axis.current.flush(v);
    else axis.current.push(v);
  }, []);

  // the dash says where it is; ask once on mount
  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture" || m.name !== "engine-state") return;
      const v = parseEngineState(m.data);
      if (v) {
        setView(v);
        setHeard(true);
      }
    });
    send({ type: "gesture", name: "engine-sync", data: {} });
    return off;
  }, [send, subscribe]);

  // the shift light coming on: one firm buzz
  useEffect(() => {
    if (view.shift) buzz(30);
  }, [view.shift]);

  const shift = useCallback(() => {
    send({ type: "gesture", name: "engine-shift", data: {} });
    setShifted((n) => n + 1);
    buzz(25);
  }, [send]);

  // ---- twist mode: the recognisers, only while this mode is up ----
  const twistOn = mode === "twist" && motionOk;
  const twist = useRef(createTwistFilter({ invert: true })); // clockwise = open
  const flick = useRef(createFlickDetector());
  const lastT = useRef<number | null>(null);
  const settle = useRef(0);
  const idle = useCallback(() => {
    twist.current.reset();
    track.current.zero();
    setPos(0, true);
  }, [setPos]);
  useEffect(() => {
    // a fresh start: throttle closed, whatever the grip was doing
    flick.current.reset();
    lastT.current = null;
    idle();
  }, [twistOn, idle]);
  // leaving the controller (Back) closes the throttle for the dash
  useEffect(
    () => () => {
      window.clearTimeout(settle.current);
      axis.current.flush(0);
    },
    [],
  );
  const onSample = useCallback(
    (s: MotionSample) => {
      const dt = lastT.current === null ? 0.016 : Math.min(0.1, Math.max(0.001, s.t - lastT.current));
      lastT.current = s.t;
      const st = twist.current.push(s);
      setPos(track.current.push(st.omega, dt));
      // the last move before the wrist stops must still get out
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => axis.current.flush(track.current.value()), 1000 / ENGINE_CAL.sendHz + 20);
      for (const o of flick.current.push(s)) if (o.kind === "event") shift();
    },
    [setPos, shift],
  );
  const { receiving } = useMotionSamples(twistOn, onSample);
  const noSensor = mode === "twist" && motionOk && receiving === false;

  const pct = Math.round(throttle * 100);
  const live = twistOn && receiving !== false;
  const onShift = view.shift && view.phase === "run";
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-testid="engine-controller" data-mode={mode} data-throttle={pct}>
      <h1 className="mt-3 text-[1.45rem] leading-tight font-extrabold text-balance">{mode === "twist" ? "Twist it like a throttle grip." : "Slide to rev."}</h1>
      <p className="mt-1 text-[1rem] leading-snug text-[#c9c6b6]">
        {mode === "twist"
          ? "Upright, screen toward you. Clockwise opens it, back eases off. Flick up or tap Shift."
          : "Drag the bar right to open it, left to close it. It stays where you leave it."}
      </p>

      <ThrottleBar value={throttle} live={live} noSensor={noSensor} onChange={mode === "touch" || noSensor ? (v, end) => setPos(v, end) : undefined} />
      {noSensor && (
        <p role="status" data-testid="engine-note" className="mt-2 rounded-[14px] bg-[#d9b44a]/15 border border-[#d9b44a]/40 px-3.5 py-2.5 text-[1rem] text-[#f0dc9d]">
          This phone isn&apos;t sending motion. Drag the bar instead.
        </p>
      )}

      <section aria-label="Engine" className="mt-3 grid grid-cols-3 gap-2 text-center" data-testid="engine-view" data-phase={view.phase} data-shift={onShift}>
        <Stat label="Gear" value={view.phase === "run" || view.phase === "done" ? String(view.gear + 1) : "N"} />
        <Stat label="RPM" value={heard ? String(Math.round(view.rpm / 100) / 10) : "–"} unit="×1000" />
        <Stat label={view.phase === "done" ? "Time" : "Call"} value={view.phase === "done" ? `${view.time.toFixed(2)}s` : view.call ? view.call.split(" ")[0] : "–"} small={view.phase !== "done" && view.call.length > 6} />
      </section>
      <p role="status" data-testid="engine-line" className="mt-2 text-center text-[1rem] text-[#c9c6b6]">
        {!heard ? "Waiting for the dash…" : view.phase === "done" ? "Quarter mile done." : (PHASE_LINE[view.phase] ?? "")}
      </p>

      <button
        type="button"
        data-testid="engine-shift"
        data-shifted={shifted}
        onClick={shift}
        className={`mt-2 w-full min-h-[112px] rounded-[24px] text-[1.6rem] font-extrabold select-none touch-none active:scale-[0.99] transition-colors ${
          onShift ? "bg-[var(--mint)] text-[var(--ink)] animate-pulse" : "bg-[var(--paper)] text-[var(--ink)]"
        }`}
      >
        {onShift ? "SHIFT NOW" : "Shift ↑"}
      </button>

      {view.phase === "done" && (
        <button type="button" data-testid="engine-again" onClick={() => send({ type: "gesture", name: "engine-again", data: {} })} className="mt-3 w-full min-h-[64px] rounded-[20px] bg-[var(--mint)] text-[var(--ink)] text-[1.25rem] font-bold active:scale-[0.98] transition-transform">
          Run again
        </button>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Control">
        {(["twist", "touch"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            data-mode-btn={m}
            disabled={m === "twist" && !motionOk}
            onClick={() => setMode(m)}
            className={`${ghostButton} !min-h-[52px] ${mode === m ? "!bg-[var(--mint)] !text-[var(--ink)] !border-transparent" : ""} disabled:opacity-40`}
          >
            {m === "twist" ? "Twist" : "Touch"}
          </button>
        ))}
        <button type="button" data-testid="engine-idle" onClick={idle} className={`${ghostButton} !min-h-[52px]`}>
          Idle
        </button>
      </div>
      {!motionOk && (
        <p className="mt-2 text-[0.95rem] leading-snug text-[#a3a69c]">
          Motion is off on this phone, so twisting isn&apos;t available. Reload this page and allow motion to turn it on.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, unit = "", small }: { label: string; value: string; unit?: string; small?: boolean }) {
  return (
    <div className="rounded-[16px] bg-white/10 border border-white/15 px-2 py-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a69c]">{label}</p>
      <p className={`mt-1 leading-none font-extrabold tabular-nums ${small ? "text-[1rem] h-[1.35rem] flex items-center justify-center" : "text-[1.35rem]"}`}>{value}</p>
      <p className="mt-1 text-[12px] text-[#a3a69c] h-[1em]">{unit}</p>
    </div>
  );
}

/** The throttle position. With `onChange` it is the touch lever (drag across it); without, it only shows the twist. */
function ThrottleBar({ value, live, noSensor, onChange }: { value: number; live: boolean; noSensor: boolean; onChange?: (v: number, end: boolean) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const at = (e: React.PointerEvent) => {
    const b = el.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - b.left) / b.width));
  };
  const pct = Math.round(value * 100);
  return (
    <div className="mt-3">
      <div
        ref={el}
        role={onChange ? "slider" : "meter"}
        aria-label="Throttle"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        data-testid="engine-throttle"
        tabIndex={onChange ? 0 : -1}
        onPointerDown={
          onChange
            ? (e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = true;
                onChange(at(e), false);
              }
            : undefined
        }
        onPointerMove={onChange ? (e) => drag.current && onChange(at(e), false) : undefined}
        onPointerUp={
          onChange
            ? (e) => {
                if (!drag.current) return;
                drag.current = false;
                onChange(at(e), true);
              }
            : undefined
        }
        onPointerCancel={onChange ? () => (drag.current = false) : undefined}
        onKeyDown={
          onChange
            ? (e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(1, value + 0.1), true);
                else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(0, value - 0.1), true);
              }
            : undefined
        }
        className={`relative h-[72px] rounded-[24px] overflow-hidden border select-none ${onChange ? "touch-none" : ""} ${
          noSensor ? "bg-[#d9b44a]/15 border-[#d9b44a]/40" : "bg-white/10 border-white/15"
        }`}
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: value > 0.92 ? "#e5604a" : "var(--mint)", opacity: live || onChange ? 1 : 0.5 }} />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a69c]" aria-hidden="true">
        <span>Idle</span>
        <span className="text-[1.5rem] leading-none font-extrabold tracking-normal text-[var(--paper)] tabular-nums font-sans">{pct}%</span>
        <span>Full</span>
      </div>
    </div>
  );
}
