"use client";

import { motion, Variants } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatBostonTime } from "@/lib/clock";
import HeroPond from "@/components/HeroPond";

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

// Children fade up. Container holds the splash-synced delay + stagger.
const container: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 1.2,      // wait for the pond splash impact
      staggerChildren: 0.15,
    },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.2, 0.65, 0.3, 1] },
  },
};

export default function Hero() {
  const time = useBostonClock();

  return (
    <section className="min-h-screen flex items-center px-6 md:px-10 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      >
        <HeroPond />
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={container}
        className="max-w-5xl w-full mx-auto relative z-10"
      >
        <motion.p
          variants={item}
          className="font-mono text-xs uppercase tracking-[0.2em] muted mb-6 flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          <span>Patel, Rohin — Boston, MA</span>
          <span className="dim">·</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            <span className="tabular-nums">{time ?? "—:—"}</span>
          </span>
        </motion.p>

        <motion.h1
          variants={item}
          className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] mb-6 text-balance"
        >
          Incoming Software Engineer at <span className="accent">WHOOP.</span>
          <br />
          <span className="muted">NEU CS '26 — </span>done.
        </motion.h1>

        <motion.p
          variants={item}
          className="text-base md:text-lg muted max-w-xl leading-relaxed mb-3 text-pretty"
        >
          Just graduated. Back at WHOOP full-time in July. Building solo until then.
        </motion.p>

        <motion.p
          variants={item}
          className="text-base md:text-lg muted max-w-xl leading-relaxed mb-10 text-pretty"
        >
          Outside of work: skiing, watches, Barça, building keyboards.
        </motion.p>

        <motion.div variants={item} className="flex flex-wrap items-center gap-3">
          <Link
            href="/projects"
            className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--fg)] text-[var(--bg)] font-medium hover:bg-accent hover:text-white transition-colors"
          >
            See the projects
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
        </motion.div>
      </motion.div>
    </section>
  );
}
