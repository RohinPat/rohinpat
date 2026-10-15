"use client";

import { useState } from "react";
import { site } from "@/lib/site";

// "Lab 02 — the shop": a tiny product configurator, a nod to running an
// in-app shop. Pick a colour and material, watch a generic strap rebuild,
// add it to a pretend bag. Nothing is for sale and nothing is saved.

const COLOURS = [
  { name: "Ink", hex: "#1a1d1b", light: false },
  { name: "Cream", hex: "#e6dbbf", light: true },
  { name: "Racing", hex: "#1d5e3f", light: false },
  { name: "Mint", hex: "#8ad9a8", light: true },
  { name: "Garnet", hex: "#a50044", light: false },
  { name: "Sand", hex: "#c8a97e", light: true },
] as const;

const MATERIALS = ["Knit", "Sport", "Leather"] as const;

type Colour = (typeof COLOURS)[number];
type Material = (typeof MATERIALS)[number];

export default function ShopLab() {
  const [colour, setColour] = useState<Colour>(COLOURS[2]);
  const [material, setMaterial] = useState<Material>("Knit");
  const [bag, setBag] = useState(0);
  const [added, setAdded] = useState(false);
  const name = `${colour.name} ${material}`;

  const add = () => {
    setBag((n) => n + 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 1300);
  };

  return (
    <section id="lab-shop" aria-labelledby="shop-title" className="paper paper-grid scroll-mt-16 px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-12 gap-8 items-end mb-10 md:mb-14">
          <div className="md:col-span-7">
            <p className="font-mono text-xs uppercase tracking-[0.2em] muted mb-4">Lab 02</p>
            <h2 id="shop-title" className="display t-l">
              Pick it.
              <br />
              Want it.
            </h2>
          </div>
          <p className="md:col-span-5 text-base md:text-lg leading-relaxed text-pretty">
            I run the in-app shop at {site.employer}. This is the feeling we chase: choose,
            see it change instantly, want it. A toy. Nothing here is for sale.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-4 md:gap-6">
          {/* Stage */}
          <div className="lg:col-span-7 relative bg-[var(--ink)] text-[var(--paper)] min-h-[320px] md:min-h-[400px] overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{ background: "radial-gradient(60% 55% at 50% 55%, rgba(242,234,215,0.10), transparent 70%)" }}
            />
            <div className="relative flex items-start justify-between p-5 md:p-6">
              <p key={name} className="display t-m animate-[rise_0.3s_ease-out]">{name}</p>
              <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider">
                <BagIcon />
                <span key={bag} className={bag ? "animate-[beat_0.35s_ease-out] inline-block" : ""}>
                  {bag}
                </span>
                <span className="sr-only">items in bag</span>
              </p>
            </div>
            <Strap colour={colour} material={material} />
          </div>

          {/* Options */}
          <div className="lg:col-span-5 flex flex-col gap-8 border-2 border-[var(--ink)] p-5 md:p-6">
            <fieldset>
              <legend className="font-mono text-xs uppercase tracking-wider mb-3">
                Colour <span className="muted normal-case tracking-normal font-sans">— {colour.name}</span>
              </legend>
              <div className="flex flex-wrap gap-3">
                {COLOURS.map((c) => (
                  <label key={c.name} className="relative cursor-pointer">
                    <input
                      type="radio"
                      name="shop-colour"
                      value={c.name}
                      checked={colour.name === c.name}
                      onChange={() => setColour(c)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="block w-11 h-11 rounded-full border border-[rgba(13,16,14,0.25)] transition-transform peer-checked:scale-110 peer-checked:ring-2 peer-checked:ring-[var(--ink)] peer-checked:ring-offset-2 peer-checked:ring-offset-[var(--paper)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--signal)]"
                      style={{ background: c.hex }}
                    />
                    <span className="sr-only">{c.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="font-mono text-xs uppercase tracking-wider mb-3">Material</legend>
              <div className="grid grid-cols-3 border-2 border-[var(--ink)]">
                {MATERIALS.map((m) => (
                  <label key={m} className="cursor-pointer">
                    <input
                      type="radio"
                      name="shop-material"
                      value={m}
                      checked={material === m}
                      onChange={() => setMaterial(m)}
                      className="peer sr-only"
                    />
                    <span className="block text-center py-3 font-medium transition-colors peer-checked:bg-[var(--ink)] peer-checked:text-[var(--paper)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-4 peer-focus-visible:outline-[var(--signal)]">
                      {m}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-auto">
              <button
                type="button"
                onClick={add}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 bg-[var(--ink)] text-[var(--paper)] font-medium hover:bg-[var(--signal)] transition-colors"
              >
                {added ? "Added ✓" : "Add to bag"}
              </button>
              <p role="status" className="sr-only">
                {added ? `Added ${name} to your bag. ${bag} in bag.` : ""}
              </p>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-wider muted">
                Toy only · nothing is sold or saved
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 5h10l-1 9H4L3 5z" />
      <path d="M6 5V4a2 2 0 0 1 4 0v1" />
    </svg>
  );
}

// A generic strap: band, pod, clasp. Colour fades between choices; the
// material swaps the surface — knit weave, sport perforations, leather stitch.
function Strap({ colour, material }: { colour: Colour; material: Material }) {
  const line = colour.light ? "rgba(13,16,14,0.28)" : "rgba(242,234,215,0.22)";
  return (
    <svg viewBox="0 0 600 300" className="absolute inset-x-0 bottom-0 w-full h-[78%]" aria-hidden="true">
      <defs>
        <pattern id="knit" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0 L0 8" stroke={line} strokeWidth="2" />
        </pattern>
        <pattern id="sport" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="7" r="2" fill={line} />
        </pattern>
        <linearGradient id="pod" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2e2b" />
          <stop offset="1" stopColor="#111412" />
        </linearGradient>
        <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d8d4c8" />
          <stop offset="0.5" stopColor="#8c8a82" />
          <stop offset="1" stopColor="#e9e6dc" />
        </linearGradient>
      </defs>
      <ellipse cx="300" cy="248" rx="250" ry="16" fill="rgba(0,0,0,0.45)" />
      <g transform="rotate(-7 300 160)">
        <rect
          x="40"
          y="128"
          width="520"
          height="68"
          rx="34"
          style={{ fill: colour.hex, transition: "fill 0.5s ease" }}
        />
        {material === "Knit" && <rect x="40" y="128" width="520" height="68" rx="34" fill="url(#knit)" />}
        {material === "Sport" && <rect x="40" y="128" width="520" height="68" rx="34" fill="url(#sport)" />}
        {material === "Leather" && (
          <rect x="52" y="138" width="496" height="48" rx="24" fill="none" stroke={line} strokeWidth="1.6" strokeDasharray="6 5" />
        )}
        {/* clasp */}
        <rect x="486" y="134" width="40" height="56" rx="8" fill="none" stroke="url(#metal)" strokeWidth="6" />
        {/* pod */}
        <rect x="224" y="106" width="152" height="112" rx="26" fill="url(#pod)" />
        <rect x="236" y="116" width="128" height="20" rx="10" fill="rgba(255,255,255,0.06)" />
        <circle cx="300" cy="170" r="4" fill="var(--mint)" />
      </g>
    </svg>
  );
}
