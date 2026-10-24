import type { Metadata } from "next";
import Link from "next/link";
import {
  cardSummary,
  education,
  experience,
  plainUrl,
  projectList,
  resumeHeader,
  resumeMeta,
  skills,
  type Placeholder,
} from "./data";
import PrintButton from "./PrintButton";
import { resumePdfExists } from "./pdf";

export const metadata: Metadata = {
  title: resumeMeta.title,
  description: resumeMeta.description,
  alternates: { canonical: "/resume" },
};

// A plain HTML resume: no scripts beyond the print button, nothing fetched.
// Printed (or saved as PDF from the print dialog) it becomes a clean page or
// two; the print rules are at the end of app/globals.css.

const H2 =
  "font-mono text-[11px] uppercase tracking-[0.16em] muted border-b border-[var(--border-strong)] pb-2 mb-5";

/** shown in square brackets on the page, so an unfilled gap can't ship unnoticed */
function Todo({ p }: { p: Placeholder }) {
  return (
    <span data-placeholder className="bg-[#f5c542]/45 px-1 font-mono text-[0.85em] text-[var(--ink)]">
      [TODO(rohin): {p.todo}]
    </span>
  );
}

function Tags({ tags }: { tags: string[] }) {
  return <p className="mt-1.5 font-mono text-[11px] tracking-wide muted">{tags.join(" · ")}</p>;
}

export default function ResumePage() {
  const h = resumeHeader;
  const pdf = resumePdfExists();

  return (
    <main className="paper resume-page relative pt-28 pb-24 px-4 md:px-10">
      <article className="max-w-[48rem] mx-auto">
        <header>
          <h1 className="!text-[clamp(2.75rem,9vw,5rem)] !mb-3">{h.name}</h1>
          <p className="text-xl md:text-2xl leading-snug">{h.role}</p>
          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-[0.9375rem]">
            <li>{h.location}</li>
            <li>
              <a href={`mailto:${h.email}`} className="underline underline-offset-2 hover:text-[var(--accent-text)]">
                {h.email}
              </a>
            </li>
            <li>
              <a href={h.github} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--accent-text)]">
                {plainUrl(h.github)}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
            <li>
              <a href={h.linkedin} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--accent-text)]">
                {plainUrl(h.linkedin)}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          </ul>

          <div className="resume-actions mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <PrintButton />
            {pdf && (
              <a
                href="/resume.pdf"
                download
                className="inline-flex items-center gap-2 px-5 py-3 border border-[var(--ink)] font-medium hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors"
              >
                Download PDF
              </a>
            )}
            <Link href="/projects" className="text-sm underline underline-offset-2 hover:text-[var(--accent-text)]">
              Prefer the full tour? See the work
            </Link>
          </div>
        </header>

        <p className="mt-10 text-[1.0625rem] leading-relaxed max-w-[44ch] text-pretty">{cardSummary}</p>

        <section aria-labelledby="r-exp" className="mt-12">
          <h2 id="r-exp" className={H2}>Experience</h2>
          <ul className="space-y-6">
            {experience.map((e) => (
              <li key={e.employer} className="resume-entry">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                  <h3 className="text-lg font-semibold">
                    {e.employer}
                    {e.role && <span className="font-normal">, {e.role}</span>}
                  </h3>
                  <p className="font-mono text-[12px] muted">{e.when}</p>
                </div>
                <p className="mt-1 leading-snug text-pretty">{e.line}</p>
                <Tags tags={e.tags} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="r-proj" className="mt-12">
          <h2 id="r-proj" className={H2}>Projects</h2>
          <ul className="space-y-6">
            {projectList.map((p) => (
              <li key={p.title} className="resume-entry">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                  <h3 className="text-lg font-semibold">{p.title}</h3>
                  <p className="font-mono text-[12px] muted">{p.when}</p>
                </div>
                <p className="mt-1 leading-snug text-pretty">{p.line}</p>
                {p.detail && <p className="mt-1.5 text-[0.9375rem] leading-snug muted text-pretty">{p.detail}</p>}
                <Tags tags={p.tags} />
                {(p.links.length > 0 || p.caseStudy) && (
                  <p className="mt-1.5 text-[0.9375rem] flex flex-wrap gap-x-5">
                    {p.caseStudy && (
                      <Link href={p.caseStudy} className="underline underline-offset-2 hover:text-[var(--accent-text)]">
                        Case study
                      </Link>
                    )}
                    {p.links.map((l) => (
                      <a
                        key={l.href}
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-[var(--accent-text)]"
                      >
                        {l.label} <span aria-hidden="true">↗</span>
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="r-edu" className="mt-12 resume-entry">
          <h2 id="r-edu" className={H2}>Education</h2>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6">
            <h3 className="text-lg font-semibold">{education.school}</h3>
            <p className="font-mono text-[12px] muted">{education.detail}</p>
          </div>
          <p className="mt-1.5 leading-snug">
            <Todo p={education.placeholder} />
          </p>
        </section>

        <section aria-labelledby="r-skills" className="mt-12 resume-entry">
          <h2 id="r-skills" className={H2}>Skills</h2>
          <p className="leading-snug">{skills.fromWork.join(" · ")}</p>
          <p className="mt-1.5 leading-snug">
            <Todo p={skills.placeholder} />
          </p>
        </section>
      </article>
    </main>
  );
}
