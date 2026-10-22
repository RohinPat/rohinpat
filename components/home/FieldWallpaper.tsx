"use client";

import { useEffect, useRef } from "react";

// The home screen's wallpaper: thousands of ink strokes drifting through a
// flow field on cream, stirred by the cursor. Decorative only. Pauses when
// off screen or in a hidden tab; reduced motion gets a still drawing.

type Particle = { x: number; y: number; life: number; age: number };

export default function FieldWallpaper({ paused = false, dark = false }: { paused?: boolean; dark?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Control Center flips these; the loop reads them live instead of restarting.
  const opts = useRef({ paused, dark });
  const update = useRef<(wipe: boolean) => void>(() => {});
  useEffect(() => {
    const wipe = opts.current.dark !== dark;
    opts.current = { paused, dark };
    update.current(wipe);
  }, [paused, dark]);

  useEffect(() => {
    const el = canvas.current;
    const host = el?.parentElement;
    const ctx = el?.getContext("2d");
    if (!el || !host || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;
    let visible = true;
    let particles: Particle[] = [];
    const pointer = { x: -9999, y: -9999, on: false };

    const spawn = (p: Particle) => {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      p.age = 0;
      p.life = 120 + Math.random() * 260;
    };

    const bg = () => (opts.current.dark ? "13,16,14" : "242,234,215");
    const ink = () => (opts.current.dark ? "rgba(242,234,215,0.16)" : "rgba(13,16,14,0.13)");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = host.clientWidth;
      h = host.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgb(${bg()})`;
      ctx.fillRect(0, 0, w, h);
      const n = Math.min(2000, Math.round((w * h) / 560));
      particles = Array.from({ length: n }, () => {
        const p = { x: 0, y: 0, life: 0, age: 0 };
        spawn(p);
        p.age = Math.random() * p.life;
        return p;
      });
    };

    const angleAt = (x: number, y: number) =>
      (Math.sin(x * 0.0021 + t * 0.07) + Math.sin(y * 0.0027 - t * 0.05) + Math.sin((x + y) * 0.0013 + t * 0.03)) *
      Math.PI * 0.9;

    const step = () => {
      t += 1 / 60;
      ctx.fillStyle = `rgba(${bg()},0.06)`;
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink();
      ctx.beginPath();
      for (const p of particles) {
        const a = angleAt(p.x, p.y);
        let vx = Math.cos(a) * 0.9;
        let vy = Math.sin(a) * 0.9;
        if (pointer.on) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy + 400;
          if (d2 < 200 * 200) {
            vx += (-dy * 900) / (d2 * 6);
            vy += (dx * 900) / (d2 * 6);
          }
        }
        const sp = Math.hypot(vx, vy);
        if (sp > 4) {
          vx = (vx / sp) * 4;
          vy = (vy / sp) * 4;
        }
        ctx.moveTo(p.x, p.y);
        p.x += vx;
        p.y += vy;
        ctx.lineTo(p.x, p.y);
        p.age++;
        if (p.age > p.life || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) spawn(p);
      }
      ctx.stroke();
    };

    const loop = () => {
      step();
      raf = requestAnimationFrame(loop);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (!reduce && visible && !document.hidden && !opts.current.paused) raf = requestAnimationFrame(loop);
    };
    const still = () => {
      for (let i = 0; i < 260; i++) step();
    };

    update.current = (wipe) => {
      if (wipe) {
        // colour change: wipe to the new background
        ctx.fillStyle = `rgb(${bg()})`;
        ctx.fillRect(0, 0, w, h);
        if (reduce || opts.current.paused) still();
      }
      run(); // starts or stops the loop for pause/resume
    };

    resize();
    if (reduce) still();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) still();
    });
    ro.observe(host);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    io.observe(host);
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const k = w / (r.width || 1); // the device frame may be scaled down
      pointer.x = (e.clientX - r.left) * k;
      pointer.y = (e.clientY - r.top) * k;
      pointer.on = e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", run);
    run();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);

  // data-tone tells the venom cursor which symbiote belongs on this wallpaper
  return <canvas ref={canvas} aria-hidden="true" data-tone={dark ? "dark" : "light"} className="absolute inset-0 w-full h-full" />;
}
