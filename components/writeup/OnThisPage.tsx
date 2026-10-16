"use client";

import { useEffect, useRef, useState } from "react";

// Long-form navigation: an "On this page" rail in the empty left margin
// (wide screens only) that highlights the section you're reading, plus a
// thin reading-progress line along the top. Built from the page's own
// `.prose h2` headings, so it never drifts out of sync with the text.

type Section = { id: string; title: string };

const slug = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function OnThisPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [inArticle, setInArticle] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prose = document.querySelector<HTMLElement>(".prose");
    if (!prose) return;
    const heads = Array.from(prose.querySelectorAll<HTMLHeadingElement>("h2"));
    heads.forEach((h) => {
      if (!h.id) h.id = slug(h.textContent ?? "");
    });
    setSections(heads.map((h) => ({ id: h.id, title: h.textContent ?? "" })));

    // only show the rail while the article itself is on screen
    const seen = new IntersectionObserver(([e]) => setInArticle(e.isIntersecting), {
      rootMargin: "0px 0px -40% 0px",
    });
    seen.observe(prose);

    // reading progress through the article
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = prose.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.6;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
      if (bar.current) bar.current.style.transform = `scaleX(${p.toFixed(4)})`;
      // the section being read: the last heading above a third of the screen
      const line = window.innerHeight / 3;
      let current: string | null = null;
      for (const h of heads) if (h.getBoundingClientRect().top <= line) current = h.id;
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      seen.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  if (sections.length < 3) return null;

  return (
    <>
      <div
        ref={bar}
        aria-hidden="true"
        className="fixed top-0 left-0 right-0 z-[60] h-[2px] origin-left bg-[var(--signal)]"
        style={{ transform: "scaleX(0)" }}
      />
      <nav
        aria-label="On this page"
        className={`hidden xl:block fixed top-28 z-30 w-44 transition-opacity duration-300 ${
          inArticle ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ left: "max(1.5rem, calc((100vw - 56rem) / 2 - 13rem))" }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
          On this page
        </p>
        <ol className="space-y-1.5 border-l border-[var(--border-strong)]">
          {sections.map((s) => {
            const current = s.id === active;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={current ? "location" : undefined}
                  tabIndex={inArticle ? 0 : -1}
                  className={`block -ml-px pl-3 py-0.5 text-sm leading-snug border-l-2 transition-colors ${
                    current
                      ? "border-[var(--signal)] text-[var(--fg)] font-medium"
                      : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  {s.title}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
