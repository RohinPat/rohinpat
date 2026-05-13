"use client";

import { motion } from "framer-motion";
import { useSound } from "../SoundContext";

export default function SoundToggle() {
  const { enabled, toggle } = useSound();

  return (
    <button
      onClick={toggle}
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? "Mute toy sounds" : "Unmute toy sounds"}
      className="flex items-center gap-3 group"
    >
      <span className="font-mono text-xs uppercase tracking-[0.2em] muted group-hover:text-[var(--fg)] transition-colors">
        Sound
      </span>
      <span
        className={`relative w-11 h-6 border transition-colors ${
          enabled
            ? "bg-accent border-accent"
            : "bg-transparent border-[var(--border-strong)]"
        }`}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={`absolute top-0.5 w-4 h-4 ${
            enabled ? "left-[22px] bg-white" : "left-0.5 bg-[var(--fg)]"
          }`}
        />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider accent w-5">
        {enabled ? "on" : "off"}
      </span>
    </button>
  );
}
