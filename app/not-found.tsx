import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="min-h-[80vh] flex items-center px-4 md:px-10 pt-24 pb-16">
      <div className="max-w-6xl w-full mx-auto">
        <p
          aria-hidden="true"
          className="display text-[var(--accent-text)] leading-[0.8]"
          style={{ fontSize: "clamp(9rem, 32vw, 24rem)" }}
        >
          404
        </p>
        <h1>Nothing here</h1>
        <p className="-mt-6 mb-10 muted text-lg max-w-prose">
          That page doesn&apos;t exist, or it moved. Probably a stale link.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--paper)] text-[var(--ink)] font-medium hover:bg-[var(--mint)] transition-colors"
          >
            Back home →
          </Link>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-5 py-3 border border-[var(--border-strong)] hover:border-[var(--fg)] transition-colors"
          >
            All work
          </Link>
        </div>
      </div>
    </main>
  );
}
