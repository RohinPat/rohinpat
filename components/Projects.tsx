"use client";

import { useEffect, useRef, useState } from "react";
import { projects, type Entry } from "@/lib/projects";
import Motif from "@/components/home/Motif";

// /projects — an editorial index. "Made" is a list of huge titles; hovering
// (or focusing) one floats a preview card with its drawing that trails the
// cursor. "Worked at" is three colour-blocked cards.

// Same colour order as the homepage filmstrip, so a project keeps its frame.
const FRAME = ["paper", "signal", "bg-[var(--bg-elevated)] text-[var(--fg)]"] as const;
const frameOf = (e: Entry) => FRAME[projects.indexOf(e) % FRAME.length];
const pad = (n: number) => String(n).padStart(2, "0");

export default function Projects() {
  const made = projects.filter((p) => p.kind === "project");
  const work = projects.filter((p) => p.kind === "work");
  const first = projects.reduce((y, p) => Math.min(y, parseInt(p.year, 10)), 9999);

  return (
    <section className="px-4 md:px-10 pb-12 md:pb-20">
      <div className="max-w-6xl mx-auto">
        <h1>Work.</h1>
        <p className="-mt-6 mb-14 md:mb-20 font-mono text-xs uppercase tracking-[0.2em] muted">
          {pad(made.length)} made · {pad(work.length)} worked at · {first} — now
        </p>

        <MadeIndex entries={made} />
        <WorkedAt entries={work} />
      </div>
    </section>
  );
}

function SectionHead({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between border-b-2 border-[var(--fg)] pb-3">
      <h2 id={id} className="font-mono text-xs uppercase tracking-[0.2em] accent">
        {title}
      </h2>
      <span className="font-mono text-xs muted tabular-nums">{pad(count)}</span>
    </div>
  );
}

function Links({ e }: { e: Entry }) {
  if (!e.links) return null;
  return (
    <span className="flex gap-5 font-mono text-xs uppercase tracking-wider">
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
    </span>
  );
}

function MadeIndex({ entries }: { entries: Entry[] }) {
  const [active, setActive] = useState<Entry | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const pos = useRef({ x: 0, y: 0 });

  // The card eases toward the pointer and tilts with its horizontal speed.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      const dx = target.current.x - pos.current.x;
      pos.current.x += dx * 0.18;
      pos.current.y += (target.current.y - pos.current.y) * 0.18;
      const tilt = Math.max(-8, Math.min(8, dx * 0.05));
      if (card.current) {
        card.current.style.transform = `translate3d(${pos.current.x}px, ${pos.current.y}px, 0) rotate(${tilt.toFixed(2)}deg)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const aim = (x: number, y: number, jump = false) => {
    // keep the card on screen, offset from the cursor
    const cx = Math.min(window.innerWidth - 320, x + 28);
    const cy = Math.min(window.innerHeight - 400, Math.max(80, y - 160));
    target.current = { x: cx, y: cy };
    if (jump) pos.current = { ...target.current };
  };

  return (
    <section aria-labelledby="made-title" className="mb-24 md:mb-32">
      <SectionHead id="made-title" title="Made" count={entries.length} />
      <ol onPointerLeave={() => setActive(null)}>
        {entries.map((e, i) => (
          <li
            key={e.slug}
            id={e.slug}
            onPointerEnter={(ev) => {
              aim(ev.clientX, ev.clientY, !active);
              setActive(e);
            }}
            onPointerMove={(ev) => aim(ev.clientX, ev.clientY)}
            onFocusCapture={(ev) => {
              const r = ev.currentTarget.getBoundingClientRect();
              aim(r.left + r.width * 0.55, r.top + r.height / 2, true);
              setActive(e);
            }}
            onBlurCapture={() => setActive(null)}
            className="group relative scroll-mt-24 grid grid-cols-12 gap-x-4 gap-y-3 py-8 md:py-10 border-b border-[var(--border-strong)]"
          >
            <span className="col-span-2 md:col-span-1 font-mono text-xs muted pt-3 md:pt-5 tabular-nums">
              {pad(i + 1)}
            </span>
            <h3
              className="col-span-10 md:col-span-7 display transition-[transform,color] duration-300 ease-out group-hover:translate-x-3 group-hover:text-[var(--signal)] group-focus-within:text-[var(--signal)]"
              style={{ fontSize: "clamp(3rem, 8vw, 7rem)" }}
            >
              {e.title}
            </h3>
            <p className="col-span-10 col-start-3 md:col-span-4 md:col-start-auto md:pt-5 md:text-right font-mono text-xs uppercase tracking-wider muted">
              {e.year}
              <span className="block mt-1">{e.tags.join(" · ")}</span>
            </p>
            <div className="col-span-10 col-start-3 md:col-span-7 md:col-start-2 flex flex-wrap items-baseline gap-x-8 gap-y-2">
              <p className="muted leading-relaxed max-w-[48ch] text-pretty">{e.line}</p>
              <Links e={e} />
            </div>
            {/* phones/tablets have no hover: show the drawing inline instead */}
            <Motif
              slug={e.slug}
              className="lg:hidden absolute right-0 top-8 w-12 h-12 muted"
            />
          </li>
        ))}
      </ol>

      {/* floating preview (decorative; mirrors the row it follows) */}
      <div
        ref={card}
        aria-hidden="true"
        className="fixed left-0 top-0 z-40 pointer-events-none hidden lg:block motion-reduce:!hidden"
      >
        <div
          className={`w-[280px] aspect-[4/5] p-5 flex flex-col shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)] transition-[opacity,transform] duration-200 ${
            active ? `opacity-100 scale-100 ${frameOf(active)}` : "opacity-0 scale-90"
          }`}
        >
          {active && (
            <>
              <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.18em]">
                <span>
                  {pad(projects.indexOf(active) + 1)} / {pad(projects.length)}
                </span>
                <span>{active.year}</span>
              </div>
              <div className="flex-1 grid place-items-center">
                <Motif slug={active.slug} className="w-[190px] h-auto" />
              </div>
              <p className="display" style={{ fontSize: "2.1rem", lineHeight: 0.92 }}>
                {active.title}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function WorkedAt({ entries }: { entries: Entry[] }) {
  const styleFor = (i: number) =>
    ["signal", "paper", "bg-[var(--bg-elevated)] text-[var(--fg)] border border-[var(--border-strong)]"][i % 3];

  return (
    <section aria-labelledby="worked-title">
      <SectionHead id="worked-title" title="Worked at" count={entries.length} />
      <ol className="mt-6 grid md:grid-cols-3 gap-4">
        {entries.map((e, i) => {
          const current = e.year.trim().endsWith("—");
          return (
            <li
              key={e.slug}
              id={e.slug}
              className={`${styleFor(i)} scroll-mt-24 min-h-[340px] md:min-h-[440px] p-6 flex flex-col transition-transform duration-300 ease-out hover:-translate-y-1.5`}
            >
              <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em]">
                <span>{current ? `${e.year} now` : e.year}</span>
                {current && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-[var(--ink)] text-[var(--paper)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--signal)] animate-pulse" />
                    Now
                  </span>
                )}
              </div>
              <div className="flex-1 grid place-items-center py-6">
                <Motif slug={e.slug} className="w-[150px] h-auto" />
              </div>
              <h3 className="display" style={{ fontSize: "clamp(2.6rem, 4.4vw, 3.6rem)", lineHeight: 0.9 }}>
                {e.title}
              </h3>
              <p className="mt-2 font-medium">{e.role}</p>
              <p className="mt-1 text-sm leading-snug text-[var(--fg-muted)]">{e.line}</p>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">
                {e.tags.join(" · ")}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
