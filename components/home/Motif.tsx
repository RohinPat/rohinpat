// One small drawing per project, in currentColor so it works on any frame
// colour. Purely decorative — the frame's heading carries the meaning.

const SIZE = 240;

export default function Motif({ slug, className }: { slug: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      {MOTIFS[slug]?.() ?? <circle cx={120} cy={120} r={80} />}
    </svg>
  );
}

const MOTIFS: Record<string, () => JSX.Element> = {
  // Colour-theory swatches: a hue wheel of squares around a core.
  "closet-organizer": () => (
    <g>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const x = 120 + Math.cos(a) * 82 - 14;
        const y = 120 + Math.sin(a) * 82 - 14;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={28}
            height={28}
            fill={i % 3 === 0 ? "currentColor" : "none"}
            transform={`rotate(${(i / 12) * 360} ${x + 14} ${y + 14})`}
          />
        );
      })}
      <circle cx={120} cy={120} r={34} />
      <circle cx={120} cy={120} r={6} fill="currentColor" />
    </g>
  ),

  // Chat bubbles with a sentiment line underneath.
  aimessage: () => (
    <g>
      <path d="M30 52h120a14 14 0 0 1 14 14v24a14 14 0 0 1-14 14H58l-18 14v-14h-10a0 0 0 0 1 0 0V52z" />
      <path d="M210 120H96a14 14 0 0 0-14 14v20a14 14 0 0 0 14 14h88l18 14v-14h8z" fill="currentColor" />
      <path d="M30 210c22-18 34 6 56-8s30-26 52-10 34 2 52-6 20-4 20-4" strokeWidth={2.5} />
    </g>
  ),

  // Rides by hour of day — 24 bars.
  bluebikes: () => (
    <g>
      {[3, 2, 1, 1, 2, 5, 11, 19, 15, 9, 8, 10, 12, 11, 10, 12, 17, 22, 16, 11, 8, 7, 5, 4].map(
        (v, i) => (
          <rect
            key={i}
            x={14 + i * 9.2}
            y={200 - v * 7.5}
            width={6}
            height={v * 7.5}
            fill={v > 15 ? "currentColor" : "none"}
          />
        ),
      )}
      <line x1={10} y1={204} x2={230} y2={204} />
    </g>
  ),

  // A heartbeat on a strap.
  whoop: () => (
    <g>
      <rect x={20} y={88} width={200} height={64} rx={32} />
      <path
        d="M34 120h48l8-14 10 34 12-56 12 52 8-16h74"
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={206} cy={120} r={4} fill="currentColor" />
    </g>
  ),

  // A wireframe body mesh: stacked ellipses + meridians.
  siphox: () => (
    <g>
      {[40, 68, 96, 124, 152, 180, 204].map((y, i) => {
        const rx = [26, 44, 50, 46, 40, 34, 22][i];
        return <ellipse key={y} cx={120} cy={y} rx={rx} ry={7} />;
      })}
      <path d="M94 40c-20 60-20 120 4 164M146 40c20 60 20 120-4 164M120 33v178" />
    </g>
  ),

  // Detection boxes over a road.
  varidx: () => (
    <g>
      <path d="M60 220L104 30M180 220L136 30" />
      <path d="M120 40v20M120 90v24M120 146v30" strokeDasharray="0" />
      <rect x={62} y={150} width={44} height={34} strokeDasharray="5 4" />
      <rect x={138} y={92} width={34} height={26} fill="currentColor" />
      <rect x={94} y={58} width={22} height={18} strokeDasharray="5 4" />
      <text x={62} y={144} fontSize={11} fill="currentColor" stroke="none" fontFamily="monospace">
        car
      </text>
    </g>
  ),
};
