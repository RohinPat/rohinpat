"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CATEGORY_ORDER,
  HEADLINE_SKILLS,
  PROJECTS,
  SKILLS,
  type Skill,
} from "@/lib/skills";

export default function Skills() {
  const [selected, setSelected] = useState<string | null>(null);

  const selectedSkill = useMemo(
    () => (selected ? SKILLS.find((s) => s.name === selected) ?? null : null),
    [selected],
  );

  const toggle = (name: string) =>
    setSelected((prev) => (prev === name ? null : name));

  const totalShipped = useMemo(
    () => SKILLS.filter((s) => s.projects.length > 0).length,
    [],
  );

  return (
    <section className="py-12 md:py-20 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        {/* HEADER */}
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Skills
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / the toolkit
          </span>
        </div>

        {/* HERO — single sentence */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-3xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] text-balance mb-10"
        >
          I mostly live in{" "}
          <span className="accent">{HEADLINE_SKILLS[0]}</span>,{" "}
          <span className="accent">{HEADLINE_SKILLS[1]}</span>, and{" "}
          <span className="accent">{HEADLINE_SKILLS[2]}</span>.
        </motion.h1>

        {/* STATUS LINE — always visible, one line, updates on click */}
        <StatusLine
          skill={selectedSkill}
          totalShipped={totalShipped}
          onClear={() => setSelected(null)}
        />

        {/* CHIP GRID — dense, by category */}
        <div className="mt-8 space-y-7">
          {CATEGORY_ORDER.map((cat, ci) => (
            <motion.div
              key={cat}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: ci * 0.04 }}
              className="grid grid-cols-12 gap-4 items-baseline"
            >
              <h3 className="col-span-12 md:col-span-3 font-mono text-xs uppercase tracking-wider accent">
                {cat}
              </h3>
              <div className="col-span-12 md:col-span-9 flex flex-wrap gap-x-1.5 gap-y-1.5">
                {SKILLS.filter((s) => s.category === cat).map((s) => {
                  const isSelected = s.name === selected;
                  const shipped = s.projects.length > 0;
                  return (
                    <button
                      key={s.name}
                      onClick={() => toggle(s.name)}
                      aria-pressed={isSelected}
                      className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 text-sm border transition-all duration-150 ${
                        isSelected
                          ? "bg-accent text-white border-accent"
                          : shipped
                            ? "border-[var(--border-strong)] hover:border-accent hover:text-[var(--fg)]"
                            : "border-[var(--border)] dim hover:text-[var(--fg)]"
                      }`}
                    >
                      <span>{s.name}</span>
                      <span
                        className={`font-mono text-[10px] ${
                          isSelected
                            ? "text-white/80"
                            : shipped
                              ? "accent"
                              : "opacity-50"
                        }`}
                      >
                        {shipped ? s.projects.length : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>

        {/* LEGEND + footer */}
        <div className="mt-10 pt-6 border-t border-[var(--border)] flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="font-mono text-[10px] uppercase tracking-wider muted">
            chip · n
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider dim">
            n = projects shipped with it · — = in the toolkit, not shipped yet
          </span>
        </div>

      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status Line — single line that updates as you click chips                  */
/* -------------------------------------------------------------------------- */

function StatusLine({
  skill,
  totalShipped,
  onClear,
}: {
  skill: Skill | null;
  totalShipped: number;
  onClear: () => void;
}) {
  return (
    <div className="border-y border-[var(--border)] py-4 px-1 -mx-1 min-h-[64px] flex items-center">
      <AnimatePresence initial={false} mode="wait">
        {skill ? (
          <motion.div
            key={skill.name}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-2 w-full"
          >
            <span className="font-mono text-[10px] uppercase tracking-wider accent shrink-0">
              {skill.category}
            </span>
            <span className="text-lg md:text-xl font-semibold tracking-tight">
              {skill.name}
            </span>
            <span className="muted text-sm">
              {skill.projects.length === 0 ? (
                "studied + used in side experiments — not shipped on a listed project yet."
              ) : (
                <>
                  shipped on{" "}
                  {skill.projects.map((slug, i) => (
                    <span key={slug}>
                      <Link
                        href="/projects"
                        className="text-[var(--fg)] underline decoration-[var(--border-strong)] underline-offset-2 hover:decoration-accent hover:accent transition-colors"
                      >
                        {PROJECTS[slug].name}
                      </Link>
                      <span className="font-mono text-[10px] uppercase tracking-wider dim ml-1">
                        {PROJECTS[slug].year}
                      </span>
                      {i < skill.projects.length - 1 && (
                        <span className="dim mx-1">·</span>
                      )}
                    </span>
                  ))}
                </>
              )}
            </span>
            <button
              onClick={onClear}
              className="ml-auto font-mono text-[10px] uppercase tracking-wider muted hover:accent transition-colors shrink-0"
            >
              clear ×
            </button>
          </motion.div>
        ) : (
          <motion.p
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="muted text-sm"
          >
            Tap a chip below to see where I&apos;ve shipped it.{" "}
            <span className="font-mono text-[10px] uppercase tracking-wider dim ml-2">
              {totalShipped} of {SKILLS.length} shipped on a project so far
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
