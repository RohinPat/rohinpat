"use client";

import { motion } from "framer-motion";
import { barca } from "@/lib/interests";

function Crest() {
  return (
    <div className="w-16 h-20 md:w-20 md:h-24 relative border-2 border-[var(--fg)] rounded-b-[100%] overflow-hidden">
      <div className="absolute inset-0 flex flex-col">
        <div className="flex-1 flex">
          <div className="flex-1 bg-accent" />
          <div className="flex-1 bg-[#1B3A6B]" />
          <div className="flex-1 bg-accent" />
          <div className="flex-1 bg-[#1B3A6B]" />
        </div>
        <div className="h-1/2 bg-[var(--fg)] flex items-center justify-center">
          <span className="font-mono text-[10px] md:text-xs font-bold text-[var(--bg)] tracking-wider">FCB</span>
        </div>
      </div>
    </div>
  );
}

// Stylized "11" jersey-back panel for Neymar.
function ElevenPanel() {
  return (
    <div className="relative w-full aspect-[3/4] flex flex-col items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-strong)] overflow-hidden">
      {/* Diagonal blaugrana band */}
      <div className="absolute -left-1/4 -top-1/4 w-1/3 h-[150%] rotate-12 bg-accent/[0.08]" />
      <div className="absolute -right-1/4 -bottom-1/4 w-1/3 h-[150%] rotate-12 bg-[#1B3A6B]/[0.08]" />

      <span className="relative font-mono text-[10px] uppercase tracking-[0.3em] muted mb-2">
        Favorite. Ever.
      </span>
      <span className="relative font-semibold text-[14rem] md:text-[16rem] leading-none tracking-tighter accent">
        11
      </span>
      <div className="relative mt-4 text-center">
        <p className="text-2xl md:text-3xl font-semibold tracking-tight uppercase">
          Neymar Jr.
        </p>
        <p className="font-mono text-xs uppercase tracking-[0.2em] muted mt-1">
          {barca.favoritePlayer.years}
        </p>
      </div>
    </div>
  );
}

export default function BarcaBlock() {
  return (
    <section className="border-t border-[var(--border)] relative overflow-hidden">
      <div className="h-2 flex">
        <div className="flex-1 bg-accent" />
        <div className="flex-1 bg-[#1B3A6B]" />
        <div className="flex-1 bg-accent" />
        <div className="flex-1 bg-[#1B3A6B]" />
        <div className="flex-1 bg-accent" />
      </div>

      <div className="py-20 md:py-28 px-6 md:px-10">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start gap-6 mb-10">
            <Crest />
            <div>
              <div className="flex items-baseline gap-4 mb-3">
                <span className="font-mono text-xs uppercase tracking-[0.2em] accent">
                  03 — Barça
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.2em] dim">
                  / just a fan
                </span>
              </div>
              <h2 className="text-4xl md:text-6xl font-semibold tracking-tight italic">
                {barca.legend}
              </h2>
              <p className="muted mt-3 max-w-xl text-pretty">
                Not a tactics nerd. No favorite XI. I just keep the game on and watch.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-14 mt-12">
            <div className="md:col-span-5">
              <ElevenPanel />
              <p className="muted italic mt-4 text-pretty">
                {barca.favoritePlayer.note}
              </p>
            </div>

            <div className="md:col-span-7 flex flex-col justify-center gap-6">
              <h3 className="font-mono text-xs uppercase tracking-wider muted">
                Vibes only
              </h3>
              <ul className="space-y-4">
                {barca.vibes.map((line, i) => (
                  <motion.li
                    key={line}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: "-30px" }}
                    transition={{ duration: 0.35, delay: i * 0.06 }}
                    className="flex gap-4 items-baseline border-l-2 border-accent pl-4"
                  >
                    <span className="text-lg md:text-xl text-pretty">{line}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="h-2 flex">
        <div className="flex-1 bg-[#1B3A6B]" />
        <div className="flex-1 bg-accent" />
        <div className="flex-1 bg-[#1B3A6B]" />
        <div className="flex-1 bg-accent" />
        <div className="flex-1 bg-[#1B3A6B]" />
      </div>
    </section>
  );
}
