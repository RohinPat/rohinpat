"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DECKS_CAL, OMEGA, angleDelta } from "@/components/offhours/decksRemote";
import { mono } from "@/components/offhours/font";
import { useCanvas } from "@/components/offhours/useCanvas";
import { createTwistFilter } from "@/lib/motion";
import type { MotionSample } from "@/lib/motion";
import { ghostButton } from "./Shell";
import type { ControllerProps } from "./types";
import { useMotionSamples } from "./useMotionSamples";

// The music board's controller: this phone is the turntable's platter. Put a
// finger on the record and go round in circles to scratch it; the laptop plays
// the beat at whatever speed your hand turns the record, backwards too. Play
// starts and brakes the deck, and Cut (hold) cuts the sound like the fader.
// Twist is the other way to scratch, for a phone with motion sensors: hold the
// record still with a finger and turn the phone like a record under your hand.
//
// Sends   axis    scratch {v}            the hand's angular velocity on the record, rad/s, clockwise +
//         gesture decks-grab {on}        a hand on / off the record
//         gesture decks-play {on}        the deck on / off
//         gesture decks-cut {on}         the fader held / let go
//         gesture decks-sync {}          "tell me if it's playing" (on mount)
// Hears   gesture decks-run {on}         the laptop's deck is running (play button, space bar)

type Mode = "finger" | "twist";

export default function DecksController({ send, subscribe, motionOk }: ControllerProps) {
  const [mode, setMode] = useState<Mode>("finger");
  const [running, setRunning] = useState(false);
  const [cut, setCut] = useState(false);
  const [held, setHeld] = useState(false);
  const [twistFailed, setTwistFailed] = useState(false);

  // the laptop says whether its deck is running
  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type === "gesture" && m.name === "decks-run") setRunning(!!m.data?.on);
    });
    send({ type: "gesture", name: "decks-sync", data: {} });
    return off;
  }, [send, subscribe]);

  const S = useRef({
    mode: "finger" as Mode,
    running: false,
    angle: 0,
    rate: 0,
    grab: false,
    finger: 0,
    acc: 0, // radians the finger has gone round since the last send
    twistV: 0,
    v: 0, // smoothed hand speed, rad/s
    sent: 0,
    lastSend: 0,
    timer: 0,
    arm: 0,
  });
  S.current.mode = mode;
  S.current.running = running;
  const box = useRef({ cx: 0, cy: 0, r: 0 });

  // ---- sending the hand's speed: on change, at most sendHz, and a zero when it stops ----
  const sendNow = useCallback(() => {
    const s = S.current;
    const now = performance.now();
    const dt = Math.max(0.001, (now - s.lastSend) / 1000);
    s.lastSend = now;
    const raw = s.mode === "twist" ? s.twistV : s.acc / dt;
    s.acc = 0;
    s.v += (raw - s.v) * DECKS_CAL.smooth;
    const v = Math.abs(s.v) < 0.02 ? 0 : Math.round(s.v * 100) / 100;
    if (Math.abs(v - s.sent) > 0.05 || (v === 0 && s.sent !== 0)) {
      s.sent = v;
      send({ type: "axis", name: "scratch", v });
    }
  }, [send]);

  const release = useCallback(() => {
    const s = S.current;
    if (!s.grab) return;
    s.grab = false;
    window.clearInterval(s.timer);
    s.v = 0;
    s.acc = 0;
    if (s.sent !== 0) send({ type: "axis", name: "scratch", v: 0 });
    s.sent = 0;
    send({ type: "gesture", name: "decks-grab", data: { on: false } });
    setHeld(false);
  }, [send]);

  const grab = useCallback(
    (fingerAngle: number) => {
      const s = S.current;
      s.grab = true;
      s.finger = fingerAngle;
      s.acc = 0;
      s.v = 0;
      s.sent = 0;
      s.twistV = 0;
      s.lastSend = performance.now();
      send({ type: "gesture", name: "decks-grab", data: { on: true } });
      window.clearInterval(s.timer);
      s.timer = window.setInterval(sendNow, 1000 / DECKS_CAL.sendHz);
      setHeld(true);
      try {
        navigator.vibrate?.(12);
      } catch {
        /* no haptics here */
      }
    },
    [send, sendNow],
  );

  // a record doesn't stay held when the page goes away, and a cut doesn't stay down
  const cutOn = useRef(false);
  const setCutTo = useCallback(
    (on: boolean) => {
      if (cutOn.current === on) return;
      cutOn.current = on;
      setCut(on);
      send({ type: "gesture", name: "decks-cut", data: { on } });
    },
    [send],
  );
  useEffect(() => {
    const away = () => {
      release();
      setCutTo(false);
    };
    document.addEventListener("visibilitychange", away);
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("blur", away);
      away();
    };
  }, [release, setCutTo]);

  // ---- twist: the phone's turn about its screen axis, only while the record is held ----
  const twist = useRef(createTwistFilter());
  const twistOn = mode === "twist" && motionOk;
  useEffect(() => {
    twist.current.reset();
    S.current.twistV = 0;
  }, [twistOn]);
  const onSample = useCallback((smp: MotionSample) => {
    const st = twist.current.push(smp);
    S.current.twistV = S.current.grab ? DECKS_CAL.twistSign * DECKS_CAL.twistGain * st.omega : 0;
  }, []);
  const { receiving } = useMotionSamples(twistOn, onSample);
  const noSensor = mode === "twist" && motionOk && receiving === false;
  useEffect(() => {
    if (!noSensor) return;
    setTwistFailed(true);
    setMode("finger");
  }, [noSensor]);
  // changing how you scratch lets go of the record
  useEffect(() => release, [mode, release]);

  const ref = useCanvas(
    ({ ctx, w, h, dt }) => {
      const s = S.current;
      // the record follows a hand on it; otherwise the motor spins it up or the brake slows it
      if (s.grab) {
        s.rate = s.mode === "twist" ? s.twistV / OMEGA : (s.v || 0) / OMEGA;
        if (s.mode === "twist") {
          s.angle += s.twistV * dt;
          s.finger += s.twistV * dt;
        }
      } else {
        s.rate += ((s.running ? 1 : 0) - s.rate) * Math.min(1, dt * (s.running ? 5 : 2.2));
        s.angle += s.rate * OMEGA * dt;
      }
      s.arm += ((s.running || s.rate > 0.1 ? 1 : 0) - s.arm) * Math.min(1, dt * 3);

      ctx.clearRect(0, 0, w, h);
      const strip = 30;
      const r = Math.min(w * 0.455, (h - strip) * 0.48);
      const cx = w / 2;
      const cy = (h - strip) / 2 + 4;
      box.current = { cx, cy, r };
      // platter rim with strobe dots
      ctx.fillStyle = "#2a2d30";
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 90; i++) {
        const a = s.angle + (i / 90) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? "#5a5f63" : "#8b9095";
        ctx.fillRect(cx + Math.cos(a) * r * 1.03 - 1, cy + Math.sin(a) * r * 1.03 - 1, 2, 2);
      }
      // record and grooves
      ctx.fillStyle = "#0a0a0b";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let g = r * 0.38; g < r * 0.97; g += 3.2) {
        ctx.beginPath();
        ctx.arc(cx, cy, g, 0, Math.PI * 2);
        ctx.stroke();
      }
      // fixed sheen
      const sheen = ctx.createConicGradient(-0.6, cx, cy);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.08, "rgba(255,255,255,0.1)");
      sheen.addColorStop(0.16, "rgba(255,255,255,0)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0)");
      sheen.addColorStop(0.58, "rgba(255,255,255,0.08)");
      sheen.addColorStop(0.66, "rgba(255,255,255,0)");
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
      ctx.fill();
      // label (turns), with a cue mark so you can see it go
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.angle);
      ctx.fillStyle = "#1d5e3f";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.33, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f2ead7";
      ctx.textAlign = "center";
      mono(ctx, Math.max(9, r * 0.075));
      ctx.fillText("SIDE A", 0, -r * 0.06);
      mono(ctx, Math.max(8, r * 0.05));
      ctx.fillText("33⅓ RPM", 0, r * 0.07);
      ctx.fillRect(-1.5, r * 0.15, 3, r * 0.14);
      ctx.fillStyle = "#c9c4b8";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.03, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // the hand on the record
      if (s.grab) {
        ctx.strokeStyle = "rgba(138,217,168,0.9)";
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.985, s.finger - 0.3, s.finger + 0.3);
        ctx.stroke();
        ctx.fillStyle = "#8ad9a8";
        ctx.beginPath();
        ctx.arc(cx + Math.cos(s.finger) * r * 0.78, cy + Math.sin(s.finger) * r * 0.78, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      // readout
      ctx.fillStyle = "#b5b6ab";
      mono(ctx, 11);
      ctx.textAlign = "center";
      const pct = Math.round(s.rate * 100);
      const label = s.grab ? "SCRATCH" : s.running ? "PLAY" : s.rate > 0.02 ? "BRAKE" : "STOP";
      ctx.fillText(`${label}  ${pct > 0 ? "+" : ""}${pct}%`, w / 2, h - 12);
      const el = ref.current;
      if (el) {
        const g = s.grab ? "1" : "0";
        if (el.dataset.grab !== g) el.dataset.grab = g;
        if (el.dataset.rate !== String(pct)) el.dataset.rate = String(pct);
      }
    },
    {
      onDown: (p) => {
        const { cx, cy, r } = box.current;
        if (Math.hypot(p.x - cx, p.y - cy) > r * (1 + DECKS_CAL.grabSlack)) return;
        grab(Math.atan2(p.y - cy, p.x - cx));
      },
      onMove: (p) => {
        const s = S.current;
        if (!s.grab || s.mode !== "finger") return;
        const { cx, cy, r } = box.current;
        if (Math.hypot(p.x - cx, p.y - cy) < r * DECKS_CAL.centreDead) return;
        const a = Math.atan2(p.y - cy, p.x - cx);
        const da = angleDelta(s.finger, a);
        s.finger = a;
        s.angle += da; // the record goes round with the finger, exactly
        s.acc += da;
      },
      onUp: release,
    },
  );

  const play = () => {
    const on = !running;
    setRunning(on);
    send({ type: "gesture", name: "decks-play", data: { on } });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-testid="decks-controller" data-mode={mode} data-running={running} data-held={held} data-cut={cut}>
      <h1 className="mt-3 text-[1.35rem] leading-tight font-extrabold text-balance">
        {mode === "finger" ? "Scratch the record." : "Hold it. Twist the phone."}
      </h1>
      <p className="mt-1 text-[1rem] leading-snug text-[#c9c6b6]">
        {mode === "finger" ? "Put a finger on it and go round, forwards and back." : "Keep a finger on the record, then turn the phone like a record."}
      </p>

      <canvas
        ref={ref}
        role="img"
        aria-label="A turntable platter. Drag round the record to scratch the beat on the laptop."
        data-testid="decks-platter"
        className="mt-3 block w-full h-[36dvh] min-h-[230px] max-h-[360px] rounded-[28px] bg-[#16181a] border border-white/10 touch-none select-none outline-none"
        onContextMenu={(e) => e.preventDefault()}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="decks-play"
          aria-pressed={running}
          onClick={play}
          className="min-h-[64px] rounded-[20px] bg-[var(--paper)] text-[var(--ink)] text-[1.25rem] font-extrabold active:scale-[0.98] transition-transform"
        >
          {running ? "Stop" : "Play"}
        </button>
        <button
          type="button"
          data-testid="decks-cut"
          aria-pressed={cut}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setCutTo(true);
          }}
          onPointerUp={() => setCutTo(false)}
          onPointerCancel={() => setCutTo(false)}
          onContextMenu={(e) => e.preventDefault()}
          className={`min-h-[64px] rounded-[20px] border text-[1.15rem] font-extrabold touch-none select-none transition-colors ${
            cut ? "bg-[#e5484d] text-white border-transparent" : "bg-white/10 border-white/15 text-[var(--paper)]"
          }`}
        >
          {cut ? "Cut!" : "Hold to cut"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Scratch with">
        {(["finger", "twist"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            data-mode-btn={m}
            disabled={m === "twist" && (!motionOk || twistFailed)}
            onClick={() => setMode(m)}
            className={`${ghostButton} !min-h-[44px] !py-2 ${mode === m ? "!bg-[var(--mint)] !text-[var(--ink)] !border-transparent" : ""} disabled:opacity-40`}
          >
            {m === "finger" ? "Finger" : "Twist"}
          </button>
        ))}
      </div>
      {!motionOk && <p className="mt-2 text-[0.95rem] leading-snug text-[#a3a69c]">Motion is off on this phone, so twisting isn&apos;t available. Reload this page and allow motion to turn it on.</p>}
      {twistFailed && <p className="mt-2 text-[0.95rem] leading-snug text-[#f0dc9d]">This phone isn&apos;t sending motion data, so Twist is off. Use your finger.</p>}
    </div>
  );
}
