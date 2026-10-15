"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The footer's "Say hi" — skipped on /contact, where it would just repeat the page.
export default function FooterCta() {
  if (usePathname() === "/contact") return <div className="md:col-span-7" />;
  return (
    <div className="md:col-span-7">
      <p className="font-mono text-xs uppercase tracking-[0.2em] accent mb-4">Next</p>
      <Link
        href="/contact"
        className="group display block hover:text-[var(--signal)] transition-colors"
        style={{ fontSize: "clamp(3rem, 9vw, 7.5rem)" }}
      >
        Say hi{" "}
        <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-2">
          →
        </span>
      </Link>
    </div>
  );
}
