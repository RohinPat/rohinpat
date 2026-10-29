"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LinkPath, LinkSession, LinkState, Role } from "./session";

// The only place the UI learns which session implementation it has. Everything
// is loaded on demand, so the home page's first load carries none of it.
//
// To use the real relay + WebRTC session, change the two lines in
// createLink() to import("./client") and call hostLink() / joinLink(code).

// The real session (relay + direct WebRTC) by default. The BroadcastChannel
// mock stands in where there's no relay to talk to: `next dev` can't upgrade
// WebSockets, so the UI's tests and local work set NEXT_PUBLIC_LINK_MOCK=1 or
// add ?linkmock to the page URL.
export function mockRequested(): boolean {
  if (process.env.NEXT_PUBLIC_LINK_MOCK === "1") return true;
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("linkmock");
}

export async function createLink(role: Role, code?: string): Promise<LinkSession> {
  const impl = mockRequested() ? await import("./mock") : await import("./client");
  return role === "host" ? impl.hostLink() : impl.joinLink(code ?? "");
}

// The host's session outlives the home page: tapping an app on the phone
// navigates the laptop away, and the link must still be there when it comes
// back. So it lives at module level (module memory only: nothing is stored on
// the visitor's device) and the page just attaches to it.
let hostSession: Promise<LinkSession> | null = null;
let hostResolved: LinkSession | null = null;

function getHost(): Promise<LinkSession> {
  if (hostResolved && hostResolved.state === "closed") dropHost();
  if (!hostSession) {
    hostSession = createLink("host").then((s) => {
      hostResolved = s;
      tellHostWatchers();
      return s;
    });
  }
  return hostSession;
}

export function dropHost(): void {
  const s = hostResolved;
  hostSession = null;
  hostResolved = null;
  s?.close();
  tellHostWatchers();
}

// Pages that only want to *use* a link that already exists (the games, which
// are open on /interests long after the home page that created it has gone)
// look at it with peekHost(). It never creates one, so a visitor with no phone
// pays nothing: no network, no code on the relay.
const hostWatchers = new Set<() => void>();
function tellHostWatchers() {
  hostWatchers.forEach((cb) => cb());
}

/** The host session if one has been created and is still usable; never starts one. */
export function peekHost(): LinkSession | null {
  return hostResolved && hostResolved.state !== "closed" ? hostResolved : null;
}

/** Called when the host session is created or dropped. */
export function onHostChange(cb: () => void): () => void {
  hostWatchers.add(cb);
  return () => void hostWatchers.delete(cb);
}

export type LinkView = {
  session: LinkSession | null;
  state: LinkState | "idle";
  path: LinkPath | null;
  code: string | null;
  pairUrl: string | null;
};

const IDLE: LinkView = { session: null, state: "idle", path: null, code: null, pairUrl: null };

export type UseLink = LinkView & {
  /** create (or, for the host, re-attach to) the session; the phone passes the code it joins */
  start: (code?: string) => void;
  /** close it. The host's next start() makes a new code. */
  stop: () => void;
};

export function useLink(role: Role): UseLink {
  const [view, setView] = useState<LinkView>(IDLE);
  const live = useRef<{ session: LinkSession; off: () => void } | null>(null);
  const gen = useRef(0);

  const detach = useCallback(() => {
    live.current?.off();
    live.current = null;
  }, []);

  const attach = useCallback((s: LinkSession) => {
    const snap = (state: LinkState, path: LinkPath | null): LinkView => ({
      session: s,
      state,
      path,
      code: s.code,
      pairUrl: s.pairUrl,
    });
    const off = s.onState((state, path) => setView(snap(state, path)));
    live.current = { session: s, off };
    setView(snap(s.state, s.path));
  }, []);

  const start = useCallback(
    (code?: string) => {
      if (live.current) {
        // the host's session was dropped and made again by someone else on the
        // page (two Pair chips, Off hours and a game's): follow it to the new one
        if (role !== "host" || !hostSession || live.current.session === hostResolved) return;
        detach();
      }
      const mine = ++gen.current;
      const made = role === "host" ? getHost() : createLink("phone", code);
      void made.then((s) => {
        if (mine !== gen.current) {
          // we were stopped or unmounted while it loaded
          if (role === "phone") s.close();
          return;
        }
        attach(s);
      });
    },
    [role, attach, detach],
  );

  const stop = useCallback(() => {
    gen.current++;
    const s = live.current?.session;
    detach();
    if (role === "host") dropHost();
    else s?.close();
    setView(IDLE);
  }, [role, detach]);

  // leaving the page for real (not just switching tabs) says goodbye, so the
  // other side hears it at once instead of waiting out the relay's grace
  useEffect(() => {
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      if (role === "host") dropHost();
      else live.current?.session.close();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [role]);

  useEffect(
    () => () => {
      gen.current++;
      const s = live.current?.session;
      detach();
      if (role === "phone") s?.close();
    },
    [role, detach],
  );

  return { ...view, start, stop };
}
