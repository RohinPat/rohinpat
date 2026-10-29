"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parsePieceApp, type PieceId } from "@/components/offhours/pieces";
import type { LinkMsg, LinkSession } from "./session";
import { isPaired } from "./state";
import { onHostChange, peekHost } from "./useLink";

// The laptop side of "the phone is the controller", for the games.
//
//   useRemote(pieceId, handlers)   a game calls this in play mode. It tells the
//                                  phone which game is open, hands the game the
//                                  phone's `gesture` and `axis` messages, and
//                                  says whether a phone is linked.
//   useRemoteList(...)             /interests calls this: it tells the phone the
//                                  grid is showing, and turns the phone's
//                                  `open piece:<id>` / `open piece:list` into
//                                  callbacks (open that tile / close the stage).
//   useRemoteReport(...)           the laptop tells the phone one fact about itself
//                                  (a `gesture` going the other way), now and on request.
//
// All of them only ever *look at* the host session the home page already made
// (peekHost), so without a paired phone they are effectively no-ops: no
// network, no relay client in the games' bundles, nothing created.

export type GestureData = Record<string, number | string | boolean>;

export type RemoteHandlers = {
  /** a finished gesture from the phone (e.g. "golf-swing") */
  gesture?: (name: string, data: GestureData) => void;
  /** a continuous control (tilt steer, twist), -1..1 or radians */
  axis?: (name: string, v: number) => void;
};

export type Remote = {
  /** a phone is paired right now: show "Swing your phone" style hints */
  linked: boolean;
  /** send something to the phone (no-op when nothing is linked) */
  send: (msg: LinkMsg) => void;
};

/** Pure routing: what a game's handlers do with one message from the phone. Returns true if it was handled. */
export function routeRemote(handlers: RemoteHandlers, msg: LinkMsg): boolean {
  if (msg.type === "gesture" && typeof msg.name === "string") {
    handlers.gesture?.(msg.name, msg.data ?? {});
    return !!handlers.gesture;
  }
  if (msg.type === "axis" && typeof msg.name === "string" && typeof msg.v === "number" && Number.isFinite(msg.v)) {
    handlers.axis?.(msg.name, msg.v);
    return !!handlers.axis;
  }
  return false;
}

/** Tell the phone which screen the laptop is on (only if a phone is paired). */
function tell(session: LinkSession, piece: string): void {
  if (isPaired(session.state, session.path)) session.send({ type: "screen", name: "piece", piece });
}

function onInterests(): boolean {
  return typeof location !== "undefined" && location.pathname.startsWith("/interests");
}

/** The existing host session (never creates one) and whether a phone is paired on it. */
function useHostLink(): { session: LinkSession | null; linked: boolean } {
  const [session, setSession] = useState<LinkSession | null>(null);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    const sync = () => setSession(peekHost());
    sync();
    return onHostChange(sync);
  }, []);

  useEffect(() => {
    if (!session) {
      setLinked(false);
      return;
    }
    const upd = () => setLinked(isPaired(session.state, session.path));
    upd();
    return session.onState(upd);
  }, [session]);

  return { session, linked };
}

/**
 * Called by a game in play mode. `pieceId` null (a tile preview) switches it all off.
 *
 *   const { linked } = useRemote(play ? "golf" : null, { gesture: (name, data) => ... });
 *
 * Handlers can change every render; the latest ones are always used.
 */
export function useRemote(pieceId: PieceId | null, handlers: RemoteHandlers = {}): Remote {
  const { session, linked } = useHostLink();
  // a phone that (re)connects mid-game says hello and is told which game this is
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!session || !linked || !pieceId) return;
    tell(session, pieceId);
    const off = session.onMessage((m) => {
      if (m.type === "hello") tell(session, pieceId);
      else routeRemote(latest.current, m);
    });
    return () => {
      off();
      // closing a game on /interests puts the phone back on the game list
      if (onInterests()) tell(session, "list");
    };
  }, [session, linked, pieceId]);

  const send = useCallback((msg: LinkMsg) => {
    const s = peekHost();
    if (s && isPaired(s.state, s.path)) s.send(msg);
  }, []);

  return { linked: !!pieceId && linked, send };
}

/**
 * Tell a linked phone one thing about this laptop as a `gesture` (e.g. "audio" {blocked: true}):
 * when it changes, when a phone (re)connects, and whenever the phone sends the gesture `ask`.
 * A no-op with no phone linked.
 */
export function useRemoteReport(name: string, ask: string, data: GestureData): void {
  const { session, linked } = useHostLink();
  const key = JSON.stringify(data);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    if (!session || !linked) return;
    const say = () => session.send({ type: "gesture", name, data: latest.current });
    say();
    return session.onMessage((m) => {
      if (m.type === "hello" || (m.type === "gesture" && m.name === ask)) say();
    });
  }, [session, linked, name, ask, key]);
}

export type RemoteListOptions = {
  /** the phone asked to open a game ("golf") or to go back to the grid ("list") */
  onOpen: (id: PieceId | "list") => void;
  /** the game whose stage is open right now, or null while the grid is showing. The phone is told
   *  this, so even a game with no controller (and no useRemote of its own) puts the phone on the
   *  right screen. */
  open: PieceId | null;
};

/** Called by /interests (the grid). */
export function useRemoteList({ onOpen, open }: RemoteListOptions): { linked: boolean } {
  const { session, linked } = useHostLink();
  const latest = useRef(onOpen);
  latest.current = onOpen;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!session || !linked) return;
    return session.onMessage((m) => {
      if (m.type === "hello") {
        tell(session, openRef.current ?? "list");
      } else if (m.type === "open" && typeof m.app === "string") {
        const id = parsePieceApp(m.app);
        if (id) latest.current(id);
      }
    });
  }, [session, linked]);

  useEffect(() => {
    if (session && linked) tell(session, open ?? "list");
  }, [session, linked, open]);

  return { linked };
}
