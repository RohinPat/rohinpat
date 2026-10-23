"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { site } from "@/lib/site";
import css from "./mirror.module.css";

export const SCREEN_W = 393;
export const SCREEN_H = 852;
const EDGE_LAYERS = 3;

export interface PhoneMockupHandle {
  /** Set the rig's transform and the glare, straight on the DOM (no React render). */
  setPose(matrix3d: string, glareX: number): void;
  /** Lock layer follows a finger: dy is a fraction of the screen height, -1..0. null = let go. */
  setDrag(dy: number | null): void;
  unlock(): void;
  lock(): void;
  /** x, y as 0..1 of the screen. */
  ripple(x: number, y: number): void;
  readonly rig: HTMLDivElement | null;
  readonly isLocked: boolean;
}

const APPS: { label: string; glyph: string; bg: string; fg?: string }[] = [
  { label: "Projects", glyph: "P", bg: "#1d5e3f" },
  { label: "Interests", glyph: "I", bg: "#f2ead7", fg: "#0d100e" },
  { label: "Camera", glyph: "◉", bg: "#2a2f2b" },
  { label: "Contact", glyph: "@", bg: "#a50044" },
  { label: "Notes", glyph: "N", bg: "#c9a227", fg: "#0d100e" },
  { label: "Maps", glyph: "M", bg: "#3a6f8f" },
  { label: "Music", glyph: "♪", bg: "#6c3f8f" },
  { label: "Clock", glyph: "◔", bg: "#0d100e" },
];

interface Props {
  /** Called when the locked state changes (for aria-live text in the parent). */
  onLockedChange?: (locked: boolean) => void;
}

/**
 * A simplified copy of the site's phone: metal frame with thickness, lock layer
 * that slides up the way the real one does, a home screen to tap on, and a
 * ripple. The parent drives it imperatively so a 60 Hz pose never re-renders React.
 */
const PhoneMockup = forwardRef<PhoneMockupHandle, Props>(function PhoneMockup({ onLockedChange }, ref) {
  const rigRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(true);
  const lockedRef = useRef(true);
  const [drag, setDrag] = useState<number | null>(null);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const rippleId = useRef(0);
  const [clock, setClock] = useState({ time: "9:41", date: "" });

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock({
        time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?[AP]M$/, ""),
        date: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      });
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, []);

  const setLockedBoth = useCallback(
    (v: boolean) => {
      lockedRef.current = v;
      setLocked(v);
      setDrag(null);
      onLockedChange?.(v);
    },
    [onLockedChange],
  );

  useImperativeHandle(
    ref,
    () => ({
      setPose(matrix3d, glareX) {
        const rig = rigRef.current;
        if (!rig) return;
        rig.style.transform = matrix3d;
        screenRef.current?.style.setProperty("--gx", glareX.toFixed(3));
      },
      setDrag(dy) {
        if (!lockedRef.current) return;
        setDrag(dy === null ? null : Math.max(-1, Math.min(0, dy)) * SCREEN_H);
      },
      unlock() {
        if (lockedRef.current) setLockedBoth(false);
      },
      lock() {
        setLockedBoth(true);
      },
      ripple(x, y) {
        const id = ++rippleId.current;
        setRipples((r) => [...r.slice(-5), { id, x: x * SCREEN_W, y: y * SCREEN_H }]);
        window.setTimeout(() => setRipples((r) => r.filter((p) => p.id !== id)), 760);
      },
      get rig() {
        return rigRef.current;
      },
      get isLocked() {
        return lockedRef.current;
      },
    }),
    [setLockedBoth],
  );

  const dragging = drag !== null && locked;
  return (
    <div ref={rigRef} className={css.rig} data-testid="mockup-rig">
      <div className={css.back} style={{ transform: `translateZ(${-EDGE_LAYERS * 4.4 - 2}px)` }} />
      {Array.from({ length: EDGE_LAYERS }, (_, i) => (
        <div key={i} className={css.edge} style={{ transform: `translateZ(${-(i + 1) * 4.4}px)` }} />
      ))}
      <div className={css.frame} />
      {/* side buttons sit on the frame's edge */}
      <span className={css.btn} style={{ left: -17, top: 150, height: 30 }} />
      <span className={css.btn} style={{ left: -17, top: 215, height: 62 }} />
      <span className={css.btn} style={{ left: -17, top: 290, height: 62 }} />
      <span className={css.btn} style={{ right: -17, top: 240, height: 98 }} />

      <div ref={screenRef} className={css.screen} data-testid="mockup-screen" data-locked={locked}>
        <span className={css.island} />
        <div className={css.glare} />

        {/* home screen, under the lock layer */}
        <div className={css.wall} />
        <div className={css.home} aria-hidden="true">
          <div className={css.status}>
            <span>{clock.time}</span>
            <span>5G ▮▮▮</span>
          </div>
          <div className={css.grid}>
            {APPS.map((a) => (
              <div key={a.label} className={css.app}>
                <span className={css.icon} style={{ background: a.bg, color: a.fg ?? "#f2ead7" }}>
                  {a.glyph}
                </span>
                {a.label}
              </div>
            ))}
          </div>
          <div className={css.dock}>
            {APPS.slice(0, 4).map((a) => (
              <span key={a.label} className={css.icon} style={{ background: a.bg, color: a.fg ?? "#f2ead7" }}>
                {a.glyph}
              </span>
            ))}
          </div>
        </div>

        {/* lock layer: same transition as components/home/Springboard.tsx's LockScreen */}
        <div
          className={css.lock}
          data-testid="mockup-lock"
          style={{
            background: "transparent",
            transform: locked ? `translateY(${drag ?? 0}px)` : "translateY(-105%)",
            opacity: locked ? 1 : 0,
            transition: dragging ? "none" : "transform 0.48s cubic-bezier(0.32,0.72,0,1), opacity 0.48s ease",
          }}
        >
          <div className={css.wall} style={{ zIndex: -1 }} />
          <p className={css.date}>{clock.date || " "}</p>
          <p className={css.clock}>{clock.time}</p>
          <div className={css.card}>
            <b>{site.name}</b>
            <span>
              {site.role} · {site.employer}
            </span>
          </div>
          <div className={css.lockBottom}>
            <div className={css.lockBtns}>
              <span className={css.lockBtn} />
              <span className={css.lockBtn} />
            </div>
            <span className={css.hint}>Swipe up to unlock</span>
            <span className={css.pill} />
          </div>
        </div>

        {ripples.map((r) => (
          <span key={r.id} className={css.ripple} style={{ left: r.x, top: r.y }} data-testid="mockup-ripple" />
        ))}
      </div>
    </div>
  );
});

export default PhoneMockup;
