"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatBostonTime } from "@/lib/clock";
import { headline, site, teamLine } from "@/lib/site";

// Hero: a giant split name on drafting paper with an iPhone between the two
// halves. The phone's lock screen runs on Boston time and its notifications
// are real links into the site. Scrolling pulls the name apart and lifts the
// phone away.

type BostonNow = { full: string; clock: string; date: string };

function useBostonNow(): BostonNow | null {
  const [now, setNow] = useState<BostonNow | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const full = formatBostonTime(d); // "11:44 PM"
      setNow({
        full,
        clock: full.replace(/\s?[AP]M$/i, ""),
        date: d.toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
      });
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const notifications = [
  {
    app: "Work",
    mark: "W",
    title: headline,
    body: teamLine,
    href: "/projects#whoop",
  },
  {
    app: "Projects",
    mark: "P",
    title: "Closet Organizer",
    body: "ResNet50 + color theory. One FastAPI backend, two apps.",
    href: "/projects#closet-organizer",
  },
  {
    app: "Off hours",
    mark: "O",
    title: "Nine small experiments",
    body: "Watches, cars, Barça, vinyl, skiing — made interactive.",
    href: "/interests",
  },
];

export default function LockScreenHero() {
  const ref = useRef<HTMLElement>(null);
  const now = useBostonNow();
  // Scroll progress through the hero (0 → 1) as a CSS variable; the name
  // halves and the phone read it in their transforms. One passive listener,
  // no re-renders.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / r.height));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={ref}
      className="paper paper-grid relative min-h-[100svh] overflow-hidden px-4 md:px-10 pt-20 pb-8 flex flex-col"
    >
      {/* Top meta row */}
      <div className="relative z-20 flex items-start justify-between gap-4 font-mono text-[11px] md:text-xs uppercase tracking-[0.18em] muted">
        <p className="hidden sm:block">{headline}</p>
        <p className="sm:text-right">{site.location}</p>
      </div>

      {/* Name + phone */}
      <div className="relative flex-1 flex flex-col md:flex-row md:items-center md:min-h-[520px]">
        <h1
          className="hero-name display w-full flex flex-col md:flex-row justify-between items-start md:items-center pt-6 md:py-2 select-none"
          style={{ fontSize: "clamp(7rem, 21vw, 22rem)" }}
        >
          {/* Outer span: one-off entrance. Inner span: scroll-linked drift. */}
          <span className="block enter-left">
            <span className="block scroll-fx" style={{ transform: "translateX(calc(var(--p, 0) * -35%))" }}>
              Rohin
            </span>
          </span>
          <span className="block self-end md:self-auto enter-right">
            <span className="block scroll-fx" style={{ transform: "translateX(calc(var(--p, 0) * 35%))" }}>
              Patel
            </span>
          </span>
        </h1>

        {/* Phone — below the stacked name on phones, centred over it on desktop */}
        <div className="relative md:absolute md:inset-0 z-10 flex md:grid justify-center md:place-items-center -mt-[3vw] md:mt-0 pointer-events-none">
          <div className="pointer-events-auto enter-up">
            <div
              className="scroll-fx"
              style={{ transform: "translateY(calc(var(--p, 0) * 220px)) rotate(calc(var(--p, 0) * -8deg))" }}
            >
              <Phone now={now} />
            </div>
          </div>
        </div>
      </div>

      {/* Tagline + CTAs */}
      <div className="relative z-20 mt-6 grid md:grid-cols-12 gap-6 items-end">
        <p className="md:col-span-6 text-lg md:text-2xl leading-snug text-balance max-w-xl">
          I build iOS apps, ML systems and the occasional toy. This site is one of
          them.
        </p>
        <div className="md:col-span-6 flex flex-wrap md:justify-end items-center gap-3">
          <Link
            href="/projects"
            className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--ink)] text-[var(--paper)] font-medium hover:bg-[var(--signal)] hover:text-[var(--ink)] transition-colors"
          >
            See the work
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
          <Link
            href="/interests"
            className="inline-flex items-center gap-2 px-5 py-3 border border-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors"
          >
            Off hours
          </Link>
        </div>
      </div>

    </section>
  );
}

function Phone({ now }: { now: BostonNow | null }) {
  return (
    <div
      className="relative w-[min(60vw,290px)] aspect-[9/19] rounded-[2.9rem] bg-[var(--ink)] p-[9px] shadow-[0_40px_80px_-20px_rgba(12,12,11,0.55),0_0_0_1px_rgba(12,12,11,0.9)]"
      role="group"
      aria-label="Phone lock screen with links into the site"
    >
      {/* side buttons */}
      <span aria-hidden="true" className="absolute -left-[3px] top-28 w-[3px] h-10 rounded-l bg-[var(--ink)]" />
      <span aria-hidden="true" className="absolute -left-[3px] top-44 w-[3px] h-16 rounded-l bg-[var(--ink)]" />
      <span aria-hidden="true" className="absolute -right-[3px] top-36 w-[3px] h-20 rounded-r bg-[var(--ink)]" />

      <div
        className="relative h-full w-full rounded-[2.35rem] overflow-hidden text-[var(--paper)] flex flex-col"
        style={{
          background:
            "radial-gradient(95% 55% at 50% 12%, rgba(255,74,28,0.62) 0%, rgba(255,74,28,0.18) 45%, transparent 75%), #0c0c0b",
        }}
      >
        {/* dynamic island */}
        <span aria-hidden="true" className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[34%] h-[22px] rounded-full bg-black" />

        {/* status bar */}
        <div aria-hidden="true" className="flex justify-between px-6 pt-3 text-[11px] font-semibold tabular-nums">
          <span>{now?.clock ?? "9:41"}</span>
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-[2px] h-2.5">
              <i className="w-[3px] h-1 bg-current rounded-sm" />
              <i className="w-[3px] h-1.5 bg-current rounded-sm" />
              <i className="w-[3px] h-2 bg-current rounded-sm" />
              <i className="w-[3px] h-2.5 bg-current rounded-sm" />
            </span>
            <span className="ml-1 w-5 h-2.5 rounded-[3px] border border-current p-[1px]">
              <span className="block h-full w-3/4 bg-current rounded-[1px]" />
            </span>
          </span>
        </div>

        {/* clock */}
        <div className="text-center mt-8">
          <p className="text-[13px] font-medium opacity-90">
            {now?.date ?? " "}
          </p>
          <p
            className="display leading-none mt-1 tabular-nums"
            style={{ fontSize: "clamp(3.6rem, 19vw, 5.4rem)", fontStretch: "75%" }}
            aria-label={now ? `Boston time ${now.full}` : undefined}
          >
            {now?.clock ?? "—:—"}
          </p>
        </div>

        {/* notifications */}
        <ul className="mt-auto px-2.5 space-y-1.5">
          {notifications.map((n) => (
            <li key={n.app}>
              <Link
                href={n.href}
                className="flex gap-2.5 p-2.5 rounded-[1.1rem] bg-white/[0.13] backdrop-blur-md hover:bg-white/[0.22] transition-colors text-left"
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 w-8 h-8 rounded-[0.55rem] bg-[var(--signal)] text-[var(--ink)] grid place-items-center display text-lg"
                >
                  {n.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between text-[10px] uppercase tracking-wide opacity-80">
                    <span>{n.app}</span>
                    <span aria-hidden="true">now</span>
                  </span>
                  <span className="block text-[12.5px] font-semibold leading-tight truncate">
                    {n.title}
                  </span>
                  <span className="block text-[11.5px] leading-snug opacity-85 line-clamp-2">
                    {n.body}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/* bottom affordances */}
        <div aria-hidden="true" className="flex items-center justify-between px-7 pt-3 pb-2">
          <span className="w-9 h-9 rounded-full bg-white/[0.13] backdrop-blur-md grid place-items-center text-xs">✦</span>
          <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.18em] opacity-80 whitespace-nowrap">Scroll to unlock</span>
          <span className="w-9 h-9 rounded-full bg-white/[0.13] backdrop-blur-md grid place-items-center text-xs">◎</span>
        </div>
        <span aria-hidden="true" className="mx-auto mb-2 w-[36%] h-[4px] rounded-full bg-[rgba(241,238,231,0.8)]" />
      </div>
    </div>
  );
}
