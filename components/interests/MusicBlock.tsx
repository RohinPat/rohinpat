"use client";

import DrumPad from "./toys/DrumPad";
import { InterestCard } from "./InterestCard";

export default function MusicBlock() {
  return (
    <InterestCard
      label="Music"
      hint="/ make a beat"
      title="Headphones on most of the day."
      caption="Drum pad below — every sound synthesized in-browser."
    >
      <DrumPad />
    </InterestCard>
  );
}
