"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PENALTY_CAL, PHONE_SHOTS, isPhoneShot, kickFromSwipe, type PhoneShot } from "@/components/offhours/penaltyRemote";
import { createSwipeTracker } from "@/lib/motion";
import type { TouchPoint } from "@/lib/motion";
import type { ControllerProps } from "./types";

// The penalty controller: the phone's screen is the spot, and a ball sits on it.
// Swipe the ball like a finger-flick football game. Direction is the aim, the
// swipe's length is how high, its speed is the power, and a bent swipe bends the
// ball (Auto; the other chips force that kick). Touch only, so there is no motion
// recogniser here at all.
//
// Sends   gesture penalty-kick  {dirDeg, len, power, curl}   a finished swipe (len: chord / pad height)
//         gesture penalty-shot  {id}                         the shot picker
//         gesture penalty-sync  {}                           "tell me where we are" (on mount)
// Hears   gesture penalty-state {phase, kicks, result, word, detail, shot, choice}
//                               phase: "aim" (swipe now) | "busy" (kick in flight) | "over" (shootout done)
//                               kicks: one letter per kick, G goal / S saved / P post or bar / M missed
//                               result: "goal" | "save" | "miss" | "post" for the kick that just ended, else ""

type Phase = "aim" | "busy" | "over";
type Result = { result: string; word: string; detail: string; shot: string };

const SWIPE_REASONS: Record<string, string> = {
  "too-short": "Swipe the ball, a bit further.",
  "too-slow": "Quicker: flick it.",
  "too-few-points": "Swipe the ball, don't tap it.",
};
const SHOT_NAME: Record<string, string> = { placed: "Placed", driven: "Driven", curlL: "Curl left", curlR: "Curl right", dipper: "Dipper", knuckle: "Knuckle", panenka: "Panenka" };
const HINT: Record<PhoneShot, string> = {
  auto: "Bend your swipe to curl it. A very hard one is driven.",
  placed: "Side-foot it. Steady and true.",
  driven: "Low and hard. Swipe fast.",
  dipper: "Top-spin. Aim at the top corners.",
  knuckle: "No spin, so it wobbles.",
  panenka: "A soft chip down the middle. Swipe gently.",
};

// the pitch, in a 130 x 140 box: goal at the top, the spot near the bottom
const SPOT = { x: 65, y: 104 };
const GOAL = { x0: 40, x1: 90, top: 6, line: 16 };
const GW = PENALTY_CAL.goalHalfWidthM;
const GH = 2.44;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function PenaltyController({ send, subscribe }: ControllerProps) {
  const [choice, setChoice] = useState<PhoneShot>("auto");
  const [phase, setPhase] = useState<Phase>("aim");
  const [kicks, setKicks] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [note, setNote] = useState("");
  const [kicked, setKicked] = useState<{ dx: number; dy: number } | null>(null);
  const [mark, setMark] = useState<{ x: number; y: number; n: number } | null>(null);
  const [lastShot, setLastShot] = useState("");
  const rearm = useRef(0);
  useEffect(() => () => window.clearTimeout(rearm.current), []);

  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture" || m.name !== "penalty-state" || !m.data) return;
      const d = m.data;
      const ph = d.phase === "over" ? "over" : d.phase === "busy" ? "busy" : "aim";
      setPhase(ph);
      window.clearTimeout(rearm.current); // the laptop answered, so it will say when the ball is back
      setKicks(String(d.kicks ?? ""));
      if (isPhoneShot(d.choice)) setChoice(d.choice);
      const r = String(d.result ?? "");
      if (r) setRes({ result: r, word: String(d.word ?? ""), detail: String(d.detail ?? ""), shot: String(d.shot ?? "") });
      if (ph === "aim") {
        // ready for the next kick: the ball is back on the spot
        setKicked(null);
        setMark(null);
      }
      if (ph === "over" && !r) setKicked(null);
    });
    send({ type: "gesture", name: "penalty-sync", data: {} });
    return off;
  }, [send, subscribe]);

  const pick = (id: PhoneShot) => {
    setChoice(id);
    send({ type: "gesture", name: "penalty-shot", data: { id } });
  };

  const onSwipe = useCallback(
    (dirDeg: number, len: number, power: number, curl: number) => {
      const r = (v: number) => Math.round(v * 1000) / 1000;
      send({ type: "gesture", name: "penalty-kick", data: { dirDeg: r(dirDeg), len: r(len), power: r(power), curl: r(curl) } });
      const k = kickFromSwipe({ dirDeg, len, power, curl }, choice);
      setLastShot(`${SHOT_NAME[k.shot]}, power ${Math.round(power * 100)}%`);
      setMark({ x: GOAL.x0 + ((GOAL.x1 - GOAL.x0) / 2) * (1 + clamp(k.aim.x / GW, -1.3, 1.3)), y: GOAL.line - clamp(k.aim.y / GH, 0, 1.2) * (GOAL.line - GOAL.top), n: Date.now() });
      const a = (dirDeg * Math.PI) / 180;
      setKicked({ dx: Math.sin(a) * 70, dy: -Math.cos(a) * 70 });
      setNote("");
      setRes(null);
      setPhase("busy");
      // if the laptop never answers (it was mid-kick, or a replay was up), put the ball back; once it has answered it says when
      window.clearTimeout(rearm.current);
      rearm.current = window.setTimeout(() => {
        setKicked(null);
        setPhase("aim");
      }, 4500);
      try {
        navigator.vibrate?.(35);
      } catch {
        /* no haptics here */
      }
    },
    [send, choice],
  );

  const over = phase === "over";
  const goals = (kicks.match(/G/g) ?? []).length;
  const shown = Math.max(5, kicks.length);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4 flex flex-col" data-testid="penalty-controller" data-phase={phase}>
      <h1 className="mt-3 text-[1.45rem] leading-tight font-extrabold text-balance">{over ? "Shootout over. Swipe to go again." : "Swipe the ball."}</h1>
      <p className="mt-1 text-[1rem] leading-snug text-[#c9c6b6]">
        {over ? `${goals} from ${kicks.length}.` : phase === "busy" ? "Watch the laptop…" : "Direction aims, speed is power, a bend curls it."}
      </p>

      <Pad phase={phase} kicked={kicked} mark={mark} res={res} onSwipe={onSwipe} onNote={setNote} />

      <div className="mt-3 flex items-center gap-3" data-testid="penalty-score">
        <ol className="flex gap-1.5" aria-label="Kicks">
          {Array.from({ length: shown }, (_, i) => {
            const k = kicks[i];
            return (
              <li
                key={i}
                data-kick={k ?? ""}
                className={`h-4 w-4 rounded-full border ${k === "G" ? "bg-[var(--mint)] border-transparent" : k ? "bg-[#e5484d] border-transparent" : "border-white/40"}`}
              />
            );
          })}
        </ol>
        <p className="ml-auto text-[1rem] text-[#c9c6b6] truncate" data-testid="penalty-last">
          {res ? `${res.word}${res.detail ? `: ${res.detail.toLowerCase()}` : ""}` : lastShot || "No kicks yet."}
        </p>
      </div>
      {note && (
        <p role="status" data-testid="penalty-note" className="mt-2 rounded-[14px] bg-[#d9b44a]/15 border border-[#d9b44a]/40 px-3.5 py-2 text-[1rem] text-[#f0dc9d]">
          {note}
        </p>
      )}

      <section aria-label="Shot" className="mt-3">
        <div className="flex gap-2 overflow-x-auto snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Choose a kick">
          {PHONE_SHOTS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={choice === s.id}
              data-shot={s.id}
              onClick={() => pick(s.id)}
              className={`min-h-[48px] shrink-0 snap-start rounded-full px-5 text-[1.05rem] font-bold border active:scale-[0.97] transition-transform ${
                choice === s.id ? "bg-[var(--paper)] text-[var(--ink)] border-transparent" : "bg-white/10 border-white/15 text-[var(--paper)]"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[0.95rem] leading-snug text-[#a3a69c]" data-testid="penalty-hint">
          {HINT[choice]}
        </p>
      </section>
    </div>
  );
}

/** The pitch: stripes, the box, the spot, the goal, and the ball to swipe. */
function Pad({
  phase,
  kicked,
  mark,
  res,
  onSwipe,
  onNote,
}: {
  phase: Phase;
  kicked: { dx: number; dy: number } | null;
  mark: { x: number; y: number; n: number } | null;
  res: Result | null;
  onSwipe: (dirDeg: number, len: number, power: number, curl: number) => void;
  onNote: (n: string) => void;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const tracker = useRef(
    createSwipeTracker({
      minLength: 40,
      minPeakSpeed: 350,
      speedLow: PENALTY_CAL.speedLow,
      speedHigh: PENALTY_CAL.speedHigh,
      curlRange: PENALTY_CAL.curlRange,
      curlBias: PENALTY_CAL.curlBias,
    }),
  );
  const [trail, setTrail] = useState<readonly TouchPoint[]>([]);
  const active = useRef<number | null>(null);

  const at = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    return { t: performance.now() / 1000, x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep the swipe if the finger leaves the pad
    } catch {
      /* not an active pointer (a synthetic event): the pad still tracks it */
    }
    active.current = e.pointerId;
    const p = at(e);
    tracker.current.down(p.t, p.x, p.y);
    setTrail([{ t: p.t, x: p.x, y: p.y }]);
    onNote("");
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    const p = at(e);
    tracker.current.move(p.t, p.x, p.y);
    setTrail(tracker.current.points().slice());
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    const p = at(e);
    const out = tracker.current.up(p.t, p.x, p.y);
    setTrail([]);
    if (out.kind === "reject") {
      onNote(SWIPE_REASONS[out.reason] ?? "Swipe the ball toward the goal.");
      return;
    }
    const ev = out.event;
    if (Math.abs(ev.directionDeg) > 80) {
      onNote("Swipe up, toward the goal.");
      return;
    }
    onSwipe(ev.directionDeg, ev.length / (pad.current!.clientHeight || 1), ev.power, ev.curl);
  };

  const ballStyle: React.CSSProperties = kicked
    ? { transform: `translate(${kicked.dx}px, ${kicked.dy}px) scale(0.3)`, opacity: 0, transition: "transform 0.5s cubic-bezier(.2,.7,.3,1), opacity 0.5s ease-in" }
    : { transform: "none", opacity: 1, transition: "opacity 0.3s ease-out 0.05s" };
  const good = res?.result === "goal";
  return (
    <div
      ref={pad}
      data-testid="penalty-pad"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        active.current = null;
        tracker.current.cancel();
        setTrail([]);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="relative mt-3 flex-1 min-h-[280px] rounded-[24px] overflow-hidden touch-none select-none border border-white/15"
      style={{ background: "repeating-linear-gradient(180deg, #2f8a43 0 44px, #297a3b 44px 88px)" }}
    >
      <svg viewBox="0 0 130 140" preserveAspectRatio="xMidYMax meet" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <g fill="none" stroke="rgba(242,234,215,0.85)" strokeWidth="0.7" strokeLinejoin="round">
          <rect x="5" y={GOAL.line} width="120" height="112" />
          <rect x="28" y={GOAL.line} width="74" height="26" />
          <path d="M50.6 128A28 28 0 0 0 79.4 128" />
        </g>
        {/* the goal: posts, bar and a net */}
        <g stroke="rgba(242,234,215,0.35)" strokeWidth="0.3">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M${GOAL.x0 + (i + 1) * 5} ${GOAL.top}V${GOAL.line}`} />
          ))}
          {[9.3, 12.6].map((y) => (
            <path key={y} d={`M${GOAL.x0} ${y}H${GOAL.x1}`} />
          ))}
        </g>
        <path d={`M${GOAL.x0} ${GOAL.line}V${GOAL.top}H${GOAL.x1}V${GOAL.line}`} fill="none" stroke="#f2ead7" strokeWidth="1.2" strokeLinejoin="round" />
        {phase === "aim" && !kicked && trail.length === 0 && (
          <text x={SPOT.x} y={SPOT.y - 13} textAnchor="middle" fontSize="4" letterSpacing="0.6" fill="rgba(242,234,215,0.85)" className="font-mono uppercase">
            Swipe the ball
          </text>
        )}
        {mark && (
          <g key={mark.n} data-testid="penalty-mark">
            <circle cx={mark.x} cy={mark.y} r="2.4" fill="none" stroke="#edbb00" strokeWidth="0.9" />
            <circle cx={mark.x} cy={mark.y} r="0.7" fill="#edbb00" />
          </g>
        )}
        <g style={ballStyle} data-testid="penalty-ball" data-kicked={kicked ? "true" : "false"}>
          <ellipse cx={SPOT.x} cy={SPOT.y + 7} rx="6.5" ry="1.7" fill="rgba(0,0,0,0.3)" />
          <BallShape x={SPOT.x} y={SPOT.y} r={7} />
        </g>
      </svg>
      {trail.length > 1 && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          <polyline points={trail.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="#f2ead7" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        </svg>
      )}
      {res && phase !== "aim" && (
        <div className="pointer-events-none absolute left-0 right-0 top-[34%] text-center" data-testid="penalty-result">
          <p className={`text-[2.6rem] leading-none font-extrabold drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)] ${good ? "text-[#edbb00]" : "text-[#f2ead7]"}`}>{res.word}</p>
          {res.detail && <p className="mt-2 text-[1rem] font-semibold text-[#f2ead7] drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">{res.detail}</p>}
        </div>
      )}
    </div>
  );
}

/** A football seen from above: white, with the dark pentagon and its five seams. */
function BallShape({ x, y, r }: { x: number; y: number; r: number }) {
  const pent = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return [x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42] as const;
  });
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#f2ead7" stroke="#1c1a16" strokeWidth="0.5" />
      <path d={`M${pent.map((p) => p.join(" ")).join("L")}Z`} fill="#1c1a16" />
      {pent.map(([px, py], i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        return <path key={i} d={`M${px} ${py}L${x + Math.cos(a) * r * 0.95} ${y + Math.sin(a) * r * 0.95}`} stroke="#1c1a16" strokeWidth="0.45" fill="none" />;
      })}
    </g>
  );
}
