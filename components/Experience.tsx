"use client";

import { motion } from "framer-motion";

const experiences = [
  {
    company: "WHOOP",
    role: "iOS Engineer · Co-op",
    period: "Jul 2025 — Dec 2025 · Returning full-time Jul 2026",
    location: "Boston, MA",
    bullets: [
      "Improved onboarding completion by 15% with live BLE heart-rate streaming in SwiftUI.",
      "Boosted Daily Active Members by 10% via interactive onboarding visuals and haptic feedback.",
      "Lifted PR throughput 25%/release by building a DInject mock generator for 20+ iOS engineers.",
      "Returning full-time as a SWE in July 2026.",
    ],
    tech: ["SwiftUI", "BLE", "iOS", "Dependency Injection", "DevTools"],
  },
  {
    company: "SiPhox Health",
    role: "Software Developer Co-op",
    period: "Jul 2024 — Dec 2024",
    location: "Boston, MA",
    bullets: [
      "Launched first iOS app in SwiftUI generating 3D body models with ±3.9% median error vs. clinical.",
      "Automated blood-test parsing via AWS Lambda at 95% accuracy using OpenAI, Textract, and Comprehend.",
      "Shipped fixes across CMS, backend services, and web portal — improved data quality and reliability.",
    ],
    tech: ["SwiftUI", "Python", "AWS Lambda", "OpenAI", "Textract"],
  },
  {
    company: "Varidx",
    role: "Software Engineering Intern",
    period: "May 2024 — Jul 2024",
    location: "Remote",
    bullets: [
      "Built edge traffic analytics with YOLO at 95% accuracy monitoring 50k+ vehicles/day.",
      "Developed a real-time collision-alert system detecting vehicles in adjacent lanes.",
      "Integrated IoT devices with Azure to power analytics dashboards for city planning.",
    ],
    tech: ["Python", "YOLO", "OpenCV", "Azure", "IoT"],
  },
];

export default function Experience() {
  return (
    <section className="py-12 md:py-20 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Experience
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / 2024 — present
          </span>
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-14">
          Where I've worked.
        </h1>

        <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {experiences.map((exp, i) => (
            <motion.li
              key={exp.company}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="py-10 md:py-12 grid grid-cols-12 gap-4"
            >
              <div className="col-span-12 md:col-span-3">
                <div className="font-mono text-xs uppercase tracking-wider muted mb-1">
                  {exp.period}
                </div>
                <div className="font-mono text-xs uppercase tracking-wider dim">
                  {exp.location}
                </div>
              </div>

              <div className="col-span-12 md:col-span-9">
                <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                  {exp.role}
                </h2>
                <p className="accent font-mono text-sm uppercase tracking-wider mt-1 mb-5">
                  {exp.company}
                </p>

                <ul className="space-y-2 mb-6 muted leading-relaxed max-w-prose">
                  {exp.bullets.map((b, j) => (
                    <li key={j} className="flex gap-3">
                      <span className="accent shrink-0">—</span>
                      <span className="text-pretty">{b}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs muted">
                  {exp.tech.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
