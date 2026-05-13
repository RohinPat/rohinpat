"use client";

import { AnimatePresence, motion } from "framer-motion";

type Props = {
  streak: number;
  threshold?: number;
};

// Top-right chip that ignites once the streak crosses the threshold.
// Positioning is the caller's job — pass via wrapper / absolute parent.
export default function StreakChip({ streak, threshold = 3 }: Props) {
  const visible = streak >= threshold;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="streak"
          initial={{ opacity: 0, y: -6, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-accent text-white font-mono text-[10px] uppercase tracking-wider tabular-nums"
        >
          <motion.span
            animate={{ rotate: [0, -15, 15, 0] }}
            transition={{ duration: 0.45, repeat: Infinity, repeatDelay: 1.2 }}
          >
            ★
          </motion.span>
          <span>{streak}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
