import Link from "next/link";
import { site } from "@/lib/site";

export default function HomeFooter() {
  return (
    <footer className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-10">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            Reach out
          </span>
        </div>

        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-tight mb-10">
          Heading to WHOOP full-time.
          <br />
          Always down to chat anyway.
        </h2>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 font-mono text-sm">
          <a href={`mailto:${site.email}`} className="link-underline">
            {site.email}
          </a>
          <a href={site.github} target="_blank" rel="noopener noreferrer" className="link-underline">
            github.com/RohinPat
          </a>
          <a href={site.linkedin} target="_blank" rel="noopener noreferrer" className="link-underline">
            linkedin.com/in/rohinpat
          </a>
          <Link href="/contact" className="link-underline accent">
            full contact →
          </Link>
        </div>

        <div className="mt-16 pt-6 border-t border-[var(--border)] flex items-baseline justify-between">
          <p className="font-mono text-xs uppercase tracking-wider dim">
            © {new Date().getFullYear()} {site.name}
          </p>
          <p className="font-mono text-xs uppercase tracking-wider dim">
            {site.location}
          </p>
        </div>
      </div>
    </footer>
  );
}
