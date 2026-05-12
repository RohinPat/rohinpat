"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatBostonTime } from "@/lib/clock";

function useBostonClock() {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setTime(formatBostonTime());
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export default function Hero() {
  const time = useBostonClock();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  // As the hero leaves, drift it up and fade it.
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const y = useTransform(scrollYProgress, [0, 1], [0, -80]);

  return (
    <section
      ref={sectionRef}
      className="min-h-[82vh] flex items-center px-6 md:px-10 relative"
    >
      <motion.div
        style={{ opacity, y }}
        className="max-w-5xl w-full mx-auto"
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <p className="font-mono text-xs uppercase tracking-[0.2em] muted mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Patel, Rohin — Boston, MA</span>
            <span className="dim">·</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
              <span className="tabular-nums">{time ?? "—:—"}</span>
            </span>
          </p>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] mb-6 text-balance">
            iOS Engineer at <span className="accent">WHOOP.</span>
            <br />
            <span className="muted">NEU CS '26 — </span>done.
          </h1>

          <p className="text-base md:text-lg muted max-w-xl leading-relaxed mb-3 text-pretty">
            Just graduated. Heading to WHOOP full-time. Swift days, ML side quests.
          </p>
          <p className="text-base md:text-lg muted max-w-xl leading-relaxed mb-10 text-pretty">
            Outside of work: skiing, watches, Barça, building keyboards, French horn (poorly).
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/projects"
              className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--fg)] text-[var(--bg)] font-medium hover:bg-accent hover:text-white transition-colors"
            >
              See the work
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-5 py-3 border border-[var(--border-strong)] hover:border-accent hover:text-accent transition-colors"
            >
              Get in touch
            </Link>
            <Link
              href="/interests"
              className="ml-1 link-underline font-mono text-sm uppercase tracking-wider muted hover:text-[var(--fg)] transition-colors"
            >
              or just see what I'm into →
            </Link>
          </div>
        </motion.div>
      </motion.div>

      {/* Subtle scroll hint at the bottom */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.8 }}
        style={{ opacity }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none"
      >
        <motion.span
          className="font-mono text-[10px] uppercase tracking-[0.25em] dim"
          animate={{ y: [0, 4, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          scroll
        </motion.span>
        <motion.span
          className="w-px h-8 bg-[var(--border-strong)] origin-top"
          animate={{ scaleY: [0.3, 1, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
    </section>
  );
}
