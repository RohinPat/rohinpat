"use client";

import { useEffect, useRef, useState } from "react";
import { useRemote } from "@/lib/link/remote";
import { useCanvas, type PieceProps } from "./useCanvas";
import { CLUBS } from "./golf/flight";
import { newRange, rangeAim, rangeDraw, rangeKey, rangePointer, rangeRemoteSwing, rangeSetClub, rangeSetMode, type Range, type RangeEnv, type RangeMode } from "./golf/range";
import { parseSwing, shotFromSwing } from "./golf/remoteSwing";
import { newPutt, puttDraw, puttKey, puttPointer, puttRead, puttRestart, type Putt, type PuttEnv } from "./golf/green";

// Two ways to play golf. PUTT: nine greens drawn as lit relief; pull back from
// the ball and let go (or aim with the arrows and hold Space), and "Read" pours
// water that runs the way the putt will break. DRIVING RANGE: a behind-the-
// golfer camera, a swing you make with your hand (or three presses of Space),
// real ball flight, a shot-data card and a ten-shot target challenge.
// The preview tile plays itself, alternating the two.

type Kind = "putt" | "range";

export default function Golf({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [kind, setKind] = useState<Kind>("putt");
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

  // A linked phone: its golf-swing plays a shot on the range, its club picker
  // sets the club. The phone is told the club and which half (putt / range) is
  // up so its controller matches. Without a phone this does nothing at all.
  const remote = useRemote(play ? "golf" : null, {
    gesture: (name, data) => {
      if (name === "golf-swing") {
        if (kindRef.current !== "range") return;
        const swing = parseSwing(data);
        if (swing) rangeRemoteSwing(R, shotFromSwing(swing, R.club), tRef.current);
      } else if (name === "golf-club") {
        const i = Math.round(Number(data.index));
        if (Number.isFinite(i) && (R.phase === "ready" || R.phase === "rest")) {
          rangeSetClub(R, i);
          setClub(R.club);
        }
        syncPhone();
      } else if (name === "golf-sync") {
        syncPhone();
      }
    },
  });
  const syncPhone = () => {
    remote.send({ type: "gesture", name: "golf-club", data: { index: R.club } });
    remote.send({ type: "gesture", name: "golf-mode", data: { range: kindRef.current === "range" } });
  };
  const syncRef = useRef(syncPhone);
  syncRef.current = syncPhone;
  useEffect(() => {
    if (remote.linked) syncRef.current();
  }, [remote.linked, club, kind]);

  const ref = useCanvas(
    ({ ctx, w, h, dt, t, p }) => {
      tRef.current = t;
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
      onDown: (p, f) => (kindRef.current === "range" ? rangePointer(R, "down", p.x, p.y, f.w, f.h, f.t, renv.current) : puttPointer(P, "down", p.x, p.y, f.t, penv.current)),
      onMove: (p, f) => (kindRef.current === "range" ? rangePointer(R, "move", p.x, p.y, f.w, f.h, f.t, renv.current) : puttPointer(P, "move", p.x, p.y, f.t, penv.current)),
      onUp: (p, f) => (kindRef.current === "range" ? rangePointer(R, "up", p.x, p.y, f.w, f.h, f.t, renv.current) : puttPointer(P, "up", p.x, p.y, f.t, penv.current)),
      keys: (e, down) => {
        if (kindRef.current === "range") return rangeKey(R, e, down, tRef.current, renv.current);
        const handled = puttKey(P, e, down, tRef.current, penv.current);
        if (down && (e.key === "r" || e.key === "R")) setReading(P.reading);
        return handled;
      },
    },
  );

  const pick = (k: Kind) => {
    setKind(k);
    kindRef.current = k;
    setStatus("");
    if (k === "range" && P.reading) {
      puttRead(P, false);
      setReading(false);
    }
  };
  const chip = (on: boolean) =>
    `h-8 sm:h-9 px-3 sm:px-4 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] border ${on ? "bg-[#f2ead7] text-[#0d100e] border-transparent" : "border-white/15 text-[#f2ead7] hover:bg-white/10"}`;
  const sub = (on: boolean) =>
    `h-8 sm:h-9 px-2 sm:px-3 rounded-full font-mono text-[11px] uppercase tracking-[0.12em] ${on ? "bg-[#1d5e3f] text-[#f2ead7]" : "text-[#b5b6ab] hover:text-[#f2ead7]"}`;

  return (
    <div className="absolute inset-0 flex flex-col bg-[#1f4d2c]">
      {play && (
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 px-3 pt-2 sm:pt-3 pb-2 bg-[#0d100e]">
          <button type="button" aria-pressed={kind === "putt"} onClick={() => pick("putt")} className={chip(kind === "putt")}>
            Putt
          </button>
          <button type="button" aria-pressed={kind === "range"} onClick={() => pick("range")} className={chip(kind === "range")}>
            Driving range
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
              ? "Golf. Putting: drag back from the ball and let go, or use the arrow keys to aim and hold Space; press R to read the green. Driving range: drag down and swing up, or press Space three times; arrows aim and change club."
              : undefined
          }
          className="absolute inset-0 w-full h-full outline-none touch-none"
        />
      </div>
    </div>
  );
}
