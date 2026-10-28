// Three drawings for the phone-link write-up (app/projects/phone-link). Plain
// inline SVG, no script: each is a labelled image (role="img" with a title and
// a description), drawn in the surrounding section's colours (--fg, --surface,
// --accent-text) so it follows the page. All three share one 360-unit-wide
// grid, so the text is 11 to 13 px on a phone and the figure is capped on a
// desktop instead of being blown up.

type Pt = [number, number];

const FONT_SANS = "inherit";
const FONT_MONO = "var(--font-mono), ui-monospace, monospace";

function Frame({
  id,
  w,
  h,
  title,
  desc,
  children,
}: {
  id: string;
  w: number;
  h: number;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="schematic border border-[var(--border-strong)] rounded-md p-3 sm:p-5">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
        className="block w-full h-auto mx-auto max-w-[30rem] text-[var(--fg)]"
      >
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>{desc}</desc>
        {children}
      </svg>
    </div>
  );
}

/** A line with an arrowhead at its end (and at its start, if `both`). */
function Arrow({ from, to, dashed = false, both = false, strong = false }: { from: Pt; to: Pt; dashed?: boolean; both?: boolean; strong?: boolean }) {
  const head = (a: Pt, b: Pt) => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const s = 6.5;
    const pts = [
      b,
      [b[0] - s * Math.cos(ang - 0.45), b[1] - s * Math.sin(ang - 0.45)],
      [b[0] - s * Math.cos(ang + 0.45), b[1] - s * Math.sin(ang + 0.45)],
    ]
      .map((p) => p.join(","))
      .join(" ");
    return <polygon points={pts} fill="currentColor" />;
  };
  return (
    <g>
      <line
        x1={from[0]}
        y1={from[1]}
        x2={to[0]}
        y2={to[1]}
        stroke="currentColor"
        strokeWidth={strong ? 2 : 1.5}
        strokeDasharray={dashed ? "5 4" : undefined}
      />
      {head(from, to)}
      {both && head(to, from)}
    </g>
  );
}

function Box({ x, y, w, h, label, sub, solid = false }: { x: number; y: number; w: number; h: number; label: string; sub?: string; solid?: boolean }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={solid ? "var(--fg)" : "var(--surface)"}
        stroke={solid ? "var(--fg)" : "var(--border-strong)"}
        strokeWidth={1.5}
      />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 3 : y + h / 2 + 5}
        textAnchor="middle"
        fill={solid ? "var(--surface)" : "currentColor"}
        style={{ font: `600 14px ${FONT_SANS}` }}
      >
        {label}
      </text>
      {sub && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 13}
          textAnchor="middle"
          fill={solid ? "var(--surface)" : "currentColor"}
          opacity={0.8}
          style={{ font: `500 11px ${FONT_MONO}` }}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

/** Text with a surface-coloured backing so a line can pass behind it. */
function Label({ x, y, children, anchor = "middle", mono = true, size = 12, accent = false }: { x: number; y: number; children: string; anchor?: "start" | "middle" | "end"; mono?: boolean; size?: number; accent?: boolean }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={accent ? "var(--accent-text)" : "currentColor"}
      paintOrder="stroke"
      stroke="var(--surface)"
      strokeWidth={5}
      strokeLinejoin="round"
      style={{ font: `${mono ? 500 : 600} ${size}px ${mono ? FONT_MONO : FONT_SANS}` }}
    >
      {children}
    </text>
  );
}

// ---------------------------------------------------------------------------
// 1. Pairing: who says what, in order.
// ---------------------------------------------------------------------------

export function PairingDiagram() {
  const L = 60;
  const R = 180;
  const P = 300;
  const steps: { y: number; n: string; text: string; from: number; to: number; dashed?: boolean; both?: boolean }[] = [
    { y: 92, n: "1", text: "host", from: L, to: R },
    { y: 126, n: "2", text: "room K7QF2X", from: R, to: L },
    { y: 160, n: "3", text: "scan /p#c=K7QF2X", from: L, to: P, dashed: true },
    { y: 198, n: "4", text: "join K7QF2X", from: P, to: R },
    { y: 232, n: "5", text: "joined", from: R, to: P },
    { y: 266, n: "6", text: "peer joined", from: R, to: L },
    { y: 304, n: "7", text: "hello, then tilt and taps", from: P, to: L },
    { y: 342, n: "8", text: "direct WebRTC, if it opens", from: L, to: P, dashed: true, both: true },
  ];
  return (
    <Frame
      id="pairing"
      w={360}
      h={366}
      title="How a phone pairs with the laptop"
      desc="Three lanes: the laptop, the relay and the phone. One, the laptop asks the relay to host. Two, the relay answers with a five-character room code. Three, the visitor scans the QR code, which holds the page address and the code. Four, the phone asks the relay to join that code. Five, the relay tells the phone it joined. Six, the relay tells the laptop a peer joined. Seven, the phone says hello and then streams tilt and taps through the relay. Eight, the two devices try a direct WebRTC connection."
    >
      <Box x={12} y={8} w={96} h={44} label="Laptop" sub="the site" solid />
      <Box x={132} y={8} w={96} h={44} label="Relay" sub="/api/link" />
      <Box x={252} y={8} w={96} h={44} label="Phone" sub="/p" solid />
      {[L, R, P].map((x) => (
        <line key={x} x1={x} y1={52} x2={x} y2={362} stroke="currentColor" strokeWidth={1} strokeDasharray="2 4" opacity={0.45} />
      ))}
      {steps.map((s) => (
        <g key={s.n}>
          <Arrow from={[s.from, s.y]} to={[s.to, s.y]} dashed={s.dashed} both={s.both} />
          <Label x={(s.from + s.to) / 2} y={s.y - 7}>{`${s.n}  ${s.text}`}</Label>
        </g>
      ))}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// 2. Transport: two sockets, possibly two instances, and the direct path.
// ---------------------------------------------------------------------------

export function TransportDiagram() {
  return (
    <Frame
      id="transport"
      w={360}
      h={238}
      title="How messages travel between the laptop and the phone"
      desc="The laptop and the phone each hold a WebSocket to the relay, which runs as serverless function instances. The two sockets can land on different instances, so the instances share room records and pass frames through Redis publish and subscribe. If both land on the same instance, frames cross it directly. Separately, the laptop and phone try a direct WebRTC connection, drawn as a dashed line, which opens only if the network allows it."
    >
      <Box x={8} y={8} w={100} h={56} label="Laptop" sub="the site" solid />
      <Box x={252} y={8} w={100} h={56} label="Phone" sub="/p" solid />
      <Arrow from={[108, 36]} to={[252, 36]} dashed both />
      <Label x={180} y={26}>direct WebRTC</Label>
      <Label x={180} y={54}>if it opens</Label>

      <Arrow from={[58, 64]} to={[58, 124]} both strong />
      <Label x={66} y={98} anchor="start">WebSocket</Label>
      <Arrow from={[302, 64]} to={[302, 124]} both strong />
      <Label x={294} y={98} anchor="end">WebSocket</Label>

      <Box x={8} y={124} w={100} h={56} label="Instance A" sub="/api/link" />
      <Box x={130} y={124} w={100} h={56} label="Redis" sub="pub/sub" />
      <Box x={252} y={124} w={100} h={56} label="Instance B" sub="/api/link" />
      <Arrow from={[108, 152]} to={[130, 152]} both />
      <Arrow from={[230, 152]} to={[252, 152]} both />

      <Label x={180} y={206} mono={false} size={11.5}>Different instances: frames go through Redis.</Label>
      <Label x={180} y={225} mono={false} size={11.5}>The same instance: straight across.</Label>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// 3. One golf swing, as the recogniser sees it.
//
// The curve is drawn, not recorded: a quiet stretch, a slow backswing lobe
// three times as long as the downswing, then the fast downswing lobe and a
// follow-through. The shape mirrors what lib/motion/golf.ts expects (a
// negative lobe then a taller, shorter positive one).
// ---------------------------------------------------------------------------

export function SwingDiagram() {
  const base = 150;
  const backStart = 44;
  const backEnd = 152;
  const downStart = 160;
  const downEnd = 196;
  const followEnd = 238;
  const backAmp = 34;
  const downAmp = 100;
  const followAmp = 22;
  const sin2 = (t: number) => Math.sin(Math.PI * t) ** 2;
  const s = (x: number): number => {
    if (x >= backStart && x <= backEnd) return -backAmp * sin2((x - backStart) / (backEnd - backStart));
    if (x >= downStart && x <= downEnd) return downAmp * sin2((x - downStart) / (downEnd - downStart));
    if (x > downEnd && x <= followEnd) return followAmp * sin2((x - downEnd) / (followEnd - downEnd));
    return 0;
  };
  const xs: number[] = [];
  for (let x = 8; x <= 352; x += 2) xs.push(x);
  const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x} ${(base - s(x)).toFixed(1)}`).join("");
  const downXs = xs.filter((x) => x >= downStart && x <= downEnd);
  const downFill = `M${downStart} ${base}${downXs.map((x) => `L${x} ${(base - s(x)).toFixed(1)}`).join("")}L${downEnd} ${base}Z`;

  const peakX = downStart + (downEnd - downStart) / 2;
  const peakY = base - downAmp;
  // where the falling side of the downswing crosses 60% of the peak
  const fireTheta = Math.PI - Math.asin(Math.sqrt(0.6));
  const fireX = downStart + (fireTheta / Math.PI) * (downEnd - downStart);
  const fireY = base - 0.6 * downAmp;
  const brace = (x1: number, x2: number, y: number) => `M${x1} ${y - 4}V${y}H${x2}V${y - 4}`;

  return (
    <Frame
      id="swing"
      w={360}
      h={236}
      title="A golf swing as the recogniser sees it"
      desc="A line chart of the phone's rotation speed about the swing axis over time. It starts flat while the phone is held still at address. A long, shallow dip below zero is the backswing. A short, tall peak above zero is the downswing, about a third as long as the backswing. A shaded marker shows the peak, which sets the club speed, and a second marker on the falling side, at 60 percent of the peak, shows the moment the recogniser sends the result. A smaller bump after that is the follow-through."
    >
      <line x1={8} y1={base} x2={352} y2={base} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <path d={downFill} fill="var(--accent-text)" opacity={0.16} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinejoin="round" />

      <line x1={fireX} y1={fireY} x2={352} y2={fireY} stroke="currentColor" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
      <circle cx={peakX} cy={peakY} r={4.5} fill="var(--accent-text)" />
      <circle cx={fireX} cy={fireY} r={4.5} fill="var(--surface)" stroke="currentColor" strokeWidth={2} />
      <Label x={peakX + 10} y={peakY + 4} anchor="start" accent>peak rate = speed</Label>
      <Label x={352} y={fireY - 8} anchor="end">falls to 60%: send it</Label>

      <Label x={8} y={base - 12} anchor="start">still</Label>
      <Label x={backStart + (backEnd - backStart) / 2 + 6} y={base - 12}>backswing</Label>

      <path d={brace(backStart, downStart, base + 38)} fill="none" stroke="currentColor" strokeWidth={1.25} />
      <path d={brace(downStart, downEnd, base + 38)} fill="none" stroke="currentColor" strokeWidth={1.25} />
      <Label x={(backStart + downStart) / 2} y={base + 58}>about 3 parts</Label>
      <Label x={(downStart + downEnd) / 2 + 40} y={base + 58}>1 part</Label>
      <Label x={180} y={base + 80} mono={false} size={11.5}>tempo = backswing time ÷ downswing time</Label>
    </Frame>
  );
}
