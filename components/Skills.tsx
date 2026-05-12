"use client";

import { motion } from "framer-motion";

const groups = [
  {
    title: "Mobile",
    skills: ["SwiftUI", "iOS", "BLE", "React Native", "Haptics"],
  },
  {
    title: "AI / ML",
    skills: ["PyTorch", "TensorFlow", "YOLO", "OpenCV", "NLP", "Scikit-Learn"],
  },
  {
    title: "Languages",
    skills: ["Python", "Swift", "TypeScript", "JavaScript", "Java", "Go", "C++", "SQL"],
  },
  {
    title: "Cloud / DevOps",
    skills: ["AWS (Lambda, S3, Textract)", "Azure", "Docker", "Kubernetes", "CI/CD", "Redis"],
  },
  {
    title: "Web / Backend",
    skills: ["React", "Next.js", "Node", "FastAPI", "Flask", "gRPC", "REST"],
  },
  {
    title: "Data",
    skills: ["PostgreSQL", "MySQL", "MongoDB", "Prisma", "Supabase", "Pandas", "NumPy"],
  },
];

export default function Skills() {
  return (
    <section className="py-12 md:py-20 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Skills
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / the toolkit
          </span>
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-14">
          What I reach for.
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 border-y border-[var(--border)] py-12">
          {groups.map((g, i) => (
            <motion.div
              key={g.title}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
            >
              <h2 className="font-mono text-xs uppercase tracking-wider accent mb-4">
                {g.title}
              </h2>
              <ul className="flex flex-wrap gap-x-3 gap-y-2 text-base md:text-lg">
                {g.skills.map((s, j) => (
                  <li key={s} className="muted">
                    {s}
                    {j < g.skills.length - 1 && (
                      <span className="dim ml-3">·</span>
                    )}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <p className="mt-10 muted max-w-prose text-pretty">
          Picked up over three co-ops and a lot of side projects. The list grows; the curiosity is the constant.
        </p>
      </div>
    </section>
  );
}
