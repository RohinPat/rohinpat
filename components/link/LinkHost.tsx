"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { pathExplainer, pillLabel } from "@/lib/link/pill";
import type { LinkMsg, LinkSession, LinkStats } from "@/lib/link/session";
import { clamp01 } from "@/lib/link/swipe";
import { TiltDriver } from "@/lib/link/tilt";
import { isPaired } from "@/lib/link/state";
import { useLink } from "@/lib/link/useLink";
import type { PairInfo } from "./PairCard";

// The laptop side of the phone link, mounted by the home screen only on
// non-touch wide screens and only after the page has settled. It renders
// nothing but a small status pill once a phone is linked; everything else is
// done to the home screen through the callbacks:
//   - the phone's orientation tilts the device (`target`) in 3D
//   - its swipe moves the lock layer, then unlocks
//   - an app tap opens that app
// and it tells the phone which screen the big phone is on.

const MAX_AUTO_RENEWALS = 3; // codes that died unused, replaced before we stop and ask

type Props = {
  /** the device slot (.dev-slot / .duo-slot): what tilts */
  target: React.RefObject<HTMLElement>;
  locked: boolean;
  onPair: (info: PairInfo | null) => void;
  /** 0..1 while a finger drags the lock layer, null when it lets go */
  onDrag: (p: number | null) => void;
  onUnlock: () => void;
  onOpen: (appId: string) => void;
};

// how many LinkHosts are mounted: lets us tell "moved to another page" from a re-render
let attached = 0;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export default function LinkHost(props: Props) {
  const latest = useRef(props);
  latest.current = props;

  const link = useLink("host");
  const { session, state, path, code, pairUrl, start, stop } = link;
  const paired = isPaired(state, path);
  const sessionRef = useRef<LinkSession | null>(null);
  sessionRef.current = session;

  const tilt = useRef<TiltDriver | null>(null);
  const reduced = useReducedMotion();
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [phoneMotion, setPhoneMotion] = useState<string | null>(null);
  const renewals = useRef(0);
  const wasLive = useRef(false);

  const renew = useCallback(() => {
    renewals.current = 0;
    setStale(false);
    stop();
    start();
  }, [start, stop]);

  // attach to (or create) the session once the page is idle
  useEffect(() => {
    attached++;
    const go = () => start();
    const ric = "requestIdleCallback" in window;
    const h = ric ? window.requestIdleCallback(go, { timeout: 1500 }) : window.setTimeout(go, 300);
    return () => {
      if (ric) window.cancelIdleCallback(h);
      else window.clearTimeout(h);
      attached--;
      latest.current.onPair(null);
      // the visitor opened an app (or left): tell the phone it's off the home screen.
      // A moment's grace so a remount (strict mode, hot reload) doesn't flicker it.
      const s = sessionRef.current;
      window.setTimeout(() => {
        if (attached === 0 && s && isPaired(s.state, s.path)) s.send({ type: "screen", name: "piece", piece: location.pathname.startsWith("/interests") ? "list" : location.pathname });
      }, 80);
    };
  }, [start]);

  // a session that ended: replace an expired code (a few times), or a finished link while the lock screen is still showing
  useEffect(() => {
    if (paired) {
      wasLive.current = true;
      renewals.current = 0;
      setStale(false);
      return;
    }
    if (state !== "closed") return;
    stop();
    if (wasLive.current) {
      wasLive.current = false;
      renewals.current = 0;
      if (latest.current.locked) start();
      return;
    }
    renewals.current++;
    if (latest.current.locked && renewals.current <= MAX_AUTO_RENEWALS) start();
    else setStale(true);
  }, [state, paired, start, stop]);

  // what the home screen needs to draw the pairing card
  useEffect(() => {
    if (state === "idle" && !stale) latest.current.onPair(null);
    else latest.current.onPair({ state: stale ? "closed" : state, paired, code, pairUrl, stale, renew });
  }, [state, paired, code, pairUrl, stale, renew]);

  // back on the home screen with a phone still paired (it brought the laptop
  // home, or the visitor clicked back): put the phone on the matching controls
  useEffect(() => {
    if (session && paired) session.send({ type: "screen", name: latest.current.locked ? "lock" : "home" });
  }, [session, paired]);

  // phone -> host
  useEffect(() => {
    if (!session) return;
    const t = new TiltDriver();
    t.reset(performance.now());
    tilt.current = t;
    const onMsg = (m: LinkMsg) => {
      const c = latest.current;
      switch (m.type) {
        case "hello":
          setPhoneMotion(m.motion);
          t.reset(performance.now()); // calibrate on connect: however it's held now is flat
          session.send({ type: "screen", name: c.locked ? "lock" : "home" });
          break;
        case "drag":
          if (c.locked && typeof m.p === "number") c.onDrag(m.p > 0.001 ? clamp01(m.p) : null);
          break;
        case "unlock":
          if (c.locked) {
            c.onDrag(null);
            c.onUnlock();
          }
          break;
        case "open":
          // "home" is the phone's way back from another page; here it's already done
          if (m.app === "home") session.send({ type: "screen", name: c.locked ? "lock" : "home" });
          else if (!c.locked && typeof m.app === "string") c.onOpen(m.app);
          break;
        case "recenter":
          t.recentre(performance.now());
          break;
        default:
          break;
      }
    };
    const offM = session.onMessage(onMsg);
    const offO = session.onOrient((o) => t.push(o, performance.now()));
    return () => {
      offM();
      offO();
      tilt.current = null;
    };
  }, [session]);

  // host -> phone: which screen the big phone is on
  useEffect(() => {
    if (session && paired) session.send({ type: "screen", name: props.locked ? "lock" : "home" });
  }, [session, paired, props.locked]);

  // the tilt itself: one transform per frame, straight onto the device
  const linked = paired;
  useEffect(() => {
    const el = props.target.current;
    if (!linked || !el || reduced) return;
    el.dataset.link = "live";
    let raf = 0;
    let last = "";
    const loop = () => {
      const css = tilt.current?.css(performance.now()) ?? "";
      if (css !== last) {
        el.style.transform = css;
        last = css;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      // settle flat rather than snap
      el.style.transition = "transform 350ms cubic-bezier(0.32, 0.72, 0, 1)";
      el.style.transform = "";
      window.setTimeout(() => {
        el.style.transition = "";
        delete el.dataset.link;
      }, 400);
    };
  }, [linked, reduced, props.target]);

  // the pill's numbers
  useEffect(() => {
    if (!session || !linked) {
      setStats(null);
      return;
    }
    const read = () => setStats(session.stats());
    read();
    const id = window.setInterval(read, open ? 500 : 1000);
    return () => window.clearInterval(id);
  }, [session, linked, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!linked) setOpen(false);
  }, [linked]);

  if (state !== "connecting" && !linked) return null;

  const rtt = stats?.rttMs ?? null;
  const label = pillLabel(state, stats?.path ?? path, rtt);
  const hz = stats?.orientHz ?? 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2.5 z-30 flex flex-col items-center gap-2 px-3">
      {open && (
        <div
          id="link-how"
          role="group"
          aria-label="How this works"
          data-testid="link-how"
          className="pointer-events-auto w-[min(92vw,340px)] rounded-[18px] bg-[var(--ink)] text-[var(--paper)] p-3.5 text-[13px] shadow-[0_18px_50px_-12px_rgba(13,16,14,0.7)] border border-white/10"
        >
          <p className="font-semibold">How this works</p>
          <p className="mt-1 text-[12.5px] leading-snug text-[#c9c6b6]">
            Your phone sends its tilt, swipes and taps to this tab; nothing goes anywhere else and nothing is stored.
          </p>
          <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[12px]">
            <dt className="text-[#a3a69c]">path</dt>
            <dd data-testid="link-path">{pathExplainer(stats?.path ?? path)}</dd>
            <dt className="text-[#a3a69c]">round trip</dt>
            <dd data-testid="link-rtt">{rtt === null ? "measuring…" : `${Math.max(1, Math.round(rtt))} ms`}</dd>
            <dt className="text-[#a3a69c]">samples</dt>
            <dd data-testid="link-hz">{hz} / s</dd>
          </dl>
          {(reduced || phoneMotion === "denied" || phoneMotion === "unavailable") && (
            <p className="mt-2 text-[12px] text-[#c9c6b6]">
              {reduced ? "Live tilt is off (reduced motion). Unlocking and tapping still work." : "Your phone's motion is off, so tilt won't follow. Unlocking and tapping still work."}
            </p>
          )}
          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              data-venom
              onClick={() => session?.close()}
              className="rounded-full bg-[var(--paper)] text-[var(--ink)] px-4 py-1.5 text-[13px] font-semibold"
            >
              Disconnect
            </button>
            <Link href="/projects/phone-link" data-venom className="py-1 font-semibold underline underline-offset-2 text-[var(--mint)]">
              Read how it works
            </Link>
          </div>
        </div>
      )}
      <button
        type="button"
        data-venom
        data-testid="link-pill"
        data-state={state}
        data-path={stats?.path ?? path ?? ""}
        aria-expanded={open}
        aria-controls="link-how"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[var(--ink)] text-[var(--paper)] pl-3 pr-3.5 py-1.5 text-[13px] font-medium shadow-[0_8px_24px_-10px_rgba(13,16,14,0.6)] border border-white/10"
      >
        <span aria-hidden="true" className={`w-2 h-2 rounded-full ${state === "live" ? "bg-[var(--mint)]" : "bg-[#d9b44a]"}`} />
        <span className="tabular-nums">{label}</span>
        <span className="sr-only"> (opens how this works)</span>
      </button>
    </div>
  );
}
