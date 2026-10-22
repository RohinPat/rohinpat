"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvas, type PieceProps } from "./useCanvas";
import { getAudio } from "./audio";
import { Game } from "./ski/game";
import { render } from "./ski/draw";
import { SkiSound } from "./ski/sound";
import { omegaMax } from "./ski/sim";

// Giant slalom. Thirty gates down a groomed piste at golden hour: carve
// through every gate (a missed one costs 1.5 s), tuck on the straights, don't
// ask the edges for more grip than they have, and take the jumps. The course
// is the same every time, so you can chase a medal. The tile preview is an
// autopilot running it silently, scuffing the piste as it goes.
//
// ski/course: the terrain table, gates, trees. ski/sim: the physics (and the
// autopilot). ski/game: phases, camera, snow, tracks. ski/draw + skier +
// scenery: the picture. ski/sound: wind, edge hiss, gates, landings.

export default function Powder({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const G = useRef<Game | null>(null);
  const keys = useRef({ left: false, right: false, tuck: false, keyMode: false, touch: false, warmed: false });
  const [status, setStatus] = useState("");
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
        if (k.keyMode) steer = kb;
        else if (p.inside) {
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
        g.tuckIn = k.tuck || (p.down && !k.touch);
      }
      g.update(dt);
      render(ctx, w, h, g, play);
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      onMove: () => {
        keys.current.keyMode = false;
      },
      onDown: () => {
        drop();
      },
      keys: (e, down) => {
        const k = keys.current;
        const key = e.key;
        if (key === "ArrowLeft" || key === "a" || key === "A") {
          k.left = down;
          if (down) k.keyMode = true;
        } else if (key === "ArrowRight" || key === "d" || key === "D") {
          k.right = down;
          if (down) k.keyMode = true;
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

  // touch drags steer; they don't also tuck (the skier tucks by itself on the straights)
  useEffect(() => {
    const c = ref.current;
    if (!c || !play) return;
    const t = (e: PointerEvent) => {
      keys.current.touch = e.pointerType === "touch" || e.pointerType === "pen";
    };
    c.addEventListener("pointerdown", t);
    return () => c.removeEventListener("pointerdown", t);
  }, [play, ref]);

  if (!play) return <canvas ref={ref} className="absolute inset-0 w-full h-full" />;
  return (
    <>
      <canvas
        ref={ref}
        data-autofocus
        role="img"
        aria-label="Giant slalom. Thirty gates down the hill. Arrow keys or the pointer carve, down arrow or Space tucks, left and right spin in the air. Press Enter to start, R to restart."
        className="absolute inset-0 w-full h-full outline-none touch-none"
      />
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </>
  );
}
