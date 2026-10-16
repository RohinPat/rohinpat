"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pov, site } from "@/lib/site";
import FieldWallpaper from "./FieldWallpaper";
import Motif from "./Motif";
import Spotlight from "./Spotlight";
import { DOCK, GLYPHS, GRID, type App } from "./apps";
import { closeInto, launch } from "./launch";

// Home is an iPhone home screen — the whole browser, not a mockup. Living
// field as the wallpaper, widgets, app icons and a dock. Tapping an app plays
// the iOS launch zoom into that page; coming back closes into its icon.
// Long-press an icon to jiggle; Search (or ⌘/Ctrl-K) opens Spotlight.

const CREAM = "#f2ead7";

function bostonParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { h: get("hour") % 12, m: get("minute"), s: get("second"), label: `${get("hour")}:${String(get("minute")).padStart(2, "0")}` };
}

function useBoston() {
  const [now, setNow] = useState<ReturnType<typeof bostonParts> | null>(null);
  useEffect(() => {
    const tick = () => setNow(bostonParts());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Springboard() {
  const router = useRouter();
  const [mod, setMod] = useState("⌘K");
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setMod("Ctrl K");
  }, []);
  const now = useBoston();
  const [jiggle, setJiggle] = useState(false);
  const [search, setSearch] = useState(false);

  // coming back from an app: close into its icon
  useEffect(() => {
    closeInto((id) => document.querySelector<HTMLElement>(`[data-tile="${id}"]`));
    [...GRID, ...DOCK].forEach((a) => !a.external && router.prefetch(a.href));
  }, [router]);

  // ⌘/Ctrl-K opens Spotlight; Escape leaves jiggle mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      } else if (e.key === "Escape") {
        setJiggle(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openApp = (app: App, tile?: HTMLElement | null) => {
    setSearch(false);
    if (app.external) {
      if (app.href.startsWith("mailto:")) window.location.href = app.href;
      else window.open(app.href, "_blank", "noopener,noreferrer");
      return;
    }
    const el = tile ?? document.querySelector<HTMLElement>(`[data-tile="${app.id}"]`);
    if (el) launch(el, app.id, app.href, app.land ?? CREAM, () => router.push(app.href));
    else router.push(app.href);
  };

  return (
    <section
      aria-labelledby="home-title"
      className="paper relative min-h-[100svh] overflow-hidden"
      onPointerDown={(e) => {
        // tapping the wallpaper ends jiggle mode
        if (jiggle && (e.target as HTMLElement).dataset.wallpaper !== undefined) setJiggle(false);
      }}
    >
      <FieldWallpaper />
      <div data-wallpaper className="absolute inset-0" aria-hidden="true" />

      <div className="relative z-10 min-h-[100svh] flex flex-col w-full max-w-[46rem] lg:max-w-[60rem] mx-auto px-5 md:px-8 pt-3 pb-4 pointer-events-none">
        {/* status bar (phones already have their own) */}
        <div aria-hidden="true" className="hidden md:flex h-12 items-center justify-between px-2 text-[15px] font-semibold tabular-nums">
          <span>{now?.label ?? "9:41"}</span>
          <span className="flex items-center gap-1.5">
            <span className="flex items-end gap-[2px] h-3">
              {[1, 2, 3, 4].map((b) => (
                <i key={b} className="w-[3px] bg-current rounded-sm" style={{ height: `${b * 3}px` }} />
              ))}
            </span>
            <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
              <path d="M8 2.2c2.4 0 4.6.9 6.2 2.5l1.1-1.1A10.3 10.3 0 0 0 8 .6 10.3 10.3 0 0 0 .7 3.6l1.1 1.1A8.7 8.7 0 0 1 8 2.2Zm0 3.2c1.5 0 2.9.6 4 1.6l1.1-1.1A7.2 7.2 0 0 0 8 3.8c-2 0-3.8.8-5.1 2.1L4 7c1.1-1 2.5-1.6 4-1.6Zm0 3.2c.7 0 1.3.3 1.8.7L8 11.1 6.2 9.3c.5-.4 1.1-.7 1.8-.7Z" />
            </svg>
            <span className="ml-0.5 w-6 h-3 rounded-[4px] border border-current p-[1.5px]">
              <span className="block h-full w-[78%] bg-current rounded-[2px]" />
            </span>
          </span>
        </div>

        {jiggle && (
          <button
            type="button"
            onClick={() => setJiggle(false)}
            className="pointer-events-auto absolute right-5 top-16 md:top-3 z-20 px-4 py-1.5 rounded-full bg-[var(--ink)] text-[var(--paper)] text-sm font-semibold"
          >
            Done
          </button>
        )}

        {/* widgets + apps */}
        <div className="mt-16 md:mt-6 lg:mt-[clamp(12px,4vh,48px)] grid grid-cols-4 md:grid-cols-6 grid-flow-dense auto-rows-[76px] md:auto-rows-[100px] lg:auto-rows-[clamp(90px,13vh,124px)] gap-x-4 md:gap-x-6 lg:gap-x-8 gap-y-3 md:gap-y-5 lg:gap-y-[clamp(12px,2.6vh,28px)] pointer-events-auto">
          <ProfileWidget />
          <ClockWidget now={now} />
          <CaseWidget onOpen={(el) => openApp({ id: "closet-widget", name: "Closet Organizer", href: "/projects/closet-organizer", tile: "", ink: "", land: CREAM, glyph: "hanger" }, el)} />
          {GRID.map((a, i) => (
            <AppIcon key={a.id} app={a} index={i} jiggle={jiggle} onJiggle={() => setJiggle(true)} onOpen={openApp} />
          ))}
        </div>

        <div className="mt-auto pt-6 flex flex-col items-center gap-3 pointer-events-auto">
          <button
            type="button"
            onClick={() => setSearch(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[rgba(13,16,14,0.12)] backdrop-blur-md text-sm font-medium hover:bg-[rgba(13,16,14,0.18)] transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            Search
            <kbd className="hidden md:inline font-mono text-[10px] opacity-60 ml-1">{mod}</kbd>
          </button>

          <nav
            aria-label="Dock"
            className="w-full max-w-[26rem] lg:max-w-[34rem] rounded-[30px] lg:rounded-[36px] bg-[rgba(242,234,215,0.55)] backdrop-blur-xl border border-white/60 shadow-[0_10px_40px_-12px_rgba(13,16,14,0.35)] px-4 py-3"
          >
            <ul className="flex justify-around">
              {DOCK.map((a, i) => (
                <li key={a.id}>
                  <AppIcon app={a} index={i + 10} label={false} jiggle={jiggle} onJiggle={() => setJiggle(true)} onOpen={openApp} />
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      <Spotlight open={search} onClose={() => setSearch(false)} onOpenApp={(a) => openApp(a)} />
    </section>
  );
}

function AppIcon({
  app,
  index,
  label = true,
  jiggle,
  onJiggle,
  onOpen,
}: {
  app: App;
  index: number;
  label?: boolean;
  jiggle: boolean;
  onJiggle: () => void;
  onOpen: (app: App, tile?: HTMLElement | null) => void;
}) {
  const tile = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>();
  const long = useRef(false);

  const down = () => {
    long.current = false;
    timer.current = window.setTimeout(() => {
      long.current = true;
      onJiggle();
    }, 550);
  };
  const cancel = () => window.clearTimeout(timer.current);

  const click = (e: React.MouseEvent) => {
    if (jiggle || long.current) {
      e.preventDefault();
      return;
    }
    if (app.external) return; // browser default: new tab / mail client
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(app, tile.current);
  };

  const body = (
    <>
      <span
        ref={tile}
        data-tile={app.id}
        aria-hidden="true"
        className={`grid place-items-center w-14 h-14 md:w-[66px] md:h-[66px] lg:w-[clamp(62px,9vh,84px)] lg:h-[clamp(62px,9vh,84px)] rounded-[22.5%] shadow-[0_6px_16px_-6px_rgba(13,16,14,0.45),inset_0_0_0_1px_rgba(13,16,14,0.08)] transition-transform duration-150 group-active:scale-90 ${
          jiggle ? "animate-[jiggle_0.3s_ease-in-out_infinite]" : ""
        }`}
        style={{ background: app.tile, color: app.ink, animationDelay: `${-(index % 5) * 0.06}s` }}
      >
        <svg width="56%" height="56%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {GLYPHS[app.glyph]}
        </svg>
      </span>
      {label ? (
        <span className="text-[12px] md:text-[13px] lg:text-[15px] font-medium leading-tight text-center [text-shadow:0_1px_3px_rgba(242,234,215,0.95)]">
          {app.name}
        </span>
      ) : (
        <span className="sr-only">{app.name}</span>
      )}
    </>
  );

  const props = {
    onPointerDown: down,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onClick: click,
    className: "group flex flex-col items-center gap-1.5 select-none [-webkit-touch-callout:none]",
  };

  return app.external ? (
    <a href={app.href} {...(app.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })} {...props}>
      {body}
      {!app.href.startsWith("mailto:") && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  ) : (
    <Link href={app.href} {...props}>
      {body}
    </Link>
  );
}

function ProfileWidget() {
  return (
    <div className="signal col-span-4 row-span-2 rounded-[24px] p-4 md:p-5 flex flex-col justify-between shadow-[0_10px_30px_-14px_rgba(13,16,14,0.5)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
        {site.role} · {site.employer}
      </p>
      <div>
        <h1 id="home-title" data-hero-name className="hero-field" style={{ fontSize: "clamp(2.4rem, 6vw, 4.75rem)" }}>
          Rohin Patel
        </h1>
        <p className="mt-2 text-sm md:text-[15px] lg:text-lg leading-snug text-pretty max-w-[40ch]">{pov}</p>
      </div>
    </div>
  );
}

function CaseWidget({ onOpen }: { onOpen: (el: HTMLElement | null) => void }) {
  const ref = useRef<HTMLAnchorElement>(null);
  return (
    <Link
      ref={ref}
      href="/projects/closet-organizer"
      data-tile="closet-widget"
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen(ref.current);
      }}
      className="col-span-2 row-span-2 rounded-[24px] p-4 flex flex-col justify-between bg-[var(--ink)] text-[var(--paper)] shadow-[0_10px_30px_-14px_rgba(13,16,14,0.5)] transition-transform active:scale-95"
    >
      <span className="flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mint)]">Case study</span>
        <Motif slug="closet-organizer" className="w-9 h-9 md:w-11 md:h-11 lg:w-16 lg:h-16 text-[var(--mint)]" />
      </span>
      <span>
        <span className="block font-semibold leading-tight text-[15px] md:text-[17px] lg:text-[22px]">Closet Organizer</span>
        <span className="block mt-1 text-[11px] md:text-xs lg:text-sm text-[#b5b6ab]">CLIP · FastAPI · Expo</span>
      </span>
    </Link>
  );
}

function ClockWidget({ now }: { now: ReturnType<typeof bostonParts> | null }) {
  const h = now ? (now.h + now.m / 60) * 30 : 0;
  const m = now ? (now.m + now.s / 60) * 6 : 0;
  const s = now ? now.s * 6 : 0;
  return (
    <div
      className="hidden md:flex col-span-2 row-span-2 rounded-[24px] bg-[var(--paper)] p-3 flex-col items-center justify-center shadow-[0_10px_30px_-14px_rgba(13,16,14,0.5),inset_0_0_0_1px_rgba(13,16,14,0.08)]"
      role="img"
      aria-label={now ? `Boston time ${now.label}` : "Boston time"}
    >
      <svg viewBox="0 0 100 100" className="w-[78%] h-auto" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <text key={i} x={(50 + 37 * Math.sin((i + 1) * (Math.PI / 6))).toFixed(2)} y={(54 - 37 * Math.cos((i + 1) * (Math.PI / 6))).toFixed(2)} textAnchor="middle" fontSize="9" fontWeight="600" fill="#0d100e">
            {i + 1}
          </text>
        ))}
        <line x1="50" y1="50" x2="50" y2="30" stroke="#0d100e" strokeWidth="3.2" strokeLinecap="round" transform={`rotate(${h.toFixed(1)} 50 50)`} />
        <line x1="50" y1="50" x2="50" y2="18" stroke="#0d100e" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${m.toFixed(1)} 50 50)`} />
        <line x1="50" y1="58" x2="50" y2="14" stroke="#1d5e3f" strokeWidth="1.1" transform={`rotate(${s} 50 50)`} />
        <circle cx="50" cy="50" r="2.4" fill="#1d5e3f" />
      </svg>
      <span className="mt-1 text-[11px] font-semibold text-[var(--paper-muted)]">Boston</span>
    </div>
  );
}
