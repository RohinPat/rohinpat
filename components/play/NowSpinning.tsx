"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { music } from "@/lib/interests";
import { useTopTracks } from "@/lib/useTopTracks";

export default function NowSpinning() {
  return (
    <section id="music" className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            02 — Now Spinning
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / what's on
          </span>
        </div>
        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight mb-4">
          The current rotation.
        </h2>
        <p className="muted max-w-prose mb-12 text-pretty">
          A monthly-curated playlist plus my top 5 in heavy rotation. Tap play. Steal a song.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16">
          {/* Playlist embed */}
          <div className="md:col-span-5">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="font-mono text-xs uppercase tracking-wider muted">
                Playlist
              </h3>
              <p className="font-mono text-[10px] uppercase tracking-wider accent">
                live
              </p>
            </div>
            {music.spotifyEmbed ? (
              <div className="border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1">
                <iframe
                  src={music.spotifyEmbed}
                  width="100%"
                  height="380"
                  frameBorder="0"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  className="block"
                />
              </div>
            ) : (
              <p className="font-mono text-xs dim">
                No playlist embed set. Drop a URL into{" "}
                <code className="text-[var(--fg)]">music.spotifyEmbed</code> in{" "}
                <code className="text-[var(--fg)]">lib/interests.ts</code>.
              </p>
            )}
            <p className="mt-3 font-mono text-xs dim">
              Hand-curated. Updated monthly.
            </p>
          </div>

          {/* Heavy rotation — live top tracks via API when configured */}
          <div className="md:col-span-7">
            <HeavyRotation />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeavyRotation() {
  const { tracks, configured, loading } = useTopTracks("medium_term", 5);
  const items =
    tracks && tracks.length
      ? tracks.map((t) => ({
          artist: t.artist,
          track: t.title,
          albumArt: t.albumArt,
          url: t.url,
        }))
      : music.rotation.map((m) => ({
          artist: m.artist,
          track: m.track,
          albumArt: null as string | null,
          url: null as string | null,
        }));

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-mono text-xs uppercase tracking-wider muted">
          Heavy rotation
        </h3>
        <p className="font-mono text-[10px] uppercase tracking-wider dim">
          {loading
            ? "syncing…"
            : configured
              ? "last 6 months · live"
              : "long-term top 5"}
        </p>
      </div>
      <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {items.map((m, i) => {
          const inner = (
            <div className="py-3 flex items-center gap-4 group">
              <span className="font-mono text-sm dim w-6 shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              {m.albumArt ? (
                <div className="relative w-12 h-12 shrink-0">
                  <Image
                    src={m.albumArt}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="w-12 h-12 shrink-0 bg-[var(--bg-elevated)] border border-[var(--border)]" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-base md:text-lg font-medium truncate group-hover:accent transition-colors">
                  {m.track}
                </p>
                <p className="text-sm muted truncate">{m.artist}</p>
              </div>
            </div>
          );
          return (
            <motion.li
              key={`${m.artist}-${m.track}-${i}`}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
            >
              {m.url ? (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block hover:bg-[var(--bg-elevated)] -mx-3 px-3 transition-colors"
                >
                  {inner}
                </a>
              ) : (
                inner
              )}
            </motion.li>
          );
        })}
      </ol>
      <p className="mt-4 font-mono text-xs dim">
        {configured
          ? "Pulled live from Spotify. Updated on each visit."
          : "Your real long-term top 5. Lights up live once Spotify's wired up."}
      </p>
    </>
  );
}
