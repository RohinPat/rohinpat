"use client";

import { useRef } from "react";
import { useCanvas } from "./useCanvas";

// Half court in Hornets teal on purple with a hex-binned shot chart.
// Hexes swell under the pointer; click to put up a shot — it arcs to the
// rim and the hex you shot from lights up.

const PURPLE = "#1d1160";
const TEAL = "#00a0b0";

type Shot = { x: number; y: number; t: number };

// Shot density in court units (rim at 0,0; y up the floor, feet-ish).
function density(x: number, y: number) {
  const d = Math.hypot(x, y);
  const rim = Math.exp(-(d * d) / 18);
  const three = Math.exp(-((d - 23.5) ** 2) / 3) * 0.8;
  const corner = Math.abs(x) > 20 && y < 9 ? 0.9 : 0;
  const mid = Math.exp(-((d - 15) ** 2) / 20) * 0.25;
  return Math.min(1, rim + three + corner + mid);
}

export default function ShotChart() {
  const shots = useRef<Shot[]>([]);
  // hex centres + densities depend only on size: computed once per resize
  const hexes = useRef<{ key: string; list: Array<{ x: number; y: number; px: number; py: number; v: number }> }>({ key: "", list: [] });

  const layout = (w: number, h: number) => {
    // court is 50 x 32 units; fit with margin, rim near the bottom
    const s = Math.min((w - 24) / 50, (h - 24) / 32);
    const ox = w / 2;
    const oy = h / 2 + 16 * s - 5 * s;
    return { s, ox, oy, toPx: (x: number, y: number) => [ox + x * s, oy - y * s] as const };
  };

  const ref = useCanvas(
    ({ ctx, w, h, t, p }) => {
      const { s, toPx } = layout(w, h);
      ctx.fillStyle = PURPLE;
      ctx.fillRect(0, 0, w, h);

      // hex grid
      const r = 1.25; // hex radius in court units
      const key = `${w}x${h}`;
      if (hexes.current.key !== key) {
        const list = [];
        const dx = r * Math.sqrt(3);
        const dy = r * 1.5;
        for (let row = 0, y = -4; y < 30; row++, y += dy) {
          for (let x = -25 + (row % 2) * (dx / 2); x <= 25; x += dx) {
            const v = density(x, y);
            if (v < 0.08) continue;
            const [px, py] = toPx(x, y);
            list.push({ x, y, px, py, v });
          }
        }
        hexes.current = { key, list };
      }
      const live = shots.current.filter((sh) => t - sh.t < 1.6);
      for (const { x, y, px, py, v } of hexes.current.list) {
        let k = 0.35 + v * 0.6 + Math.sin(t * 1.5 + x * 0.4 + y * 0.3) * 0.04;
        if (p.inside) k += Math.exp(-((px - p.x) ** 2 + (py - p.y) ** 2) / (2 * 40 * 40)) * 0.45;
        const lit = live.length > 0 && live.some((sh) => Math.hypot(sh.x - x, sh.y - y) < r);
        ctx.fillStyle = lit ? "#ff4a1c" : v > 0.6 ? TEAL : `rgba(0,160,176,${0.25 + v * 0.5})`;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const hx = px + Math.cos(a) * r * s * Math.min(1, k);
          const hy = py + Math.sin(a) * r * s * Math.min(1, k);
          if (i === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.fill();
      }

      // court lines
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2;
      const line = (pts: Array<[number, number]>) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          const [px, py] = toPx(x, y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      };
      line([[-25, -5.25], [25, -5.25]]);
      line([[-8, -5.25], [-8, 13.75], [8, 13.75], [8, -5.25]]);
      line([[-22, -5.25], [-22, 8.95]]);
      line([[22, -5.25], [22, 8.95]]);
      const [cx, cy] = toPx(0, 0);
      ctx.beginPath();
      const corner = Math.atan2(8.95, 22); // where the arc meets the corner-three lines
      ctx.arc(cx, cy, 23.75 * s, -Math.PI + corner, -corner);
      ctx.stroke();
      ctx.beginPath();
      const [fx, fy] = toPx(0, 13.75);
      ctx.arc(fx, fy, 6 * s, Math.PI, 0);
      ctx.stroke();
      // rim + backboard
      ctx.strokeStyle = "#ff4a1c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.75 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      line([[-3, -1.25], [3, -1.25]]);

      // shots in flight
      shots.current = shots.current.filter((sh) => t - sh.t < 1.6);
      for (const sh of shots.current) {
        const k = Math.min(1, (t - sh.t) / 0.8);
        const x = sh.x * (1 - k);
        const y = sh.y * (1 - k);
        const [bx, by] = toPx(x, y);
        const lift = Math.sin(k * Math.PI) * 9 * s;
        if (k < 1) {
          ctx.fillStyle = "#ff8a3d";
          ctx.beginPath();
          ctx.arc(bx, by - lift, 0.6 * s + 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    {
      onDown: (pt, { w, h, t }) => {
        const { s, ox, oy } = layout(w, h);
        const x = (pt.x - ox) / s;
        const y = (oy - pt.y) / s;
        if (y < -5.25) return;
        shots.current.push({ x, y, t });
      },
    },
  );

  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 w-full h-full touch-pan-y cursor-crosshair" />;
}
