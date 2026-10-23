"use client";

import { useRef, useState } from "react";
import { createSwipeTracker } from "@/lib/lab/swing";
import type { DetectorOutput, SwipeEvent, TouchPoint } from "@/lib/lab/swing";

export interface SwipeRecord {
  points: TouchPoint[];
  output: DetectorOutput<SwipeEvent>;
}

/**
 * A touch pad for the penalty-swipe recogniser. Pointer events go straight
 * into the recogniser; the finished path is drawn so you can see the curve
 * the recogniser measured. Paths are kept in memory only.
 */
export default function SwipePad({ onResult }: { onResult: (r: SwipeRecord) => void }) {
  const tracker = useRef(createSwipeTracker());
  const box = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<{ x: number; y: number }[]>([]);
  const [drawing, setDrawing] = useState(false);

  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <div
        ref={box}
        role="application"
        aria-label="Swipe pad. Drag a quick curved swipe with one finger, as if kicking a penalty."
        className="relative h-64 w-full rounded-xl border border-dashed border-[var(--border-strong)] bg-[#0a0c0b] select-none"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = local(e);
          tracker.current.down(performance.now() / 1000, p.x, p.y);
          setPath([p]);
          setDrawing(true);
        }}
        onPointerMove={(e) => {
          if (!drawing) return;
          const p = local(e);
          tracker.current.move(performance.now() / 1000, p.x, p.y);
          setPath((prev) => [...prev, p]);
        }}
        onPointerUp={(e) => {
          if (!drawing) return;
          const p = local(e);
          setDrawing(false);
          const output = tracker.current.up(performance.now() / 1000, p.x, p.y);
          onResult({ points: [...tracker.current.points()], output });
        }}
        onPointerCancel={() => {
          setDrawing(false);
          tracker.current.cancel();
        }}
      >
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
          {path.length > 1 && (
            <polyline
              points={path.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
              fill="none"
              stroke="var(--mint)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        {path.length === 0 && (
          <p className="absolute inset-0 grid place-items-center text-sm muted px-6 text-center pointer-events-none">
            Swipe here: a quick flick with a curve in it.
          </p>
        )}
      </div>
    </div>
  );
}
