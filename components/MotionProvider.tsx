"use client";

import { MotionConfig } from "framer-motion";

// Framer Motion ignores prefers-reduced-motion unless told otherwise.
// "user" drops transform/layout animations for visitors who ask for less motion.
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
