"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRemote, type RemoteHandlers } from "@/lib/link/remote";
import { useStageLabel } from "./Stage";
import type { PieceProps } from "./useCanvas";
import DragStrip from "./DragStrip";
import Scope, { ScopeToggle } from "./Scope";
import NightRun from "./NightRun";
import { setRival } from "./night/game";
import type { Ghost } from "./night/ghost";
import type { EngineMode } from "./engineRemote";

// Learn is its own chunk: the learning code loads when the mode is opened.
const Learn = dynamic(() => import("./learn/Learn"), { ssr: false });

// Cars. Three modes. Night run, a canyon road at night that you drift through
// (the tile's attract mode, and the way the piece opens), and the Drag strip, the
// quarter mile, share one engine (engineModel.ts) and one V8 (engineVoice.ts);
// Learn is a population of cars learning the canyon, and can hand its best car
// to Night run to race. This file owns the switch between them and the phone
// link: a linked phone is told which mode is up, so it shows the matching
// controller (a steering wheel for Night run, a throttle grip for the strip),
// and whichever game is showing gets the phone's messages. In Learn the phone
// is told "night" and its wheel does nothing.

type Mode = EngineMode | "learn";
const MODES: { id: Mode; label: string }[] = [
  { id: "night", label: "Night run" },
  { id: "drag", label: "Drag strip" },
  { id: "learn", label: "Learn" },
];

// The stage's heading follows the mode (pieces.ts has Night run, the way it opens);
// the strip has its own hints.
const DRAG_HOW = [
  "Keyboard: hold Space for throttle, ↑ (or E) shifts up",
  "Hold the throttle to stage, tap it to keep the revs near the mark, and be on it when the light goes green",
  "Shift when the lights go blue. Three runs make a set, and its best run races you. Space or a tap goes again",
];

const LEARN_HOW = [
  "24 cars start with random controls and keep what worked",
  "Skip ahead breeds generations faster and replays the best car so far",
  "Race it puts the best car in a Night run as a ghost",
];

export default function EnginePiece({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [game, setGame] = useState<Mode>("night");
  // Night run was opened by Race it: it starts at once
  const [racing, setRacing] = useState(false);
  const [scope, setScope] = useState(false);
  const bus = useRef<RemoteHandlers>({});
  useStageLabel(play ? (game === "drag" ? { title: "Drag strip", how: DRAG_HOW } : game === "learn" ? { title: "Learn", how: LEARN_HOW } : { title: "Night run" }) : null);
  const gameRef = useRef(game);
  gameRef.current = game;

  const remote = useRemote(play ? "engine" : null, {
    axis: (name, v) => bus.current.axis?.(name, v),
    gesture: (name, data) => {
      // the phone asks which mode this is whenever its controller opens
      if (name === "engine-sync") tell();
      bus.current.gesture?.(name, data);
    },
  });
  const sendRef = useRef(remote.send);
  sendRef.current = remote.send;
  function tell() {
    sendRef.current({ type: "gesture", name: "engine-mode", data: { mode: gameRef.current === "learn" ? "night" : gameRef.current } });
  }
  useEffect(() => {
    if (remote.linked) tell();
  }, [remote.linked, game]);

  // the car Learn hands to Night run is gone when the piece is
  useEffect(() => () => setRival(null), []);
  const pick = (id: Mode) => {
    if (id === game) return;
    setRival(null);
    setRacing(false);
    setGame(id);
  };
  const race = (ghost: Ghost) => {
    setRival(ghost);
    setRacing(true);
    setGame("night");
  };

  if (!play) return <NightRun mode="preview" paused={paused} remote={remote} bus={bus} />;
  return (
    <div className="absolute inset-0 bg-[#05080c]">
      {game === "night" ? (
        <NightRun mode="play" paused={paused} remote={remote} bus={bus} race={racing} />
      ) : game === "drag" ? (
        <DragStrip mode="play" paused={paused} remote={remote} bus={bus} />
      ) : (
        <Learn paused={paused} onRace={race} />
      )}
      <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          {/* not on a phone: there it would cover the rev counter */}
          {game !== "learn" && (
            <span className="hidden md:contents">
              <ScopeToggle on={scope} onChange={setScope} small />
            </span>
          )}
          <div role="group" aria-label="Mode" className="flex overflow-hidden rounded-full border border-white/15 bg-[#0d100e]/80 font-mono text-[11px] uppercase tracking-[0.14em]">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={game === m.id}
                data-testid={`engine-mode-${m.id}`}
                onClick={() => pick(m.id)}
                className={`h-8 px-3.5 ${game === m.id ? "bg-[var(--mint)] text-[var(--ink)]" : "text-[#f2ead7] hover:bg-white/10"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {/* the V8's harmonics, live: they slide right as the revs climb */}
        {scope && game !== "learn" && (
          <div className="hidden md:block w-[300px]">
            <Scope paused={paused} compact />
          </div>
        )}
      </div>
    </div>
  );
}
