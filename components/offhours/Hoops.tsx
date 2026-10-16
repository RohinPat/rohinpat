"use client";

import { useRef } from "react";
import { useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio, tone } from "./audio";
import { display, mono } from "./font";

// Side-on half court, in metres. Flick the ball: it flies under real
// gravity, rattles off the rim (two collision points) and the glass, and
// drops through a verlet-cloth net that swishes. Every shot lands on a
// shot chart (makes and misses by distance); three makes in a row and the
// ball catches fire. Keyboard: arrows aim, hold Space to power up.

const G = 9.8;
const BALL = 0.12;
const RIM_Y = 3.05;
const HOOP_X = 8.6; // rim centre
const RIM_R = 0.23;
const BOARD_X = HOOP_X + RIM_R + 0.16;
const WORLD = { x0: -0.6, x1: 9.6, y1: 4.7 };

type V = { x: number; y: number };
type Node = { x: number; y: number; px: number; py: number; pin: boolean };
type Shot = { d: number; lat: number; made: boolean };

function makeNet(): { nodes: Node[]; links: [number, number, number][] } {
  const cols = 6, rows = 5;
  const nodes: Node[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const taper = 1 - j * 0.07;
      const x = HOOP_X + (i / (cols - 1) - 0.5) * 2 * RIM_R * taper;
      const y = RIM_Y - j * 0.1;
      nodes.push({ x, y, px: x, py: y, pin: j === 0 });
    }
  const links: [number, number, number][] = [];
  const id = (i: number, j: number) => j * cols + i;
  const L = (a: number, b: number) => links.push([a, b, Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y)]);
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols; i++) {
      if (i + 1 < cols) L(id(i, j), id(i + 1, j + 1));
      if (i - 1 >= 0) L(id(i, j), id(i - 1, j + 1));
      L(id(i, j), id(i, j + 1));
    }
  return { nodes, links };
}

export default function Hoops({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const S = useRef({
    ball: { x: 2, y: 2.2, vx: 0, vy: 0, spin: 0, rot: 0 },
    spot: { x: 2, y: 2.2 },
    state: "hold" as "hold" | "drag" | "fly",
    hist: [] as { x: number; y: number; t: number }[],
    net: makeNet(),
    shots: [] as Shot[],
    scored: false,
    touched: false,
    streak: 0,
    points: 0,
    banner: "",
    bannerT: 0,
    fire: [] as { x: number; y: number; vx: number; vy: number; life: number }[],
    flyT: 0,
    auto: 1.2,
    aim: 0.95,
    power: 0,
    charging: false,
    lastHit: 0,
  });
  const view = useRef({ k: 1, ox: 0, oy: 0 });
  const crowd = useRef(
    Array.from({ length: 700 }, (_, i) => {
      const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
      return { x: r(1), y: r(2), c: r(3) };
    }),
  );

  const toWorld = (px: number, py: number): V => {
    const { k, ox, oy } = view.current;
    return { x: (px - ox) / k, y: (oy - py) / k };
  };

  const newSpot = (s: typeof S.current) => {
    const d = play ? 1.6 + Math.random() * 6.4 : 1.8 + Math.random() * 2.8; // metres from the rim
    s.spot = { x: HOOP_X - d, y: 2.1 };
    s.ball = { x: s.spot.x, y: s.spot.y, vx: 0, vy: 0, spin: 0, rot: s.ball.rot };
    s.state = "hold";
    s.scored = false;
    s.touched = false;
  };

  const shoot = (vx: number, vy: number) => {
    const s = S.current;
    const sp = Math.hypot(vx, vy);
    const cap = 14;
    if (sp > cap) {
      vx = (vx / sp) * cap;
      vy = (vy / sp) * cap;
    }
    s.ball.vx = vx;
    s.ball.vy = vy;
    s.ball.spin = -6; // backspin
    s.state = "fly";
    s.flyT = 0;
  };

  const sfx = (kind: "rim" | "board" | "floor" | "swish" | "fire", v = 1) => {
    if (!play) return;
    const au = getAudio();
    if (!au) return;
    const g = Math.min(1, v / 6);
    if (kind === "rim") {
      tone(au, { freq: 620, dur: 0.35, gain: 0.12 * g, type: "triangle" });
      tone(au, { freq: 1530, dur: 0.18, gain: 0.05 * g, type: "sine" });
    } else if (kind === "board") burst(au, { freq: 220, q: 0.8, type: "lowpass", dur: 0.12, gain: 0.5 * g });
    else if (kind === "floor") {
      tone(au, { freq: 120, to: 70, dur: 0.12, gain: 0.35 * g });
      burst(au, { freq: 400, type: "lowpass", dur: 0.05, gain: 0.25 * g });
    } else if (kind === "swish") burst(au, { freq: 5200, q: 0.6, type: "highpass", dur: 0.28, gain: 0.18 });
    else [784, 988, 1175].forEach((f, i) => tone(au, { freq: f, dur: 0.2, gain: 0.08, at: i * 0.06, type: "square" }));
  };

  const ref = useCanvas(
    ({ ctx, w, h, t, dt, p }) => {
      const s = S.current;
      // fit the world
      // the tile preview frames in close on the hoop
      const x0 = play ? WORLD.x0 : 3.4;
      const k = Math.min(w / (WORLD.x1 - x0), (h - 10) / WORLD.y1);
      const floorY = h - Math.max(18, h * 0.08);
      view.current = { k, ox: (w - (WORLD.x1 - x0) * k) / 2 - x0 * k, oy: floorY };
      const X = (x: number) => view.current.ox + x * k;
      const Y = (y: number) => floorY - y * k;

      // --- simulate (fixed substeps)
      const n = 4;
      for (let i = 0; i < n; i++) physics(s, dt / n, t);

      // preview / idle auto-shooter
      if (!play && s.state === "hold") {
        s.auto -= dt;
        if (s.auto <= 0) {
          const [vx, vy] = solve(s.spot, Math.random() < 0.72 ? 0 : (Math.random() - 0.5) * 0.9);
          shoot(vx, vy);
          s.auto = 1.6;
        }
      }
      if (s.state === "hold" && s.charging) s.power = Math.min(1, s.power + dt * 0.7);
      if (s.state === "drag") {
        const wp = toWorld(p.x, p.y);
        const dx = wp.x - s.spot.x, dy = wp.y - s.spot.y;
        const dd = Math.hypot(dx, dy);
        const lim = 1.1;
        s.ball.x = s.spot.x + (dd > lim ? (dx / dd) * lim : dx);
        s.ball.y = Math.max(BALL, s.spot.y + (dd > lim ? (dy / dd) * lim : dy));
        s.hist.push({ x: s.ball.x, y: s.ball.y, t });
        while (s.hist.length && t - s.hist[0].t > 0.12) s.hist.shift();
      }

      // --- draw: arena
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#0c0919");
      bg.addColorStop(1, "#1d1140");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // the stands behind, in the dark
      const standTop = floorY - k * 3.3, standBot = floorY - k * 0.9;
      for (const c of crowd.current) {
        const cy = standTop + c.y * (standBot - standTop);
        ctx.fillStyle = c.c < 0.5 ? "#2a1f55" : c.c < 0.85 ? "#123c4a" : "#5b4a9a";
        ctx.globalAlpha = 0.5 + c.y * 0.4;
        ctx.fillRect(c.x * w, cy + Math.sin(t * 3 + c.x * 50) * (s.banner && t - s.bannerT < 1 ? 2 : 0.3), 3, 3);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#0e0a20";
      ctx.fillRect(0, standBot, w, floorY - standBot);
      display(ctx, k * 0.5);
      ctx.fillStyle = "rgba(0,120,140,0.55)";
      ctx.textAlign = "center";
      ctx.fillText("BUZZ CITY", w * 0.42, standBot + k * 0.62);
      ctx.textAlign = "left";
      // spotlight on the hoop
      const spot = ctx.createRadialGradient(X(HOOP_X), Y(3.6), 0, X(HOOP_X), Y(3.6), k * 4.5);
      spot.addColorStop(0, "rgba(0,120,140,0.35)");
      spot.addColorStop(1, "rgba(0,120,140,0)");
      ctx.fillStyle = spot;
      ctx.fillRect(0, 0, w, h);
      // floor
      const fl = ctx.createLinearGradient(0, floorY, 0, h);
      fl.addColorStop(0, "#c99a5b");
      fl.addColorStop(1, "#8a6236");
      ctx.fillStyle = fl;
      ctx.fillRect(0, floorY, w, h - floorY);
      ctx.fillStyle = "#00788c";
      ctx.fillRect(X(HOOP_X - 4.9), floorY, X(HOOP_X) - X(HOOP_X - 4.9), Math.max(3, (h - floorY) * 0.5));
      // three-point line + free-throw line marks
      ctx.fillStyle = "#f2ead7";
      ctx.fillRect(X(HOOP_X - 6.75) - 1.5, floorY, 3, h - floorY);
      ctx.fillRect(X(HOOP_X - 4.6) - 1, floorY, 2, (h - floorY) * 0.5);

      // stanchion + backboard
      ctx.fillStyle = "#2a2440";
      ctx.fillRect(X(BOARD_X + 0.9), Y(3.2), k * 0.18, Y(0) - Y(3.2));
      ctx.fillRect(X(BOARD_X), Y(3.35), X(BOARD_X + 0.95) - X(BOARD_X), k * 0.1);
      ctx.fillStyle = "rgba(220,240,245,0.18)";
      ctx.fillRect(X(BOARD_X) - k * 0.03, Y(4.1), k * 0.06, Y(2.9) - Y(4.1));
      ctx.fillStyle = "#f2ead7";
      ctx.fillRect(X(BOARD_X) - k * 0.03, Y(4.1), k * 0.06, k * 0.04);
      ctx.fillRect(X(BOARD_X) - k * 0.03, Y(2.94), k * 0.06, k * 0.04);
      ctx.fillStyle = "#e05a1b";
      ctx.fillRect(X(BOARD_X) - k * 0.035, Y(3.5), k * 0.07, Y(3.05) - Y(3.5));

      // net (behind the front of the rim)
      ctx.strokeStyle = "rgba(242,234,215,0.85)";
      ctx.lineWidth = Math.max(1, k * 0.012);
      ctx.beginPath();
      for (const [a, b] of s.net.links) {
        ctx.moveTo(X(s.net.nodes[a].x), Y(s.net.nodes[a].y));
        ctx.lineTo(X(s.net.nodes[b].x), Y(s.net.nodes[b].y));
      }
      ctx.stroke();

      // fire trail
      for (const f of s.fire) {
        ctx.fillStyle = `rgba(${255},${Math.round(120 + 100 * f.life)},${40},${f.life * 0.8})`;
        ctx.beginPath();
        ctx.arc(X(f.x), Y(f.y), k * 0.09 * f.life + 1, 0, Math.PI * 2);
        ctx.fill();
      }

      // ball
      const b = s.ball;
      const bx = X(b.x), by = Y(b.y), br = BALL * k;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(b.rot);
      const bg2 = ctx.createRadialGradient(-br * 0.35, -br * 0.35, br * 0.1, 0, 0, br);
      bg2.addColorStop(0, "#ff9a4d");
      bg2.addColorStop(1, "#c4501a");
      ctx.fillStyle = bg2;
      ctx.beginPath();
      ctx.arc(0, 0, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(30,15,10,0.7)";
      ctx.lineWidth = Math.max(1, br * 0.09);
      ctx.beginPath();
      ctx.moveTo(-br, 0);
      ctx.lineTo(br, 0);
      ctx.moveTo(0, -br);
      ctx.lineTo(0, br);
      ctx.moveTo(-br * 0.7, -br * 0.7);
      ctx.quadraticCurveTo(0, -br * 0.2, br * 0.7, -br * 0.7);
      ctx.moveTo(-br * 0.7, br * 0.7);
      ctx.quadraticCurveTo(0, br * 0.2, br * 0.7, br * 0.7);
      ctx.stroke();
      ctx.restore();

      // rim (in front of the ball)
      ctx.strokeStyle = "#e05a1b";
      ctx.lineWidth = Math.max(2, k * 0.035);
      ctx.beginPath();
      ctx.moveTo(X(HOOP_X - RIM_R), Y(RIM_Y));
      ctx.lineTo(X(BOARD_X), Y(RIM_Y));
      ctx.stroke();

      // aim helpers while holding (keyboard power meter / grab hint)
      if (s.state === "hold" && play) {
        ctx.strokeStyle = "rgba(242,234,215,0.35)";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(bx, by, br * 2.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (s.charging || s.power > 0) {
          const L = k * (0.5 + s.power * 1.2);
          ctx.strokeStyle = "#8ad9a8";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(s.aim) * L, by - Math.sin(s.aim) * L);
          ctx.stroke();
        }
      }

      // HUD
      const made = s.shots.filter((x) => x.made).length;
      ctx.fillStyle = "#f2ead7";
      display(ctx, play ? 28 : 18, 800);
      ctx.fillText(String(s.points), 14, play ? 38 : 26);
      mono(ctx, play ? 11 : 9);
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText(
        `PTS · ${made}/${s.shots.length} FG${s.streak >= 3 ? "  ·  ON FIRE" : s.streak ? `  ·  STREAK ${s.streak}` : ""}`,
        14,
        play ? 56 : 40,
      );
      if (s.banner && t - s.bannerT < 1.1) {
        const a = 1 - (t - s.bannerT) / 1.1;
        ctx.globalAlpha = a;
        ctx.fillStyle = s.streak >= 3 ? "#ffb347" : "#f2ead7";
        display(ctx, Math.round(Math.min(w, h) * (play ? 0.12 : 0.14)), 800);
        ctx.textAlign = "center";
        ctx.fillText(s.banner, w * 0.45, h * 0.35 - (t - s.bannerT) * 30);
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
      }
      if (play) {
        const size = Math.min(190, w * 0.26);
        drawChart(ctx, s.shots, 14 + size, 72, size);
      }
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      onDown: (p) => {
        const s = S.current;
        if (s.state !== "hold") return;
        const wp = toWorld(p.x, p.y);
        if (Math.hypot(wp.x - s.ball.x, wp.y - s.ball.y) < BALL * 6) {
          s.state = "drag";
          s.hist = [];
        }
      },
      onUp: () => {
        const s = S.current;
        if (s.state !== "drag") return;
        const h = s.hist;
        if (h.length < 2) {
          s.state = "hold";
          return;
        }
        const a = h[0], b = h[h.length - 1];
        const dtt = Math.max(0.016, b.t - a.t);
        const vx = ((b.x - a.x) / dtt) * 1.15;
        const vy = ((b.y - a.y) / dtt) * 1.15;
        if (Math.hypot(vx, vy) < 1.5) {
          s.state = "hold";
          s.ball.x = s.spot.x;
          s.ball.y = s.spot.y;
          return;
        }
        shoot(vx, vy);
      },
      keys: (e, down) => {
        const s = S.current;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          if (down) s.aim = Math.min(1.45, s.aim + 0.03);
          return true;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          if (down) s.aim = Math.max(0.3, s.aim - 0.03);
          return true;
        }
        if (e.key === " " || e.key === "Enter") {
          if (down && !e.repeat && s.state === "hold") {
            s.charging = true;
            s.power = 0;
          } else if (!down && s.charging) {
            s.charging = false;
            const v = 5 + s.power * 8.5;
            shoot(Math.cos(s.aim) * v, Math.sin(s.aim) * v);
            s.power = 0;
          }
          return true;
        }
        return false;
      },
    },
  );

  function solve(from: V, err: number): [number, number] {
    const th = (52 * Math.PI) / 180 + err * 0.15;
    const dx = HOOP_X - from.x, dy = RIM_Y + 0.02 - from.y;
    const v = Math.sqrt((G * dx * dx) / (2 * Math.cos(th) ** 2 * (dx * Math.tan(th) - dy))) * (1 + err * 0.05);
    return [Math.cos(th) * v, Math.sin(th) * v];
  }

  function physics(s: typeof S.current, dt: number, t: number) {
    const b = s.ball;
    // net always settles
    const { nodes, links } = s.net;
    for (const nd of nodes) {
      if (nd.pin) continue;
      const vx = (nd.x - nd.px) * 0.96, vy = (nd.y - nd.py) * 0.96;
      nd.px = nd.x;
      nd.py = nd.y;
      nd.x += vx;
      nd.y += vy - G * dt * dt;
      if (s.state === "fly") {
        const dx = nd.x - b.x, dy = nd.y - b.y, d = Math.hypot(dx, dy);
        if (d < BALL + 0.02 && d > 0) {
          nd.x = b.x + (dx / d) * (BALL + 0.02);
          nd.y = b.y + (dy / d) * (BALL + 0.02);
          b.vx *= 0.995;
          b.vy *= 0.99;
        }
      }
    }
    for (let it = 0; it < 3; it++)
      for (const [a, c, len] of links) {
        const A = nodes[a], C = nodes[c];
        const dx = C.x - A.x, dy = C.y - A.y, d = Math.hypot(dx, dy) || 1;
        const diff = (d - len) / d / 2;
        if (!A.pin) {
          A.x += dx * diff;
          A.y += dy * diff;
        }
        if (!C.pin) {
          C.x -= dx * diff;
          C.y -= dy * diff;
        }
      }

    // fire particles
    for (const f of s.fire) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.life -= dt * 1.8;
    }
    s.fire = s.fire.filter((f) => f.life > 0);

    if (s.state !== "fly") return;
    s.flyT += dt;
    const py = b.y;
    b.vy -= G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.rot += b.spin * dt;
    if (s.streak >= 3 && Math.random() < 0.6)
      s.fire.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 0.4, vy: 0.4 + Math.random() * 0.4, life: 1 });

    // rim points (front and back) — the back one is where the rim meets the board bracket
    for (const rx of [HOOP_X - RIM_R, HOOP_X + RIM_R]) {
      const dx = b.x - rx, dy = b.y - RIM_Y, d = Math.hypot(dx, dy);
      const min = BALL + 0.012;
      if (d < min && d > 0) {
        const nx = dx / d, ny = dy / d;
        b.x = rx + nx * min;
        b.y = RIM_Y + ny * min;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= 1.55 * vn * nx;
          b.vy -= 1.55 * vn * ny;
          b.vx *= 0.88;
          b.spin += vn * 8;
          s.touched = true;
          if (t - s.lastHit > 0.08) sfx("rim", -vn);
          s.lastHit = t;
        }
      }
    }
    // backboard
    if (b.x + BALL > BOARD_X && b.x < BOARD_X + 0.2 && b.y > 2.9 && b.y < 4.1 && b.vx > 0) {
      b.x = BOARD_X - BALL;
      sfx("board", b.vx);
      b.vx *= -0.65;
      s.touched = true;
    }
    // scored: crossed the rim plane downward, inside the rim
    if (!s.scored && py >= RIM_Y && b.y < RIM_Y && b.vy < 0 && b.x > HOOP_X - RIM_R + BALL * 0.4 && b.x < HOOP_X + RIM_R - BALL * 0.4) {
      s.scored = true;
      const d = HOOP_X - s.spot.x;
      const pts = d > 6.75 ? 3 : 2;
      s.streak++;
      s.points += pts * (s.streak > 3 ? 2 : 1);
      s.shots.push({ d, lat: Math.random() * 2 - 1, made: true });
      s.banner = s.streak === 3 ? "ON FIRE" : !s.touched ? "SWISH" : pts === 3 ? "THREE" : "BUCKET";
      s.bannerT = t;
      sfx("swish");
      if (s.streak === 3) sfx("fire");
    }
    // floor
    if (b.y < BALL) {
      b.y = BALL;
      if (Math.abs(b.vy) > 1) sfx("floor", -b.vy);
      b.vy = -b.vy * 0.72;
      b.vx *= 0.85;
    }
    // done: off screen, or rolled to a stop, or timed out
    if (b.x > WORLD.x1 + 1 || b.x < WORLD.x0 - 1 || s.flyT > 4.5 || (b.y <= BALL + 0.01 && Math.abs(b.vy) < 0.6 && s.flyT > 1)) {
      if (!s.scored) {
        s.streak = 0;
        s.shots.push({ d: HOOP_X - s.spot.x, lat: Math.random() * 2 - 1, made: false });
      }
      if (s.shots.length > 60) s.shots.shift();
      newSpot(s);
    }
  }

  return (
    <canvas
      ref={ref}
      data-autofocus={play || undefined}
      role={play ? "img" : undefined}
      aria-label={play ? "A basketball hoop. Drag the ball and let go to shoot; or use the arrow keys to aim and hold Space for power." : undefined}
      className="absolute inset-0 w-full h-full outline-none touch-none"
    />
  );
}

// A half-court shot chart: distance from the rim (radius) by a random
// angle, filled for makes, hollow for misses, plus FG% by zone.
function drawChart(ctx: CanvasRenderingContext2D, shots: Shot[], right: number, top: number, size: number) {
  const w = size, h = size * 0.8;
  const x0 = right - w, y0 = top;
  ctx.fillStyle = "rgba(13,16,14,0.55)";
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = "rgba(242,234,215,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, y0, w, h);
  const rimX = x0 + w / 2, rimY = y0 + h * 0.14;
  const sc = (h * 0.85) / 8.5;
  ctx.beginPath();
  ctx.arc(rimX, rimY, 6.75 * sc, 0.12, Math.PI - 0.12);
  ctx.stroke();
  ctx.strokeRect(rimX - 2.45 * sc, y0, 4.9 * sc, 5.8 * sc);
  ctx.beginPath();
  ctx.arc(rimX, rimY, 3, 0, Math.PI * 2);
  ctx.stroke();
  // zones: paint / mid / three
  const zones = [
    { name: "PAINT", f: (d: number) => d < 3 },
    { name: "MID", f: (d: number) => d >= 3 && d <= 6.75 },
    { name: "3PT", f: (d: number) => d > 6.75 },
  ];
  for (const s of shots) {
    const a = Math.PI / 2 + s.lat * 1.1;
    const x = rimX + Math.cos(a) * s.d * sc;
    const y = rimY + Math.sin(a) * s.d * sc;
    if (s.made) {
      ctx.fillStyle = "#8ad9a8";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(242,234,215,0.6)";
      ctx.beginPath();
      ctx.moveTo(x - 2.5, y - 2.5);
      ctx.lineTo(x + 2.5, y + 2.5);
      ctx.moveTo(x + 2.5, y - 2.5);
      ctx.lineTo(x - 2.5, y + 2.5);
      ctx.stroke();
    }
  }
  mono(ctx, 9);
  zones.forEach((z, i) => {
    const zs = shots.filter((s) => z.f(s.d));
    const pct = zs.length ? Math.round((zs.filter((s) => s.made).length / zs.length) * 100) : null;
    ctx.fillStyle = pct === null ? "#b5b6ab" : pct >= 50 ? "#8ad9a8" : pct >= 30 ? "#f2ead7" : "#e58a6a";
    ctx.fillText(`${z.name} ${pct === null ? "—" : pct + "%"}`, x0 + 6 + i * (w / 3), y0 + h + 12);
  });
}
