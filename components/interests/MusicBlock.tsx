"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { music } from "@/lib/interests";
import { useTopTracks } from "@/lib/useTopTracks";

function RotationList() {
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
      <div className="flex items-baseline justify-between mb-6">
        <h3 className="font-mono text-xs uppercase tracking-wider muted">
          On rotation
        </h3>
        <p className="font-mono text-[10px] uppercase tracking-wider dim">
          {loading
            ? "syncing…"
            : configured
              ? "last 6 months · live"
              : "fallback"}
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
    </>
  );
}

export default function MusicBlock() {
  return (
    <section className="border-t border-[var(--border)] py-20 md:py-28 px-6 md:px-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
            04 — Music
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
            / what's in the ears
          </span>
        </div>
        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight mb-4">
          Headphones on most of the day.
        </h2>
        <p className="muted max-w-prose mb-14 text-pretty">
          Rap and R&B mostly. Some folk, some jazz. I also play brass when no one's listening.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16">
          {/* Rotation — live */}
          <div className="md:col-span-7">
            <RotationList />
          </div>

          {/* Top albums + instruments */}
          <div className="md:col-span-5 space-y-12">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider muted mb-6">
                Top 5 albums ever
              </h3>
              <ol className="space-y-3">
                {music.topAlbums.map((a, i) => (
                  <motion.li
                    key={a}
                    initial={{ opacity: 0, x: -6 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: "-30px" }}
                    transition={{ duration: 0.3, delay: i * 0.05 }}
                    className="flex gap-3 text-base"
                  >
                    <span className="accent font-mono text-sm shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-pretty">{a}</span>
                  </motion.li>
                ))}
              </ol>
            </div>

            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider muted mb-6">
                On the other side of the speaker
              </h3>
              <ul className="space-y-4">
                {music.instruments.map((inst) => (
                  <li key={inst.name} className="border-l-2 border-accent pl-4">
                    <div className="text-lg font-medium">{inst.name}</div>
                    <div className="font-mono text-xs dim mb-1">since {inst.since}</div>
                    <p className="text-sm muted italic">{inst.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
