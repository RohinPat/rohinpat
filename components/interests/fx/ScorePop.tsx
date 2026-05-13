"use client";

import { motion, AnimatePresence } from "framer-motion";

type Props = {
  trigger: number; // increment to re-fire
  x: number;
  y: number;
  value: string; // e.g. "+10", "+5", "Splash"
  color?: string;
};

// Floating score popup. Increment `trigger` to re-show.
export default function ScorePop({
  trigger,
  x,
  y,
  value,
  color = "var(--accent)",
}: Props) {
  if (trigger === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={trigger}
        initial={{ opacity: 0, y: 0, scale: 0.7 }}
        animate={{ opacity: [0, 1, 1, 0], y: -28, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.8, ease: "easeOut", times: [0, 0.15, 0.7, 1] }}
        className="absolute pointer-events-none font-mono text-xs font-semibold tabular-nums"
        style={{
          left: x,
          top: y,
          color,
          transform: "translate(-50%, -50%)",
          textShadow: "0 1px 2px rgba(0,0,0,0.7)",
        }}
      >
        {value}
      </motion.div>
    </AnimatePresence>
  );
}
