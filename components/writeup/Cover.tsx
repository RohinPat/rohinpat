import Image from "next/image";
import type { Entry, Media } from "@/lib/projects";
import Motif from "@/components/home/Motif";

// A project's cover: its first screenshot or recording when there is one,
// otherwise its drawing on ink. Videos never autoplay; they show controls
// and a poster, so reduced-motion users aren't surprised.
export function MediaView({ media, priority = false }: { media: Media; priority?: boolean }) {
  if (media.kind === "video") {
    return (
      <video
        controls
        muted
        playsInline
        preload="metadata"
        poster={media.poster}
        width={media.width}
        height={media.height}
        className="w-full h-auto"
        aria-label={media.alt}
      >
        <source src={media.src} />
      </video>
    );
  }
  return (
    <Image
      src={media.src}
      alt={media.alt}
      width={media.width}
      height={media.height}
      priority={priority}
      sizes="(min-width: 1024px) 56rem, 100vw"
      className="w-full h-auto"
    />
  );
}

export default function Cover({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const first = entry.media?.[0];
  if (first && !compact) {
    return (
      <figure>
        <div className="overflow-hidden rounded-md bg-[var(--ink)]">
          <MediaView media={first} priority />
        </div>
        {first.caption && <figcaption className="note">{first.caption}</figcaption>}
      </figure>
    );
  }
  // Fallback: the drawing, so a missing screenshot never looks broken.
  return (
    <div
      className={`rounded-md bg-[var(--ink)] text-[var(--paper)] place-items-center ${
        compact ? "hidden md:grid aspect-square w-full" : "grid py-10 md:py-14"
      }`}
    >
      <Motif slug={entry.slug} className={compact ? "w-[62%] h-auto" : "w-40 md:w-52 h-auto"} />
    </div>
  );
}
