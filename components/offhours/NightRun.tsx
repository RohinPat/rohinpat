"use client";

import { useEffect, useRef, useState } from "react";
import type { Remote, RemoteHandlers } from "@/lib/link/remote";
import { useCanvas, type PieceProps } from "./useCanvas";
import { getAudio } from "./audio";
import { ENGINE_CAL, nightStateData, parseHandbrakeMs, parseShift, type NightInput } from "./engineRemote";
import { buildAssets, type Assets } from "./night/assets";
import { Attract } from "./night/attract";
import { drawScene } from "./night/draw";
import { NightGame, type GameEvent } from "./night/game";
import { drawAttractHud, drawHud, grouped, resultBottom, type HudOptions } from "./night/hud";
import { keySteerFeel, newKeyAxes, newPhone, noSources, resolveInput, setPhoneAxis, smoothPhone, stepKeyPedal, stepKeys, stepKeySteer, type Sources } from "./night/nightInput";
import { adviceFor } from "./night/advice";
import { MEDALS } from "./night/medals";
import { NightSound } from "./night/sound";

// Night run: a canyon road at night that you drift through. A pseudo-3D road
// (night/road.ts, draw.ts) on a 2D canvas, with a car that really slides
// (night/car.ts: a single-track model with saturating tyres, on the shared
// engine and gearbox) and a score for it: slide to earn, straighten out to bank,
// hit the rail and lose what you hadn't (night/score.ts). Eight checkpoints
// extend the clock. A ghost of the target driver is always out ahead, and your
// best run of this visit races you the next time (in memory only).
//
// The tile is an attract mode: the target driver, replayed, silent, paused when
// off screen. In play it is keys (arrows or WASD, Space, Shift is the handbrake,
// E and Q change gear by hand), touch pads, or a linked phone held like a
// wheel (engineRemote.ts and components/link/controllers/EngineNight.tsx).
// Engine.tsx owns the phone link and hands the phone's axes and gestures down.

export type NightProps = PieceProps & {
  remote: Remote;
  bus: React.MutableRefObject<RemoteHandlers>;
};

const C = ENGINE_CAL;
/** the touch pads' height with their padding, px: the dash lifts by this much */
const PAD_LIFT = 112;

type Held = { left: boolean; right: boolean; gas: boolean; space: boolean; brake: boolean; hand: boolean };
type Pads = { left: boolean; right: boolean; gas: boolean; brake: boolean; hand: boolean; steer: number };

export default function NightRun({ mode, paused, remote, bus }: NightProps) {
  const play = mode === "play";
  const gameRef = useRef<NightGame | null>(null);
  const attractRef = useRef<Attract | null>(null);
  const assetsRef = useRef<Assets | null>(null);
  const soundRef = useRef<NightSound | null>(null);
  const held = useRef<Held>({ left: false, right: false, gas: false, space: false, brake: false, hand: false });
  const pads = useRef<Pads>({ left: false, right: false, gas: false, brake: false, hand: false, steer: 0 });
  const keyAxes = useRef(newKeyAxes());
  const padAxes = useRef({ gas: 0, brake: 0 });
  const phone = useRef(newPhone());
  const phoneSm = useRef({ steer: 0, gas: 0, brake: 0 });
  const src = useRef<Sources>(noSources());
  const inp = useRef<NightInput>({ steer: 0, throttle: 0, brake: 0, hand: 0 });
  const gov = useRef({ level: 0, ema: 16.7, slowFor: 0, fastFor: 0 });
  const told = useRef({ at: -Infinity, key: "", cpN: -1, hitN: -1, phase: "" });
  const lastPhase = useRef("ready");
  const linkRef = useRef(remote);
  linkRef.current = remote;
  const touchRef = useRef(false);
  const lastAudioTry = useRef(0);
  const lastData = useRef(0);
  const mineRef = useRef<RemoteHandlers | null>(null);
  const againRef = useRef<HTMLButtonElement>(null);

  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<string>("ready");
  const [auto, setAuto] = useState(true);
  const [touch, setTouch] = useState(false);

  const game = () => {
    if (!gameRef.current) {
      const g = new NightGame(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      g.onEvent = (e) => onEvent(e);
      gameRef.current = g;
      // with the mock link (tests, local work) a page can reach the game directly
      if (process.env.NEXT_PUBLIC_LINK_MOCK === "1" || new URLSearchParams(location.search).has("linkmock")) (window as unknown as { __night?: NightGame }).__night = g;
    }
    return gameRef.current;
  };

  const ensureAudio = () => {
    if (!play || soundRef.current) return;
    const au = getAudio();
    if (au) soundRef.current = new NightSound(au);
  };

  // sound stops when the tab is hidden or the piece is paused, and goes when it leaves
  useEffect(() => {
    if (paused) soundRef.current?.silence();
  }, [paused]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) soundRef.current?.silence();
      // a key held when the tab went away never sees its keyup
      Object.assign(held.current, { left: false, right: false, gas: false, space: false, brake: false, hand: false });
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", hide);
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  function onEvent(e: GameEvent) {
    const s = soundRef.current;
    switch (e.kind) {
      case "count":
        s?.count(false);
        break;
      case "go":
        s?.count(true);
        s?.launch(Math.max(0, Math.min(1, (e.rpm - 2000) / 3500)));
        setStatus("Go.");
        break;
      case "checkpoint":
        s?.chime(e.n === e.of);
        setStatus(
          e.n === e.of
            ? `Finish line. ${Math.round(e.timeLeft)} seconds left on the clock.`
            : `Checkpoint ${e.n} of ${e.of}. ${e.bonusS} seconds added, ${Math.round(e.timeLeft)} on the clock.`,
        );
        tellPhone(true);
        break;
      case "hit":
        s?.hit(e.speed);
        tellPhone(true);
        break;
      case "spin":
        s?.spin();
        tellPhone(true);
        break;
      case "bank":
        s?.bank(e.combo);
        break;
      case "chain":
        s?.chain(e.combo);
        break;
      case "shift":
        s?.pop(e.hard);
        break;
      case "backfire":
        s?.crackle();
        break;
      case "medal":
        s?.medal(e.n);
        setStatus(`Medal: ${MEDALS[e.n - 1].name.toLowerCase()}.`);
        break;
      case "end": {
        const r = e.result;
        setStatus(
          `${r.finished ? "You made it out of the canyon." : "Out of time."} Distance ${r.miles.toFixed(2)} miles. Best drift ${grouped(r.bestDrift)}. ${r.rails === 0 ? "No rail hits" : `${r.rails} rail hit${r.rails > 1 ? "s" : ""}, ${Math.round(r.railS)} seconds`}. ${r.cleanLegs} clean legs of ${r.checkpoints}. ${adviceFor(r, touchRef.current).toLowerCase()}. Total score ${grouped(r.score)}.${r.medals > 0 ? ` ${MEDALS[r.medals - 1].name.toLowerCase()} medal.` : ""}${r.newBest ? " A new best run: it will race you next time." : ""}`,
        );
        s?.silence();
        tellPhone(true);
        break;
      }
    }
  }

  // ---- the phone: its axes (smoothed each frame), its gestures, and what it is told
  const startOrAgain = () => {
    const g = game();
    ensureAudio();
    if (g.phase === "ready" || g.phase === "done") {
      g.start();
      if ((g.phase as string) === "count") setStatus("Race starting. Three, two, one.");
    }
  };
  const mine: RemoteHandlers = {
    axis: (name, v) => {
      if (!play) return;
      if (setPhoneAxis(phone.current, name, v) && name === "gas" && v > 0.5 && gameRef.current?.phase === "ready") startOrAgain();
    },
    gesture: (name, data) => {
      if (!play) return;
      if (name === "night-handbrake") phone.current.handUntil = performance.now() + parseHandbrakeMs(data);
      else if (name === "night-shift") {
        const d = parseShift(data);
        if (d) game().shift(d);
      } else if (name === "night-auto") {
        game().setAuto(data?.on !== false);
        setAuto(data?.on !== false);
      } else if (name === "night-again") startOrAgain();
      else if (name === "engine-sync") told.current.key = "";
    },
  };
  mineRef.current = mine;
  bus.current = mine;
  // leaving hands the phone's messages to nobody, unless the other mode has already taken them
  useEffect(() => {
    bus.current = mineRef.current ?? {};
    return () => {
      if (bus.current === mineRef.current) bus.current = {};
    };
  }, [bus]);
  useEffect(() => {
    // no phone (or it dropped): the wheel and the pedals let go
    if (!remote.linked) {
      phone.current = newPhone();
      phoneSm.current = { steer: 0, gas: 0, brake: 0 };
    }
    told.current.key = "";
    told.current.cpN = -1;
  }, [remote.linked]);

  function tellPhone(urgent = false) {
    const r = linkRef.current;
    const g = gameRef.current;
    if (!r.linked || !g) return;
    const now = performance.now();
    const v = g.view();
    const t = told.current;
    const fresh = urgent || v.cpN !== t.cpN || v.hitN !== t.hitN || v.phase !== t.phase;
    if (!fresh && now - t.at < C.nightStateEveryMs) return;
    const data = nightStateData(v);
    const key = JSON.stringify(data);
    if (!fresh && key === t.key) return;
    told.current = { at: now, key, cpN: v.cpN, hitN: v.hitN, phase: v.phase };
    r.send({ type: "gesture", name: "night-state", data });
  }

  const ref = useCanvas(
    ({ ctx, w, h, t, dt, reduce }) => {
      let a = assetsRef.current;
      if (!a || a.w !== w || a.h !== h || a.dpr !== Math.max(1, ctx.getTransform().a)) a = assetsRef.current = buildAssets(ctx, w, h);
      // the quality governor: a slow second and a half drops a step (0: everything; 1: no beams, wear or ledges; 2: a shorter road and no far ranges; 3: the bare road with its lamps); a long smooth spell climbs back
      const q = gov.current;
      if (dt > 0) {
        q.ema += (dt * 1000 - q.ema) * 0.06;
        if (q.ema > C.cam.slowFrameMs) {
          q.slowFor += dt;
          q.fastFor = 0;
        } else if (q.ema < C.cam.fastFrameMs) {
          q.fastFor += dt;
          q.slowFor = 0;
        } else {
          q.slowFor = 0;
          q.fastFor = 0;
        }
        if (q.slowFor > 1.5 && q.level < 3) {
          q.level++;
          q.slowFor = 0;
          q.ema = 16.7;
        } else if (q.fastFor > 10 && q.level > 0) {
          q.level--;
          q.fastFor = 0;
        }
      }

      if (!play) {
        let at = attractRef.current;
        if (!at) at = attractRef.current = new Attract(reduce);
        // the tile is paced by useCanvas (30 fps at most, slower if a frame is costly)
        at.update(dt);
        drawScene(ctx, a, at.scene, 2, 0);
        drawAttractHud(ctx, w, h, at.scene.car.speed);
        return;
      }

      const g = game();
      const now = t;
      // ---- hands -> inputs
      const k = held.current;
      const p = pads.current;
      const s = src.current;
      // the keys are not on or off: the steering is finer at speed, and the gas and the brake ramp (night/nightInput.ts)
      const ka = stepKeys(keyAxes.current, { dir: (k.right ? 1 : 0) - (k.left ? 1 : 0), gas: k.gas || k.space, brake: k.brake }, g.speed, dt);
      const pf = keySteerFeel(g.speed);
      p.steer = stepKeySteer(p.steer, (p.right ? 1 : 0) - (p.left ? 1 : 0), dt, Math.min(C.touchRampS, pf.upS), 0.1, pf.snap);
      const pa = padAxes.current;
      pa.gas = stepKeyPedal(pa.gas, p.gas, dt, C.keyGasS, C.keyGasOffS, C.keyGasSnap);
      pa.brake = stepKeyPedal(pa.brake, p.brake, dt, C.keyBrakeS, C.keyBrakeOffS, C.keyBrakeSnap);
      s.keySteer = ka.steer;
      s.keyGas = ka.gas;
      s.keyBrake = ka.brake;
      s.keyHand = k.hand;
      const ph = smoothPhone(phone.current, phoneSm.current, dt, performance.now());
      s.phoneSteer = ph.phoneSteer;
      s.phoneGas = ph.phoneGas;
      s.phoneBrake = ph.phoneBrake;
      s.phoneHand = ph.phoneHand;
      s.padSteer = p.steer;
      s.padGas = pa.gas;
      s.padBrake = pa.brake;
      s.padHand = p.hand;
      const input = resolveInput(s, inp.current);
      if (g.phase === "ready" && input.throttle > 0.5) startOrAgain();
      g.update(dt, input);
      if (g.phase !== lastPhase.current) {
        lastPhase.current = g.phase;
        setPhase(g.phase);
      }
      tellPhone();

      // ---- sound
      const snd = soundRef.current;
      if (snd && !document.hidden && !paused) {
        const car = g.car;
        snd.update({
          rpm: car.rpm,
          pedal: car.pedal,
          throttle: car.pedal > 0.04 && g.phase !== "done",
          cut: car.shiftT > 0,
          speed: g.speed,
          skid: g.phase === "run" ? car.skid : 0,
          slip: car.slip,
          scrape: car.scrape && g.phase === "run",
          brake: g.phase === "run" ? car.brake : 0,
          hand: g.phase === "run" && car.hand > 0.5,
          level: g.phase === "done" ? 0.35 : 1,
        });
      } else if (!snd && performance.now() - lastAudioTry.current > 1000 && g.phase !== "ready") {
        // a game the phone started: pick the sound up as soon as the page is allowed one
        lastAudioTry.current = performance.now();
        ensureAudio();
      }

      // the run, on the canvas's data attributes five times a second (the page's tests and any assistive tool can read it)
      if (now - lastData.current > 0.2) {
        lastData.current = now;
        const el = ref.current;
        if (el) {
          el.dataset.speed = String(Math.round(g.speed * 2.237));
          el.dataset.score = String(g.score);
          el.dataset.cp = String(g.cp);
          el.dataset.time = g.timeLeft.toFixed(1);
          el.dataset.hits = String(g.hitN);
          el.dataset.rails = String(g.rails);
          el.dataset.clean = String(g.cleanLegs);
          el.dataset.combo = String(g.drift.combo);
          el.dataset.dist = String(Math.round(g.car.s));
          el.dataset.quality = String(q.level);
        }
      }
      drawScene(ctx, a, g.scene, Math.min(q.level, 2), q.level);
      const opt: HudOptions = { touch: touchRef.current, linked: linkRef.current.linked, lift: touchRef.current ? PAD_LIFT : 0 };
      drawHud(ctx, w, h, g, opt, now, reduce);
      // the end card is drawn on the canvas, the button is under it wherever its bottom edge falls
      const again = againRef.current;
      if (again && g.phase === "done") again.style.top = `${Math.round(resultBottom(w, h, opt) + 14)}px`;
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      maxPixels: play ? C.cam.maxPixels : C.cam.tileMaxPixels,
      keys: (e, down) => {
        const k = held.current;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const g = game();
        switch (key) {
          case "ArrowLeft":
          case "a":
            k.left = down;
            break;
          case "ArrowRight":
          case "d":
            k.right = down;
            break;
          case "ArrowUp":
          case "w":
            k.gas = down;
            break;
          case " ":
            if (down && !e.repeat && g.phase === "done") startOrAgain();
            else k.space = down;
            break;
          case "ArrowDown":
          case "s":
            k.brake = down;
            break;
          case "Shift":
            k.hand = down;
            break;
          case "e":
            if (down && !e.repeat) g.shift(1);
            break;
          case "q":
            if (down && !e.repeat) g.shift(-1);
            break;
          case "t":
            if (down && !e.repeat) toggleAuto();
            break;
          case "r":
            // a run that is going badly is not worth the two minutes: start over (the abandoned one is not kept)
            if (down && !e.repeat && (g.phase === "run" || g.phase === "count")) {
              g.reset();
              startOrAgain();
            }
            break;
          case "Enter":
            if (down && !e.repeat) startOrAgain();
            break;
          default:
            return false;
        }
        if (down) ensureAudio();
        return true;
      },
      onDown: (_p) => {
        const g = game();
        ensureAudio();
        if (g.phase === "ready" || g.phase === "done") startOrAgain();
      },
    },
  );

  function toggleAuto() {
    const g = game();
    const next = !g.car.auto;
    g.setAuto(next);
    setAuto(next);
  }

  // coming back from the Drag strip with its switch still focused: hand the keys to the road
  useEffect(() => {
    const a = document.activeElement;
    if (play && (!a || a === document.body || a.closest('[aria-label="Mode"]'))) ref.current?.focus();
  }, [play, ref]);

  // a touch screen gets the pads; a mouse does not
  useEffect(() => {
    if (!play) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    touchRef.current = coarse;
    setTouch(coarse);
    const c = ref.current;
    if (!c) return;
    const seen = (e: PointerEvent) => {
      if (e.pointerType === "touch" && !touchRef.current) {
        touchRef.current = true;
        setTouch(true);
      }
    };
    c.addEventListener("pointerdown", seen);
    return () => c.removeEventListener("pointerdown", seen);
  }, [play, ref]);

  if (!play) return <canvas ref={ref} className="absolute inset-0 w-full h-full" />;

  const pad = (name: keyof Pads) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      (pads.current[name] as boolean) = true;
      ensureAudio();
      if (name === "gas") {
        const g = game();
        if (g.phase === "ready") startOrAgain();
      }
    },
    onPointerUp: () => ((pads.current[name] as boolean) = false),
    onPointerCancel: () => ((pads.current[name] as boolean) = false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const padClass =
    "pointer-events-auto touch-none select-none grid place-items-center rounded-2xl border border-white/25 bg-white/10 backdrop-blur-[2px] font-mono text-[11px] uppercase tracking-[0.16em] text-[#f2ead7] active:bg-white/25";

  return (
    <>
      {remote.linked && (
        <p
          data-testid="night-phone-hint"
          className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-[#0d100e]/80 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]"
        >
          <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-[#8ad9a8] align-middle" />
          Steer with your phone
        </p>
      )}
      <canvas
        ref={ref}
        data-autofocus
        data-testid="night-canvas"
        data-phase={phase}
        role="img"
        aria-label="Night run: a canyon road after midnight. Arrow keys or A and D steer, Up, W or Space is the gas, Down or S brakes, Shift is the handbrake. T switches between automatic and manual, E and Q change gear by hand, R starts the run over. Hold the gas or press Enter to start."
        className="absolute inset-0 w-full h-full outline-none touch-none"
      />
      <div role="group" aria-label="Gearbox" className="absolute right-3 top-14 z-10 flex overflow-hidden rounded-full border border-white/15 bg-[#0d100e]/70 font-mono text-[11px] uppercase tracking-[0.14em]">
        {[true, false].map((on) => (
          <button
            key={String(on)}
            type="button"
            aria-pressed={auto === on}
            data-testid={on ? "night-auto" : "night-manual"}
            onClick={() => {
              game().setAuto(on);
              setAuto(on);
              // the keys listen on the canvas: a click on this switch must not leave them without a listener
              ref.current?.focus();
            }}
            className={`h-8 px-3.5 ${auto === on ? "bg-[var(--paper)] text-[var(--ink)]" : "text-[#f2ead7] hover:bg-white/10"}`}
          >
            {on ? "Auto" : "Manual"}
          </button>
        ))}
      </div>
      {phase === "done" && (
        <button
          type="button"
          data-testid="night-again"
          onClick={startOrAgain}
          ref={againRef}
          className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full bg-[var(--mint)] px-6 py-2.5 font-mono text-xs uppercase tracking-[0.18em] text-[var(--ink)]"
          style={{ top: "calc(50% + 13.5rem)" }}
        >
          Drive again
        </button>
      )}
      {touch && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3" data-testid="night-pads">
          <div className="flex shrink-0 gap-2">
            <button type="button" aria-label="Steer left" data-testid="night-pad-left" className={`${padClass} h-[88px] w-16 text-lg sm:h-20 sm:w-20`} {...pad("left")}>
              ◀
            </button>
            <button type="button" aria-label="Steer right" data-testid="night-pad-right" className={`${padClass} h-[88px] w-16 text-lg sm:h-20 sm:w-20`} {...pad("right")}>
              ▶
            </button>
          </div>
          <div className="flex shrink-0 items-end gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <button type="button" aria-label="Brake" data-testid="night-pad-brake" className={`${padClass} h-10 w-[72px] sm:h-16 sm:w-20`} {...pad("brake")}>
                Brake
              </button>
              <button type="button" aria-label="Handbrake" data-testid="night-pad-hand" className={`${padClass} h-10 w-[72px] sm:h-16 sm:w-20`} {...pad("hand")}>
                Drift
              </button>
            </div>
            <button type="button" aria-label="Gas" data-testid="night-pad-gas" className={`${padClass} h-[88px] w-[88px] !bg-[#1d5e3f]/70 text-[13px] sm:h-24 sm:w-28`} {...pad("gas")}>
              Gas
            </button>
          </div>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </>
  );
}
