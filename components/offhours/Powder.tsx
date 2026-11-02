"use client";

import { useEffect, useRef, useState } from "react";
import { useRemote } from "@/lib/link/remote";
import { useCanvas, type PieceProps } from "./useCanvas";
import { getAudio } from "./audio";
import { Game } from "./ski/game";
import { render } from "./ski/draw";
import { SkiSound } from "./ski/sound";
import { omegaMax } from "./ski/sim";
import { POWDER_CAL } from "./ski/remoteSteer";
import { createAxisSmoother, hysteresis, shape } from "./remoteAxis";

// Giant slalom. Thirty gates down a groomed piste at golden hour: carve
// through every gate (a missed one costs 1.5 s), tuck on the straights, don't
// ask the edges for more grip than they have, and take the jumps. The course
// is the same every time, so you can chase a medal. The tile preview is an
// autopilot running it silently, scuffing the piste as it goes.
//
// ski/course: the terrain table, gates, trees. ski/sim: the physics (and the
// autopilot). ski/game: phases, camera, snow, tracks. ski/draw + skier +
// scenery: the picture. ski/sound: wind, edge hiss, gates, landings.
//
// A linked phone steers too (ski/remoteSteer.ts): turn it like handlebars to
// carve, lean it forward or hold its button to tuck, and its button drops in.
// Whichever of keys, pointer and phone moved last is the one steering.

export default function Powder({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const G = useRef<Game | null>(null);
  const keys = useRef({
    left: false, right: false, tuck: false, keyMode: false, touch: false, warmed: false, phone: false, phoneTuck: false,
    // a second finger held down tucks; the press that starts a run doesn't
    touchTuck: false, noTuck: false,
    // the pointer, and where it was when a key or the phone last steered, so jitter doesn't take the steering back
    px: 0, py: 0, ax: 0, ay: 0, keyAt: 0,
  });
  const steerPad = useRef(createAxisSmoother(POWDER_CAL.smoothingS));
  const tuckPad = useRef(createAxisSmoother(POWDER_CAL.smoothingS / 2));
  const told = useRef("");
  const [status, setStatus] = useState("");
  const [again, setAgain] = useState(false); // touch: the restart chip shows after a crash and on the result card
  const againRef = useRef(false);
  const statusRef = useRef(setStatus);
  statusRef.current = setStatus;

  const game = () => {
    if (!G.current) {
      const g = new Game(!play);
      if (play) g.say = (m) => statusRef.current(m);
      G.current = g;
    }
    return G.current;
  };

  const ensureAudio = () => {
    const g = game();
    if (!play || g.sound) return;
    const au = getAudio();
    if (au) g.sound = new SkiSound(au);
  };

  useEffect(() => {
    // with the mock link (tests, local work) a page can read the game and the input
    if (play && (process.env.NEXT_PUBLIC_LINK_MOCK === "1" || new URLSearchParams(location.search).has("linkmock")))
      (window as unknown as { __powder?: unknown }).__powder = {
        get game() {
          return G.current;
        },
        get keys() {
          return keys.current;
        },
      };
  }, [play]);

  // sound follows the run; it stops when you pause, switch tabs or leave
  useEffect(() => {
    if (paused) G.current?.silence();
  }, [paused]);
  useEffect(() => {
    const hide = () => document.hidden && G.current?.silence();
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      G.current?.sound?.dispose();
      if (G.current) G.current.sound = null;
    };
  }, []);

  const drop = () => {
    const g = game();
    ensureAudio();
    if (g.phase === "ready" || (g.phase === "result" && g.phaseT > 0.5)) g.begin();
  };

  // A linked phone: its steer / tuck axes (blended below, last input wins), its
  // start button, and a sync request. It is told the phase and the finishing time.
  const remote = useRemote(play ? "powder" : null, {
    axis: (name, v) => {
      const k = keys.current;
      if (name === "steer") {
        steerPad.current.set(v);
        k.phone = true;
        k.ax = k.px;
        k.ay = k.py;
      } else if (name === "tuck") tuckPad.current.set(v);
    },
    gesture: (name) => {
      if (name === "powder-start") {
        const g = game();
        ensureAudio();
        // the ready and result screens: Enter; mid-run: R (restart). Not during the countdown.
        if (g.phase === "count" || (g.phase === "result" && g.phaseT <= 0.5)) return;
        g.begin();
      } else if (name === "powder-sync") told.current = "";
    },
  });
  useEffect(() => {
    told.current = "";
    if (!remote.linked) {
      keys.current.phone = false;
      keys.current.phoneTuck = false;
      steerPad.current.reset();
      tuckPad.current.reset();
    }
  }, [remote.linked]);

  const ref = useCanvas(
    ({ ctx, w, h, dt, p, reduce }) => {
      const g = game();
      const k = keys.current;
      if (!play && reduce && !k.warmed) {
        // reduced motion: a still frame, but caught mid-run
        k.warmed = true;
        for (let i = 0; i < 14 * 30; i++) g.update(1 / 30);
      }
      if (play) {
        let steer = 0;
        const kb = (k.right ? 1 : 0) - (k.left ? 1 : 0);
        const phoneSteer = steerPad.current.update(dt);
        k.phoneTuck = hysteresis(k.phoneTuck, tuckPad.current.update(dt), POWDER_CAL.tuckOn, POWDER_CAL.tuckOff);
        if (k.phone) steer = shape(phoneSteer, POWDER_CAL.deadZone, POWDER_CAL.curve);
        else if (k.keyMode) steer = kb;
        else if (!p.inside) {
          // the pointer has left: the skis ease back toward the fall line
          const run = g.run;
          if (run.grounded) steer = Math.abs(run.hd) < 0.02 ? 0 : Math.max(-1, Math.min(1, (-run.hd * 2.4) / (omegaMax(run.v) * (1 - 0.35 * run.tuck))));
        } else {
          const run = g.run;
          const raw = (p.x - g.skierSX) / (w * 0.2);
          if (!run.grounded) steer = Math.abs(raw) < 0.05 ? 0 : Math.max(-1, Math.min(1, raw));
          else {
            // go where you point: the skier aims its skis at the pointer
            const want = Math.atan2((p.x - g.skierSX) * g.mpp, 9);
            const err = want - run.hd;
            steer = Math.abs(err) < 0.02 ? 0 : Math.max(-1, Math.min(1, (err * 2.4) / (omegaMax(run.v) * (1 - 0.35 * run.tuck))));
          }
        }
        g.steerIn = steer;
        if (!p.down) k.noTuck = false;
        g.tuckIn = k.tuck || k.phoneTuck || k.touchTuck || (p.down && !k.touch && !k.noTuck);
        const wantAgain = k.touch && (g.phase === "result" || g.run.crash > 0);
        if (wantAgain !== againRef.current) {
          againRef.current = wantAgain;
          setAgain(wantAgain);
        }
        if (remote.linked) {
          const key = g.phase === "result" && g.result ? `result|${g.result.total.toFixed(1)}|${g.result.medal}` : g.phase === "finish" ? "result" : g.phase;
          if (key !== told.current) {
            told.current = key;
            const r = g.phase === "result" ? g.result : null;
            remote.send({ type: "gesture", name: "powder-state", data: { phase: g.phase === "finish" ? "result" : g.phase, total: r ? Math.round(r.total * 10) / 10 : 0, medal: r ? r.medal : 0 } });
          }
        }
      }
      g.update(dt);
      render(ctx, w, h, g, play);
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      onMove: (p) => {
        const k = keys.current;
        k.px = p.x;
        k.py = p.y;
        // keys hold the steering until they have been quiet for 300 ms, and a pointer that only jitters doesn't take it
        if (k.keyMode && (k.left || k.right || performance.now() - k.keyAt < 300)) return;
        if (Math.hypot(p.x - k.ax, p.y - k.ay) < 6) return;
        k.keyMode = false;
        k.phone = false;
      },
      onDown: () => {
        const g = game();
        if (g.phase === "ready" || g.phase === "result") keys.current.noTuck = true;
        drop();
      },
      keys: (e, down) => {
        const k = keys.current;
        const key = e.key;
        if (key === "ArrowLeft" || key === "a" || key === "A" || key === "ArrowRight" || key === "d" || key === "D") {
          k.keyAt = performance.now();
          k.ax = k.px;
          k.ay = k.py;
          // a steer at the gate drops in: it's the first key most people try
          if (down && !e.repeat && game().phase === "ready") drop();
        }
        if (key === "ArrowLeft" || key === "a" || key === "A") {
          k.left = down;
          if (down) {
            k.keyMode = true;
            k.phone = false;
          }
        } else if (key === "ArrowRight" || key === "d" || key === "D") {
          k.right = down;
          if (down) {
            k.keyMode = true;
            k.phone = false;
          }
        } else if (key === "ArrowDown" || key === "s" || key === "S") {
          k.tuck = down;
        } else if (key === "ArrowUp") {
          // nothing: keeps the arrow keys from switching to pointer steering
        } else if (key === " ") {
          k.tuck = down;
          if (down && !e.repeat) drop();
        } else if (key === "Enter") {
          if (down && !e.repeat) drop();
        } else if ((key === "r" || key === "R") && down) {
          const g = game();
          ensureAudio();
          if (g.phase !== "ready" && g.phase !== "count") g.begin();
        } else return false;
        if (down) ensureAudio();
        return true;
      },
    },
  );

  // One finger steers and doesn't also tuck (the skier tucks by itself on the straights).
  // A second finger held down tucks. It never steers: its events are stopped before the
  // shared pointer handling sees them, so the first finger keeps the pointer.
  useEffect(() => {
    const c = ref.current;
    if (!c || !play) return;
    const fingers = new Set<number>();
    const touchy = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
    const down = (e: PointerEvent) => {
      const k = keys.current;
      k.touch = touchy(e);
      if (!k.touch || e.isPrimary) return;
      fingers.add(e.pointerId);
      k.touchTuck = true;
      e.stopImmediatePropagation();
    };
    const move = (e: PointerEvent) => {
      if (touchy(e) && !e.isPrimary) e.stopImmediatePropagation();
    };
    const up = (e: PointerEvent) => {
      if (!touchy(e) || e.isPrimary) return;
      fingers.delete(e.pointerId);
      keys.current.touchTuck = fingers.size > 0;
      e.stopImmediatePropagation();
    };
    const opts = { capture: true } as const;
    c.addEventListener("pointerdown", down, opts);
    c.addEventListener("pointermove", move, opts);
    c.addEventListener("pointerup", up, opts);
    c.addEventListener("pointercancel", up, opts);
    return () => {
      c.removeEventListener("pointerdown", down, opts);
      c.removeEventListener("pointermove", move, opts);
      c.removeEventListener("pointerup", up, opts);
      c.removeEventListener("pointercancel", up, opts);
    };
  }, [play, ref]);

  const restart = () => {
    const g = game();
    ensureAudio();
    if (g.phase !== "count" && !(g.phase === "result" && g.phaseT <= 0.5)) g.begin();
    ref.current?.focus();
  };

  if (!play) return <canvas ref={ref} className="absolute inset-0 w-full h-full" />;
  return (
    <>
      {remote.linked && (
        <p
          data-testid="powder-phone-hint"
          className="pointer-events-none absolute left-3 bottom-3 z-10 rounded-full bg-[#0d100e]/80 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]"
        >
          <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-[#8ad9a8] align-middle" />
          Steer with your phone
        </p>
      )}
      <canvas
        ref={ref}
        data-autofocus
        role="img"
        aria-label="Giant slalom. Thirty gates down the hill. Arrow keys or the pointer carve, down arrow or Space tucks, left and right spin in the air. Press Enter to start, R to restart."
        className="absolute inset-0 w-full h-full outline-none touch-none"
      />
      {again && (
        <button
          type="button"
          onClick={restart}
          data-testid="powder-restart"
          className="absolute right-3 bottom-3 z-10 min-h-[44px] rounded-full bg-[#0d100e]/80 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8ad9a8]"
        >
          Restart
        </button>
      )}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </>
  );
}
