"use client";

import { useEffect, useRef } from "react";

// Shared plumbing for the canvas pieces on /interests:
// - crisp on high-DPI screens, resizes with its container
// - animates only while on screen, the tab is visible, and not `paused`
// - prefers-reduced-motion: no autonomous animation, redraws on interaction
// - pointer position in CSS pixels, plus enter/leave/down state
// - keyboard: pieces can take keys (`keys`); otherwise arrow keys move the
//   "pointer" (Shift = bigger steps) and Enter/Space press, so every piece
//   works without a mouse
// - `interactive: false` (tile previews): no listeners, not focusable

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

type Size = { w: number; h: number; t: number };

type Options = {
  onDown?: (p: Pointer, frame: Size) => void;
  onUp?: (p: Pointer, frame: Size) => void;
  onMove?: (p: Pointer, frame: Size) => void;
  /** return true if the piece handled the key (stops the default arrow/Enter behaviour) */
  keys?: (e: KeyboardEvent, down: boolean) => boolean;
  interactive?: boolean;
  paused?: boolean;
  /** keep animating under reduced motion (games the visitor is driving) */
  animateAlways?: boolean;
  /** most device pixels the canvas may have: a big window renders at less than the screen's pixel ratio (default: no limit beyond 2x) */
  maxPixels?: number;
};

export function useCanvas(draw: (f: Frame) => void, options: Options = {}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const optsRef = useRef(options);
  const runRef = useRef<() => void>(() => {});
  drawRef.current = draw;
  optsRef.current = options;
  const interactive = options.interactive ?? true;

  useEffect(() => {
    runRef.current();
  }, [options.paused]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const still = () => reduce && !optsRef.current.animateAlways;
    const p: Pointer = { x: 0, y: 0, inside: false, down: false };
    let w = 0;
    let h = 0;
    let t = 0;
    let raf = 0;
    let last = 0;
    let visible = false;
    let fresh = true;
    const size = () => ({ w, h, t });

    const paint = (dt: number) => {
      if (!w || !h) return;
      drawRef.current({ ctx, w, h, t, dt, p, reduce, fresh });
      fresh = false;
    };
    const nudge = () => still() && paint(0);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      paint(dt);
      raf = requestAnimationFrame(frame);
    };

    const run = () => {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden && !still() && !optsRef.current.paused) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    runRef.current = run;

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      const budget = optsRef.current.maxPixels;
      const screen = Math.min(window.devicePixelRatio || 1, 2);
      const dpr = budget && w * h > 0 ? Math.min(screen, Math.max(1, Math.sqrt(budget / (w * h)))) : screen;
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
      optsRef.current.onMove?.(p, size());
      nudge();
    };
    const onLeave = () => {
      if (p.down) return; // captured drags keep going outside
      p.inside = false;
      nudge();
    };
    const onDown = (e: PointerEvent) => {
      locate(e);
      p.inside = true;
      p.down = true;
      canvas.setPointerCapture?.(e.pointerId);
      optsRef.current.onDown?.(p, size());
      nudge();
    };
    const onUp = (e: PointerEvent) => {
      if (!p.down) return;
      locate(e);
      p.down = false;
      optsRef.current.onUp?.(p, size());
      nudge();
    };

    const onFocus = () => {
      p.inside = true;
      nudge();
    };
    const onBlur = () => {
      p.inside = false;
      p.down = false;
      nudge();
    };
    const onKey = (e: KeyboardEvent) => {
      if (optsRef.current.keys?.(e, true)) {
        e.preventDefault();
        nudge();
        return;
      }
      const step = (e.shiftKey ? 0.15 : 0.05) * Math.min(w, h);
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (moves[e.key]) {
        e.preventDefault();
        p.inside = true;
        p.x = Math.min(w, Math.max(0, p.x + moves[e.key][0]));
        p.y = Math.min(h, Math.max(0, p.y + moves[e.key][1]));
        optsRef.current.onMove?.(p, size());
        nudge();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (e.repeat) return;
        p.down = true;
        optsRef.current.onDown?.(p, size());
        nudge();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (optsRef.current.keys?.(e, false)) {
        e.preventDefault();
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && p.down) {
        p.down = false;
        optsRef.current.onUp?.(p, size());
      }
    };

    if (interactive) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("pointercancel", onUp);
      canvas.addEventListener("pointerup", onUp);
      canvas.tabIndex = 0;
      canvas.addEventListener("focus", onFocus);
      canvas.addEventListener("blur", onBlur);
      canvas.addEventListener("keydown", onKey);
      canvas.addEventListener("keyup", onKeyUp);
    }

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
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("focus", onFocus);
      canvas.removeEventListener("blur", onBlur);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("keyup", onKeyUp);
    };
  }, [interactive]);

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

export type Mode = "preview" | "play";
export type PieceProps = { mode: Mode; paused?: boolean };
