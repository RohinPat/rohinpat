import Link from "next/link";
import { site } from "@/lib/site";
import FooterCta from "./FooterCta";

// Sign-off on every page: an invitation, one row of links, the name set
// edge to edge. The page links already live in the nav.
export default function SiteFooter() {
  const links = [
    { name: "Email", href: `mailto:${site.email}` },
    { name: "GitHub ↗", href: site.github, external: true },
    { name: "LinkedIn ↗", href: site.linkedin, external: true },
    { name: "Privacy", href: "/privacy" },
    { name: "Terms", href: "/terms" },
    { name: "Cookies", href: "/cookies" },
  ];

  return (
    <footer className="relative z-10 border-t border-[var(--border)] overflow-hidden">
      <div className="px-4 md:px-10 pt-16 md:pt-24 max-w-6xl mx-auto">
        <FooterCta />

        <nav
          aria-label="Footer"
          className="mt-14 pt-5 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-wider"
        >
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {links.map((l) =>
              l.href.startsWith("/") ? (
                <li key={l.name}>
                  <Link href={l.href} className="hover:text-[var(--signal)] transition-colors">
                    {l.name}
                  </Link>
                </li>
              ) : (
                <li key={l.name}>
                  <a
                    href={l.href}
                    {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="hover:text-[var(--signal)] transition-colors"
                  >
                    {l.name}
                  </a>
                </li>
              ),
            )}
          </ul>
          <p className="muted">
            © {new Date().getFullYear()} {site.name} · Views are my own
          </p>
        </nav>
      </div>

      <p
        aria-hidden="true"
        className="display whitespace-nowrap text-center leading-[0.8] mt-8 -mb-[0.12em] select-none text-[var(--fg)]"
        style={{ fontSize: "clamp(4rem, 17.5vw, 20rem)" }}
      >
        Rohin Patel
      </p>
    </footer>
  );
}
