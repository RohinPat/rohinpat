"use client";

import { motion } from "framer-motion";
import { now } from "@/lib/site";

export default function NowStrip() {
  return (
    <section className="border-t border-[var(--border)] py-16 md:py-20 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-8">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Now
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / what's current
          </span>
        </div>

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-y-5 gap-x-12">
          {now.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              className="flex items-baseline gap-4 border-b border-[var(--border)] pb-4"
            >
              <dt className="font-mono text-xs uppercase tracking-wider muted w-28 shrink-0">
                {item.label}
              </dt>
              <dd className="text-base md:text-lg text-balance">{item.value}</dd>
            </motion.div>
          ))}
        </dl>
      </div>
    </section>
  );
}
