"use client";

import { useRef } from "react";
import { seeded, useCanvas } from "./useCanvas";

// Layered ridgelines at golden hour with falling snow. Nearer ridges move
// further with the pointer (parallax); wind follows the pointer too.

const LAYERS = 5;
const COLORS = ["#e9d9c8", "#c9b4a6", "#8f7f7c", "#4b4446", "#16140f"];

function ridge(seed: number, n: number) {
  const r = seeded(seed);
  // midpoint displacement for a natural skyline
  let pts = [r(), r()];
  let rough = 0.5;
  while (pts.length < n) {
    const next: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push(pts[i], (pts[i] + pts[i + 1]) / 2 + (r() - 0.5) * rough);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    rough *= 0.55;
  }
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  return pts.map((v) => (v - lo) / (hi - lo || 1));
}

type Flake = { x: number; y: number; r: number; v: number };

export default function Ridgelines() {
  const ridges = useRef(Array.from({ length: LAYERS }, (_, i) => ridge(11 + i * 7, 129)));
  const flakes = useRef<Flake[]>(
    (() => {
      const r = seeded(5);
      return Array.from({ length: 120 }, () => ({ x: r(), y: r(), r: 0.6 + r() * 1.6, v: 0.03 + r() * 0.05 }));
    })(),
  );
  const look = useRef({ x: 0, y: 0 });

  const ref = useCanvas(({ ctx, w, h, dt, p }) => {
    const tx = p.inside ? p.x / w - 0.5 : 0;
    const ty = p.inside ? p.y / h - 0.5 : 0;
    look.current.x += (tx - look.current.x) * 0.06;
    look.current.y += (ty - look.current.y) * 0.06;

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#f6e7d3");
    sky.addColorStop(0.7, "#f1c9a5");
    sky.addColorStop(1, "#ee9f78");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // low sun
    ctx.fillStyle = "#ff4a1c";
    ctx.beginPath();
    ctx.arc(w * 0.72 - look.current.x * 8, h * 0.42 - look.current.y * 6, Math.min(w, h) * 0.09, 0, Math.PI * 2);
    ctx.fill();

    ridges.current.forEach((pts, i) => {
      const depth = (i + 1) / LAYERS;
      const shift = look.current.x * 40 * depth;
      const base = h * (0.5 + depth * 0.45) - look.current.y * 14 * depth;
      const amp = h * (0.44 - depth * 0.2);
      ctx.fillStyle = COLORS[i];
      ctx.beginPath();
      ctx.moveTo(-60, h);
      pts.forEach((v, k) => {
        const x = -60 + (k / (pts.length - 1)) * (w + 120) + shift;
        ctx.lineTo(x, base - v * amp);
      });
      ctx.lineTo(w + 60, h);
      ctx.closePath();
      ctx.fill();
    });

    // snow
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    const wind = look.current.x * 0.08;
    for (const f of flakes.current) {
      f.y += f.v * (dt || 0);
      f.x += (wind + Math.sin(f.y * 12) * 0.01) * (dt || 0);
      if (f.y > 1) { f.y = -0.02; }
      if (f.x > 1.02) f.x = -0.02;
      if (f.x < -0.02) f.x = 1.02;
      ctx.beginPath();
      ctx.arc(f.x * w, f.y * h, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  return <canvas ref={ref} role="img" aria-label="Mountain ridgelines at golden hour with falling snow. Arrow keys shift the view." className="absolute inset-0 w-full h-full touch-pan-y" />;
}
