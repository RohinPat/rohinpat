"use client";

import { motion } from "framer-motion";
import { watches } from "@/lib/interests";

function Dial() {
  // Pure-CSS/SVG watch face ornament — placeholder for real photos.
  return (
    <svg viewBox="0 0 100 100" className="w-full aspect-square">
      <defs>
        <radialGradient id="dial" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#050505" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#dial)" stroke="#2a2a2a" strokeWidth="0.6" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="#1a1a1a" strokeWidth="0.4" />
      {[...Array(12)].map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const x1 = 50 + Math.sin(angle) * 38;
        const y1 = 50 - Math.cos(angle) * 38;
        const x2 = 50 + Math.sin(angle) * 41;
        const y2 = 50 - Math.cos(angle) * 41;
        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={i % 3 === 0 ? "#ededed" : "#4a4a4a"}
            strokeWidth={i % 3 === 0 ? 0.9 : 0.5}
          />
        );
      })}
      {/* Hands frozen at 10:10 — watch-ad pose */}
      <line x1="50" y1="50" x2="33" y2="33" stroke="#ededed" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="50" y1="50" x2="69" y2="33" stroke="#ededed" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="50" y1="50" x2="50" y2="70" stroke="#a50044" strokeWidth="0.6" strokeLinecap="round" />
      <circle cx="50" cy="50" r="1.4" fill="#ededed" />
    </svg>
  );
}

export default function WatchesBlock() {
  return (
    <section className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            01 — Watches
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / on the wrist
          </span>
        </div>
        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight mb-4">
          A small rotation. A long wishlist.
        </h2>
        <p className="muted max-w-prose mb-14 text-pretty">
          Tools beat jewelry. I rotate three regularly and chase a few I haven't earned yet.
        </p>

        <h3 className="font-mono text-xs uppercase tracking-wider muted mb-6">
          Current rotation
        </h3>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {watches.rotation.map((w, i) => (
            <motion.li
              key={w.name}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="group"
            >
              <div className="aspect-square mb-5 bg-[var(--bg-elevated)] p-6 border border-[var(--border)] group-hover:border-accent transition-colors">
                <Dial />
              </div>
              <div className="font-mono text-xs uppercase tracking-wider dim mb-1">
                {w.detail}
              </div>
              <h4 className="text-xl font-semibold tracking-tight mb-2 group-hover:accent transition-colors">
                {w.name}
              </h4>
              <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 font-mono text-xs muted mb-3">
                <dt className="dim">Caliber</dt><dd>{w.caliber}</dd>
                <dt className="dim">Case</dt><dd>{w.size}</dd>
                <dt className="dim">Strap</dt><dd>{w.strap}</dd>
              </dl>
              <p className="text-sm muted italic">{w.note}</p>
            </motion.li>
          ))}
        </ul>

        <h3 className="font-mono text-xs uppercase tracking-wider muted mb-6">
          Wishlist
        </h3>
        <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {watches.wishlist.map((w, i) => (
            <motion.li
              key={w.name}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              className="py-5 flex items-baseline gap-6 group hover:bg-[var(--bg-elevated)] -mx-3 px-3 transition-colors"
            >
              <span className="font-mono text-xs dim w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex-1">
                <span className="text-lg font-medium group-hover:accent transition-colors">{w.name}</span>
                <span className="muted ml-3">— {w.detail}</span>
              </div>
              <span className="font-mono text-xs muted italic hidden md:inline">{w.note}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
