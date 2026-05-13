"use client";

import PitchKicker from "./toys/PitchKicker";
import { InterestCard } from "./InterestCard";

function Crest() {
  return (
    <div className="w-9 h-11 relative border-2 border-[var(--fg)] rounded-b-[100%] overflow-hidden shrink-0">
      <div className="absolute inset-0 flex flex-col">
        <div className="flex-1 flex">
          <div className="flex-1 bg-accent" />
          <div className="flex-1 bg-[#1B3A6B]" />
          <div className="flex-1 bg-accent" />
          <div className="flex-1 bg-[#1B3A6B]" />
        </div>
        <div className="h-1/2 bg-[var(--fg)] flex items-center justify-center">
          <span className="font-mono text-[7px] font-bold text-[var(--bg)] tracking-wider">
            FCB
          </span>
        </div>
      </div>
    </div>
  );
}

export default function BarcaBlock() {
  return (
    <InterestCard
      label="Barça"
      hint="/ take a shot"
      title="Més que un club."
      titleItalic
      caption="Aim past the keeper. Sideways aim adds curl."
      decoration={
        <>
          <div className="h-1.5 flex absolute top-0 left-0 right-0">
            <div className="flex-1 bg-accent" />
            <div className="flex-1 bg-[#1B3A6B]" />
            <div className="flex-1 bg-accent" />
            <div className="flex-1 bg-[#1B3A6B]" />
            <div className="flex-1 bg-accent" />
          </div>
          <div className="h-1.5 flex absolute bottom-0 left-0 right-0">
            <div className="flex-1 bg-[#1B3A6B]" />
            <div className="flex-1 bg-accent" />
            <div className="flex-1 bg-[#1B3A6B]" />
            <div className="flex-1 bg-accent" />
            <div className="flex-1 bg-[#1B3A6B]" />
          </div>
        </>
      }
      headerExtra={<Crest />}
    >
      <PitchKicker />
    </InterestCard>
  );
}
