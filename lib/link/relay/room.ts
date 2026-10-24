// Pure room logic for the relay: no sockets, no timers, no I/O. Every function
// takes the clock as an argument and returns a new record, so the same rules
// run in the memory bus, in Redis (the record is stored as JSON) and in tests.
//
// A room is two seats. The host's seat is made with the code; the phone takes
// the other one by naming the code. Each seat knows which socket ("conn") holds
// it and, if that socket dropped, when. A seat that stays away longer than the
// grace period is given up: the host giving up ends the room, the phone giving
// up just frees the seat so another scan can take it.

import { CODE_ALPHABET, CODE_LENGTH } from "../wire";

export type Side = "host" | "phone";

export interface Limits {
  /** an unpaired code lives this long (from creation, or from the phone leaving) */
  codeTtlMs: number;
  /** how long a dropped socket may stay away before its seat is given up */
  graceMs: number;
  /** a socket that sends nothing at all (not even a keep-alive) for this long is closed */
  idleMs: number;
  /** biggest frame the relay will carry */
  maxMsgBytes: number;
  /** per-socket rate limit, frames per second */
  ratePerSec: number;
  /** how long a paired room's record is kept alive without a refresh */
  pairedTtlMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  codeTtlMs: 120_000,
  graceMs: 20_000,
  idleMs: 90_000,
  maxMsgBytes: 4096,
  ratePerSec: 120,
  pairedTtlMs: 180_000,
};

export interface Seat {
  /** secret handed to the socket that took the seat; needed to come back after a drop */
  key: string;
  /** id of the socket holding the seat now */
  conn: string | null;
  /** when that socket dropped, if it did and has not come back */
  away: number | null;
}

export interface RoomRecord {
  v: 1;
  code: string;
  createdAt: number;
  /** while the phone seat is empty: the moment the code stops working */
  pairDeadline: number | null;
  host: Seat;
  phone: Seat | null;
}

export type JoinErr = "bad-code" | "expired" | "full" | "bad-token";

// ---- randomness --------------------------------------------------------------------

type RandomFill = (a: Uint8Array) => Uint8Array;
const defaultFill: RandomFill = (a) => globalThis.crypto.getRandomValues(a);

/** A short code, uniformly from the alphabet (rejection sampling, no modulo bias). */
export function makeCode(fill: RandomFill = defaultFill): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";
  const buf = new Uint8Array(16);
  while (out.length < CODE_LENGTH) {
    fill(buf);
    for (let i = 0; i < buf.length && out.length < CODE_LENGTH; i++) {
      if (buf[i] < limit) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    }
  }
  return out;
}

export function makeKey(fill: RandomFill = defaultFill): string {
  const b = fill(new Uint8Array(16));
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

// ---- transitions ---------------------------------------------------------------------

export function newRoom(code: string, hostKey: string, hostConn: string, now: number, limits: Limits = DEFAULT_LIMITS): RoomRecord {
  return {
    v: 1,
    code,
    createdAt: now,
    pairDeadline: now + limits.codeTtlMs,
    host: { key: hostKey, conn: hostConn, away: null },
    phone: null,
  };
}

/** Is the phone seat taken by a socket that is still there? */
export function phoneHeld(r: RoomRecord): boolean {
  return r.phone !== null && r.phone.away === null;
}

/** Both seats filled by sockets that are here right now. */
export function bothHere(r: RoomRecord): boolean {
  return phoneHeld(r) && r.host.away === null;
}

export type JoinResult = { ok: true; rec: RoomRecord } | { ok: false; err: JoinErr };

/**
 * A phone takes the seat. A seat whose socket dropped can be taken over by a
 * fresh scan (a reloading phone page has no key to resume with).
 */
export function joinRoom(r: RoomRecord, phoneKey: string, phoneConn: string, now: number): JoinResult {
  if (r.phone !== null && r.phone.away === null) return { ok: false, err: "full" };
  if (r.phone === null && (r.pairDeadline === null || now > r.pairDeadline)) return { ok: false, err: "expired" };
  return {
    ok: true,
    rec: { ...r, pairDeadline: null, phone: { key: phoneKey, conn: phoneConn, away: null } },
  };
}

/** A socket that held a seat comes back with its key. */
export function resumeRoom(r: RoomRecord, side: Side, key: string, conn: string, now: number): JoinResult {
  const seat = side === "host" ? r.host : r.phone;
  if (!seat || seat.key !== key) return { ok: false, err: "bad-token" };
  if (side === "host" && r.phone === null && r.pairDeadline !== null && now > r.pairDeadline) {
    return { ok: false, err: "expired" };
  }
  const next = { ...seat, conn, away: null };
  return { ok: true, rec: side === "host" ? { ...r, host: next } : { ...r, phone: next } };
}

/** A socket dropped. Only counts if it is still the one holding the seat. */
export function detachSeat(r: RoomRecord, side: Side, conn: string, now: number): RoomRecord | null {
  const seat = side === "host" ? r.host : r.phone;
  if (!seat || seat.conn !== conn || seat.away !== null) return null;
  const next = { ...seat, away: now };
  return side === "host" ? { ...r, host: next } : { ...r, phone: next };
}

/** Give a seat up. The host's ends the room (null); the phone's frees its seat. */
export function leaveSeat(r: RoomRecord, side: Side, now: number, limits: Limits = DEFAULT_LIMITS): RoomRecord | null {
  if (side === "host") return null;
  if (r.phone === null) return r;
  return { ...r, phone: null, pairDeadline: now + limits.codeTtlMs };
}

/** Has this seat been gone for longer than the grace period? */
export function awayTooLong(r: RoomRecord, side: Side, now: number, limits: Limits = DEFAULT_LIMITS): boolean {
  const seat = side === "host" ? r.host : r.phone;
  return !!seat && seat.away !== null && now - seat.away >= limits.graceMs;
}

/** How long the store should keep this record, from now. */
export function recordTtlMs(r: RoomRecord, now: number, limits: Limits = DEFAULT_LIMITS): number {
  if (r.pairDeadline !== null) return Math.max(1000, r.pairDeadline - now);
  return limits.pairedTtlMs;
}

// ---- per-socket limits ------------------------------------------------------------------

/** A token bucket: `perSec` frames a second, with a burst of the same size. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  private readonly perSec: number;
  private readonly burst: number;

  constructor(perSec: number, now: number, burst: number = perSec) {
    this.perSec = perSec;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }

  /** true if the frame may pass */
  take(now: number): boolean {
    const dt = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + (dt * this.perSec) / 1000);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const encoder = new TextEncoder();

/** Is this frame over the cap? Avoids encoding when the answer is obvious. */
export function overSize(data: string | Uint8Array, maxBytes: number): boolean {
  if (typeof data !== "string") return data.byteLength > maxBytes;
  if (data.length > maxBytes) return true; // UTF-16 length is never more than the UTF-8 length
  if (data.length * 3 <= maxBytes) return false; // and UTF-8 is at most three bytes per unit
  return encoder.encode(data).length > maxBytes;
}
