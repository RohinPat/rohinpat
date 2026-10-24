// A deliberately tiny seam between "phone" and "laptop". The POC uses a
// BroadcastChannel (two tabs on one machine); the real thing would put a WebRTC
// RTCDataChannel behind the same interface, so nothing above this file changes.

import type { Platform } from "./orientation";

export type MirrorMessage =
  /** phone -> laptop: I'm here. */
  | { type: "hello"; t: number; platform: Platform; ua: string; screen: { w: number; h: number } }
  /** laptop -> phone: got you, streaming can start. */
  | { type: "ready"; t: number }
  /** phone -> laptop: one deviceorientation sample (degrees). t = sender epoch ms. */
  | { type: "orient"; t: number; seq: number; alpha: number; beta: number; gamma: number; screenAngle: number }
  /** phone -> laptop: one devicemotion sample. */
  | {
      type: "motion";
      t: number;
      /** accelerationIncludingGravity, m/s^2, already sign-normalised */
      ax: number;
      ay: number;
      az: number;
      /** rotationRate, deg/s: alpha (z), beta (x), gamma (y) */
      ra: number;
      rb: number;
      rg: number;
    }
  /** phone -> laptop: finger on the lock layer; dy is -1 (top) .. 0 as a fraction of the phone's height. */
  | { type: "drag"; t: number; dy: number }
  | { type: "unlock"; t: number }
  /** phone -> laptop: a tap, x and y as 0..1 of the phone's screen. */
  | { type: "tap"; t: number; x: number; y: number }
  /** either way: take the current pose as neutral. */
  | { type: "recalibrate"; t: number }
  /** laptop -> phone: lock again (so a demo can be repeated). */
  | { type: "lock"; t: number }
  | { type: "ping"; t0: number }
  | { type: "pong"; t0: number; t1: number };

export interface Transport {
  send(msg: MirrorMessage): void;
  /** Subscribe; returns an unsubscribe function. */
  onMessage(cb: (msg: MirrorMessage) => void): () => void;
  close(): void;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Never trust what comes off a channel: shape-check before use. */
export function isMirrorMessage(v: unknown): v is MirrorMessage {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  switch (m.type) {
    case "hello":
      return isNum(m.t) && typeof m.ua === "string" && typeof m.platform === "string";
    case "ready":
    case "unlock":
    case "recalibrate":
    case "lock":
      return isNum(m.t);
    case "orient":
      return isNum(m.t) && isNum(m.seq) && isNum(m.alpha) && isNum(m.beta) && isNum(m.gamma) && isNum(m.screenAngle);
    case "motion":
      return isNum(m.t) && isNum(m.ax) && isNum(m.ay) && isNum(m.az) && isNum(m.ra) && isNum(m.rb) && isNum(m.rg);
    case "drag":
      return isNum(m.t) && isNum(m.dy);
    case "tap":
      return isNum(m.t) && isNum(m.x) && isNum(m.y);
    case "ping":
      return isNum(m.t0);
    case "pong":
      return isNum(m.t0) && isNum(m.t1);
    default:
      return false;
  }
}

/** Two tabs on one origin. BroadcastChannel never echoes to the sender's own instance. */
export class BroadcastChannelTransport implements Transport {
  private ch: BroadcastChannel;
  private subs = new Set<(m: MirrorMessage) => void>();
  constructor(room = "default") {
    this.ch = new BroadcastChannel(`lab-mirror:${room}`);
    this.ch.onmessage = (e: MessageEvent) => {
      if (!isMirrorMessage(e.data)) return;
      this.subs.forEach((s) => s(e.data));
    };
  }
  send(msg: MirrorMessage): void {
    this.ch.postMessage(msg);
  }
  onMessage(cb: (msg: MirrorMessage) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  close(): void {
    this.subs.clear();
    this.ch.close();
  }
}

/** An in-memory pair, for unit tests (and a future "demo without a phone" mode). */
export function createLoopbackPair(): [Transport, Transport] {
  const make = () => {
    const subs = new Set<(m: MirrorMessage) => void>();
    return { subs };
  };
  const a = make();
  const b = make();
  const wrap = (mine: ReturnType<typeof make>, theirs: ReturnType<typeof make>): Transport => ({
    send(msg) {
      // structured-clone like a real channel, and deliver asynchronously
      const copy = JSON.parse(JSON.stringify(msg)) as MirrorMessage;
      queueMicrotask(() => {
        theirs.subs.forEach((s) => s(copy));
      });
    },
    onMessage(cb) {
      mine.subs.add(cb);
      return () => mine.subs.delete(cb);
    },
    close() {
      mine.subs.clear();
    },
  });
  return [wrap(a, b), wrap(b, a)];
}

// ---- clock sync ------------------------------------------------------------
// Epoch milliseconds with sub-ms resolution. Same-machine tabs share it; across
// devices the clocks differ, so the laptop estimates the offset with ping/pong.
export const epochNow = (): number => performance.timeOrigin + performance.now();

/**
 * NTP-style offset estimate. offset = (phone clock) - (laptop clock). Keeps the
 * sample with the smallest round trip, which has the least asymmetry error.
 */
export class ClockSync {
  offset = 0;
  rtt = Infinity;
  /** smoothed one-way latency estimate, ms */
  latency = 0;
  private samples = 0;
  /** t2 = laptop time the pong arrived. */
  addPong(t0: number, t1: number, t2: number): void {
    const rtt = t2 - t0;
    if (rtt < 0) return;
    this.samples++;
    this.latency = this.samples === 1 ? rtt / 2 : this.latency + 0.2 * (rtt / 2 - this.latency);
    if (rtt <= this.rtt * 1.25 || this.samples < 3) {
      // allow the estimate to follow drift a little, but prefer the cleanest sample
      this.rtt = Math.min(rtt, this.rtt === Infinity ? rtt : this.rtt * 1.02);
      this.offset = t1 - (t0 + rtt / 2);
    }
  }
}
