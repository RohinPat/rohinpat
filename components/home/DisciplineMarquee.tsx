import { disciplines } from "@/lib/site";

// Endless band of disciplines. The animated track is decorative; screen
// readers get the plain list instead. Stops for prefers-reduced-motion.
export default function DisciplineMarquee() {
  const row = (
    <div className="flex shrink-0 items-center">
      {disciplines.map((d) => (
        <span key={d} className="flex items-center">
          <span className="display whitespace-nowrap px-6 md:px-10" style={{ fontSize: "clamp(3rem, 8vw, 7rem)" }}>
            {d}
          </span>
          <span className="w-3 h-3 md:w-4 md:h-4 bg-[var(--signal)] shrink-0" />
        </span>
      ))}
    </div>
  );

  return (
    <section aria-label="What I work with" className="relative overflow-hidden border-y border-[var(--border)] py-6 md:py-8">
      <ul className="sr-only">
        {disciplines.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="marquee-track flex w-max">
        {row}
        {row}
      </div>
    </section>
  );
}
