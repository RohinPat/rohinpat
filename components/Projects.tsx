import Link from "next/link";
import { jobs, made, type Entry } from "@/lib/projects";
import Motif from "@/components/home/Motif";

// /projects — an index. "Made" lists projects with their code and, where one
// exists, the write-up; "Worked at" is three colour-blocked cards. Server
// component: nothing here needs JavaScript.

const pad = (n: number) => String(n).padStart(2, "0");

export default function Projects() {
  return (
    <>
      <section className="paper px-4 md:px-10 pt-28 pb-20 md:pb-28">
        <div className="max-w-6xl mx-auto">
          <h1 className="!mb-6">Work</h1>
          <p className="mb-14 md:mb-20 text-lg md:text-xl max-w-[46ch] text-pretty muted">
            Things I&apos;ve built and places I&apos;ve worked.
          </p>
          <MadeIndex entries={made} />
        </div>
      </section>
      <section className="px-4 md:px-10 py-20 md:py-28">
        <div className="max-w-6xl mx-auto">
          <WorkedAt entries={jobs} />
        </div>
      </section>
    </>
  );
}

function SectionHead({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="display t-m border-b-2 border-[var(--fg)] pb-4">
      {title}
    </h2>
  );
}

function ExternalLinks({ e }: { e: Entry }) {
  if (!e.links) return null;
  return (
    <>
      {e.links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block py-1 link-underline hover:text-[var(--accent-text)] transition-colors"
        >
          {l.label} ↗<span className="sr-only"> for {e.title} (opens in a new tab)</span>
        </a>
      ))}
    </>
  );
}

function MadeIndex({ entries }: { entries: Entry[] }) {
  return (
    <section aria-labelledby="made-title">
      <SectionHead id="made-title" title="Made" />
      <ol>
        {entries.map((e, i) => (
          <li
            key={e.slug}
            id={e.slug}
            className="group relative scroll-mt-24 grid grid-cols-12 gap-x-4 gap-y-3 py-8 md:py-10 border-b border-[var(--border-strong)]"
          >
            <span className="col-span-12 md:col-span-1 -mb-2 md:mb-0 font-mono text-xs muted md:pt-5 tabular-nums">
              {pad(i + 1)}
            </span>
            <h3 className="col-span-12 md:col-span-7 display" style={{ fontSize: "clamp(2.75rem, 7vw, 6rem)" }}>
              {e.caseStudy ? (
                <Link href={e.caseStudy} className="hover:text-[var(--accent-text)] transition-colors">
                  {e.title}
                </Link>
              ) : (
                e.title
              )}
            </h3>
            <p className="col-span-12 md:col-span-4 md:pt-5 md:text-right font-mono text-xs uppercase tracking-wider muted">
              {e.year}
              <span className="block mt-1">{e.tags.join(" · ")}</span>
            </p>
            <div className="col-span-12 md:col-span-7 md:col-start-2">
              <p className="leading-relaxed max-w-[52ch] text-pretty">{e.line}</p>
              <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs uppercase tracking-wider">
                {e.caseStudy && (
                  <Link
                    href={e.caseStudy}
                    className="inline-block py-1 font-medium text-[var(--accent-text)] link-underline"
                  >
                    Read the write-up →<span className="sr-only"> about {e.title}</span>
                  </Link>
                )}
                <ExternalLinks e={e} />
              </p>
            </div>
            <Motif slug={e.slug} className="hidden md:block absolute right-0 bottom-8 w-14 h-14 muted opacity-70" />
          </li>
        ))}
      </ol>
    </section>
  );
}

function WorkedAt({ entries }: { entries: Entry[] }) {
  const styleFor = (i: number) =>
    ["signal", "paper", "bg-[var(--bg-elevated)] text-[var(--fg)] border border-[var(--border-strong)]"][i % 3];

  return (
    <section aria-labelledby="worked-title">
      <SectionHead id="worked-title" title="Worked at" />
      <ol className="mt-6 grid md:grid-cols-3 gap-4">
        {entries.map((e, i) => {
          const current = e.year.trim().endsWith("—");
          return (
            <li
              key={e.slug}
              id={e.slug}
              className={`${styleFor(i)} scroll-mt-24 md:min-h-[400px] p-6 flex flex-col`}
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.18em]">
                {current ? `${e.year} now` : e.year}
              </p>
              <div className="flex-1 grid place-items-center py-8 md:py-6">
                <Motif slug={e.slug} className="w-[96px] md:w-[130px] h-auto" />
              </div>
              <h3 className="display" style={{ fontSize: "clamp(2.4rem, 4vw, 3.3rem)", lineHeight: 0.9 }}>
                {e.title}
              </h3>
              <p className="mt-3 text-lg font-semibold leading-tight">{e.role}</p>
              <p className="mt-2 text-sm leading-snug text-[var(--fg-muted)]">{e.line}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
