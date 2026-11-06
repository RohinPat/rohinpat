"use client";

import { useEffect, useRef, useState } from "react";
import { useRemote } from "@/lib/link/remote";
import { useCanvas, type PieceProps } from "./useCanvas";
import { CLUBS } from "./golf/flight";
import { newRange, rangeAim, rangeDraw, rangeKey, rangePointer, rangeRemoteSwing, rangeSetClub, rangeSetMode, type Range, type RangeEnv, type RangeMode } from "./golf/range";
import { parseSwing, shotFromSwing } from "./golf/remoteSwing";
import { newPutt, puttDraw, puttKey, puttPointer, puttRead, puttRestart, type Putt, type PuttEnv } from "./golf/green";
import type { CourseGame, Phase as PlayPhase } from "./golf/play";
import type { playDraw as PlayDraw } from "./golf/playDraw";

// Three ways to play golf. PLAY is the course: six holes, the same swing as the
// range, the putting view when the ball is on the green, and a map of the hole
// that takes a tap or a drag to aim. It opens first; its code is loaded when
// the dialog opens, so the tile and the rest of the page do not carry it.
// PUTT: nine greens drawn as lit relief; pull back from the ball and let go (or
// aim with the arrows and hold Space), and "Read" pours water that runs the way
// the putt will break. DRIVING RANGE: a behind-the-golfer camera, a swing you
// make with your hand (or three presses of Space), real ball flight, a shot-data
// card and a ten-shot target challenge. Putt and range are practice. The
// preview tile plays itself, alternating putt and range.

type Kind = "putt" | "range" | "play";

export default function Golf({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [kind, setKind] = useState<Kind>("play");
  const [club, setClub] = useState(3);
  const [rmode, setRmode] = useState<RangeMode>("practice");
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<PlayPhase>("tee-card");
  const [mapOpen, setMapOpen] = useState(false);
  const [, setReady] = useState(0);
  const kindRef = useRef<Kind>("putt");
  kindRef.current = play ? kind : kindRef.current;
  const tRef = useRef(0);

  const putt = useRef<Putt | null>(null);
  const range = useRef<Range | null>(null);
  if (!putt.current) putt.current = newPutt();
  if (!range.current) range.current = newRange();
  const P = putt.current, R = range.current;

  // the course: loaded the first time Play is picked
  const course = useRef<{ game: CourseGame; draw: typeof PlayDraw } | null>(null);
  const loading = useRef(false);
  const penv = useRef<PuttEnv>({ play, say: setStatus });
  penv.current.play = play;
  const renv = useRef<RangeEnv>({ play, say: setStatus, club: setClub });
  renv.current.play = play;

  // A linked phone: its golf-swing plays a shot on the range, its club picker
  // sets the club. The phone is told the club and which half (putt / range) is
  // up so its controller matches. Without a phone this does nothing at all.
  const remote = useRemote(play ? "golf" : null, {
    gesture: (name, data) => {
      if (name === "golf-swing") {
        const swing = parseSwing(data);
        if (!swing) return;
        if (kindRef.current === "range") rangeRemoteSwing(R, shotFromSwing(swing, R.club), tRef.current);
        else if (kindRef.current === "play" && course.current) course.current.game.remoteSwing(shotFromSwing(swing, course.current.game.club));
      } else if (name === "golf-club") {
        const i = Math.round(Number(data.index));
        const G = kindRef.current === "play" ? course.current?.game : null;
        if (G) {
          if (Number.isFinite(i) && (G.phase === "ready" || G.phase === "rest")) G.setClub(i);
        } else if (Number.isFinite(i) && (R.phase === "ready" || R.phase === "rest")) {
          rangeSetClub(R, i);
          setClub(R.club);
        }
        syncPhone();
      } else if (name === "golf-aim") {
        if (kindRef.current === "play") course.current?.game.remoteAim(Number(data.dir) || 0);
      } else if (name === "golf-pick") {
        // the phone's Play / Putt / Driving range switch; a phone on an older page only sends range
        pickRef.current(data.mode === "play" || data.mode === "putt" || data.mode === "range" ? data.mode : data.range ? "range" : "putt");
      } else if (name === "golf-sync") {
        syncPhone();
      }
    },
  });
  // the phone swings whenever the laptop is taking a full swing: on the range, and on the course until the ball is on the green
  const swinging = (k: Kind, ph: PlayPhase) => k === "range" || (k === "play" && ph !== "putt");
  const phaseRef = useRef<PlayPhase>("tee-card");
  phaseRef.current = phase;
  const syncPhone = () => {
    const G = kindRef.current === "play" ? course.current?.game : null;
    remote.send({ type: "gesture", name: "golf-club", data: { index: G ? G.club : R.club } });
    remote.send({ type: "gesture", name: "golf-mode", data: { range: swinging(kindRef.current, phaseRef.current), mode: kindRef.current } });
  };
  const linkedRef = useRef(false);
  linkedRef.current = remote.linked;
  const syncRef = useRef(syncPhone);
  syncRef.current = syncPhone;
  useEffect(() => {
    if (remote.linked) syncRef.current();
  }, [remote.linked, club, kind, phase]);

  const ref = useCanvas(
    ({ ctx, w, h, dt, t, p, reduce }) => {
      tRef.current = t;
      penv.current.reduce = reduce;
      if (!play) {
        // the tile alternates: a couple of putts, then a couple of drives
        const k: Kind = t % 30 < 12 ? "putt" : "range";
        if (k !== kindRef.current) {
          kindRef.current = k;
          if (k === "range") R.auto = 0.4;
        }
      }
      if (kindRef.current === "play") {
        if (course.current) {
          course.current.game.linked = linkedRef.current;
          course.current.draw(ctx, course.current.game, w, h, dt, p);
        }
        else {
          ctx.fillStyle = "#0d100e";
          ctx.fillRect(0, 0, w, h);
        }
      } else if (kindRef.current === "range") rangeDraw(ctx, R, w, h, dt, t, renv.current);
      else puttDraw(ctx, P, w, h, dt, t, penv.current, p);
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      onDown: (p, f) => pointer("down", p, f),
      onMove: (p, f) => pointer("move", p, f),
      onUp: (p, f) => pointer("up", p, f),
      keys: (e, down) => {
        if (kindRef.current === "play") {
          const handled = course.current?.game.key(e, down) ?? false;
          if (down && (e.key === "r" || e.key === "R") && course.current) setReading(course.current.game.putt.reading);
          return handled;
        }
        if (kindRef.current === "range") return rangeKey(R, e, down, tRef.current, renv.current);
        const handled = puttKey(P, e, down, tRef.current, penv.current);
        if (down && (e.key === "r" || e.key === "R")) setReading(P.reading);
        return handled;
      },
    },
  );

  const pointer = (kind: "down" | "move" | "up", p: { x: number; y: number }, f: { w: number; h: number; t: number }) => {
    const k = kindRef.current;
    if (k === "play") course.current?.game.pointer(kind, p.x, p.y);
    else if (k === "range") rangePointer(R, kind, p.x, p.y, f.w, f.h, f.t, renv.current);
    else puttPointer(P, kind, p.x, p.y, f.t, penv.current);
  };

  /** load the course the first time it is wanted, and start a game */
  const ensureCourse = () => {
    const have = course.current;
    if (have) {
      setClub(have.game.club);
      setPhase(have.game.phase);
      setMapOpen(have.game.mapOpen);
      return;
    }
    if (loading.current) return;
    loading.current = true;
    Promise.all([import("./golf/play"), import("./golf/playDraw")])
      .then(([mod, draw]) => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const game = new mod.CourseGame({
          seed: 1 + Math.floor(Math.random() * 1e6),
          sound: true,
          reduce,
          say: setStatus,
          onClub: setClub,
          onPhase: setPhase,
          onMap: setMapOpen,
        });
        setClub(game.club);
        setPhase(game.phase);
        course.current = { game, draw: draw.playDraw };
        if (process.env.NEXT_PUBLIC_LINK_MOCK === "1" || new URLSearchParams(location.search).has("linkmock")) (window as unknown as { __golf?: CourseGame }).__golf = game;
        setReady((n) => n + 1);
      })
      .catch(() => {
        loading.current = false;
        setStatus("The course did not load.");
      });
  };
  // the dialog opens on Play
  useEffect(() => {
    if (play && kindRef.current === "play") ensureCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const pick = (k: Kind) => {
    setKind(k);
    kindRef.current = k;
    setStatus("");
    if (k !== "putt" && P.reading) {
      puttRead(P, false);
      setReading(false);
    }
    if (k === "play") ensureCourse();
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const chip = (on: boolean) =>
    `h-8 sm:h-9 px-3 sm:px-4 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] border ${on ? "bg-[#f2ead7] text-[#0d100e] border-transparent" : "border-white/15 text-[#f2ead7] hover:bg-white/10"}`;
  const sub = (on: boolean) =>
    `h-8 sm:h-9 px-2 sm:px-3 rounded-full font-mono text-[11px] uppercase tracking-[0.12em] ${on ? "bg-[#1d5e3f] text-[#f2ead7]" : "text-[#b5b6ab] hover:text-[#f2ead7]"}`;

  return (
    <div className="absolute inset-0 flex flex-col bg-[#1f4d2c]">
      {play && (
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 px-3 pt-2 sm:pt-3 pb-2 bg-[#0d100e]">
          <button type="button" aria-pressed={kind === "play"} onClick={() => pick("play")} className={chip(kind === "play")}>
            Play
          </button>
          <button type="button" aria-pressed={kind === "putt"} onClick={() => pick("putt")} className={chip(kind === "putt")}>
            Putt
          </button>
          <button type="button" aria-pressed={kind === "range"} onClick={() => pick("range")} className={chip(kind === "range")}>
            Driving range
          </button>
          {kind === "play" && phase !== "putt" && (
            <button type="button" aria-pressed={mapOpen} onClick={() => course.current?.game.toggleMap()} className={sub(mapOpen)}>
              Map
            </button>
          )}
          {kind === "putt" && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                aria-pressed={reading}
                onClick={() => {
                  puttRead(P, !P.reading);
                  setReading(P.reading);
                  setStatus(P.reading ? "Reading the green: click or drag to pour water where you want to see the break." : "Back to putting.");
                }}
                className={sub(reading)}
              >
                Read green
              </button>
              <button
                type="button"
                onClick={() => {
                  puttRestart(P);
                  setReading(false);
                  puttRead(P, false);
                  setStatus("New round.");
                }}
                className={sub(false)}
              >
                New round
              </button>
            </div>
          )}
          {kind === "play" && (
            <div className="flex flex-wrap gap-1 ml-auto items-center">
              {phase === "putt" ? (
                <button
                  type="button"
                  aria-pressed={reading}
                  onClick={() => {
                    const G = course.current?.game;
                    if (!G) return;
                    puttRead(G.putt, !G.putt.reading);
                    setReading(G.putt.reading);
                    setStatus(G.putt.reading ? "Reading the green: click or drag to pour water where you want to see the break." : "Back to putting.");
                  }}
                  className={sub(reading)}
                >
                  Read green
                </button>
              ) : (
                <>
                  {CLUBS.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={club === i}
                      aria-label={c.name}
                      onClick={() => course.current?.game.setClub(i)}
                      className={sub(club === i)}
                    >
                      <span className="hidden md:inline">{c.name.replace("Pitching wedge", "PW").replace("Sand wedge", "SW")}</span>
                      <span className="md:hidden">{c.short}</span>
                    </button>
                  ))}
                  <span className="w-px h-5 bg-white/15 mx-1" aria-hidden="true" />
                  <button type="button" aria-label="Aim left" onClick={() => course.current?.game.aim(-0.03)} className={`${sub(false)} w-8 sm:w-9 !px-0`}>
                    ◀
                  </button>
                  <button type="button" aria-label="Aim right" onClick={() => course.current?.game.aim(0.03)} className={`${sub(false)} w-8 sm:w-9 !px-0`}>
                    ▶
                  </button>
                </>
              )}
            </div>
          )}
          {kind === "range" && (
            <>
              <div className="flex gap-1 ml-1">
                {(["practice", "challenge"] as RangeMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={rmode === m}
                    onClick={() => {
                      setRmode(m);
                      rangeSetMode(R, m);
                      setClub(R.club);
                      setStatus(m === "challenge" ? "Target challenge: ten shots. Aim at the highlighted green." : "Practice.");
                    }}
                    className={sub(rmode === m)}
                  >
                    {m === "practice" ? "Practice" : "Challenge"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 ml-auto items-center">
                {CLUBS.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={club === i}
                    aria-label={c.name}
                    onClick={() => {
                      rangeSetClub(R, i);
                      setClub(i);
                    }}
                    className={sub(club === i)}
                  >
                    <span className="hidden md:inline">{c.name.replace("Pitching wedge", "PW").replace("Sand wedge", "SW")}</span>
                    <span className="md:hidden">{c.short}</span>
                  </button>
                ))}
                <span className="w-px h-5 bg-white/15 mx-1" aria-hidden="true" />
                <button type="button" aria-label="Aim left" onClick={() => rangeAim(R, -0.03)} className={`${sub(false)} w-8 sm:w-9 !px-0`}>
                  ◀
                </button>
                <button type="button" aria-label="Aim right" onClick={() => rangeAim(R, 0.03)} className={`${sub(false)} w-8 sm:w-9 !px-0`}>
                  ▶
                </button>
              </div>
            </>
          )}
          <p aria-live="polite" className="sr-only">
            {status}
          </p>
        </div>
      )}
      <div className="relative flex-1 min-h-0" data-golf-phase={play && kind === "play" ? phase : undefined}>
        {remote.linked && swinging(kind, phase) && (
          <p
            data-testid="golf-phone-hint"
            className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-[#0d100e]/80 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]"
          >
            <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-[#8ad9a8] align-middle" />
            Swing your phone
          </p>
        )}
        <canvas
          ref={ref}
          data-autofocus={play || undefined}
          role={play ? "img" : undefined}
          aria-label={
            play
              ? "Golf. Play: six holes. Drag down and swing up, or press Space three times; arrows aim and change club; M opens the map, and a tap or drag on it sets the aim; on the green you putt. Putting practice: drag back from the ball and let go, or use the arrow keys to aim (Alt for fine steps) and hold Space; press R to read the green. Driving range: the same swing, with a target challenge."
              : undefined
          }
          className="absolute inset-0 w-full h-full outline-none touch-none"
        />
      </div>
    </div>
  );
}
