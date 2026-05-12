"use client";

import { motion } from "framer-motion";
import { ExternalLink, Github } from "lucide-react";
import { useState } from "react";

type Project = {
  title: string;
  description: string;
  tech: string[];
  category: "Mobile" | "AI/ML" | "Web";
  year: string;
  github: string | null;
  demo: string | null;
};

const projects: Project[] = [
  {
    title: "WHOOP — Heart-rate Onboarding",
    description:
      "Built live heart-rate onboarding in SwiftUI with real-time BLE streaming. Lifted onboarding completion 15% and Daily Active Members 10%.",
    tech: ["SwiftUI", "BLE", "iOS", "Real-time"],
    category: "Mobile",
    year: "2025",
    github: null,
    demo: null,
  },
  {
    title: "SiPhox — 3D Body Scan iOS App",
    description:
      "First iOS app generating 3D body models from video for body-fat analysis. ±3.9% median error vs. clinical benchmarks.",
    tech: ["SwiftUI", "Python", "3D Graphics", "Computer Vision"],
    category: "Mobile",
    year: "2024",
    github: null,
    demo: null,
  },
  {
    title: "Varidx — Edge Traffic Analytics",
    description:
      "Edge system with YOLO and OpenCV. 95% vehicle-detection accuracy across 50k+ vehicles/day for city dashboards.",
    tech: ["Python", "YOLO", "OpenCV", "Azure", "IoT"],
    category: "AI/ML",
    year: "2024",
    github: null,
    demo: null,
  },
  {
    title: "AiMessage — Mental-health Messaging",
    description:
      "Full-stack real-time messaging with NLP-powered sentiment analysis, emotional-state tracking, and mental-health recommendations.",
    tech: ["Next.js", "TypeScript", "MySQL", "Prisma", "Pusher", "NLP"],
    category: "Web",
    year: "2024",
    github: "https://github.com/RohinPat/ai-message",
    demo: "https://ai-message.vercel.app",
  },
  {
    title: "AI Closet Organization",
    description:
      "PyTorch models for clothing classification at 92% accuracy across 10k+ samples. FastAPI service for real-time outfit recommendations.",
    tech: ["Python", "PyTorch", "FastAPI", "Docker"],
    category: "AI/ML",
    year: "2024",
    github: null,
    demo: null,
  },
  {
    title: "BlueBikes Data Visualization",
    description:
      "Interactive app analyzing Boston's bike-share patterns with heatmaps, geospatial maps, and temporal breakdowns.",
    tech: ["Python", "Flask", "Plotly", "D3.js", "Pandas"],
    category: "AI/ML",
    year: "2023",
    github: "https://github.com/RohinPat/data-visualization-bluebikes",
    demo: "https://data-visualization-bluebikes.vercel.app",
  },
];

const categories = ["All", "Mobile", "AI/ML", "Web"] as const;

export default function Projects() {
  const [filter, setFilter] = useState<(typeof categories)[number]>("All");
  const filtered =
    filter === "All" ? projects : projects.filter((p) => p.category === filter);

  return (
    <section className="py-12 md:py-20 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Work
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / {projects.length} projects
          </span>
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-12">
          What I've shipped.
        </h1>

        <div className="flex flex-wrap gap-2 mb-10">
          {categories.map((c) => (
            <button
              key={c}
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
          {filtered.map((p, i) => (
            <motion.li
              key={p.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              className="py-8 md:py-10 grid grid-cols-12 gap-4 group"
            >
              <div className="col-span-2 md:col-span-1 font-mono text-sm dim pt-1">
                {String(i + 1).padStart(2, "0")}
              </div>

              <div className="col-span-10 md:col-span-7">
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="font-mono text-xs uppercase tracking-wider muted">
                    {p.category}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-wider dim">
                    {p.year}
                  </span>
                </div>
                <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 group-hover:accent transition-colors">
                  {p.title}
                </h2>
                <p className="muted leading-relaxed max-w-prose mb-4 text-pretty">
                  {p.description}
                </p>

                <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs muted">
                  {p.tech.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>

              <div className="col-span-12 md:col-span-4 md:text-right flex md:justify-end gap-4 font-mono text-xs uppercase tracking-wider">
                {p.github ? (
                  <a
                    href={p.github}
                    target="_blank"
                    rel="noopener noreferrer"
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
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
