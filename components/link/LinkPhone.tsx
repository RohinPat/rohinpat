"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DOCK, GLYPHS, GRID, type App } from "@/components/home/apps";
import { codeFromHash, formatCode, looksLikeCode, normaliseCode } from "@/lib/link/code";
import { askMotionPermission, type Motion } from "@/lib/link/permission";
import { pillLabel } from "@/lib/link/pill";
import type { LinkMsg, LinkStats } from "@/lib/link/session";
import { dragProgress, inSwipeZone, shouldUnlock } from "@/lib/link/swipe";
import { isPaired } from "@/lib/link/state";
import { useLink } from "@/lib/link/useLink";

// The visitor's own phone, as a controller. It joins the code the laptop shows,
// streams its tilt, swipes up to unlock the replica and taps apps to open them
// there. Everything here is sized for a thumb: big targets, 16px+ type.

type Screen = { name: "lock" | "home" | "piece"; piece?: string };

const MIN_SEND_MS = 8; // ~125 Hz at most, even if a browser fires faster
const NO_DATA_MS = 3000; // this long without a single motion event = no sensor

// React 18's types don't know `inert` yet
const inert = (on: boolean): Record<string, string> => (on ? { inert: "" } : {});

const screenAngle = (): number => {
  const a = window.screen?.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
};

export default function LinkPhone() {
  // full-screen: the site layout's stacking context sits under the nav, so render into <body>
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <noscript>
        <p style={{ padding: 24 }}>This page links your phone to the replica on a laptop, and needs JavaScript.</p>
      </noscript>
    );
  }
  return createPortal(<Controller />, document.body);
}

function Controller() {
  const link = useLink("phone");
  const { session, state, path } = link;

  const [typed, setTyped] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [motion, setMotion] = useState<Motion | null>(null);
  const [noData, setNoData] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "lock" });
  const [localUnlocked, setLocalUnlocked] = useState(false);
  const [leftPiece, setLeftPiece] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [stats, setStats] = useState<LinkStats | null>(null);
  const everLive = useRef(false);

  // the code: from the QR (#c=CODE); otherwise the visitor types it
  useEffect(() => {
    const read = () => setCode(codeFromHash(location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // a phone page: no rubber-banding, no pull-to-refresh mid-swipe
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.overscrollBehavior;
    el.style.overscrollBehavior = "none";
    return () => {
      el.style.overscrollBehavior = prev;
    };
  }, []);

  const liveish = isPaired(state, path);
  if (liveish) everLive.current = true;
  const failed = started && state === "closed";
  const joining = started && !failed && !liveish;

  // never sit on "Linking…" forever: if the relay can't be reached at all (a
  // network that blocks it, a certificate the browser won't take), say so
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!joining) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(t);
  }, [joining]);

  // ---- connect (the click that also raises iOS's motion prompt) ----
  const connect = (withCode: string) => {
    const asked = askMotionPermission(); // first line: must run inside the tap, before any await
    void (async () => {
      setStarted(true);
      setNoData(false);
      setLocalUnlocked(false);
      setLeftPiece(false);
      setScreen({ name: "lock" });
      everLive.current = false;
      const m = await asked;
      setMotion(m);
      link.stop();
      link.start(withCode);
    })();
  };

  // a code typed in the box wins over the one in the URL (which may be the dead one)
  const typedCode = normaliseCode(typed);
  const onConnectClick = () => connect(looksLikeCode(typedCode) ? typedCode : (code ?? typedCode));

  const startOver = () => {
    link.stop();
    setStarted(false);
    setMotion(null);
    setNoData(false);
    setTyped("");
    setCode(null);
    history.replaceState(null, "", location.pathname + location.search);
    setAnnounce("");
  };

  // ---- live: say hello, listen for the host, stream orientation, stay awake ----
  useEffect(() => {
    if (!session || !liveish) return;
    session.send({ type: "hello", role: "phone", ua: navigator.userAgent.slice(0, 160), motion: motion ?? "not-needed" });
    setAnnounce("Linked. Swipe up on this phone to unlock the one on your laptop.");
  }, [session, liveish, motion]);

  useEffect(() => {
    if (!session) return;
    return session.onMessage((m: LinkMsg) => {
      if (m.type === "screen") {
        setScreen({ name: m.name, piece: m.piece });
        setLeftPiece(false);
        if (m.name === "lock") setLocalUnlocked(false);
      }
    });
  }, [session]);

  useEffect(() => {
    if (!session || !liveish || motion === "denied" || motion === "unavailable") return;
    let seq = 0;
    let last = 0;
    let got = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      if (!got) {
        got = true;
        setNoData(false);
      }
      const t = performance.now();
      if (t - last < MIN_SEND_MS) return;
      last = t;
      session.sendOrient({ seq: seq++, t, alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0, screenAngle: screenAngle() });
    };
    window.addEventListener("deviceorientation", onOrient);
    const timer = window.setTimeout(() => {
      if (!got) setNoData(true);
    }, NO_DATA_MS);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      window.clearTimeout(timer);
    };
  }, [session, liveish, motion]);

  useEffect(() => {
    if (!liveish) return;
    type Lock = { release: () => Promise<void> };
    const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<Lock> } };
    let lock: Lock | null = null;
    let gone = false;
    const ask = () => {
      if (document.visibilityState !== "visible") return;
      nav.wakeLock
        ?.request("screen")
        .then((l) => (gone ? void l.release().catch(() => {}) : (lock = l)))
        .catch(() => {});
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", ask);
      void lock?.release().catch(() => {});
    };
  }, [liveish]);

  useEffect(() => {
    if (!session || !liveish) {
      setStats(null);
      return;
    }
    const read = () => setStats(session.stats());
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, [session, liveish]);

  // ---- gestures ----
  const unlock = useCallback(() => {
    session?.send({ type: "unlock" });
    setLocalUnlocked(true);
    setAnnounce("Unlocked.");
  }, [session]);

  const open = (app: App) => {
    session?.send({ type: "open", app: app.id });
    setAnnounce(`Opened ${app.name} on your laptop.`);
  };

  const recentre = () => {
    session?.send({ type: "recenter" });
    setAnnounce("Re-centred.");
  };

  // ---- views ----
  let view: React.ReactNode;
  if (liveish) {
    const showLock = screen.name === "lock" && !localUnlocked;
    const label = pillLabel(state, stats?.path ?? session?.path ?? null, stats?.rttMs ?? null);
    const notes: string[] = [];
    if (state === "reconnecting") notes.push("Lost the laptop for a moment. Reconnecting…");
    if (motion === "denied") notes.push("Motion access is off, so tilt won't follow. Unlocking and taps still work. Reload this page and allow motion to turn it on.");
    else if (motion === "unavailable") notes.push("This browser has no motion sensors, so tilt won't follow. Unlocking and taps still work.");
    else if (noData) notes.push("No motion data is coming from this phone. Tilt won't follow, but unlocking and taps still work.");

    view = (
      <LiveScreen
        label={label}
        notes={notes}
        showLock={showLock}
        screen={screen}
        leftPiece={leftPiece}
        onBack={() => setLeftPiece(true)}
        onUnlock={unlock}
        onSession={(m) => session?.send(m)}
        onOpen={open}
        onRecentre={recentre}
        onDisconnect={startOver}
      />
    );
  } else if (joining) {
    view = (
      <Centered>
        <h1 className="text-[2.1rem] leading-tight font-extrabold">{slow ? "Can't reach the laptop." : "Linking…"}</h1>
        <p className="mt-3 text-lg text-[#c9c6b6]" role={slow ? "alert" : undefined}>
          {slow
            ? "This is taking too long. The network may be blocking the link, or the code may be from an old page. Reload the laptop's page for a fresh code, then try again."
            : <>Looking for the laptop that&apos;s showing {code ? formatCode(code) : "your code"}.</>}
        </p>
        {slow && (
          <button type="button" onClick={startOver} className="mt-6 h-12 px-6 rounded-full bg-[var(--paper)] text-[var(--ink)] font-semibold">
            Try again
          </button>
        )}
      </Centered>
    );
  } else {
    const kind = failed ? (everLive.current ? "left" : "expired") : code ? "ready" : "no-code";
    view = (
      <Setup
        kind={kind}
        code={code}
        typed={typed}
        onType={setTyped}
        onConnect={onConnectClick}
        onOther={startOver}
        canConnect={code !== null || looksLikeCode(normaliseCode(typed))}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[100] h-[100dvh] overflow-hidden bg-[var(--ink)] text-[var(--paper)]" data-testid="phone-controller" data-state={state}>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {view}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="h-full w-full flex flex-col justify-center px-7 pb-[12dvh] max-w-[480px] mx-auto" aria-live="polite">
      {children}
    </main>
  );
}

const bigButton =
  "mt-7 w-full min-h-[64px] rounded-[20px] bg-[var(--mint)] text-[var(--ink)] text-[1.25rem] font-bold px-6 py-4 active:scale-[0.98] transition-transform disabled:opacity-40";
const ghostButton = "mt-4 min-h-[48px] px-4 text-base font-semibold text-[var(--mint)] underline underline-offset-4";

function Setup({
  kind,
  code,
  typed,
  onType,
  onConnect,
  onOther,
  canConnect,
}: {
  kind: "no-code" | "ready" | "expired" | "left";
  code: string | null;
  typed: string;
  onType: (v: string) => void;
  onConnect: () => void;
  onOther: () => void;
  canConnect: boolean;
}) {
  const heading = {
    "no-code": "Pick up your phone.",
    ready: "Link this phone.",
    expired: "That code isn't open any more.",
    left: "The laptop left.",
  }[kind];
  const body = {
    "no-code": "There's no code on this page. Scan the QR code on the laptop's lock screen, or type the code it shows.",
    ready: `Linking to the laptop that's showing ${code ? formatCode(code) : ""}. Your phone will ask for motion access: that's only used to tilt the replica.`,
    expired: "It may have timed out, or the laptop closed it. Look at the laptop for a fresh code, then scan it again or type it here.",
    left: "The other side closed the link. If it's still on the lock screen it will have a fresh code: scan it again or type it here.",
  }[kind];
  const typing = kind !== "ready";

  return (
    <main className="h-full w-full overflow-y-auto" aria-labelledby="phone-title">
      <div className="min-h-full flex flex-col justify-center px-7 py-10 max-w-[480px] mx-auto">
        <p className="font-mono text-[13px] uppercase tracking-[0.18em] text-[var(--mint)]">Phone link</p>
        <h1 id="phone-title" className="mt-3 text-[2.4rem] leading-[1.05] font-extrabold text-balance">
          {heading}
        </h1>
        <p className="mt-4 text-[1.1rem] leading-snug text-[#c9c6b6]" role={kind === "expired" || kind === "left" ? "alert" : undefined}>
          {body}
        </p>

        {typing && (
          <form
            className="mt-7"
            onSubmit={(e) => {
              e.preventDefault();
              if (canConnect) onConnect();
            }}
          >
            <label htmlFor="phone-code" className="block text-base font-semibold">
              Code on the laptop
            </label>
            <input
              id="phone-code"
              value={typed}
              onChange={(e) => onType(e.target.value.toUpperCase())}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={14}
              placeholder="ABC DEF"
              className="mt-2 w-full min-h-[64px] rounded-[16px] bg-white/10 border border-white/25 px-4 text-[1.6rem] font-mono tracking-[0.12em] text-[var(--paper)] placeholder:text-white/30 focus:outline-none focus:border-[var(--mint)]"
            />
          </form>
        )}

        <button type="button" data-testid="connect" className={bigButton} disabled={!canConnect} onClick={onConnect}>
          {kind === "expired" || kind === "left" ? "Connect again" : "Connect"}
        </button>
        {kind === "ready" && (
          <button type="button" className={ghostButton} onClick={onOther}>
            Use a different code
          </button>
        )}
        <p className="mt-6 text-sm leading-snug text-[#a3a69c]">Nothing is stored on this phone. The link ends when you close this page.</p>
      </div>
    </main>
  );
}

function LiveScreen({
  label,
  notes,
  showLock,
  screen,
  leftPiece,
  onBack,
  onUnlock,
  onSession,
  onOpen,
  onRecentre,
  onDisconnect,
}: {
  label: string;
  notes: string[];
  showLock: boolean;
  screen: Screen;
  leftPiece: boolean;
  onBack: () => void;
  onUnlock: () => void;
  onSession: (m: LinkMsg) => void;
  onOpen: (a: App) => void;
  onRecentre: () => void;
  onDisconnect: () => void;
}) {
  const onPiece = screen.name === "piece" && !leftPiece;
  return (
    <div className="absolute inset-0" data-testid="phone-live" data-screen={showLock ? "lock" : onPiece ? "piece" : "home"}>
      {/* home controller, under the lock layer */}
      <main className="absolute inset-0 flex flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]" aria-label={onPiece ? "Controls" : "Home screen controller"}
        {...inert(showLock)}
      >
        <Bar label={label} onRecentre={onRecentre} onDisconnect={onDisconnect} notes={notes} />
        {onPiece ? <Piece piece={screen.piece} onBack={onBack} /> : <Home onOpen={onOpen} />}
      </main>

      {/* the lock layer follows the finger up */}
      <LockLayer show={showLock} label={label} notes={notes} onSession={onSession} onUnlock={onUnlock} onRecentre={onRecentre} onDisconnect={onDisconnect} />
    </div>
  );
}

function Bar({ label, onRecentre, onDisconnect, notes }: { label: string; onRecentre: () => void; onDisconnect: () => void; notes: string[] }) {
  return (
    <header className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white/10 px-3.5 py-2 text-[15px] font-medium tabular-nums" data-testid="phone-pill">
          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[var(--mint)]" />
          {label}
        </span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={onRecentre} className="min-h-[44px] whitespace-nowrap rounded-full bg-white/10 px-4 text-[15px] font-semibold">
            Re-centre
          </button>
          <button type="button" onClick={onDisconnect} className="min-h-[44px] whitespace-nowrap rounded-full px-3 text-[15px] font-semibold text-[#c9c6b6]">
            Disconnect
          </button>
        </span>
      </div>
      {notes.map((n) => (
        <p key={n} role="status" className="mt-3 rounded-[14px] bg-[#d9b44a]/15 border border-[#d9b44a]/40 px-3.5 py-2.5 text-[15px] leading-snug text-[#f0dc9d]">
          {n}
        </p>
      ))}
    </header>
  );
}

function Piece({ piece, onBack }: { piece?: string; onBack: () => void }) {
  const game = !piece || piece.startsWith("/interests");
  return (
    <div className="flex-1 flex flex-col justify-center" data-testid="phone-piece">
      <h1 className="text-[2rem] leading-tight font-extrabold text-balance">
        {game ? "Controls for this game are coming soon; use your laptop." : "Your laptop has opened a page."}
      </h1>
      <p className="mt-3 text-lg leading-snug text-[#c9c6b6]">
        {game ? "Soon this phone will be the controller." : "Read it on the laptop. Go back to its home screen to use this phone as a remote again."}
      </p>
      <button type="button" onClick={onBack} className={bigButton}>
        Back
      </button>
    </div>
  );
}

function Tile({ app, onOpen }: { app: App; onOpen: (a: App) => void }) {
  const inner = (
    <>
      <span
        aria-hidden="true"
        className="grid place-items-center w-[72px] h-[72px] rounded-[22.5%] transition-transform duration-150 group-active:scale-90 shadow-[0_6px_16px_-6px_rgba(0,0,0,0.6)]"
        style={{ background: app.tile === "#0d100e" ? "#1e2320" : app.tile, color: app.ink, boxShadow: "0 6px 16px -6px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(242,234,215,0.14)" }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {GLYPHS[app.glyph]}
        </svg>
      </span>
      <span className="text-[15px] font-medium leading-tight whitespace-nowrap">{app.short ?? app.name}</span>
    </>
  );
  const cls = "group flex flex-col items-center gap-2 p-1 select-none [-webkit-touch-callout:none]";
  // links that leave the site open on this phone (a popup on the laptop would be blocked)
  return app.external ? (
    <a
      href={app.href}
      className={cls}
      {...(app.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      aria-label={`${app.name} (opens on this phone)`}
    >
      {inner}
    </a>
  ) : (
    <button type="button" className={cls} data-app={app.id} onClick={() => onOpen(app)} aria-label={`${app.name}: opens on your laptop`}>
      {inner}
    </button>
  );
}

function Home({ onOpen }: { onOpen: (a: App) => void }) {
  return (
    <div className="flex-1 flex flex-col" data-testid="phone-home">
      <h1 className="mt-6 text-[1.6rem] font-extrabold leading-tight">Tap an app. It opens on your laptop.</h1>
      <div className="mt-6 grid grid-cols-4 gap-y-6 content-start">
        {GRID.map((a) => (
          <Tile key={a.id} app={a} onOpen={onOpen} />
        ))}
      </div>
      <p className="mt-6 text-[15px] leading-snug text-[#a3a69c]">GitHub, LinkedIn and Mail open on this phone instead.</p>
      <nav aria-label="Dock" className="mt-auto rounded-[30px] bg-white/10 border border-white/15 px-3 py-4">
        <ul className="flex justify-around">
          {DOCK.map((a) => (
            <li key={a.id}>
              <Tile app={a} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function LockLayer({
  show,
  label,
  notes,
  onSession,
  onUnlock,
  onRecentre,
  onDisconnect,
}: {
  show: boolean;
  label: string;
  notes: string[];
  onSession: (m: LinkMsg) => void;
  onUnlock: () => void;
  onRecentre: () => void;
  onDisconnect: () => void;
}) {
  const [y, setY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y0: number; t0: number; y: number; id: number; captured: boolean; sent: number } | null>(null);
  const [clock, setClock] = useState({ time: "", date: "" });

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock({
        time: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, ""),
        date: d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }),
      });
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, []);

  // coming back to the lock screen (the laptop re-locked): put the layer back
  useEffect(() => {
    if (show) setY(0);
  }, [show]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!show) return;
    // iOS Safari owns the bottom edge: a swipe may not start in the bottom 15%
    if (!inSwipeZone(e.clientY, window.innerHeight)) return;
    // no pointer capture until it moves: a plain tap on a button still clicks
    drag.current = { y0: e.clientY, t0: performance.now(), y: e.clientY, id: e.pointerId, captured: false, sent: 0 };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.y = e.clientY;
    if (!d.captured) {
      if (Math.abs(e.clientY - d.y0) < 6) return;
      d.captured = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    const h = window.innerHeight;
    const dy = Math.min(0, e.clientY - d.y0);
    setY(dy);
    const now = performance.now();
    if (now - d.sent >= 16) {
      d.sent = now;
      onSession({ type: "drag", p: dragProgress(dy, h) });
    }
  };
  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (!d.captured) return;
    setDragging(false);
    const h = window.innerHeight;
    const dy = Math.min(0, d.y - d.y0);
    const p = dragProgress(dy, h);
    const speed = p / Math.max(0.016, (performance.now() - d.t0) / 1000);
    if (shouldUnlock(p, speed)) {
      setY(-h * 1.05);
      onUnlock();
    } else {
      setY(0);
      onSession({ type: "drag", p: 0 });
    }
  };

  return (
    <div
      data-testid="phone-lock"
      data-shown={show}
      aria-hidden={show ? undefined : true}
      {...inert(!show)}
      className="absolute inset-0 flex flex-col items-center touch-none select-none"
      style={{
        background: "radial-gradient(120% 70% at 25% 18%, #1f4a35 0%, #12261c 38%, #0d100e 75%)",
        transform: show ? `translateY(${y}px)` : "translateY(-105%)",
        transition: dragging ? "none" : "transform 0.48s cubic-bezier(0.32,0.72,0,1)",
        pointerEvents: show ? "auto" : "none",
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="w-full px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <Bar label={label} notes={notes} onRecentre={onRecentre} onDisconnect={onDisconnect} />
      </div>

      <div className="mt-[7dvh] text-center px-6">
        <p className="text-[1.15rem] font-semibold opacity-90">{clock.date}</p>
        <p className="hero-field tabular-nums leading-none mt-1" style={{ fontSize: "clamp(5.5rem, 30vw, 8.5rem)", fontStretch: "75%" }}>
          {clock.time}
        </p>
        <h1 className="mt-6 text-[1.7rem] leading-tight font-extrabold text-balance">Tilt me.</h1>
        <p className="mt-2 text-lg text-[#c9c6b6]">The phone on your laptop is following.</p>
      </div>

      {/* sits above the bottom 15% on purpose: that edge belongs to Safari */}
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ bottom: "20dvh" }}>
        <svg className="animate-bounce opacity-80" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 15l6-6 6 6" />
        </svg>
        <button type="button" data-testid="phone-unlock" onClick={onUnlock} className="min-h-[56px] px-6 text-[1.2rem] font-semibold rounded-full">
          Swipe up to unlock
        </button>
      </div>
    </div>
  );
}
