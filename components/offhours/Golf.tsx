"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useRemote } from "@/lib/link/remote";
import { useCanvas, type PieceProps } from "./useCanvas";
import { CLUBS } from "./golf/flight";
import { newRange, rangeAim, rangeDraw, rangeKey, rangePointer, rangeRemoteSwing, rangeSetClub, rangeSetMode, type Range, type RangeEnv, type RangeMode } from "./golf/range";
import { parseSwing, shotFromSwing } from "./golf/remoteSwing";
import { newPutt, puttDraw, puttKey, puttPointer, puttRead, puttRestart, type Putt, type PuttEnv } from "./golf/green";

// Golf practice, and the way to the course. PLAY opens the course on its own page
// (/golf: nine holes in 3D). DRIVING RANGE: a behind-the-golfer camera, a swing
// you make with your hand (or three presses of Space), real ball flight, a
// shot-data card and a ten-shot target challenge. It opens first. PUTT: nine
// greens drawn as lit relief; pull back from the ball and let go (or aim with
// the arrows and hold Space), and "Read" pours water that runs the way the putt
// will break. The preview tile plays itself, alternating putt and range.

type Kind = "putt" | "range";
/** the course, on its own page */
const COURSE = "/golf";

export default function Golf({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("range");
  const [club, setClub] = useState(3);
  const [rmode, setRmode] = useState<RangeMode>("practice");
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState("");
  const kindRef = useRef<Kind>("putt");
  kindRef.current = play ? kind : kindRef.current;
  const tRef = useRef(0);

  const putt = useRef<Putt | null>(null);
  const range = useRef<Range | null>(null);
  if (!putt.current) putt.current = newPutt();
  if (!range.current) range.current = newRange();
  const P = putt.current, R = range.current;

  const penv = useRef<PuttEnv>({ play, say: setStatus });
  penv.current.play = play;
  const renv = useRef<RangeEnv>({ play, say: setStatus, club: setClub });
  renv.current.play = play;
  // a touch screen: the prompts on the canvas leave the keyboard out
  useEffect(() => {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    penv.current.touch = touch;
    renv.current.touch = touch;
  }, []);

  // A linked phone: its golf-swing plays a shot on the range, its club picker
  // sets the club. The phone is told the club and which half (putt / range) is
  // up so its controller matches; its Play takes the laptop to the course, where
  // a round starts at once. Without a phone this does nothing at all.
  const remote = useRemote(play ? "golf" : null, {
    gesture: (name, data) => {
      if (name === "golf-swing") {
        const swing = parseSwing(data);
        if (swing && kindRef.current === "range") rangeRemoteSwing(R, shotFromSwing(swing, R.club), tRef.current);
      } else if (name === "golf-club") {
        const i = Math.round(Number(data.index));
        if (Number.isFinite(i) && (R.phase === "ready" || R.phase === "rest")) {
          rangeSetClub(R, i);
          setClub(R.club);
        }
        syncPhone();
      } else if (name === "golf-pick") {
        // the phone's Play / Putt / Driving range switch; a phone on an older page only sends range
        if (data.mode === "play") router.push(`${COURSE}?start`);
        else pickRef.current(data.mode === "putt" || data.mode === "range" ? data.mode : data.range ? "range" : "putt");
      } else if (name === "golf-sync") {
        syncPhone();
      }
    },
  });
  const syncPhone = () => {
    remote.send({ type: "gesture", name: "golf-club", data: { index: R.club } });
    remote.send({ type: "gesture", name: "golf-mode", data: { range: kindRef.current === "range", mode: kindRef.current } });
  };
  const syncRef = useRef(syncPhone);
  syncRef.current = syncPhone;
  useEffect(() => {
    if (remote.linked) syncRef.current();
  }, [remote.linked, club, kind]);

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
      if (kindRef.current === "range") rangeDraw(ctx, R, w, h, dt, t, renv.current);
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
        if (kindRef.current === "range") return rangeKey(R, e, down, tRef.current, renv.current);
        const handled = puttKey(P, e, down, tRef.current, penv.current);
        if (down && (e.key === "r" || e.key === "R")) setReading(P.reading);
        return handled;
      },
    },
  );

  const pointer = (kind: "down" | "move" | "up", p: { x: number; y: number }, f: { w: number; h: number; t: number }) => {
    if (kindRef.current === "range") rangePointer(R, kind, p.x, p.y, f.w, f.h, f.t, renv.current);
    else puttPointer(P, kind, p.x, p.y, f.t, penv.current);
  };

  const pick = (k: Kind) => {
    setKind(k);
    kindRef.current = k;
    setStatus("");
    if (k !== "putt" && P.reading) {
      puttRead(P, false);
      setReading(false);
    }
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const chip = (on: boolean) =>
    `h-8 sm:h-9 [@media(max-height:500px)]:!h-7 px-3 sm:px-4 [@media(max-height:500px)]:!px-3 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] border ${on ? "bg-[#f2ead7] text-[#0d100e] border-transparent" : "border-white/15 text-[#f2ead7] hover:bg-white/10"}`;
  const sub = (on: boolean) =>
    `h-8 sm:h-9 [@media(max-height:500px)]:!h-7 px-2 sm:px-3 [@media(max-height:500px)]:!px-2 rounded-full font-mono text-[11px] uppercase tracking-[0.12em] ${on ? "bg-[#1d5e3f] text-[#f2ead7]" : "text-[#b5b6ab] hover:text-[#f2ead7]"}`;

  return (
    <div className="absolute inset-0 flex flex-col bg-[#1f4d2c]">
      {play && (
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 px-3 pt-2 sm:pt-3 pb-2 [@media(max-height:500px)]:!py-1 bg-[#0d100e]">
          {/* the course is a page of its own */}
          <Link href={COURSE} className={`${chip(false)} inline-flex items-center gap-1.5`}>
            Play
            <span aria-hidden="true">→</span>
          </Link>
          <button type="button" aria-pressed={kind === "putt"} onClick={() => pick("putt")} className={chip(kind === "putt")}>
            Putt
          </button>
          <button type="button" aria-pressed={kind === "range"} onClick={() => pick("range")} className={chip(kind === "range")}>
            {/* a phone on its side: "Range", so the chips and the clubs keep to one row */}
            <span className="[@media(max-height:500px)]:hidden">Driving </span>range
          </button>
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
                    <span className="hidden md:inline [@media(max-height:500px)]:!hidden">{c.name.replace("Pitching wedge", "PW").replace("Sand wedge", "SW")}</span>
                    <span className="md:hidden [@media(max-height:500px)]:!inline">{c.short}</span>
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
      <div className="relative flex-1 min-h-0">
        {remote.linked && kind === "range" && (
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
              ? "Golf practice. Driving range: drag down and swing up, or press Space three times; the arrows aim and change club; a target challenge of ten shots. Putting: drag back from the ball and let go, or use the arrow keys to aim (Alt for fine steps) and hold Space; press R to read the green."
              : undefined
          }
          className="absolute inset-0 w-full h-full outline-none touch-none"
        />
      </div>
    </div>
  );
}
