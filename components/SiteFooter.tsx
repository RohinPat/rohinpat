"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { site } from "@/lib/site";

// Home ends with a sign-off: an invitation and the name set edge to edge.
// Every other page gets one quiet line, so the footer never outweighs the
// page above it.
export default function SiteFooter() {
  const home = usePathname() === "/";
  const elsewhere = [
    { name: "Email", href: `mailto:${site.email}` },
    { name: "GitHub ↗", href: site.github, external: true },
    { name: "LinkedIn ↗", href: site.linkedin, external: true },
  ];
  const legal = [
    { name: "Privacy", href: "/privacy" },
    { name: "Terms", href: "/terms" },
    { name: "Cookies", href: "/cookies" },
  ];

  return (
    <footer className="relative z-10 border-t border-[var(--border)] overflow-hidden">
      <div className={`px-4 md:px-10 max-w-6xl mx-auto ${home ? "pt-16 md:pt-24" : "py-6"}`}>
        {home && (
          <Link
            href="/contact"
            className="group display block hover:text-[var(--accent-text)] transition-colors"
            style={{ fontSize: "clamp(3rem, 9vw, 7.5rem)" }}
          >
            Say hi{" "}
            <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-2">
              →
            </span>
          </Link>
        )}

        <nav
          aria-label="Footer"
          className={`flex flex-wrap items-center gap-x-10 gap-y-3 font-mono text-[11px] uppercase tracking-wider ${
            home ? "mt-14 pt-5 border-t border-[var(--border)]" : ""
          }`}
        >
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {elsewhere.map((l) => (
              <li key={l.name}>
                <a
                  href={l.href}
                  {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="inline-block py-1 hover:text-[var(--accent-text)] transition-colors"
                >
                  {l.name}
                </a>
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {legal.map((l) => (
              <li key={l.name}>
                <Link href={l.href} className="inline-block py-1 hover:text-[var(--accent-text)] transition-colors">
                  {l.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="muted lg:ml-auto">
            © {new Date().getFullYear()} {site.name} · Views are my own
          </p>
        </nav>
      </div>

      {home && (
        <p
          aria-hidden="true"
          className="display whitespace-nowrap text-center leading-[0.8] mt-8 -mb-[0.12em] select-none text-[var(--fg)]"
          style={{ fontSize: "clamp(4rem, 17.5vw, 20rem)" }}
        >
          Rohin Patel
        </p>
      )}
    </footer>
  );
}
