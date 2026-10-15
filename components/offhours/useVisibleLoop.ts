"use client";

import { useEffect, useRef } from "react";

// rAF loop that only runs while the element is on screen and the tab is
// visible. For the DOM/SVG pieces (watch, vinyl); canvases use useCanvas.
export function useVisibleLoop<T extends Element>(tick: (dt: number) => void, deps: unknown[] = []) {
  const ref = useRef<T>(null);
  const tickRef = useRef(tick);
  tickRef.current = tick;

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
      if (visible && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
