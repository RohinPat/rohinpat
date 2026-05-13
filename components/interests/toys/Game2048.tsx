"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Particles from "../fx/Particles";
import ScorePop from "../fx/ScorePop";

type Direction = "up" | "down" | "left" | "right";

type Tile = {
  id: number;
  value: number;
  row: number;
  col: number;
  isNew?: boolean;
  merged?: boolean;
  removeAfter?: boolean; // animating out from underneath a merge
};

const SIZE = 4;
const STORAGE_KEY = "interests.2048.hi";
const ANIM_MS = 130;

let _tileIdSeq = 1;
const nextId = () => _tileIdSeq++;

function randEmpty(tiles: Tile[]): { row: number; col: number } | null {
  const occupied = new Set<string>();
  for (const t of tiles) {
    if (t.removeAfter) continue;
    occupied.add(`${t.row}-${t.col}`);
  }
  const empties: { row: number; col: number }[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!occupied.has(`${r}-${c}`)) empties.push({ row: r, col: c });
    }
  }
  if (empties.length === 0) return null;
  return empties[Math.floor(Math.random() * empties.length)];
}

function spawn(tiles: Tile[]): Tile[] {
  const spot = randEmpty(tiles);
  if (!spot) return tiles;
  return [
    ...tiles,
    {
      id: nextId(),
      value: Math.random() < 0.9 ? 2 : 4,
      row: spot.row,
      col: spot.col,
      isNew: true,
    },
  ];
}

function initialTiles(): Tile[] {
  return spawn(spawn([]));
}

// Slide tiles in a given direction. Returns the new tile list (with merged/removeAfter flags)
// and the points gained.
function performMove(
  tiles: Tile[],
  dir: Direction,
): { next: Tile[]; gained: number; moved: boolean } {
  // Drop any tiles that are mid-cleanup
  const live = tiles
    .filter((t) => !t.removeAfter)
    .map((t) => ({ ...t, isNew: false, merged: false, removeAfter: false }));

  // Group by lane. "Lane" depends on direction.
  // For left/right: lanes are rows, sort by col (asc for left, desc for right).
  // For up/down: lanes are cols, sort by row.
  const lanes: Tile[][] = Array.from({ length: SIZE }, () => []);

  if (dir === "left" || dir === "right") {
    for (const t of live) lanes[t.row].push(t);
    for (const lane of lanes) {
      lane.sort((a, b) => (dir === "left" ? a.col - b.col : b.col - a.col));
    }
  } else {
    for (const t of live) lanes[t.col].push(t);
    for (const lane of lanes) {
      lane.sort((a, b) => (dir === "up" ? a.row - b.row : b.row - a.row));
    }
  }

  let gained = 0;
  let moved = false;
  const out: Tile[] = [];

  for (let laneIdx = 0; laneIdx < SIZE; laneIdx++) {
    const lane = lanes[laneIdx];
    let cursor = dir === "left" || dir === "up" ? 0 : SIZE - 1;
    const step = dir === "left" || dir === "up" ? 1 : -1;
    let i = 0;
    while (i < lane.length) {
      const t = lane[i];
      const next = lane[i + 1];
      let targetRow: number;
      let targetCol: number;
      if (dir === "left" || dir === "right") {
        targetRow = t.row;
        targetCol = cursor;
      } else {
        targetRow = cursor;
        targetCol = laneIdx;
      }

      if (next && next.value === t.value) {
        // Merge: both tiles animate to the same destination. `next` is removed after anim.
        // Any merge counts as a move regardless of position deltas.
        moved = true;
        // The kept tile gets the doubled value
        out.push({
          ...t,
          value: t.value * 2,
          row: targetRow,
          col: targetCol,
          merged: true,
        });
        out.push({
          ...next,
          row: targetRow,
          col: targetCol,
          removeAfter: true,
        });
        gained += t.value * 2;
        cursor += step;
        i += 2;
      } else {
        if (t.row !== targetRow || t.col !== targetCol) moved = true;
        out.push({ ...t, row: targetRow, col: targetCol });
        cursor += step;
        i += 1;
      }
    }
  }

  return { next: out, gained, moved };
}

function canMove(tiles: Tile[]): boolean {
  const live = tiles.filter((t) => !t.removeAfter);
  if (live.length < SIZE * SIZE) return true;
  const grid: number[][] = Array.from({ length: SIZE }, () =>
    Array(SIZE).fill(0),
  );
  for (const t of live) grid[t.row][t.col] = t.value;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return true;
    }
  }
  return false;
}

function tileStyle(v: number): { bg: string; color: string; fontSize: string } {
  const fontSize =
    v >= 1024 ? "11px" : v >= 128 ? "14px" : v >= 16 ? "18px" : "22px";
  if (v >= 2048) return { bg: "#a50044", color: "#fff", fontSize };
  if (v >= 1024) return { bg: "rgba(165,0,68,0.95)", color: "#fff", fontSize };
  if (v >= 512) return { bg: "rgba(165,0,68,0.8)", color: "#fff", fontSize };
  if (v >= 256) return { bg: "rgba(165,0,68,0.6)", color: "#fff", fontSize };
  if (v >= 128) return { bg: "rgba(165,0,68,0.4)", color: "#fff", fontSize };
  if (v >= 64) return { bg: "#3a3a3a", color: "#ededed", fontSize };
  if (v >= 32) return { bg: "#2c2c2c", color: "#ededed", fontSize };
  if (v >= 8) return { bg: "#222", color: "#ededed", fontSize };
  return { bg: "#181818", color: "#9ca3af", fontSize };
}

const KEY_TO_DIR: Record<string, Direction> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

export default function Game2048() {
  const [tiles, setTiles] = useState<Tile[]>(() => initialTiles());
  const [score, setScore] = useState(0);
  const [hi, setHi] = useState(0);
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);
  const [bestPulse, setBestPulse] = useState(0);
  const [confettiTrig, setConfettiTrig] = useState(0);
  const [lastGain, setLastGain] = useState<{ value: number; row: number; col: number; trig: number } | null>(null);
  const [boardSize, setBoardSize] = useState(280);

  const hoverRef = useRef(false);
  const swipeRef = useRef<{ x: number; y: number; on: boolean }>({
    x: 0,
    y: 0,
    on: false,
  });
  const lockRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);

  // Load hi-score
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) setHi(parseInt(raw, 10) || 0);
  }, []);

  // Persist hi-score + nudge animation
  useEffect(() => {
    if (score > hi) {
      setHi(score);
      setBestPulse((p) => p + 1);
      try {
        window.localStorage.setItem(STORAGE_KEY, String(score));
      } catch {
        /* no-op */
      }
    }
  }, [score, hi]);

  // Track board size so absolute tile positions stay in sync (cell %)
  useEffect(() => {
    if (!boardRef.current) return;
    const ro = new ResizeObserver(() => {
      if (boardRef.current) setBoardSize(boardRef.current.clientWidth);
    });
    ro.observe(boardRef.current);
    setBoardSize(boardRef.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  const handleMove = useCallback(
    (dir: Direction) => {
      if (over || lockRef.current) return;
      setTiles((cur) => {
        const { next, gained, moved } = performMove(cur, dir);
        if (!moved) return cur;
        if (gained > 0) {
          setScore((s) => s + gained);
          // Pick a merged tile to fly score from
          const merged = next.find((t) => t.merged);
          if (merged) {
            setLastGain({
              value: gained,
              row: merged.row,
              col: merged.col,
              trig: Date.now(),
            });
          }
        }
        // Win check (first time hitting 2048)
        if (!won && next.some((t) => t.value === 2048 && !t.removeAfter)) {
          setWon(true);
          setConfettiTrig((p) => p + 1);
        }

        lockRef.current = true;
        // After animation: drop removed tiles, spawn new one, check game-over
        setTimeout(() => {
          setTiles((t2) => {
            const cleaned = t2
              .filter((tt) => !tt.removeAfter)
              .map((tt) => ({ ...tt, isNew: false, merged: false }));
            const spawned = spawn(cleaned);
            if (!canMove(spawned)) setOver(true);
            return spawned;
          });
          lockRef.current = false;
        }, ANIM_MS);

        return next;
      });
    },
    [over, won],
  );

  // Keyboard (only when card is hovered)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoverRef.current) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          (t as any).isContentEditable)
      ) {
        return;
      }
      const dir = KEY_TO_DIR[e.key.toLowerCase()];
      if (dir) {
        e.preventDefault();
        handleMove(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleMove]);

  const onPointerDown = (e: React.PointerEvent) => {
    swipeRef.current = { x: e.clientX, y: e.clientY, on: true };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!swipeRef.current.on) return;
    const dx = e.clientX - swipeRef.current.x;
    const dy = e.clientY - swipeRef.current.y;
    swipeRef.current.on = false;
    const THRESH = 24;
    if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
    let dir: Direction;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "right" : "left";
    else dir = dy > 0 ? "down" : "up";
    handleMove(dir);
  };

  const restart = () => {
    setTiles(initialTiles());
    setScore(0);
    setOver(false);
    setWon(false);
    setLastGain(null);
  };

  // Cell metrics — 4 columns with 6px gap inside 6px padding
  const PAD = 6;
  const GAP = 6;
  const cellSize = (boardSize - PAD * 2 - GAP * (SIZE - 1)) / SIZE;
  const cellPos = (idx: number) => PAD + idx * (cellSize + GAP);

  return (
    <div
      onMouseEnter={() => {
        hoverRef.current = true;
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
      }}
      className="flex flex-col items-center gap-3 w-full"
    >
      {/* Scoreboard */}
      <div className="flex items-end justify-between w-full max-w-[280px] gap-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider dim">
            score
          </p>
          <p className="text-xl font-semibold accent tabular-nums leading-none">
            {score}
          </p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider dim">
            best
          </p>
          <motion.p
            key={`hi-${bestPulse}`}
            initial={bestPulse > 0 ? { scale: 1, color: "var(--accent)" } : false}
            animate={{ scale: 1, color: "var(--fg)" }}
            transition={{ duration: 0.6 }}
            className="text-xl font-semibold tabular-nums leading-none"
          >
            {hi}
          </motion.p>
        </div>
        <button
          onClick={restart}
          className="font-mono text-[10px] uppercase tracking-wider muted hover:accent transition-colors mb-0.5"
        >
          restart
        </button>
      </div>

      {/* Board */}
      <div
        ref={boardRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeRef.current.on = false;
        }}
        className="relative w-full max-w-[280px] aspect-square touch-none select-none bg-[var(--bg-elevated)] border border-[var(--border-strong)]"
        style={{ padding: 0 }}
      >
        {/* Grid background (empty cells) */}
        {Array.from({ length: SIZE * SIZE }).map((_, idx) => {
          const r = Math.floor(idx / SIZE);
          const c = idx % SIZE;
          return (
            <div
              key={`bg-${idx}`}
              className="absolute"
              style={{
                left: cellPos(c),
                top: cellPos(r),
                width: cellSize,
                height: cellSize,
                background: "#0e0e0e",
              }}
            />
          );
        })}

        {/* Tiles — animated by id */}
        <AnimatePresence>
          {tiles.map((t) => {
            const style = tileStyle(t.value);
            return (
              <motion.div
                key={t.id}
                initial={
                  t.isNew
                    ? { scale: 0.4, opacity: 0 }
                    : { scale: 1, opacity: 1 }
                }
                animate={{
                  left: cellPos(t.col),
                  top: cellPos(t.row),
                  scale: t.merged ? [1, 1.18, 1] : 1,
                  opacity: t.removeAfter ? 0 : 1,
                }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{
                  left: { duration: ANIM_MS / 1000, ease: [0.22, 0.61, 0.36, 1] },
                  top: { duration: ANIM_MS / 1000, ease: [0.22, 0.61, 0.36, 1] },
                  scale: t.merged
                    ? { duration: 0.22, times: [0, 0.6, 1] }
                    : { duration: 0.14, ease: "easeOut" },
                  opacity: { duration: 0.12 },
                }}
                className="absolute flex items-center justify-center font-mono font-semibold tabular-nums"
                style={{
                  width: cellSize,
                  height: cellSize,
                  background: style.bg,
                  color: style.color,
                  fontSize: style.fontSize,
                  zIndex: t.merged ? 2 : 1,
                }}
              >
                {t.value}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Score popup floating from merged tile */}
        {lastGain && (
          <ScorePop
            trigger={lastGain.trig}
            x={cellPos(lastGain.col) + cellSize / 2}
            y={cellPos(lastGain.row) + cellSize / 2}
            value={`+${lastGain.value}`}
          />
        )}

        {/* 2048 confetti */}
        <Particles
          trigger={confettiTrig}
          x={boardSize / 2}
          y={boardSize / 2}
          count={24}
          spread={Math.max(boardSize / 2, 80)}
          color="var(--accent)"
          size={3}
          duration={1.1}
        />

        {/* Game-over overlay */}
        <AnimatePresence>
          {over && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[var(--bg)]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] accent">
                game over
              </p>
              <p className="text-lg font-semibold">
                {won ? "You hit 2048." : "No moves left."}
              </p>
              <p className="font-mono text-xs muted">final: {score}</p>
              <button
                onClick={restart}
                className="px-4 py-2 border border-[var(--border-strong)] hover:border-accent hover:accent transition-colors font-mono text-[10px] uppercase tracking-wider"
              >
                run it back
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* "You got 2048" toast */}
        <AnimatePresence>
          {won && !over && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute top-2 left-1/2 -translate-x-1/2 bg-accent text-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider z-10"
            >
              2048 — keep going
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-wider dim text-center">
        Hover · WASD or arrows · or swipe
      </p>
    </div>
  );
}
