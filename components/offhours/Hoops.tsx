"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio, tone } from "./audio";
import { display, mono } from "./font";
import { useRemote } from "@/lib/link/remote";
import { HOOPS_CAL, flickShot, parseFlick, parseSwipe, swipeShot, type HoopsShot } from "./hoopsRemote";
import {
  BALL, BOARD_Z, CLEAR_MISS, HOOP_SLIDE_AT, HOOP_Z, KEY_AIM_STEP, KEY_ASSIST, KEY_CHARGE, READY_AFTER_MAKE, READY_AFTER_TOUCH, RIM_R, RIM_Y, START,
  hoopRate, hoopVx, launch, missWhy, newFlight, stepFlight, stepHoop, type Flight, type Hoop, type V3,
} from "./hoopsModel";

// Arcade hoops, head-on. You stand at the line; swipe up to shoot and the
// ball flies into the screen in 3D (a perspective camera over metres). The
// swipe sets aim (left/right) and power (speed); a gentle aim assist pulls
// a decent shot toward the rim, so good swipes drop and bad ones clank. The
// rim, glass and floor are real collisions; the net swings when you score.
// 30 seconds on the clock (it starts with your first shot). Three in a row
// and you're on fire: double points. Twenty points and the hoop starts to
// slide (the assist leads it, and chevrons on the rim show which way it is
// going); thirty-two and it speeds up. Keyboard: arrows aim, hold Space to
// charge, let go to shoot. A linked phone shoots too (see hoopsRemote.ts):
// flick it up like a ball, or swipe its screen; both end in shoot() below.
// The physics and the hoop's motion are in hoopsModel.ts.

const CAM = { y: 1.5, z: -1.4 };
const CLOCK = 30;
/** the final screen takes no input for this long, so a flick at the buzzer can't skip it */
const OVER_GUARD = 0.8;
/** a swipe made this close to the next ball is held for it */
const QUEUE_WINDOW = 0.3;

type Pop = { text: string; t: number; hot: boolean; life: number };
type SwipeLine = { pts: { x: number; y: number }[]; t: number; ok: boolean };
type Queued = (ball: V3) => HoopsShot | null;

// the best of this visit, kept across closing and reopening the piece (no storage)
let bestEver = 0;

export default function Hoops({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [status, setStatus] = useState("");
  const S = useRef({
    f: newFlight({ x: 0, y: START.y, z: START.z }) as Flight,
    state: "ready" as "ready" | "fly",
    /** when the next ball comes back (clock time), once the shot in the air is settled */
    readyAt: null as number | null,
    queued: null as Queued | null,
    hoop: { x: 0, t: 0 } as Hoop,
    score: 0,
    streak: 0,
    shots: 0,
    makes: 0,
    best: bestEver,
    newBest: false,
    clock: CLOCK,
    running: false,
    over: false,
    overAt: 0,
    tickSent: -1,
    lateShot: false,
    pops: [] as Pop[],
    net: 0, // swing energy
    trail: [] as V3[],
    swipe: [] as { x: number; y: number; t: number }[],
    line: null as SwipeLine | null,
    /** a swipe too slow to shoot: the ball dims for a moment */
    rejectAt: -9,
    dragging: false,
    kbd: false,
    aimX: 0,
    charging: false,
    power: 0,
    auto: 1,
    t: 0,
  });
  const cam = useRef({ f: 1, cx: 0, hz: 0, w: 1, h: 1 });

  const P = (x: number, y: number, z: number) => {
    const { f, cx, hz } = cam.current;
    const d = Math.max(0.2, z - CAM.z);
    return { x: cx + (f * x) / d, y: hz + (f * (CAM.y - y)) / d, s: f / d };
  };

  const sfx = (k: "rim" | "board" | "floor" | "swish" | "fire" | "buzzer" | "release" | "break", v = 1) => {
    if (!play) return;
    const au = getAudio();
    if (!au) return;
    const g = Math.min(1, v / 5);
    if (k === "rim") {
      tone(au, { freq: 640, dur: 0.4, gain: 0.12 * g, type: "triangle" });
      tone(au, { freq: 1580, dur: 0.2, gain: 0.05 * g });
    } else if (k === "board") burst(au, { freq: 240, q: 0.8, type: "lowpass", dur: 0.13, gain: 0.5 * g });
    else if (k === "floor") {
      tone(au, { freq: 130, to: 70, dur: 0.12, gain: 0.35 * g });
      burst(au, { freq: 420, type: "lowpass", dur: 0.05, gain: 0.25 * g });
    } else if (k === "swish") burst(au, { freq: 5200, q: 0.6, type: "highpass", dur: 0.3, gain: 0.2 });
    else if (k === "release") burst(au, { freq: 900, q: 1, dur: 0.05, gain: 0.12 });
    else if (k === "break") tone(au, { freq: 520, to: 260, dur: 0.14, gain: 0.1, type: "triangle" });
    else if (k === "buzzer") {
      tone(au, { freq: 220, dur: 0.9, gain: 0.18, type: "square" });
      tone(au, { freq: 277, dur: 0.9, gain: 0.12, type: "square" });
    } else [784, 988, 1175].forEach((f, i) => tone(au, { freq: f, dur: 0.2, gain: 0.08, at: i * 0.06, type: "square" }));
  };

  const pop = (text: string, hot = false, life = 1.2) => S.current.pops.push({ text, t: S.current.t, hot, life });

  const newBall = () => {
    const s = S.current;
    s.f = newFlight({ x: (Math.random() - 0.5) * (s.score >= 10 ? 1.0 : 0.6), y: START.y, z: START.z });
    s.state = "ready";
    s.readyAt = null;
    s.lateShot = false;
    s.trail = [];
    // the keys aim from the ball: sideways is the player's to line up
    s.aimX = s.f.ball.x;
  };

  const reset = () => {
    const s = S.current;
    s.score = 0;
    s.streak = 0;
    s.shots = 0;
    s.makes = 0;
    s.clock = CLOCK;
    s.running = false;
    s.over = false;
    s.newBest = false;
    s.queued = null;
    s.hoop.x = 0;
    s.hoop.t = 0;
    newBall();
    setStatus("");
  };

  // shoot: aim is a world x the player is going for; power ~1 is perfect.
  // The assist (hoopsModel.launch) pulls a decent shot toward the rim and leads a sliding hoop.
  const shoot = (aimX: number, power: number, keys = false) => {
    const s = S.current;
    if (s.state !== "ready" || s.over) return;
    if (!s.running && play) s.running = true;
    const l = launch(s.f.ball, s.hoop, s.score, aimX, power, keys ? { assist: KEY_ASSIST.z, assistX: KEY_ASSIST.x } : {});
    s.f.vel = l.vel;
    s.f.spin = -9;
    s.state = "fly";
    s.readyAt = null;
    s.f.flyT = 0;
    s.shots++;
    s.lateShot = s.clock <= 0.05 ? false : true;
    sfx("release");
  };

  // A shot made in the last moments before the next ball comes back is held for it,
  // not dropped. `make` turns the swipe into a shot from wherever the new ball is.
  const attempt = (make: Queued) => {
    const s = S.current;
    if (s.over) return;
    if (s.state === "ready") {
      const sh = make(s.f.ball);
      if (sh) shoot(sh.aimX, sh.power);
    } else if (s.readyAt !== null && s.readyAt - s.t <= QUEUE_WINDOW) s.queued = make;
  };

  // A linked phone: its flick (or swipe) is a shot from the line, or a restart
  // after the buzzer. It is told the score, the clock and how each shot went so
  // its controller matches. Without a phone none of this does anything.
  const { linked, send } = useRemote(play ? "hoops" : null, {
    gesture: (name, data) => {
      const s = S.current;
      let make: Queued | null = null;
      if (name === "hoops-flick") {
        const f = parseFlick(data);
        if (f) make = (b) => flickShot(f.power, f.aim, b.x);
      } else if (name === "hoops-swipe") {
        const v = parseSwipe(data);
        if (v) make = (b) => swipeShot(v.vx, v.vy, b.x, b.z, HOOP_Z, HOOPS_CAL.phoneSwipeGain);
      } else if (name === "hoops-sync") tell();
      if (!make || !make(s.f.ball)) return;
      if (s.over) {
        // a flick still in the air at the buzzer shouldn't skip the final screen
        if (s.t - s.overAt > 1.2) reset();
      } else attempt(make);
      tell();
    },
  });
  const tell = (result: "" | "swish" | "make" | "miss" = "", pts = 0) => {
    if (!play) return; // the tile's autopilot isn't the visitor's game
    const s = S.current;
    send({
      type: "gesture",
      name: "hoops-state",
      data: { score: s.score, makes: s.makes, shots: s.shots, streak: s.streak, clock: Math.ceil(s.clock), best: s.best, over: s.over, running: s.running, result, pts },
    });
  };
  const tellRef = useRef(tell);
  tellRef.current = tell;
  useEffect(() => {
    if (linked) tellRef.current();
  }, [linked]);

  const ref = useCanvas(
    ({ ctx, w, h, t, dt }) => {
      const s = S.current;
      s.t = t;
      const f = Math.min(h * 0.95, w * 1.15);
      cam.current = { f, cx: w / 2, hz: h * 0.46, w, h };

      // ---- clock, sliding hoop, preview autopilot
      if (s.running && !s.over) {
        s.clock = Math.max(0, s.clock - dt);
        if (s.clock === 0 && s.state === "ready") endGame();
      }
      stepHoop(s.hoop, s.score, dt);
      if (!play && s.state === "ready") {
        s.auto -= dt;
        if (s.auto <= 0) {
          shoot(s.hoop.x + (Math.random() - 0.5) * 0.6, 1 + (Math.random() - 0.5) * 0.35);
          s.auto = 1.5;
        }
      }
      if (s.charging) s.power = Math.min(1.6, s.power + dt * KEY_CHARGE);
      // the phone's clock follows ours, once a second
      if (s.running && !s.over && s.tickSent !== Math.ceil(s.clock)) {
        s.tickSent = Math.ceil(s.clock);
        tellRef.current();
      }

      // ---- physics
      const n = 5;
      for (let i = 0; i < n; i++) {
        stepFly(dt / n, t);
        if (s.state === "fly" && s.streak >= 3 && Math.random() < 0.5) {
          s.trail.push({ ...s.f.ball });
          if (s.trail.length > 18) s.trail.shift();
        }
      }
      if (s.state === "fly") {
        const b = s.f.ball;
        if ((s.readyAt !== null && t >= s.readyAt) || s.f.flyT > 2.2 || b.z > BOARD_Z + 3 || b.z < -1 || Math.abs(b.x) > 6) finishShot();
      }
      s.net = Math.max(0, s.net - dt * 1.6);
      s.pops = s.pops.filter((p) => t - p.t < p.life);

      // ---- arena
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#0b0918");
      bg.addColorStop(0.55, "#1a1238");
      bg.addColorStop(1, "#0f0b22");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // stands
      const floorY = P(0, 0, 12).y;
      for (let i = 0; i < 260; i++) {
        const x = ((i * 97.13) % 1) * w, y = floorY - 8 - (((i * 57.7) % 1) * h * 0.22);
        ctx.fillStyle = i % 5 === 0 ? "#00788c" : i % 3 === 0 ? "#3b2a7a" : "#2a2150";
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x, y + (s.net > 0.5 ? Math.sin(t * 20 + i) * 1.5 : 0), 3, 3);
      }
      ctx.globalAlpha = 1;
      display(ctx, h * 0.05);
      ctx.fillStyle = "rgba(0,120,140,0.55)";
      ctx.textAlign = "center";
      ctx.fillText("BUZZ CITY", w / 2, floorY - h * 0.02);
      ctx.textAlign = "left";
      // floor: hardwood with perspective boards and the paint
      const fl = ctx.createLinearGradient(0, floorY, 0, h);
      fl.addColorStop(0, "#8a5f33");
      fl.addColorStop(1, "#d1a160");
      ctx.fillStyle = fl;
      ctx.fillRect(0, floorY, w, h - floorY);
      ctx.strokeStyle = "rgba(60,35,15,0.18)";
      ctx.lineWidth = 1;
      for (let x = -8; x <= 8; x += 0.5) {
        const a = P(x, 0, 0.2), b = P(x, 0, 12);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const quad = (pts: [number, number, number][], fill: string) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        pts.forEach(([x, y, z], i) => {
          const q = P(x, y, z);
          (i ? ctx.lineTo : ctx.moveTo).call(ctx, q.x, q.y);
        });
        ctx.fill();
      };
      quad([[-2.45, 0, HOOP_Z - 5.8], [2.45, 0, HOOP_Z - 5.8], [2.45, 0, BOARD_Z + 1.2], [-2.45, 0, BOARD_Z + 1.2]], "rgba(0,120,140,0.55)");
      // ---- the hoop: stanchion, glass, rim, net
      const hx = s.hoop.x;
      const glassTL = P(hx - 0.9, 4.0, BOARD_Z), glassBR = P(hx + 0.9, 2.9, BOARD_Z);
      ctx.fillStyle = "#2a2440";
      const pole = P(hx, 0, BOARD_Z + 1.0), poleTop = P(hx, 3.3, BOARD_Z + 1.0);
      ctx.fillRect(pole.x - pole.s * 0.08, poleTop.y, pole.s * 0.16, pole.y - poleTop.y);
      ctx.fillStyle = "rgba(225,240,250,0.16)";
      ctx.fillRect(glassTL.x, glassTL.y, glassBR.x - glassTL.x, glassBR.y - glassTL.y);
      ctx.strokeStyle = "rgba(242,234,215,0.9)";
      ctx.lineWidth = Math.max(2, glassTL.s * 0.04);
      ctx.strokeRect(glassTL.x, glassTL.y, glassBR.x - glassTL.x, glassBR.y - glassTL.y);
      const boxTL = P(hx - 0.3, 3.5, BOARD_Z), boxBR = P(hx + 0.3, 3.08, BOARD_Z);
      ctx.strokeStyle = "#e05a1b";
      ctx.strokeRect(boxTL.x, boxTL.y, boxBR.x - boxTL.x, boxBR.y - boxTL.y);
      // the clock lives top right when you play; the tile preview has no HUD, so its board shows it
      if (!play) {
        display(ctx, glassTL.s * 0.32);
        ctx.fillStyle = "#f2ead7";
        ctx.textAlign = "center";
        ctx.fillText("30", (glassTL.x + glassBR.x) / 2, glassTL.y - glassTL.s * 0.08);
        ctx.textAlign = "left";
      }

      const ring = (y: number, r: number, swayX = 0, swayZ = 0) =>
        Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return { x: hx + Math.cos(a) * r + swayX, y, z: HOOP_Z + Math.sin(a) * r + swayZ, back: Math.sin(a) > 0 };
        });
      const rim = ring(RIM_Y, RIM_R);
      const sway = Math.sin(t * 18) * s.net * 0.06;
      const netBot = ring(RIM_Y - 0.42 + s.net * 0.05, 0.13, sway, s.net * 0.04);
      const vx = hoopVx(s.hoop, s.score);
      const slide = Math.min(1, Math.abs(vx) / (0.7 * hoopRate(HOOP_SLIDE_AT)));
      const drawRim = (back: boolean) => {
        ctx.strokeStyle = "#e05a1b";
        ctx.lineWidth = Math.max(2, P(hx, RIM_Y, HOOP_Z).s * 0.04);
        // a sliding hoop glows, brighter the faster it is going
        ctx.shadowColor = "#ffb347";
        ctx.shadowBlur = slide * 10;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= 24; i++) {
          const p = rim[i % 24];
          if (p.back !== back && !(i % 24 === 0 || i % 24 === 12)) {
            started = false;
            continue;
          }
          const q = P(p.x, p.y, p.z);
          if (!started) {
            ctx.moveTo(q.x, q.y);
            started = true;
          } else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      };
      drawRim(true);
      // net
      ctx.strokeStyle = "rgba(242,234,215,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 24; i += 2) {
        const a = P(rim[i].x, rim[i].y, rim[i].z);
        const b = P(netBot[(i + 2) % 24].x, netBot[(i + 2) % 24].y, netBot[(i + 2) % 24].z);
        const c = P(netBot[(i + 22) % 24].x, netBot[(i + 22) % 24].y, netBot[(i + 22) % 24].z);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
      }
      netBot.forEach((p, i) => {
        const q = P(p.x, p.y, p.z);
        (i ? ctx.lineTo : ctx.moveTo).call(ctx, q.x, q.y);
      });
      ctx.stroke();

      // ---- ball (behind or in front of the front rim)
      const ballBehind = s.f.ball.z > HOOP_Z - 0.05;
      if (ballBehind) drawBall(ctx, s, t);
      drawRim(false);
      if (!ballBehind) drawBall(ctx, s, t);
      // chevrons on the side the hoop is heading for; they fade as it slows to turn round
      if (slide > 0.05 && play) {
        const dir = Math.sign(vx);
        const c = P(hx, RIM_Y, HOOP_Z);
        const cw = Math.max(6, c.s * 0.1);
        ctx.lineWidth = Math.max(2.5, c.s * 0.035);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = 0; i < 3; i++) {
          const x = c.x + dir * (c.s * (RIM_R + 0.1) + i * cw * 1.5);
          ctx.strokeStyle = `rgba(255,179,71,${slide * (0.95 - i * 0.28)})`;
          ctx.beginPath();
          ctx.moveTo(x - dir * cw * 0.5, c.y - cw);
          ctx.lineTo(x + dir * cw * 0.5, c.y);
          ctx.lineTo(x - dir * cw * 0.5, c.y + cw);
          ctx.stroke();
        }
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
      }

      // keyboard aim + power
      if (play && s.state === "ready" && s.kbd) {
        const a = P(s.f.ball.x, s.f.ball.y, s.f.ball.z), b = P(s.aimX, RIM_Y, HOOP_Z);
        ctx.strokeStyle = "rgba(242,234,215,0.35)";
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (s.charging) {
          const mw = 160, mx = w / 2 - mw / 2, my = h - 28;
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(mx, my, mw, 8);
          ctx.fillStyle = Math.abs(s.power - 1) < 0.15 ? "#8ad9a8" : "#f2ead7";
          ctx.fillRect(mx, my, mw * (s.power / 1.6), 8);
          ctx.fillStyle = "#8ad9a8";
          ctx.fillRect(mx + mw * (1 / 1.6) - 1, my - 3, 2, 14);
        }
      }

      // the swipe, as drawn: fades once the finger is up; a swipe too slow to shoot shows in amber
      const ln = s.line;
      if (ln && play) {
        const k = s.dragging ? 0 : (t - ln.t) / 0.45;
        if (k >= 1) s.line = null;
        else if (ln.pts.length > 1) {
          ctx.strokeStyle = ln.ok ? "#f2ead7" : "#ffb347";
          ctx.globalAlpha = (ln.ok ? 0.3 : 0.75) * (1 - k);
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ln.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.stroke();
          ctx.lineCap = "butt";
          ctx.lineJoin = "miter";
          ctx.globalAlpha = 1;
        }
      }

      // ---- HUD
      display(ctx, play ? 44 : 26);
      ctx.fillStyle = "#f2ead7";
      ctx.fillText(String(s.score), 16, play ? 52 : 32);
      mono(ctx, play ? 11 : 9);
      ctx.fillStyle = "#b5b6ab";
      const fire = s.streak >= 3;
      const status = `${fire ? "ON FIRE ×2" : s.streak ? `STREAK ${s.streak}` : ""}${s.score >= HOOP_SLIDE_AT && !s.over ? `${fire || s.streak ? "  ·  " : ""}HOOP MOVING` : ""}`;
      // narrow: the status can't sit beside the score without running under the backboard, so it drops to the bottom-left
      const narrow = w < 520;
      ctx.fillText(narrow ? `${s.makes}/${s.shots}` : `${s.makes}/${s.shots}${status ? `  ·  ${status}` : ""}`, 18, play ? 72 : 46);
      if (narrow && status && !s.over) {
        ctx.fillStyle = fire ? "#ffb347" : "#b5b6ab";
        ctx.fillText(status, 18, h - 10);
      }
      if (play) {
        display(ctx, 28);
        ctx.textAlign = "right";
        ctx.fillStyle = s.clock < 5 && s.running ? "#ff5a4a" : "#f2ead7";
        ctx.fillText(`0:${String(Math.ceil(s.clock)).padStart(2, "0")}`, w - 16, 44);
        mono(ctx, 10);
        ctx.fillStyle = "#b5b6ab";
        ctx.fillText(s.best ? `BEST ${s.best}` : "", w - 16, 62);
        ctx.textAlign = "left";
      }
      // pops
      ctx.textAlign = "center";
      for (const p of s.pops) {
        const k = (t - p.t) / p.life;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.hot ? "#ffb347" : "#f2ead7";
        display(ctx, Math.min(w, h) * (play ? 0.09 : 0.12));
        ctx.fillText(p.text, w / 2, h * 0.36 - k * 40);
      }
      ctx.globalAlpha = 1;
      if (play && s.state === "ready" && !s.running && !s.over && !s.charging) {
        mono(ctx, 12);
        ctx.fillStyle = "rgba(242,234,215,0.8)";
        ctx.fillText(linked ? "FLICK YOUR PHONE UP TO SHOOT" : "SWIPE UP TO SHOOT", w / 2, h - 18);
      }
      if (s.over) {
        ctx.fillStyle = "rgba(11,9,24,0.72)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#f2ead7";
        display(ctx, Math.min(w, h) * 0.08);
        ctx.fillText("FINAL", w / 2, h * 0.36);
        display(ctx, Math.min(w, h) * 0.22);
        ctx.fillText(String(s.score), w / 2, h * 0.36 + Math.min(w, h) * 0.22);
        mono(ctx, 12);
        ctx.fillStyle = "#b5b6ab";
        const stats = `${s.makes} OF ${s.shots}  ·  BEST ${s.best}`;
        // the prompt waits out the input guard, so it never invites a tap that would be ignored
        const again = play && t - s.overAt > OVER_GUARD ? "TAP TO GO AGAIN" : "";
        if (s.newBest) {
          ctx.fillStyle = "#ffb347";
          ctx.fillText("NEW BEST", w / 2, h * 0.36 + Math.min(w, h) * 0.3 - 24);
          ctx.fillStyle = "#b5b6ab";
        }
        const sy = h * 0.36 + Math.min(w, h) * 0.3;
        // a narrow canvas: the prompt drops to its own line rather than running off both edges
        if (!again || ctx.measureText(`${stats}  ·  ${again}`).width <= w - 24) ctx.fillText(again ? `${stats}  ·  ${again}` : stats, w / 2, sy);
        else {
          ctx.fillText(stats, w / 2, sy);
          ctx.fillText(again, w / 2, sy + 20);
        }
      }
      ctx.textAlign = "left";
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      onDown: (p) => {
        const s = S.current;
        if (s.over) {
          if (s.t - s.overAt > OVER_GUARD) reset();
          return;
        }
        // a swipe can start while the last ball is still settling; it is held for the next
        s.dragging = true;
        s.swipe = [{ x: p.x, y: p.y, t: performance.now() }];
        s.line = { pts: [{ x: p.x, y: p.y }], t: s.t, ok: true };
      },
      onMove: (p) => {
        const s = S.current;
        if (!s.dragging) return;
        s.swipe.push({ x: p.x, y: p.y, t: performance.now() });
        if (s.swipe.length > 12) s.swipe.shift();
        s.line?.pts.push({ x: p.x, y: p.y });
      },
      onUp: (p) => {
        const s = S.current;
        if (!s.dragging) return;
        s.dragging = false;
        const now = performance.now();
        s.swipe.push({ x: p.x, y: p.y, t: now });
        const recent = s.swipe.filter((q) => now - q.t < 160);
        const a = recent[0] ?? s.swipe[0];
        const b = s.swipe[s.swipe.length - 1];
        const dtt = Math.max(16, b.t - a.t) / 1000;
        const vy = (b.y - a.y) / dtt, vx = (b.x - a.x) / dtt;
        const { h } = cam.current;
        s.line?.pts.push({ x: p.x, y: p.y });
        if (s.line) s.line.t = s.t;
        // the same shot the phone's swipe makes (hoopsRemote.ts), in screen heights per second
        const make: Queued = (ball) => swipeShot(vx / h, vy / h, ball.x, ball.z, HOOP_Z);
        if (!make(s.f.ball)) {
          // too slow or not upward: say so, and the ball stays ready
          if (s.line) s.line.ok = false;
          s.rejectAt = s.t;
          return;
        }
        attempt(make);
      },
      keys: (e, down) => {
        const s = S.current;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          if (down) {
            s.kbd = true;
            s.aimX += e.key === "ArrowLeft" ? -KEY_AIM_STEP : KEY_AIM_STEP;
          }
          return true;
        }
        if (e.key === " " || e.key === "Enter") {
          if (s.over) {
            if (down && s.t - s.overAt > OVER_GUARD) reset();
            return true;
          }
          if (down && !e.repeat && s.state === "ready") {
            s.kbd = true;
            s.charging = true;
            s.power = 0;
          } else if (!down && s.charging) {
            s.charging = false;
            shoot(s.aimX, s.power, true);
            s.power = 0;
          }
          return true;
        }
        return false;
      },
    },
  );

  function endGame() {
    const s = S.current;
    if (s.over) return;
    s.over = true;
    s.overAt = s.t;
    s.running = false;
    s.newBest = s.best > 0 && s.score > s.best;
    s.best = Math.max(s.best, s.score);
    bestEver = s.best;
    sfx("buzzer");
    tellRef.current();
    if (play) setStatus(`Time. ${s.score} points, ${s.makes} of ${s.shots}. Best ${s.best}.`);
  }

  // one slice of the shot in the air: hoopsModel does the flight, this reacts to it
  function stepFly(dt: number, t: number) {
    const s = S.current;
    if (s.state !== "fly") return;
    const soon = (at: number) => {
      s.readyAt = Math.min(s.readyAt ?? Infinity, at);
    };
    stepFlight(s.f, s.hoop.x, dt, t, {
      contact: (kind, v, loud) => {
        if (loud) sfx(kind, v);
        // the ball is dead soon after its first knock
        if (!s.f.scored) soon(t + READY_AFTER_TOUCH);
      },
      cross: (dx, dz) => {
        const d = Math.hypot(dx, dz);
        // well wide of the rim: nothing more will happen, so the next ball comes now
        if (d > CLEAR_MISS) soon(t);
        else if (d >= RIM_R - BALL * 0.35) soon(t + 0.3);
      },
      score: (swish) => {
        s.makes++;
        s.streak++;
        const fire = s.streak >= 3;
        const pts = (swish ? 3 : 2) * (fire ? 2 : 1);
        const before = s.score;
        s.score += pts;
        s.net = 1;
        // after a make the ball drops through the net, then the next one is up
        s.readyAt = t + READY_AFTER_MAKE;
        tellRef.current(swish ? "swish" : "make", pts);
        sfx("swish");
        if (s.streak === 3) sfx("fire");
        const late = s.clock <= 0 && s.running;
        pop(late ? `BUZZER BEATER +${pts}` : s.streak === 3 ? `ON FIRE +${pts}` : swish ? `SWISH +${pts}` : `+${pts}`, fire || late);
        if (s.score >= HOOP_SLIDE_AT && before < HOOP_SLIDE_AT) window.setTimeout(() => pop("THE HOOP IS MOVING"), 700);
      },
    });
  }

  // the shot in the air is settled: count a miss and bring the next ball (and any swipe held for it)
  function finishShot() {
    const s = S.current;
    const over = s.clock <= 0 && s.running;
    if (!s.f.scored) {
      if (s.streak > 0) sfx("break");
      s.streak = 0;
      if (!over) pop(missWhy(s.f), false, 0.6);
      tellRef.current("miss");
    }
    if (over) endGame();
    const q = s.queued;
    s.queued = null;
    newBall();
    if (q && !s.over) {
      const sh = q(s.f.ball);
      if (sh) shoot(sh.aimX, sh.power);
    }
  }

  function drawBall(ctx: CanvasRenderingContext2D, s: typeof S.current, t: number) {
    // fire trail
    for (let i = 0; i < s.trail.length; i++) {
      const q = P(s.trail[i].x, s.trail[i].y, s.trail[i].z);
      const k = i / s.trail.length;
      ctx.fillStyle = `rgba(255,${Math.round(110 + 110 * k)},40,${k * 0.6})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, BALL * q.s * (0.4 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    const b = s.f.ball;
    const sh = P(b.x, 0, b.z);
    const q = P(b.x, b.y, b.z);
    const r = BALL * q.s;
    // a swipe too slow to shoot dims the ball for a moment; it stays ready
    ctx.globalAlpha = t - s.rejectAt < 0.45 ? 0.55 : 1;
    ctx.fillStyle = `rgba(0,0,0,${0.35 / (1 + b.y)})`;
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(q.x - r * 0.35, q.y - r * 0.4, r * 0.1, q.x, q.y, r);
    g.addColorStop(0, "#ffa057");
    g.addColorStop(1, "#b9461a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
    // seams, rolling with backspin
    ctx.save();
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(30,15,10,0.75)";
    ctx.lineWidth = Math.max(1, r * 0.08);
    const ph = s.f.rot;
    ctx.beginPath();
    ctx.moveTo(q.x - r, q.y);
    ctx.lineTo(q.x + r, q.y);
    for (const k of [0, Math.PI]) {
      const yy = q.y + Math.sin(ph + k) * r * 0.75;
      ctx.moveTo(q.x - r, yy);
      ctx.quadraticCurveTo(q.x, yy + Math.cos(ph + k) * r * 0.5, q.x + r, yy);
    }
    ctx.moveTo(q.x, q.y - r);
    ctx.lineTo(q.x, q.y + r);
    ctx.stroke();
    ctx.restore();
    if (s.streak >= 3) {
      ctx.strokeStyle = `rgba(255,170,60,${0.5 + 0.3 * Math.sin(t * 20)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  return (
    <>
      <canvas
        ref={ref}
        data-autofocus={play || undefined}
        role={play ? "img" : undefined}
        aria-label={play ? "An arcade basketball hoop. Swipe up to shoot; or aim with the arrow keys and hold Space to charge, release to shoot. 30 seconds on the clock." : undefined}
        className="absolute inset-0 w-full h-full outline-none touch-none"
      />
      {linked && (
        <p
          data-testid="hoops-phone-hint"
          className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-full bg-[#0d100e]/80 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]"
        >
          <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-[#8ad9a8] align-middle" />
          Flick your phone
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </>
  );
}
