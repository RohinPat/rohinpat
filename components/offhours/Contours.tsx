"use client";

import { useRef } from "react";
import { seeded, useCanvas } from "./useCanvas";

// A putting green as a topographic map. Contours come from marching
// squares over a fixed height field; click to drop a ball and watch it
// read the break, rolling downhill until it settles (or finds the cup).

type Hill = { x: number; y: number; a: number; s: number };
type Ball = { x: number; y: number; vx: number; vy: number; trail: Array<[number, number]>; done: boolean };

const HILLS: Hill[] = (() => {
  const r = seeded(23);
  return Array.from({ length: 5 }, () => ({
    x: r(),
    y: r(),
    a: (r() - 0.35) * 1.4,
    s: 0.12 + r() * 0.18,
  }));
})();
const CUP = { x: 0.68, y: 0.58 };

// height in normalised coords (0..1); a gentle tilt plus hills plus the cup
function height(x: number, y: number) {
  let z = (1 - x) * 0.35 + y * 0.2;
  for (const hl of HILLS) z += hl.a * Math.exp(-((x - hl.x) ** 2 + (y - hl.y) ** 2) / (2 * hl.s * hl.s));
  z -= 0.5 * Math.exp(-((x - CUP.x) ** 2 + (y - CUP.y) ** 2) / (2 * 0.06 * 0.06));
  return z;
}

function drawContours(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const N = 72;
  const M = Math.round((N * h) / w);
  const z: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j <= M; j++)
    for (let i = 0; i <= N; i++) {
      const v = height(i / N, j / M);
      z.push(v);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const at = (i: number, j: number) => z[j * (N + 1) + i];
  const cw = w / N;
  const ch = h / M;
  const levels = 22;
  for (let l = 1; l < levels; l++) {
    const iso = lo + ((hi - lo) * l) / levels;
    ctx.strokeStyle = l % 5 === 0 ? "rgba(214,232,200,0.75)" : "rgba(214,232,200,0.32)";
    ctx.lineWidth = l % 5 === 0 ? 1.3 : 0.8;
    ctx.beginPath();
    for (let j = 0; j < M; j++)
      for (let i = 0; i < N; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x = i * cw, y = j * ch;
        const lerp = (p: number, q: number) => (iso - p) / (q - p);
        const top: [number, number] = [x + cw * lerp(a, b), y];
        const right: [number, number] = [x + cw, y + ch * lerp(b, c)];
        const bottom: [number, number] = [x + cw * lerp(d, c), y + ch];
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
}

export default function Contours() {
  const cache = useRef<HTMLCanvasElement | null>(null);
  const balls = useRef<Ball[]>([]);

  const ref = useCanvas(
    ({ ctx, w, h, dt, p, fresh }) => {
      if (fresh || !cache.current) {
        const off = document.createElement("canvas");
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        off.width = Math.round(w * dpr);
        off.height = Math.round(h * dpr);
        const oc = off.getContext("2d")!;
        oc.scale(dpr, dpr);
        oc.fillStyle = "#24452f";
        oc.fillRect(0, 0, w, h);
        drawContours(oc, w, h);
        cache.current = off;
      }
      ctx.drawImage(cache.current, 0, 0, w, h);

      // cup + flag
      const cx = CUP.x * w, cy = CUP.y * h;
      ctx.fillStyle = "#0c0c0b";
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f1eee7";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy - 44);
      ctx.stroke();
      ctx.fillStyle = "#ff4a1c";
      ctx.beginPath();
      ctx.moveTo(cx, cy - 44);
      ctx.lineTo(cx + 20, cy - 38);
      ctx.lineTo(cx, cy - 32);
      ctx.fill();

      // balls: gradient descent with momentum and friction
      const step = dt || 1 / 60;
      for (const b of balls.current) {
        if (!b.done) {
          for (let k = 0; k < 2; k++) {
            const e = 0.002;
            const gx = (height(b.x + e, b.y) - height(b.x - e, b.y)) / (2 * e);
            const gy = (height(b.x, b.y + e) - height(b.x, b.y - e)) / (2 * e);
            b.vx = (b.vx - gx * step * 0.25) * 0.97;
            b.vy = (b.vy - gy * step * 0.25) * 0.97;
            b.x += b.vx * step;
            b.y += b.vy * step;
          }
          b.trail.push([b.x, b.y]);
          if (b.trail.length > 240) b.trail.shift();
          const inCup = Math.hypot((b.x - CUP.x) * w, (b.y - CUP.y) * h) < 5;
          const settled = b.trail.length > 30 && Math.hypot(b.vx, b.vy) < 0.004;
          if (inCup || settled || b.x < 0 || b.x > 1 || b.y < 0 || b.y > 1) b.done = true;
          if (inCup) { b.x = CUP.x; b.y = CUP.y; }
        }
        ctx.strokeStyle = "rgba(241,238,231,0.6)";
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        b.trail.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(b.x * w, b.y * h, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // crosshair + slope readout
      if (p.inside) {
        const x = p.x / w, y = p.y / h;
        const e = 0.01;
        const slope = Math.hypot(height(x + e, y) - height(x - e, y), height(x, y + e) - height(x, y - e)) / (2 * e);
        ctx.strokeStyle = "rgba(241,238,231,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y);
        ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8);
        ctx.stroke();
        ctx.fillStyle = "#f1eee7";
        ctx.font = "10px var(--font-geist-mono), monospace";
        ctx.fillText(`${(slope * 2.2).toFixed(1)}%`, p.x + 10, p.y - 8);
      }
    },
    {
      onDown: (pt, { w, h }) => {
        balls.current.push({ x: pt.x / w, y: pt.y / h, vx: 0, vy: 0, trail: [], done: false });
        if (balls.current.length > 6) balls.current.shift();
      },
    },
  );

  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 w-full h-full touch-pan-y cursor-crosshair" />;
}
