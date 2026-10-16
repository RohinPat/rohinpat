"use client";

import { useRef, useState } from "react";
import { useVisibleLoop } from "./useVisibleLoop";
import type { PieceProps } from "./useCanvas";
import { burst, getAudio } from "./audio";

// A mechanical watch you can wind and take apart. Everything is DOM + SVG
// in CSS 3D: crystal, hands, dial, balance, gear train, mainspring barrel,
// main plate and case, each a layer you can pull apart with the slider and
// orbit by dragging. Turn the crown (drag the knob round, clockwise): the
// ratchet clicks, the power reserve fills, the balance swings harder; let it
// run down and it stops, losing time like the real thing.

const BEAT = 6; // 21,600 vph: six beats a second
const RESERVE = 75; // seconds of running per full wind (sped up for the demo)

function gearPath(teeth: number, r: number, depth = r * 0.12) {
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.25) / teeth) * Math.PI * 2;
    const a2 = ((i + 0.5) / teeth) * Math.PI * 2;
    const a3 = ((i + 0.75) / teeth) * Math.PI * 2;
    const ro = r, ri = r - depth;
    pts.push(`${i ? "L" : "M"}${(Math.cos(a0) * ri).toFixed(2)} ${(Math.sin(a0) * ri).toFixed(2)}`);
    pts.push(`L${(Math.cos(a1) * ro).toFixed(2)} ${(Math.sin(a1) * ro).toFixed(2)}`);
    pts.push(`L${(Math.cos(a2) * ro).toFixed(2)} ${(Math.sin(a2) * ro).toFixed(2)}`);
    pts.push(`L${(Math.cos(a3) * ri).toFixed(2)} ${(Math.sin(a3) * ri).toFixed(2)}`);
  }
  return pts.join(" ") + "Z";
}

function Gear({ teeth, r, fill, spokes = 5, gRef }: { teeth: number; r: number; fill: string; spokes?: number; gRef?: React.Ref<SVGGElement> }) {
  return (
    <g ref={gRef}>
      <path d={gearPath(teeth, r)} fill={fill} />
      {Array.from({ length: spokes }, (_, i) => {
        const a = (i / spokes) * Math.PI * 2 + 0.3;
        return (
          <path
            key={i}
            d={`M0 0 L${(Math.cos(a - 0.35) * r * 0.72).toFixed(2)} ${(Math.sin(a - 0.35) * r * 0.72).toFixed(2)} A${(r * 0.72).toFixed(2)} ${(r * 0.72).toFixed(2)} 0 0 1 ${(Math.cos(a + 0.35) * r * 0.72).toFixed(2)} ${(Math.sin(a + 0.35) * r * 0.72).toFixed(2)} Z`}
            fill="rgba(0,0,0,0.55)"
          />
        );
      })}
      <circle r={r * 0.16} fill="#b8322e" />
      <circle r={r * 0.06} fill="#f2e3c0" />
    </g>
  );
}

type Layer = { id: string; z: number; label: string };
// built the way a real watch is: dial side down to the caseback
const LAYERS: Layer[] = [
  { id: "case", z: 0, label: "Case + sapphire caseback" },
  { id: "balance", z: 1, label: "Balance · 21,600 vph" },
  { id: "train", z: 2, label: "Barrel + gear train" },
  { id: "plate", z: 3, label: "Main plate · perlage" },
  { id: "dial", z: 4, label: "Dial + power reserve" },
  { id: "hands", z: 5, label: "Hands" },
  { id: "crystal", z: 6, label: "Sapphire crystal" },
];

export default function Watch({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [explode, setExplode] = useState(play ? 0.62 : 0);
  const [flip, setFlip] = useState(false);
  const [reserve, setReserve] = useState(play ? 0.12 : 0.7);
  const S = useRef({
    power: play ? 0.12 : 0.7,
    wt: 0,
    init: false,
    bal: 0,
    amp: 0,
    barrel: 0,
    crown: 0,
    orbit: { x: 0, y: 0 },
    dragging: false,
    last: { x: 0, y: 0 },
    knobA: null as number | null,
    clickAcc: 0,
    lastBeat: -1,
    explode: play ? 0.62 : 0,
    t: 0,
  });
  S.current.explode = play ? explode : S.current.explode;
  const r = {
    stage: useRef<HTMLDivElement>(null),
    layers: useRef<(HTMLDivElement | null)[]>([]),
    hour: useRef<SVGGElement>(null),
    min: useRef<SVGGElement>(null),
    sec: useRef<SVGGElement>(null),
    bal: useRef<SVGGElement>(null),
    spring: useRef<SVGPathElement>(null),
    escape: useRef<SVGGElement>(null),
    fourth: useRef<SVGGElement>(null),
    third: useRef<SVGGElement>(null),
    center: useRef<SVGGElement>(null),
    barrel: useRef<SVGGElement>(null),
    ratchet: useRef<SVGGElement>(null),
    reserveHand: useRef<SVGGElement>(null),
    crown3d: useRef<HTMLDivElement>(null),
    knob: useRef<HTMLDivElement>(null),
  };

  const loopRef = useVisibleLoop<HTMLDivElement>((dt) => {
    const s = S.current;
    if (!s.init) {
      const d = new Date();
      s.wt = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      s.init = true;
    }
    s.t += dt;
    if (!play && s.t > 0.2 && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!play) {
      // preview: breathe in and out of the exploded view, keep wound
      s.explode = 0.5 - 0.5 * Math.cos(s.t * 0.5);
      s.power = 0.7;
    }
    const running = s.power > 0;
    if (running) {
      s.wt += dt;
      s.power = Math.max(0, s.power - dt / RESERVE);
      s.barrel += dt * 0.08;
    }
    // balance: amplitude follows the power; it coasts to a stop when empty
    const targetAmp = running ? 0.45 + 0.55 * Math.sqrt(s.power) : 0;
    s.amp += (targetAmp - s.amp) * Math.min(1, dt * (running ? 3 : 1.2));
    s.bal = Math.sin(s.wt * Math.PI * BEAT) * s.amp * 250;
    const beat = Math.floor(s.wt * BEAT);
    if (running && beat !== s.lastBeat) {
      s.lastBeat = beat;
      if (play) {
        const au = getAudio();
        if (au && au.ctx.state === "running") burst(au, { freq: beat % 2 ? 4200 : 3600, q: 3, dur: 0.006, gain: 0.05 });
      }
    }
    const stepped = beat / BEAT; // the seconds hand moves in beats
    const sec = stepped % 60;
    const min = (s.wt / 60) % 60;
    const hr = (s.wt / 3600) % 12;
    const rot = (el: SVGGElement | null, deg: number, cx = 0, cy = 0) => el?.setAttribute("transform", `rotate(${deg.toFixed(2)} ${cx} ${cy})`);
    rot(r.sec.current, sec * 6);
    rot(r.min.current, min * 6);
    rot(r.hour.current, hr * 30);
    rot(r.bal.current, s.bal);
    rot(r.escape.current, -beat * (360 / 30));
    rot(r.fourth.current, sec * 6);
    rot(r.third.current, -min * 45);
    rot(r.center.current, min * 6);
    rot(r.barrel.current, -s.barrel * 57.3);
    rot(r.ratchet.current, s.crown * 0.6);
    rot(r.reserveHand.current, -60 + s.power * 120);
    r.spring.current?.setAttribute("transform", `rotate(${(s.bal * 0.25).toFixed(2)}) scale(${(1 + s.bal / 2500).toFixed(4)})`);
    if (r.crown3d.current) r.crown3d.current.style.backgroundPosition = `0 ${(s.crown * 0.3).toFixed(1)}px`;
    if (r.knob.current) r.knob.current.style.transform = `rotate(${s.crown.toFixed(1)}deg)`;

    // layout: view angle opens up as it explodes; you can orbit on top
    const e = s.explode;
    const rx = 22 + e * 36 + s.orbit.y;
    const rz = -e * 28 + s.orbit.x;
    const ry = flip ? 180 : 0;
    if (r.stage.current) r.stage.current.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
    r.layers.current.forEach((el, i) => {
      if (!el) return;
      const z = LAYERS[i].z;
      el.style.transform = `translateZ(calc(var(--d) * ${(z * 0.018 + e * (z - 3) * 0.17).toFixed(4)}))`;
      const label = el.querySelector<HTMLElement>("[data-label]");
      if (label) {
        label.style.opacity = String(Math.max(0, (e - 0.25) / 0.5));
        label.style.transform = `translate(-50%, -50%) rotateZ(${-rz}deg) rotateY(${-ry}deg) rotateX(${-rx}deg)`;
      }
    });
    if (play && Math.abs(s.power - reserve) > 0.02) setReserve(s.power);
  }, paused);

  const wind = (deg: number) => {
    const s = S.current;
    if (deg <= 0) {
      s.crown += deg * 0.3; // backwards just freewheels
      return;
    }
    s.crown += deg;
    s.clickAcc += deg;
    while (s.clickAcc >= 14) {
      s.clickAcc -= 14;
      if (s.power < 1) {
        s.power = Math.min(1, s.power + 0.018);
        const au = getAudio();
        if (au) burst(au, { freq: 5200, q: 4, dur: 0.012, gain: 0.3 });
      } else {
        const au = getAudio();
        if (au) burst(au, { freq: 1800, q: 2, dur: 0.02, gain: 0.15 }); // fully wound: the crown resists
      }
    }
    setReserve(s.power);
  };

  // knob: angle around its centre
  const knobDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const b = el.getBoundingClientRect();
    S.current.knobA = Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
  };
  const knobMove = (e: React.PointerEvent) => {
    const s = S.current;
    if (s.knobA === null) return;
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const a = Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
    let d = a - s.knobA;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    s.knobA = a;
    wind((d * 180) / Math.PI);
  };
  const knobUp = () => {
    S.current.knobA = null;
  };

  const orbitDown = (e: React.PointerEvent) => {
    if (!play) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    S.current.dragging = true;
    S.current.last = { x: e.clientX, y: e.clientY };
  };
  const orbitMove = (e: React.PointerEvent) => {
    const s = S.current;
    if (!s.dragging) return;
    s.orbit.x += (e.clientX - s.last.x) * 0.3;
    s.orbit.y = Math.max(-40, Math.min(30, s.orbit.y - (e.clientY - s.last.y) * 0.3));
    s.last = { x: e.clientX, y: e.clientY };
  };

  const D = "var(--d)";
  const disc = "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full";

  return (
    <div ref={loopRef} className={`absolute inset-0 flex ${play ? "flex-col md:flex-row" : ""} paper [container-type:size]`}>
      <div
        className="relative flex-1 min-h-0 overflow-hidden touch-none select-none"
        style={{ perspective: "1400px", ["--d" as string]: play ? "min(46cqh, 40cqw)" : "min(58cqh, 62cqw)" } as React.CSSProperties}
        onPointerDown={orbitDown}
        onPointerMove={orbitMove}
        onPointerUp={() => (S.current.dragging = false)}
      >
        <div ref={r.stage} className="absolute left-1/2 top-1/2 w-0 h-0" style={{ transformStyle: "preserve-3d" }}>
          {LAYERS.map((L, i) => (
            <div
              key={L.id}
              ref={(el) => {
                r.layers.current[i] = el;
              }}
              className="absolute left-0 top-0 w-0 h-0"
              style={{ transformStyle: "preserve-3d" }}
            >
              {L.id === "case" && (
                <>
                  {/* lugs */}
                  {[-1, 1].map((sy) => (
                    <div
                      key={sy}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[18%]"
                      style={{
                        width: `calc(${D} * 0.6)`,
                        height: `calc(${D} * 0.34)`,
                        top: `calc(${D} * ${sy * 0.5})`,
                        left: 0,
                        background: "linear-gradient(90deg,#8f8b83,#e9e6df 50%,#77736b)",
                      }}
                    />
                  ))}
                  <div className={disc} style={{ width: `calc(${D} * 1.12)`, height: `calc(${D} * 1.12)`, background: "linear-gradient(145deg,#e9e6df,#8f8b83 45%,#f4f2ec 70%,#6f6b63)", boxShadow: "0 30px 60px -20px rgba(13,16,14,0.55)" }} />
                  <div className={disc} style={{ width: `calc(${D} * 0.98)`, height: `calc(${D} * 0.98)`, background: "radial-gradient(circle at 40% 35%, rgba(58,61,64,0.18), rgba(18,19,20,0.32))", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.25)" }} />
                  {/* crown at 3 o'clock */}
                  <div
                    ref={r.crown3d}
                    className="absolute -translate-y-1/2 rounded-[30%]"
                    style={{
                      left: `calc(${D} * 0.54)`,
                      top: 0,
                      width: `calc(${D} * 0.1)`,
                      height: `calc(${D} * 0.18)`,
                      background: "repeating-linear-gradient(0deg,#d9d6cf 0 3px,#7d786e 3px 5px)",
                    }}
                  />
                </>
              )}
              {L.id === "plate" && (
                <div
                  className={disc}
                  style={{
                    width: `calc(${D} * 0.94)`,
                    height: `calc(${D} * 0.94)`,
                    background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.35) 0 6%, transparent 7%) 0 0/14% 14%, linear-gradient(135deg,#d8b46a,#a8823f 60%,#e2c27e)",
                  }}
                />
              )}
              {L.id === "train" && (
                <svg viewBox="-100 -100 200 200" className="absolute -translate-x-1/2 -translate-y-1/2 overflow-visible" style={{ width: `calc(${D} * 0.94)`, height: `calc(${D} * 0.94)` }}>
                  <g transform="translate(-30 -32)">
                    <circle r="34" fill="#c9a24f" />
                    <g ref={r.barrel}>
                      <path d={gearPath(60, 33, 3)} fill="#d6b05c" />
                      <circle r="26" fill="#b98f3e" />
                    </g>
                    <g ref={r.ratchet}>
                      <path d={gearPath(24, 18, 3)} fill="#e2e4e6" />
                      <circle r="5" fill="#9aa0a6" />
                      <path d="M-3 0h6" stroke="#55595e" strokeWidth="1.4" />
                    </g>
                  </g>
                  <g transform="translate(0 0)">
                    <Gear teeth={64} r={24} fill="#d6b05c" gRef={r.center} />
                  </g>
                  <g transform="translate(30 18)">
                    <Gear teeth={48} r={16} fill="#d9b867" spokes={4} gRef={r.third} />
                  </g>
                  <g transform="translate(14 44)">
                    <Gear teeth={40} r={14} fill="#d6b05c" spokes={4} gRef={r.fourth} />
                  </g>
                  <g transform="translate(48 44)">
                    <g ref={r.escape}>
                      {Array.from({ length: 15 }, (_, i) => (
                        <path key={i} d="M0 -11 L3 -14 L1 -9 Z" fill="#c7cbcf" transform={`rotate(${i * 24})`} />
                      ))}
                      <circle r="9" fill="none" stroke="#c7cbcf" strokeWidth="1.6" />
                      <circle r="2" fill="#b8322e" />
                    </g>
                  </g>
                </svg>
              )}
              {L.id === "balance" && (
                <svg viewBox="-100 -100 200 200" className="absolute -translate-x-1/2 -translate-y-1/2 overflow-visible" style={{ width: `calc(${D} * 0.94)`, height: `calc(${D} * 0.94)` }}>
                  {/* balance cock (bridge) */}
                  <path d="M40 30 L80 70 L66 82 L28 44 Z" fill="#cfd3d6" opacity="0.9" />
                  <g transform="translate(46 40)">
                    <path
                      ref={r.spring}
                      d={Array.from({ length: 80 }, (_, i) => {
                        const a = i * 0.45, rr = 2 + i * 0.16;
                        return `${i ? "L" : "M"}${(Math.cos(a) * rr).toFixed(2)} ${(Math.sin(a) * rr).toFixed(2)}`;
                      }).join(" ")}
                      fill="none"
                      stroke="#5a7fa8"
                      strokeWidth="0.6"
                    />
                    <g ref={r.bal}>
                      <circle r="19" fill="none" stroke="#d6b05c" strokeWidth="3.2" />
                      {[0, 1, 2].map((i) => (
                        <path key={i} d="M0 0 L0 -18" stroke="#d6b05c" strokeWidth="2" transform={`rotate(${i * 120})`} />
                      ))}
                      {Array.from({ length: 12 }, (_, i) => (
                        <circle key={i} r="1.1" cx={Math.cos((i / 12) * Math.PI * 2) * 19} cy={Math.sin((i / 12) * Math.PI * 2) * 19} fill="#f2e3c0" />
                      ))}
                      <circle r="2.4" fill="#b8322e" />
                    </g>
                  </g>
                </svg>
              )}
              {L.id === "dial" && (
                <svg viewBox="-100 -100 200 200" className="absolute -translate-x-1/2 -translate-y-1/2" style={{ width: `calc(${D} * 0.96)`, height: `calc(${D} * 0.96)` }}>
                  <defs>
                    <mask id={`dial-cut-${mode}`}>
                      <rect x="-100" y="-100" width="200" height="200" fill="white" />
                      {/* open heart at 7 o'clock shows the balance */}
                      <circle cx="46" cy="40" r="0" fill="black" />
                    </mask>
                  </defs>
                  <circle r="96" fill="#f4f0e6" />
                  <circle r="96" fill="url(#none)" />
                  {Array.from({ length: 60 }, (_, i) => (
                    <line key={i} x1="0" y1="-90" x2="0" y2={i % 5 ? -86 : -80} stroke="#0d100e" strokeWidth={i % 5 ? 0.6 : 1.6} transform={`rotate(${i * 6})`} />
                  ))}
                  {[12, 3, 6, 9].map((n, i) => (
                    <text key={n} x={[0, 66, 0, -66][i]} y={[-60, 4, 70, 4][i]} textAnchor="middle" fontSize="16" fontWeight="800" fontFamily="var(--font-display), sans-serif" style={{ fontStretch: "70%" }} fill="#0d100e">
                      {n}
                    </text>
                  ))}
                  <text y="-32" textAnchor="middle" fontSize="9" fontWeight="800" letterSpacing="1" fontFamily="var(--font-display), sans-serif" fill="#0d100e">
                    RP
                  </text>
                  {/* power reserve */}
                  <g transform="translate(0 34)">
                    <path d="M-18 6 A20 20 0 0 1 18 6" fill="none" stroke="#1d5e3f" strokeWidth="2" />
                    <text y="16" textAnchor="middle" fontSize="5" letterSpacing="1" fontFamily="var(--font-mono), monospace" fill="#1d5e3f">
                      RESERVE
                    </text>
                    <g ref={r.reserveHand}>
                      <path d="M0 2 L0 -16" stroke="#b8322e" strokeWidth="1.4" strokeLinecap="round" />
                    </g>
                    <circle r="2" fill="#0d100e" />
                  </g>
                </svg>
              )}
              {L.id === "hands" && (
                <svg viewBox="-100 -100 200 200" className="absolute -translate-x-1/2 -translate-y-1/2" style={{ width: `calc(${D} * 0.96)`, height: `calc(${D} * 0.96)` }}>
                  <g ref={r.hour}>
                    <path d="M0 -50 L4.5 0 L-4.5 0 Z" fill="#0d100e" />
                  </g>
                  <g ref={r.min}>
                    <path d="M0 -80 L3.6 0 L-3.6 0 Z" fill="#0d100e" />
                  </g>
                  <g ref={r.sec}>
                    <line x1="0" y1="18" x2="0" y2="-84" stroke="#1d5e3f" strokeWidth="1.2" />
                    <circle cy="-60" r="3" fill="#1d5e3f" />
                  </g>
                  <circle r="3.6" fill="#0d100e" stroke="#1d5e3f" strokeWidth="1.2" />
                </svg>
              )}
              {L.id === "crystal" && (
                <div
                  className={disc}
                  style={{
                    width: `calc(${D} * 0.98)`,
                    height: `calc(${D} * 0.98)`,
                    background: "linear-gradient(130deg, rgba(255,255,255,0.45), rgba(255,255,255,0.05) 40%, rgba(255,255,255,0) 60%, rgba(255,255,255,0.18))",
                    border: "1px solid rgba(255,255,255,0.5)",
                  }}
                />
              )}
              {play && (
                <span
                  data-label
                  className="hidden md:block absolute whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em] text-[#0d100e] bg-[rgba(242,234,215,0.85)] px-2 py-1 rounded"
                  style={{ left: `calc(${D} * 0.82)`, top: `calc(${D} * -0.3)`, opacity: 0 }}
                >
                  {L.label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {play && (
        <div className="shrink-0 md:w-[260px] p-4 md:p-6 flex md:flex-col items-center md:items-stretch gap-5 bg-[var(--ink)] text-[var(--paper)]">
          <div className="flex flex-col items-center gap-2">
            <div
              role="slider"
              tabIndex={0}
              data-autofocus
              aria-label="Crown. Drag it round clockwise, or press the up arrow, to wind the watch."
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(reserve * 100)}
              aria-valuetext={`Power reserve ${Math.round(reserve * 100)} percent`}
              onPointerDown={knobDown}
              onPointerMove={knobMove}
              onPointerUp={knobUp}
              onPointerCancel={knobUp}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === " ") {
                  e.preventDefault();
                  wind(42);
                }
              }}
              className="relative w-28 h-28 rounded-full cursor-grab active:cursor-grabbing touch-none select-none outline-offset-4"
              style={{ background: "radial-gradient(circle at 35% 30%, #f4f2ec, #8f8b83 70%)", boxShadow: "inset 0 -6px 12px rgba(0,0,0,0.35), 0 10px 20px -8px rgba(0,0,0,0.6)" }}
            >
              <div ref={r.knob} className="absolute inset-0 rounded-full" style={{ background: "repeating-conic-gradient(#6f6b63 0 4deg, #d9d6cf 4deg 9deg)", maskImage: "radial-gradient(circle, transparent 62%, black 63%)", WebkitMaskImage: "radial-gradient(circle, transparent 62%, black 63%)" }} />
              <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase tracking-[0.18em] text-[#0d100e]">Wind ↻</span>
            </div>
          </div>
          <div className="flex-1 md:flex-none w-full">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab]">Power reserve</p>
            <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-[var(--mint)] transition-[width] duration-150" style={{ width: `${reserve * 100}%` }} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-[#b5b6ab]">{reserve > 0 ? `${Math.round(reserve * RESERVE)}s left` : "Stopped. Wind it."}</p>
          </div>
          <label className="w-full font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab]">
            Explode
            <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} className="mt-2 w-full accent-[#8ad9a8]" />
          </label>
          <button type="button" onClick={() => setFlip((f) => !f)} aria-pressed={flip} className="h-10 px-4 rounded-full border border-white/20 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-white/10">
            {flip ? "Show the dial" : "Flip it over"}
          </button>
        </div>
      )}
    </div>
  );
}
