import Link from "next/link";

// Shared shell for /privacy, /terms and /cookies. Plain server component —
// no animation, no client JS — so the text is readable the instant it loads.
export default function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="relative pt-24 pb-20 px-6 md:px-10">
      <article className="max-w-3xl mx-auto">
        <p className="font-mono text-xs uppercase tracking-[0.2em] mb-6">
          <span className="accent">{eyebrow}</span>
          <span className="dim"> / last updated {updated}</span>
        </p>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] mb-8 text-balance">
          {title}
        </h1>
        <div className="text-base md:text-lg muted leading-relaxed max-w-prose mb-12 text-pretty">
          {intro}
        </div>
        <div className="legal-prose">{children}</div>
        <p className="mt-16 pt-6 border-t border-[var(--border)] font-mono text-xs uppercase tracking-wider muted">
          Also see:{" "}
          <Link href="/privacy" className="underline hover:text-[var(--fg)]">Privacy</Link>
          {" · "}
          <Link href="/terms" className="underline hover:text-[var(--fg)]">Terms</Link>
          {" · "}
          <Link href="/cookies" className="underline hover:text-[var(--fg)]">Cookies</Link>
        </p>
      </article>
    </main>
  );
}
