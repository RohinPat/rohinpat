"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const tiles = [
  {
    label: "Music",
    blurb: "Headphones on most of the day.",
    hint: "Live, from my Spotify.",
  },
  {
    label: "Barça",
    blurb: "Més que un club.",
    hint: "Just a fan.",
  },
  {
    label: "Cars",
    blurb: "Three pedals when I can.",
    hint: "Old over new, usually.",
  },
  {
    label: "Watches",
    blurb: "Mechanical, mostly.",
    hint: "More about the movement.",
  },
];

export default function SelectedInterests() {
  return (
    <section className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline justify-between mb-12">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
              Outside the IDE
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
              / interests
            </span>
          </div>
          <Link
            href="/interests"
            className="link-underline font-mono text-xs uppercase tracking-wider muted hover:text-[var(--fg)] transition-colors"
          >
            Full page →
          </Link>
        </div>

        <ul className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border)] border border-[var(--border)]">
          {tiles.map((t, i) => (
            <motion.li
              key={t.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
            >
              <Link
                href="/interests"
                className="group block h-full bg-[var(--bg)] p-6 md:p-8 hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <span className="font-mono text-xs uppercase tracking-wider dim mb-3 block">
                  0{i + 1}
                </span>
                <h3 className="text-xl md:text-2xl font-semibold tracking-tight mb-2 group-hover:accent transition-colors">
                  {t.label}
                </h3>
                <p className="muted text-sm leading-relaxed mb-4 text-pretty">
                  {t.blurb}
                </p>
                <p className="font-mono text-xs dim">{t.hint}</p>
              </Link>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
