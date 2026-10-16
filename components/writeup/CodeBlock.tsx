import { tokenize, type Lang } from "@/lib/highlight";

// A real excerpt, quoted from a repo, with a link to the exact lines.
// Server component: the colouring happens at build time.
export default function CodeBlock({
  code,
  lang = "python",
  file,
  href,
}: {
  code: string;
  lang?: Lang;
  /** path shown in the caption, e.g. backend/models/clothing_classifier.py */
  file: string;
  /** permalink to the lines on GitHub */
  href: string;
}) {
  const tokens = tokenize(code.replace(/^\n+|\s+$/g, ""), lang);
  return (
    <figure className="code-block wide">
      <figcaption>
        <a href={href} target="_blank" rel="noopener noreferrer" className="plain">
          {file}
          <span aria-hidden="true"> ↗</span>
          <span className="sr-only"> (opens on GitHub in a new tab)</span>
        </a>
      </figcaption>
      {/* focusable so keyboard users can scroll long lines sideways */}
      <pre tabIndex={0} role="region" aria-label={`Code excerpt from ${file}`}>
        <code>
          {tokens.map((t, i) =>
            t.type === "plain" ? t.text : (
              <span key={i} className={`tok-${t.type}`}>
                {t.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
