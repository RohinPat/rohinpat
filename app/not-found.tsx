import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="min-h-[80vh] flex items-center px-6 md:px-10 pt-24 relative">
      <div className="max-w-3xl w-full mx-auto">
        <p className="font-mono text-xs uppercase tracking-[0.2em] accent mb-6">
          404 · off the pitch
        </p>
        <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05] mb-6 text-balance">
          That route doesn&apos;t exist.
        </h1>
        <p className="muted text-base md:text-lg max-w-prose mb-10 text-pretty">
          You took a touch too many. Probably a stale link or a typo in the URL. The site
          itself is fine.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--fg)] text-[var(--bg)] font-medium hover:bg-accent hover:text-white transition-colors"
          >
            Back home
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-5 py-3 border border-[var(--border-strong)] hover:border-accent hover:text-accent transition-colors"
          >
            See the work
          </Link>
        </div>
      </div>
    </main>
  );
}
