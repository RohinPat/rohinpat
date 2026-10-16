// A gallery tile: full-bleed artwork on top, a caption strip underneath.
// Artwork is decorative (aria-hidden); the caption carries the meaning.

export default function Tile({
  as: Heading = "h2",
  index,
  label,
  line,
  hint,
  touchHint,
  className = "",
  artClassName = "",
  children,
}: {
  index: number;
  /** heading level for the label — h3 when tiles sit under a section h2 */
  as?: "h2" | "h3";
  label: string;
  line: string;
  hint: string;
  /** wording for touchscreens, when "Move"/"Click" wouldn't make sense */
  touchHint?: string;
  className?: string;
  artClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`group relative flex flex-col overflow-hidden border border-[var(--border-strong)] bg-[var(--bg-elevated)] ${className}`}
    >
      <div className={`relative flex-1 min-h-0 overflow-hidden ${artClassName}`}>
        {children}
      </div>
      <div className="flex items-baseline justify-between gap-4 px-4 py-3 border-t border-[var(--border-strong)]">
        <div className="min-w-0">
          <Heading className="font-mono text-[11px] uppercase tracking-[0.2em]">
            <span className="muted">{String(index).padStart(2, "0")} — </span>
            {label}
          </Heading>
          <p className="text-sm muted mt-0.5 leading-snug">{line}</p>
        </div>
        <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] muted">
          <span className={touchHint ? "[@media(pointer:coarse)]:hidden" : ""}>{hint}</span>
          {touchHint && <span className="hidden [@media(pointer:coarse)]:inline">{touchHint}</span>}
        </p>
      </div>
    </article>
  );
}
