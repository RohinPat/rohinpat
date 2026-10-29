"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import PairChip from "@/components/link/PairChip";
import { useRemoteList } from "@/lib/link/remote";
import Stage from "@/components/offhours/Stage";
import { PIECE_META, type PieceId, type PieceMeta } from "@/components/offhours/pieces";
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

type Piece = PieceMeta & {
  span: string;
  Component: (p: PieceProps) => JSX.Element;
};

// /interests — "Off hours". Nine things I like outside work, each built
// into something to play with. Tiles run a live preview; click one and it
// opens full screen. Sound is synthesized in the browser; nothing is saved.
// (Titles, one-liners and hints live in offhours/pieces.ts so the phone's game
// list can read them without loading any game.)
const LAYOUT: Record<PieceId, { span: string; Component: (p: PieceProps) => JSX.Element }> = {
  watch: { span: "md:col-span-6 lg:col-span-5 md:row-span-2", Component: Watch },
  maze: { span: "md:col-span-6 lg:col-span-7", Component: Maze },
  hoops: { span: "md:col-span-3 lg:col-span-4", Component: Hoops },
  penalty: { span: "md:col-span-3 lg:col-span-3", Component: Penalty },
  decks: { span: "md:col-span-6 lg:col-span-7", Component: Decks },
  engine: { span: "md:col-span-6 lg:col-span-5", Component: Engine },
  keyboard: { span: "md:col-span-6 lg:col-span-8", Component: Keyboard },
  golf: { span: "md:col-span-6 lg:col-span-4", Component: Golf },
  powder: { span: "md:col-span-6 lg:col-span-12", Component: Powder },
};

const PIECES: Piece[] = PIECE_META.map((m) => ({ ...m, ...LAYOUT[m.id] }));

export default function Interests() {
  const [open, setOpen] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [closeSignal, setCloseSignal] = useState(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const piece = PIECES.find((p) => p.id === open?.id);

  // a game the phone asked for while another stage was still open or closing;
  // it opens once that one has gone
  const pending = useRef<PieceId | null>(null);

  const openTile = useCallback((id: PieceId) => {
    const tile = document.querySelector<HTMLButtonElement>(`[data-piece="${id}"]`);
    if (!tile) return;
    tile.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior });
    opener.current = tile;
    setOpen({ id, rect: tile.getBoundingClientRect() });
  }, []);

  const close = () => {
    setOpen(null);
    // the next stage mounts fresh; a leftover signal would close it on arrival
    setCloseSignal(0);
    const next = pending.current;
    pending.current = null;
    if (next) requestAnimationFrame(() => openTile(next));
    else opener.current?.focus({ preventScroll: true });
  };

  // A linked phone can open a game (exactly as a click on its tile: it grows
  // out of the tile) and close it again with its Back button.
  const onRemote = useCallback(
    (id: PieceId | "list") => {
      const cur = openRef.current?.id;
      if (id === "list") {
        pending.current = null;
        if (cur) setCloseSignal((n) => n + 1);
        return;
      }
      if (cur === id) return;
      if (cur) {
        pending.current = id;
        setCloseSignal((n) => n + 1);
        return;
      }
      openTile(id);
    },
    [openTile],
  );
  useRemoteList({ onOpen: onRemote, open: (open?.id as PieceId | undefined) ?? null });

  return (
    <section className="px-4 md:px-10 pb-16 md:pb-24">
      <div className="relative max-w-6xl mx-auto">
        <div className="absolute right-0 top-2">
          <PairChip tone="light" />
        </div>
        <h1>Off hours</h1>
        <p className="-mt-6 mb-10 md:mb-14 text-lg md:text-xl muted max-w-xl text-pretty">
          Nine things I like outside work, each one playable.{" "}
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
                data-piece={p.id}
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
              <div className="px-4 py-3 border-t border-[var(--border-strong)]">
                {/* the title never breaks mid-phrase: on a narrow tile it drops under the label */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] whitespace-nowrap">
                    <span className="muted">{String(p.index).padStart(2, "0")} — </span>
                    {p.label}
                  </h2>
                  <p className="hidden sm:block whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.16em] muted">{p.title}</p>
                </div>
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
            </article>
          ))}
        </div>
      </div>

      {piece && open && (
        <Stage meta={piece} origin={open.rect} onClose={close} closeSignal={closeSignal}>
          <piece.Component mode="play" />
        </Stage>
      )}
    </section>
  );
}
