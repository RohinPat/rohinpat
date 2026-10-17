"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio, noise, type Audio } from "./audio";
import { display, mono } from "./font";

// A race dash and a quarter mile. The engine is a small physics model
// (torque curve, gear ratios, drag) and a synthesized V8: detuned saws at
// the firing frequency (rpm / 15) plus a sub-octave, through a waveshaper
// and a load-dependent low-pass. Hold the throttle to stage and launch,
// shift on the green light; perfect shifts pop and pull.

const RATIOS = [3.4, 2.15, 1.55, 1.2, 0.97, 0.82];
const FINAL = 3.55;
const WHEEL = 0.33;
const IDLE = 900;
const SHIFT_AT = 7300;
const REDLINE = 7800;
const LIMIT = 8000;
const QUARTER = 402.3;

const wheelRpm = (v: number, g: number) => (v / (2 * Math.PI * WHEEL)) * 60 * RATIOS[g] * FINAL;
function torque(rpm: number) {
  // Nm: builds to a broad peak around 5.5k, falls off past 7k
  const x = rpm / 1000;
  return Math.max(0, 420 + 95 * x - 9.5 * x * x - (x > 7 ? (x - 7) * 260 : 0));
}

// The V8's voice. One oscillator runs at the engine-cycle rate (rpm / 120:
// a four-stroke cycle is two turns) with a custom waveform. A V8 fires 8
// times a cycle, so the 8th harmonic is the firing note; the cross-plane
// crank fires unevenly, which puts energy into the lower orders too — that
// lumpy low end is the burble. A second voice an octave down adds weight,
// noise adds intake, and a waveshaper plus a load-dependent low-pass shape it.
type Engine = { osc: OscillatorNode; low: OscillatorNode; lp: BiquadFilterNode; amp: GainNode; intake: GainNode; src: AudioBufferSourceNode };

function v8Wave(ctx: BaseAudioContext) {
  const N = 48;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let h = 1; h < N; h++) {
    const w = h % 8 === 0 ? 1 : h % 4 === 0 ? 0.75 : h % 2 === 0 ? 0.45 : 0.32;
    // fixed, uneven phases: the cross-plane lope
    const ph = (Math.sin(h * 12.9898) * 43758.5453) % (Math.PI * 2);
    const a = w / Math.pow(h, 0.62);
    re[h] = a * Math.cos(ph);
    im[h] = a * Math.sin(ph);
  }
  return ctx.createPeriodicWave(re, im);
}

function startEngine({ ctx, out }: Audio): Engine {
  const wave = v8Wave(ctx);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  const low = ctx.createOscillator();
  low.setPeriodicWave(wave);
  const lowG = ctx.createGain();
  lowG.gain.value = 0.55;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 1.8);
  shaper.curve = curve;
  const mix = ctx.createGain();
  mix.gain.value = 0.9;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 1.4;
  const body = ctx.createBiquadFilter(); // exhaust resonance
  body.type = "peaking";
  body.frequency.value = 140;
  body.Q.value = 1.2;
  body.gain.value = 7;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  osc.connect(mix);
  low.connect(lowG).connect(mix);
  mix.connect(shaper).connect(body).connect(lp).connect(amp).connect(out);
  // intake roar
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 600;
  bp.Q.value = 0.8;
  const intake = ctx.createGain();
  intake.gain.value = 0;
  src.connect(bp).connect(intake).connect(out);
  osc.start();
  low.start();
  src.start();
  return { osc, low, lp, amp, intake, src };
}

type Car = {
  phase: "idle" | "tree" | "run" | "done";
  rpm: number;
  v: number;
  x: number;
  gear: number;
  throttle: boolean;
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

export default function EnginePiece({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const car = useRef<Car>(freshCar());
  const eng = useRef<Engine | null>(null);
  const clock = useRef(0);
  const [done, setDone] = useState<string>("");

  useEffect(
    () => () => {
      const e = eng.current;
      if (!e) return;
      e.amp.gain.value = 0;
      e.intake.gain.value = 0;
      [e.osc, e.low, e.src].forEach((o) => o.stop());
    },
    [],
  );

  const throttle = (on: boolean) => {
    car.current.throttle = on;
    if (on && play && !eng.current) {
      const au = getAudio();
      if (au) eng.current = startEngine(au);
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

  const ref = useCanvas(
    ({ ctx, w, h, t, dt }) => {
      clock.current = t;
      const c = car.current;
      if (!play) autopilot(c, dt);
      simulate(c, dt, t);
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
      c.rpm += (c.throttle ? 9000 : -6000) * dt;
      c.stageHeld = c.throttle ? c.stageHeld + dt : 0;
      if (c.stageHeld > 0.35) {
        c.phase = "tree";
        c.tree = 0;
      }
    } else if (c.phase === "tree") {
      c.rpm += (c.throttle ? 7000 : -6000) * dt;
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
          ? Math.min(17500, (torque(c.rpm) * RATIOS[c.gear] * FINAL * 0.9) / WHEEL) // traction-limited
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
      c.rpm += (c.throttle ? 7000 : -4000) * dt;
      c.v = Math.max(0, c.v - 6 * dt);
    }
    if (c.phase !== "run") c.rpm = Math.min(LIMIT + 60, Math.max(IDLE, c.rpm));
    if (c.phase !== "run" && c.rpm >= LIMIT && c.throttle) c.rpm = LIMIT - 300 * Math.random(); // bounce off the limiter
    c.pop = Math.max(0, c.pop - dt * 4);
  }

  function voice(c: Car) {
    const e = eng.current;
    const au = e && getAudio();
    if (!e || !au) return;
    const now = au.ctx.currentTime;
    const cycle = c.rpm / 120;
    e.osc.frequency.setTargetAtTime(cycle, now, 0.02);
    e.low.frequency.setTargetAtTime(cycle / 2, now, 0.02);
    const load = c.throttle ? 1 : 0.3;
    const cut = c.phase === "run" && c.shiftT > 0;
    // off throttle it goes dull and boomy; on throttle it opens up, but stays low
    e.lp.frequency.setTargetAtTime(180 + c.rpm * (0.09 + 0.1 * load), now, 0.04);
    const limiterGate = c.rpm >= LIMIT - 40 && c.throttle ? (Math.random() < 0.5 ? 0.15 : 1) : 1;
    e.amp.gain.setTargetAtTime((cut ? 0.1 : 0.22 + load * 0.28) * limiterGate, now, 0.02);
    e.intake.gain.setTargetAtTime(c.throttle ? 0.02 + (c.rpm / LIMIT) * 0.05 : 0.008, now, 0.05);
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
    for (let x = off; x < w; x += dash * 2) ctx.fillRect(x, ry + roadH / 2 - 2, dash, 4);
    // quarter-mile progress
    ctx.fillStyle = "rgba(138,217,168,0.25)";
    ctx.fillRect(0, ry, w, 3);
    ctx.fillStyle = "#8ad9a8";
    ctx.fillRect(0, ry, w * Math.min(1, c.x / QUARTER), 3);

    // tach
    const area = ry;
    const R = Math.min(w * 0.3, area * 0.42);
    const cx = Math.min(w * 0.36, w / 2 - R * 0.2), cy = area * 0.55;
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
      ctx.arc(lx + i * lw * 1.3 + lw / 2, Math.max(16, area * 0.07), lw * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }

    // right column: speed, time, splits, tree
    const rx = Math.min(Math.max(cx + R * 1.2, w * 0.62), w - (play ? 150 : 110));
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f2ead7";
    display(ctx, Math.round(Math.min(h * 0.2, w * 0.11)), 800);
    ctx.fillText(String(Math.round(c.v * 2.237)).padStart(3, " "), rx, area * 0.42);
    mono(ctx, play ? 12 : 9);
    ctx.fillStyle = "#b5b6ab";
    ctx.fillText("MPH", rx + 4, area * 0.42 + 16);
    const lines = [
      `TIME   ${c.phase === "run" || c.phase === "done" ? c.t.toFixed(2) : "—"}`,
      `0–60   ${c.split60 ? c.split60.toFixed(2) : "—"}`,
      `DIST   ${Math.round(c.x)} / 402 m`,
      `BEST   ${c.best ? c.best.toFixed(2) : "—"}`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, rx + 4, area * 0.42 + 40 + i * (play ? 18 : 13)));

    // christmas tree while staging
    if (c.phase === "tree" || c.phase === "idle") {
      const tx = rx + (play ? 190 : 120), ty = area * 0.22;
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

