"use client";

import { useEffect, useRef, useState } from "react";
import type { LabelPoint, Model, Viewer } from "./three/viewer";

// Mounts a 3D exploded model (three.js is loaded only when this mounts) and
// draws technical-drawing labels: a dot on each part, a leader line, and the
// name in a column beside the model, kept apart so they never overlap.
// Labels fade in as the model comes apart; clicking one isolates the part.

export default function Exploded3D({
  build,
  explode,
  solo = null,
  onSolo,
  interactive,
  paused,
  preview,
  labels = true,
  onReady,
  className = "",
}: {
  build: () => Promise<Model>;
  explode: number;
  solo?: string | null;
  onSolo?: (id: string | null) => void;
  interactive: boolean;
  paused?: boolean;
  preview: boolean;
  labels?: boolean;
  onReady?: (m: Model, v: Viewer) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [parts, setParts] = useState<{ id: string; label: string }[]>([]);
  const [failed, setFailed] = useState(false);
  const labelEls = useRef<Record<string, HTMLButtonElement | null>>({});
  const lineEls = useRef<Record<string, SVGLineElement | null>>({});
  const dotEls = useRef<Record<string, SVGCircleElement | null>>({});
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    let dead = false;
    let v: Viewer | null = null;
    (async () => {
      try {
        const [{ createViewer }, model] = await Promise.all([import("./three/viewer"), build()]);
        if (dead || !host.current) return;
        v = createViewer(host.current, model, { interactive, preview, breathe: preview });
        viewer.current = v;
        v.setExplode(explodeRef.current);
        setParts(model.parts.map((p) => ({ id: p.id, label: p.label })));
        readyRef.current?.(model, v);
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      dead = true;
      v?.dispose();
      viewer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => viewer.current?.setExplode(explode), [explode]);
  useEffect(() => viewer.current?.setSolo(solo), [solo, parts]);
  useEffect(() => viewer.current?.setPaused(!!paused), [paused, parts]);

  // label layout, every frame, straight to the DOM
  useEffect(() => {
    const v = viewer.current;
    if (!v || !labels || preview) return;
    v.onLabels((pts: LabelPoint[], w: number) => {
      const show = Math.max(0, Math.min(1, (explodeRef.current - 0.25) / 0.35));
      const wide = w >= 720;
      const vis = pts.filter((p) => !p.behind).sort((a, b) => a.y - b.y);
      const maxX = Math.max(...vis.map((p) => p.x), 0);
      const col = Math.min(w - 200, maxX + 70);
      let prev = -Infinity;
      for (const p of vis) {
        const y = Math.max(p.y, prev + 26);
        prev = y;
        const el = labelEls.current[p.id];
        const ln = lineEls.current[p.id];
        const dot = dotEls.current[p.id];
        const op = wide ? String(show) : "0";
        if (el) {
          el.style.transform = `translate(${col.toFixed(1)}px, ${(y - 11).toFixed(1)}px)`;
          el.style.opacity = op;
          el.style.pointerEvents = show > 0.5 && wide ? "auto" : "none";
        }
        if (ln) {
          ln.setAttribute("x1", p.x.toFixed(1));
          ln.setAttribute("y1", p.y.toFixed(1));
          ln.setAttribute("x2", (col - 4).toFixed(1));
          ln.setAttribute("y2", y.toFixed(1));
          ln.style.opacity = op;
        }
        if (dot) {
          dot.setAttribute("cx", p.x.toFixed(1));
          dot.setAttribute("cy", p.y.toFixed(1));
          dot.style.opacity = op;
        }
      }
    });
    return () => v.onLabels(null);
  }, [labels, preview, parts]);

  return (
    <div className={`absolute inset-0 ${className}`}>
      <div ref={host} className={`absolute inset-0 ${interactive ? "cursor-grab active:cursor-grabbing" : ""}`} />
      {!parts.length && !failed && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#77736b]">Loading the model…</div>
      )}
      {failed && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#77736b]">3D isn&apos;t available in this browser</div>
      )}
      {labels && !preview && parts.length > 0 && (
        <>
          <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
            {parts.map((p) => (
              <g key={p.id}>
                <line
                  ref={(el) => {
                    lineEls.current[p.id] = el;
                  }}
                  stroke="#0d100e"
                  strokeOpacity={solo && solo !== p.id ? 0.15 : 0.45}
                  strokeWidth="1"
                />
                <circle
                  ref={(el) => {
                    dotEls.current[p.id] = el;
                  }}
                  r="2.6"
                  fill={solo === p.id ? "#1d5e3f" : "#0d100e"}
                />
              </g>
            ))}
          </svg>
          {parts.map((p) => (
            <button
              key={p.id}
              ref={(el) => {
                labelEls.current[p.id] = el;
              }}
              type="button"
              tabIndex={-1}
              onClick={() => onSolo?.(solo === p.id ? null : p.id)}
              className={`absolute left-0 top-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded transition-colors ${
                solo === p.id ? "bg-[#0d100e] text-[#f2ead7]" : "bg-[rgba(242,234,215,0.94)] text-[#0d100e] hover:bg-[#0d100e] hover:text-[#f2ead7]"
              }`}
              style={{ opacity: 0 }}
            >
              {p.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
