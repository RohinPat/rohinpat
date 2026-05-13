"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { featuredProjects } from "@/lib/site";

export default function SelectedWork() {
  return (
    <section className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline justify-between mb-12">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
              Selected projects
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
              / built solo
            </span>
          </div>
          <Link
            href="/projects"
            className="link-underline font-mono text-xs uppercase tracking-wider muted hover:text-[var(--fg)] transition-colors"
          >
            All projects →
          </Link>
        </div>

        <ol className="divide-y divide-[var(--border)]">
          {featuredProjects.map((p, i) => (
            <motion.li
              key={p.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <Link
                href={p.href}
                className="group grid grid-cols-12 gap-4 py-8 md:py-10 hover:bg-[var(--bg-elevated)] -mx-4 px-4 transition-colors"
              >
                <span className="col-span-2 md:col-span-1 font-mono text-sm dim self-start pt-1">
                  {String(i + 1).padStart(2, "0")}
                </span>

                <div className="col-span-10 md:col-span-7">
                  <h3 className="text-2xl md:text-4xl font-semibold tracking-tight group-hover:accent transition-colors">
                    {p.title}
                  </h3>
                  <p className="muted mt-3 max-w-prose text-pretty">
                    {p.summary}
                  </p>
                </div>

                <div className="col-span-12 md:col-span-4 md:text-right self-start pt-2">
                  <div className="font-mono text-xs uppercase tracking-wider dim">
                    {p.role}
                  </div>
                  <div className="font-mono text-xs uppercase tracking-wider muted mt-1">
                    {p.year}
                  </div>
                </div>
              </Link>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
