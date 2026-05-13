"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

type Props = {
  label: string;
  hint?: string;
  caption: string;
  children: ReactNode;
};

// Compact card for non-spotlight interests. Has the same outer chrome as
// InterestCard but renders a smaller toy in the middle slot.
export default function MinorCard({ label, hint, caption, children }: Props) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4 }}
      className="relative flex flex-col bg-[var(--bg)] border border-[var(--border-strong)] hover:border-accent/60 hover:shadow-[0_0_0_1px_var(--accent-soft)] transition-[border-color,box-shadow] duration-300 snap-start min-w-[88vw] md:min-w-0 overflow-hidden group"
    >
      <div className="p-6 md:p-8 flex flex-col gap-4 flex-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            {label}
          </span>
          {hint && (
            <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
              {hint}
            </span>
          )}
        </div>

        <div className="flex-1 flex items-center justify-center py-4">
          {children}
        </div>

        <p className="muted text-sm text-pretty">{caption}</p>
      </div>
    </motion.article>
  );
}
