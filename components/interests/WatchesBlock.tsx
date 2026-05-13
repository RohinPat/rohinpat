"use client";

import WatchFace from "./toys/WatchFace";
import { InterestCard } from "./InterestCard";

export default function WatchesBlock() {
  return (
    <InterestCard
      label="Watches"
      hint="/ click to expose to light"
      title="The thing about mechanical watches."
      caption="A little useless and a little perfect. Tap the dial in a dark room."
    >
      <WatchFace />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-wider dim text-center">
        Showing your local time · lume fades after a few seconds
      </p>
    </InterestCard>
  );
}
