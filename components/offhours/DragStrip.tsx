"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio } from "./audio";
import { display, mono } from "./font";
import type { Remote, RemoteHandlers } from "@/lib/link/remote";
import { ENGINE_CAL, engineStateData, parseThrottle, pedalStep, rpmRate, type EnginePhase } from "./engineRemote";
import { IDLE, LIMIT, REDLINE, RATIOS, FINAL, SHIFT_AT, WHEEL, torque, wheelRpm } from "./engineModel";
import { EngineVoice } from "./engineVoice";

// The drag strip: a race dash and a quarter mile (Cars' second mode; Night run
// is the first). The engine is the shared model (engineModel.ts: torque curve,
// gear ratios, drag) and the shared V8 (engineVoice.ts). Hold the throttle to
// stage and launch, shift on the green light; perfect shifts pop and pull. A
// linked phone is a throttle grip: it sends the `throttle` axis (0..1, a pedal
// part way down), shifts with `engine-shift`, and is told the revs and gear
// back. Engine.tsx owns the phone link and hands the messages down.

const QUARTER = 402.3;

type Car = {
  phase: "idle" | "tree" | "run" | "done";
  rpm: number;
  v: number;
  x: number;
  gear: number;
  throttle: boolean;
  /** how far down the pedal is, 0..1: 1 for the keys and the button, anything for a phone */
  pedal: number;
  shiftT: number;
  tree: number;
  t: number;
  split60: number | null;
  perfect: number;
  call: string;
  callT: number;
  limiter: number;
  slip: number;
  best: number | null;
  stageHeld: number;
  pop: number;
};

const freshCar = (best: number | null = null): Car => ({
  phase: "idle",
  rpm: IDLE,
  v: 0,
  x: 0,
  gear: 0,
  throttle: false,
  pedal: 0,
  shiftT: 0,
  tree: 0,
  t: 0,
  split60: null,
  perfect: 0,
  call: "",
  callT: 0,
  limiter: 0,
  slip: 0,
  best,
  stageHeld: 0,
  pop: 0,
});

export type DragProps = PieceProps & {
  /** the phone link (Engine.tsx owns it: both modes share one) */
  remote: Remote;
  /** this game puts its phone handlers here; Engine.tsx forwards the phone's messages to them */
  bus: React.MutableRefObject<RemoteHandlers>;
};

export default function DragStrip({ mode, paused, remote, bus }: DragProps) {
  const play = mode === "play";
  const car = useRef<Car>(freshCar());
  const eng = useRef<EngineVoice | null>(null);
  const clock = useRef(0);
  const [done, setDone] = useState<string>("");
  // the keys / pedal button (held) and a linked phone (target, then smoothed)
  const held = useRef(false);
  const phone = useRef({ target: 0, smooth: 0 });
  const told = useRef({ at: -Infinity, key: "" });

  useEffect(
    () => () => {
      eng.current?.stop();
    },
    [],
  );

  const throttle = (on: boolean) => {
    held.current = on;
    car.current.throttle = on;
    if (on && play && !eng.current) {
      const au = getAudio();
      if (au) eng.current = new EngineVoice(au);
    }
  };
  const shift = () => {
    const c = car.current;
    if (c.phase !== "run" || c.gear >= RATIOS.length - 1 || c.shiftT > 0) return;
    const rpm = c.rpm;
    c.call = rpm >= SHIFT_AT && rpm <= LIMIT ? "PERFECT" : rpm < SHIFT_AT - 900 ? "EARLY" : "GOOD";
    if (c.call === "PERFECT") c.perfect++;
    c.callT = clock.current;
    c.gear++;
    c.shiftT = c.call === "PERFECT" ? 0.09 : 0.16;
    c.pop = 1;
    if (play) {
      const au = getAudio();
      if (au) {
        burst(au, { freq: 180, type: "lowpass", dur: 0.08, gain: 0.5 });
        burst(au, { freq: 120, type: "lowpass", dur: 0.06, gain: 0.4, at: 0.07 });
      }
    }
  };
  const again = () => {
    car.current = freshCar(car.current.best);
    setDone("");
  };

  // A linked phone: its throttle axis is a pedal, its shift gesture is the up
  // arrow, and it is told the revs, gear and shift light. Without one this does nothing.
  bus.current = {
    axis: (name, v) => {
      if (name === "throttle") phone.current.target = parseThrottle(v);
    },
    gesture: (name) => {
      if (name === "engine-shift") shift();
      else if (name === "engine-again" && car.current.phase === "done") again();
      else if (name === "engine-sync") told.current.key = "";
    },
  };
  useEffect(
    () => () => {
      bus.current = {};
    },
    [bus],
  );
  const linkRef = useRef(remote);
  linkRef.current = remote;
  useEffect(() => {
    // no phone (or it dropped): a throttle left open must not stay open
    if (!remote.linked) phone.current = { target: 0, smooth: 0 };
    told.current.key = "";
  }, [remote.linked]);
  /** tell the phone where the dash is: when it changed, and not more than ten times a second */
  function tellPhone(c: Car, t: number) {
    const r = linkRef.current;
    if (!r.linked || t * 1000 - told.current.at < ENGINE_CAL.stateEveryMs) return;
    const phase: EnginePhase = c.phase;
    const call = c.call && t - c.callT < 0.9 ? c.call : "";
    const view = { rpm: c.rpm, gear: c.gear, phase, shift: phase === "run" && c.rpm >= SHIFT_AT && c.gear < RATIOS.length - 1, call, time: phase === "run" || phase === "done" ? c.t : 0 };
    const data = engineStateData(view);
    const key = JSON.stringify(data);
    if (key === told.current.key) return;
    told.current = { at: t * 1000, key };
    r.send({ type: "gesture", name: "engine-state", data });
  }

  const ref = useCanvas(
    ({ ctx, w, h, t, dt }) => {
      clock.current = t;
      const c = car.current;
      if (!play) autopilot(c, dt);
      if (play) {
        // keys and the button are a flat-out pedal; a phone's is smoothed and can be part way
        const ph = phone.current;
        ph.smooth = pedalStep(ph.smooth, ph.target, dt, ENGINE_CAL.smoothS);
        const p = Math.max(held.current ? 1 : 0, ph.smooth);
        c.throttle = p > ENGINE_CAL.throttleOn;
        c.pedal = c.throttle ? p : 0;
      } else c.pedal = c.throttle ? 1 : 0;
      simulate(c, dt, t);
      tellPhone(c, t);
      voice(c);
      draw(ctx, c, w, h, t);
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      keys: (e, down) => {
        if (e.key === " ") {
          if (!e.repeat) throttle(down);
          return true;
        }
        if (e.key === "ArrowUp" || e.key.toLowerCase() === "e") {
          if (down && !e.repeat) shift();
          return true;
        }
        if (e.key === "Enter" && down && car.current.phase === "done") {
          again();
          return true;
        }
        return false;
      },
      onDown: () => throttle(true),
      onUp: () => throttle(false),
    },
  );

  function autopilot(c: Car, dt: number) {
    if (c.phase === "idle") c.throttle = Math.sin(clock.current * 3) > 0.3 || c.stageHeld > 0;
    if (c.phase === "idle" && clock.current % 6 > 4.5) c.throttle = true;
    if (c.phase === "tree" || c.phase === "run") c.throttle = true;
    if (c.phase === "run" && c.rpm > SHIFT_AT + 100 && c.shiftT <= 0) shift();
    if (c.phase === "done") {
      c.tree += dt;
      if (c.tree > 2.5) Object.assign(c, freshCar(c.best));
    }
  }

  function simulate(c: Car, dt: number, t: number) {
    if (c.phase === "idle") {
      // free revving: stage by holding the throttle
      c.rpm += rpmRate(c.pedal, 9000, 6000) * dt;
      c.stageHeld = c.throttle ? c.stageHeld + dt : 0;
      if (c.stageHeld > 0.35) {
        c.phase = "tree";
        c.tree = 0;
      }
    } else if (c.phase === "tree") {
      c.rpm += rpmRate(c.pedal, 7000, 6000) * dt;
      c.tree += dt;
      if (c.tree >= 1.6) {
        c.phase = "run";
        c.t = 0;
        // launch: too few revs bogs, too many spins the tyres
        c.slip = c.rpm > 6500 ? 0.9 : c.rpm < 3200 ? -0.6 : 0.25;
        c.call = c.rpm > 6500 ? "WHEELSPIN" : c.rpm < 3200 ? "BOGGED" : "GREAT LAUNCH";
        c.callT = t;
      }
    } else if (c.phase === "run") {
      c.t += dt;
      const coupled = wheelRpm(c.v, c.gear);
      c.shiftT = Math.max(0, c.shiftT - dt);
      // engine speed: tied to the wheels, plus launch slip that decays
      c.slip *= Math.exp(-dt * 2.2);
      const target = Math.max(IDLE + 1500 * Math.max(0, c.slip), coupled * (1 + Math.max(0, c.slip) * 0.35));
      c.rpm += (target - c.rpm) * Math.min(1, dt * (c.shiftT > 0 ? 18 : 10));
      const onLimiter = c.rpm >= LIMIT;
      c.limiter = onLimiter ? c.limiter + dt : 0;
      const drive =
        c.throttle && c.shiftT <= 0 && !(onLimiter && Math.floor(t * 30) % 2)
          ? Math.min(17500, (torque(c.rpm) * RATIOS[c.gear] * FINAL * 0.9) / WHEEL) * c.pedal // traction-limited
          : 0;
      const bog = c.slip < 0 ? 1 + c.slip * 0.6 : 1 - Math.max(0, c.slip) * 0.35;
      const drag = 0.39 * c.v * c.v + 180;
      const a = (drive * bog - drag) / 1550;
      c.v = Math.max(0, c.v + a * dt);
      c.x += c.v * dt;
      c.rpm = Math.min(LIMIT + 60, Math.max(IDLE, c.rpm));
      if (c.split60 === null && c.v * 2.237 >= 60) c.split60 = c.t;
      if (c.limiter > 0.15 && t - c.callT > 0.6) {
        c.call = "LIMITER";
        c.callT = t;
      }
      if (c.x >= QUARTER) {
        c.phase = "done";
        c.tree = 0;
        c.best = c.best === null ? c.t : Math.min(c.best, c.t);
        if (play)
          setDone(
            `Quarter mile in ${c.t.toFixed(2)} seconds at ${(c.v * 2.237).toFixed(0)} mph. 0 to 60 in ${c.split60?.toFixed(2) ?? "—"}. ${c.perfect} perfect shifts.`,
          );
      }
    } else {
      c.rpm += rpmRate(c.pedal, 7000, 4000) * dt;
      c.v = Math.max(0, c.v - 6 * dt);
    }
    if (c.phase !== "run") c.rpm = Math.min(LIMIT + 60, Math.max(IDLE, c.rpm));
    if (c.phase !== "run" && c.rpm >= LIMIT && c.throttle) c.rpm = LIMIT - 300 * Math.random(); // bounce off the limiter
    c.pop = Math.max(0, c.pop - dt * 4);
  }

  function voice(c: Car) {
    const e = eng.current;
    if (!e) return;
    e.update({ rpm: c.rpm, pedal: c.pedal, throttle: c.throttle, cut: c.phase === "run" && c.shiftT > 0 });
  }

  function draw(ctx: CanvasRenderingContext2D, c: Car, w: number, h: number, t: number) {
    ctx.fillStyle = "#0b0d0c";
    ctx.fillRect(0, 0, w, h);
    // carbon weave
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 0 : 3; x < w; x += 6) ctx.fillRect(x, y, 3, 3);

    // road strip at the bottom, moving with speed
    const roadH = Math.max(40, h * 0.18);
    const ry = h - roadH;
    ctx.fillStyle = "#151816";
    ctx.fillRect(0, ry, w, roadH);
    ctx.fillStyle = "#f2ead7";
    const dash = 60;
    const off = -((c.x * 30) % (dash * 2));
    // the tile's PLAY pill sits in the bottom-right corner: the road's centre line stops short of it
    const roadEnd = play ? w : Math.max(0, w - 124);
    for (let x = off; x < roadEnd; x += dash * 2) ctx.fillRect(x, ry + roadH / 2 - 2, Math.min(dash, roadEnd - x), 4);
    // quarter-mile progress
    ctx.fillStyle = "rgba(138,217,168,0.25)";
    ctx.fillRect(0, ry, w, 3);
    ctx.fillStyle = "#8ad9a8";
    ctx.fillRect(0, ry, w * Math.min(1, c.x / QUARTER), 3);

    // tach
    const area = ry;
    // narrow (a phone, played): the dial is centred and big, speed and the
    // stats sit in a row under it, the prompt under that. Nothing shares a line.
    const stacked = play && w < 560;
    const ledY = Math.max(16, area * 0.07);
    const dialTop = ledY + 24;
    const foot = 100; // stats block (64) + prompt row + gaps
    const R = stacked ? Math.max(36, Math.min(w * 0.38, (area - dialTop - foot) / 1.8)) : Math.min(w * 0.3, area * 0.42);
    const cx = stacked ? w / 2 : Math.min(w * 0.36, w / 2 - R * 0.2);
    const cy = stacked ? dialTop + R * 1.06 : area * 0.55;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (r: number) => a0 + (r / 9000) * (a1 - a0);
    ctx.lineWidth = R * 0.07;
    ctx.strokeStyle = "#1c211e";
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.stroke();
    ctx.strokeStyle = "#c2412d";
    ctx.beginPath();
    ctx.arc(cx, cy, R, ang(REDLINE), a1);
    ctx.stroke();
    ctx.strokeStyle = "#8ad9a8";
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, ang(Math.min(9000, c.rpm)));
    ctx.stroke();
    ctx.fillStyle = "#f2ead7";
    display(ctx, Math.round(R * 0.14), 700);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let k = 0; k <= 9; k++) {
      const a = ang(k * 1000);
      ctx.fillStyle = k * 1000 >= REDLINE ? "#e5604a" : "#f2ead7";
      ctx.fillText(String(k), cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78);
      ctx.fillRect(cx + Math.cos(a) * R * 0.9 - 1, cy + Math.sin(a) * R * 0.9 - 1, 2, 2);
    }
    // needle
    const na = ang(c.rpm) + (c.rpm >= LIMIT - 40 ? (Math.random() - 0.5) * 0.04 : 0);
    ctx.strokeStyle = "#f2ead7";
    ctx.lineWidth = Math.max(2, R * 0.025);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(na) * R * 0.12, cy - Math.sin(na) * R * 0.12);
    ctx.lineTo(cx + Math.cos(na) * R * 0.92, cy + Math.sin(na) * R * 0.92);
    ctx.stroke();
    ctx.fillStyle = "#1d5e3f";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.08, 0, Math.PI * 2);
    ctx.fill();
    // gear + speed inside the dial
    ctx.fillStyle = "#f2ead7";
    display(ctx, Math.round(R * 0.5), 800);
    ctx.fillText(c.phase === "run" || c.phase === "done" ? String(c.gear + 1) : "N", cx, cy + R * 0.42);
    mono(ctx, Math.round(R * 0.09));
    ctx.fillStyle = "#b5b6ab";
    ctx.fillText("RPM ×1000", cx, cy - R * 0.32);

    // shift lights across the top
    const leds = 12;
    const lw = Math.min(26, (w * 0.5) / leds);
    const lx = w / 2 - (leds * lw * 1.3) / 2;
    const flashBlue = c.rpm >= SHIFT_AT && Math.floor(t * 14) % 2 === 0;
    for (let i = 0; i < leds; i++) {
      const on = c.rpm >= 4200 + i * ((SHIFT_AT - 4200) / leds);
      const col = i < 4 ? "#3ddc84" : i < 8 ? "#ffd23f" : "#ff4d4d";
      ctx.fillStyle = on ? (flashBlue ? "#5ab0ff" : col) : "#1c211e";
      ctx.beginPath();
      ctx.arc(lx + i * lw * 1.3 + lw / 2, ledY, lw * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }

    // right column: speed, time, splits, tree
    const lines = [
      `TIME   ${c.phase === "run" || c.phase === "done" ? c.t.toFixed(2) : "—"}`,
      `0–60   ${c.split60 ? c.split60.toFixed(2) : "—"}`,
      `DIST   ${Math.round(c.x)} / 402 m`,
      `BEST   ${c.best ? c.best.toFixed(2) : "—"}`,
    ];
    const speed = String(Math.round(c.v * 2.237)).padStart(3, " ");
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let rx: number;
    if (stacked) {
      const top = area - foot + 4;
      const big = 46;
      display(ctx, big, 800);
      const sw = ctx.measureText("888").width;
      mono(ctx, 12);
      const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const gap = 22;
      rx = Math.max(12, (w - (sw + gap + tw)) / 2);
      ctx.fillStyle = "#f2ead7";
      display(ctx, big, 800);
      ctx.fillText(speed, rx, top + 40);
      mono(ctx, 12);
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText("MPH", rx + 3, top + 58);
      lines.forEach((l, i) => ctx.fillText(l, rx + sw + gap, top + 12 + i * 16));
    } else {
      rx = Math.min(Math.max(cx + R * 1.2, w * 0.62), w - (play ? 150 : 110));
      ctx.fillStyle = "#f2ead7";
      display(ctx, Math.round(Math.min(h * 0.2, w * 0.11)), 800);
      ctx.fillText(speed, rx, area * 0.42);
      mono(ctx, play ? 12 : 9);
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText("MPH", rx + 4, area * 0.42 + 16);
      lines.forEach((l, i) => ctx.fillText(l, rx + 4, area * 0.42 + 40 + i * (play ? 18 : 13)));
    }

    // christmas tree while staging
    if (c.phase === "tree" || c.phase === "idle") {
      const tx = stacked ? w - 16 : rx + (play ? 190 : 120), ty = stacked ? dialTop + 4 : area * 0.22;
      for (let i = 0; i < 4; i++) {
        const lit = c.phase === "tree" && (i < 3 ? c.tree >= i * 0.5 : c.tree >= 1.6);
        ctx.fillStyle = lit ? (i < 3 ? "#ffb300" : "#3ddc84") : "#1c211e";
        ctx.beginPath();
        ctx.arc(tx, ty + i * (play ? 22 : 15), play ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // call-outs
    if (c.call && t - c.callT < 0.9) {
      ctx.globalAlpha = 1 - (t - c.callT) / 0.9;
      ctx.fillStyle = c.call === "PERFECT" || c.call === "GREAT LAUNCH" ? "#8ad9a8" : "#ffd23f";
      display(ctx, Math.round(R * 0.22), 800);
      ctx.textAlign = "center";
      ctx.fillText(c.call, cx, cy - R * 0.62);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }
    if (c.phase === "idle" && play) {
      ctx.fillStyle = "#f2ead7";
      mono(ctx, 12);
      ctx.textAlign = "center";
      ctx.fillText(w < 640 ? "HOLD THE THROTTLE TO STAGE" : "HOLD THE THROTTLE TO STAGE · LAUNCH BETWEEN 3.2K AND 6.5K", w / 2, ry - 14);
      ctx.textAlign = "left";
    }
    // exhaust pop flash
    if (c.pop > 0) {
      ctx.fillStyle = `rgba(255,140,40,${c.pop * 0.12})`;
      ctx.fillRect(0, ry, w, roadH);
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#0b0d0c]">
      <div className="relative flex-1 min-h-0">
        {remote.linked && (
          <p
            data-testid="engine-phone-hint"
            className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-[#0d100e]/80 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]"
          >
            <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-[#8ad9a8] align-middle" />
            Twist your phone
          </p>
        )}
        <canvas
          ref={ref}
          data-autofocus={play || undefined}
          role={play ? "img" : undefined}
          aria-label={play ? "A race dashboard. Hold Space for throttle, press the up arrow to shift." : undefined}
          className="absolute inset-0 w-full h-full outline-none touch-none"
        />
      </div>
      {play && (
        <div className="flex items-stretch gap-2 p-3">
          <button
            type="button"
            onPointerDown={() => throttle(true)}
            onPointerUp={() => throttle(false)}
            onPointerLeave={() => throttle(false)}
            className="flex-1 h-16 rounded-xl bg-[#1d5e3f] text-[#f2ead7] font-mono text-xs uppercase tracking-[0.2em] active:scale-[0.98] select-none touch-none"
          >
            Throttle · hold
          </button>
          <button
            type="button"
            onPointerDown={shift}
            className="w-40 h-16 rounded-xl bg-[#f2ead7] text-[#0d100e] font-mono text-xs uppercase tracking-[0.2em] active:scale-[0.98] select-none touch-none"
          >
            Shift ↑
          </button>
          {done && (
            <button type="button" onClick={again} className="w-36 h-16 rounded-xl border border-white/20 text-[#f2ead7] font-mono text-xs uppercase tracking-[0.2em]">
              Run again
            </button>
          )}
          <p aria-live="polite" className="sr-only">
            {done}
          </p>
        </div>
      )}
    </div>
  );
}

