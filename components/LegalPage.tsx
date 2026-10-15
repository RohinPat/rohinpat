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
  const tabs = [
    { name: "Privacy", href: "/privacy" },
    { name: "Terms", href: "/terms" },
    { name: "Cookies", href: "/cookies" },
  ];

  return (
    <main className="relative pt-24 pb-20 px-4 md:px-10">
      <div className="max-w-6xl mx-auto">
        <p className="font-mono text-xs uppercase tracking-[0.2em] mb-6">
          <span className="accent">{eyebrow}</span>
          <span className="dim"> / last updated {updated}</span>
        </p>
        <h1>{title}</h1>

        <div className="grid lg:grid-cols-12 gap-x-10 gap-y-8">
          {/* policy switcher: tabs on phones, a sticky rail on desktop */}
          <nav aria-label="Policies" className="lg:col-span-3">
            <ul className="flex lg:flex-col gap-2 lg:sticky lg:top-24">
              {tabs.map((t) => {
                const current = t.name === eyebrow;
                return (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      aria-current={current ? "page" : undefined}
                      className={`block px-4 py-2.5 font-mono text-xs uppercase tracking-wider border transition-colors ${
                        current
                          ? "bg-[var(--signal)] text-[var(--ink)] border-[var(--signal)]"
                          : "border-[var(--border-strong)] hover:border-[var(--fg)]"
                      }`}
                    >
                      {t.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <article className="lg:col-span-9">
            <div className="text-lg md:text-xl muted leading-relaxed max-w-[60ch] mb-4 text-pretty">
              {intro}
            </div>
            <div className="legal-prose">{children}</div>
          </article>
        </div>
      </div>
    </main>
  );
}
