"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Github, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { projects } from "@/lib/projects";

const categories = ["All", "Mobile", "AI/ML", "Web"] as const;

export default function Projects() {
  const [filter, setFilter] = useState<(typeof categories)[number]>("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Deep links from the homepage filmstrip: /projects#<slug> opens that row.
  useEffect(() => {
    const slug = window.location.hash.slice(1);
    const match = projects.find((p) => p.slug === slug);
    if (!match) return;
    setExpanded(match.title);
    document.getElementById(slug)?.scrollIntoView({ block: "start" });
  }, []);

  const filtered =
    filter === "All" ? projects : projects.filter((p) => p.category === filter);

  return (
    <section className="py-12 md:py-20 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Projects
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / solo first, co-op work below · click any to expand
          </span>
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-12">
          What I&apos;ve built.
        </h1>

        <div className="flex flex-wrap gap-2 mb-10">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={filter === c}
              onClick={() => setFilter(c)}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider border transition-colors ${
                filter === c
                  ? "border-accent accent"
                  : "border-[var(--border)] muted hover:text-[var(--fg)] hover:border-[var(--border-strong)]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {filtered.map((p, i) => {
            const isOpen = expanded === p.title;
            return (
              <motion.li
                key={p.title}
                id={p.slug}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.35, delay: i * 0.04 }}
                className={`scroll-mt-24 ${isOpen ? "bg-[var(--bg-elevated)]" : ""}`}
              >
                {/* Clickable header — toggles the panel */}
                <button
                  onClick={() => setExpanded(isOpen ? null : p.title)}
                  aria-expanded={isOpen}
                  className="w-full text-left py-8 md:py-10 px-4 -mx-4 grid grid-cols-12 gap-4 group cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  <div className="col-span-2 md:col-span-1 font-mono text-sm dim pt-1">
                    {String(i + 1).padStart(2, "0")}
                  </div>

                  <div className="col-span-8 md:col-span-9">
                    <div className="flex items-baseline gap-3 mb-3">
                      <span className="font-mono text-xs uppercase tracking-wider muted">
                        {p.category}
                      </span>
                      <span className="font-mono text-xs uppercase tracking-wider dim">
                        {p.year}
                      </span>
                    </div>
                    <h2
                      className={`text-2xl md:text-3xl font-semibold tracking-tight mb-3 transition-colors ${
                        isOpen ? "accent" : "group-hover:accent"
                      }`}
                    >
                      {p.title}
                    </h2>
                    {!isOpen && (
                      <p className="muted leading-relaxed max-w-prose text-pretty">
                        {p.description}
                      </p>
                    )}
                  </div>

                  <div className="col-span-2 md:col-span-2 flex items-start justify-end pt-1">
                    <motion.div
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className={`muted group-hover:accent transition-colors ${
                        isOpen ? "accent" : ""
                      }`}
                    >
                      <ChevronDown size={22} strokeWidth={1.5} />
                    </motion.div>
                  </div>
                </button>

                {/* Expanded panel */}
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="panel"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-12 gap-4 pb-10 px-4 -mx-4">
                        <div className="col-span-2 md:col-span-1" />
                        <div className="col-span-10 md:col-span-11 space-y-7">
                          <DetailRow label="Problem" body={p.details.problem} />
                          <DetailRow label="Approach" body={p.details.approach} />
                          <ImpactList impact={p.details.impact} />

                          <div className="pt-2 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[var(--border)] pt-5">
                            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs muted">
                              {p.tech.map((t) => (
                                <span key={t}>{t}</span>
                              ))}
                            </div>
                            <div className="flex gap-4 font-mono text-xs uppercase tracking-wider ml-auto">
                              {p.github ? (
                                <a
                                  href={p.github}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="link-underline inline-flex items-center gap-1.5 hover:accent transition-colors"
                                >
                                  <Github size={14} /> Code
                                </a>
                              ) : (
                                <span className="dim inline-flex items-center gap-1.5">
                                  <Github size={14} /> Private
                                </span>
                              )}
                              {p.demo ? (
                                <a
                                  href={p.demo}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="link-underline inline-flex items-center gap-1.5 hover:accent transition-colors"
                                >
                                  <ExternalLink size={14} /> Demo
                                </a>
                              ) : (
                                <span className="dim inline-flex items-center gap-1.5">
                                  <ExternalLink size={14} /> NDA
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </ol>

        <p className="mt-8 font-mono text-xs uppercase tracking-wider dim text-center">
          {expanded
            ? "click again to collapse · or click another to switch"
            : "click any row for the story behind it"}
        </p>
      </div>
    </section>
  );
}

function DetailRow({ label, body }: { label: string; body: string }) {
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 md:col-span-3">
        <p className="font-mono text-xs uppercase tracking-wider accent">
          {label}
        </p>
      </div>
      <div className="col-span-12 md:col-span-9">
        <p className="muted leading-relaxed text-pretty">{body}</p>
      </div>
    </div>
  );
}

function ImpactList({ impact }: { impact: string[] }) {
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 md:col-span-3">
        <p className="font-mono text-xs uppercase tracking-wider accent">
          Impact
        </p>
      </div>
      <div className="col-span-12 md:col-span-9">
        <ul className="space-y-2">
          {impact.map((line, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }}
              className="flex gap-3"
            >
              <span className="accent shrink-0">—</span>
              <span className="text-pretty">{line}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}
