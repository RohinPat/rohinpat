"use client";

import { useEffect, useRef } from "react";

// rAF loop that only runs while the element is on screen, the tab is
// visible and it isn't `paused`. For the DOM/SVG pieces; canvases use
// useCanvas.
export function useVisibleLoop<T extends Element>(tick: (dt: number) => void, paused = false) {
  const ref = useRef<T>(null);
  const tickRef = useRef(tick);
  const pausedRef = useRef(paused);
  const runRef = useRef<() => void>(() => {});
  tickRef.current = tick;
  pausedRef.current = paused;

  useEffect(() => runRef.current(), [paused]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let last = 0;
    let visible = false;
    const frame = (now: number) => {
      tickRef.current(Math.min(0.05, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden && !pausedRef.current) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    runRef.current = run;
    tickRef.current(0);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", run);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", run);
    };
  }, []);

  return ref;
}
