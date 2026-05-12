"use client";

import { motion } from "framer-motion";
import { alsoInto } from "@/lib/interests";

export default function AlsoInto() {
  return (
    <section className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Also into
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / one-liners
          </span>
        </div>
        <h2 className="text-3xl md:text-5xl font-semibold tracking-tight mb-14">
          A few more things.
        </h2>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
          {alsoInto.map((item, i) => (
            <motion.li
              key={item.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              className="border-t border-[var(--border)] pt-5"
            >
              <h3 className="text-xl md:text-2xl font-semibold tracking-tight mb-2">
                {item.label}
              </h3>
              <p className="muted mb-2 text-pretty">{item.detail}</p>
              <p className="font-mono text-xs uppercase tracking-wider dim">
                {item.hint}
              </p>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
