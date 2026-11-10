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
import { sfx, windBed } from "@/components/offhours/golf/sound";
import type { CourseGame, Phase } from "@/components/offhours/golf/play";
import type { paint as Paint } from "@/components/offhours/golf/playDraw";
import type { CourseRenderer } from "./render3d";
import { createConfetti } from "./confetti";
import { flyoverS, flyoverView, mixView, titleView, type View } from "./flyover";
import { replayView } from "./replay";
import { PuttCam } from "./puttcam";
import { modeName, setupFor, setupFromQuery, queryFor, today, type Mode, type Setup } from "./modes";
import RoundEnd from "./RoundEnd";

// The course on its own page, full screen, in 3D. The game is the 2D course's
// (play.ts): the same holes, swing, physics and putting. The world is drawn by
// render3d.ts in WebGL, the putting green too (the camera drops low behind the
// ball); the HUD, the aim line, the tracer and the hole cards are drawn by
// playDraw on a clear canvas over it, which also takes the pointer and the keys. The title, the pause menu and the end of the round
// are this page's. Its code (three.js among it) loads with this page.
//
// Modes come from the URL (modes.ts): a round's link replays it. Nothing is stored.

type Mods = { play: typeof import("@/components/offhours/golf/play"); paint: typeof Paint };
type Loaded = { mods: Mods; gl: CourseRenderer | null; attract: CourseGame; game: CourseGame | null };

/** the page's own layer, over the site's navigation and footer (they sit in a stacking context of their own) */
export default function Golf3D() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  return host ? createPortal(<Course />, host) : null;
}

const MODES: { mode: Mode; label: string; sub: (d: string) => string }[] = [
  { mode: "full", label: "Nine holes", sub: () => "Par 36" },
  { mode: "quick", label: "Quick 3", sub: () => "Three of the nine" },
  { mode: "daily", label: "Daily", sub: (d) => `Today's winds · ${d}` },
];

function Course() {
  const [screen, setScreen] = useState<"title" | "play">("title");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [shared, setShared] = useState<Setup | null>(null);
  const [paused, setPaused] = useState(false);
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
  const reduce = useRef(false);
  /** tests reach the game from the window: with the mock link on, or ?linkmock on the page's first URL (a round's own URL drops it) */
  const expose = useRef(false);
  const live = useRef({ screen, paused });
  live.current = { screen, paused };
  const fx = useRef({ confetti: createConfetti(), cheered: -1, leave: null as { from: View; t: number } | null, last: null as View | null, title: 0, putt: new PuttCam() });

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
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    expose.current = process.env.NEXT_PUBLIC_LINK_MOCK === "1" || new URLSearchParams(location.search).has("linkmock");
    setShared(setupFromQuery(new URLSearchParams(location.search)));
    let gone = false;
    Promise.all([import("@/components/offhours/golf/play"), import("@/components/offhours/golf/playDraw"), import("./render3d")])
      .then(([play, draw, r3]) => {
        if (gone) return;
        const attract = new play.CourseGame({ seed: 1, hills: true });
        let gl: CourseRenderer | null = null;
        try {
          if (glRef.current) gl = r3.createCourseRenderer(glRef.current, { lowPower: touch.current, maxPixels: touch.current ? 1.6e6 : 2.4e6, reduce: reduce.current });
        } catch {
          setFailed(true);
        }
        loaded.current = { mods: { play, paint: draw.paint }, gl, attract, game: null };
        setReady(true);
        if (expose.current) (window as unknown as { __golf3d?: CourseRenderer | null }).__golf3d = gl;
      })
      .catch(() => {
        if (!gone) setStatus("The course did not load.");
      });
    return () => {
      gone = true;
      windBed(0);
      loaded.current?.gl?.dispose();
      loaded.current = null;
    };
  }, []);

  /** a new round: a new game on the same renderer, and the URL that replays it */
  const start = (s: Setup) => {
    const L = loaded.current;
    if (!L) return;
    const game = new L.mods.play.CourseGame({
      seed: s.seed,
      holes: s.defs,
      sound: true,
      hills: true,
      replays: !!L.gl && !reduce.current,
      reduce: reduce.current,
      teeCardS: (d) => (reduce.current || !L.gl ? 2 : flyoverS(d.yards)),
      say: setStatus,
      onClub: setClub,
      onPhase: setPhase,
      onMap: setMapOpen,
    });
    game.touch = touch.current;
    L.game = game;
    fx.current.confetti.clear();
    fx.current.cheered = -1;
    fx.current.leave = null;
    setSetup(s);
    setClub(game.club);
    setPhase(game.phase);
    setPaused(false);
    setScreen("play");
    history.replaceState(null, "", `/golf${queryFor(s)}`);
    if (expose.current) (window as unknown as { __golf?: CourseGame }).__golf = game;
    requestAnimationFrame(() => overlay.current?.focus({ preventScroll: true }));
  };
  const toTitle = () => {
    setPaused(false);
    setScreen("title");
    if (loaded.current) loaded.current.game = null;
    history.replaceState(null, "", "/golf");
  };

  // a linked phone swings, picks the club and aims, as in the dialog
  const remote = useRemote("golf", {
    gesture: (name, data) => {
      const G = loaded.current?.game;
      if (!G || live.current.paused) return;
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
      const F = fx.current;
      const g = L.game;
      // the wind in the trees while a round is played
      windBed(g && live.current.screen === "play" && !live.current.paused && g.phase !== "round-card" ? Math.hypot(g.wind[0], g.wind[1]) : 0);
      if (!g || live.current.screen === "title") {
        // the title: the first hole from the air, turning slowly
        F.title += reduce.current ? 0 : dt;
        L.gl?.render(L.attract, w, h, titleView(L.attract.hole, F.title, w, h));
        return;
      }
      const stop = live.current.paused;
      g.linked = linked.current;
      g.w = w;
      g.h = h;
      if (!stop) g.advance(dt);
      // on the green the 3D camera is the putt's own, and the putt reads the pointer through it: drawn before the HUD
      const putting = g.phase === "putt" || (g.phase === "hole-card" && !!g.putt.course && g.putt.ball.sunk);
      if (L.gl && putting) {
        L.gl.render(g, w, h, F.putt.step(g.hole, g.putt, w, h, stop ? 0 : dt, g.cam, reduce.current));
        g.putt.proj ??= L.gl.puttProj(g);
      } else {
        F.putt.reset();
        g.putt.proj = null;
      }
      L.mods.paint(ctx, g, w, h, stop ? 0 : dt, p, { world: !L.gl, roundCard: false, teeHud: !L.gl || reduce.current });
      // under par: paper and a chime over the hole card
      if (g.phase === "hole-card" && F.cheered !== g.scores.length) {
        F.cheered = g.scores.length;
        const hs = g.scores[g.scores.length - 1];
        const par = g.hole.def.par;
        if (hs && !hs.pickedUp && hs.strokes < par) {
          if (!reduce.current) F.confetti.pop(w, h, hs.strokes <= par - 2 || hs.strokes === 1);
          sfx("fanfare", hs.strokes <= par - 2 || hs.strokes === 1 ? 2 : 1);
        }
      }
      F.confetti.draw(ctx, stop ? 0 : dt);
      if (!L.gl || putting) return;
      // the tee card flies over the hole; a press that ends it early eases back to the game's camera
      let view: View | undefined;
      if (g.phase === "tee-card" && !reduce.current) {
        view = flyoverView(g.hole, g.phaseT / g.teeCardS(), w, h, g.cam);
        F.leave = null;
      } else if (F.last && !F.leave && g.phase === "ready" && g.phaseT < 0.1) {
        F.leave = { from: F.last, t: 0 };
      }
      if (!view && F.leave) {
        F.leave.t += dt;
        const m = Math.min(1, F.leave.t / 0.6);
        view = mixView(F.leave.from, g.cam, m * m * (3 - 2 * m));
        if (m >= 1) F.leave = null;
      }
      F.last = g.phase === "tee-card" ? (view ?? null) : null;
      if (g.replay) view = replayView(g.hole, g.replay, w, h);
      L.gl.render(g, w, h, view);
    },
    {
      interactive: true,
      animateAlways: true,
      maxPixels: 3e6,
      onDown: (p) => playing() && loaded.current?.game?.pointer("down", p.x, p.y),
      onMove: (p) => playing() && loaded.current?.game?.pointer("move", p.x, p.y),
      onUp: (p) => playing() && loaded.current?.game?.pointer("up", p.x, p.y),
      keys: (e, down) => {
        const G = loaded.current?.game;
        if (!G || live.current.screen !== "play") return false;
        if (e.key === "Escape") {
          if (down && G.phase !== "round-card") setPaused((v) => !v);
          return true;
        }
        if (!playing()) return false;
        const handled = G.key(e, down);
        if (down && (e.key === "r" || e.key === "R")) setReading(G.putt.reading);
        return handled;
      },
    },
  );
  /** the game takes the pointer and the keys: a round is on, not paused, not over */
  function playing() {
    const G = loaded.current?.game;
    return !!G && live.current.screen === "play" && !live.current.paused && G.phase !== "round-card";
  }

  const sub = (on: boolean) =>
    `h-8 px-2.5 sm:px-3 rounded-full font-mono text-[11px] uppercase tracking-[0.12em] ${on ? "bg-[#1d5e3f] text-[#f2ead7]" : "text-[#b5b6ab] hover:text-[#f2ead7]"}`;
  const G = loaded.current?.game;
  const day = (() => {
    const [y, m, d] = today().split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  })();
  const menuBtn =
    "group flex w-full items-baseline justify-between gap-4 rounded-xl border border-white/10 bg-[#0d100e]/70 px-4 py-3 text-left text-[#f2ead7] backdrop-blur hover:border-[#8ad9a8]/60 hover:bg-[#0d100e]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8ad9a8] disabled:opacity-50";
  const sound = (
    <button type="button" aria-pressed={!muted} onClick={() => setMuted(!muted)} className={sub(false)}>
      Sound {muted ? "off" : "on"}
    </button>
  );
  const leave = (
    <Link href="/interests" aria-label="Leave the course" className={`${sub(false)} w-8 !px-0 inline-flex items-center justify-center`}>
      ✕
    </Link>
  );

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0d100e] select-none">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-[#0d100e]">
        {screen === "play" && phase !== "round-card" && (
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
        )}
        {screen === "title" && <span className="px-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8ad9a8]">Golf</span>}
        <div className="ml-auto flex items-center gap-1">
          {screen === "play" && (
            <button type="button" aria-label="Pause" aria-pressed={paused} onClick={() => setPaused((v) => !v)} className={`${sub(paused)} w-8 !px-0`}>
              Ⅱ
            </button>
          )}
          {sound}
          <PairChip tone="dark" />
          {leave}
        </div>
      </div>
      <div className="relative flex-1 min-h-0 bg-[#d4e6e6]" data-golf-phase={ready && screen === "play" ? phase : undefined} data-golf-screen={ready ? screen : undefined}>
        <canvas ref={glRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />
        <canvas
          ref={overlay}
          data-autofocus
          role="img"
          aria-label="Golf. Drag down and swing up, or press Space three times; the arrows aim and change club; M opens the map, and a tap or drag on it sets the aim; on the green you putt. Escape pauses."
          className="absolute inset-0 w-full h-full outline-none touch-none"
        />

        {screen === "title" && (
          <div className="absolute inset-0 flex items-end sm:items-center justify-center sm:justify-start p-4 sm:p-10 bg-gradient-to-t from-[#0d100e]/70 via-[#0d100e]/10 to-transparent sm:bg-gradient-to-r">
            <div className="w-full max-w-sm">
              <h1 className="text-[56px] sm:text-[72px] leading-none font-extrabold tracking-tight text-[#f2ead7] drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]">Golf</h1>
              <div className="mt-6 flex flex-col gap-2">
                {shared && (
                  <button type="button" disabled={!ready} onClick={() => start(shared)} className={`${menuBtn} border-[#8ad9a8]/70`}>
                    <span className="text-lg font-bold">Play this round</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#8ad9a8]">{modeName(shared)}</span>
                  </button>
                )}
                {MODES.map((m) => (
                  <button key={m.mode} type="button" disabled={!ready} onClick={() => start(setupFor(m.mode))} className={menuBtn}>
                    <span className="text-lg font-bold">{m.label}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#b5b6ab] group-hover:text-[#8ad9a8]">{m.sub(day)}</span>
                  </button>
                ))}
              </div>
              {!ready && <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]/80">Loading</p>}
            </div>
          </div>
        )}

        {screen === "play" && paused && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d100e]/55 backdrop-blur-[2px] p-4" role="dialog" aria-modal="true" aria-label="Paused">
            <div className="w-full max-w-xs flex flex-col gap-2">
              <p className="mb-2 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-[#8ad9a8]">{setup ? modeName(setup) : ""}</p>
              <button type="button" autoFocus onClick={() => setPaused(false)} className={menuBtn}>
                <span className="text-lg font-bold">Resume</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#b5b6ab]">Esc</span>
              </button>
              <button type="button" onClick={() => setup && start(setup.mode === "daily" ? setup : setupFor(setup.mode, { seed: setup.seed }))} className={menuBtn}>
                <span className="text-lg font-bold">Restart</span>
              </button>
              <button type="button" onClick={toTitle} className={menuBtn}>
                <span className="text-lg font-bold">Change mode</span>
              </button>
            </div>
          </div>
        )}

        {screen === "play" && phase === "round-card" && G?.round && setup && (
          <RoundEnd game={G} setup={setup} onAgain={() => start(setup.mode === "daily" ? setup : setupFor(setup.mode))} onMenu={toTitle} />
        )}

        {remote.linked && screen === "play" && phase !== "putt" && !paused && (
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
