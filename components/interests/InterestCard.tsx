"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

type Props = {
  label: string;
  hint: string;
  title: string;
  titleItalic?: boolean;
  caption: ReactNode;
  children: ReactNode;
  decoration?: ReactNode;
  headerExtra?: ReactNode;
};

// Shared chrome for each interest spotlight. Lives in a grid cell on desktop,
// snap-scrolls horizontally on mobile.
export function InterestCard({
  label,
  hint,
  title,
  titleItalic,
  caption,
  children,
  decoration,
  headerExtra,
}: Props) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4 }}
      className="relative flex flex-col bg-[var(--bg)] border border-[var(--border-strong)] hover:border-accent/60 hover:shadow-[0_0_0_1px_var(--accent-soft)] transition-[border-color,box-shadow] duration-300 snap-start min-w-[88vw] md:min-w-0 overflow-hidden"
    >
      {decoration}

      <div className="p-6 md:p-8 flex flex-col gap-4 flex-1">
        <div className="flex items-start gap-4">
          {headerExtra}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 mb-2 flex-wrap">
              <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
                {label}
              </span>
              <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
                {hint}
              </span>
            </div>
            <h2
              className={`text-2xl md:text-3xl font-semibold tracking-tight text-balance ${
                titleItalic ? "italic" : ""
              }`}
            >
              {title}
            </h2>
          </div>
        </div>

        <p className="muted text-sm md:text-base text-pretty">{caption}</p>

        <div className="mt-auto pt-6">{children}</div>
      </div>
    </motion.article>
  );
}
