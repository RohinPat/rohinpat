// Shell for /privacy. Plain server component — no animation, no client JS —
// so the text is readable the instant it loads.
export default function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="paper relative min-h-screen pt-28 pb-24 px-4 md:px-10">
      <article>
        <header className="max-w-[56rem] mx-auto">
          <h1 className="!mb-6">{title}</h1>
          <div className="text-xl md:text-2xl leading-snug max-w-[44ch] text-pretty">{intro}</div>
          <p className="mt-5 text-sm muted">Updated {updated}</p>
        </header>
        <div className="prose mt-12">{children}</div>
      </article>
    </main>
  );
}
