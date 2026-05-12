"use client";

import { motion, useScroll, useSpring } from "framer-motion";

// Thin accent line at the top of the viewport that fills as you scroll.
// Survives nav across pages because it lives in the layout.
export default function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.4,
  });

  return (
    <motion.div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[2px] bg-accent origin-left"
      style={{ scaleX, zIndex: 60 }}
    />
  );
}
