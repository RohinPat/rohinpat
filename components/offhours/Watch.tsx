"use client";

import { useRef, useState } from "react";
import { useVisibleLoop } from "./useVisibleLoop";
import type { PieceProps } from "./useCanvas";
import { burst, getAudio, modal } from "./audio";

// An automatic watch in fifteen parts, DOM + SVG in CSS 3D, stacked the way
// a real one is built: caseback, rotor, bridges, balance, escapement, gear
// train, barrel, main plate, case, dial, three hands, bezel, crystal. Pull it
// apart with the slider, orbit it by dragging (which swings the rotor, and
// the rotor winds the mainspring, as it would on your wrist), turn the crown
// to wind it by hand, pick a part to isolate it. Everything moves as it
// should: the balance at 21,600 vph, the pallet fork rocking each beat, the
// escape wheel stepping, the wheels turning, the mainspring coiling tighter
// as it's wound.

const BEAT = 6; // 21,600 vph
const RESERVE = 75; // seconds per full wind (sped up for the demo)

type Part = { id: string; label: string; note: string };
const PARTS: Part[] = [
  { id: "caseback", label: "Caseback", note: "Screw-down steel with a sapphire window, so the movement shows." },
  { id: "rotor", label: "Rotor", note: "The oscillating weight. Every swing of your wrist winds the mainspring. Orbit the watch to swing it." },
  { id: "bridges", label: "Bridges", note: "Hold the wheels in place. Côtes de Genève stripes, blued screws, ruby jewel bearings." },
  { id: "balance", label: "Balance + hairspring", note: "The timekeeper. Swings back and forth three times a second; the hairspring sets the rate." },
  { id: "escapement", label: "Escapement", note: "The pallet fork lets the escape wheel advance one tooth per beat and kicks the balance to keep it going." },
  { id: "train", label: "Gear train", note: "Center, third and fourth wheels step the mainspring's power down to the hands." },
  { id: "barrel", label: "Barrel + mainspring", note: "The power. The spring coils tighter as you wind; the ratchet and click stop it slipping back." },
  { id: "plate", label: "Main plate", note: "The movement's foundation, finished with perlage. The winding stem and keyless works sit here." },
  { id: "case", label: "Case + crown", note: "The middle case with lugs, crown and stem. The crown winds the barrel through the keyless works." },
  { id: "dial", label: "Dial", note: "Sunburst, applied indices, date at three, power-reserve indicator at six." },
  { id: "hour", label: "Hour hand", note: "Rides on the hour wheel, twelve times slower than the minute hand." },
  { id: "minute", label: "Minute hand", note: "Driven by the center wheel, once round an hour." },
  { id: "second", label: "Seconds hand", note: "Moves in six steps a second: the beat of the balance." },
  { id: "bezel", label: "Bezel", note: "Polished steel ring that holds the crystal." },
  { id: "crystal", label: "Crystal", note: "Domed sapphire with an anti-reflective coating (the blue cast)." },
];

// movement layout, in viewBox units (radius ~94)
const AT = {
  barrel: [-30, -34, 31],
  center: [0, 0, 22],
  third: [30, 18, 14],
  fourth: [8, 42, 13],
  escape: [-18, 54, 9],
  pallet: [-33, 52, 0],
  balance: [-52, 38, 20],
} as const;

function gearPath(teeth: number, r: number, depth = r * 0.12) {
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (k: number) => ((i + k) / teeth) * Math.PI * 2;
    const ro = r, ri = r - depth;
    pts.push(`${i ? "L" : "M"}${(Math.cos(a(0)) * ri).toFixed(2)} ${(Math.sin(a(0)) * ri).toFixed(2)}`);
    pts.push(`L${(Math.cos(a(0.22)) * ro).toFixed(2)} ${(Math.sin(a(0.22)) * ro).toFixed(2)}`);
    pts.push(`L${(Math.cos(a(0.48)) * ro).toFixed(2)} ${(Math.sin(a(0.48)) * ro).toFixed(2)}`);
    pts.push(`L${(Math.cos(a(0.7)) * ri).toFixed(2)} ${(Math.sin(a(0.7)) * ri).toFixed(2)}`);
  }
  return pts.join(" ") + "Z";
}
function spiral(turns: number, r0: number, r1: number, steps = 220) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = f * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * f;
    d += `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  }
  return d;
}

function Jewel({ x, y, r = 2.6 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r * 1.6} fill="#e9d9a8" />
      <circle r={r} fill="#b8202a" />
      <circle r={r * 0.4} cx={-r * 0.3} cy={-r * 0.3} fill="#ff8a8a" />
    </g>
  );
}
function Screw({ x, y, r = 3.2, a = 30 }: { x: number; y: number; r?: number; a?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${a})`}>
      <circle r={r} fill="#2c4f97" stroke="#1a2f5c" strokeWidth="0.5" />
      <rect x={-r} y={-0.45} width={r * 2} height={0.9} fill="#0f1b33" />
    </g>
  );
}
function Wheel({ teeth, r, gRef }: { teeth: number; r: number; gRef?: React.Ref<SVGGElement> }) {
  return (
    <g ref={gRef}>
      <path d={gearPath(teeth, r)} fill="#d8b25f" stroke="#9c7a33" strokeWidth="0.3" />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const ri = r * 0.28, ro = r * 0.74;
        return (
          <path
            key={i}
            d={`M${(Math.cos(a - 0.5) * ri).toFixed(2)} ${(Math.sin(a - 0.5) * ri).toFixed(2)} L${(Math.cos(a - 0.38) * ro).toFixed(2)} ${(Math.sin(a - 0.38) * ro).toFixed(2)} A${ro} ${ro} 0 0 1 ${(Math.cos(a + 0.38) * ro).toFixed(2)} ${(Math.sin(a + 0.38) * ro).toFixed(2)} L${(Math.cos(a + 0.5) * ri).toFixed(2)} ${(Math.sin(a + 0.5) * ri).toFixed(2)} Z`}
            fill="#2a2116"
          />
        );
      })}
      <path d={gearPath(8, r * 0.26, r * 0.07)} fill="#c9ccd0" />
      <circle r={r * 0.09} fill="#8a8f96" />
    </g>
  );
}

export default function Watch({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const uid = useRef(`w${Math.random().toString(36).slice(2, 7)}`).current;
  const [explode, setExplode] = useState(play ? 0.7 : 0);
  const [flip, setFlip] = useState(false);
  const [reserve, setReserve] = useState(play ? 0.15 : 0.7);
  const [solo, setSolo] = useState<string | null>(null);
  const S = useRef({
    power: play ? 0.15 : 0.7,
    wt: 0,
    init: false,
    amp: 0,
    barrel: 0,
    crown: 0,
    orbit: { x: 0, y: 0 },
    dragging: false,
    last: { x: 0, y: 0 },
    knobA: null as number | null,
    clickAcc: 0,
    lastBeat: -1,
    explode: play ? 0.7 : 0,
    t: 0,
    rotor: 0.6,
    rotorV: 0,
    springPower: -1,
  });
  if (play) S.current.explode = explode;
  const els = useRef<Record<string, Element | null>>({});
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const reg = (k: string) => (el: Element | null) => {
    els.current[k] = el;
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
      s.explode = 0.5 - 0.5 * Math.cos(s.t * 0.45);
      s.power = 0.7;
    }
    const running = s.power > 0;
    if (running) {
      s.wt += dt;
      s.power = Math.max(0, s.power - dt / RESERVE);
      s.barrel += dt * 0.06;
    }
    // rotor: a damped pendulum; it winds the spring both ways (a reverser)
    s.rotorV += -Math.sin(s.rotor) * 3.2 * dt;
    s.rotorV *= 1 - 0.9 * dt;
    s.rotor += s.rotorV * dt;
    if (play && Math.abs(s.rotorV) > 0.2) s.power = Math.min(1, s.power + Math.abs(s.rotorV) * dt * 0.006);

    const targetAmp = running ? 0.45 + 0.55 * Math.sqrt(s.power) : 0;
    s.amp += (targetAmp - s.amp) * Math.min(1, dt * (running ? 3 : 1.2));
    const bal = Math.sin(s.wt * Math.PI * BEAT) * s.amp * 250;
    const beat = Math.floor(s.wt * BEAT);
    if (running && beat !== s.lastBeat) {
      s.lastBeat = beat;
      if (play) {
        const au = getAudio();
        if (au && au.ctx.state === "running")
          modal(au, [[3800 + (beat % 2) * 500, 14, 0.06], [7200, 10, 0.03]], { gain: 0.6, excite: 0.0015, lowpass: 9000 });
      }
    }
    const sec = (beat / BEAT) % 60;
    const min = (s.wt / 60) % 60;
    const hr = (s.wt / 3600) % 12;
    const rot = (k: string, deg: number) => els.current[k]?.setAttribute("transform", `rotate(${deg.toFixed(2)})`);
    rot("sec", sec * 6);
    rot("min", min * 6);
    rot("hour", hr * 30);
    rot("bal", bal);
    rot("escape", -beat * 18);
    rot("pallet", running ? (beat % 2 ? 9 : -9) * Math.min(1, s.amp * 2) : 0);
    rot("fourth", sec * 6);
    rot("third", -min * 40);
    rot("center", min * 6);
    rot("barrel", -s.barrel * 57.3);
    rot("ratchet", s.crown * 0.5);
    rot("crownwheel", -s.crown * 0.9);
    rot("reserve", -70 + s.power * 140);
    rot("rotor", (s.rotor * 180) / Math.PI);
    els.current.hairspring?.setAttribute("transform", `rotate(${(bal * 0.22).toFixed(2)}) scale(${(1 + bal / 3000).toFixed(4)})`);
    // the mainspring coils tighter as it's wound
    if (Math.abs(s.power - s.springPower) > 0.01) {
      s.springPower = s.power;
      els.current.mainspring?.setAttribute("d", spiral(3.5 + s.power * 6, 7 + s.power * 3, 26 - s.power * 2));
    }
    if (knob.current) knob.current.style.transform = `rotate(${s.crown.toFixed(1)}deg)`;

    const e = s.explode;
    const rx = 20 + e * 40 + s.orbit.y;
    const rz = -e * 26 + s.orbit.x;
    const ry = flip ? 180 : 0;
    if (stage.current) stage.current.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
    const mid = (PARTS.length - 1) / 2;
    layers.current.forEach((el, i) => {
      if (!el) return;
      el.style.transform = `translateZ(calc(var(--d) * ${(i * 0.011 + e * (i - mid) * 0.085).toFixed(4)}))`;
      const label = el.querySelector<HTMLElement>("[data-label]");
      const leader = el.querySelector<HTMLElement>("[data-leader]");
      const show = String(Math.max(0, Math.min(1, (e - 0.3) / 0.35)));
      if (label) {
        label.style.opacity = show;
        label.style.transform = `translate(0, -50%) rotateZ(${-rz}deg) rotateY(${-ry}deg) rotateX(${-rx}deg)`;
      }
      if (leader) leader.style.opacity = show;
    });
    if (play && Math.abs(s.power - reserve) > 0.01) setReserve(s.power);
  }, paused);

  const wind = (deg: number) => {
    const s = S.current;
    if (deg <= 0) {
      s.crown += deg * 0.3;
      return;
    }
    s.crown += deg;
    s.clickAcc += deg;
    while (s.clickAcc >= 14) {
      s.clickAcc -= 14;
      const au = getAudio();
      if (s.power < 1) {
        s.power = Math.min(1, s.power + 0.018);
        if (au) modal(au, [[4600, 12, 0.25], [9000, 8, 0.1], [1900, 6, 0.08]], { excite: 0.002, gain: 0.7, lowpass: 12000 });
      } else if (au) burst(au, { freq: 1600, q: 2, dur: 0.02, gain: 0.12 });
    }
    setReserve(s.power);
  };

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
  const orbitDown = (e: React.PointerEvent) => {
    if (!play || (e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    S.current.dragging = true;
    S.current.last = { x: e.clientX, y: e.clientY };
  };
  const orbitMove = (e: React.PointerEvent) => {
    const s = S.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.last.x;
    s.orbit.x += dx * 0.3;
    s.orbit.y = Math.max(-40, Math.min(30, s.orbit.y - (e.clientY - s.last.y) * 0.3));
    s.rotorV += dx * 0.02; // swinging the watch swings the rotor
    s.last = { x: e.clientX, y: e.clientY };
  };

  const D = "var(--d)";
  const box = (k: number) => ({ width: `calc(${D} * ${k})`, height: `calc(${D} * ${k})` });
  const center = "absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2";
  const svg = (k: number, children: React.ReactNode) => (
    <svg viewBox="-100 -100 200 200" className={`${center} overflow-visible`} style={box(k)} aria-hidden="true">
      {children}
    </svg>
  );

  const art: Record<string, React.ReactNode> = {
    caseback: svg(
      1.08,
      <>
        <circle r="96" fill={`url(#${uid}-steel)`} />
        <circle r="70" fill="rgba(160,190,210,0.16)" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return <Screw key={i} x={Math.cos(a) * 83} y={Math.sin(a) * 83} r={3.4} a={i * 40} />;
        })}
        <path id={`${uid}-arc`} d="M-76 0 A76 76 0 0 1 76 0" fill="none" />
        <text fontSize="6" letterSpacing="2" fill="#4a4a4a" fontFamily="var(--font-mono), monospace">
          <textPath href={`#${uid}-arc`} startOffset="50%" textAnchor="middle">
            RP · AUTOMATIC · 21,600 VPH · SAPPHIRE
          </textPath>
        </text>
      </>,
    ),
    rotor: svg(
      0.94,
      <g ref={reg("rotor")}>
        <path d="M-88 0 A88 88 0 0 1 88 0 L60 0 A60 60 0 0 0 -60 0 Z" fill={`url(#${uid}-cotes)`} stroke="#9c7a33" strokeWidth="0.6" />
        <path d="M-60 0 A60 60 0 0 1 60 0 L14 0 L0 -12 L-14 0 Z" fill="#cfd3d8" opacity="0.92" />
        <text y="-66" textAnchor="middle" fontSize="6.5" letterSpacing="2.4" fill="#5b4520" fontFamily="var(--font-mono), monospace">
          ROHIN PATEL
        </text>
        <circle r="12" fill="#c9ccd0" stroke="#8a8f96" strokeWidth="0.8" />
        {Array.from({ length: 10 }, (_, i) => (
          <circle key={i} r="1.4" cx={Math.cos((i / 10) * Math.PI * 2) * 8} cy={Math.sin((i / 10) * Math.PI * 2) * 8} fill="#eef0f2" />
        ))}
        <Screw x={0} y={0} r={3} />
      </g>,
    ),
    bridges: svg(
      0.94,
      <>
        <path d="M-70 -54 C-66 -78 -10 -80 4 -58 C14 -40 4 -14 -20 -6 C-46 2 -74 -24 -70 -54 Z" fill={`url(#${uid}-cotes)`} stroke="#9c7a33" strokeWidth="0.6" />
        <path d="M-12 8 C4 -6 46 0 50 22 C54 44 30 62 -4 62 C-24 62 -30 40 -24 26 C-20 16 -18 12 -12 8 Z" fill={`url(#${uid}-cotes)`} stroke="#9c7a33" strokeWidth="0.6" />
        <path d="M-52 38 L-82 12 C-88 6 -94 24 -88 30 L-62 52 Z" fill={`url(#${uid}-cotes)`} stroke="#9c7a33" strokeWidth="0.6" />
        <Jewel x={AT.barrel[0]} y={AT.barrel[1]} r={3.4} />
        <Jewel x={AT.third[0]} y={AT.third[1]} />
        <Jewel x={AT.fourth[0]} y={AT.fourth[1]} />
        <Jewel x={AT.center[0]} y={AT.center[1]} />
        <Jewel x={AT.escape[0]} y={AT.escape[1]} r={2} />
        <Jewel x={AT.balance[0]} y={AT.balance[1]} r={2.2} />
        <Screw x={-60} y={-60} />
        <Screw x={-8} y={-62} />
        <Screw x={-30} y={-12} />
        <Screw x={40} y={8} />
        <Screw x={22} y={56} />
        <Screw x={-82} y={22} r={2.6} />
        <text x="-36" y="-44" fontSize="4.6" letterSpacing="1" fill="#5b4520" fontFamily="var(--font-mono), monospace">
          25 JEWELS
        </text>
      </>,
    ),
    balance: svg(
      0.94,
      <g transform={`translate(${AT.balance[0]} ${AT.balance[1]})`}>
        <path ref={reg("hairspring")} d={spiral(9, 2.5, 13)} fill="none" stroke="#5f86b8" strokeWidth="0.45" />
        <g ref={reg("bal")}>
          <circle r={AT.balance[2]} fill="none" stroke="#d8b25f" strokeWidth="3" />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M0 0 L0 ${-AT.balance[2] + 1}`} stroke="#d8b25f" strokeWidth="1.8" transform={`rotate(${i * 120 + 30})`} />
          ))}
          {Array.from({ length: 16 }, (_, i) => (
            <circle
              key={i}
              r="1"
              cx={Math.cos((i / 16) * Math.PI * 2) * (AT.balance[2] + 1.6)}
              cy={Math.sin((i / 16) * Math.PI * 2) * (AT.balance[2] + 1.6)}
              fill="#f2e3c0"
            />
          ))}
          <circle r="2.2" fill="#b8202a" />
        </g>
        <path d="M0 0 L26 -10" stroke="#c9ccd0" strokeWidth="1.4" strokeLinecap="round" />
        <text x="28" y="-12" fontSize="4" fill="#5b4520" fontFamily="var(--font-mono), monospace">
          + −
        </text>
      </g>,
    ),
    escapement: svg(
      0.94,
      <>
        <g transform={`translate(${AT.escape[0]} ${AT.escape[1]})`}>
          <g ref={reg("escape")}>
            {Array.from({ length: 20 }, (_, i) => (
              <path key={i} d="M0 -7 L2.2 -10.5 L1 -6 Z" fill="#c9ccd0" transform={`rotate(${i * 18})`} />
            ))}
            <circle r="7" fill="none" stroke="#c9ccd0" strokeWidth="1.2" />
            <circle r="1.6" fill="#8a8f96" />
          </g>
        </g>
        <g transform={`translate(${AT.pallet[0]} ${AT.pallet[1]})`}>
          <g ref={reg("pallet")}>
            <path d="M0 0 L-13 -10 M0 0 L10 -4 M0 0 L10 6" stroke="#c9ccd0" strokeWidth="2" strokeLinecap="round" />
            <rect x="9" y="-6" width="3" height="2.4" fill="#b8202a" />
            <rect x="9" y="5" width="3" height="2.4" fill="#b8202a" />
            <path d="M-13 -10 l-3 -1 l1 3 z" fill="#c9ccd0" />
            <circle r="1.8" fill="#8a8f96" />
          </g>
        </g>
      </>,
    ),
    train: svg(
      0.94,
      <>
        <g transform={`translate(${AT.center[0]} ${AT.center[1]})`}>
          <Wheel teeth={72} r={AT.center[2]} gRef={reg("center")} />
        </g>
        <g transform={`translate(${AT.third[0]} ${AT.third[1]})`}>
          <Wheel teeth={56} r={AT.third[2]} gRef={reg("third")} />
        </g>
        <g transform={`translate(${AT.fourth[0]} ${AT.fourth[1]})`}>
          <Wheel teeth={48} r={AT.fourth[2]} gRef={reg("fourth")} />
        </g>
      </>,
    ),
    barrel: svg(
      0.94,
      <g transform={`translate(${AT.barrel[0]} ${AT.barrel[1]})`}>
        <g ref={reg("barrel")}>
          <path d={gearPath(84, AT.barrel[2], 2.6)} fill="#d8b25f" stroke="#9c7a33" strokeWidth="0.3" />
          <circle r={AT.barrel[2] - 3} fill="#3a3024" />
        </g>
        <path ref={reg("mainspring")} d={spiral(4.4, 8, 26)} fill="none" stroke="#c9ccd0" strokeWidth="0.9" />
        <g ref={reg("ratchet")}>
          <path d={gearPath(28, 12, 2.4)} fill="#dfe2e6" stroke="#8a8f96" strokeWidth="0.3" />
          <circle r="3.4" fill="#8a8f96" />
          <rect x="-3" y="-0.6" width="6" height="1.2" fill="#4a4f56" />
        </g>
        <path d="M14 -6 L22 -14 L24 -10 Z" fill="#c9ccd0" />
      </g>,
    ),
    plate: svg(
      0.96,
      <>
        <circle r="94" fill={`url(#${uid}-perlage)`} />
        {Object.values(AT).map((p, i) => (
          <Jewel key={i} x={p[0]} y={p[1]} r={1.9} />
        ))}
        <rect x="46" y="-2" width="50" height="4" rx="1.5" fill="#c9ccd0" />
        <g transform="translate(62 -14)">
          <g ref={reg("crownwheel")}>
            <path d={gearPath(20, 9, 2)} fill="#dfe2e6" stroke="#8a8f96" strokeWidth="0.3" />
            <circle r="2" fill="#8a8f96" />
          </g>
        </g>
        <path d="M58 10 L80 24 L76 30 L54 16 Z" fill="#c9ccd0" />
        <Screw x={70} y={24} r={2.4} />
      </>,
    ),
    case: (
      <>
        {[-1, 1].map((sy) => (
          <div
            key={sy}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[18%]"
            style={{ width: `calc(${D} * 0.6)`, height: `calc(${D} * 0.34)`, top: `calc(${D} * ${sy * 0.5})`, left: 0, background: "linear-gradient(90deg,#8f8b83,#eceae4 50%,#77736b)" }}
          />
        ))}
        <div
          className={`${center} rounded-full`}
          style={{
            ...box(1.1),
            background: "radial-gradient(circle, transparent 0 63%, #e9e6df 64%, #8f8b83 78%, #f4f2ec 88%, #6f6b63 100%)",
            boxShadow: "0 30px 60px -20px rgba(13,16,14,0.45)",
          }}
        />
        <div className="absolute -translate-y-1/2" style={{ left: `calc(${D} * 0.3)`, top: 0, width: `calc(${D} * 0.28)`, height: `calc(${D} * 0.025)`, background: "#c9ccd0" }} />
        <div
          className="absolute -translate-y-1/2 rounded-[30%]"
          style={{ left: `calc(${D} * 0.56)`, top: 0, width: `calc(${D} * 0.1)`, height: `calc(${D} * 0.18)`, background: "repeating-linear-gradient(0deg,#e1ded7 0 3px,#7d786e 3px 5px)" }}
        />
      </>
    ),
    dial: svg(
      0.92,
      <>
        <circle r="96" fill={`url(#${uid}-sunburst)`} />
        {Array.from({ length: 60 }, (_, i) => (
          <line key={i} x1="0" y1="-91" x2="0" y2={i % 5 ? -87 : -84} stroke="#0d100e" strokeWidth={i % 5 ? 0.5 : 1.2} transform={`rotate(${i * 6})`} />
        ))}
        {Array.from({ length: 12 }, (_, i) =>
          i === 0 || i === 3 || i === 6 ? null : (
            <g key={i} transform={`rotate(${i * 30})`}>
              <rect x="-2.6" y="-80" width="5.2" height="16" rx="1" fill="#d9d6cf" stroke="#77736b" strokeWidth="0.5" />
              <rect x="-0.9" y="-78" width="1.8" height="12" fill="#e9f7ee" />
            </g>
          ),
        )}
        <text y="-56" textAnchor="middle" fontSize="20" fontWeight="800" fontFamily="var(--font-display), sans-serif" style={{ fontStretch: "70%" }} fill="#0d100e">
          12
        </text>
        <text y="-30" textAnchor="middle" fontSize="9" fontWeight="800" letterSpacing="1" fontFamily="var(--font-display), sans-serif" fill="#0d100e">
          RP
        </text>
        <text y="-21" textAnchor="middle" fontSize="4.2" letterSpacing="1.6" fontFamily="var(--font-mono), monospace" fill="#1d5e3f">
          AUTOMATIC
        </text>
        <rect x="58" y="-7" width="20" height="14" rx="1.2" fill="#fff" stroke="#77736b" strokeWidth="0.6" />
        <text x="68" y="3.4" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono), monospace" fill="#0d100e" suppressHydrationWarning>
          {new Date().getDate()}
        </text>
        <g transform="translate(0 46)">
          <path d="M-20 4 A21 21 0 0 1 20 4" fill="none" stroke="#1d5e3f" strokeWidth="1.6" />
          {[-60, -30, 0, 30, 60].map((a) => (
            <line key={a} x1="0" y1="-21" x2="0" y2="-17" stroke="#0d100e" strokeWidth="0.7" transform={`rotate(${a})`} />
          ))}
          <text y="12" textAnchor="middle" fontSize="4.4" letterSpacing="1.2" fontFamily="var(--font-mono), monospace" fill="#1d5e3f">
            RESERVE
          </text>
          <g ref={reg("reserve")}>
            <path d="M0 2 L0 -17" stroke="#b8322e" strokeWidth="1.3" strokeLinecap="round" />
          </g>
          <circle r="2" fill="#0d100e" />
        </g>
      </>,
    ),
    hour: svg(
      0.92,
      <g ref={reg("hour")}>
        <path d="M0 -52 L5 -6 L0 6 L-5 -6 Z" fill="#1b1d1c" />
        <path d="M0 -46 L1.8 -12 L-1.8 -12 Z" fill="#e9f7ee" />
        <circle r="5" fill="#1b1d1c" />
      </g>,
    ),
    minute: svg(
      0.92,
      <g ref={reg("min")}>
        <path d="M0 -82 L4 -6 L0 8 L-4 -6 Z" fill="#1b1d1c" />
        <path d="M0 -76 L1.4 -14 L-1.4 -14 Z" fill="#e9f7ee" />
        <circle r="4" fill="#1b1d1c" />
      </g>,
    ),
    second: svg(
      0.92,
      <g ref={reg("sec")}>
        <line x1="0" y1="22" x2="0" y2="-86" stroke="#1d5e3f" strokeWidth="1.1" />
        <circle cy="-62" r="3" fill="none" stroke="#1d5e3f" strokeWidth="1.2" />
        <rect x="-2" y="10" width="4" height="14" rx="1.5" fill="#1d5e3f" />
        <circle r="2.6" fill="#1d5e3f" />
      </g>,
    ),
    bezel: svg(
      1.02,
      <>
        <circle r="96" fill="none" stroke={`url(#${uid}-steel)`} strokeWidth="9" />
        <circle r="91.5" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
      </>,
    ),
    crystal: svg(
      0.96,
      <>
        <circle r="94" fill={`url(#${uid}-ar)`} />
        <path d="M-60 -50 A80 80 0 0 1 40 -76" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" />
      </>,
    ),
  };

  const active = PARTS.find((p) => p.id === solo);

  return (
    <div ref={loopRef} className={`absolute inset-0 flex ${play ? "flex-col md:flex-row" : ""} paper [container-type:size]`}>
      {/* shared paint: steel, stripes, perlage, sunburst, AR coating */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-steel`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f4f2ec" />
            <stop offset="0.45" stopColor="#8f8b83" />
            <stop offset="0.7" stopColor="#efede7" />
            <stop offset="1" stopColor="#6f6b63" />
          </linearGradient>
          <pattern id={`${uid}-cotes`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
            <rect width="12" height="12" fill="#cba45a" />
            <rect width="6" height="12" fill="#e2c27e" />
            <rect x="5.4" width="1.2" height="12" fill="#a9853f" />
          </pattern>
          <radialGradient id={`${uid}-pearl`}>
            <stop offset="0" stopColor="#f2dca2" />
            <stop offset="0.6" stopColor="#c9a24f" />
            <stop offset="1" stopColor="#9c7a33" />
          </radialGradient>
          <pattern id={`${uid}-perlage`} width="9" height="9" patternUnits="userSpaceOnUse">
            <rect width="9" height="9" fill="#c9a24f" />
            <circle cx="4.5" cy="4.5" r="5" fill={`url(#${uid}-pearl)`} />
          </pattern>
          <radialGradient id={`${uid}-sunburst`} cx="0.45" cy="0.35">
            <stop offset="0" stopColor="#fbf8f0" />
            <stop offset="0.7" stopColor="#ece6d6" />
            <stop offset="1" stopColor="#d9d1bd" />
          </radialGradient>
          <radialGradient id={`${uid}-ar`} cx="0.35" cy="0.3">
            <stop offset="0" stopColor="rgba(255,255,255,0.32)" />
            <stop offset="0.6" stopColor="rgba(150,180,255,0.08)" />
            <stop offset="1" stopColor="rgba(90,120,220,0.2)" />
          </radialGradient>
        </defs>
      </svg>

      <div
        className="relative flex-1 min-h-0 overflow-hidden touch-none select-none"
        style={{ perspective: "1600px", ["--d" as string]: play ? "min(34cqh, 30cqw)" : "min(46cqh, 54cqw)" } as React.CSSProperties}
        onPointerDown={orbitDown}
        onPointerMove={orbitMove}
        onPointerUp={() => (S.current.dragging = false)}
      >
        <div ref={stage} className="absolute left-1/2 top-1/2 w-0 h-0" style={{ transformStyle: "preserve-3d" }}>
          {PARTS.map((p, i) => (
            <div
              key={p.id}
              ref={(el) => {
                layers.current[i] = el;
              }}
              className="absolute left-0 top-0 w-0 h-0 transition-opacity duration-300"
              style={{ transformStyle: "preserve-3d", opacity: solo && solo !== p.id ? 0.1 : 1 }}
            >
              {art[p.id]}
              {play && (
                <>
                  {/* a leader line in the part's plane, then a label that faces you */}
                  <div
                    data-leader
                    className="hidden md:block absolute h-px bg-[#0d100e]/50"
                    style={{ left: `calc(${D} * 0.5)`, top: 0, width: `calc(${D} * 0.42)`, opacity: 0 }}
                  />
                  <button
                    type="button"
                    data-label
                    tabIndex={-1}
                    onClick={() => setSolo(solo === p.id ? null : p.id)}
                    className={`hidden md:block absolute whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded ${
                      solo === p.id ? "bg-[#0d100e] text-[#f2ead7]" : "bg-[rgba(242,234,215,0.92)] text-[#0d100e]"
                    }`}
                    style={{ left: `calc(${D} * 0.93)`, top: 0, opacity: 0 }}
                  >
                    {p.label}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {play && (
        <div className="shrink-0 md:w-[280px] p-4 md:p-5 flex md:flex-col items-center md:items-stretch gap-4 bg-[var(--ink)] text-[var(--paper)] overflow-y-auto">
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
              onPointerUp={() => (S.current.knobA = null)}
              onPointerCancel={() => (S.current.knobA = null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === " ") {
                  e.preventDefault();
                  wind(42);
                }
              }}
              className="relative w-24 h-24 rounded-full cursor-grab active:cursor-grabbing touch-none select-none outline-offset-4"
              style={{ background: "radial-gradient(circle at 35% 30%, #f4f2ec, #8f8b83 70%)", boxShadow: "inset 0 -6px 12px rgba(0,0,0,0.35), 0 10px 20px -8px rgba(0,0,0,0.6)" }}
            >
              <div
                ref={knob}
                className="absolute inset-0 rounded-full"
                style={{
                  background: "repeating-conic-gradient(#6f6b63 0 4deg, #d9d6cf 4deg 9deg)",
                  maskImage: "radial-gradient(circle, transparent 62%, black 63%)",
                  WebkitMaskImage: "radial-gradient(circle, transparent 62%, black 63%)",
                }}
              />
              <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase tracking-[0.18em] text-[#0d100e]">Wind ↻</span>
            </div>
          </div>
          <div className="flex-1 md:flex-none w-full">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab]">Power reserve</p>
            <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-[var(--mint)] transition-[width] duration-150" style={{ width: `${reserve * 100}%` }} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-[#b5b6ab]">{reserve > 0 ? `${Math.round(reserve * RESERVE)}s left · orbit it to swing the rotor` : "Stopped. Wind it."}</p>
          </div>
          <label className="w-full font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab]">
            Explode
            <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} className="mt-2 w-full accent-[#8ad9a8]" />
          </label>
          <button type="button" onClick={() => setFlip((f) => !f)} aria-pressed={flip} className="h-9 px-4 rounded-full border border-white/20 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-white/10">
            {flip ? "Show the dial" : "Flip it over"}
          </button>
          <div className="hidden md:block">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#b5b6ab] mb-2">Parts · pick one</p>
            <ul className="grid grid-cols-1 gap-0.5">
              {[...PARTS].reverse().map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={solo === p.id}
                    onClick={() => {
                      setSolo(solo === p.id ? null : p.id);
                      if (explode < 0.5) setExplode(0.8);
                    }}
                    className={`w-full text-left px-2 py-1 rounded text-[12px] ${solo === p.id ? "bg-[var(--paper)] text-[var(--ink)]" : "hover:bg-white/10"}`}
                  >
                    {p.label}
                  </button>
                </li>
              ))}
            </ul>
            <p aria-live="polite" className="mt-3 text-[12px] leading-snug text-[#cfd0c6] min-h-[3.5em]">
              {active?.note ?? "Pick a part to isolate it."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
