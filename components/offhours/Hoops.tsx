"use client";

import { useRef, useState } from "react";
import { useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio, tone } from "./audio";
import { display, mono } from "./font";

// Arcade hoops, head-on. You stand at the line; swipe up to shoot and the
// ball flies into the screen in 3D (a perspective camera over metres). The
// swipe sets aim (left/right) and power (speed); a gentle aim assist pulls
// a decent shot toward the rim, so good swipes drop and bad ones clank. The
// rim, glass and floor are real collisions; the net swings when you score.
// 30 seconds on the clock (it starts with your first shot). Three in a row
// and you're on fire: double points. Ten points and the hoop starts to
// slide; twenty and it speeds up. Keyboard: arrows aim, hold Space to
// charge, let go to shoot.

const G = 9.8;
const BALL = 0.12;
const RIM_R = 0.23;
const RIM_Y = 3.05;
const HOOP_Z = 4.4;
const BOARD_Z = HOOP_Z + 0.36;
const CAM = { y: 1.5, z: -1.4 };
const START = { y: 1.0, z: 0.6 };
const CLOCK = 30;
const ASSIST = 0.55;

type V3 = { x: number; y: number; z: number };
type Pop = { text: string; t: number; hot: boolean };

export default function Hoops({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [status, setStatus] = useState("");
  const S = useRef({
    ball: { x: 0, y: START.y, z: START.z } as V3,
    vel: { x: 0, y: 0, z: 0 } as V3,
    spin: 0,
    rot: 0,
    state: "ready" as "ready" | "fly",
    flyT: 0,
    scored: false,
    touched: false,
    hoopX: 0,
    hoopT: 0,
    score: 0,
    streak: 0,
    shots: 0,
    makes: 0,
    best: 0,
    clock: CLOCK,
    running: false,
    over: false,
    lateShot: false,
    pops: [] as Pop[],
    net: 0, // swing energy
    trail: [] as V3[],
    swipe: [] as { x: number; y: number; t: number }[],
    dragging: false,
    aimX: 0,
    charging: false,
    power: 0,
    auto: 1,
    lastHit: 0,
    t: 0,
  });
  const cam = useRef({ f: 1, cx: 0, hz: 0, w: 1, h: 1 });

  const P = (x: number, y: number, z: number) => {
    const { f, cx, hz } = cam.current;
    const d = Math.max(0.2, z - CAM.z);
    return { x: cx + (f * x) / d, y: hz + (f * (CAM.y - y)) / d, s: f / d };
  };

  const sfx = (k: "rim" | "board" | "floor" | "swish" | "fire" | "buzzer" | "release", v = 1) => {
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
    else if (k === "buzzer") {
      tone(au, { freq: 220, dur: 0.9, gain: 0.18, type: "square" });
      tone(au, { freq: 277, dur: 0.9, gain: 0.12, type: "square" });
    } else [784, 988, 1175].forEach((f, i) => tone(au, { freq: f, dur: 0.2, gain: 0.08, at: i * 0.06, type: "square" }));
  };

  const pop = (text: string, hot = false) => S.current.pops.push({ text, t: S.current.t, hot });

  const newBall = () => {
    const s = S.current;
    s.ball = { x: (Math.random() - 0.5) * (s.score >= 10 ? 1.0 : 0.6), y: START.y, z: START.z };
    s.vel = { x: 0, y: 0, z: 0 };
    s.state = "ready";
    s.scored = false;
    s.touched = false;
    s.lateShot = false;
    s.trail = [];
    s.aimX = s.hoopX;
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
    s.hoopX = 0;
    s.hoopT = 0;
    newBall();
    setStatus("");
  };

  // shoot: aim is a world x the player is going for; power ~1 is perfect
  const shoot = (aimX: number, power: number) => {
    const s = S.current;
    if (s.state !== "ready" || s.over) return;
    if (!s.running && play) s.running = true;
    // assist pulls a decent shot toward the rim; misses still miss
    const errX = Math.max(-1.4, Math.min(1.4, aimX - s.hoopX)) * (1 - ASSIST);
    const errZ = Math.max(-1.6, Math.min(1.6, (power - 1) * 1.4)) * (1 - ASSIST);
    const target = { x: s.hoopX + errX, y: RIM_Y + 0.08, z: HOOP_Z + errZ };
    const T = 0.85 + 0.12 * Math.min(1.5, power);
    const b = s.ball;
    s.vel = { x: (target.x - b.x) / T, y: (target.y - b.y) / T + 0.5 * G * T, z: (target.z - b.z) / T };
    s.spin = -9;
    s.state = "fly";
    s.flyT = 0;
    s.shots++;
    s.lateShot = s.clock <= 0.05 ? false : true;
    sfx("release");
  };

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
      if (s.score >= 10) {
        s.hoopT += dt * (s.score >= 20 ? 1.7 : 1.1);
        s.hoopX = Math.sin(s.hoopT) * 0.7;
      } else s.hoopX += (0 - s.hoopX) * Math.min(1, dt * 3);
      if (!play && s.state === "ready") {
        s.auto -= dt;
        if (s.auto <= 0) {
          shoot(s.hoopX + (Math.random() - 0.5) * 0.6, 1 + (Math.random() - 0.5) * 0.35);
          s.auto = 1.5;
        }
      }
      if (s.charging) s.power = Math.min(1.6, s.power + dt * 1.1);

      // ---- physics
      const n = 5;
      for (let i = 0; i < n; i++) step(s, dt / n, t);
      s.net = Math.max(0, s.net - dt * 1.6);
      for (const p of s.pops) void p;
      s.pops = s.pops.filter((p) => t - p.t < 1.2);

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
      const hx = s.hoopX;
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
      // shot clock on the board
      display(ctx, glassTL.s * 0.32);
      ctx.fillStyle = s.clock < 5 && s.running ? "#ff5a4a" : "#f2ead7";
      ctx.textAlign = "center";
      ctx.fillText(s.running || s.over ? String(Math.ceil(s.clock)).padStart(2, "0") : "30", (glassTL.x + glassBR.x) / 2, glassTL.y - glassTL.s * 0.08);
      ctx.textAlign = "left";

      const ring = (y: number, r: number, swayX = 0, swayZ = 0) =>
        Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return { x: hx + Math.cos(a) * r + swayX, y, z: HOOP_Z + Math.sin(a) * r + swayZ, back: Math.sin(a) > 0 };
        });
      const rim = ring(RIM_Y, RIM_R);
      const sway = Math.sin(t * 18) * s.net * 0.06;
      const netBot = ring(RIM_Y - 0.42 + s.net * 0.05, 0.13, sway, s.net * 0.04);
      const drawRim = (back: boolean) => {
        ctx.strokeStyle = "#e05a1b";
        ctx.lineWidth = Math.max(2, P(hx, RIM_Y, HOOP_Z).s * 0.04);
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
      const ballBehind = s.ball.z > HOOP_Z - 0.05;
      if (ballBehind) drawBall(ctx, s, t);
      drawRim(false);
      if (!ballBehind) drawBall(ctx, s, t);

      // keyboard aim + power
      if (play && s.state === "ready" && (s.charging || s.aimX !== s.hoopX)) {
        const a = P(s.ball.x, s.ball.y, s.ball.z), b = P(s.aimX, RIM_Y, HOOP_Z);
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
          ctx.fillStyle = Math.abs(s.power - 1) < 0.12 ? "#8ad9a8" : "#f2ead7";
          ctx.fillRect(mx, my, mw * (s.power / 1.6), 8);
          ctx.fillStyle = "#8ad9a8";
          ctx.fillRect(mx + mw * (1 / 1.6) - 1, my - 3, 2, 14);
        }
      }

      // ---- HUD
      display(ctx, play ? 44 : 26);
      ctx.fillStyle = "#f2ead7";
      ctx.fillText(String(s.score), 16, play ? 52 : 32);
      mono(ctx, play ? 11 : 9);
      ctx.fillStyle = "#b5b6ab";
      const fire = s.streak >= 3;
      const status = `${fire ? "ON FIRE ×2" : s.streak ? `STREAK ${s.streak}` : ""}${s.score >= 10 && !s.over ? `${fire || s.streak ? "  ·  " : ""}HOOP MOVING` : ""}`;
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
        const k = (t - p.t) / 1.2;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.hot ? "#ffb347" : "#f2ead7";
        display(ctx, Math.min(w, h) * (play ? 0.09 : 0.12));
        ctx.fillText(p.text, w / 2, h * 0.36 - k * 40);
      }
      ctx.globalAlpha = 1;
      if (play && s.state === "ready" && !s.running && !s.over) {
        mono(ctx, 12);
        ctx.fillStyle = "rgba(242,234,215,0.8)";
        ctx.fillText("SWIPE UP ON THE BALL TO SHOOT", w / 2, h - 18);
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
        const again = play ? "TAP TO GO AGAIN" : "";
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
          reset();
          return;
        }
        if (s.state !== "ready") return;
        s.dragging = true;
        s.swipe = [{ x: p.x, y: p.y, t: performance.now() }];
      },
      onMove: (p) => {
        const s = S.current;
        if (!s.dragging) return;
        s.swipe.push({ x: p.x, y: p.y, t: performance.now() });
        if (s.swipe.length > 12) s.swipe.shift();
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
        if (-vy < h * 0.5) return; // not a swipe up
        // a natural flick is "right"; much faster or slower drifts long/short,
        // on a log scale so the sweet spot is wide
        const power = 1 + 0.45 * Math.log2(-vy / (h * 1.6));
        const aim = s.ball.x + (vx / -vy) * (HOOP_Z - s.ball.z);
        shoot(aim, power);
      },
      keys: (e, down) => {
        const s = S.current;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          if (down) s.aimX += e.key === "ArrowLeft" ? -0.08 : 0.08;
          return true;
        }
        if (e.key === " " || e.key === "Enter") {
          if (s.over) {
            if (down) reset();
            return true;
          }
          if (down && !e.repeat && s.state === "ready") {
            s.charging = true;
            s.power = 0;
          } else if (!down && s.charging) {
            s.charging = false;
            shoot(s.aimX, s.power);
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
    s.running = false;
    s.best = Math.max(s.best, s.score);
    sfx("buzzer");
    if (play) setStatus(`Time. ${s.score} points, ${s.makes} of ${s.shots}. Best ${s.best}.`);
  }

  function step(s: typeof S.current, dt: number, t: number) {
    if (s.state !== "fly") return;
    s.flyT += dt;
    const b = s.ball, v = s.vel;
    const py = b.y;
    v.y -= G * dt;
    b.x += v.x * dt;
    b.y += v.y * dt;
    b.z += v.z * dt;
    s.rot += s.spin * dt;
    if (s.streak >= 3 && Math.random() < 0.5) s.trail.push({ ...b });
    if (s.trail.length > 18) s.trail.shift();
    // rim: 24 points round the ring
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rx = s.hoopX + Math.cos(a) * RIM_R, rz = HOOP_Z + Math.sin(a) * RIM_R;
      const dx = b.x - rx, dy = b.y - RIM_Y, dz = b.z - rz;
      const d = Math.hypot(dx, dy, dz), min = BALL + 0.012;
      if (d < min && d > 0) {
        const nx = dx / d, ny = dy / d, nz = dz / d;
        b.x = rx + nx * min;
        b.y = RIM_Y + ny * min;
        b.z = rz + nz * min;
        const vn = v.x * nx + v.y * ny + v.z * nz;
        if (vn < 0) {
          v.x -= 1.55 * vn * nx;
          v.y -= 1.55 * vn * ny;
          v.z -= 1.55 * vn * nz;
          v.x *= 0.85;
          v.z *= 0.85;
          s.touched = true;
          if (t - s.lastHit > 0.08) sfx("rim", -vn);
          s.lastHit = t;
        }
      }
    }
    // glass
    if (b.z + BALL > BOARD_Z && v.z > 0 && Math.abs(b.x - s.hoopX) < 0.9 && b.y > 2.9 && b.y < 4.0) {
      b.z = BOARD_Z - BALL;
      sfx("board", v.z);
      v.z *= -0.55;
      s.touched = true;
    }
    // through the hoop
    if (!s.scored && py >= RIM_Y && b.y < RIM_Y && v.y < 0 && Math.hypot(b.x - s.hoopX, b.z - HOOP_Z) < RIM_R - BALL * 0.35) {
      s.scored = true;
      s.makes++;
      s.streak++;
      const fire = s.streak >= 3;
      const swish = !s.touched;
      const pts = (swish ? 3 : 2) * (fire ? 2 : 1);
      s.score += pts;
      s.net = 1;
      sfx("swish");
      if (s.streak === 3) sfx("fire");
      const late = s.clock <= 0 && s.running;
      pop(late ? `BUZZER BEATER +${pts}` : s.streak === 3 ? `ON FIRE +${pts}` : swish ? `SWISH +${pts}` : `+${pts}`, fire || late);
      if (s.score >= 10 && s.score - pts < 10) window.setTimeout(() => pop("THE HOOP IS MOVING"), 700);
      // slow the ball through the net
      v.x *= 0.3;
      v.z *= 0.3;
    }
    // floor
    if (b.y < BALL) {
      b.y = BALL;
      if (Math.abs(v.y) > 1) sfx("floor", -v.y);
      v.y = -v.y * 0.62;
      v.x *= 0.8;
      v.z *= 0.8;
    }
    // done
    // back to the line quickly: after it drops through, or once a miss is dead
    const dead = (s.scored && b.y < 1.2) || (!s.scored && s.flyT > 1.2 && b.y < 0.6);
    if (dead || s.flyT > 2.2 || b.z > BOARD_Z + 3 || b.z < -1 || Math.abs(b.x) > 6) {
      if (!s.scored) s.streak = 0;
      if (s.clock <= 0 && s.running) endGame();
      newBall();
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
    const b = s.ball;
    const sh = P(b.x, 0, b.z);
    const q = P(b.x, b.y, b.z);
    const r = BALL * q.s;
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
    const ph = s.rot;
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
  }

  return (
    <>
      <canvas
        ref={ref}
        data-autofocus={play || undefined}
        role={play ? "img" : undefined}
        aria-label={play ? "An arcade basketball hoop. Swipe up on the ball to shoot; or aim with the arrow keys and hold Space to charge, release to shoot. 30 seconds on the clock." : undefined}
        className="absolute inset-0 w-full h-full outline-none touch-none"
      />
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </>
  );
}
