"use client";

import { useState } from "react";
import { site } from "@/lib/site";

// /contact — an address, a copy button, two links. That's it.
export default function Contact() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(site.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the mailto link still works */
    }
  };

  return (
    <section className="px-4 md:px-10 pb-16 md:pb-24">
      <div className="max-w-6xl mx-auto">
        <h1>Say hi.</h1>

        <a
          href={`mailto:${site.email}`}
          className="display block break-all hover:text-[var(--signal)] transition-colors"
          style={{ fontSize: "clamp(1.9rem, 6vw, 5.5rem)", lineHeight: 0.95 }}
        >
          {site.email}
        </a>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--signal)] text-[var(--ink)] font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            {copied ? "Copied ✓" : "Copy address"}
          </button>
          <span role="status" className="sr-only">
            {copied ? "Email address copied to clipboard" : ""}
          </span>
        </div>

        <ul className="mt-16 border-t-2 border-[var(--fg)] max-w-3xl">
          {[
            { label: "GitHub", handle: "@RohinPat", href: site.github },
            { label: "LinkedIn", handle: "/in/rohinpat", href: site.linkedin },
          ].map((l) => (
            <li key={l.label} className="border-b border-[var(--border-strong)]">
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-baseline justify-between gap-4 py-5"
              >
                <span className="display group-hover:text-[var(--signal)] transition-colors" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
                  {l.label}
                </span>
                <span className="font-mono text-xs uppercase tracking-wider muted">
                  {l.handle} ↗<span className="sr-only"> (opens in a new tab)</span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        <p className="mt-10 muted max-w-prose">
          Mostly heads-down running the in-app shop at {site.employer}. Emails still
          get read, just not always fast.
        </p>
      </div>
    </section>
  );
}
