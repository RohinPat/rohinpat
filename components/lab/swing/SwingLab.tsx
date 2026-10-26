"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AXES_NOTE,
  createFlickDetector,
  createGolfDetector,
  createTiltFilter,
  createTwistFilter,
  rowFromSample,
} from "@/lib/motion";
import type {
  DetectorOutput,
  FlickEvent,
  GolfSwingEvent,
  RecordedRow,
  RecordingFile,
  SwipeEvent,
  TiltState,
  TwistState,
} from "@/lib/motion";
import { useMotionStream } from "./useMotionStream";
import type { MotionStream } from "./useMotionStream";
import SensorGraph from "./SensorGraph";
import SwipePad from "./SwipePad";
import type { SwipeRecord } from "./SwipePad";

// ------------------------------------------------------------------ shared bits

const card = "rounded-2xl border border-hairline bg-bg-elevated p-5 md:p-6";
const btn =
  "min-h-12 px-5 rounded-full font-semibold text-base border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const btnPrimary = `${btn} bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]`;
const btnGhost = `${btn} border-[var(--border-strong)] text-fg hover:bg-white/5`;
const field = "min-h-12 rounded-xl border border-[var(--border-strong)] bg-[#0a0c0b] px-3 text-base text-fg";

type Kv = [string, string];
interface LogEntry {
  id: number;
  kind: "event" | "reject";
  title: string;
  /** Seconds since the test started. */
  at: number;
  rows: Kv[];
}

const f = (x: number, d = 1) => x.toFixed(d);
const signed = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;
const RAD2DEG = 180 / Math.PI;

function describeGolf(e: GolfSwingEvent): { title: string; rows: Kv[] } {
  return {
    title: "Golf swing",
    rows: [
      ["Clubhead speed", `${f(e.clubSpeedMph, 0)} mph`],
      ["", `${f(e.clubSpeed)} m/s at radius ${f(e.radius, 2)} m`],
      ["Tempo", `${f(e.tempo)} : 1`],
      ["Backswing / downswing", `${f(e.backswingS * 1000, 0)} ms / ${f(e.downswingS * 1000, 0)} ms`],
      ["Face angle", `${signed(e.faceAngleDeg)}°`],
      ["Peak rotation", `${f(e.peakRate)} rad/s${e.saturated ? " (gyro clipped: speed is a lower bound)" : ""}`],
      ["Planarity", `${f(e.planarity * 100, 0)}%`],
    ],
  };
}
function describeFlick(e: FlickEvent): { title: string; rows: Kv[] } {
  return {
    title: "Flick up",
    rows: [
      ["Power", `${f(e.power * 100, 0)}%`],
      ["Aim", `${signed(e.aim, 2)}  (${e.aim < -0.05 ? "left" : e.aim > 0.05 ? "right" : "straight"}, ${signed(e.aimDeg)}°)`],
      ["Peak acceleration", `${f(e.peakAccel)} m/s²`],
      ["Release speed", `${f(e.impulse, 2)} m/s`],
      ["Lateral / yaw part", `${signed(e.lateralAimDeg)}° / ${signed(e.yawDeg)}°`],
      ["Pulse width", `${f(e.widthS * 1000, 0)} ms`],
    ],
  };
}
function describeSwipe(e: SwipeEvent): { title: string; rows: Kv[] } {
  return {
    title: "Curved swipe",
    rows: [
      ["Direction", `${signed(e.directionDeg)}°  (0 = straight up, + = right)`],
      ["Power", `${f(e.power * 100, 0)}%  (${f(e.peakSpeed, 0)} px/s)`],
      ["Curl", `${signed(e.curl, 2)}  (${e.curl > 0.05 ? "bends right" : e.curl < -0.05 ? "bends left" : "straight"})`],
      ["Path turns", `${signed(e.turnAngle * RAD2DEG)}°`],
      ["Length / time", `${f(e.length, 0)} px / ${f(e.durationS * 1000, 0)} ms`],
    ],
  };
}

function toEntry(o: DetectorOutput<GolfSwingEvent | FlickEvent | SwipeEvent>, at: number, id: number): LogEntry {
  if (o.kind === "reject") {
    return { id, kind: "reject", at, title: `Ignored ${o.gesture}: ${o.reason}`, rows: o.detail ? [["", o.detail]] : [] };
  }
  const e = o.event;
  const d = e.type === "golf-swing" ? describeGolf(e) : e.type === "flick-up" ? describeFlick(e) : describeSwipe(e);
  return { id, kind: "event", at, title: d.title, rows: d.rows };
}

// ------------------------------------------------------------------ record panel

type RecState = "idle" | "countdown" | "recording" | "done";

const LABELS = [
  ["golf-swing", "Golf swing"],
  ["golf-practice-waggle", "Golf: waggle then swing"],
  ["flick-up", "Flick up (hoops)"],
  ["twist", "Twist (crown / throttle)"],
  ["tilt", "Tilt left-right (ski)"],
  ["walking-in-hand", "Walking, phone in hand"],
  ["walking-pocket", "Walking, phone in pocket"],
  ["table-bump", "Table bump"],
  ["pickup-putdown", "Pick up / put down"],
  ["shaking", "Shaking"],
  ["other", "Other"],
] as const;

function RecorderPanel({ stream }: { stream: MotionStream }) {
  const [label, setLabel] = useState<string>(LABELS[0][0]);
  const [note, setNote] = useState("");
  const [delay, setDelay] = useState(3);
  const [autoStop, setAutoStop] = useState(10);
  const [state, setState] = useState<RecState>("idle");
  const [count, setCount] = useState(0);
  const [secs, setSecs] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const rows = useRef<RecordedRow[]>([]);
  const t0 = useRef<number | null>(null);
  const stateRef = useRef<RecState>("idle");
  const file = useRef<RecordingFile | null>(null);
  const timers = useRef<number[]>([]);
  const { subscribe, accelSign, rateHz } = stream;
  const signRef = useRef(accelSign);
  signRef.current = accelSign;
  const rateRef = useRef(rateHz);
  rateRef.current = rateHz;

  const set = (s: RecState) => {
    stateRef.current = s;
    setState(s);
  };

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  useEffect(() => {
    const unsub = subscribe(({ raw }) => {
      if (stateRef.current !== "recording") return;
      if (t0.current === null) t0.current = raw.t;
      rows.current.push(rowFromSample(raw, t0.current));
    });
    return () => {
      unsub();
      clearTimers();
    };
  }, [subscribe]);

  // Live counters while recording.
  useEffect(() => {
    if (state !== "recording") return;
    const id = window.setInterval(() => {
      setCount(rows.current.length);
      const last = rows.current[rows.current.length - 1];
      setSecs(last ? last.t / 1000 : 0);
    }, 250);
    return () => window.clearInterval(id);
  }, [state]);

  const stop = useCallback(() => {
    clearTimers();
    if (stateRef.current !== "recording") return;
    const r = rows.current;
    const dur = r.length ? r[r.length - 1].t : 0;
    file.current = {
      format: "swing-lab-recording",
      version: 1,
      label,
      note,
      userAgent: navigator.userAgent,
      accelSign: signRef.current,
      rateHz: dur > 0 ? Math.round(((r.length - 1) * 1000) / dur) : rateRef.current,
      axes: AXES_NOTE,
      durationMs: Math.round(dur),
      samples: r,
    };
    setCount(r.length);
    setSecs(dur / 1000);
    set("done");
  }, [label, note]);

  const begin = () => {
    rows.current = [];
    t0.current = null;
    file.current = null;
    setCount(0);
    setSecs(0);
    set("recording");
    if (autoStop > 0) timers.current.push(window.setTimeout(stop, autoStop * 1000));
  };

  const start = () => {
    clearTimers();
    if (delay <= 0) return begin();
    set("countdown");
    setRemaining(delay);
    for (let i = 1; i <= delay; i++) {
      timers.current.push(window.setTimeout(() => setRemaining(delay - i), i * 1000));
    }
    timers.current.push(window.setTimeout(begin, delay * 1000));
  };

  const discard = () => {
    clearTimers();
    rows.current = [];
    file.current = null;
    setCount(0);
    setSecs(0);
    set("idle");
  };

  const download = () => {
    const fl = file.current;
    if (!fl) return;
    const blob = new Blob([JSON.stringify(fl)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const name = `swing-${fl.label}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const live = stream.status === "listening";
  const busy = state === "countdown" || state === "recording";

  return (
    <section aria-labelledby="rec-h" className={card}>
      <h2 id="rec-h" className="text-2xl font-bold mb-1">Record</h2>
      <p className="muted mb-5 max-w-[60ch]">
        Captures raw sensor samples in memory, then hands you a JSON file when you tap Download. Nothing is stored or sent anywhere.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          What are you recording?
          <select className={field} value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy}>
            {LABELS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          Note (optional: grip, hand, club length…)
          <input className={field} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} maxLength={200} />
        </label>
        <label className="grid gap-1.5 text-sm">
          Start after
          <select className={field} value={delay} onChange={(e) => setDelay(Number(e.target.value))} disabled={busy}>
            <option value={0}>Right away</option>
            <option value={3}>3 seconds</option>
            <option value={5}>5 seconds</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          Stop after
          <select className={field} value={autoStop} onChange={(e) => setAutoStop(Number(e.target.value))} disabled={busy}>
            <option value={0}>When I tap Stop</option>
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
            <option value={20}>20 seconds</option>
            <option value={30}>30 seconds</option>
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 items-center">
        {state !== "recording" && state !== "countdown" && (
          <button className={btnPrimary} onClick={start} disabled={!live}>
            {state === "done" ? "Record again" : "Start recording"}
          </button>
        )}
        {state === "countdown" && (
          <button className={btnGhost} onClick={discard}>Cancel</button>
        )}
        {state === "recording" && (
          <button className={btnPrimary} onClick={stop}>Stop</button>
        )}
        {state === "done" && (
          <>
            <button className={btnPrimary} onClick={download} disabled={count === 0}>Download JSON</button>
            <button className={btnGhost} onClick={discard}>Discard</button>
          </>
        )}
      </div>

      <p role="status" aria-live="polite" className="mt-4 text-lg font-mono min-h-7">
        {!live && state === "idle" && "Turn the sensors on first."}
        {state === "countdown" && `Get into position… starting in ${remaining}`}
        {state === "recording" && `● Recording  ${f(secs)} s  ·  ${count} samples`}
        {state === "done" && (count > 0 ? `Captured ${count} samples over ${f(secs)} s. Ready to download.` : "Nothing was captured. Are the sensors on?")}
      </p>
      {state === "done" && (
        <p className="text-sm muted mt-1">If the download does not start on iOS, the file opens in a tab: use Share, then Save to Files.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ test panel

function Bar({ value, label, min = -1, max = 1 }: { value: number; label: string; min?: number; max?: number }) {
  const pct = ((value - min) / (max - min)) * 100;
  const centred = min < 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span>{label}</span>
        <span className="font-mono">{signed(value, 2)}</span>
      </div>
      <div className="relative h-5 rounded-full bg-[#0a0c0b] border border-hairline overflow-hidden" role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Number(value.toFixed(2))}>
        {centred && <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/30" />}
        <div
          className="absolute top-0 bottom-0 bg-[var(--mint)]"
          style={centred ? { left: `${Math.min(50, pct)}%`, width: `${Math.abs(pct - 50)}%` } : { left: 0, width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TestPanel({ stream }: { stream: MotionStream }) {
  const [running, setRunning] = useState(false);
  const [radius, setRadius] = useState(1.4);
  const [shaft, setShaft] = useState<0 | 1 | 2>(1);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [latest, setLatest] = useState<LogEntry | null>(null);
  const [gauges, setGauges] = useState<{ twist: TwistState | null; tilt: TiltState | null }>({ twist: null, tilt: null });
  const twistF = useRef<ReturnType<typeof createTwistFilter> | null>(null);
  const tiltF = useRef<ReturnType<typeof createTiltFilter> | null>(null);
  const twistS = useRef<TwistState | null>(null);
  const tiltS = useRef<TiltState | null>(null);
  const t0 = useRef(0);
  const nextId = useRef(1);
  const swipes = useRef<SwipeRecord[]>([]);
  const { subscribe } = stream;

  const addOutputs = useCallback((outs: DetectorOutput<GolfSwingEvent | FlickEvent | SwipeEvent>[]) => {
    if (!outs.length) return;
    const at = performance.now() / 1000 - t0.current;
    const entries = outs.map((o) => toEntry(o, at, nextId.current++));
    setLog((prev) => [...entries.reverse(), ...prev].slice(0, 14));
    const ev = entries.filter((e) => e.kind === "event");
    if (ev.length) setLatest(ev[ev.length - 1]);
  }, []);

  useEffect(() => {
    if (!running) return;
    t0.current = performance.now() / 1000;
    const golf = createGolfDetector({ radius, shaftAxis: shaft });
    const flick = createFlickDetector();
    const twist = createTwistFilter();
    const tilt = createTiltFilter();
    twistF.current = twist;
    tiltF.current = tilt;
    const unsub = subscribe(({ fixed }) => {
      twistS.current = twist.push(fixed);
      tiltS.current = tilt.push(fixed);
      const outs = [...golf.push(fixed), ...flick.push(fixed)];
      if (outs.length) addOutputs(outs);
    });
    const id = window.setInterval(() => setGauges({ twist: twistS.current, tilt: tiltS.current }), 100);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [running, radius, shaft, subscribe, addOutputs]);

  const onSwipe = (r: SwipeRecord) => {
    swipes.current = [...swipes.current.slice(-39), r];
    if (!running) t0.current = performance.now() / 1000;
    addOutputs([r.output]);
  };

  const downloadSwipes = () => {
    const blob = new Blob(
      [JSON.stringify({ format: "swing-lab-swipes", version: 1, swipes: swipes.current.map((s) => ({ points: s.points, result: s.output })) })],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "swing-swipes.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const live = stream.status === "listening";
  const tw = gauges.twist;
  const ti = gauges.tilt;

  return (
    <section aria-labelledby="test-h" className={card}>
      <h2 id="test-h" className="text-2xl font-bold mb-1">Test the recognisers</h2>
      <p className="muted mb-5 max-w-[60ch]">
        Runs the golf, flick, twist and tilt recognisers on the live stream. Each detected gesture appears below with its numbers; gestures the recogniser refused appear dimmed with the reason. They all run at once here, so a hard golf swing can also log a flick: in a game only that game's recogniser would be on.
      </p>

      <div className="flex flex-wrap items-end gap-4 mb-5">
        <button className={running ? btnGhost : btnPrimary} onClick={() => setRunning((r) => !r)} aria-pressed={running} disabled={!live && !running}>
          {running ? "Stop testing" : "Start testing"}
        </button>
        <label className="grid gap-1.5 text-sm">
          Club radius (m)
          <input className={`${field} w-28`} type="number" inputMode="decimal" min={0.6} max={2.5} step={0.05} value={radius} onChange={(e) => setRadius(Math.max(0.6, Math.min(2.5, Number(e.target.value) || 1.4)))} />
        </label>
        <label className="grid gap-1.5 text-sm">
          Grip axis
          <select className={field} value={shaft} onChange={(e) => setShaft(Number(e.target.value) as 0 | 1 | 2)}>
            <option value={1}>Long edge (y)</option>
            <option value={0}>Short edge (x)</option>
            <option value={2}>Screen normal (z)</option>
          </select>
        </label>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="rounded-xl border border-[var(--border-strong)] bg-[#0a0c0b] p-5 mb-5 min-h-44">
        {latest ? (
          <>
            <p className="text-sm muted mb-1">Latest, {f(latest.at)} s into the test</p>
            <p className="text-3xl md:text-4xl font-extrabold mb-3 accent">{latest.title}</p>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
              {latest.rows.map(([k, v], i) => (
                <div key={i} className="contents">
                  <dt className="muted text-base sm:text-lg">{k}</dt>
                  <dd className="font-mono text-xl sm:text-2xl">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="muted text-lg">
            {running ? "Waiting for a gesture. Golf: hold still for half a second, then swing. Flick: a sharp upward jab." : "Press Start testing, then do a gesture."}
          </p>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2 mb-5">
        <div className="rounded-xl border border-hairline p-4 grid gap-3">
          <h3 className="font-semibold">Twist (screen axis)</h3>
          <p className="font-mono text-2xl" aria-hidden>
            {tw ? `${signed(tw.omega * RAD2DEG, 0)}°/s` : "—"}
          </p>
          <p className="font-mono text-lg">{tw ? `${signed(tw.angleDeg, 0)}°  (${signed(tw.turns, 2)} turns)` : "—"}</p>
          <div>
            <button className={btnGhost} onClick={() => twistF.current?.zero()} disabled={!running}>Zero angle</button>
          </div>
        </div>
        <div className="rounded-xl border border-hairline p-4 grid gap-3">
          <h3 className="font-semibold">Tilt steer (hold phone like a reading pose)</h3>
          <Bar value={ti?.steer ?? 0} label="Steer" />
          <Bar value={ti?.tuck ?? 0} label="Tuck" min={0} max={1} />
          <p className="text-sm muted">
            {ti ? (ti.valid ? `Lean ${signed(ti.leanDeg)}°, forward ${signed(ti.forwardDeg)}°${ti.calibrated ? "" : " (calibrating…)"}` : "Phone is too upright to read lean. Tilt it back.") : "—"}
          </p>
          <div>
            <button className={btnGhost} onClick={() => tiltF.current?.recalibrate()} disabled={!running}>Set neutral here</button>
          </div>
        </div>
      </div>

      <h3 className="font-semibold mb-2">Curved swipe pad</h3>
      <SwipePad onResult={onSwipe} />
      <div className="mt-3">
        <button className={btnGhost} onClick={downloadSwipes}>Download swipe paths</button>
      </div>

      <h3 className="font-semibold mt-7 mb-2">Event log</h3>
      <ol role="log" aria-label="Detected gestures, newest first" className="grid gap-2">
        {log.length === 0 && <li className="muted">Nothing yet.</li>}
        {log.map((e) => (
          <li key={e.id} className={`rounded-lg border px-3 py-2 ${e.kind === "event" ? "border-[var(--border-strong)]" : "border-hairline opacity-70"}`}>
            <span className="font-mono text-xs muted mr-2">{f(e.at)} s</span>
            <span className="font-semibold">{e.title}</span>
            {e.rows.length > 0 && (
              <span className="muted text-sm block sm:inline sm:ml-3">
                {e.rows.filter(([, v]) => v).map(([k, v]) => (k ? `${k} ${v}` : v)).slice(0, 4).join("  ·  ")}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------ page body

export default function SwingLab() {
  const stream = useMotionStream();
  const live = stream.status === "listening";

  return (
    <main className="relative min-h-screen pt-28 pb-24 px-4 md:px-10">
      <div className="max-w-[56rem] mx-auto grid gap-6">
        <header>
          <p className="text-sm muted mb-2">Lab · not linked from the site</p>
          <h1 className="!text-5xl md:!text-6xl !mb-4">Swing recorder</h1>
          <p className="text-lg md:text-xl max-w-[52ch] text-pretty">
            Record raw motion from your phone to calibrate the golf, hoops, ski and crown gestures, and test the recognisers live. This page needs HTTPS and a phone.
          </p>
        </header>

        <section aria-labelledby="sensors-h" className={card}>
          <h2 id="sensors-h" className="text-2xl font-bold mb-3">Sensors</h2>
          <div className="flex flex-wrap gap-3 items-center">
            <button className={btnPrimary} onClick={stream.enable} disabled={live || stream.status === "requesting"}>
              {live ? "Sensors on" : "Turn on motion sensors"}
            </button>
            <p role="status" aria-live="polite" className="text-base">{stream.message}</p>
          </div>
          {live && (
            <p className="mt-3 text-sm muted font-mono">
              {stream.rateHz} Hz ·{" "}
              {stream.accelSign === null
                ? "checking accelerometer sign…"
                : stream.accelSign === 1
                  ? "accelerometer follows the spec (+g up at rest)"
                  : "accelerometer sign is inverted here; corrected for the recognisers (raw values are recorded)"}
            </p>
          )}
        </section>

        <section aria-labelledby="graph-h" className={card}>
          <h2 id="graph-h" className="text-2xl font-bold mb-3">Live signal</h2>
          <SensorGraph buffer={stream.buffer} active={live} />
        </section>

        <RecorderPanel stream={stream} />
        <TestPanel stream={stream} />
      </div>
    </main>
  );
}
