"use client";

import { useEffect, useRef, useState } from "react";
import { useRemote, type RemoteHandlers } from "@/lib/link/remote";
import { useStageLabel } from "./Stage";
import type { PieceProps } from "./useCanvas";
import DragStrip from "./DragStrip";
import NightRun from "./NightRun";
import type { EngineMode } from "./engineRemote";

// Cars. Two modes share one engine (engineModel.ts) and one V8 (engineVoice.ts):
// Night run, a canyon road at night that you drift through (the tile's attract
// mode, and the way the piece opens), and the Drag strip, the quarter mile.
// This file owns the switch between them and the phone link: a linked phone
// is told which mode is up, so it shows the matching controller (a steering
// wheel for Night run, a throttle grip for the strip), and whichever game is
// showing gets the phone's messages.

const MODES: { id: EngineMode; label: string }[] = [
  { id: "night", label: "Night run" },
  { id: "drag", label: "Drag strip" },
];

// The stage's heading follows the mode (pieces.ts has Night run, the way it opens);
// the strip has its own hints.
const DRAG_HOW = [
  "Keyboard: hold Space for throttle, ↑ (or E) shifts up",
  "Hold the throttle to stage, then keep the revs in the band, near the mark, when the light goes green",
  "Shift when the lights go blue. Your best run of this visit races you. Space or a tap runs it again",
];

export default function EnginePiece({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [game, setGame] = useState<EngineMode>("night");
  const bus = useRef<RemoteHandlers>({});
  useStageLabel(play ? (game === "drag" ? { title: "Drag strip", how: DRAG_HOW } : { title: "Night run" }) : null);
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
    sendRef.current({ type: "gesture", name: "engine-mode", data: { mode: gameRef.current } });
  }
  useEffect(() => {
    if (remote.linked) tell();
  }, [remote.linked, game]);

  if (!play) return <NightRun mode="preview" paused={paused} remote={remote} bus={bus} />;
  return (
    <div className="absolute inset-0 bg-[#05080c]">
      {game === "night" ? <NightRun mode="play" paused={paused} remote={remote} bus={bus} /> : <DragStrip mode="play" paused={paused} remote={remote} bus={bus} />}
      <div role="group" aria-label="Mode" className="absolute right-3 top-3 z-20 flex overflow-hidden rounded-full border border-white/15 bg-[#0d100e]/80 font-mono text-[11px] uppercase tracking-[0.14em]">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={game === m.id}
            data-testid={`engine-mode-${m.id}`}
            onClick={() => setGame(m.id)}
            className={`h-8 px-3.5 ${game === m.id ? "bg-[var(--mint)] text-[var(--ink)]" : "text-[#f2ead7] hover:bg-white/10"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
