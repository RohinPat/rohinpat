"use client";

import { useEffect, useRef } from "react";

// Subtle blaugrana spotlight that follows the cursor. Uses `screen` blend mode
// so it brightens whatever's underneath without occluding clicks.
export default function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let lastX = -1000;
    let lastY = -1000;

    const update = () => {
      const el = ref.current;
      if (el) {
        el.style.background = `radial-gradient(520px circle at ${lastX}px ${lastY}px, rgba(165, 0, 68, 0.12), transparent 55%)`;
      }
      rafRef.current = null;
    };

    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(update);
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none hidden md:block"
      style={{ zIndex: 20, mixBlendMode: "screen" }}
    />
  );
}
