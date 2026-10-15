"use client";

import { useId, useState } from "react";

// Closet Organizer's architecture as a diagram you can interrogate: hover,
// tap or Tab to a stage and the panel says what it does. Every sentence below
// is checked against github.com/RohinPat/Closet-Org.
//
// Built from real <button>s laid over an SVG of the arrows, so it works with a
// keyboard and a screen reader. Two hand-placed layouts — a wide U for
// desktop, a tall one for phones — share the same nodes and state. Colours
// come from the surrounding section (--fg / --surface), so it sits on cream,
// green or ink without changes.

type NodeId =
  | "app" | "web" | "api" | "guard" | "cutout" | "clip" | "colour" | "db" | "rec" | "llm";

type Stage = { id: NodeId; label: string; sub: string; detail: string };

export const STAGES: Stage[] = [
  {
    id: "app",
    label: "Expo app",
    sub: "iOS · Android",
    detail:
      "React Native on Expo, 21 screens. Photos come from the camera or library; tokens live in the phone's secure store.",
  },
  {
    id: "web",
    label: "Web app",
    sub: "vanilla JS",
    detail: "Plain HTML, CSS and JavaScript, served by the same FastAPI process. Same API, same account.",
  },
  {
    id: "api",
    label: "FastAPI",
    sub: "one worker",
    detail:
      "Every route is a plain def, so slow work runs in FastAPI's threadpool instead of freezing the single uvicorn worker. JWT access tokens, rotating refresh tokens, bcrypt passwords.",
  },
  {
    id: "guard",
    label: "Upload guard",
    sub: "bytes → file",
    detail:
      "Streams the upload under a size cap, swaps the client's filename for a random one, identifies the format by its magic bytes, then re-opens it with Pillow to reject truncated files and decompression bombs.",
  },
  {
    id: "cutout",
    label: "Cutout",
    sub: "rembg · U²-Net",
    detail:
      "The small u2netp model removes the background, so colour is measured on the garment, not the floor behind it. If it can't load, a centre crop stands in.",
  },
  {
    id: "clip",
    label: "Tagging",
    sub: "CLIP ViT-B/32",
    detail:
      "Zero-shot: the photo is scored against text prompts for 18 categories and 5 styles, so no labelled data was needed. The same embedding flags things that look like something you already own.",
  },
  {
    id: "colour",
    label: "Colour",
    sub: "HSV vote",
    detail:
      "Up to 4,000 garment pixels each vote for one of 14 colour names by hue, saturation and brightness. The top one or two names win.",
  },
  {
    id: "db",
    label: "SQLite",
    sub: "WAL mode",
    detail:
      "One database file in WAL mode, foreign keys on, parameterised queries. Photos stay on disk, with a 480px WebP copy for grids.",
  },
  {
    id: "rec",
    label: "Outfits",
    sub: "rules + weather",
    detail:
      "Pairs tops, bottoms, dresses and shoes, scoring each on a colour-compatibility table, style, season and the day's weather from Open-Meteo. The search stops at 3,000 pairs.",
  },
  {
    id: "llm",
    label: "Stylist copy",
    sub: "Claude · optional",
    detail:
      "Writes a short message and one line of reasoning for outfits the rules already picked. It can't add clothes. With no API key, or on any error, local copy ships instead.",
  },
];

type Box = { x: number; y: number; w: number; h: number };
type Layout = {
  w: number;
  h: number;
  boxes: Record<NodeId, Box>;
  edges: { from: NodeId; to: NodeId; pts: [number, number][] }[];
  captions?: { x: number; y: number; text: string }[];
  /** where the explanation sits inside the drawing (desktop only) */
  panel?: Box;
};

const WIDE: Layout = {
  w: 1000,
  h: 384,
  boxes: {
    app: { x: 16, y: 84, w: 134, h: 72 },
    web: { x: 16, y: 228, w: 134, h: 72 },
    api: { x: 182, y: 40, w: 100, h: 304 },
    guard: { x: 314, y: 40, w: 150, h: 72 },
    cutout: { x: 488, y: 40, w: 150, h: 72 },
    clip: { x: 662, y: 40, w: 150, h: 72 },
    colour: { x: 836, y: 40, w: 148, h: 72 },
    db: { x: 836, y: 272, w: 148, h: 72 },
    rec: { x: 576, y: 272, w: 196, h: 72 },
    llm: { x: 314, y: 272, w: 196, h: 72 },
  },
  edges: [
    { from: "app", to: "api", pts: [[150, 120], [182, 120]] },
    { from: "web", to: "api", pts: [[150, 264], [182, 264]] },
    { from: "api", to: "guard", pts: [[282, 76], [314, 76]] },
    { from: "guard", to: "cutout", pts: [[464, 76], [488, 76]] },
    { from: "cutout", to: "clip", pts: [[638, 76], [662, 76]] },
    { from: "clip", to: "colour", pts: [[812, 76], [836, 76]] },
    { from: "colour", to: "db", pts: [[910, 112], [910, 272]] },
    { from: "db", to: "rec", pts: [[836, 308], [772, 308]] },
    { from: "rec", to: "llm", pts: [[576, 308], [510, 308]] },
    { from: "llm", to: "api", pts: [[314, 308], [282, 308]] },
  ],
  captions: [
    { x: 314, y: 26, text: "POST /api/upload-clothing" },
    { x: 314, y: 372, text: "GET /api/outfits/recommend · POST /api/ai-stylist" },
  ],
  panel: { x: 314, y: 136, w: 498, h: 112 },
};

const TALL: Layout = {
  w: 360,
  h: 486,
  boxes: {
    app: { x: 8, y: 8, w: 164, h: 56 },
    web: { x: 188, y: 8, w: 164, h: 56 },
    api: { x: 8, y: 98, w: 344, h: 52 },
    guard: { x: 8, y: 186, w: 164, h: 56 },
    cutout: { x: 8, y: 266, w: 164, h: 56 },
    clip: { x: 8, y: 346, w: 164, h: 56 },
    colour: { x: 8, y: 426, w: 164, h: 56 },
    llm: { x: 188, y: 186, w: 164, h: 56 },
    rec: { x: 188, y: 306, w: 164, h: 56 },
    db: { x: 188, y: 426, w: 164, h: 56 },
  },
  edges: [
    { from: "app", to: "api", pts: [[90, 64], [90, 98]] },
    { from: "web", to: "api", pts: [[270, 64], [270, 98]] },
    { from: "api", to: "guard", pts: [[90, 150], [90, 186]] },
    { from: "guard", to: "cutout", pts: [[90, 242], [90, 266]] },
    { from: "cutout", to: "clip", pts: [[90, 322], [90, 346]] },
    { from: "clip", to: "colour", pts: [[90, 402], [90, 426]] },
    { from: "colour", to: "db", pts: [[172, 454], [188, 454]] },
    { from: "db", to: "rec", pts: [[270, 426], [270, 362]] },
    { from: "rec", to: "llm", pts: [[270, 306], [270, 242]] },
    { from: "llm", to: "api", pts: [[270, 186], [270, 150]] },
  ],
};

const pct = (n: number, of: number) => `${(n / of) * 100}%`;

function Arrow({ pts, on, dim }: { pts: [number, number][]; on: boolean; dim: boolean }) {
  const [x1, y1] = pts[pts.length - 2];
  const [x2, y2] = pts[pts.length - 1];
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = 7;
  const head = [
    [x2, y2],
    [x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)],
    [x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45)],
  ]
    .map((p) => p.join(","))
    .join(" ");
  return (
    <g
      className="transition-opacity duration-200"
      style={{ opacity: on ? 1 : dim ? 0.25 : 0.7 }}
    >
      <polyline
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={on ? 2 : 1.5}
        vectorEffect="non-scaling-stroke"
      />
      <polygon points={head} fill="currentColor" />
    </g>
  );
}

function Drawing({
  layout,
  active,
  setActive,
  panelId,
  className,
  children,
}: {
  layout: Layout;
  active: NodeId | null;
  setActive: (id: NodeId) => void;
  panelId: string;
  className: string;
  children?: React.ReactNode;
}) {
  const { w, h } = layout;
  const touches = (e: Layout["edges"][number]) => active !== null && (e.from === active || e.to === active);
  return (
    <div className={`relative w-full [container-type:inline-size] ${className}`} style={{ aspectRatio: `${w} / ${h}` }}>
      <div className="absolute inset-0" style={{ ["--u" as string]: `calc(100cqw / ${w})` }}>
        <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 w-full h-full text-[var(--fg)]" aria-hidden="true">
          {layout.edges.map((e) => (
            <Arrow key={`${e.from}-${e.to}`} pts={e.pts} on={touches(e)} dim={active !== null && !touches(e)} />
          ))}
          {layout.captions?.map((c) => (
            <text
              key={c.text}
              x={c.x}
              y={c.y}
              fill="currentColor"
              opacity={0.75}
              style={{ font: `500 11.5px var(--font-mono), ui-monospace, monospace`, letterSpacing: "0.02em" }}
            >
              {c.text}
            </text>
          ))}
        </svg>

        {STAGES.map((s) => {
          const b = layout.boxes[s.id];
          const on = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              aria-controls={panelId}
              onMouseEnter={() => setActive(s.id)}
              onFocus={() => setActive(s.id)}
              onClick={() => setActive(s.id)}
              className={`pipe-node absolute flex flex-col justify-center text-left border transition-colors duration-200 ${
                on
                  ? "bg-[var(--fg)] text-[var(--surface)] border-[var(--fg)]"
                  : "bg-[var(--surface)] text-[var(--fg)] border-[var(--border-strong)] hover:border-[var(--fg)]"
              }`}
              style={{
                left: pct(b.x, w),
                top: pct(b.y, h),
                width: pct(b.w, w),
                height: pct(b.h, h),
                padding: "0 calc(var(--u) * 12)",
              }}
            >
              <span className="pipe-label">{s.label}</span>
              <span className="pipe-sub">{s.sub}</span>
            </button>
          );
        })}

        {layout.panel && (
          <div
            className="absolute flex items-center"
            style={{
              left: pct(layout.panel.x, w),
              top: pct(layout.panel.y, h),
              width: pct(layout.panel.w, w),
              height: pct(layout.panel.h, h),
            }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PipelineDiagram({ className = "" }: { className?: string }) {
  const [active, setActive] = useState<NodeId | null>(null);
  const uid = useId();
  const stage = STAGES.find((s) => s.id === active);

  const panel = (id: string) => (
    <div id={id} aria-live="polite" className="pipe-panel text-[0.95rem] leading-relaxed text-pretty">
      {stage ? (
        <>
          <p className="font-semibold text-[var(--fg)]">
            {stage.label} <span className="font-normal text-[var(--fg-muted)]">· {stage.sub}</span>
          </p>
          <p className="mt-1 text-[var(--fg-muted)]">{stage.detail}</p>
        </>
      ) : (
        <p className="text-[var(--fg-muted)]">
          A photo goes in along the top and outfits come out along the bottom.{" "}
          <span className="[@media(pointer:coarse)]:hidden">Hover or tab to a stage</span>
          <span className="hidden [@media(pointer:coarse)]:inline">Tap a stage</span> to see what it does.
        </p>
      )}
    </div>
  );

  return (
    <div className={className}>
      <Drawing
        layout={WIDE}
        active={active}
        setActive={setActive}
        panelId={`${uid}-wide`}
        className="hidden lg:block"
      >
        {panel(`${uid}-wide`)}
      </Drawing>
      <div className="lg:hidden">
        <Drawing layout={TALL} active={active} setActive={setActive} panelId={`${uid}-tall`} className="" />
        <div className="mt-5 min-h-[7.5rem]">{panel(`${uid}-tall`)}</div>
      </div>
    </div>
  );
}
