"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvas } from "../useCanvas";
import { ENGINE_CAL } from "../engineRemote";
import { buildAssets, type Assets } from "../night/assets";
import { drawScene } from "../night/draw";
import type { Ghost } from "../night/ghost";
import { bestText, chartValue } from "./chart";
import { newGovernor, stepGovernor } from "./governor";
import { drawLearnHud, type LearnHud } from "./hud";
import { openLink, type Link } from "./link";
import { Playback } from "./replay";
import type { Champion, GenStat, Res } from "./session";

// Learn: 24 cars with random nets learn the canyon road by neuroevolution while
// you watch. The generations are driven in a worker (learn.worker.ts); this file
// asks for them, plays them back on the Night run's own renderer, and draws the
// dash. In Watch a generation plays at real speed, one ahead of what is on
// screen. Skip ahead lets the worker run flat out and replays the best car so
// far. Nothing is stored: a new visit starts from random again.

/** generations asked of the worker at a time while skipping ahead */
const SKIP_BATCH = 10;

type Gen = { stat: GenStat; champion: Champion; cars: Ghost[]; fresh: boolean[] };

/** one learning session: its link, what it has told us, and what is queued to play */
type Sess = {
  link: Link;
  ready: boolean;
  capS: number;
  length: number;
  /** the chart: the best and the mean of every generation so far, 0..1 */
  best: number[];
  mean: number[];
  champion: Champion | null;
  /** generations driven in full, waiting to play, the one on screen, and the last one that was */
  queue: Gen[];
  playing: Gen | null;
  shown: Gen | null;
  /** traced generations asked for and not yet answered, and how many of the answers to throw away (asked for before Skip ahead went on) */
  traced: number;
  drop: number;
  /** generations asked for in skip mode and not yet answered */
  skipLeft: number;
  /** the best car so far as a ghost (for the replay and for racing it), the newest not yet played, and whether one is being asked for */
  raceGhost: Ghost | null;
  pending: Ghost | null;
  asking: boolean;
  dirty: boolean;
  /** the visit's first finisher has been announced */
  told: boolean;
};

function openSession(seed: number, local: boolean, onTell: (s: string) => void): Sess {
  const link = openLink(local);
  const s: Sess = {
    link,
    ready: false,
    capS: 1,
    length: 1,
    best: [],
    mean: [],
    champion: null,
    queue: [],
    playing: null,
    shown: null,
    traced: 0,
    drop: 0,
    skipLeft: 0,
    raceGhost: null,
    pending: null,
    asking: false,
    dirty: false,
    told: false,
  };
  const ask = () => {
    if (s.asking) s.dirty = true;
    else {
      s.asking = true;
      link.post({ type: "best" });
    }
  };
  link.onmessage = (res: Res) => {
    if (res.type === "ready") {
      s.capS = res.capS;
      s.length = res.length;
      s.ready = true;
    } else if (res.type === "gen") {
      if (res.cars) {
        s.traced--;
        if (s.drop > 0) s.drop--;
        else s.queue.push({ stat: res.stat, champion: res.champion, cars: res.cars, fresh: res.fresh ?? [] });
      } else s.skipLeft = Math.max(0, s.skipLeft - 1);
      // the chart wants one point per generation, in order
      if (s.best.length === res.stat.gen - 1) {
        s.best.push(chartValue(res.stat.best, s.length, s.capS));
        s.mean.push(chartValue(res.stat.mean, s.length, s.capS));
      }
      s.champion = res.champion;
      if (res.improved) ask();
    } else if (res.type === "best") {
      s.asking = false;
      if (res.ghost) {
        s.pending = res.ghost;
        if (res.ghost.finished) {
          s.raceGhost = res.ghost;
          if (!s.told) {
            s.told = true;
            onTell("A car has finished the road.");
          }
        }
      }
      if (s.dirty) {
        s.dirty = false;
        ask();
      }
    }
  };
  link.post({ type: "start", seed });
  return s;
}

/** keep the worker busy with what the mode wants, and no more */
function feed(s: Sess, skip: boolean) {
  if (!s.ready) return;
  if (skip) {
    if (s.skipLeft <= 0) {
      s.skipLeft = SKIP_BATCH;
      s.link.post({ type: "step", gens: SKIP_BATCH });
    }
  } else if (s.queue.length + s.traced < 1) {
    s.traced++;
    s.link.post({ type: "step", gens: 1, trace: true });
  }
}

function seedOf(): number {
  const q = new URLSearchParams(location.search).get("learnseed");
  const n = q === null ? NaN : Number(q);
  return Number.isFinite(n) ? n >>> 0 : Math.floor(Math.random() * 2 ** 31);
}

export default function Learn({ paused, onRace }: { paused?: boolean; onRace: (ghost: Ghost) => void }) {
  const sess = useRef<Sess | null>(null);
  const pbRef = useRef<Playback | null>(null);
  const assetsRef = useRef<Assets | null>(null);
  const gov = useRef(newGovernor());
  const skipRef = useRef(false);
  const lastData = useRef(0);
  const raceShown = useRef(false);
  const hud = useRef<LearnHud>({ gen: 1, best: "BEST -", sub: "", bestSeries: [], meanSeries: [], n: 0, intro: 1 });

  const [skip, setSkip] = useState(false);
  const [canRace, setCanRace] = useState(false);
  const [status, setStatus] = useState("");

  const begin = () => {
    sess.current?.link.close();
    pbRef.current = null;
    raceShown.current = false;
    setCanRace(false);
    sess.current = openSession(seedOf(), new URLSearchParams(location.search).has("learnlocal"), setStatus);
  };

  useEffect(() => {
    begin();
    return () => {
      sess.current?.link.close();
      sess.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSkip = () => {
    const next = !skipRef.current;
    skipRef.current = next;
    setSkip(next);
    setStatus(next ? "Skipping ahead." : "Watching.");
    const s = sess.current;
    if (!s) return;
    // what was queued to watch is stale: the worker has gone on, or is about to
    s.queue.length = 0;
    s.playing = null;
    s.shown = null;
    if (next) s.drop = s.traced;
  };

  const ref = useCanvas(
    ({ ctx, w, h, t, dt, reduce }) => {
      let a = assetsRef.current;
      if (!a || a.w !== w || a.h !== h || a.theme !== "canyon" || a.dpr !== Math.max(1, ctx.getTransform().a)) a = assetsRef.current = buildAssets(ctx, w, h, "canyon");
      const q = gov.current;
      stepGovernor(q, dt);
      const pb = (pbRef.current ??= new Playback(reduce));
      const s = sess.current;
      const skipping = skipRef.current;
      const H = hud.current;
      if (s) {
        s.link.pump(skipping ? 12 : 5);
        feed(s, skipping);
        if (!skipping) {
          if (!s.playing && s.queue.length) {
            s.playing = s.shown = s.queue.shift() as Gen;
            pb.set(s.playing.cars, 0, s.playing.fresh);
          }
          pb.update(dt);
          if (s.playing && pb.over) s.playing = null;
        } else {
          // the best so far on a loop; a newer one takes over at the end of the lap, or ten seconds in (a generation left over from Watch gives way at once)
          if (s.pending && (pb.cars.length !== 1 || pb.over || pb.t > 10)) {
            pb.set([s.pending], pb.over ? 0 : pb.t);
            s.pending = null;
          }
          pb.update(dt);
          if (pb.over) pb.set(pb.cars);
        }

        // the dash
        const shown = skipping ? null : s.shown;
        const done = skipping ? s.best.length : (shown?.stat.gen ?? 0);
        H.gen = skipping ? done : done || 1;
        H.best = bestText(skipping ? s.champion : (shown?.champion ?? null));
        H.n = done;
        H.bestSeries = s.best;
        H.meanSeries = s.mean;
        H.sub = skipping ? "SKIPPING AHEAD" : s.playing ? `WATCHING · ${pb.driving} OF ${pb.size} DRIVING` : "WATCHING";
        const finished = (skipping ? s.champion : shown?.champion)?.finished === true && s.raceGhost !== null;
        if (finished !== raceShown.current) {
          raceShown.current = finished;
          setCanRace(finished);
        }
        if (t - lastData.current > 0.2) {
          lastData.current = t;
          const el = ref.current;
          if (el) {
            el.dataset.gen = String(done);
            el.dataset.mode = skipping ? "skip" : "watch";
            el.dataset.finished = String(finished);
            el.dataset.link = s.link.kind;
            el.dataset.dist = String(Math.round(pb.scene.car.s));
            el.dataset.alive = String(pb.driving);
            el.dataset.quality = String(q.level);
          }
        }
      } else pb.update(dt);
      H.intro = t < 6 ? 1 : Math.max(0, 1 - (t - 6) / 1.5);

      drawScene(ctx, a, pb.scene, Math.min(q.level, 2), q.level);
      drawLearnHud(ctx, w, h, H);
    },
    {
      interactive: true,
      paused,
      animateAlways: true,
      maxPixels: ENGINE_CAL.cam.maxPixels,
      keys: (e, down) => {
        if (!down || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === "s") toggleSkip();
        else if (key === "r") begin();
        else return false;
        return true;
      },
    },
  );

  const race = () => {
    const g = sess.current?.raceGhost;
    if (g) onRace(g);
  };

  const btn = "h-8 rounded-full border border-white/15 px-3.5 text-[#f2ead7] hover:bg-white/10";
  return (
    <>
      <canvas
        ref={ref}
        data-testid="learn-canvas"
        role="img"
        aria-label="Learn: 24 cars with random controls learn to drive a canyon road, a generation at a time. S skips ahead, R starts over."
        className="absolute inset-0 w-full h-full outline-none touch-none"
      />
      <div className="absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]">
        <button type="button" aria-pressed={skip} data-testid="learn-skip" onClick={toggleSkip} className={`${btn} ${skip ? "!bg-[var(--paper)] !text-[var(--ink)]" : "bg-[#0d100e]/70"}`}>
          Skip ahead
        </button>
        <button type="button" data-testid="learn-restart" onClick={begin} className={`${btn} bg-[#0d100e]/70`}>
          Start over
        </button>
        {canRace && (
          <button type="button" data-testid="learn-race" onClick={race} className="h-8 rounded-full bg-[var(--mint)] px-4 text-[var(--ink)]">
            Race it
          </button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </>
  );
}
