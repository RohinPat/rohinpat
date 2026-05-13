"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useMemo } from "react";

type Props = {
  trigger: number; // increment to re-fire the burst
  x: number; // origin in container coords (px)
  y: number;
  count?: number;
  spread?: number; // max distance px
  color?: string;
  size?: number;
  duration?: number; // seconds
};

// Tiny accent-colored burst. Used on swish / drop / merge / collision moments.
// Pass `trigger` (a counter) — incrementing it re-fires the burst.
export default function Particles({
  trigger,
  x,
  y,
  count = 10,
  spread = 36,
  color = "var(--accent)",
  size = 3,
  duration = 0.55,
}: Props) {
  // Pre-compute jittered angles/distances per trigger so each burst is unique
  const seeds = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const baseAngle = (i / count) * Math.PI * 2;
      const angle = baseAngle + (Math.random() - 0.5) * 0.6;
      const dist = spread * (0.55 + Math.random() * 0.45);
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        size: size * (0.7 + Math.random() * 0.6),
        delay: Math.random() * 0.04,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, count, spread, size]);

  if (trigger === 0) return null;

  return (
    <AnimatePresence>
      <div
        key={trigger}
        className="absolute pointer-events-none"
        style={{ left: x, top: y }}
      >
        {seeds.map((s, i) => (
          <motion.span
            key={i}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: s.dx,
              y: s.dy,
              opacity: 0,
              scale: 0.4,
            }}
            transition={{
              duration,
              delay: s.delay,
              ease: [0.22, 0.61, 0.36, 1],
            }}
            className="absolute"
            style={{
              width: s.size,
              height: s.size,
              background: color,
              borderRadius: "50%",
              transform: "translate(-50%,-50%)",
            }}
          />
        ))}
      </div>
    </AnimatePresence>
  );
}
