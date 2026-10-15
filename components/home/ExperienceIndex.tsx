import Link from "next/link";
import { experiences } from "@/lib/experience";

// Swiss-style index of where I've worked: one ruled row per role.
export default function ExperienceIndex() {
  return (
    <section aria-labelledby="xp-title" className="paper paper-grid px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] muted mb-4">Index / experience</p>
            <h2 id="xp-title" className="display" style={{ fontSize: "clamp(3.5rem, 11vw, 9.5rem)" }}>
              Where I&apos;ve
              <br />
              shipped.
            </h2>
          </div>
          <Link
            href="/experience"
            className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--ink)] text-[var(--paper)] font-medium hover:bg-[var(--signal)] hover:text-[var(--ink)] transition-colors"
          >
            Full history
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>

        <ol className="border-t-2 border-[var(--ink)]">
          {experiences.map((x, i) => (
            <li
              key={x.company}
              className="group relative grid grid-cols-12 gap-x-4 gap-y-1 py-6 md:py-8 border-b border-[var(--border-strong)]"
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 bottom-0 w-0 bg-[var(--signal)] transition-all duration-300 group-hover:w-1.5"
              />
              <span className="col-span-2 md:col-span-1 font-mono text-xs muted pt-2 md:pl-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3
                className="col-span-10 md:col-span-5 display"
                style={{ fontSize: "clamp(2.25rem, 5.5vw, 4.25rem)" }}
              >
                {x.company}
              </h3>
              <p className="col-span-10 col-start-3 md:col-span-3 md:col-start-auto font-medium md:pt-3">
                {x.role}
              </p>
              <p className="col-span-10 col-start-3 md:col-span-3 md:col-start-auto font-mono text-xs uppercase tracking-wider muted md:pt-3.5 md:text-right">
                {x.period.split(" · ")[0]}
                <span className="block mt-1">{x.location}</span>
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
