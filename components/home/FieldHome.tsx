"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pov, site } from "@/lib/site";

// Home is one living canvas: thousands of ink strokes drifting through a
// flow field, four hotspots that act as gravity wells. Hover or focus a
// hotspot and the field swirls into it, turning green; click it and a ripple
// opens into that page. The hotspots are ordinary links underneath, so
// keyboards, screen readers and cmd-click all work. Reduced motion gets a
// still drawing and plain navigation.

type Spot = {
  label: string;
  sub: string;
  href: string;
  /** destination page's first surface, so the ripple lands seamlessly */
  color: string;
  side: "left" | "right";
  /** position classes: phones stack lower down, desktop sits round the name */
  pos: string;
};

const SPOTS: Spot[] = [
  { label: "Work", sub: "Things I've built", href: "/projects", color: "#f2ead7", side: "left", pos: "left-[7%] top-[56%] md:left-[11%] md:top-[24%]" },
  { label: "Closet Organizer", sub: "The long write-up", href: "/projects/closet-organizer", color: "#f2ead7", side: "right", pos: "right-[7%] top-[66%] md:right-[11%] md:top-[24%]" },
  { label: "Off hours", sub: "Nine things, drawn in code", href: "/interests", color: "#0d100e", side: "left", pos: "left-[7%] top-[76%] md:left-[11%] md:top-[auto] md:bottom-[18%]" },
  { label: "Say hi", sub: site.email, href: "/contact", color: "#1d5e3f", side: "right", pos: "right-[7%] top-[86%] md:right-[11%] md:top-[auto] md:bottom-[18%]" },
];

type Particle = { x: number; y: number; life: number; age: number };

export default function FieldHome() {
  const router = useRouter();
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const spotRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const hot = useRef<number | null>(null);
  const [hotIndex, setHotIndex] = useState<number | null>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number; color: string } | null>(null);

  const setHot = (i: number | null) => {
    hot.current = i;
    setHotIndex(i);
  };

  // warm the destinations so the swap after the ripple is instant
  useEffect(() => {
    SPOTS.forEach((s) => router.prefetch(s.href));
  }, [router]);

  useEffect(() => {
    const el = canvas.current;
    const host = section.current;
    const ctx = el?.getContext("2d");
    if (!el || !host || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;
    let visible = true;
    let particles: Particle[] = [];
    let wells: Array<{ x: number; y: number }> = [];
    const pointer = { x: -9999, y: -9999, on: false };

    const spawn = (p: Particle) => {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      p.age = 0;
      p.life = 120 + Math.random() * 260;
    };

    const locateWells = () => {
      const r = host.getBoundingClientRect();
      wells = spotRefs.current.map((a) => {
        const dot = a?.querySelector("[data-well]")?.getBoundingClientRect();
        return dot ? { x: dot.left + dot.width / 2 - r.left, y: dot.top + dot.height / 2 - r.top } : { x: -9999, y: -9999 };
      });
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = host.clientWidth;
      h = host.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#f2ead7";
      ctx.fillRect(0, 0, w, h);
      const n = Math.min(2200, Math.round((w * h) / 520));
      particles = Array.from({ length: n }, () => {
        const p = { x: 0, y: 0, life: 0, age: 0 };
        spawn(p);
        p.age = Math.random() * p.life;
        return p;
      });
      locateWells();
    };

    const angleAt = (x: number, y: number) =>
      (Math.sin(x * 0.0021 + t * 0.07) + Math.sin(y * 0.0027 - t * 0.05) + Math.sin((x + y) * 0.0013 + t * 0.03)) *
      Math.PI * 0.9;

    const step = () => {
      t += 1 / 60;
      // fade toward cream: trails linger, then dissolve
      ctx.fillStyle = "rgba(242,234,215,0.06)";
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 1;
      const hi = hot.current;

      ctx.beginPath();
      ctx.strokeStyle = "rgba(13,16,14,0.16)";
      const green: Array<[number, number, number, number]> = [];
      for (const p of particles) {
        const a = angleAt(p.x, p.y);
        let vx = Math.cos(a) * 0.9;
        let vy = Math.sin(a) * 0.9;

        // gravity wells: a gentle pull everywhere, a strong swirl when hot
        let nearHot = false;
        wells.forEach((g, i) => {
          const dx = g.x - p.x;
          const dy = g.y - p.y;
          const d2 = dx * dx + dy * dy + 900;
          const s = i === hi ? 16000 : 260;
          vx += ((dx * 0.6 - dy) * s) / (d2 * 40);
          vy += ((dy * 0.6 + dx) * s) / (d2 * 40);
          if (i === hi && d2 < 340 * 340) nearHot = true;
        });

        // the cursor stirs the field
        if (pointer.on) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy + 400;
          if (d2 < 180 * 180) {
            vx += (-dy * 900) / (d2 * 6);
            vy += (dx * 900) / (d2 * 6);
          }
        }

        const sp = Math.hypot(vx, vy);
        if (sp > 4) {
          vx = (vx / sp) * 4;
          vy = (vy / sp) * 4;
        }
        const x0 = p.x;
        const y0 = p.y;
        p.x += vx;
        p.y += vy;
        p.age++;

        if (nearHot) green.push([x0, y0, p.x, p.y]);
        else {
          ctx.moveTo(x0, y0);
          ctx.lineTo(p.x, p.y);
        }
        if (p.age > p.life || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) spawn(p);
      }
      ctx.stroke();

      if (green.length) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(29,94,63,0.8)";
        ctx.lineWidth = 1.5;
        for (const [a, b, c, d] of green) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, d);
        }
        ctx.stroke();
      }
    };

    const loop = () => {
      step();
      raf = requestAnimationFrame(loop);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    resize();
    if (reduce) for (let i = 0; i < 260; i++) step(); // a still drawing

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) for (let i = 0; i < 260; i++) step();
    });
    ro.observe(host);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    io.observe(host);
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = pointer.y >= 0 && pointer.y <= r.height;
    };
    const onLeave = () => {
      pointer.on = false;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("scroll", locateWells, { passive: true });
    run();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("scroll", locateWells);
    };
  }, []);

  const open = (e: React.MouseEvent<HTMLAnchorElement>, spot: Spot) => {
    // let the browser handle new-tab clicks; reduced motion navigates plainly
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    const dot = e.currentTarget.querySelector("[data-well]")?.getBoundingClientRect();
    const x = dot ? dot.left + dot.width / 2 : e.clientX;
    const y = dot ? dot.top + dot.height / 2 : e.clientY;
    setRipple({ x, y, color: spot.color });
    window.setTimeout(() => router.push(spot.href), 640);
  };

  return (
    <section
      ref={section}
      aria-labelledby="home-title"
      className="paper relative h-[100svh] min-h-[640px] overflow-hidden"
    >
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 w-full h-full" />

      {/* a soft clearing behind the name so it always reads */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[30%] md:top-1/2 -translate-x-1/2 -translate-y-1/2 w-[120vw] md:w-[70vw] h-[46vh] pointer-events-none"
        style={{ background: "radial-gradient(closest-side, rgba(242,234,215,0.94), rgba(242,234,215,0.7) 55%, transparent)" }}
      />

      <div className="absolute inset-x-0 top-[30%] md:top-1/2 -translate-y-1/2 px-4 text-center pointer-events-none">
        <h1 id="home-title" data-hero-name className="hero-field" style={{ fontSize: "clamp(4.25rem, 13vw, 12rem)" }}>
          Rohin Patel
        </h1>
        <p className="mt-4 mx-auto max-w-[34ch] text-lg md:text-xl leading-snug text-pretty">{pov}</p>
        <p className="mt-2 text-[var(--fg-muted)]">
          {site.role} at {site.employer}
        </p>
      </div>

      <nav aria-label="Sections" className="contents">
        {SPOTS.map((s, i) => (
          <Link
            key={s.href}
            href={s.href}
            ref={(a) => {
              spotRefs.current[i] = a;
            }}
            onClick={(e) => open(e, s)}
            onPointerEnter={() => setHot(i)}
            onPointerLeave={() => setHot(null)}
            onFocus={() => setHot(i)}
            onBlur={() => setHot(null)}
            className={`group absolute z-10 flex items-center gap-3 md:gap-4 ${s.pos} ${
              s.side === "right" ? "flex-row-reverse text-right" : ""
            }`}
          >
            <span data-well aria-hidden="true" className="relative grid place-items-center w-10 h-10 shrink-0">
              <span
                className={`absolute inset-0 rounded-full border border-[var(--signal)] transition-transform duration-500 ${
                  hotIndex === i ? "scale-150 opacity-0" : "animate-[well_2.4s_ease-out_infinite]"
                }`}
              />
              <span
                className={`rounded-full bg-[var(--signal)] transition-all duration-300 ${
                  hotIndex === i ? "w-4 h-4" : "w-2.5 h-2.5"
                }`}
              />
            </span>
            <span className="leading-none">
              <span className="display block text-[2rem] md:text-[3.25rem] transition-colors group-hover:text-[var(--signal)] group-focus-visible:text-[var(--signal)]">
                {s.label}
              </span>
              <span className="mt-1.5 block text-sm text-[var(--fg-muted)]">{s.sub}</span>
            </span>
          </Link>
        ))}
      </nav>

      {ripple && (
        <div aria-hidden="true" className="fixed inset-0 z-[70] pointer-events-none">
          <div
            className="absolute inset-0 bg-[var(--signal)] animate-[ripple_0.5s_cubic-bezier(0.6,0,0.2,1)_both]"
            style={{ ["--rx" as string]: `${ripple.x}px`, ["--ry" as string]: `${ripple.y}px` }}
          />
          <div
            className="absolute inset-0 animate-[ripple_0.5s_0.14s_cubic-bezier(0.6,0,0.2,1)_both]"
            style={{ background: ripple.color, ["--rx" as string]: `${ripple.x}px`, ["--ry" as string]: `${ripple.y}px` }}
          />
        </div>
      )}
    </section>
  );
}
