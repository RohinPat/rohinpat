import Link from "next/link";
import { site } from "@/lib/site";

// One quiet line on every page — the footer never outweighs the page above
// it. (Home's "Say hi" lives in the field itself.)
export default function SiteFooter() {
  const elsewhere = [
    { name: "Email", href: `mailto:${site.email}` },
    { name: "GitHub ↗", href: site.github, external: true },
    { name: "LinkedIn ↗", href: site.linkedin, external: true },
  ];
  const about = [
    { name: "Resume", href: "/resume" },
    { name: "Colophon", href: "/colophon" },
    { name: "Privacy", href: "/privacy" },
  ];

  return (
    <footer className="relative z-10 border-t border-[var(--border)] px-4 md:px-10 py-6">
      <div className="max-w-6xl mx-auto">

        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-10 gap-y-3 font-mono text-[11px] uppercase tracking-wider"
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
            {about.map((l) => (
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
    </footer>
  );
}
