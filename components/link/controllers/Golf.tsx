"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CLUBS } from "@/components/offhours/golf/flight";
import { GOLF_CAL, speedForPower } from "@/components/offhours/golf/remoteSwing";
import { createGolfDetector, createStillGate } from "@/lib/motion";
import type { GolfSwingEvent, MotionSample } from "@/lib/motion";
import { ghostButton } from "./Shell";
import type { ControllerProps } from "./types";
import { useMotionSamples } from "./useMotionSamples";
import { buzz } from "@/lib/haptics";

// The driving range's controller. Swing: hold the phone like a club grip, screen
// toward you, stay still for a moment (address), then swing. Only the golf
// recogniser runs. Touch: hold to take it back, let go to hit, for a phone
// without motion sensors (or one that said no).
//
// Sends   gesture golf-swing {speedMph, tempo, faceDeg}   a finished swing
//         gesture golf-club  {index}                       the club picker
//         gesture golf-sync  {}                            "tell me the club and mode" (on mount)
// Hears   gesture golf-club  {index}                       the laptop's club (keys or picker)
//         gesture golf-mode  {range: boolean}              false while the laptop is putting

type Mode = "swing" | "touch";
type SwingNumbers = { speedMph: number; tempo: number; faceDeg: number };

const REASONS: Record<string, string> = {
  "too-slow": "Swing harder.",
  "too-weak": "Swing harder: that one barely moved.",
  "no-backswing": "Take it back first, then swing through.",
  symmetric: "Slower back, faster through.",
  "multi-lobe": "One smooth swing, no waggle.",
  "non-planar": "Keep it on one plane.",
  "backswing-duration": "Smooth takeaway, about a second.",
  "downswing-duration": "Swing through in one motion.",
  tempo: "Try a slower takeaway.",
  "too-long": "Too slow. Swing it in one go.",
};

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const fmtFace = (d: number) => (Math.abs(d) < 1 ? "square" : `${Math.abs(round(d, 0))}° ${d > 0 ? "open" : "closed"}`);

export default function GolfController({ send, subscribe, motionOk }: ControllerProps) {
  const [mode, setMode] = useState<Mode>(motionOk ? "swing" : "touch");
  const [club, setClub] = useState(3);
  const [range, setRange] = useState(true);
  const [ready, setReady] = useState(false);
  const [last, setLast] = useState<SwingNumbers | null>(null);
  const [note, setNote] = useState("");

  // the laptop says which club it has and whether it is on the range
  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type !== "gesture") return;
      if (m.name === "golf-club") {
        const i = Number(m.data?.index);
        if (Number.isInteger(i) && i >= 0 && i < CLUBS.length) setClub(i);
      } else if (m.name === "golf-mode") setRange(!!m.data?.range);
    });
    send({ type: "gesture", name: "golf-sync", data: {} });
    return off;
  }, [send, subscribe]);

  const sendSwing = useCallback(
    (s: SwingNumbers) => {
      send({ type: "gesture", name: "golf-swing", data: { speedMph: round(s.speedMph), tempo: round(s.tempo, 2), faceDeg: round(s.faceDeg) } });
      setLast({ speedMph: round(s.speedMph), tempo: round(s.tempo, 1), faceDeg: round(s.faceDeg) });
      setNote("");
      buzz(35);
    },
    [send],
  );

  // ---- swing mode: the recogniser, only while this mode is up ----
  const swingOn = mode === "swing" && motionOk && range;
  const det = useRef(createGolfDetector({ radius: GOLF_CAL.radiusM }));
  const gate = useRef(createStillGate());
  const readyRef = useRef(false);
  useEffect(() => {
    det.current.reset();
    gate.current.reset();
    readyRef.current = false;
    setReady(false);
  }, [swingOn]);
  const onSample = useCallback(
    (s: MotionSample) => {
      for (const o of det.current.push(s)) {
        if (o.kind === "event") {
          const e: GolfSwingEvent = o.event;
          sendSwing({ speedMph: e.clubSpeedMph, tempo: e.tempo, faceDeg: e.faceAngleDeg });
        } else {
          setNote(REASONS[o.reason] ?? "Didn't catch that. One smooth swing.");
        }
      }
      const r = gate.current.push(s);
      if (r !== readyRef.current) {
        readyRef.current = r;
        setReady(r);
        if (r) setNote("");
      }
    },
    [sendSwing],
  );
  const { receiving } = useMotionSamples(swingOn, onSample);
  const noSensor = mode === "swing" && motionOk && receiving === false;

  const pickClub = (i: number) => {
    setClub(i);
    send({ type: "gesture", name: "golf-club", data: { index: i } });
  };

  const live = swingOn && receiving !== false;
  const go = live && ready;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-testid="golf-controller" data-mode={mode} data-ready={go}>
      <h1 className="mt-4 text-[1.55rem] leading-tight font-extrabold text-balance">
        {!range ? "Putting is on the laptop for now." : mode === "swing" ? "Hold it like a club. Swing." : "Hold, then let go to hit."}
      </h1>
      <p className="mt-1.5 text-[1.05rem] leading-snug text-[#c9c6b6]">
        {!range
          ? "Choose Driving range on the laptop and this phone becomes your swing."
          : mode === "swing"
            ? "Screen toward you, stay still a moment, then swing through like a drive."
            : "Press and hold to take it back. The longer you hold, the harder you hit."}
      </p>

      {range && mode === "swing" && (
        <div
          role="status"
          data-testid="golf-status"
          className={`mt-4 rounded-[24px] px-5 py-6 text-center border transition-colors ${
            noSensor ? "bg-[#d9b44a]/15 border-[#d9b44a]/40" : go ? "bg-[var(--mint)] text-[var(--ink)] border-transparent" : "bg-white/10 border-white/15"
          }`}
        >
          <p className={`text-[2.2rem] leading-none font-extrabold ${go ? "animate-pulse" : ""}`}>
            {noSensor ? "No motion data" : go ? "Swing!" : "Address… hold still"}
          </p>
          <p className={`mt-2 text-[1rem] ${go ? "text-[var(--ink)]/80" : "text-[#c9c6b6]"}`}>
            {noSensor ? "This phone isn't sending motion. Use Touch instead." : go ? "Take it back, then swing through." : "Waiting for you to settle."}
          </p>
        </div>
      )}
      {range && mode === "touch" && <TouchSwing club={club} onSwing={sendSwing} />}

      {note && (
        <p role="status" data-testid="golf-note" className="mt-3 rounded-[14px] bg-[#d9b44a]/15 border border-[#d9b44a]/40 px-3.5 py-2.5 text-[1rem] text-[#f0dc9d]">
          {note}
        </p>
      )}

      <section aria-label="Last shot" className="mt-4 grid grid-cols-3 gap-2 text-center" data-testid="golf-last">
        <Stat label="Speed" value={last ? `${last.speedMph}` : "–"} unit="mph" />
        <Stat label="Tempo" value={last ? `${last.tempo}` : "–"} unit=": 1" />
        <Stat label="Face" value={last ? fmtFace(last.faceDeg) : "–"} unit="" />
      </section>

      <section aria-label="Club" className="mt-5">
        <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#a3a69c]">Club</h2>
        <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Choose a club">
          {CLUBS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={club === i}
              data-club={i}
              onClick={() => pickClub(i)}
              className={`min-h-[64px] rounded-[18px] px-2 text-[1.1rem] font-bold border active:scale-[0.97] transition-transform ${
                club === i ? "bg-[var(--paper)] text-[var(--ink)] border-transparent" : "bg-white/10 border-white/15 text-[var(--paper)]"
              }`}
            >
              {c.name.replace("Pitching wedge", "Pitching W").replace("Sand wedge", "Sand W")}
            </button>
          ))}
        </div>
      </section>

      {range && (
        <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Control">
          {(["swing", "touch"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              data-mode-btn={m}
              disabled={m === "swing" && !motionOk}
              onClick={() => setMode(m)}
              className={`${ghostButton} !min-h-[52px] ${mode === m ? "!bg-[var(--mint)] !text-[var(--ink)] !border-transparent" : ""} disabled:opacity-40`}
            >
              {m === "swing" ? "Swing" : "Touch"}
            </button>
          ))}
        </div>
      )}
      {!motionOk && range && (
        <p className="mt-2 text-[0.95rem] leading-snug text-[#a3a69c]">
          Motion is off on this phone, so swinging isn&apos;t available. Reload this page and allow motion to turn it on.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-[16px] bg-white/10 border border-white/15 px-2 py-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a69c]">{label}</p>
      <p className="mt-1 text-[1.35rem] leading-none font-extrabold tabular-nums">{value}</p>
      <p className="mt-1 text-[12px] text-[#a3a69c] h-[1em]">{unit}</p>
    </div>
  );
}

const FULL_HOLD_S = 1.1;

/** Hold to take it back, let go to hit: a touch stand-in for the swing. */
function TouchSwing({ club, onSwing }: { club: number; onSwing: (s: SwingNumbers) => void }) {
  const [p, setP] = useState(0);
  const start = useRef<number | null>(null);
  const raf = useRef(0);

  const tick = useCallback(() => {
    if (start.current === null) return;
    setP(Math.min(1.1, (performance.now() - start.current) / 1000 / FULL_HOLD_S));
    raf.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  };
  const up = () => {
    if (start.current === null) return;
    const held = (performance.now() - start.current) / 1000 / FULL_HOLD_S;
    start.current = null;
    cancelAnimationFrame(raf.current);
    setP(0);
    if (held < 0.12) return; // a tap isn't a swing
    onSwing({ speedMph: speedForPower(Math.min(1.06, held), club), tempo: GOLF_CAL.idealTempo, faceDeg: 0 });
  };

  return (
    <div className="mt-4">
      <div className="h-3 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${Math.round(Math.min(1, p) * 100)}%`, background: p > 1 ? "#e5484d" : "var(--mint)" }} />
      </div>
      <button
        type="button"
        data-testid="golf-touch-swing"
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
        className="mt-3 w-full min-h-[120px] rounded-[24px] bg-[var(--mint)] text-[var(--ink)] text-[1.5rem] font-extrabold touch-none select-none active:scale-[0.99] transition-transform"
      >
        {p > 0 ? `${Math.round(p * 100)}%: let go!` : "Hold to swing"}
      </button>
    </div>
  );
}
