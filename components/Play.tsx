"use client";

import dynamic from "next/dynamic";
import NowSpinning from "./play/NowSpinning";

// Pose detection pulls in TF.js (~5MB). Lazy-load only when /play is hit.
const PoseCelebrate = dynamic(() => import("./play/PoseCelebrate"), {
  ssr: false,
  loading: () => (
    <div className="border border-[var(--border)] p-12 text-center">
      <p className="font-mono text-xs uppercase tracking-wider dim">
        Loading pose detection…
      </p>
    </div>
  ),
});

export default function Play() {
  return (
    <>
      <section className="py-12 md:py-20 px-6 md:px-10">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-xs uppercase tracking-[0.2em] muted mb-6">
            The Lab
          </p>
          <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[0.95] mb-8">
            Two things,
            <br />
            tied to <span className="accent">two real interests.</span>
          </h1>
          <p className="text-lg muted max-w-2xl leading-relaxed text-pretty">
            Not mini-games. Pose-detected goal celebrations for the Barça side,
            and a live look at what I'm listening to. Made for fun.
          </p>
        </div>
      </section>

      <PoseCelebrate />
      <NowSpinning />
    </>
  );
}
