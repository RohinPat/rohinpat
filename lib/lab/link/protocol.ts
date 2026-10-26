// Wire format for the link lab: what rides on the unreliable `motion` channel
// and which extra messages (beyond the mirror's) ride on the reliable `ctrl`.

import type { FlickEvent, GolfSwingEvent } from "@/lib/lab/swing";

export type Recogniser = "golf" | "flick";
export type PhoneMode = "touchpad" | "swing";

/** Messages the mirror does not know about. JSON on `ctrl`. */
export type LinkExtra =
  | { type: "gesture"; t: number; gesture: "golf"; event: GolfSwingEvent }
  | { type: "gesture"; t: number; gesture: "flick"; event: FlickEvent }
  | { type: "gesture-reject"; t: number; gesture: string; reason: string; detail?: string }
  /** phone -> laptop: the phone switched between touchpad and swing test. */
  | { type: "mode"; t: number; mode: PhoneMode; recogniser: Recogniser | null }
  /** phone -> laptop: the phone's own diagnostics snapshot (plain JSON). */
  | { type: "diag"; t: number; d: Record<string, unknown> };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function isGolfEvent(v: unknown): v is GolfSwingEvent {
  return isObj(v) && v.type === "golf-swing" && isNum(v.clubSpeedMph) && isNum(v.tempo) && isNum(v.faceAngleDeg);
}
export function isFlickEvent(v: unknown): v is FlickEvent {
  return isObj(v) && v.type === "flick-up" && isNum(v.power) && isNum(v.aimDeg);
}

/** Never trust what comes off a channel: shape-check before use. */
export function isLinkExtra(v: unknown): v is LinkExtra {
  if (!isObj(v) || !isNum(v.t)) return false;
  switch (v.type) {
    case "gesture":
      return (v.gesture === "golf" && isGolfEvent(v.event)) || (v.gesture === "flick" && isFlickEvent(v.event));
    case "gesture-reject":
      return typeof v.gesture === "string" && typeof v.reason === "string";
    case "mode":
      return (v.mode === "touchpad" || v.mode === "swing") && (v.recogniser === null || v.recogniser === "golf" || v.recogniser === "flick");
    case "diag":
      return isObj(v.d);
    default:
      return false;
  }
}

// ---- orientation frame (unreliable channel) ----------------------------------
//
// [u32 seq][f64 t][f32 alpha][f32 beta][f32 gamma][f32 screenAngle], big-endian.
// The first 24 bytes are exactly the handshake lab's motion frame, so
// HandshakePeer's own parser reads them fine; the extra 4 bytes are ours.

export const ORIENT_FRAME_BYTES = 28;

export interface OrientFrame {
  seq: number;
  t: number;
  alpha: number;
  beta: number;
  gamma: number;
  screenAngle: number;
}

export function packOrient(f: OrientFrame): ArrayBuffer {
  const buf = new ArrayBuffer(ORIENT_FRAME_BYTES);
  const dv = new DataView(buf);
  dv.setUint32(0, f.seq >>> 0);
  dv.setFloat64(4, f.t);
  dv.setFloat32(12, f.alpha);
  dv.setFloat32(16, f.beta);
  dv.setFloat32(20, f.gamma);
  dv.setFloat32(24, f.screenAngle);
  return buf;
}

export function unpackOrient(buf: ArrayBuffer): OrientFrame | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < ORIENT_FRAME_BYTES) return null;
  const dv = new DataView(buf);
  const f: OrientFrame = {
    seq: dv.getUint32(0),
    t: dv.getFloat64(4),
    alpha: dv.getFloat32(12),
    beta: dv.getFloat32(16),
    gamma: dv.getFloat32(20),
    screenAngle: dv.getFloat32(24),
  };
  return isNum(f.t) && isNum(f.alpha) && isNum(f.beta) && isNum(f.gamma) && isNum(f.screenAngle) ? f : null;
}

// ---- how a detected gesture reads on the laptop -------------------------------

const signed = (x: number, d = 0) => `${x >= 0 ? "+" : "\u2212"}${Math.abs(x).toFixed(d)}`;

export function describeGesture(m: Extract<LinkExtra, { type: "gesture" }>): { title: string; line: string } {
  if (m.gesture === "golf") {
    const e = m.event;
    return {
      title: "Golf",
      line: `Golf: ${e.clubSpeedMph.toFixed(0)} mph, tempo ${e.tempo.toFixed(1)}:1, face ${signed(e.faceAngleDeg)}\u00b0`,
    };
  }
  const e = m.event;
  return { title: "Flick", line: `Flick: power ${e.power.toFixed(1)}, aim ${signed(e.aimDeg)}\u00b0` };
}
