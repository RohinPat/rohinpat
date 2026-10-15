import Link from "next/link";
import { site } from "@/lib/site";

const pages = [
  { name: "Projects", href: "/projects" },
  { name: "Experience", href: "/experience" },
  { name: "Skills", href: "/skills" },
  { name: "Interests", href: "/interests" },
  { name: "Contact", href: "/contact" },
];

const legal = [
  { name: "Privacy", href: "/privacy" },
  { name: "Terms", href: "/terms" },
  { name: "Cookies", href: "/cookies" },
];

// Sign-off on every page: a big invitation, the site map, and the name set
// edge to edge.
export default function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-[var(--border)] overflow-hidden">
      <div className="px-4 md:px-10 pt-16 md:pt-24 max-w-6xl mx-auto">
        <div className="grid md:grid-cols-12 gap-10">
          <div className="md:col-span-7">
            <p className="font-mono text-xs uppercase tracking-[0.2em] accent mb-4">Next</p>
            <Link
              href="/contact"
              className="group display block hover:text-[var(--signal)] transition-colors"
              style={{ fontSize: "clamp(3rem, 9vw, 7.5rem)" }}
            >
              Got an idea?
              <br />
              Say hi{" "}
              <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-2">
                →
              </span>
            </Link>
          </div>

          <nav aria-label="Footer" className="md:col-span-5 grid grid-cols-2 gap-8 font-mono text-xs uppercase tracking-wider">
            <div>
              <p className="muted mb-3">Pages</p>
              <ul className="space-y-2">
                {pages.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="hover:text-[var(--signal)] transition-colors">
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="muted mb-3">Elsewhere</p>
              <ul className="space-y-2">
                <li>
                  <a href={`mailto:${site.email}`} className="hover:text-[var(--signal)] transition-colors">
                    Email
                  </a>
                </li>
                <li>
                  <a href={site.github} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--signal)] transition-colors">
                    GitHub ↗
                  </a>
                </li>
                <li>
                  <a href={site.linkedin} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--signal)] transition-colors">
                    LinkedIn ↗
                  </a>
                </li>
              </ul>
              <p className="muted mt-6 mb-3">Legal</p>
              <ul className="space-y-2">
                {legal.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="hover:text-[var(--signal)] transition-colors">
                      {l.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <p className="mt-16 flex flex-wrap justify-between gap-2 font-mono text-[11px] uppercase tracking-wider muted">
          <span>© {new Date().getFullYear()} {site.name}</span>
          <span>Personal site · Views are my own</span>
        </p>
      </div>

      <p
        aria-hidden="true"
        className="display whitespace-nowrap text-center leading-[0.8] mt-6 -mb-[0.12em] select-none text-[var(--fg)]"
        style={{ fontSize: "clamp(4rem, 17.5vw, 20rem)" }}
      >
        Rohin Patel
      </p>
    </footer>
  );
}
