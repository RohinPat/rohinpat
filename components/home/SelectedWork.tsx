import Link from "next/link";
import { jobs, made } from "@/lib/projects";

// Home, third screen: a plain list. What I've made (with code and write-ups),
// then where I've worked, then the door to the full index.
export default function SelectedWork() {
  return (
    <section aria-labelledby="work-title" className="px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <h2 id="work-title" className="display t-m border-b-2 border-[var(--fg)] pb-4">
          Selected work
        </h2>
        <ul>
          {made.map((p) => (
            <li
              key={p.slug}
              className="grid md:grid-cols-12 gap-x-6 gap-y-2 py-7 md:py-8 border-b border-[var(--border-strong)]"
            >
              <h3 className="md:col-span-4 text-2xl md:text-[1.75rem] font-semibold leading-tight" style={{ fontStretch: "85%" }}>
                {p.caseStudy ? (
                  <Link href={p.caseStudy} className="hover:text-[var(--accent-text)] transition-colors">
                    {p.title}
                  </Link>
                ) : (
                  p.title
                )}
              </h3>
              <div className="md:col-span-6">
                <p className="text-[var(--fg-muted)] leading-relaxed text-pretty max-w-[52ch]">{p.line}</p>
                <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {p.caseStudy && (
                    <Link href={p.caseStudy} className="py-1 text-[var(--accent-text)] link-underline">
                      Write-up →<span className="sr-only"> about {p.title}</span>
                    </Link>
                  )}
                  {p.links?.map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-1 link-underline"
                    >
                      {l.label} ↗<span className="sr-only"> for {p.title} (opens in a new tab)</span>
                    </a>
                  ))}
                </p>
              </div>
              <p className="md:col-span-2 md:text-right text-sm text-[var(--fg-muted)] tabular-nums md:pt-2 order-first md:order-none">
                {p.year}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-wrap items-baseline justify-between gap-x-10 gap-y-4">
          <p className="text-[var(--fg-muted)] leading-relaxed">
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
          <Link href="/projects" className="group inline-flex items-center gap-2 font-medium link-underline py-1">
            All work <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
