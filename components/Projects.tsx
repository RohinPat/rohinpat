import { projects, type Entry } from "@/lib/projects";
import Motif from "@/components/home/Motif";

// /projects — two ruled lists: things I've made, places I've worked.
export default function Projects() {
  const made = projects.filter((p) => p.kind === "project");
  const work = projects.filter((p) => p.kind === "work");

  return (
    <section className="px-4 md:px-10 pb-12 md:pb-20">
      <div className="max-w-6xl mx-auto">
        <h1>Work.</h1>

        <List title="Made" entries={made} />
        <List title="Worked at" entries={work} />
      </div>
    </section>
  );
}

function List({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <section aria-labelledby={`list-${title}`} className="mb-16 md:mb-24">
      <h2
        id={`list-${title}`}
        className="font-mono text-xs uppercase tracking-[0.2em] accent mb-4"
      >
        {title}
      </h2>
      <ol className="border-t-2 border-[var(--fg)]">
        {entries.map((e) => (
          <li
            key={e.slug}
            id={e.slug}
            className="scroll-mt-24 group grid grid-cols-12 gap-x-4 gap-y-2 py-6 md:py-8 md:px-3 md:-mx-3 border-b border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] target:bg-[var(--bg-elevated)] transition-colors"
          >
            <Motif
              slug={e.slug}
              className="hidden md:block md:col-span-1 w-full max-w-[56px] h-auto muted group-hover:text-[var(--signal)] transition-colors"
            />
            <h3
              className="col-span-12 md:col-span-4 display group-hover:text-[var(--signal)] transition-colors"
              style={{ fontSize: "clamp(2.25rem, 5vw, 3.75rem)" }}
            >
              {e.title}
            </h3>
            <div className="col-span-12 md:col-span-4 md:pt-2">
              {e.role && <p className="font-medium mb-1">{e.role}</p>}
              <p className="muted leading-relaxed text-pretty">{e.line}</p>
              {e.links && (
                <p className="mt-3 flex gap-5 font-mono text-xs uppercase tracking-wider">
                  {e.links.map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block py-1 link-underline hover:text-[var(--signal)] transition-colors"
                    >
                      {l.label} ↗<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ))}
                </p>
              )}
            </div>
            <div className="col-span-12 md:col-span-3 md:pt-2.5 md:text-right font-mono text-xs uppercase tracking-wider muted">
              <p>{e.year}</p>
              <p className="mt-1">{e.tags.join(" · ")}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
