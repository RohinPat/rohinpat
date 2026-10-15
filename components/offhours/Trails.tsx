"use client";

import { useRef } from "react";
import { seeded, useCanvas } from "./useCanvas";

// Long-exposure night highway. A road recedes to a vanishing point under a
// city skyline; headlights stream toward you, taillights pull away. Light is
// drawn onto its own layer that fades slowly (the "exposure") and is added
// on top of the scene, so streaks glow. Move to sway the camera; hold to
// keep the shutter open and stretch the trails.

type Car = { lane: number; d: number; v: number; dir: 1 | -1 };
type Building = { x: number; w: number; h: number; windows: Array<[number, number]> };

const NEAR = 2; // metres from the camera at the bottom edge
const FAR = 140;
const LANES = [-0.75, -0.25, 0.25, 0.75]; // fraction of the road half-width
const ONCOMING = new Set([0, 1]);

function makeScene() {
  const r = seeded(41);
  const cars: Car[] = Array.from({ length: 38 }, () => {
    const lane = Math.floor(r() * 4);
    return { lane, d: NEAR + r() * (FAR - NEAR), v: 16 + r() * 16, dir: ONCOMING.has(lane) ? -1 : 1 };
  });
  const buildings: Building[] = [];
  for (let x = -0.05; x < 1.05; ) {
    const w = 0.025 + r() * 0.05;
    const h = 0.04 + r() ** 2 * 0.2;
    const windows: Array<[number, number]> = [];
    for (let i = 0; i < 14; i++) if (r() < 0.55) windows.push([r(), r()]);
    buildings.push({ x, w, h, windows });
    x += w + r() * 0.006;
  }
  const stars = Array.from({ length: 40 }, () => [r(), r() * 0.35, r()] as const);
  return { cars, buildings, stars };
}

export default function Trails() {
  const state = useRef<{
    scene: ReturnType<typeof makeScene>;
    sway: number;
    layer: HTMLCanvasElement | null;
  } | null>(null);
  if (!state.current) state.current = { scene: makeScene(), sway: 0, layer: null };
  const s = state.current;

  const ref = useCanvas(({ ctx, w, h, dt, p, reduce, fresh }) => {
    const horizon = h * 0.47;
    const target = p.inside ? (p.x / w - 0.5) * 2 : 0;
    s.sway += (target - s.sway) * Math.min(1, (dt || 0.016) * 3);
    const vpX = w / 2 + s.sway * w * 0.16;
    const halfBottom = w * 0.8;

    // perspective: screen scale for a point `d` metres away
    const scale = (d: number) => NEAR / d;
    const project = (lateral: number, d: number) => {
      const k = scale(d);
      return [vpX + (w / 2 - vpX) * k + lateral * halfBottom * k, horizon + k * (h - horizon)] as const;
    };

    // ---- light layer (persistent, fades = exposure) ----------------------
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (fresh || !s.layer) {
      s.layer = document.createElement("canvas");
      s.layer.width = Math.round(w * dpr);
      s.layer.height = Math.round(h * dpr);
      s.layer.getContext("2d")!.scale(dpr, dpr);
    }
    const lc = s.layer.getContext("2d")!;

    const expose = (step: number, holdOpen: boolean) => {
      const keep = holdOpen ? 0.988 : 0.945; // per 1/60 s
      lc.globalCompositeOperation = "destination-out";
      lc.fillStyle = `rgba(0,0,0,${1 - Math.pow(keep, step * 60)})`;
      lc.fillRect(0, 0, w, h);
      lc.globalCompositeOperation = "lighter";
      lc.lineCap = "round";
      for (const c of s.scene.cars) {
        const lane = LANES[c.lane];
        const d0 = c.d;
        c.d += c.dir * c.v * step;
        if (c.d < NEAR) c.d = FAR;
        if (c.d > FAR) c.d = NEAR + 0.5;
        if (Math.abs(c.d - d0) > 20) continue; // wrapped this frame
        const k = scale(c.d);
        const spread = 0.055 * k * halfBottom; // distance between a car's two lights
        const head = c.dir === -1;
        const [x0, y0] = project(lane, d0);
        const [x1, y1] = project(lane, c.d);
        for (const side of [-1, 1]) {
          const off = (side * spread) / 2;
          // soft glow, then a bright core
          lc.strokeStyle = head ? "rgba(255,226,180,0.2)" : "rgba(255,40,20,0.26)";
          lc.lineWidth = Math.max(2, 12 * k);
          lc.beginPath();
          lc.moveTo(x0 + off, y0);
          lc.lineTo(x1 + off, y1);
          lc.stroke();
          lc.strokeStyle = head ? "rgba(255,248,232,0.95)" : "rgba(255,90,60,0.95)";
          lc.lineWidth = Math.max(0.9, 2.8 * k);
          lc.beginPath();
          lc.moveTo(x0 + off, y0);
          lc.lineTo(x1 + off, y1);
          lc.stroke();
        }
      }
    };

    if (fresh || reduce) {
      for (let i = 0; i < 150; i++) expose(1 / 60, true); // pre-exposed still
    } else {
      expose(dt, p.down);
    }

    // ---- scene ------------------------------------------------------------
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#04050b");
    sky.addColorStop(0.75, "#120d1c");
    sky.addColorStop(1, "#3a1a14");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (const [x, y, b] of s.scene.stars) ctx.fillRect(x * w, y * h, b > 0.8 ? 1.5 : 1, b > 0.8 ? 1.5 : 1);

    // skyline (slight parallax)
    const sk = -s.sway * w * 0.03;
    for (const b of s.scene.buildings) {
      const bx = b.x * w + sk;
      const bw = b.w * w;
      const bh = b.h * h;
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(bx, horizon - bh, bw, bh);
      ctx.fillStyle = "rgba(255,196,120,0.55)";
      for (const [wx, wy] of b.windows) ctx.fillRect(bx + 2 + wx * (bw - 5), horizon - bh + 3 + wy * (bh - 6), 1.6, 1.6);
    }

    // ground + road
    ctx.fillStyle = "#07070a";
    ctx.fillRect(0, horizon, w, h - horizon);
    const [lx0, ly0] = project(-1, NEAR);
    const [rx0] = project(1, NEAR);
    const [lxf, lyf] = project(-1, FAR);
    const [rxf] = project(1, FAR);
    const road = ctx.createLinearGradient(0, horizon, 0, h);
    road.addColorStop(0, "#121216");
    road.addColorStop(1, "#1b1b20");
    ctx.fillStyle = road;
    ctx.beginPath();
    ctx.moveTo(lxf, lyf);
    ctx.lineTo(rxf, lyf);
    ctx.lineTo(rx0, ly0);
    ctx.lineTo(lx0, ly0);
    ctx.closePath();
    ctx.fill();

    // centre line (solid amber) + lane dashes
    ctx.strokeStyle = "rgba(255,176,46,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [cx0, cy0] = project(0, NEAR);
    const [cxf, cyf] = project(0, FAR);
    ctx.moveTo(cx0, cy0);
    ctx.lineTo(cxf, cyf);
    ctx.stroke();
    ctx.strokeStyle = "rgba(241,238,231,0.16)";
    for (const lane of [-0.5, 0.5]) {
      for (let d = NEAR; d < FAR; d += 9) {
        const [ax, ay] = project(lane, d);
        const [bx, by] = project(lane, d + 4);
        ctx.lineWidth = Math.max(0.6, 3 * scale(d));
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // sodium streetlights down both shoulders
    for (let d = 5; d < FAR; d += 11) {
      const k = scale(d);
      for (const side of [-1.12, 1.12]) {
        const [x, y] = project(side, d);
        const pole = 260 * k;
        ctx.strokeStyle = "rgba(40,40,46,0.9)";
        ctx.lineWidth = Math.max(0.5, 3 * k);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - pole);
        ctx.stroke();
        const r = Math.max(4, 70 * k);
        const glow = ctx.createRadialGradient(x, y - pole, 0, x, y - pole, r);
        glow.addColorStop(0, "rgba(255,170,70,0.55)");
        glow.addColorStop(1, "rgba(255,170,70,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y - pole, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // add the exposure on top
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(s.layer, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    // shutter indicator while held
    if (p.down) {
      ctx.fillStyle = "#ff4a1c";
      ctx.beginPath();
      ctx.arc(14, 14, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(241,238,231,0.8)";
      ctx.font = "10px var(--font-mono), monospace";
      ctx.fillText("SHUTTER OPEN", 24, 17.5);
    }
  });

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Long-exposure night highway. Arrow keys sway the camera; hold Enter to keep the shutter open."
      className="absolute inset-0 w-full h-full touch-pan-y cursor-crosshair"
    />
  );
}
