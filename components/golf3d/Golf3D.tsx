"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRemote } from "@/lib/link/remote";
import PairChip from "@/components/link/PairChip";
import { useCanvas } from "@/components/offhours/useCanvas";
import { isMuted, onMuteChange, setMuted } from "@/components/offhours/audio";
import { CLUBS } from "@/components/offhours/golf/flight";
import { puttRead } from "@/components/offhours/golf/green";
import { parseSwing, shotFromSwing } from "@/components/offhours/golf/remoteSwing";
import type { CourseGame, Phase } from "@/components/offhours/golf/play";
import type { paint as Paint } from "@/components/offhours/golf/playDraw";
import type { CourseRenderer } from "./render3d";

// The course on its own page, full screen, in 3D. The game is the 2D course's
// (play.ts): the same holes, swing, physics and putting. The world is drawn by
// render3d.ts in WebGL; the HUD, the aim line, the tracer, the cards and the
// putting view are drawn by playDraw on a clear canvas over it, which also takes
// the pointer and the keys. Its code (three.js among it) loads with this page.

type Loaded = { game: CourseGame; paint: typeof Paint; gl: CourseRenderer | null };

/** the page's own layer, over the site's navigation and footer (they sit in a stacking context of their own) */
export default function Golf3D() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  return host ? createPortal(<Course />, host) : null;
}

function Course() {
  const [club, setClub] = useState(3);
  const [phase, setPhase] = useState<Phase>("tee-card");
  const [mapOpen, setMapOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const muted = useSyncExternalStore(onMuteChange, isMuted, () => false);
  const glRef = useRef<HTMLCanvasElement>(null);
  const loaded = useRef<Loaded | null>(null);
  const touch = useRef(false);

  // the page is the game: no scrolling under it
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    touch.current = window.matchMedia("(pointer: coarse)").matches;
    let gone = false;
    Promise.all([import("@/components/offhours/golf/play"), import("@/components/offhours/golf/playDraw"), import("./render3d")])
      .then(([play, draw, r3]) => {
        if (gone) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const game = new play.CourseGame({
          seed: 1 + Math.floor(Math.random() * 1e6),
          sound: true,
          reduce,
          say: setStatus,
          onClub: setClub,
          onPhase: setPhase,
          onMap: setMapOpen,
        });
        game.touch = touch.current;
        let gl: CourseRenderer | null = null;
        try {
          if (glRef.current) gl = r3.createCourseRenderer(glRef.current, { lowPower: touch.current, maxPixels: touch.current ? 1.6e6 : 2.4e6 });
        } catch {
          setFailed(true);
        }
        loaded.current = { game, paint: draw.paint, gl };
        setClub(game.club);
        setPhase(game.phase);
        setReady(true);
        if (process.env.NEXT_PUBLIC_LINK_MOCK === "1" || new URLSearchParams(location.search).has("linkmock")) {
          const w = window as unknown as { __golf?: CourseGame; __golf3d?: CourseRenderer | null };
          w.__golf = game;
          w.__golf3d = gl;
        }
        overlay.current?.focus({ preventScroll: true });
      })
      .catch(() => {
        if (!gone) setStatus("The course did not load.");
      });
    return () => {
      gone = true;
      loaded.current?.gl?.dispose();
      loaded.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a linked phone swings, picks the club and aims, as in the dialog
  const remote = useRemote("golf", {
    gesture: (name, data) => {
      const G = loaded.current?.game;
      if (!G) return;
      if (name === "golf-swing") {
        const swing = parseSwing(data);
        if (swing) G.remoteSwing(shotFromSwing(swing, G.club));
      } else if (name === "golf-club") {
        const i = Math.round(Number(data.index));
        if (Number.isFinite(i) && (G.phase === "ready" || G.phase === "rest")) G.setClub(i);
        syncRef.current();
      } else if (name === "golf-aim") G.remoteAim(Number(data.dir) || 0);
      else if (name === "golf-sync" || name === "golf-pick") syncRef.current();
    },
  });
  const syncRef = useRef(() => {});
  syncRef.current = () => {
    const G = loaded.current?.game;
    if (!G) return;
    remote.send({ type: "gesture", name: "golf-club", data: { index: G.club } });
    remote.send({ type: "gesture", name: "golf-mode", data: { range: G.phase !== "putt", mode: "play" } });
  };
  useEffect(() => {
    if (remote.linked) syncRef.current();
  }, [remote.linked, club, phase]);
  const linked = useRef(false);
  linked.current = remote.linked;

  const overlay = useCanvas(
    ({ ctx, w, h, dt, p }) => {
      const L = loaded.current;
      ctx.clearRect(0, 0, w, h);
      if (!L) return;
      const g = L.game;
      g.linked = linked.current;
      g.w = w;
      g.h = h;
      g.advance(dt);
      L.paint(ctx, g, w, h, dt, p, { world: !L.gl });
      // the putting view covers the canvas; the 3D world is not drawn under it
      const putting = g.phase === "putt" || (g.phase === "hole-card" && !!g.putt.course && g.putt.ball.sunk);
      if (L.gl && !putting) L.gl.render(g, w, h);
    },
    {
      interactive: true,
      animateAlways: true,
      maxPixels: 3e6,
      onDown: (p) => loaded.current?.game.pointer("down", p.x, p.y),
      onMove: (p) => loaded.current?.game.pointer("move", p.x, p.y),
      onUp: (p) => loaded.current?.game.pointer("up", p.x, p.y),
      keys: (e, down) => {
        const G = loaded.current?.game;
        if (!G) return false;
        const handled = G.key(e, down);
        if (down && (e.key === "r" || e.key === "R")) setReading(G.putt.reading);
        return handled;
      },
    },
  );

  const sub = (on: boolean) =>
    `h-8 px-2.5 sm:px-3 rounded-full font-mono text-[11px] uppercase tracking-[0.12em] ${on ? "bg-[#1d5e3f] text-[#f2ead7]" : "text-[#b5b6ab] hover:text-[#f2ead7]"}`;
  const G = loaded.current?.game;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0d100e] select-none">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-[#0d100e]">
        <div className="flex flex-wrap items-center gap-1">
          {phase === "putt" ? (
            <button
              type="button"
              aria-pressed={reading}
              onClick={() => {
                if (!G) return;
                puttRead(G.putt, !G.putt.reading);
                setReading(G.putt.reading);
                setStatus(G.putt.reading ? "Reading the green: tap or drag to pour water where you want to see the break." : "Back to putting.");
              }}
              className={sub(reading)}
            >
              Read green
            </button>
          ) : (
            <>
              {CLUBS.map((c, i) => (
                <button key={c.id} type="button" aria-pressed={club === i} aria-label={c.name} onClick={() => G?.setClub(i)} className={sub(club === i)}>
                  {c.short}
                </button>
              ))}
              <span className="w-px h-5 bg-white/15 mx-1" aria-hidden="true" />
              <button type="button" aria-label="Aim left" onClick={() => G?.aim(-0.03)} className={`${sub(false)} w-8 !px-0`}>
                ◀
              </button>
              <button type="button" aria-label="Aim right" onClick={() => G?.aim(0.03)} className={`${sub(false)} w-8 !px-0`}>
                ▶
              </button>
              <button type="button" aria-pressed={mapOpen} onClick={() => G?.toggleMap()} className={sub(mapOpen)}>
                Map
              </button>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-pressed={!muted} onClick={() => setMuted(!muted)} className={sub(false)}>
            Sound {muted ? "off" : "on"}
          </button>
          <PairChip tone="dark" />
          <Link href="/interests" aria-label="Leave the course" className={`${sub(false)} w-8 !px-0 inline-flex items-center justify-center`}>
            ✕
          </Link>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 bg-[#d4e6e6]" data-golf-phase={ready ? phase : undefined}>
        <canvas ref={glRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />
        <canvas
          ref={overlay}
          data-autofocus
          role="img"
          aria-label="Golf, six holes. Drag down and swing up, or press Space three times; the arrows aim and change club; M opens the map, and a tap or drag on it sets the aim; on the green you putt."
          className="absolute inset-0 w-full h-full outline-none touch-none"
        />
        {remote.linked && phase !== "putt" && (
          <p className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-3 rounded-full bg-[#0d100e]/80 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]">
            Swing your phone
          </p>
        )}
        {failed && (
          <p className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-24 rounded-full bg-[#0d100e]/80 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]">
            No 3D here: the flat course instead
          </p>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
