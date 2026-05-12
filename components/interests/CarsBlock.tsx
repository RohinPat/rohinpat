"use client";

import { motion } from "framer-motion";
import { cars } from "@/lib/interests";

function Gauge() {
  return (
    <svg viewBox="0 0 100 60" className="w-full">
      <defs>
        <linearGradient id="gauge" x1="0" x2="1">
          <stop offset="0%" stopColor="#2a2a2a" />
          <stop offset="70%" stopColor="#ededed" />
          <stop offset="100%" stopColor="#a50044" />
        </linearGradient>
      </defs>
      <path
        d="M 10 55 A 40 40 0 0 1 90 55"
        fill="none"
        stroke="#1a1a1a"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M 10 55 A 40 40 0 0 1 90 55"
        fill="none"
        stroke="url(#gauge)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const angle = Math.PI + (i / 5) * Math.PI;
        const x1 = 50 + Math.cos(angle) * 36;
        const y1 = 55 + Math.sin(angle) * 36;
        const x2 = 50 + Math.cos(angle) * 42;
        const y2 = 55 + Math.sin(angle) * 42;
        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="#4a4a4a"
            strokeWidth="0.8"
          />
        );
      })}
      <line x1="50" y1="55" x2="78" y2="28" stroke="#a50044" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="50" cy="55" r="2.2" fill="#ededed" />
    </svg>
  );
}

export default function CarsBlock() {
  const c = cars.current;
  return (
    <section className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            02 — Cars
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / the garage
          </span>
        </div>
        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight mb-4">
          One real. Three for later.
        </h2>
        <p className="muted max-w-prose mb-14 text-pretty">
          The daily is practical. The list is not.
        </p>

        {/* Current */}
        <h3 className="font-mono text-xs uppercase tracking-wider muted mb-6">
          Currently driving
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16 border-y border-[var(--border)] py-10">
          <div className="md:col-span-2">
            <div className="font-mono text-xs uppercase tracking-wider dim mb-1">
              {c.year}
            </div>
            <h4 className="text-3xl md:text-5xl font-semibold tracking-tight mb-3">
              {c.make} <span className="accent">{c.model}</span>
            </h4>
            <p className="font-mono text-sm muted mb-4">{c.spec}</p>
            <p className="text-lg muted italic max-w-prose">{c.note}</p>
          </div>
          <div className="md:col-span-1 flex items-end">
            <div className="w-full max-w-[200px] md:ml-auto opacity-80">
              <Gauge />
            </div>
          </div>
        </div>

        {/* Dreams — tiered */}
        <h3 className="font-mono text-xs uppercase tracking-wider muted mb-6">
          The dream garage
        </h3>
        <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {cars.dreams.map((d, i) => (
            <motion.li
              key={`${d.make}-${d.model}`}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="py-7 grid grid-cols-12 gap-4 group hover:bg-[var(--bg-elevated)] -mx-4 px-4 transition-colors"
            >
              <div className="col-span-12 md:col-span-3 flex flex-col">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] accent">
                  {d.tier}
                </span>
                <span className="font-mono text-xs dim mt-1">{d.year}</span>
              </div>
              <div className="col-span-12 md:col-span-5">
                <h4 className="text-xl md:text-2xl font-semibold tracking-tight group-hover:accent transition-colors">
                  {d.make} {d.model}
                </h4>
                <p className="font-mono text-xs muted mt-1">{d.spec}</p>
              </div>
              <p className="col-span-12 md:col-span-4 md:text-right muted italic text-sm self-center">
                {d.note}
              </p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
