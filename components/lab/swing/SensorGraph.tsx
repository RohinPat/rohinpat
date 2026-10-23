"use client";

import { useEffect, useRef, useState } from "react";
import type { MotionSample, Vec3 } from "@/lib/lab/swing";

type Channel = "accel" | "gyro" | "linear";

const CHANNELS: { id: Channel; label: string; unit: string; min: number; pick: (s: MotionSample) => Vec3 | undefined }[] = [
  { id: "accel", label: "Accel + gravity", unit: "m/s²", min: 12, pick: (s) => s.acc },
  { id: "gyro", label: "Gyro", unit: "rad/s", min: 3, pick: (s) => s.gyro },
  { id: "linear", label: "Linear accel", unit: "m/s²", min: 4, pick: (s) => s.lin },
];

// Colour-blind-safe trio that also reads on the dark panel.
const AXIS = [
  { name: "x", color: "#ff8a65" },
  { name: "y", color: "#8ad9a8" },
  { name: "z", color: "#7aa8ff" },
];

const WINDOW_S = 6;

/**
 * Live scrolling plot of the three axes. Draws from a ring buffer that the
 * motion hook mutates in place, on requestAnimationFrame, so React never
 * re-renders per sample.
 */
export default function SensorGraph({ buffer, active }: { buffer: React.MutableRefObject<MotionSample[]>; active: boolean }) {
  const [channel, setChannel] = useState<Channel>("accel");
  const canvas = useRef<HTMLCanvasElement>(null);
  const readout = useRef<HTMLParagraphElement>(null);
  const scaleRef = useRef<Record<Channel, number>>({ accel: 12, gyro: 3, linear: 4 });

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const ch = CHANNELS.find((c) => c.id === channel)!;
    let raf = 0;
    let lastReadout = 0;

    const draw = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const buf = buffer.current;
      const tNow = buf.length ? buf[buf.length - 1].t : 0;

      // Auto-scale with a floor, easing down slowly so the plot does not jitter.
      let peak = ch.min;
      for (const s of buf) {
        const v = ch.pick(s);
        if (v) peak = Math.max(peak, Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
      }
      const cur = scaleRef.current[channel];
      scaleRef.current[channel] = peak > cur ? peak : cur + (peak - cur) * 0.02;
      const range = scaleRef.current[channel] * 1.1;

      // Grid: zero line and +-half range.
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      for (const f of [-0.5, 0, 0.5]) {
        const y = h / 2 - (f * h) / 2 / 1.0;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(236,230,214,0.6)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(`+${range.toFixed(1)} ${ch.unit}`, 6, 13);
      ctx.fillText(`-${range.toFixed(1)}`, 6, h - 6);

      if (buf.length > 1) {
        for (let a = 0; a < 3; a++) {
          ctx.strokeStyle = AXIS[a].color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          let started = false;
          for (const s of buf) {
            const v = ch.pick(s);
            if (!v) continue;
            const x = w - ((tNow - s.t) / WINDOW_S) * w;
            const y = h / 2 - (v[a] / range) * (h / 2);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = "rgba(236,230,214,0.6)";
        ctx.font = "14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(active ? "Waiting for samples…" : "Turn the sensors on to see a trace", w / 2, h / 2 - 8);
        ctx.textAlign = "start";
      }

      if (readout.current && now - lastReadout > 200) {
        lastReadout = now;
        const last = buf[buf.length - 1];
        const v = last ? ch.pick(last) : undefined;
        readout.current.textContent = v
          ? `x ${v[0].toFixed(2)}   y ${v[1].toFixed(2)}   z ${v[2].toFixed(2)}  ${ch.unit}`
          : ch.id === "linear" && last ? "This browser gives no gravity-free acceleration; the recognisers subtract gravity themselves." : "";
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [buffer, channel, active]);

  return (
    <div>
      <div role="tablist" aria-label="Signal to plot" className="flex flex-wrap gap-2 mb-3">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={channel === c.id}
            onClick={() => setChannel(c.id)}
            className={`min-h-11 px-4 rounded-full border text-sm font-medium ${
              channel === c.id ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)]" : "border-hairline text-muted"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Live plot of the ${CHANNELS.find((c) => c.id === channel)!.label} signal on three axes over the last six seconds. The numbers below it show the current values.`}
        className="w-full h-56 rounded-xl bg-[#0a0c0b] border border-hairline"
      />
      <div className="mt-2 flex items-center gap-4 text-sm">
        {AXIS.map((a) => (
          <span key={a.name} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-3 h-3 rounded-sm" style={{ background: a.color }} />
            {a.name}
          </span>
        ))}
        <p ref={readout} aria-hidden className="ml-auto font-mono text-xs muted truncate" />
      </div>
    </div>
  );
}
