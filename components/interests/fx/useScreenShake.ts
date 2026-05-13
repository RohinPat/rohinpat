"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  duration?: number; // ms
  intensity?: number; // px
};

// Returns a transform string to apply to a container, plus a `shake()` trigger.
// Apply via inline style: <div style={{ transform: shakeTransform }} />
export function useScreenShake({ duration = 220, intensity = 4 }: Options = {}) {
  const [transform, setTransform] = useState("translate3d(0,0,0)");
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setTransform("translate3d(0,0,0)");
  }, []);

  const shake = useCallback(() => {
    startRef.current = performance.now();

    const tick = (now: number) => {
      if (startRef.current == null) return;
      const elapsed = now - startRef.current;
      const t = elapsed / duration;
      if (t >= 1) {
        stop();
        return;
      }
      const decay = 1 - t;
      const dx = (Math.random() - 0.5) * 2 * intensity * decay;
      const dy = (Math.random() - 0.5) * 2 * intensity * decay;
      setTransform(`translate3d(${dx}px, ${dy}px, 0)`);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [duration, intensity, stop]);

  useEffect(() => stop, [stop]);

  return { transform, shake };
}
