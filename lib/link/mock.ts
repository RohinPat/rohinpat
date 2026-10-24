// A LinkSession over BroadcastChannel, so two tabs of one browser can pair
// with a code and the whole UI can be built and tested without the relay.
// Same names as the real client (`hostLink`, `joinLink`), so swapping is one
// import in useLink.ts. It is honest about being local: path is "direct".
//
// Wire format: one envelope per message, tagged with the code and who it is
// from/to, because every tab on the channel hears everything.

import { looksLikeCode, normaliseCode } from "./code";
import type { LinkMsg, LinkPath, LinkSession, LinkState, LinkStats, Orient, Role } from "./session";

const CHANNEL = "phone-link-mock:v1";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export type MockOptions = {
  /** host: how long a code waits for a phone before it dies (the relay uses two minutes) */
  ttlMs?: number;
  /** phone: how long to keep knocking before giving up */
  joinTimeoutMs?: number;
  /** ping interval; silence for 4x is "reconnecting", 12x is gone */
  heartbeatMs?: number;
  path?: LinkPath;
};

type Wire = {
  c: string;
  from: string;
  role: Role;
  to?: string;
  k: "join" | "accept" | "msg" | "orient" | "ping" | "pong" | "bye";
  m?: LinkMsg;
  o?: Orient;
  t?: number;
};

const newId = () => Math.random().toString(36).slice(2, 10);

export function newCode(len = 6): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

class MockLink implements LinkSession {
  readonly role: Role;
  readonly code: string | null;
  readonly pairUrl: string | null;
  state: LinkState;
  path: LinkPath | null = null;

  private readonly id = newId();
  private readonly wireCode: string;
  private readonly opts: Required<MockOptions>;
  private ch: BroadcastChannel | null;
  private peer: string | null = null;
  private msgSubs = new Set<(m: LinkMsg) => void>();
  private orientSubs = new Set<(o: Orient) => void>();
  private stateSubs = new Set<(s: LinkState, p: LinkPath | null) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private lastHeard = 0;
  private rtt: number | null = null;
  private arrivals: number[] = [];
  private got = 0;
  private lost = 0;
  private lastSeq = -1;

  constructor(role: Role, code: string, opts: MockOptions = {}) {
    this.role = role;
    this.wireCode = code;
    this.opts = { ttlMs: 120_000, joinTimeoutMs: 2500, heartbeatMs: 1000, path: "direct", ...opts };
    this.code = role === "host" ? code : null;
    this.pairUrl = role === "host" ? `${location.origin}/p#c=${code}` : null;
    this.state = role === "host" ? "waiting" : "connecting";

    if (typeof BroadcastChannel === "undefined" || (role === "phone" && !looksLikeCode(code))) {
      this.ch = null;
      this.state = "closed";
      return;
    }
    this.ch = new BroadcastChannel(CHANNEL);
    this.ch.onmessage = (e: MessageEvent) => this.onWire(e.data as Wire);

    if (role === "host") {
      this.timers.push(setTimeout(() => this.state === "waiting" && this.end(), this.opts.ttlMs));
    } else {
      const started = performance.now();
      const knock = () => {
        if (this.state !== "connecting") return;
        if (performance.now() - started > this.opts.joinTimeoutMs) return this.end();
        this.post({ k: "join" });
        this.timers.push(setTimeout(knock, 250));
      };
      knock();
    }
  }

  stats(): LinkStats {
    const now = performance.now();
    this.arrivals = this.arrivals.filter((t) => now - t < 1000);
    const total = this.got + this.lost;
    return {
      path: this.path,
      rttMs: this.rtt,
      orientHz: this.arrivals.length,
      lossPct: total ? (this.lost / total) * 100 : 0,
    };
  }

  send(msg: LinkMsg): void {
    if (this.peer && this.state !== "closed") this.post({ k: "msg", m: msg, to: this.peer });
  }

  sendOrient(o: Orient): void {
    if (this.peer && this.state === "live") this.post({ k: "orient", o, to: this.peer });
  }

  onMessage(cb: (msg: LinkMsg) => void): () => void {
    this.msgSubs.add(cb);
    return () => this.msgSubs.delete(cb);
  }
  onOrient(cb: (o: Orient) => void): () => void {
    this.orientSubs.add(cb);
    return () => this.orientSubs.delete(cb);
  }
  onState(cb: (state: LinkState, path: LinkPath | null) => void): () => void {
    this.stateSubs.add(cb);
    return () => this.stateSubs.delete(cb);
  }

  close(): void {
    if (this.state === "closed") return;
    if (this.peer) this.post({ k: "bye", to: this.peer });
    this.end();
  }

  // ---- internals ----------------------------------------------------------

  private post(w: Omit<Wire, "c" | "from" | "role">): void {
    this.ch?.postMessage({ ...w, c: this.wireCode, from: this.id, role: this.role } satisfies Wire);
  }

  private setState(s: LinkState): void {
    if (s === this.state) return;
    this.state = s;
    this.path = s === "live" || s === "reconnecting" ? this.opts.path : s === "closed" ? null : this.path;
    this.stateSubs.forEach((cb) => cb(s, this.path));
  }

  private end(): void {
    this.timers.forEach(clearTimeout);
    this.intervals.forEach(clearInterval);
    this.timers = [];
    this.intervals = [];
    this.peer = null;
    this.setState("closed");
    this.ch?.close();
    this.ch = null;
  }

  private goLive(peer: string): void {
    this.peer = peer;
    this.lastHeard = performance.now();
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.setState("live");
    const hb = this.opts.heartbeatMs;
    this.intervals.push(
      setInterval(() => {
        const quiet = performance.now() - this.lastHeard;
        if (quiet > hb * 12) return this.end();
        if (quiet > hb * 4) this.setState("reconnecting");
        this.post({ k: "ping", t: performance.now(), to: this.peer ?? undefined });
      }, hb),
    );
  }

  private onWire(w: Wire): void {
    if (!w || w.c !== this.wireCode || w.from === this.id || w.role === this.role) return;
    if (w.to && w.to !== this.id) return;
    switch (w.k) {
      case "join":
        // the host takes the first phone that knocks; later knockers are told no
        if (this.role !== "host") return;
        if (this.state === "waiting" || this.state === "connecting") {
          this.post({ k: "accept", to: w.from });
          this.goLive(w.from);
        } else if (w.from !== this.peer) {
          this.post({ k: "bye", to: w.from });
        }
        return;
      case "accept":
        if (this.role === "phone" && this.state === "connecting") this.goLive(w.from);
        return;
    }
    if (w.from !== this.peer) return;
    this.lastHeard = performance.now();
    if (this.state === "reconnecting") this.setState("live");
    switch (w.k) {
      case "msg":
        if (w.m) this.msgSubs.forEach((cb) => cb(w.m as LinkMsg));
        return;
      case "orient":
        if (w.o) {
          this.arrivals.push(performance.now());
          this.got++;
          if (this.lastSeq >= 0 && w.o.seq > this.lastSeq + 1) this.lost += w.o.seq - this.lastSeq - 1;
          this.lastSeq = w.o.seq;
          this.orientSubs.forEach((cb) => cb(w.o as Orient));
        }
        return;
      case "ping":
        this.post({ k: "pong", t: w.t, to: w.from });
        return;
      case "pong":
        if (typeof w.t === "number") {
          const r = performance.now() - w.t;
          this.rtt = this.rtt === null ? r : this.rtt + 0.3 * (r - this.rtt);
        }
        return;
      case "bye":
        this.end();
        return;
    }
  }
}

/** Start hosting: a fresh code, waiting for a phone. */
export function hostLink(opts?: MockOptions): LinkSession {
  return new MockLink("host", newCode(), opts);
}

/** Join the host that shows `code`. */
export function joinLink(code: string, opts?: MockOptions): LinkSession {
  return new MockLink("phone", normaliseCode(code), opts);
}
