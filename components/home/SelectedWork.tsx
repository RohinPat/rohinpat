import Link from "next/link";
import { jobs, made } from "@/lib/projects";
import Motif from "./Motif";

// Home is the UI-heavy page: work shows up as big visual cards, not text.
// The detail (descriptions, code, write-ups) lives on /projects and the
// case study.
const CARD = ["paper", "bg-[var(--ink)] text-[var(--paper)]", "paper"] as const;

export default function SelectedWork() {
  return (
    <section aria-labelledby="work-title" className="signal px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
          <h2 id="work-title" className="display t-l">
            Selected work
          </h2>
          <Link href="/projects" className="group inline-flex items-center gap-2 font-medium link-underline py-1">
            All work <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>

        <ul className="grid md:grid-cols-3 gap-4">
          {made.map((p, i) => (
            <li key={p.slug}>
              <Link
                href={p.caseStudy ?? `/projects#${p.slug}`}
                className={`${CARD[i % CARD.length]} group relative flex flex-col h-full min-h-[420px] md:min-h-[480px] p-6 overflow-hidden transition-transform duration-300 ease-out hover:-translate-y-2 focus-visible:-translate-y-2`}
              >
                <div className="flex items-center justify-between text-sm tabular-nums">
                  <span className="font-mono text-xs uppercase tracking-[0.18em]">
                    {p.caseStudy ? "Case study" : "Project"}
                  </span>
                  <span>{p.year}</span>
                </div>
                <div className="flex-1 grid place-items-center py-8">
                  <Motif
                    slug={p.slug}
                    className="w-full max-w-[220px] h-auto transition-transform duration-500 ease-out group-hover:scale-[1.06] group-hover:-rotate-2"
                  />
                </div>
                <h3 className="display" style={{ fontSize: "clamp(2.2rem, 3.6vw, 3rem)", lineHeight: 0.92 }}>
                  {p.title}
                </h3>
                <p className="mt-2 pr-8 text-sm leading-snug text-[var(--fg-muted)] line-clamp-2">{p.line}</p>
                <span
                  aria-hidden="true"
                  className="absolute right-6 bottom-6 text-2xl transition-transform duration-300 group-hover:translate-x-1"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-[var(--fg-muted)]">
          Worked at{" "}
          {jobs.map((j, i) => (
            <span key={j.slug}>
              <Link href={`/projects#${j.slug}`} className="text-[var(--fg)] underline decoration-1 underline-offset-4 decoration-[var(--border-strong)] hover:decoration-current">
                {j.title}
              </Link>
              {i < jobs.length - 2 ? ", " : i === jobs.length - 2 ? " and " : "."}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
