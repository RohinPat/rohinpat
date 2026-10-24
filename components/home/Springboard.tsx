"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { pov, site } from "@/lib/site";
import { burst, getAudio } from "@/components/offhours/audio";
import FieldWallpaper from "./FieldWallpaper";
import Motif from "./Motif";
import Spotlight from "./Spotlight";
import VenomCursor from "./VenomCursor";
import { ALL_APPS, DOCK, GLYPHS, GRID, type App } from "./apps";
import type { PairInfo } from "@/components/link/PairCard";
import { closeInto, isUnlocked, launch, markUnlocked } from "./launch";

// Home is an iPhone. On a phone it's full-bleed (your phone is the device);
// from 768px it sits in a frame — "pro", then "pro max" from 1280px with the
// name either side — and from 1600px it's an iPhone Duo, the book-style
// foldable: it opens closed on the outer screen's lock screen, and unlocking
// swings the cover open to the wide inner screen (widgets left, apps right).
// Apps launch with the iOS zoom; Control Center pulls down from the status
// bar; Spotlight on Search or ⌘/Ctrl-K; long-press to jiggle.

const CREAM = "#f2ead7";
// loaded only when someone taps the lock screen's camera
const CameraApp = dynamic(() => import("./CameraApp"), { ssr: false });
// the phone link (components/link): loaded only on a mouse-first wide screen,
// after the page has settled, so the home page's first load doesn't carry it
const LinkHost = dynamic(() => import("@/components/link/LinkHost"), { ssr: false });
const PairCard = dynamic(() => import("@/components/link/PairCard"), { ssr: false });
// the pairing card, offered to whichever lock screen is showing
const PairSlot = createContext<React.ReactNode>(null);
// the lock screen that's showing, so a linked phone's finger can move it
let remoteDrag: ((p: number | null) => void) | null = null;

const DUO_MS = 820; // the cover's swing; matches .duo-leaf in globals.css

type Boston = { h: number; m: number; s: number; label: string; date: string };

function bostonNow(d = new Date()): Boston {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const date = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
  return { h: get("hour") % 12, m: get("minute"), s: get("second"), label: `${get("hour")}:${String(get("minute")).padStart(2, "0")}`, date };
}

function useBoston() {
  const [now, setNow] = useState<Boston | null>(null);
  useEffect(() => {
    const tick = () => setNow(bostonNow());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Springboard() {
  const router = useRouter();
  const section = useRef<HTMLElement>(null);
  const now = useBoston();
  const [duo, setDuo] = useState(false);
  const [fitted, setFitted] = useState(false);
  const [search, setSearch] = useState(false);
  const [locked, setLocked] = useState(() => !isUnlocked());
  const [lockGone, setLockGone] = useState(() => isUnlocked());
  const [justUnlocked, setJustUnlocked] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  const [linkOk, setLinkOk] = useState(false);
  const [pair, setPair] = useState<PairInfo | null>(null);

  // the phone link is for mouse-first wide screens: never on a phone
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)");
    const on = () => setLinkOk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // fit the device to the window
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1600px)");
    const fit = () => {
      setDuo(wide.matches);
      setFitted(true);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw < 768 || !section.current) return;
      const big = vw >= 1280;
      // frame sizes, bezel included (see .dev-slot / .duo-slot)
      const [dw, dh] = wide.matches ? [978, 696] : big ? [458, 960] : [421, 880];
      const sideNames = big ? 2 * Math.min(420, vw * 0.22) : 64;
      const s = Math.min(1, (vh - 150) / dh, (vw - sideNames) / dw);
      section.current.style.setProperty("--s", s.toFixed(4));
      // the name fills whatever is left either side of the device
      const side = (vw - dw * s) / 2 - vw * 0.04;
      section.current.style.setProperty("--name", `${Math.max(48, Math.min(210, side / 2.65)).toFixed(1)}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    wide.addEventListener("change", fit);
    return () => {
      window.removeEventListener("resize", fit);
      wide.removeEventListener("change", fit);
    };
  }, []);

  useEffect(() => {
    // warm the other pages when the main thread is idle, not mid-hydration
    // or mid-unfold
    const prefetch = () => [...GRID, ...DOCK].forEach((a) => !a.external && router.prefetch(a.href));
    const ric = "requestIdleCallback" in window;
    const idle = ric ? window.requestIdleCallback(prefetch, { timeout: 4000 }) : window.setTimeout(prefetch, 1500);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (ric) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [router]);

  const unlock = useCallback(() => {
    if (!locked) return;
    markUnlocked();
    setLocked(false);
    setJustUnlocked(true);
    const wait = reducedMotion() ? 0 : duo ? DUO_MS + 40 : 480;
    // while the Duo swings, expensive extras (the venom cursor's lighting)
    // stand down; see VenomCursor
    if (duo) document.documentElement.dataset.swing = "";
    window.setTimeout(() => {
      setLockGone(true);
      delete document.documentElement.dataset.swing;
    }, wait);
    window.setTimeout(() => document.querySelector<HTMLElement>("[data-home] a")?.focus({ preventScroll: true }), wait + 20);
  }, [locked, duo]);

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

  const linkOpen = (id: string) => {
    const app = ALL_APPS.find((a) => a.id === id);
    if (app && !app.external) openApp(app);
  };

  return (
    <PairSlot.Provider value={linkOk && pair ? <PairCard info={pair} /> : null}>
    <section
      ref={section}
      aria-labelledby="home-title"
      className="paper relative min-h-[100svh] overflow-hidden md:flex md:items-center md:justify-center md:pt-14 md:pb-6"
    >
      {/* the name — either side of the device on wide screens */}
      <h1
        id="home-title"
        data-hero-name
        className="hero-field sr-only lg:not-sr-only lg:absolute lg:inset-x-0 lg:top-1/2 lg:-translate-y-1/2 lg:flex lg:justify-between lg:px-[3vw] pointer-events-none select-none"
        style={{ fontSize: "var(--name, clamp(4rem, calc((100vw - 560px) / 5.6), 13rem))" }}
      >
        <span>Rohin</span>
        <span>Patel</span>
      </h1>

      <Device slotRef={slot} duo={duo} fitted={fitted} open={!locked} cover={!lockGone} now={now} onUnlock={unlock}>
        <PhoneScreen
          duo={duo}
          now={now}
          locked={locked}
          lockGone={lockGone}
          justUnlocked={justUnlocked}
          onUnlock={unlock}
          openApp={openApp}
          onSearch={() => setSearch(true)}
        />
      </Device>

      <Spotlight open={search} onClose={() => setSearch(false)} onOpenApp={(a) => openApp(a)} />
      <VenomCursor root={section} />
      {linkOk && (
        <LinkHost
          target={slot}
          locked={locked}
          onPair={setPair}
          onDrag={(p) => remoteDrag?.(p)}
          onUnlock={unlock}
          onOpen={linkOpen}
        />
      )}
    </section>
    </PairSlot.Provider>
  );
}

// One component for every frame, so the screen inside stays mounted when the
// window crosses a breakpoint (the `false` holes keep children in place).
function Device({
  slotRef,
  duo,
  fitted,
  open,
  cover,
  now,
  onUnlock,
  children,
}: {
  slotRef: React.Ref<HTMLDivElement>;
  duo: boolean;
  fitted: boolean;
  open: boolean;
  cover: boolean;
  now: Boston | null;
  onUnlock: () => void;
  children: React.ReactNode;
}) {
  return (
    <div ref={slotRef} className={duo ? "duo-slot" : "dev-slot"} data-fitted={fitted || undefined}>
      <div className={duo ? `duo ${open ? "is-open" : ""}` : "dev"} data-duo={duo ? (open ? "open" : "closed") : undefined}>
        <div className={duo ? "duo-body" : "contents"}>
          <div className={duo ? "duo-frame" : "dev-frame"} aria-hidden="true" />
          {!duo && (
            <>
              <span className="dev-btn" aria-hidden="true" style={{ left: -19, top: 120, height: 32 }} />
              <span className="dev-btn" aria-hidden="true" style={{ left: -19, top: 180, height: 62 }} />
              <span className="dev-btn" aria-hidden="true" style={{ left: -19, top: 254, height: 62 }} />
              <span className="dev-btn" aria-hidden="true" style={{ right: -19, top: 210, height: 96 }} />
            </>
          )}
          <div className={duo ? "duo-screen" : "dev-screen"}>
            {duo ? <div className="duo-crease" aria-hidden="true" /> : <div className="dev-island" aria-hidden="true" />}
            {children}
          </div>
        </div>
        {duo && cover && <DuoCover now={now} locked={!open} onUnlock={onUnlock} />}
      </div>
    </div>
  );
}

// The Duo's cover: the outer display (lock screen) on its front, the left
// half of the inner display on its back. Unlocking swings it open on the
// hinge; once it lands, the real left half takes over and the cover goes.
function DuoCover({ now, locked, onUnlock }: { now: Boston | null; locked: boolean; onUnlock: () => void }) {
  return (
    <div className="duo-leaf">
      <div className="duo-face duo-front">
        <span className="duo-btn" aria-hidden="true" style={{ top: 96, height: 58 }} />
        <span className="duo-btn" aria-hidden="true" style={{ top: 170, height: 40 }} />
        <div className="duo-outer">
          <div className="duo-island" aria-hidden="true" />
          {/* frozen once the cover starts to swing: nobody sees it redraw */}
          <FieldWallpaper dark paused={!locked} />
          <LockScreen now={now} locked={locked} onUnlock={onUnlock} dark slide={false} />
        </div>
      </div>
      <div className="duo-face duo-back" aria-hidden="true">
        <div className="duo-back-screen" />
      </div>
    </div>
  );
}

function PhoneScreen({
  duo,
  now,
  locked,
  lockGone,
  justUnlocked,
  onUnlock,
  openApp,
  onSearch,
}: {
  duo: boolean;
  now: Boston | null;
  locked: boolean;
  lockGone: boolean;
  justUnlocked: boolean;
  onUnlock: () => void;
  openApp: (a: App, tile?: HTMLElement | null) => void;
  onSearch: () => void;
}) {
  const home = useRef<HTMLDivElement>(null);
  const [jiggle, setJiggle] = useState(false);
  const [cc, setCc] = useState(false);
  const [paused, setPaused] = useState(false);
  const [dark, setDark] = useState(true); // the phone starts in dark mode
  const [bright, setBright] = useState(100);

  // coming back from an app: close into its icon
  useEffect(() => {
    if (isUnlocked()) closeInto((id) => document.querySelector<HTMLElement>(`[data-tile="${id}"]`));
  }, []);

  // the home screen can't be reached while locked or under Control Center
  useEffect(() => {
    const el = home.current;
    if (!el) return;
    if (locked || cc) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [locked, cc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setJiggle(false);
        setCc(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fg = dark ? "text-[var(--paper)]" : "text-[var(--ink)]";
  const anim = justUnlocked ? "apps-in" : "";

  const widgets = (
    <>
      <ProfileWidget i={0} />
      <ClockWidget now={now} i={1} />
      <CaseWidget
        i={2}
        onOpen={(el) =>
          openApp({ id: "closet-widget", name: "Closet Organizer", href: "/projects/closet-organizer", tile: "", ink: "", land: CREAM, glyph: "hanger" }, el)
        }
      />
    </>
  );
  const icons = GRID.map((a, k) => (
    <AppIcon key={a.id} app={a} index={k} i={3 + k} dark={dark} jiggle={jiggle} onJiggle={() => setJiggle(true)} onOpen={openApp} />
  ));
  const grid = "grid grid-cols-4 grid-flow-dense auto-rows-[76px] gap-x-4 gap-y-3 [@media(max-height:720px)]:auto-rows-[64px] [@media(max-height:720px)]:gap-y-2 md:!auto-rows-[76px] md:!gap-y-3 pointer-events-auto content-start";

  return (
    <div className={`relative w-full h-full min-h-[inherit] ${fg}`} style={{ filter: bright < 100 ? `brightness(${bright / 100})` : undefined }}>
      {/* held still for the Duo's swing: re-uploading a full-screen canvas
          every frame is what made the unfold stutter */}
      <FieldWallpaper paused={paused || (duo && justUnlocked && !lockGone)} dark={dark} />
      <div className="absolute inset-0" aria-hidden="true" onPointerDown={() => jiggle && setJiggle(false)} />

      {/* status bar (inside a frame; real phones have their own) */}
      <div className="hidden md:flex absolute top-0 inset-x-0 z-30 h-[54px] items-center justify-between px-8 text-[16px] font-semibold tabular-nums">
        <span aria-hidden="true">{now?.label ?? "9:41"}</span>
        <button
          type="button"
          onClick={() => setCc(true)}
          aria-label="Open Control Center"
          className="flex items-center gap-1.5 rounded-full px-1.5 py-1 hover:bg-[rgba(13,16,14,0.08)]"
        >
          <StatusGlyphs />
        </button>
      </div>

      {/* home screen */}
      <div
        ref={home}
        data-home
        className={`relative z-10 flex flex-col min-h-[100svh] md:min-h-0 md:h-full pb-4 pointer-events-none transition-opacity duration-300 ${
          duo ? "px-8 pt-[64px]" : "px-5 pt-[76px] [@media(max-height:720px)]:pt-[64px] md:!pt-[76px]"
        } ${locked && !duo ? "opacity-0" : "opacity-100"}`}
      >
        {jiggle && (
          <button
            type="button"
            onClick={() => setJiggle(false)}
            className="pointer-events-auto absolute right-5 top-[62px] z-20 px-4 py-1.5 rounded-full bg-[var(--ink)] text-[var(--paper)] text-sm font-semibold"
          >
            Done
          </button>
        )}

        {duo ? (
          // open Duo: Today View on the left half, the Home Screen on the right
          <div className="grid grid-cols-2 gap-x-16">
            {/* widgets pop in once the cover has landed on this half */}
            <div className={`${grid} ${anim} [--d:520ms]`}>{widgets}</div>
            {/* the right half is lit under the cover from the start (already
                painted, so the swing doesn't wait on it); it's just uncovered */}
            <div className={`${grid} pt-2`}>{icons}</div>
          </div>
        ) : (
          <div className={`${grid} ${anim}`}>
            {widgets}
            {icons}
          </div>
        )}

        <div className="mt-auto pt-6 [@media(max-height:720px)]:pt-3 md:!pt-6 flex flex-col items-center gap-3 [@media(max-height:720px)]:gap-2 md:!gap-3 pointer-events-auto">
          <div className="flex items-center gap-2">
            {/* phones: Control Center lives beside Search (no status bar here) */}
            <button
              type="button"
              onClick={() => setCc(true)}
              aria-label="Open Control Center"
              className={`md:hidden flex items-center px-2.5 py-2 rounded-full backdrop-blur-md ${dark ? "bg-[rgba(242,234,215,0.14)]" : "bg-[rgba(13,16,14,0.12)]"}`}
            >
              <StatusGlyphs />
            </button>
            <button
              type="button"
              onClick={onSearch}
              data-venom
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full backdrop-blur-md text-sm font-medium transition-colors ${
                dark ? "bg-[rgba(242,234,215,0.14)] hover:bg-[rgba(242,234,215,0.22)]" : "bg-[rgba(13,16,14,0.12)] hover:bg-[rgba(13,16,14,0.18)]"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              Search
            </button>
          </div>

          <nav
            aria-label="Dock"
            className={`w-full rounded-[30px] backdrop-blur-xl border shadow-[0_10px_40px_-12px_rgba(13,16,14,0.35)] px-4 py-3 [@media(max-height:720px)]:py-2 md:!py-3 ${
              duo ? "max-w-[400px]" : ""
            } ${dark ? "bg-[rgba(13,16,14,0.45)] border-white/15" : "bg-[rgba(242,234,215,0.55)] border-white/60"}`}
          >
            <ul className={`flex justify-around ${anim}`}>
              {DOCK.map((a, k) => (
                <li key={a.id} style={{ ["--i" as string]: 8 + k } as React.CSSProperties}>
                  <AppIcon app={a} index={k + 10} label={false} dark={dark} jiggle={jiggle} onJiggle={() => setJiggle(true)} onOpen={openApp} />
                </li>
              ))}
            </ul>
          </nav>
          <span aria-hidden="true" className={`hidden md:block w-[134px] h-[5px] rounded-full opacity-80 ${dark ? "bg-[var(--paper)]" : "bg-[var(--ink)]"}`} />
        </div>
      </div>

      {/* on the Duo the lock screen lives on the cover's outer display */}
      {!duo && !lockGone && <LockScreen now={now} locked={locked} onUnlock={onUnlock} dark={dark} />}

      {cc && (
        <ControlCenter
          duo={duo}
          now={now}
          paused={paused}
          dark={dark}
          bright={bright}
          onPaused={setPaused}
          onDark={setDark}
          onBright={setBright}
          onClose={() => setCc(false)}
        />
      )}
    </div>
  );
}


function StatusGlyphs() {
  return (
    <span className="flex items-center gap-1.5" aria-hidden="true">
      <span className="flex items-end gap-[2px] h-3">
        {[1, 2, 3, 4].map((b) => (
          <i key={b} className="w-[3px] bg-current rounded-sm" style={{ height: `${b * 3}px` }} />
        ))}
      </span>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
        <path d="M8 2.2c2.4 0 4.6.9 6.2 2.5l1.1-1.1A10.3 10.3 0 0 0 8 .6 10.3 10.3 0 0 0 .7 3.6l1.1 1.1A8.7 8.7 0 0 1 8 2.2Zm0 3.2c1.5 0 2.9.6 4 1.6l1.1-1.1A7.2 7.2 0 0 0 8 3.8c-2 0-3.8.8-5.1 2.1L4 7c1.1-1 2.5-1.6 4-1.6Zm0 3.2c.7 0 1.3.3 1.8.7L8 11.1 6.2 9.3c.5-.4 1.1-.7 1.8-.7Z" />
      </svg>
      <span className="ml-0.5 w-6 h-3 rounded-[4px] border border-current p-[1.5px]">
        <span className="block h-full w-[78%] bg-current rounded-[2px]" />
      </span>
    </span>
  );
}

// Lock screen: big clock over the wallpaper. Swipe or scroll up, or press
// the button (Enter/Space), to unlock. `slide`: it slides away on unlock (on
// the Duo it stays put and swings away with the cover instead).
function LockScreen({
  now,
  locked,
  onUnlock,
  dark,
  slide = true,
}: {
  now: Boston | null;
  locked: boolean;
  onUnlock: () => void;
  dark: boolean;
  slide?: boolean;
}) {
  const start = useRef<number | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const beam = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const [torch, setTorch] = useState(false);
  const [flash, setFlash] = useState(false);
  const [camera, setCamera] = useState(false);
  const pairCard = useContext(PairSlot);
  const remote = useRef(false); // a linked phone's finger is on it

  // a linked phone drags this layer the way a finger would
  useEffect(() => {
    const move = (p: number | null) => {
      remote.current = p !== null;
      setDrag(p === null ? 0 : -p * (layer.current?.offsetHeight ?? 0));
    };
    remoteDrag = move;
    return () => {
      if (remoteDrag === move) remoteDrag = null;
    };
  }, []);

  // the two lock-screen buttons do what they do on a phone: the torch lights
  // a pool on the wallpaper that follows the pointer; the camera opens a
  // viewfinder that names colours the way Closet Organizer does
  const click = (freq: number) => {
    const au = getAudio();
    if (au) burst(au, { freq, q: 4, dur: 0.025, gain: 0.35 });
  };
  const aim = (e: React.PointerEvent) => {
    const r = layer.current?.getBoundingClientRect();
    if (!r || !beam.current) return;
    beam.current.style.setProperty("--bx", `${e.clientX - r.left}px`);
    beam.current.style.setProperty("--by", `${e.clientY - r.top}px`);
  };
  const closeCamera = useCallback(() => setCamera(false), []);
  const shoot = () => {
    if (flash) return;
    const au = getAudio();
    if (au) {
      burst(au, { freq: 5200, q: 2, dur: 0.03, gain: 0.5 });
      burst(au, { freq: 2600, q: 2, dur: 0.05, gain: 0.4, at: 0.07 });
    }
    setFlash(true);
    window.setTimeout(() => {
      setFlash(false);
      setCamera(true);
    }, reducedMotion() ? 0 : 260);
  };

  // scrolling over the lock screen unlocks it (and doesn't scroll the page)
  useEffect(() => {
    const el = layer.current;
    if (!el || !locked) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) > 18) onUnlock();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [locked, onUnlock]);

  return (
    <>
    <div
      ref={layer}
      data-lock-layer
      className="absolute inset-x-0 top-0 h-[100svh] md:h-auto md:bottom-0 z-20 flex flex-col items-center touch-none select-none"
      style={{
        transform: locked || !slide ? `translateY(${drag}px)` : "translateY(-105%)",
        opacity: locked || !slide ? 1 : 0,
        transition: start.current !== null || remote.current ? "none" : "transform 0.48s cubic-bezier(0.32,0.72,0,1), opacity 0.48s ease",
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (torch) aim(e);
        start.current = e.clientY;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (torch) aim(e);
        if (start.current === null) return;
        setDrag(Math.min(0, e.clientY - start.current));
      }}
      onPointerUp={() => {
        if (start.current === null) return;
        const unlocking = drag < -70;
        start.current = null;
        setDrag(0);
        if (unlocking) onUnlock();
      }}
    >
      <div
        ref={beam}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-200"
        style={{
          opacity: torch ? 1 : 0,
          mixBlendMode: "screen",
          background: "radial-gradient(circle 190px at var(--bx, 50%) var(--by, 42%), rgba(255,246,222,0.55), rgba(255,240,205,0.18) 55%, transparent 75%)",
        }}
      />
      {flash && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 bg-white opacity-0 [animation:shutter_380ms_ease-out]" />}
      <div className="mt-[132px] md:mt-[96px] text-center">
        <p className="text-[17px] font-semibold opacity-90">{now?.date ?? " "}</p>
        <p
          className="hero-field tabular-nums leading-none mt-1"
          style={{ fontSize: "clamp(5.5rem, 26vw, 7.25rem)", fontStretch: "75%" }}
          aria-label={now ? `Boston time ${now.label}` : undefined}
        >
          {now?.label ?? "9:41"}
        </p>
      </div>
      <div className={`mt-6 rounded-[22px] px-4 py-3 text-center backdrop-blur-xl ${dark ? "bg-[rgba(242,234,215,0.12)]" : "bg-[rgba(242,234,215,0.6)]"}`}>
        <p className="font-semibold">{site.name}</p>
        <p className="text-sm opacity-80">
          {site.role} · {site.employer}
        </p>
      </div>

      <div className="mt-auto w-full px-10 pb-5 flex flex-col items-center gap-4">
        {pairCard}
        <div className="w-full flex justify-between">
          <button
            type="button"
            aria-label="Flashlight"
            aria-pressed={torch}
            data-venom
            onClick={() => {
              click(torch ? 1800 : 2400);
              setTorch((t) => !t);
            }}
            className={`w-12 h-12 rounded-full grid place-items-center backdrop-blur-xl transition-[transform,background-color,color] duration-150 active:scale-90 ${
              torch ? "bg-[var(--paper)] text-[var(--ink)]" : dark ? "bg-[rgba(242,234,215,0.14)]" : "bg-[rgba(13,16,14,0.12)]"
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 2h8v4l-2 4v11a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V10L8 6z" fill={torch ? "currentColor" : "none"} />
              <path d="M8 6h8M12 13v2" stroke={torch ? "var(--paper)" : "currentColor"} />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Camera: names the colours of whatever you point it at"
            data-venom
            onClick={shoot}
            className={`w-12 h-12 rounded-full grid place-items-center backdrop-blur-xl transition-transform duration-150 active:scale-90 ${dark ? "bg-[rgba(242,234,215,0.14)]" : "bg-[rgba(13,16,14,0.12)]"}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
        </div>
        <button type="button" onClick={onUnlock} data-venom className="text-sm font-semibold opacity-80 hover:opacity-100 px-3 py-1 rounded-full">
          Swipe up to unlock
        </button>
        <span aria-hidden="true" className={`w-[134px] h-[5px] rounded-full ${dark ? "bg-[var(--paper)]" : "bg-[var(--ink)]"}`} />
      </div>
    </div>
    {camera && <CameraApp onClose={closeCamera} />}
    </>
  );
}

function ControlCenter({
  duo,
  now,
  paused,
  dark,
  bright,
  onPaused,
  onDark,
  onBright,
  onClose,
}: {
  duo: boolean;
  now: Boston | null;
  paused: boolean;
  dark: boolean;
  bright: number;
  onPaused: (v: boolean) => void;
  onDark: (v: boolean) => void;
  onBright: (v: number) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, []);
  const tile = "rounded-[22px] bg-[rgba(242,234,215,0.14)] backdrop-blur-xl";
  const round = (on: boolean) =>
    `w-14 h-14 rounded-full grid place-items-center transition-colors ${on ? "bg-[var(--paper)] text-[var(--ink)]" : "bg-[rgba(242,234,215,0.18)] text-[var(--paper)]"}`;
  const links = [
    { name: "GitHub", href: site.github, glyph: "branch" as const },
    { name: "LinkedIn", href: site.linkedin, glyph: "badge" as const },
    { name: "Mail", href: `mailto:${site.email}`, glyph: "envelope" as const },
    { name: "Colophon", href: "/colophon", glyph: "braces" as const },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Control Center"
      className="absolute inset-0 z-40 bg-[rgba(13,16,14,0.55)] backdrop-blur-2xl text-[var(--paper)] animate-[rise_0.25s_ease-out]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* on the wide Duo screen it sits top-right, as on iPad */}
      <div ref={panel} className={`px-6 pt-[80px] md:pt-[72px] grid grid-cols-4 gap-4 ${duo ? "max-w-[420px] ml-auto" : ""}`}>
        <div className={`${tile} col-span-2 row-span-2 p-4 grid grid-cols-2 gap-3 place-items-center`}>
          <button type="button" aria-pressed={!paused} onClick={() => onPaused(!paused)} className={round(!paused)} aria-label="Live wallpaper">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              {paused ? <path d="M8 5v14l11-7Z" /> : <path d="M8 5v14M16 5v14" />}
            </svg>
          </button>
          <button type="button" aria-pressed={dark} onClick={() => onDark(!dark)} className={round(dark)} aria-label="Dark wallpaper">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {GLYPHS.moon}
            </svg>
          </button>
          <span className="text-[11px] font-medium text-center col-span-2 opacity-80">
            {paused ? "Wallpaper still" : "Wallpaper live"} · {dark ? "Dark" : "Light"}
          </span>
        </div>

        <label className={`${tile} col-span-1 row-span-2 flex flex-col items-center justify-end py-3 relative overflow-hidden`}>
          <span className="sr-only">Brightness</span>
          <input
            type="range"
            min={40}
            max={100}
            value={bright}
            onChange={(e) => onBright(Number(e.target.value))}
            className="absolute inset-0 opacity-0 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
          />
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 bg-[var(--paper)]" style={{ height: `${((bright - 40) / 60) * 100}%` }} />
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={bright > 60 ? "#0d100e" : "currentColor"}
            strokeWidth="1.8"
            strokeLinecap="round"
            className="relative pointer-events-none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
          </svg>
        </label>

        <div className={`${tile} col-span-1 row-span-2 flex flex-col items-center justify-center`}>
          <span className="hero-field text-2xl tabular-nums">{now?.label ?? "9:41"}</span>
          <span className="text-[11px] opacity-80 mt-1">Boston</span>
        </div>

        {links.map((l) => (
          <a
            key={l.name}
            href={l.href}
            {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className={`${tile} aspect-square grid place-items-center hover:bg-[rgba(242,234,215,0.24)]`}
            aria-label={l.href.startsWith("http") ? `${l.name} (opens in a new tab)` : l.name}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {GLYPHS[l.glyph]}
            </svg>
          </a>
        ))}

        <button type="button" onClick={onClose} className="col-span-4 mt-2 py-2 text-sm font-semibold opacity-80 hover:opacity-100">
          Close
        </button>
      </div>
    </div>
  );
}

function AppIcon({
  app,
  index,
  i,
  label = true,
  dark = false,
  jiggle,
  onJiggle,
  onOpen,
}: {
  app: App;
  index: number;
  i?: number;
  label?: boolean;
  dark?: boolean;
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
        className={`grid place-items-center w-14 h-14 [@media(max-height:720px)]:w-12 [@media(max-height:720px)]:h-12 md:!w-[62px] md:!h-[62px] rounded-[22.5%] shadow-[0_6px_16px_-6px_rgba(13,16,14,0.45),inset_0_0_0_1px_rgba(13,16,14,0.08)] transition-transform duration-150 group-active:scale-90 ${
          jiggle ? "animate-[jiggle_0.3s_ease-in-out_infinite]" : ""
        }`}
        style={{
          background: dark && app.tile === "#0d100e" ? "#1e2320" : app.tile,
          color: app.ink,
          boxShadow: dark ? "0 6px 16px -6px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(242,234,215,0.12)" : undefined,
          animationDelay: `${-(index % 5) * 0.06}s`,
        }}
      >
        <svg width="56%" height="56%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {GLYPHS[app.glyph]}
        </svg>
      </span>
      {label ? (
        <span
          className={`text-[12px] font-medium leading-tight text-center whitespace-nowrap ${
            dark ? "[text-shadow:0_1px_3px_rgba(13,16,14,0.9)]" : "[text-shadow:0_1px_3px_rgba(242,234,215,0.9)]"
          }`}
        >
          <span aria-hidden={app.short ? true : undefined}>{app.short ?? app.name}</span>
          {app.short && <span className="sr-only">{app.name}</span>}
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
    style: i !== undefined ? ({ ["--i" as string]: i } as React.CSSProperties) : undefined,
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

function ProfileWidget({ i }: { i: number }) {
  return (
    <div
      className="signal col-span-4 row-span-2 rounded-[24px] p-4 flex flex-col justify-between shadow-[0_10px_30px_-14px_rgba(13,16,14,0.5)]"
      style={{ ["--i" as string]: i } as React.CSSProperties}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
        {site.role} · {site.employer}
      </p>
      <div>
        <p className="hero-field text-[2.6rem] [@media(max-height:720px)]:text-[2rem] md:!text-[2.6rem]">
          {site.name}
        </p>
        <p className="mt-1.5 text-sm leading-snug text-pretty">{pov}</p>
      </div>
    </div>
  );
}

function CaseWidget({ onOpen, i }: { onOpen: (el: HTMLElement | null) => void; i: number }) {
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
      style={{ ["--i" as string]: i } as React.CSSProperties}
      className="col-span-2 row-span-2 rounded-[24px] p-4 [@media(max-height:720px)]:p-3 md:!p-4 flex flex-col justify-between bg-[#1e2320] text-[var(--paper)] shadow-[0_10px_30px_-14px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(242,234,215,0.12)] transition-transform active:scale-95"
    >
      <span className="flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mint)]">Case study</span>
        <Motif slug="closet-organizer" className="w-9 h-9 text-[var(--mint)]" />
      </span>
      <span>
        <span className="block font-semibold leading-tight text-[15px]">Closet Organizer</span>
        <span className="block mt-1 text-[11px] text-[#b5b6ab] whitespace-nowrap">CLIP · FastAPI</span>
      </span>
    </Link>
  );
}

function ClockWidget({ now, i }: { now: Boston | null; i: number }) {
  const h = now ? (now.h + now.m / 60) * 30 : 0;
  const m = now ? (now.m + now.s / 60) * 6 : 0;
  const s = now ? now.s * 6 : 0;
  return (
    <div
      className="hidden md:flex col-span-2 row-span-2 rounded-[24px] bg-[var(--paper)] text-[var(--ink)] p-3 flex-col items-center justify-center shadow-[0_10px_30px_-14px_rgba(13,16,14,0.5),inset_0_0_0_1px_rgba(13,16,14,0.08)]"
      role="img"
      aria-label={now ? `Boston time ${now.label}` : "Boston time"}
      style={{ ["--i" as string]: i } as React.CSSProperties}
    >
      <svg viewBox="0 0 100 100" className="w-[78%] h-auto" aria-hidden="true">
        {Array.from({ length: 12 }, (_, k) => (
          <text
            key={k}
            x={(50 + 37 * Math.sin((k + 1) * (Math.PI / 6))).toFixed(2)}
            y={(54 - 37 * Math.cos((k + 1) * (Math.PI / 6))).toFixed(2)}
            textAnchor="middle"
            fontSize="9"
            fontWeight="600"
            fill="#0d100e"
          >
            {k + 1}
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
