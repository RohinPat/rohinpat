"use client";

import { motion } from "framer-motion";
import WatchesBlock from "./interests/WatchesBlock";
import CarsBlock from "./interests/CarsBlock";
import BarcaBlock from "./interests/BarcaBlock";
import MusicBlock from "./interests/MusicBlock";
import AlsoInto from "./interests/AlsoInto";

export default function Interests() {
  return (
    <>
      <section className="py-12 md:py-20 px-6 md:px-10">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="font-mono text-xs uppercase tracking-[0.2em] muted mb-6">
              Beyond the IDE
            </p>
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-semibold tracking-tight leading-[0.95] mb-8 text-balance">
              What I'm into when
              <br />
              I'm <span className="accent">not</span> shipping code.
            </h1>
            <p className="text-lg muted max-w-2xl leading-relaxed text-pretty">
              I think the best engineers are people first. Below is the rest of the operating system —
              watches, cars, Barça, music, and a few other things I'd happily talk your ear off about.
            </p>
          </motion.div>
        </div>
      </section>

      <WatchesBlock />
      <CarsBlock />
      <BarcaBlock />
      <MusicBlock />
      <AlsoInto />
    </>
  );
}
