"use client";

import { useRef, useState } from "react";
import Exploded3D from "./Exploded3D";
import type { CarId } from "./three/car";

// The exploded car tab: pick a car and a paint, pull it apart, isolate a
// part. Product names are used only to say which cars these are modelled
// on; there are no logos or badges.

const CARS: { id: CarId; name: string; paints: { name: string; hex: string }[] }[] = [
  {
    id: "gt3rs",
    name: "911 GT3 RS",
    paints: [
      { name: "Python Green", hex: "#6aa82a" },
      { name: "Shark Blue", hex: "#1192cf" },
      { name: "Guards Red", hex: "#c0141f" },
      { name: "GT Silver", hex: "#a9adb2" },
      { name: "Racing Green", hex: "#1d5e3f" },
    ],
  },
  {
    id: "huracan",
    name: "Huracán Performante",
    paints: [
      { name: "Verde Mantis", hex: "#5fbf1f" },
      { name: "Arancio Anthaeus", hex: "#f2620c" },
      { name: "Giallo Inti", hex: "#f2bc0a" },
      { name: "Nero Noctis", hex: "#121214" },
      { name: "Racing Green", hex: "#1d5e3f" },
    ],
  },
];
const PARTS = [
  ["wing", "Rear wing"],
  ["lid", "Front lid"],
  ["body", "Body"],
  ["interior", "Cage + seats"],
  ["radiators", "Radiators"],
  ["engine", "Engine"],
  ["gearbox", "Gearbox"],
  ["exhaust", "Exhaust"],
  ["wheels", "Wheels + tyres"],
  ["brakes", "Brakes"],
  ["suspension", "Suspension"],
  ["chassis", "Floor + aero"],
] as const;

// ?cam=x,y,z overrides the camera (for inspecting the model)
function debugCam(): [number, number, number] | undefined {
  if (typeof window === "undefined") return undefined;
  const v = new URLSearchParams(window.location.search).get("cam");
  const n = v?.split(",").map(Number);
  return n && n.length === 3 && n.every((k) => !Number.isNaN(k)) ? (n as [number, number, number]) : undefined;
}

export default function CarExploded() {
  const [car, setCar] = useState<CarId>("gt3rs");
  const [paint, setPaint] = useState<Record<CarId, string>>({ gt3rs: CARS[0].paints[0].hex, huracan: CARS[1].paints[0].hex });
  const [explode, setExplode] = useState(0);
  const [solo, setSolo] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const model = useRef<{ setPaint: (hex: string) => void } | null>(null);
  const spec = CARS.find((c) => c.id === car)!;

  return (
    <div className="absolute inset-0 flex flex-col bg-[#ebe3d0] text-[#0d100e]">
      <div className="relative flex-1 min-h-0">
        <Exploded3D
          key={car}
          build={async () => (await import("./three/car")).buildCar(car, paint[car], debugCam())}
          explode={explode}
          solo={solo}
          onSolo={setSolo}
          interactive
          preview={false}
          onReady={(m) => {
            model.current = m as unknown as { setPaint: (hex: string) => void };
            setNotes(Object.fromEntries(m.parts.map((p) => [p.id, p.note])));
          }}
        />
        <p className="absolute left-4 top-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#4b4a44] pointer-events-none">
          {spec.name} · drag to turn
        </p>
      </div>
      <div className="shrink-0 flex flex-col gap-2 px-4 py-3 bg-[var(--ink)] text-[var(--paper)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1" role="group" aria-label="Car">
            {CARS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={car === c.id}
                onClick={() => {
                  setCar(c.id);
                  setSolo(null);
                }}
                className={`h-9 px-3.5 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] ${car === c.id ? "bg-[var(--paper)] text-[var(--ink)]" : "text-[#cfd0c6] hover:bg-white/10"}`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Paint">
            {spec.paints.map((p) => (
              <button
                key={p.hex}
                type="button"
                aria-pressed={paint[car] === p.hex}
                aria-label={p.name}
                title={p.name}
                onClick={() => {
                  setPaint((s) => ({ ...s, [car]: p.hex }));
                  model.current?.setPaint(p.hex);
                }}
                className={`w-7 h-7 rounded-full border-2 ${paint[car] === p.hex ? "border-[var(--paper)]" : "border-transparent"}`}
                style={{ background: p.hex }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab] ml-auto">
            Explode
            <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} className="w-40 accent-[#8ad9a8]" />
          </label>
          <button
            type="button"
            onClick={() => setExplode(explode > 0.5 ? 0 : 1)}
            className="h-9 px-4 rounded-full border border-white/20 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-white/10"
          >
            {explode > 0.5 ? "Assemble" : "Take apart"}
          </button>
        </div>
        <div className="hidden md:flex flex-wrap items-center gap-1">
          {PARTS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={solo === id}
              onClick={() => {
                setSolo(solo === id ? null : id);
                if (explode < 0.5) setExplode(0.85);
              }}
              className={`h-7 px-2.5 rounded-full text-[11px] ${solo === id ? "bg-[var(--paper)] text-[var(--ink)]" : "text-[#cfd0c6] hover:bg-white/10"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p aria-live="polite" className="hidden md:block text-[12px] text-[#cfd0c6] min-h-[1.4em]">
          {(solo && notes[solo]) || "Pick a part to isolate it."}
        </p>
      </div>
    </div>
  );
}
