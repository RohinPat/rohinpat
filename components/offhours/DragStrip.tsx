"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio } from "./audio";
import { display, mono } from "./font";
import type { Remote, RemoteHandlers } from "@/lib/link/remote";
import { ENGINE_CAL, engineStateData, parseThrottle, pedalStep, type EnginePhase } from "./engineRemote";
import { LIMIT, REDLINE, RATIOS, SHIFT_AT } from "./engineModel";
import { LAUNCH, QUARTER, TREE_STEP_S, dragAdvice, freshCar, parEt, shiftUp, sinceAmber, stepDrag, treeTime, type DragCar } from "./dragModel";
import { EngineVoice } from "./engineVoice";
import { gapToGhost, ghostAt, type DragPath } from "./dragGhost";
import { paintStrip, stripGeom } from "./night/stripScene";

// The drag strip: a race dash and a quarter mile (Cars' second mode; Night run
// is the first). The engine is the shared model (engineModel.ts: torque curve,
// gear ratios, drag) and the shared V8 (engineVoice.ts). Hold the throttle to
// stage and launch, shift on the green light; perfect shifts pop and pull. A
// linked phone is a throttle grip: it sends the `throttle` axis (0..1, a pedal
// part way down), shifts with `engine-shift`, and is told the revs and gear
// back. Engine.tsx owns the phone link and hands the messages down. The strip
// shows two lanes, you in one and the best run of this visit (a ghost, in memory
// only) in the other, with the gap to it as you go. The lanes are a floodlit strip
// at night (night/stripScene.ts: a grandstand, a ridge and a town, towers, a wall,
// rubber on the line), with the start tree beside the line and the distances on
// boards along the foot.

/** a run can be started again this long after the line (so the finish is not skipped by a key still held), s */
const AGAIN_AFTER_S = 0.6;

/** the quickest quarter of this visit: memory only, kept while the strip is closed and opened again, gone with the page */
let bestVisit: number | null = null;
/** that run as distance every DRAG_GHOST_DT seconds: the ghost the next run races */
let bestPath: DragPath | null = null;

/** tyre smoke off the line (screen space, a small fixed pool) */
const PUFFS = 32;
type Puffs = { x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; age: Float32Array; life: Float32Array; size: Float32Array; i: number; acc: number };
const newPuffs = (): Puffs => {
  const f = () => new Float32Array(PUFFS);
  return { x: f(), y: f(), vx: f(), vy: f(), age: new Float32Array(PUFFS).fill(9), life: f(), size: f(), i: 0, acc: 0 };
};

/** a layer drawn once per size and blitted after (the ground, the dial's face): a frame of fillRects and text is what this saves */
type Layer = { key: string; c: HTMLCanvasElement };
function layer(prev: Layer | undefined, key: string, w: number, h: number, dpr: number, paint: (x: CanvasRenderingContext2D) => void): Layer {
  if (prev && prev.key === key) return prev;
  const c = prev?.c ?? document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const x = c.getContext("2d")!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  paint(x);
  return { key, c };
}

export type DragProps = PieceProps & {
  /** the phone link (Engine.tsx owns it: both modes share one) */
  remote: Remote;
  /** this game puts its phone handlers here; Engine.tsx forwards the phone's messages to them */
  bus: React.MutableRefObject<RemoteHandlers>;
};

export default function DragStrip({ mode, paused, remote, bus }: DragProps) {
  const play = mode === "play";
  const car = useRef<DragCar>(freshCar(play ? bestVisit : null));
  const eng = useRef<EngineVoice | null>(null);
  const clock = useRef(0);
  const [done, setDone] = useState<string>("");
  // the keys / pedal button (held) and a linked phone (target, then smoothed)
  const held = useRef(false);
  const phone = useRef({ target: 0, smooth: 0 });
  const told = useRef({ at: -Infinity, key: "" });
  const mineRef = useRef<RemoteHandlers | null>(null);
  /** this run's distance every DRAG_GHOST_DT seconds from the green (it becomes the ghost if it is the best), and the layers and smoke */
  const rec = useRef<number[]>([]);
  const layers = useRef<{ ground?: Layer; face?: Layer; beam?: Layer; bulbs?: Record<string, HTMLCanvasElement> }>({});
  const puffs = useRef<Puffs>(newPuffs());
  const wasThrottle = useRef(false);

  useEffect(() => {
    // with the mock link (tests, local work) a page can read the dash
    if (play && (process.env.NEXT_PUBLIC_LINK_MOCK === "1" || new URLSearchParams(location.search).has("linkmock"))) (window as unknown as { __drag?: { car: DragCar; ghost: DragPath | null } }).__drag = {
        get car() {
          return car.current;
        },
        get ghost() {
          return bestPath;
        },
      };
    return () => {
      eng.current?.stop();
    };
  }, [play]);

  // the sound stops when the piece is paused or the tab is hidden, and a key held when the tab went away never sees its keyup
  useEffect(() => {
    if (paused) eng.current?.silence();
  }, [paused]);
  useEffect(() => {
    const away = () => {
      if (document.hidden) eng.current?.silence();
      held.current = false;
      car.current.throttle = false;
    };
    document.addEventListener("visibilitychange", away);
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("blur", away);
    };
  }, []);

  const throttle = (on: boolean) => {
    // after the finish the throttle (key, tap or button) is the way to go again
    if (on && play && car.current.phase === "done" && car.current.doneT > AGAIN_AFTER_S) again();
    held.current = on;
    car.current.throttle = on;
    if (on && play && !eng.current) {
      const au = getAudio();
      if (au) eng.current = new EngineVoice(au);
    }
  };
  const shift = () => {
    if (!shiftUp(car.current, clock.current)) return;
    if (play) {
      const au = getAudio();
      if (au) {
        burst(au, { freq: 180, type: "lowpass", dur: 0.08, gain: 0.5 });
        burst(au, { freq: 120, type: "lowpass", dur: 0.06, gain: 0.4, at: 0.07 });
      }
    }
  };
  function again() {
    car.current = freshCar(car.current.best);
    setDone("");
  }

  // A linked phone: its throttle axis is a pedal, its shift gesture is the up
  // arrow, and it is told the revs, gear and shift light. Without one this does nothing.
  const mine: RemoteHandlers = {
    axis: (name, v) => {
      if (name === "throttle") phone.current.target = parseThrottle(v);
    },
    gesture: (name) => {
      if (name === "engine-shift") shift();
      else if (name === "engine-again" && car.current.phase === "done") again();
      else if (name === "engine-sync") told.current.key = "";
    },
  };
  mineRef.current = mine;
  bus.current = mine;
  // leaving hands the phone's messages to nobody, unless the other mode has already taken them
  useEffect(() => {
    bus.current = mineRef.current ?? {};
    return () => {
      if (bus.current === mineRef.current) bus.current = {};
    };
  }, [bus]);
  const linkRef = useRef(remote);
  linkRef.current = remote;
  useEffect(() => {
    // no phone (or it dropped): a throttle left open must not stay open
    if (!remote.linked) phone.current = { target: 0, smooth: 0 };
    told.current.key = "";
  }, [remote.linked]);
  /** tell the phone where the dash is: when it changed, and not more than ten times a second */
  function tellPhone(c: DragCar, t: number) {
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
    ({ ctx, w, h, t, dt, reduce }) => {
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
      draw(ctx, c, w, h, t, dt, reduce);
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

  // arriving from the mode switch with it still focused: the keys listen on the dash, so hand them over
  useEffect(() => {
    const a = document.activeElement;
    if (play && (!a || a === document.body || a.closest('[aria-label="Mode"]'))) ref.current?.focus();
  }, [play, ref]);

  function autopilot(c: DragCar, dt: number) {
    if (c.phase === "idle") c.throttle = Math.sin(clock.current * 3) > 0.3 || c.stageHeld > 0;
    if (c.phase === "idle" && clock.current % 6 > 4.5) c.throttle = true;
    if (c.phase === "tree" || c.phase === "run") c.throttle = true;
    if (c.phase === "run" && c.rpm > SHIFT_AT + 100 && c.shiftT <= 0) shift();
    if (c.phase === "done") {
      c.tree += dt;
      if (c.tree > 2.5) Object.assign(c, freshCar(c.best));
    }
  }

  function simulate(c: DragCar, dt: number, t: number) {
    stepDrag(c, dt, t, rec.current, {
      green: (slip) => {
        if (!play) return;
        const au = getAudio();
        if (au && slip > 0.3) burst(au, { freq: 1700, q: 6, dur: 0.25, gain: 0.2 * Math.min(1, slip) });
      },
      finish: () => {
        if (!play) return;
        const faster = c.vsBest === null || c.vsBest < 0;
        bestVisit = c.best;
        if (faster) {
          rec.current.push(QUARTER);
          bestPath = Float32Array.from(rec.current);
        }
        const vs = c.vsBest === null ? "" : c.vsBest < 0 ? ` ${Math.abs(c.vsBest).toFixed(2)} seconds faster than your best.` : ` ${c.vsBest.toFixed(2)} seconds off your best.`;
        const sh = c.shifts;
        setDone(
          `Quarter mile in ${c.t.toFixed(2)} seconds at ${c.trap.toFixed(0)} mph. Reaction ${(c.reaction ?? 0).toFixed(2)} seconds. 60 feet in ${c.sixtyFt?.toFixed(2) ?? "—"}. 0 to 60 in ${c.split60?.toFixed(2) ?? "—"}. Launch: ${c.launch.toLowerCase()}. Shifts: ${sh.perfect} perfect, ${sh.good} good, ${sh.early} early, ${sh.late} late. Par is ${parEt().toFixed(2)}.${vs}`,
        );
      },
    });
  }

  function voice(c: DragCar) {
    const e = eng.current;
    // off the throttle at high revs in a run: the exhaust crackles
    if (play && wasThrottle.current && !c.throttle && c.phase === "run" && c.rpm > 5200) {
      const au = getAudio();
      if (au) for (let i = 0, at = 0; i < 4; i++) burst(au, { freq: 260 + Math.random() * 500, q: 1.2, dur: 0.03, gain: 0.2 + Math.random() * 0.2, at: (at += 0.04 + Math.random() * 0.08) });
      c.pop = Math.max(c.pop, 0.7);
    }
    wasThrottle.current = c.throttle;
    if (!e) return;
    e.update({ rpm: c.rpm, pedal: c.pedal, throttle: c.throttle, cut: c.phase === "run" && c.shiftT > 0 });
  }

  /** the end card: the time, how the three things went (the reaction, the launch, the shifts), par, and whether it beat the best of this visit */
  function drawResult(ctx: CanvasRenderingContext2D, c: DragCar, w: number, area: number, t: number) {
    const k = Math.min(1, c.doneT / 0.25);
    ctx.globalAlpha = k;
    ctx.fillStyle = "rgba(8,10,9,0.8)";
    ctx.fillRect(0, 0, w, area);
    const narrow = w < 560;
    const pw = Math.min(440, w - 24);
    const ph = narrow ? 252 : 264;
    const x = w / 2 - pw / 2;
    const y = Math.max(10, area / 2 - ph / 2);
    ctx.fillStyle = "rgba(10,13,12,0.94)";
    ctx.beginPath();
    ctx.roundRect(x, y, pw, ph, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(138,217,168,0.55)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const px = x + 24;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    mono(ctx, 11);
    ctx.fillStyle = "#8ad9a8";
    ctx.fillText("QUARTER MILE", px, y + 34);
    // what a run with the launch, the throttle and the shifts all right takes: the number to chase
    const p = parEt();
    ctx.fillStyle = "#b5b6ab";
    ctx.textAlign = "right";
    ctx.fillText(`PAR ${p.toFixed(2)}`, x + pw - 24, y + 34);
    ctx.textAlign = "left";
    ctx.fillStyle = "#f2ead7";
    display(ctx, narrow ? 64 : 76, 800);
    ctx.fillText(c.t.toFixed(2), px, y + (narrow ? 100 : 108));
    const tw = ctx.measureText(c.t.toFixed(2)).width;
    mono(ctx, 12);
    ctx.fillStyle = "#b5b6ab";
    ctx.fillText("SECONDS", px + tw + 10, y + (narrow ? 100 : 108));
    const sh = c.shifts;
    const shifts = sh.perfect + sh.good + sh.early + sh.late;
    const rows: [string, string, string?][] = [
      ["REACTION", `${(c.reaction ?? 0).toFixed(2)} S`, (c.reaction ?? 0) > 0.15 ? "#ffd23f" : undefined],
      ["LAUNCH", c.launch ? `${c.launch.replace(" LAUNCH", "")} · ${(c.launchRpm / 1000).toFixed(1)}K` : "—", c.launch === "PERFECT LAUNCH" || c.launch === "GREAT LAUNCH" ? "#8ad9a8" : "#ffd23f"],
      ["SHIFTS", `${sh.perfect} OF ${shifts} PERFECT`, sh.perfect === shifts ? "#8ad9a8" : undefined],
      ["TRAP", `${Math.round(c.trap)} MPH`],
    ];
    mono(ctx, 11);
    rows.forEach(([name, val, col], i) => {
      const colN = i % 2, row = Math.floor(i / 2);
      const cxp = px + colN * (pw - 48) / 2;
      const cyp = y + (narrow ? 134 : 146) + row * 32;
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText(name, cxp, cyp);
      ctx.fillStyle = col ?? "#f2ead7";
      ctx.fillText(val, cxp, cyp + 15);
    });
    // one thing to do better, then (after the first run) how this one compares with the best of the visit
    mono(ctx, 11);
    const vs = c.vsBest;
    ctx.fillStyle = "#f2ead7";
    ctx.fillText(dragAdvice(c, p), px, y + ph - (vs === null ? 24 : 46));
    if (vs !== null) {
      ctx.fillStyle = vs < 0 ? "#8ad9a8" : "#ffd23f";
      ctx.fillText(vs < 0 ? `NEW BEST, ${Math.abs(vs).toFixed(2)} S QUICKER` : `BEST ${(c.t - vs).toFixed(2)} · ${vs.toFixed(2)} S OFF`, px, y + ph - 24);
    }
    ctx.globalAlpha = 1;
    void t;
  }

  /** a car seen from above, nose to the right at `nose`: graphite with a mint line, tail lamps, a wing */
  function topCar(ctx: CanvasRenderingContext2D, nose: number, yc: number, len: number, o: { ghost?: boolean; brake?: boolean; alpha?: number }) {
    const hh = len * 0.19;
    const x = nose - len;
    ctx.globalAlpha = o.alpha ?? 1;
    // a soft shadow under the body, thrown a little down and back from the floodlights
    if (!o.ghost) {
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.beginPath();
      ctx.roundRect(x - 2, yc - hh + 3, len + 4, hh * 2 + 1, len * 0.14);
      ctx.fill();
    }
    // wheels first, a little proud of the body
    ctx.fillStyle = o.ghost ? "rgba(242,234,215,0.35)" : "#06080a";
    for (const wx of [x + len * 0.12, x + len * 0.68]) {
      ctx.fillRect(wx, yc - hh - 1.5, len * 0.2, 2.5);
      ctx.fillRect(wx, yc + hh - 1, len * 0.2, 2.5);
    }
    ctx.beginPath();
    ctx.roundRect(x, yc - hh, len, hh * 2, len * 0.12);
    if (o.ghost) {
      ctx.fillStyle = "rgba(242,234,215,0.14)";
      ctx.fill();
      ctx.strokeStyle = "rgba(242,234,215,0.75)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#3b4658";
      ctx.fill();
      ctx.fillStyle = "#8ad9a8";
      ctx.fillRect(x + len * 0.1, yc - 0.8, len * 0.8, 1.6);
      ctx.fillStyle = "#0a0e14";
      ctx.beginPath();
      ctx.roundRect(x + len * 0.38, yc - hh * 0.68, len * 0.26, hh * 1.36, 2);
      ctx.fill();
      ctx.fillStyle = "#1f2733";
      ctx.fillRect(x - 1, yc - hh - 1, len * 0.07, hh * 2 + 2);
      ctx.fillStyle = o.brake ? "#ff4a3a" : "#c2261b";
      ctx.fillRect(x, yc - hh * 0.8, 2, hh * 0.5);
      ctx.fillRect(x, yc + hh * 0.3, 2, hh * 0.5);
      ctx.fillStyle = "#fff4d6";
      ctx.fillRect(x + len - 2.5, yc - hh * 0.8, 2.5, hh * 0.4);
      ctx.fillRect(x + len - 2.5, yc + hh * 0.4, 2.5, hh * 0.4);
    }
    ctx.globalAlpha = 1;
  }

  /** the start tree, on the wall beside the line: the stage lights, three ambers a half second apart, and the green (steady: nothing here flashes) */
  function startTree(ctx: CanvasRenderingContext2D, c: DragCar, geo: ReturnType<typeof stripGeom>) {
    const th = Math.min(118, geo.ry * 0.22);
    const tx = geo.x0 + 30;
    const top = geo.ry - th;
    ctx.fillStyle = "#0a100e";
    ctx.beginPath();
    ctx.roundRect(tx - 11, top, 22, th, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(242,234,215,0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
    const staged = (c.phase === "tree" || (c.phase === "idle" && c.stageHeld > 0.15)) && c.throttle;
    const run = c.phase === "run" && c.t < 0.9;
    const rows = 5;
    const dy = (th - 12) / rows;
    for (let i = 0; i < rows; i++) {
      const y = top + 9 + dy * (i + 0.5);
      let on = false;
      let col = "255,179,0";
      if (i === 0) {
        on = staged;
        col = "225,240,255";
      } else if (i <= 3) on = c.phase === "tree" && sinceAmber(c) >= (i - 1) * TREE_STEP_S;
      else {
        on = run;
        col = "61,220,132";
      }
      const r = i === 0 ? 4 : 5.5;
      if (i === 0) {
        for (const ox of [-5, 5]) {
          ctx.fillStyle = on ? `rgb(${col})` : "#1c211e";
          ctx.beginPath();
          ctx.arc(tx + ox, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = on ? `rgb(${col})` : "#1c211e";
        ctx.beginPath();
        ctx.arc(tx, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (on) {
        // the glow is a small picture made once per colour
        const bulbs = (layers.current.bulbs ??= {});
        let spr = bulbs[col];
        if (!spr) {
          spr = bulbs[col] = document.createElement("canvas");
          spr.width = spr.height = 40;
          const x = spr.getContext("2d")!;
          const g = x.createRadialGradient(20, 20, 0, 20, 20, 20);
          g.addColorStop(0, `rgba(${col},0.45)`);
          g.addColorStop(1, `rgba(${col},0)`);
          x.fillStyle = g;
          x.fillRect(0, 0, 40, 40);
        }
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(spr, tx - 20, y - 20);
        ctx.globalCompositeOperation = "source-over";
      }
    }
  }

  function draw(ctx: CanvasRenderingContext2D, c: DragCar, w: number, h: number, t: number, dt: number, reduce: boolean) {
    const dpr = Math.max(1, ctx.getTransform().a);
    // the lanes at the bottom: two when played (you, and the best run of this visit), one on the tile
    const geo = stripGeom(w, h, play);
    const { lanes, roadH, ry, laneH, carLen, x0, x1 } = geo;

    // the place: sky, stands, towers, wall and asphalt, drawn once per size
    layers.current.ground = layer(layers.current.ground, `${w}x${h}@${dpr}|${play}`, w, h, dpr, (x) => paintStrip(x, w, h, play));
    ctx.drawImage(layers.current.ground.c, 0, 0, w, h);

    // ---- the lanes: start line, eighth mile, thousand feet and the line, you and your best
    const at = (m: number) => x0 + (Math.min(m, QUARTER + 60) / QUARTER) * (x1 - x0);
    // flowing streaks behind the cars at speed
    if (!reduce && c.v > 14) {
      ctx.fillStyle = `rgba(242,234,215,${Math.min(0.1, c.v / 900).toFixed(3)})`;
      for (let i = 0; i < 9; i++) {
        const yy = ry + ((i * 0.618) % 1) * (roadH - 4) + 2;
        const len = 30 + (i % 3) * 22;
        const xx = w - ((i * 977 + t * c.v * 9) % (w + len));
        ctx.fillRect(xx, yy, len, 1.5);
      }
    }
    ctx.fillStyle = "rgba(138,217,168,0.25)";
    ctx.fillRect(0, ry, w, 2);
    ctx.fillStyle = "#8ad9a8";
    ctx.fillRect(0, ry, w * Math.min(1, c.x / QUARTER), 2);
    // lane divider
    if (lanes > 1) {
      ctx.fillStyle = "rgba(242,234,215,0.22)";
      for (let xx = x0 - 20; xx < x1; xx += 28) ctx.fillRect(xx, ry + laneH - 1, 14, 2);
    }
    // marks on the road
    ctx.fillStyle = "#f2ead7";
    ctx.fillRect(x0, ry, 3, roadH);
    ctx.fillStyle = "rgba(242,234,215,0.28)";
    ctx.fillRect(at(201.2), ry, 1.5, roadH);
    ctx.fillRect(at(304.8), ry, 1.5, roadH);
    const sq = Math.max(5, roadH / 8);
    for (let k = 0; k * sq < roadH; k++) {
      ctx.fillStyle = k % 2 ? "#f2ead7" : "#0b0d0c";
      ctx.fillRect(x1, ry + k * sq, 5, Math.min(sq, roadH - k * sq));
      ctx.fillStyle = k % 2 ? "#0b0d0c" : "#f2ead7";
      ctx.fillRect(x1 + 5, ry + k * sq, 5, Math.min(sq, roadH - k * sq));
    }
    if (play) {
      // the distances, on boards along the foot of the strip, lit
      mono(ctx, 9);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      for (const [m, label] of [[201.2, "1/8 MILE"], [304.8, "1000 FT"]] as const) {
        const bw = ctx.measureText(label).width + 12;
        ctx.fillStyle = "rgba(8,12,10,0.9)";
        ctx.beginPath();
        ctx.roundRect(at(m) - bw / 2, h - 17, bw, 13, 3);
        ctx.fill();
        ctx.strokeStyle = "rgba(242,234,215,0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "rgba(242,234,215,0.9)";
        ctx.fillText(label, at(m), h - 7);
      }
      ctx.textAlign = "left";
      if (w >= 560) startTree(ctx, c, geo);
    }
    // the ghost and the car
    const yMe = ry + laneH * (lanes - 0.5);
    const yGhost = ry + laneH * 0.5;
    const ghost = play ? bestPath : null;
    if (ghost && (c.phase === "run" || c.phase === "done" || c.phase === "tree" || c.phase === "idle")) {
      const gx = c.phase === "run" ? ghostAt(ghost, c.t) : c.phase === "done" ? QUARTER : 0;
      topCar(ctx, at(gx), yGhost, carLen, { ghost: true, alpha: 0.9 });
      mono(ctx, 9);
      ctx.fillStyle = "rgba(242,234,215,0.8)";
      ctx.fillText("YOUR BEST", 8, yGhost + 3);
    }
    // tyre smoke (the launch: the tyres spin until they bite)
    const P = puffs.current;
    if (play && !reduce && c.phase === "run" && c.slip > 0.12) {
      P.acc += dt * 90 * Math.min(1, c.slip);
      while (P.acc >= 1) {
        P.acc -= 1;
        const i = P.i;
        P.i = (i + 1) % PUFFS;
        P.x[i] = at(c.x) - carLen * 0.9;
        P.y[i] = yMe + (Math.random() - 0.5) * laneH * 0.4;
        P.vx[i] = -10 - Math.random() * 30;
        P.vy[i] = (Math.random() - 0.5) * 24;
        P.age[i] = 0;
        P.life[i] = 0.7 + Math.random() * 0.7;
        P.size[i] = 5 + Math.random() * 5;
      }
    }
    for (let i = 0; i < PUFFS; i++) {
      if (P.age[i] >= P.life[i]) continue;
      P.age[i] += dt;
      const k = P.age[i] / P.life[i];
      P.x[i] += P.vx[i] * dt;
      P.y[i] += P.vy[i] * dt;
      ctx.fillStyle = `rgba(205,210,215,${(0.42 * (1 - k)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(P.x[i], P.y[i], P.size[i] * (1 + 1.8 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    // the car's nose on the line it has reached; the exhaust flares on a shift
    const meX = at(c.phase === "done" ? c.x : Math.min(c.x, QUARTER + 12));
    if (c.pop > 0 && !reduce) {
      ctx.fillStyle = `rgba(255,160,60,${(c.pop * 0.9).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(meX - carLen, yMe - 3);
      ctx.lineTo(meX - carLen - (8 + 22 * c.pop), yMe);
      ctx.lineTo(meX - carLen, yMe + 3);
      ctx.fill();
    }
    if (play && c.phase !== "done") {
      // the headlights, thrown down the lane (a picture made once per size)
      const bw = carLen * 2.6;
      layers.current.beam = layer(layers.current.beam, `${laneH.toFixed(1)}|${carLen.toFixed(1)}@${dpr}`, bw, laneH, dpr, (x) => {
        const beam = x.createLinearGradient(0, 0, bw, 0);
        beam.addColorStop(0, "rgba(255,244,214,0.2)");
        beam.addColorStop(1, "rgba(255,244,214,0)");
        x.fillStyle = beam;
        x.beginPath();
        x.moveTo(0, laneH / 2 - carLen * 0.12);
        x.lineTo(bw, laneH / 2 - laneH * 0.42);
        x.lineTo(bw, laneH / 2 + laneH * 0.42);
        x.lineTo(0, laneH / 2 + carLen * 0.12);
        x.closePath();
        x.fill();
      });
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(layers.current.beam.c, meX, yMe - laneH / 2, bw, laneH);
      ctx.globalCompositeOperation = "source-over";
    }
    topCar(ctx, meX, yMe, carLen, { brake: c.phase === "done" || !c.throttle });

    // ---- the dial
    const area = ry;
    // narrow (a phone, played): the dial is centred and big, speed and the
    // stats sit in a row under it, the prompt under that. Nothing shares a line.
    const stacked = play && w < 560;
    // narrow, the mode switch sits across the top right of the stage: the shift lights go under it
    const ledY = stacked ? 62 : Math.max(16, area * 0.07);
    const dialTop = ledY + 24;
    const foot = stacked ? 124 : 100; // stats block (64 to 80) + the call-out row + gaps
    const R = stacked ? Math.max(36, Math.min(w * 0.38, (area - dialTop - foot) / 1.8)) : Math.min(w * 0.3, area * 0.42);
    const cx = stacked ? w / 2 : Math.min(w * 0.36, w / 2 - R * 0.2);
    const cy = stacked ? dialTop + R * 1.06 : area * 0.55;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (r: number) => a0 + (r / 9000) * (a1 - a0);
    // the face (the track, the red zone, the numbers) once per size
    const half = R * 1.3;
    layers.current.face = layer(layers.current.face, `${w}x${h}@${dpr}|${R.toFixed(1)}`, half * 2, half * 2, dpr, (x) => {
      x.translate(half, half);
      x.lineWidth = R * 0.07;
      x.lineCap = "round";
      x.strokeStyle = "#1c211e";
      x.beginPath();
      x.arc(0, 0, R, a0, a1);
      x.stroke();
      x.strokeStyle = "#c2412d";
      x.beginPath();
      x.arc(0, 0, R, ang(REDLINE), a1);
      x.stroke();
      display(x, Math.round(R * 0.14), 700);
      x.textAlign = "center";
      x.textBaseline = "middle";
      for (let k = 0; k <= 9; k++) {
        const an = ang(k * 1000);
        x.fillStyle = k * 1000 >= REDLINE ? "#e5604a" : "#f2ead7";
        x.fillText(String(k), Math.cos(an) * R * 0.78, Math.sin(an) * R * 0.78);
        x.fillRect(Math.cos(an) * R * 0.9 - 1, Math.sin(an) * R * 0.9 - 1, 2, 2);
      }
      mono(x, Math.round(R * 0.09));
      x.fillStyle = "#b5b6ab";
      x.fillText("RPM ×1000", 0, -R * 0.32);
    });
    ctx.drawImage(layers.current.face.c, cx - half, cy - half, half * 2, half * 2);
    ctx.lineWidth = R * 0.07;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#8ad9a8";
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, ang(Math.min(9000, c.rpm)));
    ctx.stroke();
    // the launch band, outside the dial while staging: the revs to hold at the green, with the sweet spot marked
    const staging = play && (c.phase === "idle" || c.phase === "tree");
    if (staging) {
      const inBand = c.rpm >= LAUNCH.lo && c.rpm <= LAUNCH.hi;
      ctx.lineCap = "butt";
      ctx.lineWidth = R * 0.05;
      ctx.strokeStyle = inBand ? "#8ad9a8" : "rgba(138,217,168,0.4)";
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.1, ang(LAUNCH.lo), ang(LAUNCH.hi));
      ctx.stroke();
      const sa = ang(LAUNCH.sweet);
      ctx.lineWidth = Math.max(2, R * 0.025);
      ctx.strokeStyle = "#f2ead7";
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sa) * R * 1.03, cy + Math.sin(sa) * R * 1.03);
      ctx.lineTo(cx + Math.cos(sa) * R * 1.16, cy + Math.sin(sa) * R * 1.16);
      ctx.stroke();
      ctx.lineCap = "round";
    }
    // needle (it shivers on the limiter unless motion is reduced)
    const na = ang(c.rpm) + (!reduce && c.rpm >= LIMIT - 40 ? (Math.random() - 0.5) * 0.04 : 0);
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
    // gear inside the dial
    ctx.fillStyle = "#f2ead7";
    display(ctx, Math.round(R * 0.5), 800);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c.phase === "run" || c.phase === "done" ? String(c.gear + 1) : "N", cx, cy + R * 0.42);

    // shift lights across the top: they fill as the revs climb and go blue, steadily, at the shift point
    const leds = 12;
    const lw = Math.min(26, (w * 0.5) / leds);
    const lx = w / 2 - (leds * lw * 1.3) / 2;
    const shiftNow = c.rpm >= SHIFT_AT;
    for (let i = 0; i < leds; i++) {
      const on = c.rpm >= 4200 + i * ((SHIFT_AT - 4200) / leds);
      const col = i < 4 ? "#3ddc84" : i < 8 ? "#ffd23f" : "#ff4d4d";
      ctx.fillStyle = on ? (shiftNow ? "#5ab0ff" : col) : "#1c211e";
      ctx.beginPath();
      ctx.arc(lx + i * lw * 1.3 + lw / 2, ledY, lw * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }

    // right column: speed, time, splits, the gap to your best, tree
    const gap = ghost && c.phase === "run" ? gapToGhost(ghost, c.t, c.x) : null;
    const lines = [
      `TIME   ${c.phase === "run" || c.phase === "done" ? c.t.toFixed(2) : "—"}`,
      `0–60   ${c.split60 ? c.split60.toFixed(2) : "—"}`,
      `DIST   ${Math.min(402, Math.round(c.x))} / 402 m`,
      `BEST   ${c.best ? c.best.toFixed(2) : "—"}`,
    ];
    if (ghost) lines.push(`GAP    ${gap === null ? "—" : `${gap <= 0 ? "−" : "+"}${Math.abs(gap).toFixed(2)}`}`);
    const speed = String(Math.round(c.phase === "done" ? c.trap : c.v * 2.237)).padStart(3, " "); // after the line it holds the speed over it
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const lineMono = play ? 13 : 9;
    let rx: number;
    // the end card carries the numbers once the run is over: the column is still laid out (the tree uses rx) but not drawn
    ctx.save();
    if (play && c.phase === "done") ctx.globalAlpha = 0;
    if (stacked) {
      const top = area - foot + 4;
      const big = 46;
      display(ctx, big, 800);
      const sw = ctx.measureText("888").width;
      mono(ctx, 12);
      const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const gapX = 22;
      rx = Math.max(12, (w - (sw + gapX + tw)) / 2);
      ctx.fillStyle = "#f2ead7";
      display(ctx, big, 800);
      ctx.fillText(speed, rx, top + 40);
      mono(ctx, 12);
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText("MPH", rx + 3, top + 58);
      lines.forEach((l, i) => ctx.fillText(l, rx + sw + gapX, top + 12 + i * 16));
    } else {
      rx = Math.min(Math.max(cx + R * 1.2, w * 0.62), w - (play ? 170 : 110));
      ctx.fillStyle = "#f2ead7";
      display(ctx, Math.round(Math.min(h * 0.2, w * 0.11)), 800);
      ctx.fillText(speed, rx, area * 0.42);
      mono(ctx, play ? 12 : 9);
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText("MPH", rx + 4, area * 0.42 + 16);
      mono(ctx, lineMono);
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 4 && gap !== null ? (gap <= 0 ? "#8ad9a8" : "#ffd23f") : "#b5b6ab";
        ctx.fillText(l, rx + 4, area * 0.42 + 42 + i * (play ? 20 : 13));
      });
    }
    ctx.restore();

    // the tree again in the corner where there is no room for one on the wall (a phone) or no wall (the tile)
    if ((c.phase === "tree" || c.phase === "idle") && (stacked || !play)) {
      const tx = stacked ? w - 16 : rx + (play ? 210 : 120), ty = stacked ? dialTop + 4 : area * 0.22;
      for (let i = 0; i < 4; i++) {
        const lit = c.phase === "tree" && (i < 3 ? sinceAmber(c) >= i * TREE_STEP_S : c.tree >= treeTime(c));
        ctx.fillStyle = lit ? (i < 3 ? "#ffb300" : "#3ddc84") : "#1c211e";
        ctx.beginPath();
        ctx.arc(tx, ty + i * (play ? 22 : 15), play ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // call-outs sit on the row above the lanes, where the staging prompt is, so nothing lands on the dial's numbers
    if (c.call && t - c.callT < 0.9 && (play || c.phase === "run")) {
      ctx.globalAlpha = 1 - (t - c.callT) / 0.9;
      ctx.fillStyle = c.call === "PERFECT" || c.call === "PERFECT LAUNCH" || c.call === "GREAT LAUNCH" ? "#8ad9a8" : "#ffd23f";
      display(ctx, stacked ? 24 : Math.round(Math.max(24, R * 0.22)), 800);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(c.call, w / 2, ry - (stacked ? 10 : 20));
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }
    if (play && (c.phase === "idle" || c.phase === "tree")) {
      mono(ctx, 12);
      ctx.textAlign = "center";
      let line: string;
      if (c.phase === "idle") {
        ctx.fillStyle = "#f2ead7";
        line = w < 640 ? "HOLD THE THROTTLE TO STAGE" : "HOLD THE THROTTLE TO STAGE · THEN KEEP THE REVS IN THE BAND";
      } else {
        // the light is counting: say where the revs are against the band
        const inBand = c.rpm >= LAUNCH.lo && c.rpm <= LAUNCH.hi;
        ctx.fillStyle = inBand ? "#8ad9a8" : "#ffd23f";
        line = c.rpm > LAUNCH.hi ? "TOO MANY REVS: EASE OFF" : c.rpm < LAUNCH.lo ? "TOO FEW REVS: GIVE IT SOME" : "IN THE BAND: HOLD IT FOR THE GREEN";
      }
      ctx.fillText(line, w / 2, ry - 14);
      ctx.textAlign = "left";
    }
    // the shift light, in words (steady: the lights above already show it), for the eye that is on the road and not the top of the dash
    if (play && c.phase === "run" && c.rpm >= SHIFT_AT - 200 && c.gear < RATIOS.length - 1 && c.shiftT <= 0) {
      ctx.fillStyle = "#5ab0ff";
      display(ctx, Math.round(R * 0.2), 800);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("SHIFT", cx, cy - R * 0.1);
      ctx.textAlign = "left";
    }
    if (play && c.phase === "done") drawResult(ctx, c, w, area, t);
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
            onClick={() => done && again()}
            className="flex-1 h-16 rounded-xl bg-[#1d5e3f] text-[#f2ead7] font-mono text-xs uppercase tracking-[0.2em] active:scale-[0.98] select-none touch-none"
          >
            {done ? "Run again" : "Throttle · hold"}
          </button>
          <button
            type="button"
            onPointerDown={shift}
            className="w-40 h-16 rounded-xl bg-[#f2ead7] text-[#0d100e] font-mono text-xs uppercase tracking-[0.2em] active:scale-[0.98] select-none touch-none"
          >
            Shift ↑
          </button>
          <p aria-live="polite" className="sr-only">
            {done}
          </p>
        </div>
      )}
    </div>
  );
}

