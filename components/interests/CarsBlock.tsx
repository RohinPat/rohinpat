"use client";

import Tachometer from "./toys/Tachometer";
import { InterestCard } from "./InterestCard";

export default function CarsBlock() {
  return (
    <InterestCard
      label="Cars"
      hint="/ hold the button"
      title="The only part that matters."
      caption="Specs are boring. The noise isn't. Find the redline."
    >
      <Tachometer />
    </InterestCard>
  );
}
