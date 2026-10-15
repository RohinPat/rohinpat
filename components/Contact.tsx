"use client";

import { useState } from "react";
import { site } from "@/lib/site";

// /contact — one moment: a full racing-green page with the address as the
// hero. Click it to copy; everything else is one quiet line.
export default function Contact() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(site.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.location.href = `mailto:${site.email}`; // clipboard blocked: open mail instead
    }
  };

  return (
    <section className="signal min-h-[100svh] flex flex-col justify-center px-4 md:px-10 pt-28 pb-20">
      <div className="max-w-6xl w-full mx-auto">
        <h1>Say hi.</h1>

        <button
          type="button"
          onClick={copy}
          className="group display block text-left break-all"
          style={{ fontSize: "clamp(2.1rem, 7.4vw, 7rem)", lineHeight: 0.95 }}
        >
          <span className="underline decoration-[0.06em] underline-offset-[0.14em] decoration-transparent group-hover:decoration-current transition-colors">
            {site.email}
          </span>
          <span className="block mt-5 font-sans normal-case tracking-normal text-base font-medium text-[var(--fg-muted)]" style={{ fontStretch: "100%" }}>
            {copied ? "Copied to your clipboard ✓" : "Click to copy"}
          </span>
        </button>
        <span role="status" className="sr-only">
          {copied ? "Email address copied to clipboard" : ""}
        </span>

        <ul className="mt-14 flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs uppercase tracking-wider">
          <li>
            <a href={`mailto:${site.email}`} className="inline-block py-1 link-underline">
              Open mail app
            </a>
          </li>
          <li>
            <a href={site.github} target="_blank" rel="noopener noreferrer" className="inline-block py-1 link-underline">
              GitHub ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
          <li>
            <a href={site.linkedin} target="_blank" rel="noopener noreferrer" className="inline-block py-1 link-underline">
              LinkedIn ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        </ul>

        <p className="mt-10 max-w-prose text-[var(--fg-muted)]">
          Mostly heads-down running the in-app shop at {site.employer}. Emails still get
          read, just not always fast.
        </p>
      </div>
    </section>
  );
}
