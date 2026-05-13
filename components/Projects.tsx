"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Github, ChevronDown } from "lucide-react";
import { useState } from "react";

type Project = {
  title: string;
  description: string;
  tech: string[];
  category: "Mobile" | "AI/ML" | "Web";
  year: string;
  github: string | null;
  demo: string | null;
  details: {
    problem: string;
    approach: string;
    impact: string[];
  };
};

const projects: Project[] = [
  {
    title: "Closet Organizer — End-to-end AI Wardrobe",
    description:
      "Full-stack AI wardrobe. ResNet50 classifier, color-theory outfit engine, FastAPI backend serving both a React Native mobile app and a vanilla-JS web UI.",
    tech: [
      "FastAPI",
      "PyTorch",
      "ResNet50",
      "React Native",
      "TypeScript",
      "Expo",
      "SQLite",
      "JWT",
    ],
    category: "AI/ML",
    year: "2025",
    github: null,
    demo: null,
    details: {
      problem:
        "Closet apps either classify clothes badly or ship recommendations with no theory behind them — and every \"AI closet\" sends your wardrobe to a cloud you don't control. I wanted one that actually classified clothing, recommended outfits with rules, and ran entirely on-device.",
      approach:
        "One async FastAPI backend with a transfer-learned ResNet50 classifier (17+ clothing categories), k-means dominant-color extraction, and a from-scratch outfit recommender driven by color-theory compatibility math. Two clients on top of the same API: a React Native + Expo mobile app in TypeScript, and a vanilla-JS/HTML web client. JWT + bcrypt auth built from scratch — no Auth0, no Firebase. SQLite, runs offline, no cloud dependencies.",
      impact: [
        "End-to-end ML pipeline: image upload → ResNet50 inference → k-means color extraction → DB storage",
        "Cross-platform: one Python backend powering a React Native mobile app and a web UI",
        "Custom outfit recommender built on color-theory rules — not ML, real math",
        "JWT + bcrypt auth from scratch — zero third-party auth services",
        "Full wardrobe system: closet CRUD, wear tracking, laundry queue, freshness scoring, analytics",
        "Runs entirely offline — local SQLite, local model, no cloud calls",
        "TypeScript-strict mobile app with a custom typed API client layer",
      ],
    },
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
    details: {
      problem:
        "Most messaging apps are blind to emotional context — especially for people in vulnerable moments where what they're saying matters more than what they meant to.",
      approach:
        "Built a full-stack real-time messaging platform with sentiment + emotional-state tracking woven into the message pipeline itself. When concerning patterns appear, the UI gently surfaces mental-health resources — without breaking the conversation.",
      impact: [
        "Solo: Next.js + Prisma + MySQL + Pusher + NLP layer, shipped",
        "Public demo at ai-message.vercel.app",
        "Real-time channels via Pusher, emotional-state tracking server-side",
      ],
    },
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
    details: {
      problem:
        "BlueBikes publishes raw trip data — millions of rides — but no one had visualized it at a city level. The interesting questions (where, when, who, why) live in the geo + temporal joins.",
      approach:
        "Built a Flask + Plotly + D3 dashboard with six visualization types: trip heatmaps, station geo-clusters, temporal breakdowns by hour/day/season, weather overlays, and route-level analytics.",
      impact: [
        "Public demo at data-visualization-bluebikes.vercel.app",
        "Six distinct visualizations over years of trip data",
        "Pandas-driven aggregation, D3/Plotly rendered on demand",
      ],
    },
  },
  {
    title: "WHOOP — Heart-rate Onboarding",
    description:
      "Built live heart-rate onboarding in SwiftUI with real-time BLE streaming. Lifted onboarding completion 15% and Daily Active Members 10%.",
    tech: ["SwiftUI", "BLE", "iOS", "Real-time"],
    category: "Mobile",
    year: "2025",
    github: null,
    demo: null,
    details: {
      problem:
        "New users were dropping off during onboarding before getting any signal that the strap actually worked. The flow asked them to trust the device without showing it doing anything.",
      approach:
        "Wired CoreBluetooth straight into the SwiftUI onboarding view. The second the strap registers a pulse, the screen comes alive — a live BPM number, an animated waveform, and a haptic tick on each beat. The data is the moment.",
      impact: [
        "+15% onboarding completion across new members",
        "+10% Daily Active Members (DAM) measured downstream",
        "+25% PR throughput across 20 iOS engineers via the DInject mock generator",
      ],
    },
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
    details: {
      problem:
        "Body composition tracking required clinical equipment — DEXA scans, callipers, or trained staff. SiPhox wanted that signal from a phone camera alone.",
      approach:
        "Shipped the first iOS app in the company's history: SwiftUI capture flow that walks a user through a guided video, uploads to a Python backend that reconstructs a 3D mesh and derives body-fat metrics.",
      impact: [
        "±3.9% median error vs. clinical benchmarks",
        "End-to-end ownership — capture, upload, reconstruction pipeline, results UI",
        "Backend also automated blood-test parsing via AWS Lambda + OpenAI/Textract at 95% accuracy",
      ],
    },
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
    details: {
      problem:
        "Cities had traffic cameras everywhere but couldn't process video at scale on-device. Existing pipelines required sending everything to a server, which didn't work for live counts or low-bandwidth deployments.",
      approach:
        "Built a YOLO + OpenCV inference pipeline that runs on edge IoT hardware, with a real-time collision-alert system on top. Counts and events stream up to Azure where the city analytics dashboards live.",
      impact: [
        "95% vehicle-detection accuracy",
        "50,000+ vehicles/day tracked per node",
        "Live collision detection on adjacent lanes — became the dashboard headline metric",
      ],
    },
  },
];

const categories = ["All", "Mobile", "AI/ML", "Web"] as const;

export default function Projects() {
  const [filter, setFilter] = useState<(typeof categories)[number]>("All");
  const [expanded, setExpanded] = useState<string | null>(null);

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
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.35, delay: i * 0.04 }}
                className={isOpen ? "bg-[var(--bg-elevated)]" : ""}
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
