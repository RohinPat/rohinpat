import Link from "next/link";
import { site } from "@/lib/site";

const legal = [
  { name: "Privacy", href: "/privacy" },
  { name: "Terms", href: "/terms" },
  { name: "Cookies", href: "/cookies" },
];

export default function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-[var(--border)] px-6 md:px-10 py-8">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs uppercase tracking-wider muted">
        <p>
          © {new Date().getFullYear()} {site.name} · Personal site · Views are my own
        </p>
        <nav aria-label="Legal" className="flex gap-6">
          {legal.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:text-[var(--fg)] transition-colors"
            >
              {item.name}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
