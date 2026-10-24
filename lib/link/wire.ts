// What goes over the wire, shared by the relay (server) and the client.
//
// Keep this file free of DOM types and of anything Node-only: the relay runs
// it under Node's type stripping (so: no enums, no parameter properties, and
// `import type` for types), and the client bundles it for the browser.

import type { LinkMsg, Orient } from "./session";

// ---- codes -------------------------------------------------------------------

/** No 0/O, 1/I/L: a code read off a screen and typed on a phone survives. 31 symbols. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

/** Tidy what a person typed or a URL fragment carried; null if it cannot be a code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (s.length !== CODE_LENGTH) return null;
  for (let i = 0; i < s.length; i++) if (CODE_ALPHABET.indexOf(s[i]) < 0) return null;
  return s;
}

// ---- client <-> relay frames ---------------------------------------------------
//
// Text frames are JSON with a one-letter-ish `t`. The relay understands the
// control ones; the forwarded ones (m, s, p, o) it passes on untouched
// without looking inside. Binary frames starting with ORIENT_TAG are forwarded
// too.

/** client -> relay, handled by the relay */
export type ControlFrame =
  | { t: "host" }
  | { t: "join"; c: string }
  | { t: "resume"; c: string; k: string; r: "host" | "phone" }
  | { t: "bye" }
  /** keep-alive; the relay only notes that the socket is alive */
  | { t: "k" };

/** client -> relay -> the other client, unchanged */
export type ForwardFrame =
  | { t: "m"; d: LinkMsg }
  | { t: "s"; k: "offer" | "answer"; n: number; p: string }
  | { t: "p"; n: number }
  | { t: "o"; n: number };

export type RelayErr = "bad-code" | "expired" | "full" | "bad-token" | "no-room" | "bad-frame" | "size" | "rate" | "busy";
export type PeerEvent = "joined" | "away" | "back" | "gone";
export type ClosedWhy = "bye" | "expired" | "away" | "idle" | "abuse" | "replaced";

/** relay -> client */
export type ServerFrame =
  | { t: "room"; c: string; k: string; ttl: number }
  | { t: "joined"; k: string }
  /** peer: the other socket is here now; seat: the other seat is taken (its socket may be away) */
  | { t: "resumed"; peer: boolean; seat: boolean }
  | { t: "peer"; s: PeerEvent }
  | { t: "closed"; why: ClosedWhy }
  | { t: "err"; e: RelayErr };

export const FORWARD_TYPES: Record<string, true> = { m: true, s: true, p: true, o: true };
export const CONTROL_TYPES: Record<string, true> = { host: true, join: true, resume: true, bye: true, k: true };

// ---- the orientation frame ---------------------------------------------------------
//
// [u8 tag][u32 wireSeq][u32 seq][f64 t][f32 alpha][f32 beta][f32 gamma][f32 screenAngle], big-endian.
// wireSeq counts frames actually sent (so throttling is not mistaken for loss);
// seq is the caller's own number, handed back untouched.

export const ORIENT_TAG = 1;
export const ORIENT_FRAME_BYTES = 1 + 4 + 4 + 8 + 4 * 4;

export function packOrient(wireSeq: number, o: Orient): ArrayBuffer {
  const buf = new ArrayBuffer(ORIENT_FRAME_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, ORIENT_TAG);
  dv.setUint32(1, wireSeq >>> 0);
  dv.setUint32(5, o.seq >>> 0);
  dv.setFloat64(9, o.t);
  dv.setFloat32(17, o.alpha);
  dv.setFloat32(21, o.beta);
  dv.setFloat32(25, o.gamma);
  dv.setFloat32(29, o.screenAngle);
  return buf;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function unpackOrient(buf: unknown): { wireSeq: number; o: Orient } | null {
  let dv: DataView;
  if (buf instanceof ArrayBuffer) dv = new DataView(buf);
  else if (ArrayBuffer.isView(buf)) dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  else return null;
  if (dv.byteLength < ORIENT_FRAME_BYTES || dv.getUint8(0) !== ORIENT_TAG) return null;
  const o: Orient = {
    seq: dv.getUint32(5),
    t: dv.getFloat64(9),
    alpha: dv.getFloat32(17),
    beta: dv.getFloat32(21),
    gamma: dv.getFloat32(25),
    screenAngle: dv.getFloat32(29),
  };
  if (!num(o.t) || !num(o.alpha) || !num(o.beta) || !num(o.gamma) || !num(o.screenAngle)) return null;
  return { wireSeq: dv.getUint32(1), o };
}

// ---- validating what the other side sends -------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const MOTION = ["granted", "denied", "not-needed", "unavailable"];
const SCREENS = ["lock", "home", "piece"];

function isGestureData(v: unknown): boolean {
  if (!isObj(v)) return false;
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (typeof x !== "string" && typeof x !== "boolean" && !num(x)) return false;
  }
  return true;
}

/** Never trust what comes off a channel: shape-check before it reaches the UI. */
export function isLinkMsg(v: unknown): v is LinkMsg {
  if (!isObj(v) || typeof v.type !== "string") return false;
  switch (v.type) {
    case "hello":
      return (v.role === "host" || v.role === "phone") && typeof v.ua === "string" && MOTION.includes(v.motion as string);
    case "drag":
      return num(v.p);
    case "unlock":
    case "lock":
    case "recenter":
    case "bye":
      return true;
    case "tap":
      return num(v.x) && num(v.y);
    case "open":
      return typeof v.app === "string" && v.app.length <= 64;
    case "screen":
      return SCREENS.includes(v.name as string) && (v.piece === undefined || typeof v.piece === "string");
    case "gesture":
      return typeof v.name === "string" && isGestureData(v.data);
    case "axis":
      return typeof v.name === "string" && num(v.v);
    default:
      return false;
  }
}

/** Parse a text frame from the relay; null if it is not something we know. */
export function parseServerFrame(text: string): ServerFrame | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.t !== "string") return null;
  switch (v.t) {
    case "room":
      return typeof v.c === "string" && typeof v.k === "string" ? (v as unknown as ServerFrame) : null;
    case "joined":
      return typeof v.k === "string" ? (v as unknown as ServerFrame) : null;
    case "resumed":
    case "peer":
    case "closed":
    case "err":
      return v as unknown as ServerFrame;
    default:
      return null;
  }
}
