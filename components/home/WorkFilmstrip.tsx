"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { projects, type Project } from "@/lib/projects";
import Motif from "./Motif";

// Selected work as a strip of film frames with a frame counter. Native
// horizontal scroll (touch, trackpad, arrow keys when focused) plus
// previous/next buttons.

const FRAME_STYLES = [
  "paper",
  "signal",
  "bg-[var(--bg-elevated)] text-[var(--fg)]",
] as const;

export default function WorkFilmstrip() {
  const trackRef = useRef<HTMLOListElement>(null);
  const [index, setIndex] = useState(0);
  const total = projects.length;

  const frameStep = useCallback(() => {
    const track = trackRef.current;
    const first = track?.children[0] as HTMLElement | undefined;
    const second = track?.children[1] as HTMLElement | undefined;
    if (!first) return 1;
    return second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const i = Math.round(track.scrollLeft / frameStep());
      setIndex(Math.min(total - 1, Math.max(0, i)));
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, [frameStep, total]);

  const go = (dir: -1 | 1) => {
    trackRef.current?.scrollBy({ left: dir * frameStep(), behavior: "smooth" });
  };

  const atStart = index === 0;
  const atEnd = index >= total - 1;

  return (
    <section id="work" aria-labelledby="work-title" className="relative py-20 md:py-28 overflow-hidden">
      <div className="px-4 md:px-10 max-w-6xl mx-auto flex flex-wrap items-end justify-between gap-6 mb-10">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] accent mb-4">Selected work</p>
          <h2 id="work-title" className="display" style={{ fontSize: "clamp(3.5rem, 11vw, 9.5rem)" }}>
            Six frames.
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <p className="font-mono text-sm tabular-nums" aria-hidden="true">
            <span className="text-[var(--fg)]">{String(index + 1).padStart(2, "0")}</span>
            <span className="muted"> / {String(total).padStart(2, "0")}</span>
          </p>
          <div className="flex">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={atStart}
              aria-label="Previous project"
              className="w-12 h-12 border border-[var(--border-strong)] grid place-items-center hover:bg-[var(--signal)] hover:text-[var(--ink)] hover:border-[var(--signal)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={atEnd}
              aria-label="Next project"
              className="w-12 h-12 border border-l-0 border-[var(--border-strong)] grid place-items-center hover:bg-[var(--signal)] hover:text-[var(--ink)] hover:border-[var(--signal)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-black py-3">
        <div aria-hidden="true" className="sprockets" />
        <ol
          ref={trackRef}
          tabIndex={0}
          aria-label="Selected projects — scroll sideways"
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth py-3 px-4 md:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {projects.map((p, i) => (
            <li key={p.slug} className="snap-start shrink-0 w-[82vw] sm:w-[400px] md:w-[440px]">
              <Frame project={p} index={i} total={total} />
            </li>
          ))}
          <li className="snap-start shrink-0 w-[60vw] sm:w-[280px]">
            <Link
              href="/projects"
              className="h-full min-h-[420px] border border-white/15 text-[var(--fg)] flex flex-col justify-end p-6 hover:bg-[var(--signal)] hover:text-[var(--ink)] hover:border-[var(--signal)] transition-colors"
            >
              <span className="display" style={{ fontSize: "clamp(2.5rem, 6vw, 4rem)" }}>
                All projects →
              </span>
              <span className="mt-2 text-sm opacity-80">The full write-ups, with problem, approach and impact.</span>
            </Link>
          </li>
        </ol>
        <div aria-hidden="true" className="sprockets" />
      </div>
    </section>
  );
}

function Frame({ project, index, total }: { project: Project; index: number; total: number }) {
  const style = FRAME_STYLES[index % FRAME_STYLES.length];
  return (
    <Link
      href={`/projects#${project.slug}`}
      className={`${style} group relative flex flex-col h-full aspect-[4/5] p-5 md:p-6 overflow-hidden`}
    >
      <div className="flex items-start justify-between font-mono text-[11px] uppercase tracking-[0.18em]">
        <span>
          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
        <span>
          {project.category} · {project.year}
        </span>
      </div>

      <div className="flex-1 grid place-items-center py-4">
        <Motif slug={project.slug} className="w-full max-w-[260px] h-auto transition-transform duration-500 group-hover:scale-[1.04]" />
      </div>

      <div>
        <h3 className="display" style={{ fontSize: "clamp(1.9rem, 4.4vw, 2.6rem)", lineHeight: 0.92 }}>
          {project.title.split(" — ")[0]}
        </h3>
        <p className="mt-2 text-sm leading-snug line-clamp-3 text-[var(--fg-muted)]">
          {project.description}
        </p>
        <span className="mt-4 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] font-semibold">
          Read the story
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
        </span>
      </div>
    </Link>
  );
}
