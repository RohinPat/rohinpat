"use client";

import { AnimatePresence, motion } from "framer-motion";
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

// Image-led quiet view. Each entry's `image` is currently a generic Unsplash
// placeholder — swap it for a real photo by:
//   1. Dropping a file into /public/interests/<name>.jpg
//   2. Changing `image:` below to "/interests/<name>.jpg"
// Or paste any URL (whitelist the hostname in next.config.mjs).
//
// Spotify is special-cased — Music renders the live playlist embed instead.
const UNSPLASH = "https://images.unsplash.com";
const IMG = (id: string) => `${UNSPLASH}/${id}?w=800&auto=format&q=70`;

type QuietEntry = {
  label: string;
  line?: string;
  image?: string;
  imageFallback?: string;
  imageFit?: "cover" | "contain";
  spotifyEmbed?: string;
};

const QUIET_LIST: QuietEntry[] = [
  {
    label: "Watches",
    image: "/interests/watches.jpg",
    imageFallback: IMG("photo-1524805444758-089113d48a6d"),
  },
  {
    label: "Cars",
    image: "/interests/cars.jpg",
    imageFallback: IMG("photo-1503376780353-7e6692767b70"),
  },
  {
    label: "Barça",
    image: "/interests/soccer.jpg",
    imageFallback: IMG("photo-1431324155629-1a6deb1dec8d"),
  },
  {
    label: "Music",
    spotifyEmbed: "https://open.spotify.com/embed/playlist/364G4Hr4KtJzhWpoHz4MFf",
  },
  {
    label: "Basketball",
    image: "/interests/bball.jpg",
    imageFit: "contain",
    imageFallback: IMG("photo-1546519638-68e109498ffc"),
  },
  {
    label: "Golf",
    // TODO swap for a real photo: /public/interests/golf.jpg
    image: IMG("photo-1535131749006-b7f58c99034b"),
  },
  {
    label: "Gaming",
    image: "/interests/games.jpg",
    imageFallback: IMG("photo-1612287230202-1ff1d85d1bdf"),
  },
  {
    label: "Skiing",
    image: "/interests/ski.jpeg",
    imageFallback: IMG("photo-1551524559-8af4e6624178"),
  },
  {
    label: "Keyboards",
    image: "/interests/keyboard.webp",
    imageFallback: IMG("photo-1587829741301-dc798b83add3"),
  },
];

export default function Interests() {
  const [fun, setFun] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("fun-mode");
    setFun(stored === null ? true : stored === "1");
  }, []);

  useEffect(() => {
    if (fun === null) return;
    window.localStorage.setItem("fun-mode", fun ? "1" : "0");
  }, [fun]);

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
              onClick={() => setFun((v) => (v === null ? false : !v))}
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
                          <>
                            <iframe
                              src={item.spotifyEmbed}
                              width="100%"
                              height="100%"
                              frameBorder="0"
                              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                              loading="lazy"
                              className="absolute inset-0 block"
                            />
                            <div className="absolute top-3 left-3 pointer-events-none">
                              <span className="font-mono text-[10px] md:text-xs uppercase tracking-[0.25em] accent bg-black/70 backdrop-blur px-2 py-1">
                                {item.label}
                              </span>
                            </div>
                          </>
                        ) : item.image ? (
                          <>
                            <QuietImage
                              src={item.image}
                              alt={item.label}
                              fallback={item.imageFallback}
                              fit={item.imageFit}
                            />
                            {/* Bottom gradient + label */}
                            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
                            <div className="absolute bottom-3 left-3 right-3 pointer-events-none">
                              <motion.span
                                initial={{ y: 0 }}
                                className="block font-mono text-xs md:text-sm uppercase tracking-[0.25em] text-white group-hover:accent transition-colors duration-300"
                              >
                                {item.label}
                              </motion.span>
                            </div>
                            {/* Hover accent corner indicator */}
                            <div className="absolute top-2 right-2 w-2 h-2 bg-accent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                          </>
                        ) : null}
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

// Wrapped image with onError fallback. Local /interests/* files will use that
// path if present; if the file 404s, we fall back to the Unsplash placeholder
// so the page never shows a broken image during the swap-in period.
function QuietImage({
  src,
  alt,
  fallback,
  fit = "cover",
}: {
  src: string;
  alt: string;
  fallback?: string;
  fit?: "cover" | "contain";
}) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [usingFallback, setUsingFallback] = useState(false);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={currentSrc}
      alt={alt}
      onError={() => {
        if (!usingFallback && fallback) {
          setCurrentSrc(fallback);
          setUsingFallback(true);
        }
      }}
      className={`absolute inset-0 w-full h-full transition-transform duration-700 ease-out group-hover:scale-[1.08] ${
        fit === "contain" ? "object-contain" : "object-cover"
      }`}
    />
  );
}
