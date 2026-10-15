"use client";

import { useEffect, useRef } from "react";

// Shared plumbing for the canvas pieces on /interests:
// - crisp on high-DPI screens, resizes with its container
// - animates only while on screen and the tab is visible
// - prefers-reduced-motion: no autonomous animation, redraws on interaction
// - pointer position in CSS pixels, plus enter/leave/down state

export type Pointer = {
  x: number;
  y: number;
  inside: boolean;
  down: boolean;
};

export type Frame = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  t: number;
  dt: number;
  p: Pointer;
  reduce: boolean;
  /** true on the first draw after mount or resize */
  fresh: boolean;
};

type Options = {
  onDown?: (p: Pointer, frame: { w: number; h: number; t: number }) => void;
};

export function useCanvas(draw: (f: Frame) => void, options: Options = {}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const optsRef = useRef(options);
  drawRef.current = draw;
  optsRef.current = options;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const p: Pointer = { x: 0, y: 0, inside: false, down: false };
    let w = 0;
    let h = 0;
    let t = 0;
    let raf = 0;
    let last = 0;
    let visible = false;
    let fresh = true;

    const paint = (dt: number) => {
      if (!w || !h) return;
      drawRef.current({ ctx, w, h, t, dt, p, reduce, fresh });
      fresh = false;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      paint(dt);
      raf = requestAnimationFrame(frame);
    };

    const run = () => {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!p.inside) {
        p.x = w / 2;
        p.y = h / 2;
      }
      fresh = true;
      paint(0);
    };

    const locate = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      p.x = e.clientX - r.left;
      p.y = e.clientY - r.top;
    };
    const onMove = (e: PointerEvent) => {
      locate(e);
      p.inside = true;
      if (reduce) paint(0);
    };
    const onLeave = () => {
      p.inside = false;
      p.down = false;
      if (reduce) paint(0);
    };
    const onDown = (e: PointerEvent) => {
      locate(e);
      p.inside = true;
      p.down = true;
      optsRef.current.onDown?.(p, { w, h, t });
      if (reduce) paint(0);
    };
    const onUp = () => {
      p.down = false;
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointercancel", onLeave);
    window.addEventListener("pointerup", onUp);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      run();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", run);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", run);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointercancel", onLeave);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return ref;
}

/** Deterministic PRNG so every visitor sees the same mountains, hills, etc. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
