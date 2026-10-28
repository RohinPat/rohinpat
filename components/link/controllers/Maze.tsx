"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAZE_CAL, stickAxes, tiltAxes } from "@/components/offhours/mazeRemote";
import { createTiltFilter } from "@/lib/motion";
import type { MotionSample } from "@/lib/motion";
import { createAxes } from "./axes";
import { ghostButton } from "./Shell";
import type { ControllerProps } from "./types";
import { useMotionSamples } from "./useMotionSamples";
import { buzz } from "@/lib/haptics";

// The maze's controller. Tilt: hold the phone flat, screen up, like a tray with
// a marble on it. Tip the top edge down to walk forward (up to walk back), the
// right edge down to turn right. It re-centres to however you are holding it
// when it opens, and again from the button. Only the tilt filter runs. Touch:
// a thumb joystick on the screen, for a phone without motion sensors (or one
// that said no).
//
// Sends   axis    x  -1..1   turn  (+ = right)
//         axis    y  -1..1   walk  (+ = forward)
//         gesture maze-new   {}                       a new maze
//         gesture maze-sync  {}                       "tell me where the run is" (on mount)
// Hears   gesture maze-state {you, done, secs}        you = the laptop is in You mode; done = escaped

type Mode = "tilt" | "touch";
type RunState = { you: boolean; done: boolean; secs: number };

export default function MazeController({ send, subscribe, motionOk }: ControllerProps) {
  const [mode, setMode] = useState<Mode>(motionOk ? "tilt" : "touch");
  const [run, setRun] = useState<RunState>({ you: false, done: false, secs: 0 });
  const [flat, setFlat] = useState(true);
  const [fed, setFed] = useState(false);

  const sendRef = useRef(send);
  sendRef.current = send;
  const axes = useMemo(() => createAxes((m) => sendRef.current(m), ["x", "y"]), []);
  // what the pad draws: the same -1..1 pair the laptop is sent
  const view = useRef({ x: 0, y: 0 });
  const show = useCallback(
    (x: number, y: number) => {
      view.current.x = x;
      view.current.y = y;
      axes.set("x", x);
      axes.set("y", y);
    },
    [axes],
  );

  // the laptop says whether you are driving and how the run ended
  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture" || m.name !== "maze-state") return;
      setRun({ you: !!m.data?.you, done: !!m.data?.done, secs: Number(m.data?.secs) || 0 });
    });
    send({ type: "gesture", name: "maze-sync", data: {} });
    return off;
  }, [send, subscribe]);

  // leave the laptop's walker standing still when this screen goes away or is backgrounded
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        show(0, 0);
        axes.zero();
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      axes.zero();
      axes.dispose();
    };
  }, [axes, show]);

  // ---- tilt mode: the filter, only while this mode is up ----
  const tiltOn = mode === "tilt" && motionOk;
  const filter = useRef(createTiltFilter({ smoothingS: MAZE_CAL.phoneSmoothingS }));
  useEffect(() => {
    filter.current.reset(); // the pose it opens in (or comes back to) is the middle
    show(0, 0);
    axes.zero();
  }, [tiltOn, axes, show]);
  const flatRef = useRef(true);
  const onSample = useCallback(
    (s: MotionSample) => {
      const st = filter.current.push(s);
      setFed(true);
      if (st.valid !== flatRef.current) {
        flatRef.current = st.valid;
        setFlat(st.valid);
      }
      if (!st.valid) return show(0, 0);
      const a = tiltAxes(st.leanDeg, st.forwardDeg);
      show(a.x, a.y);
    },
    [show],
  );
  const { receiving } = useMotionSamples(tiltOn, onSample);
  const noSensor = mode === "tilt" && motionOk && receiving === false && !fed;

  const recentre = () => {
    filter.current.recalibrate();
    buzz(20);
  };
  const newMaze = () => send({ type: "gesture", name: "maze-new", data: {} });

  const status = noSensor
    ? { head: "No motion data", sub: "This phone isn't sending motion. Use the joystick instead.", warn: true }
    : run.done
      ? { head: `Escaped in ${run.secs}s`, sub: "Nice. Start a new maze to go again.", warn: false }
      : !run.you
        ? { head: "A solver is running", sub: mode === "tilt" ? "Tilt to take over and walk it yourself." : "Push the stick to take over and walk it yourself.", warn: false }
        : mode === "tilt" && !flat
          ? { head: "Lay it flatter", sub: "Hold the phone nearer flat, screen up.", warn: true }
          : { head: "Your move", sub: mode === "tilt" ? "Forward to walk, sideways to turn." : "Up to walk, sideways to turn.", warn: false };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-testid="maze-controller" data-mode={mode} data-you={run.you} data-done={run.done}>
      <h1 className="mt-4 text-[1.55rem] leading-tight font-extrabold text-balance">{mode === "tilt" ? "Tilt it like a tray." : "Push the stick to walk."}</h1>
      <p className="mt-1.5 text-[1.05rem] leading-snug text-[#c9c6b6]">
        {mode === "tilt"
          ? "Hold the phone flat, screen up. Tip the top edge down to walk forward, the side edges to turn."
          : "Up walks, down backs up, sideways turns. Let go and you stop."}
      </p>

      <Pad
        view={view}
        interactive={mode === "touch"}
        onStick={(dx, dy) => {
          const a = stickAxes(dx, dy);
          show(a.x, a.y);
        }}
      />

      <div
        role="status"
        data-testid="maze-status"
        className={`mt-3 rounded-[20px] px-5 py-4 text-center border ${
          status.warn ? "bg-[#d9b44a]/15 border-[#d9b44a]/40" : run.done ? "bg-[var(--mint)] text-[var(--ink)] border-transparent" : "bg-white/10 border-white/15"
        }`}
      >
        <p className="text-[1.5rem] leading-none font-extrabold">{status.head}</p>
        <p className={`mt-1.5 text-[1rem] ${run.done ? "text-[var(--ink)]/80" : "text-[#c9c6b6]"}`}>{status.sub}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" data-testid="maze-recentre" onClick={recentre} disabled={!tiltOn} className={`${ghostButton} !min-h-[56px] disabled:opacity-40`}>
          Reset middle
        </button>
        <button type="button" data-testid="maze-new" onClick={newMaze} className={`${ghostButton} !min-h-[56px]`}>
          New maze
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Control">
        {(["tilt", "touch"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            data-mode-btn={m}
            disabled={m === "tilt" && !motionOk}
            onClick={() => setMode(m)}
            className={`${ghostButton} !min-h-[52px] ${mode === m ? "!bg-[var(--mint)] !text-[var(--ink)] !border-transparent" : ""} disabled:opacity-40`}
          >
            {m === "tilt" ? "Tilt" : "Joystick"}
          </button>
        ))}
      </div>
      {!motionOk && (
        <p className="mt-2 text-[0.95rem] leading-snug text-[#a3a69c]">Motion is off on this phone, so tilting isn&apos;t available. Reload this page and allow motion to turn it on.</p>
      )}
    </div>
  );
}

const PAD = MAZE_CAL.stickRadiusPx * 2 + 56;

/**
 * The level: a ring and a knob. In tilt mode the knob shows where the phone is
 * tipped (it rolls to the low edge, like a marble); in touch mode it is the
 * joystick, and follows the thumb. `view` is the live -1..1 pair, read each frame.
 */
function Pad({ view, interactive, onStick }: { view: React.MutableRefObject<{ x: number; y: number }>; interactive: boolean; onStick: (dx: number, dy: number) => void }) {
  const knob = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = knob.current;
      if (el) {
        const { x, y } = view.current;
        // the knob stays inside the ring: clamp the vector's length to 1
        const d = Math.hypot(x, y);
        const k = d > 1 ? 1 / d : 1;
        el.style.transform = `translate(${x * k * MAZE_CAL.stickRadiusPx}px, ${-y * k * MAZE_CAL.stickRadiusPx}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view]);

  const move = (e: React.PointerEvent) => {
    const r = ring.current!.getBoundingClientRect();
    onStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };
  const end = () => {
    if (drag.current === null) return;
    drag.current = null;
    onStick(0, 0);
  };

  return (
    <div className="mt-4 flex justify-center">
      <div
        ref={ring}
        data-testid="maze-pad"
        aria-hidden="true"
        onPointerDown={(e) => {
          if (!interactive) return;
          drag.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => {
          if (drag.current === e.pointerId) move(e);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onContextMenu={(e) => e.preventDefault()}
        style={{ width: PAD, height: PAD, maxWidth: "100%" }}
        className="relative rounded-full border border-white/20 bg-white/[0.06] touch-none select-none"
      >
        <span className="absolute left-1/2 top-3 -translate-x-1/2 font-mono text-[11px] tracking-[0.16em] text-[#a3a69c]">FWD</span>
        <span className="absolute left-1/2 bottom-3 -translate-x-1/2 font-mono text-[11px] tracking-[0.16em] text-[#a3a69c]">BACK</span>
        <span className="absolute inset-x-[18%] top-1/2 h-px bg-white/15" />
        <span className="absolute inset-y-[18%] left-1/2 w-px bg-white/15" />
        <div
          ref={knob}
          data-testid="maze-knob"
          className="absolute left-1/2 top-1/2 -ml-6 -mt-6 h-12 w-12 rounded-full bg-[var(--mint)] shadow-[0_0_0_6px_rgba(138,217,168,0.18)]"
          style={{ willChange: "transform" }}
        />
      </div>
    </div>
  );
}
