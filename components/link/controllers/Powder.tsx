"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POWDER_CAL } from "@/components/offhours/ski/remoteSteer";
import { createWheelFilter } from "@/lib/motion";
import type { MotionSample } from "@/lib/motion";
import { createAxes } from "./axes";
import { ghostButton } from "./Shell";
import type { ControllerProps } from "./types";
import { useMotionSamples } from "./useMotionSamples";

// The slalom's controller. Handlebars: hold the phone upright with both hands,
// screen toward you, landscape (portrait works too), and turn it like a
// steering wheel: clockwise carves right. Lean the top edge away from you, like
// crouching over the bars, to tuck; or hold the big TUCK button with a thumb,
// which does the same and always works. It re-centres to however you hold it
// when it opens, from the button, and by itself if the wheel sits past 60
// degrees for over a second (you turned the phone to landscape after opening).
// Only the wheel filter runs. Touch: hold the left or right half of the screen
// to carve, for a phone without motion sensors (or one that said no).
//
// Sends   axis    steer  -1..1   (+ = right)
//         axis    tuck    0..1
//         gesture powder-start {}                       drop in / go again / restart
//         gesture powder-sync  {}                       "tell me the phase" (on mount)
// Hears   gesture powder-state {phase, total, medal}    ready | count | run | result

type Mode = "bars" | "touch";
type Phase = "ready" | "count" | "run" | "result";
type Laptop = { phase: Phase; total: number; medal: number };

const MEDALS = ["", "Gold", "Silver", "Bronze"];
const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
};

export default function PowderController({ send, subscribe, motionOk }: ControllerProps) {
  const [mode, setMode] = useState<Mode>(motionOk ? "bars" : "touch");
  const [laptop, setLaptop] = useState<Laptop>({ phase: "ready", total: 0, medal: 0 });
  const [upright, setUpright] = useState(true);
  const [fed, setFed] = useState(false);
  const [tucking, setTucking] = useState(false);

  const sendRef = useRef(send);
  sendRef.current = send;
  const axes = useMemo(() => createAxes((m) => sendRef.current(m), ["steer", "tuck"], { step: 0.02 }), []);
  // what the gauges draw, and what the two inputs each want for the tuck
  const view = useRef({ steer: 0, wheelDeg: 0, tuck: 0 });
  const held = useRef(false);
  const lean = useRef(0);
  const pushTuck = useCallback(() => {
    const v = held.current ? 1 : lean.current;
    view.current.tuck = v;
    axes.set("tuck", v);
  }, [axes]);
  const pushSteer = useCallback(
    (steer: number, wheelDeg: number) => {
      view.current.steer = steer;
      view.current.wheelDeg = wheelDeg;
      axes.set("steer", steer);
    },
    [axes],
  );

  // the laptop says which phase the run is in, and how it ended
  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture" || m.name !== "powder-state") return;
      const phase = m.data?.phase;
      if (phase === "ready" || phase === "count" || phase === "run" || phase === "result") {
        setLaptop({ phase, total: Number(m.data?.total) || 0, medal: Number(m.data?.medal) || 0 });
      }
    });
    send({ type: "gesture", name: "powder-sync", data: {} });
    return off;
  }, [send, subscribe]);

  // leave the skier straight and upright when this screen goes away or is backgrounded
  const rest = useCallback(() => {
    held.current = false;
    lean.current = 0;
    setTucking(false);
    pushSteer(0, 0);
    pushTuck();
    axes.zero();
  }, [axes, pushSteer, pushTuck]);
  useEffect(() => {
    const hide = () => document.hidden && rest();
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      axes.zero();
      axes.dispose();
    };
  }, [axes, rest]);

  // ---- handlebar mode: the filter, only while this mode is up ----
  const barsOn = mode === "bars" && motionOk;
  const filter = useRef(
    createWheelFilter({
      maxAngleDeg: POWDER_CAL.steerRangeDeg,
      deadZoneDeg: POWDER_CAL.steerDeadDeg,
      tuckRangeDeg: POWDER_CAL.tuckRangeDeg,
      tuckDeadDeg: POWDER_CAL.tuckDeadDeg,
      smoothingS: POWDER_CAL.phoneSmoothingS,
    }),
  );
  const far = useRef<number | null>(null);
  useEffect(() => {
    filter.current.reset(); // the pose it opens in (or comes back to) is straight ahead
    far.current = null;
    rest();
  }, [barsOn, rest]);
  const uprightRef = useRef(true);
  const onSample = useCallback(
    (s: MotionSample) => {
      const st = filter.current.push(s);
      setFed(true);
      if (st.valid !== uprightRef.current) {
        uprightRef.current = st.valid;
        setUpright(st.valid);
      }
      if (!st.valid) {
        lean.current = 0;
        pushSteer(0, 0);
        return pushTuck();
      }
      // turned the phone to another orientation after opening: the wheel sits far
      // past full lock; take the pose it settles in as straight ahead
      if (Math.abs(st.wheelDeg) >= POWDER_CAL.autoRecentreDeg) {
        far.current ??= s.t;
        if (s.t - far.current >= POWDER_CAL.autoRecentreS) {
          filter.current.recalibrate();
          far.current = null;
        }
      } else far.current = null;
      lean.current = st.tuck;
      pushSteer(st.steer, st.wheelDeg);
      pushTuck();
    },
    [pushSteer, pushTuck],
  );
  const { receiving } = useMotionSamples(barsOn, onSample);
  const noSensor = mode === "bars" && motionOk && receiving === false && !fed;

  // ---- touch mode: hold a half to carve; the lock ramps up while you hold ----
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
      // grow over touchRampS, let go quickly
      const rate = dt / (want === 0 ? 0.12 : POWDER_CAL.touchRampS);
      v += Math.max(-rate, Math.min(rate, want - v));
      if (want === 0 && Math.abs(v) < 0.01) v = 0;
      pushSteer(v, v * POWDER_CAL.steerRangeDeg);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      dir.current = 0;
    };
  }, [mode, pushSteer]);

  const recentre = () => {
    filter.current.recalibrate();
    try {
      navigator.vibrate?.(20);
    } catch {
      /* no haptics here */
    }
  };
  const start = () => send({ type: "gesture", name: "powder-start", data: {} });
  const hold = (on: boolean) => {
    held.current = on;
    setTucking(on);
    pushTuck();
  };

  const racing = laptop.phase === "run";
  const result = laptop.phase === "result";
  const head = noSensor
    ? { text: "No motion data", sub: "This phone isn't sending motion. Use Touch instead.", warn: true }
    : barsOn && !upright
      ? { text: "Hold it up", sub: "Upright, screen toward you, like handlebars.", warn: true }
      : laptop.phase === "count"
        ? { text: "Get set…", sub: "Tuck for the start.", warn: false }
        : racing
          ? { text: "Carve!", sub: mode === "bars" ? "Turn the bars. Lean in on the straights." : "Hold a side to carve. Hold TUCK on the straights.", warn: false }
          : result
            ? { text: `${fmt(laptop.total)}${laptop.medal ? ` · ${MEDALS[laptop.medal]}` : ""}`, sub: "Go again to beat it.", warn: false }
            : { text: "Ready", sub: "Drop in when you are set.", warn: false };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-testid="powder-controller" data-mode={mode} data-phase={laptop.phase} data-tuck={tucking}>
      <div className="landscape:grid landscape:grid-cols-2 landscape:gap-x-4">
        <div>
          <h1 className="mt-3 text-[1.45rem] landscape:hidden leading-tight font-extrabold text-balance">{mode === "bars" ? "Hold it like handlebars." : "Hold a side to carve."}</h1>
          <p className="mt-1.5 text-[1.05rem] landscape:hidden leading-snug text-[#c9c6b6]">
            {mode === "bars"
              ? "Upright, both hands, screen toward you. Turn it like a wheel to carve; lean the top edge away to tuck."
              : "Left half carves left, right half carves right. Hold TUCK on the straights."}
          </p>

          {mode === "bars" ? <Bars view={view} /> : <TouchHalves dir={dir} />}
        </div>

        <div>
          <div
            role="status"
            data-testid="powder-status"
            className={`mt-3 landscape:mt-3 rounded-[20px] px-5 py-3.5 landscape:py-2.5 text-center border ${
              head.warn ? "bg-[#d9b44a]/15 border-[#d9b44a]/40" : result && laptop.medal ? "bg-[var(--mint)] text-[var(--ink)] border-transparent" : "bg-white/10 border-white/15"
            }`}
          >
            <p className="text-[1.5rem] leading-none font-extrabold">{head.text}</p>
            <p className={`mt-1.5 text-[1rem] ${result && laptop.medal ? "text-[var(--ink)]/80" : "text-[#c9c6b6]"}`}>{head.sub}</p>
          </div>

          <button
            type="button"
            data-testid="powder-tuck"
            aria-pressed={tucking}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              hold(true);
            }}
            onPointerUp={() => hold(false)}
            onPointerCancel={() => hold(false)}
            onContextMenu={(e) => e.preventDefault()}
            className={`mt-3 w-full min-h-[84px] landscape:min-h-[64px] rounded-[24px] text-[1.5rem] font-extrabold touch-none select-none transition-colors active:scale-[0.99] ${
              tucking ? "bg-[var(--paper)] text-[var(--ink)]" : "bg-[var(--mint)] text-[var(--ink)]"
            }`}
          >
            {tucking ? "Tucked" : "Hold to tuck"}
          </button>

          <div className="mt-3 landscape:mt-2 grid grid-cols-2 gap-2">
            <button type="button" data-testid="powder-start" onClick={start} disabled={laptop.phase === "count"} className={`${ghostButton} !min-h-[56px] disabled:opacity-40`}>
              {laptop.phase === "ready" ? "Drop in" : result ? "Go again" : racing ? "Restart" : "Starting…"}
            </button>
            <button type="button" data-testid="powder-recentre" onClick={recentre} disabled={!barsOn} className={`${ghostButton} !min-h-[56px] disabled:opacity-40`}>
              Reset middle
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Control">
            {(["bars", "touch"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                data-mode-btn={m}
                disabled={m === "bars" && !motionOk}
                onClick={() => setMode(m)}
                className={`${ghostButton} !min-h-[52px] ${mode === m ? "!bg-[var(--mint)] !text-[var(--ink)] !border-transparent" : ""} disabled:opacity-40`}
              >
                {m === "bars" ? "Handlebars" : "Touch"}
              </button>
            ))}
          </div>
          {!motionOk && (
            <p className="mt-2 text-[0.95rem] leading-snug text-[#a3a69c]">Motion is off on this phone, so the handlebars aren&apos;t available. Reload this page and allow motion to turn it on.</p>
          )}
        </div>
      </div>
    </div>
  );
}

type View = React.MutableRefObject<{ steer: number; wheelDeg: number; tuck: number }>;

/** The bars: a handlebar that turns with the phone, a lock arrow, and the tuck lean. */
function Bars({ view }: { view: View }) {
  const bar = useRef<HTMLDivElement>(null);
  const lock = useRef<HTMLDivElement>(null);
  const tuck = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = view.current;
      if (bar.current) bar.current.style.transform = `rotate(${Math.max(-40, Math.min(40, v.wheelDeg))}deg)`;
      if (lock.current) {
        const s = v.steer;
        lock.current.style.width = `${Math.abs(s) * 50}%`;
        lock.current.style.left = s < 0 ? `${50 + s * 50}%` : "50%";
      }
      if (tuck.current) tuck.current.style.width = `${Math.round(v.tuck * 100)}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view]);

  return (
    <div className="mt-4 landscape:mt-3" data-testid="powder-bars">
      <div className="relative mx-auto h-[132px] landscape:h-[120px] w-full max-w-[320px] flex items-center justify-center" aria-hidden="true">
        <div ref={bar} className="relative h-6 w-[56%] landscape:w-[48%] rounded-full bg-white/20 border border-white/25" style={{ willChange: "transform" }}>
          <span className="absolute -left-2 -top-2 h-10 w-5 rounded-[10px] bg-[var(--paper)]" />
          <span className="absolute -right-2 -top-2 h-10 w-5 rounded-[10px] bg-[var(--paper)]" />
          <span className="absolute left-1/2 -top-2 h-10 w-1 -translate-x-1/2 rounded-full bg-[var(--mint)]" />
        </div>
      </div>
      <div className="mt-1 relative h-3 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
        <div ref={lock} className="absolute inset-y-0 rounded-full bg-[var(--mint)]" style={{ left: "50%", width: 0 }} />
      </div>
      <div className="mt-1.5 flex items-center gap-2" aria-hidden="true">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a69c] w-10">Tuck</span>
        <div className="h-2 flex-1 rounded-full bg-white/10 overflow-hidden">
          <div ref={tuck} className="h-full rounded-full bg-[var(--paper)]" style={{ width: 0 }} />
        </div>
      </div>
    </div>
  );
}

/** Two big halves: hold one to carve that way. Both held = straight. `dir` is read by the controller each frame. */
function TouchHalves({ dir }: { dir: React.MutableRefObject<number> }) {
  const down = useRef({ left: false, right: false });
  const [pressed, setPressed] = useState({ left: false, right: false });
  const set = (side: "left" | "right", on: boolean) => {
    down.current[side] = on;
    dir.current = (down.current.right ? 1 : 0) - (down.current.left ? 1 : 0);
    setPressed({ ...down.current });
  };
  const half = (side: "left" | "right") => (
    <button
      type="button"
      data-testid={`powder-${side}`}
      aria-pressed={pressed[side]}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(side, true);
      }}
      onPointerUp={() => set(side, false)}
      onPointerCancel={() => set(side, false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`min-h-[190px] landscape:min-h-[120px] rounded-[24px] border text-[1.3rem] font-extrabold touch-none select-none transition-colors ${
        pressed[side] ? "bg-[var(--paper)] text-[var(--ink)] border-transparent" : "bg-white/10 border-white/15 text-[var(--paper)]"
      }`}
    >
      {side === "left" ? "◀ Left" : "Right ▶"}
    </button>
  );
  return (
    <div className="mt-4 landscape:mt-3 grid grid-cols-2 gap-2.5" role="group" aria-label="Carve">
      {half("left")}
      {half("right")}
    </div>
  );
}
