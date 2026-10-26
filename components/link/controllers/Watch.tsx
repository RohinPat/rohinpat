"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createAxisSender } from "@/components/offhours/engineRemote";
import { WATCH_CAL, createCrownSender, createDetents, crownFromTwist } from "@/components/offhours/watchRemote";
import { createTwistFilter } from "@/lib/motion";
import type { MotionSample } from "@/lib/motion";
import { ghostButton } from "./Shell";
import type { ControllerProps } from "./types";
import { useMotionSamples } from "./useMotionSamples";

// The watch's controller: a crown. Twist: hold the phone upright, screen toward
// you, and turn it clockwise like winding a crown, then back and again (the
// watch only winds on the clockwise stroke, like a ratchet). Touch: the crown
// on screen turns under a thumb, in either mode. Each click of the crown buzzes
// the phone where the browser has a vibration motor.
//
// Sends   gesture crown        {deg}        crown degrees turned since the last one, clockwise +, 30 Hz at most
//         axis    explode      {v: 0..1}    the explode slider
//         gesture watch-flip   {}           turn the watch over
//         gesture watch-sync   {}           "tell me the reserve and settings" (on mount)
// Hears   gesture watch-state  {reserve, explode, flip}   power reserve 0..1 and the laptop's settings

type Mode = "twist" | "touch";

const buzz = (ms: number) => {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    /* no haptics here */
  }
};

export default function WatchController({ send, subscribe, motionOk }: ControllerProps) {
  const [mode, setMode] = useState<Mode>(motionOk ? "twist" : "touch");
  const [reserve, setReserve] = useState<number | null>(null);
  const [explode, setExplode] = useState(0);
  const [flip, setFlip] = useState(false);

  const sendRef = useRef(send);
  sendRef.current = send;
  const crownEl = useRef<HTMLDivElement>(null);
  const turned = useRef(0);
  const dragging = useRef(false);
  const sliding = useRef(false);
  const reserveRef = useRef<number | null>(null);
  const detents = useRef(createDetents());
  const out = useRef(createCrownSender((deg) => sendRef.current({ type: "gesture", name: "crown", data: { deg } })));
  const explodeOut = useRef(createAxisSender((v) => sendRef.current({ type: "axis", name: "explode", v })));

  // the laptop says its reserve and settings; ask once on mount
  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture" || m.name !== "watch-state") return;
      const r = Number(m.data?.reserve);
      if (Number.isFinite(r)) {
        reserveRef.current = Math.max(0, Math.min(1, r));
        setReserve(reserveRef.current);
      }
      const x = Number(m.data?.explode);
      // while the slider is under a thumb it is the phone that knows
      if (Number.isFinite(x) && !sliding.current) setExplode(Math.max(0, Math.min(1, x)));
      setFlip(m.data?.flip === true);
    });
    send({ type: "gesture", name: "watch-sync", data: {} });
    return off;
  }, [send, subscribe]);

  /** the crown turned `deg` crown degrees: spin it on screen, click it, and tell the laptop */
  const turn = useCallback((deg: number) => {
    turned.current += deg;
    if (crownEl.current) crownEl.current.style.transform = `rotate(${turned.current.toFixed(1)}deg)`;
    const full = (reserveRef.current ?? 0) >= 0.995;
    const clicks = detents.current.add(deg);
    if (clicks > 0 && !full) buzz(WATCH_CAL.buzzMs);
    out.current.add(deg);
  }, []);

  // ---- twist mode: the recogniser, only while this mode is up ----
  const twistOn = mode === "twist" && motionOk;
  const twist = useRef(createTwistFilter({ invert: true })); // clockwise = wind
  const lastT = useRef<number | null>(null);
  const settle = useRef(0);
  useEffect(() => {
    twist.current.reset();
    lastT.current = null;
    const o = out.current;
    return () => {
      window.clearTimeout(settle.current);
      o.flush();
    };
  }, [twistOn]);
  const onSample = useCallback(
    (s: MotionSample) => {
      const dt = lastT.current === null ? 0.016 : Math.min(0.1, Math.max(0.001, s.t - lastT.current));
      lastT.current = s.t;
      const st = twist.current.push(s);
      if (st.omega !== 0 && !dragging.current) turn(crownFromTwist((st.omega * dt * 180) / Math.PI));
      else out.current.flush();
      // the last move before the wrist stops must still get out
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => out.current.flush(), 1000 / WATCH_CAL.sendHz + 20);
    },
    [turn],
  );
  const { receiving } = useMotionSamples(twistOn, onSample);
  const noSensor = mode === "twist" && motionOk && receiving === false;

  // ---- the crown under a thumb ----
  const lastA = useRef<number | null>(null);
  const angle = (e: React.PointerEvent) => {
    const b = e.currentTarget.getBoundingClientRect();
    return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
  };
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastA.current = angle(e);
    dragging.current = true;
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lastA.current === null) return;
    const a = angle(e);
    let d = a - lastA.current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    lastA.current = a;
    turn((d * 180) / Math.PI);
  };
  const up = () => {
    lastA.current = null;
    dragging.current = false;
    out.current.flush();
  };

  const full = reserve !== null && reserve >= 0.995;
  const stopped = reserve !== null && reserve <= 0;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-testid="watch-controller" data-mode={mode} data-reserve={reserve === null ? "" : Math.round(reserve * 100)}>
      <h1 className="mt-3 text-[1.45rem] leading-tight font-extrabold text-balance">{mode === "twist" ? "Twist to wind the crown." : "Turn the crown to wind."}</h1>
      <p className="mt-1 text-[1rem] leading-snug text-[#c9c6b6]">
        {mode === "twist"
          ? "Upright, screen toward you. Turn clockwise, back, and again. Or use your thumb on the crown."
          : "Drag round the crown clockwise, like winding a real one."}
      </p>

      <div className="mt-4 flex justify-center">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Crown. Drag it round clockwise to wind the watch."
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((reserve ?? 0) * 100)}
          aria-valuetext={reserve === null ? "Power reserve unknown" : `Power reserve ${Math.round(reserve * 100)} percent`}
          data-testid="watch-crown"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === " ") {
              e.preventDefault();
              turn(WATCH_CAL.detentDeg * 3);
              out.current.flush();
            }
          }}
          className="relative w-[200px] h-[200px] rounded-full touch-none select-none outline-offset-4"
          style={{ background: "radial-gradient(circle at 35% 30%, #f4f2ec, #8f8b83 70%)", boxShadow: "inset 0 -10px 20px rgba(0,0,0,0.35), 0 16px 30px -10px rgba(0,0,0,0.6)" }}
        >
          <div
            ref={crownEl}
            className="absolute inset-0 rounded-full"
            style={{
              background: "repeating-conic-gradient(#6f6b63 0 4deg, #d9d6cf 4deg 9deg)",
              maskImage: "radial-gradient(circle, transparent 62%, black 63%)",
              WebkitMaskImage: "radial-gradient(circle, transparent 62%, black 63%)",
            }}
          />
          <span className="absolute inset-0 grid place-items-center font-mono text-[13px] uppercase tracking-[0.18em] text-[#0d100e]">Wind ↻</span>
        </div>
      </div>

      <section aria-label="Power reserve" className="mt-5" data-testid="watch-reserve">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#a3a69c]">Power reserve</h2>
          <p className="text-[1.05rem] font-bold tabular-nums">{reserve === null ? "–" : `${Math.round(reserve * 100)}%`}</p>
        </div>
        <div className="mt-2 h-3 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
          <div className="h-full rounded-full bg-[var(--mint)] transition-[width] duration-150" style={{ width: `${(reserve ?? 0) * 100}%` }} />
        </div>
        <p role="status" data-testid="watch-line" className="mt-2 text-[1rem] text-[#c9c6b6]">
          {reserve === null ? "Waiting for the watch…" : stopped ? "Stopped. Wind it." : full ? "Fully wound." : "Ticking. Keep winding."}
        </p>
      </section>

      {noSensor && (
        <p role="status" data-testid="watch-note" className="mt-3 rounded-[14px] bg-[#d9b44a]/15 border border-[#d9b44a]/40 px-3.5 py-2.5 text-[1rem] text-[#f0dc9d]">
          This phone isn&apos;t sending motion. Turn the crown with your thumb instead.
        </p>
      )}

      <label className="mt-5 block font-mono text-[12px] uppercase tracking-[0.18em] text-[#a3a69c]">
        Explode
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(explode * 100)}
          data-testid="watch-explode"
          onPointerDown={() => (sliding.current = true)}
          onPointerUp={() => {
            sliding.current = false;
            explodeOut.current.flush(explode);
          }}
          onPointerCancel={() => (sliding.current = false)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setExplode(v);
            explodeOut.current.push(v);
            // a keyboard or assistive change has no pointer-up
            if (!sliding.current) explodeOut.current.flush(v);
          }}
          className="mt-2 block w-full h-10 accent-[#8ad9a8]"
        />
      </label>

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
        <button
          type="button"
          data-testid="watch-flip"
          aria-pressed={flip}
          onClick={() => {
            setFlip((f) => !f);
            send({ type: "gesture", name: "watch-flip", data: {} });
          }}
          className={`${ghostButton} !min-h-[52px] ${flip ? "!bg-[var(--paper)] !text-[var(--ink)] !border-transparent" : ""}`}
        >
          Flip
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
