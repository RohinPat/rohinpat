"use client";

import type { ComponentType } from "react";
import { PIECE_META, isPieceId, pieceApp, type PieceId } from "@/components/offhours/pieces";
import type { LinkMsg } from "@/lib/link/session";
import type { Motion } from "@/lib/link/permission";
import Decks from "./Decks";
import Engine from "./Engine";
import Golf from "./Golf";
import Hoops from "./Hoops";
import Keyboard from "./Keyboard";
import Maze from "./Maze";
import Penalty from "./Penalty";
import Powder from "./Powder";
import { Shell, bigButton } from "./Shell";
import SoundNote from "./SoundNote";
import type { ControllerProps } from "./types";
import Watch from "./Watch";

// The phone's game controllers, routed from the `screen` message the laptop
// sends ({name: "piece", piece}):
//
//   "list" (or "/interests")  the nine games; tapping one sends open "piece:<id>"
//   a piece id                that game's controller, if registered below,
//                             otherwise a "use your laptop" note
//   any other path            "your laptop opened a page"
//
// TO ADD A CONTROLLER: write a component taking ControllerProps (see types.ts),
// add one line to CONTROLLERS. That's it: the list, routing, Back button and
// "Soon" tags all follow from the registry.
// For haptics call `buzz` from lib/haptics, never navigator.vibrate: iPhones have
// no vibrate, and `buzz` glows the screen there instead.

export const CONTROLLERS: Partial<Record<PieceId, ComponentType<ControllerProps>>> = {
  watch: Watch,
  maze: Maze,
  hoops: Hoops,
  penalty: Penalty,
  decks: Decks,
  engine: Engine,
  keyboard: Keyboard,
  golf: Golf,
  powder: Powder,
};

export type PieceControlsProps = {
  /** the `piece` the laptop reported: "list", a piece id, or a pathname */
  piece?: string;
  send: (m: LinkMsg) => void;
  subscribe: ControllerProps["subscribe"];
  motion: Motion | null;
  /** leave the controllers for the home-screen controller (list: Back; other pages: Back) */
  onLeave: () => void;
  /** Back from a game: the laptop closes it and the phone returns to the list */
  onList: () => void;
};

/** "list" for the grid, a piece id, or null for any other page. */
export function resolvePiece(piece: string | undefined): PieceId | "list" | null {
  if (!piece || piece === "list" || piece === "/interests" || piece.startsWith("/interests")) return "list";
  return isPieceId(piece) ? piece : null;
}

export function PieceControls({ piece, send, subscribe, motion, onLeave, onList }: PieceControlsProps) {
  const which = resolvePiece(piece);
  if (which === null) return <OtherPage onBack={onLeave} />;
  if (which === "list") return <PieceList onOpen={(id) => send({ type: "open", app: pieceApp(id) })} onBack={onLeave} />;

  const meta = PIECE_META.find((p) => p.id === which)!;
  const Controller = CONTROLLERS[which];
  const back = () => {
    send({ type: "open", app: pieceApp("list") });
    onList();
  };
  return (
    <Shell label={meta.label} index={meta.index} onBack={back}>
      <SoundNote send={send} subscribe={subscribe} />
      {Controller ? (
        <Controller piece={which} send={send} subscribe={subscribe} motion={motion} motionOk={motion === "granted" || motion === "not-needed"} />
      ) : (
        <div className="flex-1 flex flex-col justify-center pb-[8dvh]" data-testid="phone-soon">
          <h1 className="text-[2rem] leading-tight font-extrabold text-balance">Controls for this game are coming soon; use your laptop.</h1>
          <p className="mt-3 text-lg leading-snug text-[#c9c6b6]">{meta.title}. It&apos;s playing on the laptop right now.</p>
          <button type="button" onClick={back} className={`${bigButton} mt-7`}>
            Back to the games
          </button>
        </div>
      )}
    </Shell>
  );
}

function OtherPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex-1 flex flex-col justify-center" data-testid="phone-piece">
      <h1 className="text-[2rem] leading-tight font-extrabold text-balance">Your laptop has opened a page.</h1>
      <p className="mt-3 text-lg leading-snug text-[#c9c6b6]">Read it on the laptop. Back takes both screens home, and this phone is the remote again.</p>
      <button type="button" onClick={onBack} className={`${bigButton} mt-7`}>
        Back
      </button>
    </div>
  );
}

function PieceList({ onOpen, onBack }: { onOpen: (id: PieceId) => void; onBack: () => void }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="phone-piece-list">
      <h1 className="mt-5 text-[1.6rem] font-extrabold leading-tight text-balance">Pick a game. It opens on your laptop.</h1>
      <ul className="mt-4 flex-1 min-h-0 overflow-y-auto grid grid-cols-2 gap-2.5 content-start pb-3">
        {PIECE_META.map((p) => {
          const ready = !!CONTROLLERS[p.id];
          return (
            <li key={p.id} className="contents">
              <button
                type="button"
                data-piece={p.id}
                onClick={() => onOpen(p.id)}
                className="min-h-[88px] rounded-[20px] bg-white/10 border border-white/15 px-4 py-3 text-left active:scale-[0.97] transition-transform flex flex-col justify-between"
              >
                <span className="font-mono text-[12px] uppercase tracking-[0.16em] text-[#a3a69c]">{String(p.index).padStart(2, "0")}</span>
                <span className="text-[1.2rem] font-bold leading-tight">{p.label}</span>
                <span className={`mt-1 text-[12px] font-semibold uppercase tracking-[0.1em] ${ready ? "text-[var(--mint)]" : "text-[#a3a69c]"}`}>
                  {ready ? "Phone controls" : "Laptop for now"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onBack} className="mb-1 min-h-[52px] rounded-full bg-white/10 text-[1.05rem] font-semibold" data-testid="phone-list-back">
        Back to the home screen
      </button>
    </div>
  );
}
