"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import Stage, { type StageMeta } from "@/components/offhours/Stage";
import type { PieceProps } from "@/components/offhours/useCanvas";
import Watch from "@/components/offhours/Watch";
import Maze from "@/components/offhours/Maze";
import Hoops from "@/components/offhours/Hoops";
import Penalty from "@/components/offhours/Penalty";
import Decks from "@/components/offhours/Decks";
import Engine from "@/components/offhours/Engine";
import Keyboard from "@/components/offhours/Keyboard";
import Golf from "@/components/offhours/Golf";
import Powder from "@/components/offhours/Powder";

const PLAYLIST = "https://open.spotify.com/playlist/364G4Hr4KtJzhWpoHz4MFf";

type Piece = StageMeta & {
  id: string;
  line: string;
  span: string;
  Component: (p: PieceProps) => JSX.Element;
};

// /interests — "Off hours". Nine things I like outside work, each built
// into something to play with. Tiles run a live preview; click one and it
// opens full screen. Sound is synthesized in the browser; nothing is saved.
const PIECES: Piece[] = [
  {
    id: "watch",
    index: 1,
    label: "Watches",
    line: "A little useless, a little perfect.",
    title: "Wind it, then take it apart",
    how: ["Drag the crown round to wind", "Drag the slider to explode the movement", "Drag the watch to turn it"],
    span: "md:col-span-6 lg:col-span-5 md:row-span-2",
    Component: Watch,
  },
  {
    id: "maze",
    index: 2,
    label: "Gaming",
    line: "1-bit, and the machines play too.",
    title: "Solve the maze, or watch them learn",
    how: ["Pick a solver: you, BFS, DFS, A*, wall follower, Q-learning", "You: arrows or WASD to walk", "New maze any time"],
    span: "md:col-span-6 lg:col-span-7",
    Component: Maze,
  },
  {
    id: "hoops",
    index: 3,
    label: "Basketball",
    line: "Hornets. Through whatever.",
    title: "30 seconds on the clock",
    how: ["Swipe up on the ball to shoot", "Three in a row: on fire, double points", "10 points and the hoop starts moving", "Keyboard: arrows aim, hold Space"],
    span: "md:col-span-3 lg:col-span-4",
    Component: Hoops,
  },
  {
    id: "penalty",
    index: 4,
    label: "Barça",
    line: "Més que un club.",
    title: "Penalty shootout",
    how: ["Pick a shot: placed, driven, curl, dipper, knuckle, Panenka (keys 1-7)", "Aim with the pointer, hold to power up, let go", "Beat a keeper who reads you. Best of five, then sudden death"],
    span: "md:col-span-3 lg:col-span-3",
    Component: Penalty,
  },
  {
    id: "decks",
    index: 5,
    label: "Music",
    line: "Headphones on, most of the day.",
    title: "Make a beat, then scratch it",
    how: ["Click steps to build the beat", "Grab the record to scratch", "Hold the fader to cut"],
    span: "md:col-span-6 lg:col-span-7",
    Component: Decks,
  },
  {
    id: "engine",
    index: 6,
    label: "Cars",
    line: "Redline, then shift.",
    title: "Rev and shift",
    how: ["Hold the pedal (or Space) to rev", "Shift on the green light (or ↑)", "Quarter mile, 0–60 split"],
    span: "md:col-span-6 lg:col-span-5",
    Component: Engine,
  },
  {
    id: "keyboard",
    index: 7,
    label: "Keyboards",
    line: "Hand-built, 65%, lubed.",
    title: "Built in layers",
    how: ["Drag the slider to pull it apart", "Type to snap it back together", "Drag to turn it"],
    span: "md:col-span-6 lg:col-span-8",
    Component: Keyboard,
  },
  {
    id: "golf",
    index: 8,
    label: "Golf",
    line: "Read the break.",
    title: "Putt, drive, read",
    how: ["Putt: pull back from the ball and let go", "Range: click three times to swing", "Read: pour water to see the break"],
    span: "md:col-span-6 lg:col-span-4",
    Component: Golf,
  },
  {
    id: "powder",
    index: 9,
    label: "Skiing",
    line: "Vermont weekends.",
    title: "First tracks",
    how: ["Move to carve", "Sharper turns throw more powder", "Hold to tuck and go faster"],
    span: "md:col-span-6 lg:col-span-12",
    Component: Powder,
  },
];

export default function Interests() {
  const [open, setOpen] = useState<{ id: string; rect: DOMRect } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const piece = PIECES.find((p) => p.id === open?.id);

  const close = () => {
    setOpen(null);
    opener.current?.focus({ preventScroll: true });
  };

  return (
    <section className="px-4 md:px-10 pb-16 md:pb-24">
      <div className="max-w-6xl mx-auto">
        <h1>Off hours</h1>
        <p className="-mt-6 mb-10 md:mb-14 text-lg md:text-xl muted max-w-xl text-pretty">
          Nine things I like outside work, each built into something you can play. Open one to play it
          full screen. Every sound is made in your browser, and nothing is saved.{" "}
          <Link href="/colophon" className="underline underline-offset-4 decoration-1 hover:text-[var(--fg)]">
            How they&apos;re built
          </Link>
          .
        </p>

        <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 auto-rows-[300px] gap-3 md:gap-4">
          {PIECES.map((p) => (
            <article
              key={p.id}
              className={`group relative flex flex-col overflow-hidden border border-[var(--border-strong)] bg-[var(--bg-elevated)] ${p.span}`}
            >
              <button
                type="button"
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  setOpen({ id: p.id, rect: e.currentTarget.getBoundingClientRect() });
                }}
                aria-label={`Play ${p.label}: ${p.title}`}
                className="relative flex-1 min-h-0 overflow-hidden text-left cursor-pointer"
              >
                <span aria-hidden="true" className="absolute inset-0 pointer-events-none">
                  <p.Component mode="preview" paused={!!open} />
                </span>
                <span
                  aria-hidden="true"
                  className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[var(--ink)] text-[var(--paper)] font-mono text-[11px] uppercase tracking-[0.16em] shadow-lg transition-transform duration-200 group-hover:scale-105 group-focus-within:scale-105"
                >
                  Play
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M2 1l7 4-7 4z" />
                  </svg>
                </span>
              </button>
              <div className="flex items-baseline justify-between gap-4 px-4 py-3 border-t border-[var(--border-strong)]">
                <div className="min-w-0">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.2em]">
                    <span className="muted">{String(p.index).padStart(2, "0")} — </span>
                    {p.label}
                  </h2>
                  <p className="text-sm muted mt-0.5 leading-snug">
                    {p.line}
                    {p.id === "decks" && (
                      <>
                        {" "}
                        <a href={PLAYLIST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                          The playlist<span className="sr-only"> (opens Spotify in a new tab)</span>
                        </a>
                        .
                      </>
                    )}
                  </p>
                </div>
                <p className="hidden sm:block shrink-0 max-w-[45%] text-right font-mono text-[10px] uppercase tracking-[0.2em] muted">{p.title}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      {piece && open && (
        <Stage meta={piece} origin={open.rect} onClose={close}>
          <piece.Component mode="play" />
        </Stage>
      )}
    </section>
  );
}
