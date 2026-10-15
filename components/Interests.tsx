"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import WatchesBlock from "./interests/WatchesBlock";
import CarsBlock from "./interests/CarsBlock";
import BarcaBlock from "./interests/BarcaBlock";
import MusicBlock from "./interests/MusicBlock";
import MinorCard from "./interests/MinorCard";
import HoopShot from "./interests/toys/HoopShot";
import PuttPutt from "./interests/toys/PuttPutt";
import Game2048 from "./interests/toys/Game2048";
import SkiTrack from "./interests/toys/SkiTrack";
import KeycapPress from "./interests/toys/KeycapPress";
import { SoundProvider } from "./interests/SoundContext";
import SoundToggle from "./interests/fx/SoundToggle";

// Quiet view (fun mode off). Text tiles by default.
//
// Photos: only use images you took yourself or that carry a licence allowing
// reuse (and credit them if the licence asks). To add one, drop it in
// /public/interests/ and set `image` + `alt` on the entry below.
//
// Spotify is click-to-load: the iframe sets Spotify cookies, so it only
// loads after the visitor asks for it. See /cookies.
type QuietEntry = {
  label: string;
  line: string;
  image?: string;
  alt?: string;
  imageFit?: "cover" | "contain";
  spotifyEmbed?: string;
  spotifyUrl?: string;
};

const SPOTIFY_PLAYLIST = "364G4Hr4KtJzhWpoHz4MFf";

const QUIET_LIST: QuietEntry[] = [
  { label: "Watches", line: "A little useless and a little perfect." },
  { label: "Cars", line: "Specs are boring. The noise isn't." },
  { label: "Barça", line: "Més que un club." },
  {
    label: "Music",
    line: "Headphones on most of the day.",
    spotifyEmbed: `https://open.spotify.com/embed/playlist/${SPOTIFY_PLAYLIST}`,
    spotifyUrl: `https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST}`,
  },
  { label: "Basketball", line: "Hornets. Through whatever." },
  { label: "Golf", line: "Mid-handicap, working it down." },
  { label: "Gaming", line: "Arc Raiders · Forza · EA FC · NBA 2K." },
  { label: "Skiing", line: "Vermont weekends. NU Downhill Skiers." },
  { label: "Keyboards", line: "Hand-built. Lubed switches. 65%." },
];

export default function Interests() {
  const [fun, setFun] = useState<boolean | null>(null);

  // Only remembered once the visitor flips the switch — nothing is written to
  // their browser on a plain visit. See /cookies.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("fun-mode");
    } catch {
      /* storage blocked — default on */
    }
    setFun(stored === null ? true : stored === "1");
  }, []);

  const toggleFun = () => {
    const next = !(fun ?? true);
    setFun(next);
    try {
      window.localStorage.setItem("fun-mode", next ? "1" : "0");
    } catch {
      /* no-op */
    }
  };

  const funMode = fun ?? true;

  return (
    <SoundProvider>
      {/* Hero ----------------------------------------------------- */}
      <section className="py-12 md:py-20 px-6 md:px-10">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="font-mono text-xs uppercase tracking-[0.2em] muted mb-6">
              Beyond the IDE
            </p>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight leading-[0.98] mb-8 text-balance">
              What I&apos;m into when
              <br />
              I&apos;m <span className="accent">not</span> shipping code.
            </h1>
            <p className="text-base md:text-lg muted max-w-2xl leading-relaxed text-pretty">
              Nine cards, all of them you can mess with. Not into the games?
              Flip the switch.
            </p>
          </motion.div>

          {/* Fun-mode + sound toggles */}
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-[var(--border)] py-4">
            <button
              onClick={toggleFun}
              role="switch"
              aria-checked={funMode}
              className="flex items-center gap-3 group"
            >
              <span className="font-mono text-xs uppercase tracking-[0.2em] muted group-hover:text-[var(--fg)] transition-colors">
                Fun mode
              </span>
              <span
                className={`relative w-11 h-6 border transition-colors ${
                  funMode
                    ? "bg-accent border-accent"
                    : "bg-transparent border-[var(--border-strong)]"
                }`}
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className={`absolute top-0.5 w-4 h-4 ${
                    funMode
                      ? "left-[22px] bg-white"
                      : "left-0.5 bg-[var(--fg)]"
                  }`}
                />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider accent w-5">
                {funMode ? "on" : "off"}
              </span>
            </button>

            {funMode && (
              <>
                <span className="h-4 w-px bg-[var(--border-strong)]" aria-hidden />
                <SoundToggle />
              </>
            )}

            <p className="font-mono text-[10px] uppercase tracking-wider dim flex-1 min-w-[200px]">
              {funMode
                ? "toys on · scroll right on mobile"
                : "toys hidden · just the words"}
            </p>
          </div>
        </div>
      </section>

      {/* Grid ----------------------------------------------------- */}
      <section className="px-6 md:px-10 pb-16 md:pb-24">
        <div className="max-w-6xl mx-auto">
          <AnimatePresence initial={false} mode="wait">
            {funMode ? (
              <motion.div
                key="grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {/* Section label — Spotlights */}
                <div className="hidden md:flex items-baseline gap-4 mb-5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] accent">
                    01 — Spotlights
                  </span>
                  <span className="flex-1 h-px bg-[var(--border)]" />
                  <span className="font-mono text-[10px] uppercase tracking-wider dim">
                    the four you&apos;d hear about first
                  </span>
                </div>

                <div
                  className="
                    -mx-6 md:mx-0
                    flex md:grid md:grid-cols-2 lg:grid-cols-2
                    gap-4 md:gap-5 lg:gap-6
                    overflow-x-auto md:overflow-visible
                    snap-x snap-mandatory md:snap-none
                    px-6 md:px-0
                    pb-4 md:pb-0
                    scroll-smooth
                    items-start
                  "
                >
                  <WatchesBlock />
                  <CarsBlock />
                  <BarcaBlock />
                  <MusicBlock />
                </div>

                {/* Section break ----------------------------------- */}
                <div className="hidden md:flex items-baseline gap-4 mt-12 mb-5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] accent">
                    02 — Toys
                  </span>
                  <span className="flex-1 h-px bg-[var(--border)]" />
                  <span className="font-mono text-[10px] uppercase tracking-wider dim">
                    smaller games · same energy
                  </span>
                </div>

                <div
                  className="
                    -mx-6 md:mx-0
                    flex md:grid md:grid-cols-2 lg:grid-cols-3
                    gap-4 md:gap-5 lg:gap-6
                    overflow-x-auto md:overflow-visible
                    snap-x snap-mandatory md:snap-none
                    px-6 md:px-0
                    pb-4 md:pb-0
                    scroll-smooth
                    items-start
                    mt-6 md:mt-0
                  "
                >
                  <MinorCard
                    label="Basketball"
                    hint="/ swish or brick"
                    caption="Hornets. Through whatever."
                  >
                    <HoopShot />
                  </MinorCard>

                  <MinorCard
                    label="Golf"
                    hint="/ click your line"
                    caption="Mid-handicap, working it down. Public courses."
                  >
                    <PuttPutt />
                  </MinorCard>

                  <MinorCard
                    label="Gaming"
                    hint="/ get to 2048"
                    caption="Arc Raiders · Forza Horizon · EA FC · NBA 2K · long CS habit."
                  >
                    <Game2048 />
                  </MinorCard>

                  <MinorCard
                    label="Skiing"
                    hint="/ dodge the trees"
                    caption="Vermont weekends. Northeastern Downhill Skiers."
                  >
                    <SkiTrack />
                  </MinorCard>

                  <MinorCard
                    label="Keyboards"
                    hint="/ type anything"
                    caption="Hand-built. Lubed switches. Daily: 65% layout."
                  >
                    <KeycapPress />
                  </MinorCard>
                </div>
                <p className="md:hidden mt-2 font-mono text-[10px] uppercase tracking-wider dim text-center">
                  ← swipe →
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="quiet"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 grid-flow-dense">
                  {QUIET_LIST.map((item, i) => {
                    const isMusic = !!item.spotifyEmbed;
                    return (
                      <motion.article
                        key={item.label}
                        initial={{ opacity: 0, y: 18, scale: 0.96 }}
                        whileInView={{ opacity: 1, y: 0, scale: 1 }}
                        viewport={{ once: true, margin: "-60px" }}
                        transition={{
                          duration: 0.5,
                          delay: i * 0.06,
                          ease: [0.22, 0.61, 0.36, 1],
                        }}
                        whileHover={{ y: -3 }}
                        className={`relative aspect-square overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-strong)] hover:border-accent transition-colors duration-300 group ${
                          isMusic
                            ? "col-span-2 row-span-2 lg:col-span-2 lg:row-span-2"
                            : ""
                        }`}
                      >
                        {isMusic ? (
                          <SpotifyFacade
                            label={item.label}
                            line={item.line}
                            embed={item.spotifyEmbed!}
                            url={item.spotifyUrl!}
                          />
                        ) : item.image ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.image}
                              alt={item.alt ?? ""}
                              className={`absolute inset-0 w-full h-full transition-transform duration-700 ease-out group-hover:scale-[1.08] ${
                                item.imageFit === "contain" ? "object-contain" : "object-cover"
                              }`}
                            />
                            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
                            <h3 className="absolute bottom-3 left-3 right-3 font-mono text-xs md:text-sm uppercase tracking-[0.25em] text-white">
                              {item.label}
                            </h3>
                          </>
                        ) : (
                          <div className="absolute inset-0 p-4 md:p-6 flex flex-col justify-between">
                            <h3 className="font-mono text-xs md:text-sm uppercase tracking-[0.25em] group-hover:accent transition-colors duration-300">
                              {item.label}
                            </h3>
                            <p className="text-base md:text-xl leading-snug text-balance">
                              {item.line}
                            </p>
                          </div>
                        )}
                      </motion.article>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </SoundProvider>
  );
}

// Spotify embed behind a click. Nothing is requested from Spotify (and no
// Spotify cookies are set) until the visitor presses the button.
function SpotifyFacade({
  label,
  line,
  embed,
  url,
}: {
  label: string;
  line: string;
  embed: string;
  url: string;
}) {
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <iframe
        src={embed}
        title={`${label}: Spotify playlist player`}
        width="100%"
        height="100%"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        className="absolute inset-0 block border-0"
      />
    );
  }

  return (
    <div className="absolute inset-0 p-4 md:p-6 flex flex-col justify-between">
      <h3 className="font-mono text-xs md:text-sm uppercase tracking-[0.25em] accent">
        {label}
      </h3>
      <div>
        <p className="text-xl md:text-3xl leading-snug text-balance mb-6">{line}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setLoaded(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--fg)] text-[var(--bg)] font-medium hover:bg-accent hover:text-[var(--on-accent)] transition-colors"
          >
            Load Spotify player
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="link-underline font-mono text-xs uppercase tracking-wider muted hover:text-[var(--fg)] transition-colors"
          >
            Open playlist on Spotify ↗
          </a>
        </div>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-wider dim max-w-sm">
          Loading the player connects to Spotify, which sets its own cookies.{" "}
          <Link href="/cookies" className="underline hover:text-[var(--fg)]">
            Cookie policy
          </Link>
        </p>
      </div>
    </div>
  );
}
