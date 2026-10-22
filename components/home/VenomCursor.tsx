"use client";

import { useEffect, useRef } from "react";

// On the home screen the mouse pointer is a glossy black blob. Near an app,
// widget or button it throws a tendril to the closest one; over it, the goo
// floods the block from where you came in (a CSS layer under the icon, see
// .venom-on in globals.css); a click splashes droplets that get pulled back.
//
// Drawing: circles on a small canvas that follows the blob, merged into
// liquid by an SVG "goo" filter (blur, then a hard alpha threshold) with a
// specular pass for the shine. Small canvas, so the filter stays cheap.
// Not on touch-first screens, and never with prefers-reduced-motion.

const SIZE = 560; // canvas, CSS px, centred on the blob
const REACH = 170; // how far a tendril will stretch
const TARGETS = "[data-tile], [data-venom]";
const INK = "#060807";

type Drop = { x: number; y: number; vx: number; vy: number; r: number; age: number };

export default function VenomCursor({ root }: { root: React.RefObject<HTMLElement> }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = root.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!host || !cv || !ctx) return;
    // touch-first screens keep their taps; mouse-first ones get the blob
    if (matchMedia("(pointer: coarse)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = SIZE * dpr;

    const p = { x: -999, y: -999, in: false };
    const head = { x: -999, y: -999 };
    const trail = [0, 1, 2].map(() => ({ x: -999, y: -999 }));
    const drops: Drop[] = [];
    let near: Element | null = null;
    let reach = 0;
    let over: HTMLElement | null = null;
    let shown = 0;
    let raf = 0;
    let last = performance.now();

    const local = (el: HTMLElement, x: number, y: number) => {
      const r = el.getBoundingClientRect();
      const s = r.width / (el.offsetWidth || r.width) || 1; // tiles sit inside a scaled phone
      return { x: (x - r.left) / s, y: (y - r.top) / s, w: el.offsetWidth, h: el.offsetHeight };
    };

    // flood a block from the point the blob entered; drain to where it left
    const enter = (el: HTMLElement) => {
      const l = local(el, p.x, p.y);
      el.style.setProperty("--vx", `${l.x}px`);
      el.style.setProperty("--vy", `${l.y}px`);
      el.style.setProperty("--vr", "0px");
      if (getComputedStyle(el).position === "static") el.classList.add("venom-rel");
      el.classList.add("venom-on");
      requestAnimationFrame(() => el.style.setProperty("--vr", `${Math.hypot(l.w, l.h) * 1.05}px`));
    };
    const leave = (el: HTMLElement) => {
      const l = local(el, p.x, p.y);
      el.style.setProperty("--vx", `${l.x}px`);
      el.style.setProperty("--vy", `${l.y}px`);
      el.style.setProperty("--vr", "0px");
      window.setTimeout(() => {
        if (over !== el) el.classList.remove("venom-on", "venom-rel");
      }, 380);
    };

    const blocked = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      p.x = e.clientX;
      p.y = e.clientY;
      const t = e.target as Element | null;
      p.in = !!t && host.contains(t) && !blocked();
      host.classList.toggle("venom-cursorless", p.in);
      if (head.x < -900) {
        head.x = p.x;
        head.y = p.y;
        trail.forEach((d) => Object.assign(d, { x: p.x, y: p.y }));
      }
      run();
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) {
        p.in = false;
        host.classList.remove("venom-cursorless");
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!p.in || e.pointerType === "touch") return;
      // the splash: droplets fly out, then the blob reels them in
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + Math.random() * 0.4;
        const v = 260 + Math.random() * 260;
        drops.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, r: 5 + Math.random() * 6, age: 0 });
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      raf = 0;
      const live = p.in || shown > 0.01 || drops.length > 0;
      if (!live) {
        cv.style.opacity = "0";
        return;
      }
      shown += ((p.in ? 1 : 0) - shown) * (1 - Math.exp(-dt * 14));
      cv.style.opacity = String(shown);

      // the blob: a springy head and three droplets that lag behind it
      const k = 1 - Math.exp(-dt * 26);
      head.x += (p.x - head.x) * k;
      head.y += (p.y - head.y) * k;
      trail.forEach((d, i) => {
        const lead = i ? trail[i - 1] : head;
        const kk = 1 - Math.exp(-dt * (18 - i * 4));
        d.x += (lead.x - d.x) * kk;
        d.y += (lead.y - d.y) * kk;
      });

      // which block is under the pointer, and which is closest
      let inside: HTMLElement | null = null;
      let best: { el: Element; d: number; x: number; y: number } | null = null;
      if (p.in) {
        host.querySelectorAll<HTMLElement>(TARGETS).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
          const cx = Math.max(r.left, Math.min(p.x, r.right));
          const cy = Math.max(r.top, Math.min(p.y, r.bottom));
          const d = Math.hypot(p.x - cx, p.y - cy);
          if (d === 0) inside = el;
          else if (d < REACH && (!best || d < best.d)) best = { el, d, x: cx, y: cy };
        });
      }
      if (inside !== over) {
        if (over) leave(over);
        if (inside) enter(inside);
        over = inside;
      }
      const target = inside ? null : (best as { el: Element; d: number; x: number; y: number } | null);
      if ((target?.el ?? null) !== near) {
        near = target?.el ?? null;
        reach = 0;
      }
      reach = Math.min(1, reach + dt * 7);

      // draw around the head
      const ox = head.x - SIZE / 2;
      const oy = head.y - SIZE / 2;
      cv.style.transform = `translate(${ox}px, ${oy}px)`;
      ctx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
      ctx.clearRect(ox, oy, SIZE, SIZE);
      ctx.fillStyle = INK;
      const dot = (x: number, y: number, r: number) => {
        if (r <= 0.3) return;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };

      const sink = inside ? 0.55 : 1; // over a block the blob soaks into it
      dot(head.x, head.y, 16 * sink);
      trail.forEach((d, i) => dot(d.x, d.y, (11 - i * 2.5) * sink));

      if (target) {
        const s = 1 - target.d / REACH; // closer, thicker
        const tx = head.x + (target.x - head.x) * reach;
        const ty = head.y + (target.y - head.y) * reach;
        const len = Math.hypot(tx - head.x, ty - head.y) || 1;
        const nx = -(ty - head.y) / len;
        const ny = (tx - head.x) / len;
        const n = Math.max(6, Math.round(len / 7));
        for (let i = 1; i <= n; i++) {
          const u = i / n;
          const wob = Math.sin(u * Math.PI) * Math.sin(now / 140 + u * 7) * 5 * (1 - s);
          const r = (3 + 6.5 * s) * (0.55 + 0.45 * Math.abs(2 * u - 1));
          dot(head.x + (tx - head.x) * u + nx * wob, head.y + (ty - head.y) * u + ny * wob, r);
        }
        if (reach > 0.95) dot(target.x, target.y, 5 + 5 * s); // where it grabs on
      }

      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt;
        if (d.age > 0.22) {
          // reel back in
          const pull = 1 - Math.exp(-dt * 14);
          d.x += (head.x - d.x) * pull;
          d.y += (head.y - d.y) * pull;
          d.r *= 1 - dt * 2.5;
        } else {
          d.vy += 900 * dt;
          d.vx *= 1 - dt * 3;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
        }
        if (d.age > 0.75) drops.splice(i, 1);
        else dot(d.x, d.y, d.r);
      }
      run();
    };
    const run = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerout", onOut);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerout", onOut);
      host.classList.remove("venom-cursorless");
      host.querySelectorAll(".venom-on").forEach((el) => el.classList.remove("venom-on", "venom-rel"));
    };
  }, [root]);

  return (
    <>
      <svg width="0" height="0" aria-hidden="true" className="absolute">
        <defs>
          <filter id="venom-goo" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="goo" />
            <feGaussianBlur in="goo" stdDeviation="2.5" result="soft" />
            <feSpecularLighting in="soft" surfaceScale="5" specularConstant="1.1" specularExponent="28" lightingColor="#ffffff" result="spec">
              <feDistantLight azimuth="235" elevation="48" />
            </feSpecularLighting>
            <feComposite in="spec" in2="goo" operator="in" result="shine" />
            <feComposite in="goo" in2="shine" operator="arithmetic" k1="0" k2="1" k3="0.75" k4="0" />
          </filter>
        </defs>
      </svg>
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[45]"
        // a faint cream rim so black goo still reads on the dark wallpaper
        style={{ width: SIZE, height: SIZE, opacity: 0, filter: "url(#venom-goo) drop-shadow(0 0 1.5px rgba(242,234,215,0.55))", willChange: "transform" }}
      />
    </>
  );
}
