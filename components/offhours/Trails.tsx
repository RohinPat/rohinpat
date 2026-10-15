"use client";

import { useRef } from "react";
import { seeded, useCanvas, type Frame } from "./useCanvas";

// Long-exposure night road. Each car is just two points of light moving
// along a lane; the canvas never fully clears, so they smear into trails.
// The road bends toward the pointer.

type Car = { lane: number; u: number; speed: number; dir: 1 | -1; hue: "tail" | "head" };

const LANES = [-1.5, -0.5, 0.5, 1.5];

function makeCars() {
  const rnd = seeded(7);
  return Array.from({ length: 22 }, (): Car => {
    const lane = Math.floor(rnd() * 4);
    const dir = lane < 2 ? -1 : 1;
    return { lane, u: rnd(), speed: 0.09 + rnd() * 0.08, dir, hue: dir === 1 ? "tail" : "head" };
  });
}

export default function Trails() {
  const state = useRef<{ cars: Car[]; bend: number } | null>(null);
  if (!state.current) state.current = { cars: makeCars(), bend: 0 };
  const s = state.current;

  const road = (u: number, w: number, h: number, lane: number) => {
    const x = u * w;
    const center = h * 0.56 + Math.sin(u * Math.PI * 1.3 + 0.6) * h * 0.16 * (1 + s.bend);
    const spread = 7 + u * 5;
    return [x, center + lane * spread] as const;
  };

  const step = (f: Frame, dt: number, ctx: CanvasRenderingContext2D) => {
    const { w, h } = f;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const c of s.cars) {
      const lane = LANES[c.lane];
      const [x0, y0] = road(c.u, w, h, lane);
      c.u += c.dir * c.speed * dt;
      if (c.u > 1.05) c.u = -0.05;
      if (c.u < -0.05) c.u = 1.05;
      const [x1, y1] = road(c.u, w, h, lane);
      ctx.strokeStyle = c.hue === "tail" ? "rgba(255,59,40,0.55)" : "rgba(255,240,214,0.5)";
      ctx.lineWidth = c.hue === "tail" ? 1.6 : 2.2;
      for (const off of [-1.6, 1.6]) {
        ctx.beginPath();
        ctx.moveTo(x0, y0 + off);
        ctx.lineTo(x1, y1 + off);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  };

  const ref = useCanvas((f) => {
    const { ctx, w, h, dt, p, reduce, fresh } = f;
    const target = p.inside ? (p.y / h - 0.5) * 2.4 : 0;
    s.bend += (target - s.bend) * Math.min(1, dt * 2 || 1);

    if (fresh || reduce) {
      ctx.fillStyle = "#07070a";
      ctx.fillRect(0, 0, w, h);
    }
    // City glow on the horizon
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(7,7,10,0.09)");
    g.addColorStop(1, "rgba(30,14,8,0.09)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (reduce || fresh) {
      for (let i = 0; i < 240; i++) step(f, 1 / 60, ctx); // pre-expose a still frame
    } else {
      step(f, dt, ctx);
    }
  });

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full touch-pan-y"
    />
  );
}
