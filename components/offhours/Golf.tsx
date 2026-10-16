"use client";

import { useRef, useState } from "react";
import { seeded, useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio, tone } from "./audio";
import { display, mono } from "./font";

// Three ways to play, one green model. Each hole is a height field (a tilt
// plus Gaussian hills, in metres) drawn as a contour map. PUTT: pull back
// from the ball and let go; it rolls under slope + rolling friction and
// drops if it's slow enough at the cup, or lips out. READ: pour water and
// watch it run downhill — that's the break. RANGE: a three-click swing
// meter and a ball flight with drag, lift and sidespin, traced like TV.

type Mode = "putt" | "range" | "read";
const GW = 22, GH = 14; // green, metres
const CUP_R = 0.054;
const MU = 0.065 * 9.81; // rolling deceleration

type Hill = { x: number; y: number; a: number; s: number };
type Hole = { n: number; hills: Hill[]; tilt: [number, number]; cup: [number, number]; tee: [number, number]; par: number };

function makeHole(n: number): Hole {
  const r = seeded(100 + n * 17);
  const hills = Array.from({ length: 5 }, () => ({ x: r() * GW, y: r() * GH, a: (r() - 0.4) * 0.5, s: 2 + r() * 3.5 }));
  const cup: [number, number] = [GW * (0.62 + r() * 0.25), GH * (0.2 + r() * 0.6)];
  const tee: [number, number] = [GW * (0.08 + r() * 0.18), GH * (0.25 + r() * 0.5)];
  return { n, hills, tilt: [(r() - 0.5) * 0.04, (r() - 0.5) * 0.04], cup, tee, par: Math.hypot(cup[0] - tee[0], cup[1] - tee[1]) > 13 ? 3 : 2 };
}
function height(H: Hole, x: number, y: number) {
  let z = H.tilt[0] * x + H.tilt[1] * y;
  for (const h of H.hills) z += h.a * Math.exp(-((x - h.x) ** 2 + (y - h.y) ** 2) / (2 * h.s * h.s));
  // the cup sits in a tiny bowl
  z -= 0.01 * Math.exp(-((x - H.cup[0]) ** 2 + (y - H.cup[1]) ** 2) / 0.08);
  return z;
}
function grad(H: Hole, x: number, y: number): [number, number] {
  const e = 0.05;
  return [(height(H, x + e, y) - height(H, x - e, y)) / (2 * e), (height(H, x, y + e) - height(H, x, y - e)) / (2 * e)];
}

type Ball = { x: number; y: number; vx: number; vy: number; moving: boolean; sunk: boolean };
type Drop = { x: number; y: number; vx: number; vy: number; trail: [number, number][]; life: number };
type Shot = { pts: [number, number, number][]; carry: number; total: number; side: number };

const CLUBS = [
  { id: "driver", name: "Driver", v: 76, launch: 11, spin: 1.05 },
  { id: "iron", name: "7-iron", v: 52, launch: 17, spin: 1.15 },
  { id: "wedge", name: "Wedge", v: 34, launch: 28, spin: 1.5 },
];

export default function Golf({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [kind, setKind] = useState<Mode>("putt");
  const [club, setClub] = useState(0);
  const [status, setStatus] = useState("");
  const kindRef = useRef<Mode>("putt");
  kindRef.current = play ? kind : "putt";
  const clubRef = useRef(0);
  clubRef.current = club;

  const S = useRef({
    hole: makeHole(1),
    ball: { x: 0, y: 0, vx: 0, vy: 0, moving: false, sunk: false } as Ball,
    strokes: 0,
    total: 0,
    parTotal: 0,
    aiming: false,
    aimFrom: { x: 0, y: 0 },
    aimTo: { x: 0, y: 0 },
    kAngle: 0,
    kPower: 0,
    kCharging: false,
    drops: [] as Drop[],
    sunkT: 0,
    call: "",
    callT: 0,
    auto: 1.5,
    // range
    swing: "ready" as "ready" | "up" | "down" | "fly" | "rest",
    meter: 0,
    power: 0,
    acc: 0,
    shots: [] as Shot[],
    flight: null as null | { x: number; y: number; z: number; vx: number; vy: number; vz: number; side: number; pts: [number, number, number][]; landed: number },
  });
  const view = useRef({ k: 1, ox: 0, oy: 0 });
  const cache = useRef<{ key: string; c: HTMLCanvasElement } | null>(null);

  const reset = (s: typeof S.current, n: number) => {
    s.hole = makeHole(n);
    s.ball = { x: s.hole.tee[0], y: s.hole.tee[1], vx: 0, vy: 0, moving: false, sunk: false };
    s.strokes = 0;
    s.drops = [];
  };
  if (S.current.ball.x === 0) reset(S.current, 1);

  const sfx = (k: "putt" | "cup" | "lip" | "drive" | "land") => {
    if (!play) return;
    const au = getAudio();
    if (!au) return;
    if (k === "putt") tone(au, { freq: 900, to: 600, dur: 0.06, gain: 0.25, type: "triangle" });
    else if (k === "cup") {
      burst(au, { freq: 500, type: "lowpass", dur: 0.08, gain: 0.5 });
      tone(au, { freq: 300, to: 180, dur: 0.18, gain: 0.25, at: 0.05 });
    } else if (k === "lip") tone(au, { freq: 1200, to: 800, dur: 0.08, gain: 0.15 });
    else if (k === "drive") {
      burst(au, { freq: 2600, q: 0.9, dur: 0.05, gain: 0.6 });
      burst(au, { freq: 6000, type: "highpass", dur: 0.5, gain: 0.05, at: 0.03 });
    } else burst(au, { freq: 300, type: "lowpass", dur: 0.08, gain: 0.3 });
  };

  const toWorld = (px: number, py: number) => ({ x: (px - view.current.ox) / view.current.k, y: (py - view.current.oy) / view.current.k });

  const putt = (dx: number, dy: number, speed: number) => {
    const s = S.current;
    const d = Math.hypot(dx, dy) || 1;
    s.ball.vx = (dx / d) * speed;
    s.ball.vy = (dy / d) * speed;
    s.ball.moving = true;
    s.strokes++;
    sfx("putt");
  };

  // range: click three times
  const swingClick = () => {
    const s = S.current;
    if (s.swing === "ready" || s.swing === "rest") {
      s.swing = "up";
      s.meter = 0;
    } else if (s.swing === "up") {
      s.power = Math.min(1.1, s.meter);
      s.swing = "down";
    } else if (s.swing === "down") {
      s.acc = s.meter; // 0 is perfect; + slices, - hooks
      launch(s);
    }
  };
  const launch = (s: typeof S.current) => {
    const c = CLUBS[clubRef.current];
    const over = Math.max(0, s.power - 1);
    const v = c.v * Math.min(1.04, s.power) * (1 - over * 1.5);
    const err = s.acc + (Math.random() - 0.5) * over * 0.6;
    const la = (c.launch * Math.PI) / 180;
    const dir = err * 0.06;
    s.flight = {
      x: 0,
      y: 0,
      z: 0,
      vx: Math.sin(dir) * v * Math.cos(la),
      vy: Math.sin(la) * v,
      vz: Math.cos(dir) * v * Math.cos(la),
      side: err,
      pts: [[0, 0, 0]],
      landed: 0,
    };
    s.swing = "fly";
    sfx("drive");
  };

  const ref = useCanvas(
    ({ ctx, w, h, dt, t, p }) => {
      const s = S.current;
      const k = kindRef.current;
      if (k === "range") return drawRange(ctx, s, w, h, dt, t);

      // fit green
      const sc = Math.min((w - 24) / GW, (h - 24) / GH);
      view.current = { k: sc, ox: (w - GW * sc) / 2, oy: (h - GH * sc) / 2 };
      const X = (x: number) => view.current.ox + x * sc;
      const Y = (y: number) => view.current.oy + y * sc;

      // sim
      for (let i = 0; i < 4; i++) roll(s, dt / 4, t);
      if (!play && !s.ball.moving && !s.ball.sunk) {
        s.auto -= dt;
        if (s.auto <= 0) {
          const H = s.hole;
          const dx = H.cup[0] - s.ball.x, dy = H.cup[1] - s.ball.y;
          const dist = Math.hypot(dx, dy);
          const g = grad(H, (s.ball.x + H.cup[0]) / 2, (s.ball.y + H.cup[1]) / 2);
          // aim a little up the slope, roughly the right pace
          putt(dx + g[0] * -dist * 6, dy + g[1] * -dist * 6, Math.sqrt(2 * MU * dist) * (1.02 + Math.random() * 0.08));
          s.auto = 1.4;
        }
      }
      if (s.kCharging) s.kPower = Math.min(1, s.kPower + dt * 0.6);
      updateDrops(s, dt);

      // green (cached contour map)
      const key = `${s.hole.n}-${w}-${h}`;
      if (cache.current?.key !== key) cache.current = { key, c: renderGreen(s.hole, w, h, sc, view.current.ox, view.current.oy) };
      ctx.drawImage(cache.current.c, 0, 0, w, h);

      // water
      for (const d of s.drops) {
        ctx.strokeStyle = `rgba(150,210,255,${Math.min(1, d.life) * 0.7})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        d.trail.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(x), Y(y)));
        ctx.stroke();
      }

      // cup + flag
      const H = s.hole;
      ctx.fillStyle = "#0b120d";
      ctx.beginPath();
      ctx.ellipse(X(H.cup[0]), Y(H.cup[1]), Math.max(3, CUP_R * sc * 1.6), Math.max(2.5, CUP_R * sc * 1.4), 0, 0, Math.PI * 2);
      ctx.fill();
      const near = Math.hypot(s.ball.x - H.cup[0], s.ball.y - H.cup[1]) < 2.2;
      if (!near) {
        const fx = X(H.cup[0]), fy = Y(H.cup[1]);
        ctx.strokeStyle = "#f2ead7";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx, fy - sc * 2.2);
        ctx.stroke();
        ctx.fillStyle = "#e5484d";
        const wave = Math.sin(t * 5) * 3;
        ctx.beginPath();
        ctx.moveTo(fx, fy - sc * 2.2);
        ctx.quadraticCurveTo(fx + sc * 0.6, fy - sc * 2.0 + wave, fx + sc * 1.1, fy - sc * 1.85);
        ctx.lineTo(fx, fy - sc * 1.5);
        ctx.fill();
      }

      // aim line (direction + power, not the break — reading it is the game)
      if (k === "putt" && !s.ball.moving && !s.ball.sunk && play) {
        let dx = 0, dy = 0, pow = 0;
        if (s.aiming) {
          dx = s.aimFrom.x - s.aimTo.x;
          dy = s.aimFrom.y - s.aimTo.y;
          pow = Math.min(1, Math.hypot(dx, dy) / 6);
        } else if (s.kCharging || p.inside) {
          dx = Math.cos(s.kAngle);
          dy = Math.sin(s.kAngle);
          pow = s.kPower;
        }
        if (pow > 0 || s.kCharging) {
          const d = Math.hypot(dx, dy) || 1;
          const L = (1 + pow * 7) * sc;
          ctx.strokeStyle = "rgba(242,234,215,0.9)";
          ctx.setLineDash([4, 6]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(X(s.ball.x), Y(s.ball.y));
          ctx.lineTo(X(s.ball.x) + (dx / d) * L, Y(s.ball.y) + (dy / d) * L);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(13,16,14,0.6)";
          ctx.fillRect(X(s.ball.x) - 22, Y(s.ball.y) + 12, 44, 5);
          ctx.fillStyle = pow > 0.85 ? "#e5484d" : "#8ad9a8";
          ctx.fillRect(X(s.ball.x) - 22, Y(s.ball.y) + 12, 44 * pow, 5);
        }
      }

      // ball
      if (!s.ball.sunk) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.arc(X(s.ball.x) + 1.5, Y(s.ball.y) + 1.5, Math.max(3, sc * 0.09), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(X(s.ball.x), Y(s.ball.y), Math.max(3, sc * 0.09), 0, Math.PI * 2);
        ctx.fill();
      }

      // card
      ctx.fillStyle = "rgba(13,16,14,0.72)";
      ctx.fillRect(12, 12, play ? 178 : 120, play ? 46 : 32);
      ctx.fillStyle = "#f2ead7";
      display(ctx, play ? 18 : 13, 800);
      ctx.fillText(`HOLE ${H.n} · PAR ${H.par}`, 20, play ? 32 : 26);
      mono(ctx, play ? 10 : 8);
      ctx.fillStyle = "#b5b6ab";
      const vs = s.total - s.parTotal;
      ctx.fillText(`STROKES ${s.strokes}   TOTAL ${vs === 0 ? "E" : vs > 0 ? "+" + vs : vs}`, 20, play ? 50 : 38);
      if (k === "read" && play) {
        ctx.fillStyle = "#f2ead7";
        mono(ctx, 11);
        ctx.fillText("CLICK ANYWHERE TO POUR WATER · IT RUNS THE WAY YOUR PUTT WILL BREAK", 12, h - 14);
      }
      if (s.call && t - s.callT < 1.4) {
        ctx.globalAlpha = Math.min(1, (1.4 - (t - s.callT)) * 2);
        ctx.fillStyle = "#f2ead7";
        display(ctx, Math.round(Math.min(w, h) * 0.12), 800);
        ctx.textAlign = "center";
        ctx.fillText(s.call, w / 2, h / 2);
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
      }
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      onDown: (p) => {
        const s = S.current;
        const k = kindRef.current;
        if (k === "range") return swingClick();
        const wp = toWorld(p.x, p.y);
        if (k === "read") {
          for (let i = 0; i < 160; i++)
            s.drops.push({ x: wp.x + (Math.random() - 0.5) * 1.2, y: wp.y + (Math.random() - 0.5) * 1.2, vx: 0, vy: 0, trail: [], life: 3.5 });
          return;
        }
        if (s.ball.moving || s.ball.sunk) return;
        s.aiming = true;
        s.aimFrom = { x: s.ball.x, y: s.ball.y };
        s.aimTo = wp;
      },
      onMove: (p) => {
        const s = S.current;
        if (s.aiming) s.aimTo = toWorld(p.x, p.y);
      },
      onUp: () => {
        const s = S.current;
        if (!s.aiming) return;
        s.aiming = false;
        const dx = s.aimFrom.x - s.aimTo.x, dy = s.aimFrom.y - s.aimTo.y;
        const pow = Math.min(1, Math.hypot(dx, dy) / 6);
        if (pow < 0.03) return;
        putt(dx, dy, 0.3 + pow * 4.4);
      },
      keys: (e, down) => {
        const s = S.current;
        const k = kindRef.current;
        if (k === "range") {
          if ((e.key === " " || e.key === "Enter") && down && !e.repeat) swingClick();
          return e.key === " " || e.key === "Enter";
        }
        if (k !== "putt") return false;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          if (down) s.kAngle += e.key === "ArrowLeft" ? -0.04 : 0.04;
          return true;
        }
        if (e.key === " " || e.key === "Enter") {
          if (down && !e.repeat && !s.ball.moving) {
            s.kCharging = true;
            s.kPower = 0;
          } else if (!down && s.kCharging) {
            s.kCharging = false;
            putt(Math.cos(s.kAngle), Math.sin(s.kAngle), 0.3 + s.kPower * 4.4);
            s.kPower = 0;
          }
          return true;
        }
        return false;
      },
    },
  );

  function roll(s: typeof S.current, dt: number, t: number) {
    const b = s.ball;
    const H = s.hole;
    if (s.ball.sunk) {
      if (t - s.sunkT > 1.6) {
        s.total += s.strokes;
        s.parTotal += H.par;
        reset(s, H.n >= 9 ? 1 : H.n + 1);
        if (H.n >= 9) {
          s.total = 0;
          s.parTotal = 0;
        }
      }
      return;
    }
    if (!b.moving) return;
    const [gx, gy] = grad(H, b.x, b.y);
    const sp = Math.hypot(b.vx, b.vy);
    b.vx += -9.81 * gx * dt * 0.75;
    b.vy += -9.81 * gy * dt * 0.75;
    if (sp > 0) {
      const dec = Math.min(sp, MU * dt);
      b.vx -= (b.vx / sp) * dec;
      b.vy -= (b.vy / sp) * dec;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // edges of the green: bounce off the fringe
    if (b.x < 0.1 || b.x > GW - 0.1) b.vx *= -0.4;
    if (b.y < 0.1 || b.y > GH - 0.1) b.vy *= -0.4;
    b.x = Math.max(0.1, Math.min(GW - 0.1, b.x));
    b.y = Math.max(0.1, Math.min(GH - 0.1, b.y));
    // the cup
    const dc = Math.hypot(b.x - H.cup[0], b.y - H.cup[1]);
    const v = Math.hypot(b.vx, b.vy);
    if (dc < CUP_R + 0.012) {
      if (v < 1.25) {
        b.sunk = true;
        b.moving = false;
        s.sunkT = t;
        const diff = s.strokes - H.par;
        s.call = s.strokes === 1 ? "ACE" : diff <= -1 ? "BIRDIE" : diff === 0 ? "PAR" : diff === 1 ? "BOGEY" : "IN";
        s.callT = t;
        sfx("cup");
        if (play) setStatus(`Hole ${H.n}: ${s.strokes} strokes. ${s.call}.`);
      } else if (dc > CUP_R * 0.4) {
        // lip out: the cup edge turns it
        const nx = (b.x - H.cup[0]) / dc, ny = (b.y - H.cup[1]) / dc;
        const vn = b.vx * nx + b.vy * ny;
        b.vx = (b.vx - 1.4 * vn * nx) * 0.7;
        b.vy = (b.vy - 1.4 * vn * ny) * 0.7;
        if (t - s.callT > 1) {
          s.call = "LIP OUT";
          s.callT = t;
          sfx("lip");
        }
      }
    }
    if (v < 0.03) {
      const slope = Math.hypot(gx, gy) * 9.81 * 0.75;
      if (slope < MU * 1.4) {
        b.moving = false;
        b.vx = 0;
        b.vy = 0;
      }
    }
  }

  function updateDrops(s: typeof S.current, dt: number) {
    const H = s.hole;
    for (const d of s.drops) {
      const [gx, gy] = grad(H, d.x, d.y);
      d.vx = d.vx * (1 - dt * 1.2) - gx * 9.81 * dt * 6;
      d.vy = d.vy * (1 - dt * 1.2) - gy * 9.81 * dt * 6;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.trail.push([d.x, d.y]);
      if (d.trail.length > 60) d.trail.shift();
      d.life -= dt;
    }
    s.drops = s.drops.filter((d) => d.life > 0 && d.x > 0 && d.x < GW && d.y > 0 && d.y < GH);
  }

  function drawRange(ctx: CanvasRenderingContext2D, s: typeof S.current, w: number, h: number, dt: number, t: number) {
    // camera behind and to the right of the tee, so the flight reads as an arc
    const horizon = h * 0.3;
    const f = Math.min(h * 0.95, w * 0.62);
    const camX = 16, camY = 4, camZ = -24;
    const P = (x: number, y: number, z: number) => {
      const d = Math.max(0.5, z - camZ);
      return { x: w * 0.56 + (f * (x - camX)) / d, y: horizon + (f * (camY - y)) / d, s: f / d };
    };
    // sky + far hills
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#9cc7e6");
    sky.addColorStop(1, "#e9eedf");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon + 1);
    ctx.fillStyle = "#6f9a6a";
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, horizon - 8 - Math.sin(x * 0.013) * 6 - Math.sin(x * 0.041) * 3);
    ctx.lineTo(w, horizon);
    ctx.fill();
    // ground with mown bands every 10 yards
    for (let yd = 0; yd < 340; yd += 10) {
      const a = P(0, 0, yd * 0.9144), b = P(0, 0, (yd + 10) * 0.9144);
      ctx.fillStyle = (yd / 10) % 2 ? "#5f9b4f" : "#68a657";
      ctx.fillRect(0, b.y, w, a.y - b.y + 1);
    }
    ctx.fillStyle = "#68a657";
    ctx.fillRect(0, P(0, 0, 0).y, w, h);
    // yardage boards
    ctx.textAlign = "center";
    for (const yd of [50, 100, 150, 200, 250, 300]) {
      for (const side of [-1, 1]) {
        const q = P(side * 28, 0, yd * 0.9144);
        const bw = q.s * 4, bh = q.s * 2.2;
        ctx.fillStyle = "#f2ead7";
        ctx.fillRect(q.x - bw / 2, q.y - bh, bw, bh);
        ctx.fillStyle = "#1d5e3f";
        display(ctx, Math.max(7, Math.round(q.s * 1.6)), 800);
        ctx.fillText(String(yd), q.x, q.y - bh * 0.2);
      }
      // target flag in the middle
      const fl = P(0, 0, yd * 0.9144);
      ctx.strokeStyle = "#f2ead7";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fl.x, fl.y);
      ctx.lineTo(fl.x, fl.y - fl.s * 2.4);
      ctx.stroke();
      ctx.fillStyle = yd % 100 === 0 ? "#e5484d" : "#edbb00";
      ctx.fillRect(fl.x, fl.y - fl.s * 2.4, fl.s * 0.9, fl.s * 0.6);
    }
    ctx.textAlign = "left";

    // tee mat
    const m1 = P(-1.2, 0, -1), m2 = P(1.2, 0, -1), m3 = P(1.2, 0, 1.5), m4 = P(-1.2, 0, 1.5);
    ctx.fillStyle = "#2f6b3a";
    ctx.beginPath();
    ctx.moveTo(m1.x, m1.y);
    ctx.lineTo(m2.x, m2.y);
    ctx.lineTo(m3.x, m3.y);
    ctx.lineTo(m4.x, m4.y);
    ctx.fill();
    if (s.swing !== "fly") {
      const tb = P(0, 0.03, 0);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(tb.x, tb.y, Math.max(2, tb.s * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }

    // flight
    const fl = s.flight;
    const c = CLUBS[clubRef.current];
    if (fl && s.swing === "fly") {
      for (let i = 0; i < 6; i++) {
        const st = dt / 6;
        if (!fl.landed) {
          const v = Math.hypot(fl.vx, fl.vy, fl.vz);
          const drag = 0.0026 * v;
          const lift = 0.0011 * v * v * c.spin;
          fl.vx += (-drag * fl.vx + fl.side * 0.022 * v) * st;
          fl.vy += (-9.81 - drag * fl.vy + lift) * st;
          fl.vz += -drag * fl.vz * st;
          fl.x += fl.vx * st;
          fl.y += fl.vy * st;
          fl.z += fl.vz * st;
          if (fl.y <= 0 && fl.vy < 0) {
            fl.y = 0;
            fl.landed = fl.z;
            fl.vy = 0;
            fl.vx *= 0.35;
            fl.vz *= 0.35 / (1 + c.spin);
            sfx("land");
          }
        } else {
          const v = Math.hypot(fl.vx, fl.vz);
          const dec = Math.min(v, 6 * st);
          if (v > 0) {
            fl.vx -= (fl.vx / v) * dec;
            fl.vz -= (fl.vz / v) * dec;
          }
          fl.x += fl.vx * st;
          fl.z += fl.vz * st;
        }
      }
      fl.pts.push([fl.x, fl.y, fl.z]);
      if (fl.landed && Math.hypot(fl.vx, fl.vz) < 0.2) {
        const shot = { pts: fl.pts, carry: fl.landed / 0.9144, total: fl.z / 0.9144, side: fl.x / 0.9144 };
        s.shots.push(shot);
        if (s.shots.length > 12) s.shots.shift();
        s.swing = "rest";
        s.call = `${Math.round(shot.carry)} YDS`;
        s.callT = t;
        if (play)
          setStatus(`${c.name}: ${Math.round(shot.carry)} yards carry, ${Math.round(shot.total)} total, ${Math.abs(Math.round(shot.side))} ${shot.side < 0 ? "left" : "right"}.`);
      }
    }
    if (!play && (s.swing === "ready" || s.swing === "rest")) {
      s.auto -= dt;
      if (s.auto <= 0) {
        s.power = 0.85 + Math.random() * 0.2;
        s.acc = (Math.random() - 0.5) * 0.5;
        launch(s);
        s.auto = 2.2;
      }
    }
    // tracers: old shots faint, the live one bright
    const trace = (pts: [number, number, number][], col: string, wdt: number) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = wdt;
      ctx.beginPath();
      pts.forEach(([x, y, z], i) => {
        const q = P(x, y, z);
        (i ? ctx.lineTo : ctx.moveTo).call(ctx, q.x, q.y);
      });
      ctx.stroke();
    };
    for (const sh of s.shots.slice(-5)) trace(sh.pts, "rgba(229,72,77,0.35)", 1.5);
    if (fl && s.swing === "fly") {
      trace(fl.pts, "#e5484d", 3);
      const q = P(fl.x, fl.y, fl.z);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(2, q.s * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }

    // swing meter
    const speed = 0.9;
    if (s.swing === "up") {
      s.meter += dt * speed;
      if (s.meter >= 1.12) {
        s.power = 1.1;
        s.swing = "down";
      }
    } else if (s.swing === "down") {
      s.meter -= dt * speed * 1.3;
      if (s.meter <= -0.2) {
        s.acc = -0.2;
        launch(s);
      }
    }
    const mw = Math.min(460, w * 0.7), mx = w / 2 - mw / 2, my = h - 40;
    const toX = (v: number) => mx + ((v + 0.2) / 1.32) * mw;
    ctx.fillStyle = "rgba(13,16,14,0.75)";
    ctx.fillRect(mx - 6, my - 6, mw + 12, 26);
    ctx.fillStyle = "#1d5e3f";
    ctx.fillRect(toX(0), my, toX(1) - toX(0), 14);
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(toX(1), my, toX(1.12) - toX(1), 14);
    ctx.fillStyle = "#f2ead7";
    ctx.fillRect(toX(0) - 1, my - 4, 3, 22); // the sweet spot
    if (s.swing === "down" || s.swing === "fly" || s.swing === "rest") {
      ctx.fillStyle = "#edbb00";
      ctx.fillRect(toX(s.power) - 1, my - 4, 3, 22);
    }
    if (s.swing === "up" || s.swing === "down") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(toX(s.meter) - 2, my - 6, 4, 26);
    }
    mono(ctx, 10);
    ctx.fillStyle = "#f2ead7";
    ctx.textAlign = "center";
    if (play) ctx.fillText(s.swing === "ready" || s.swing === "rest" ? "CLICK TO SWING" : s.swing === "up" ? "CLICK FOR POWER" : s.swing === "down" ? "CLICK ON THE WHITE LINE" : "", w / 2, my - 12);
    ctx.textAlign = "left";

    // dispersion map, top-down
    if (play) {
      const dw = 130, dh = 170, dx0 = w - dw - 12, dy0 = 12;
      ctx.fillStyle = "rgba(13,16,14,0.72)";
      ctx.fillRect(dx0, dy0, dw, dh);
      ctx.strokeStyle = "rgba(242,234,215,0.25)";
      ctx.beginPath();
      ctx.moveTo(dx0 + dw / 2, dy0 + dh - 8);
      ctx.lineTo(dx0 + dw / 2, dy0 + 8);
      ctx.stroke();
      ctx.fillStyle = "#b5b6ab";
      mono(ctx, 9);
      for (const yd of [100, 200, 300]) {
        const yy = dy0 + dh - 8 - (yd / 320) * (dh - 16);
        ctx.fillText(String(yd), dx0 + 4, yy);
      }
      for (const sh of s.shots) {
        const xx = dx0 + dw / 2 + (sh.side / 60) * (dw / 2);
        const yy = dy0 + dh - 8 - (sh.total / 320) * (dh - 16);
        ctx.fillStyle = "#8ad9a8";
        ctx.beginPath();
        ctx.arc(xx, yy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (s.shots.length) {
        const avg = s.shots.reduce((a, b) => a + b.carry, 0) / s.shots.length;
        ctx.fillStyle = "#f2ead7";
        ctx.fillText(`AVG CARRY ${Math.round(avg)}`, dx0 + 4, dy0 + dh + 12);
      }
    }
    if (s.call && t - s.callT < 1.8) {
      ctx.globalAlpha = Math.min(1, (1.8 - (t - s.callT)) * 2);
      ctx.fillStyle = "#0d100e";
      display(ctx, Math.round(Math.min(w, h) * 0.11), 800);
      ctx.textAlign = "center";
      ctx.fillText(s.call, w / 2, horizon * 0.62);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#1f4d2c]">
      {play && (
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 pb-2 bg-[#0d100e]">
          {(["putt", "range", "read"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={kind === m}
              onClick={() => {
                setKind(m);
                setStatus("");
              }}
              className={`h-9 px-4 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] border ${
                kind === m ? "bg-[#f2ead7] text-[#0d100e] border-transparent" : "border-white/15 text-[#f2ead7] hover:bg-white/10"
              }`}
            >
              {m === "putt" ? "Putt" : m === "range" ? "Driving range" : "Green reader"}
            </button>
          ))}
          {kind === "range" && (
            <div className="flex gap-1 ml-auto">
              {CLUBS.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={club === i}
                  onClick={() => setClub(i)}
                  className={`h-9 px-3 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] ${club === i ? "bg-[#1d5e3f] text-[#f2ead7]" : "text-[#b5b6ab] hover:text-[#f2ead7]"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <p aria-live="polite" className="sr-only">
            {status}
          </p>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <canvas
          ref={ref}
          data-autofocus={play || undefined}
          role={play ? "img" : undefined}
          aria-label={
            play
              ? "Golf. Putt: drag back from the ball and let go, or arrows to aim and hold Space. Range: Space or click three times. Reader: click to pour water."
              : undefined
          }
          className="absolute inset-0 w-full h-full outline-none touch-none"
        />
      </div>
    </div>
  );
}

// The green as a contour map, cached per hole and size.
function renderGreen(H: Hole, w: number, h: number, sc: number, ox: number, oy: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  // fringe
  ctx.fillStyle = "#1f4d2c";
  ctx.fillRect(0, 0, w, h);
  // green, shaded by height
  const N = 90;
  const M = Math.round((N * GH) / GW);
  const z: number[] = [];
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= M; j++)
    for (let i = 0; i <= N; i++) {
      const v = height(H, (i / N) * GW, (j / M) * GH);
      z.push(v);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const cw = (GW * sc) / N, ch = (GH * sc) / M;
  for (let j = 0; j < M; j++)
    for (let i = 0; i < N; i++) {
      const v = (z[j * (N + 1) + i] - lo) / (hi - lo || 1);
      const l = 34 + v * 16;
      ctx.fillStyle = `hsl(128, 38%, ${l}%)`;
      ctx.fillRect(ox + i * cw, oy + j * ch, cw + 0.6, ch + 0.6);
    }
  // contours (marching squares)
  const at = (i: number, j: number) => z[j * (N + 1) + i];
  const levels = 24;
  for (let l = 1; l < levels; l++) {
    const iso = lo + ((hi - lo) * l) / levels;
    ctx.strokeStyle = l % 4 === 0 ? "rgba(228,244,214,0.6)" : "rgba(228,244,214,0.22)";
    ctx.lineWidth = l % 4 === 0 ? 1.2 : 0.7;
    ctx.beginPath();
    for (let j = 0; j < M; j++)
      for (let i = 0; i < N; i++) {
        const a = at(i, j), b = at(i + 1, j), cc = at(i + 1, j + 1), d = at(i, j + 1);
        const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (cc > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x = ox + i * cw, y = oy + j * ch;
        const lerp = (p: number, q: number) => (iso - p) / (q - p);
        const top: [number, number] = [x + cw * lerp(a, b), y];
        const right: [number, number] = [x + cw, y + ch * lerp(b, cc)];
        const bottom: [number, number] = [x + cw * lerp(d, cc), y + ch];
        const left: [number, number] = [x, y + ch * lerp(a, d)];
        const seg = (p: [number, number], q: [number, number]) => {
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        };
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(left, bottom); seg(top, right); break;
        }
      }
    ctx.stroke();
  }
  // collar
  ctx.strokeStyle = "rgba(13,16,14,0.35)";
  ctx.lineWidth = 3;
  ctx.strokeRect(ox, oy, GW * sc, GH * sc);
  return c;
}
