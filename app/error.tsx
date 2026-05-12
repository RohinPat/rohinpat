"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[page error]", error);
  }, [error]);

  return (
    <main className="min-h-[80vh] flex items-center px-6 md:px-10 pt-24 relative">
      <div className="max-w-3xl w-full mx-auto">
        <p className="font-mono text-xs uppercase tracking-[0.2em] accent mb-6">
          yellow card · something broke
        </p>
        <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05] mb-6 text-balance">
          That page didn&apos;t load.
        </h1>
        <p className="muted text-base md:text-lg max-w-prose mb-3 text-pretty">
          The page tried to render and threw an error. Probably nothing dramatic — give it
          another try.
        </p>
        {error.digest && (
          <p className="font-mono text-xs dim mb-10">ref: {error.digest}</p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--fg)] text-[var(--bg)] font-medium hover:bg-accent hover:text-white transition-colors"
          >
            Try again
            <span className="transition-transform group-hover:translate-x-0.5">↻</span>
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-3 border border-[var(--border-strong)] hover:border-accent hover:text-accent transition-colors"
          >
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
