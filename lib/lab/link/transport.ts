// The mirror's Transport over a HandshakePeer.
//
//   orient            -> `motion` channel (unordered, maxRetransmits 0): a stale sample is worthless
//   everything else   -> `ctrl` channel (reliable, ordered) as JSON: hello, ready, unlock, drag, tap,
//                        recalibrate, lock, ping, pong, plus the link-only LinkExtra messages
//   "motion" (accel)  -> not sent: nothing in this lab uses it, and the recognisers run on the phone
//
// The peer's own `p:` / `e:` ping text shares the ctrl channel; it is consumed by HandshakePeer
// before it reaches us, and JSON never starts with those prefixes.

import type { HandshakePeer } from "@/lib/lab/handshake/peer";
import { isMirrorMessage, type MirrorMessage, type Transport } from "@/lib/lab/mirror/transport";
import { isLinkExtra, packOrient, unpackOrient, type LinkExtra } from "./protocol";

/** Skip an orientation sample rather than queue it behind this many unsent bytes. */
const MAX_MOTION_BUFFER = 16 * 1024;

export interface TransportCounters {
  orientSent: number;
  orientSkippedBackpressure: number;
  orientReceived: number;
  ctrlSent: number;
  ctrlReceived: number;
  /** send() while a channel was not open, or send() threw. */
  dropped: number;
  /** Frames or JSON that failed validation. */
  rejected: number;
}

export class HandshakeTransport implements Transport {
  readonly counters: TransportCounters = {
    orientSent: 0,
    orientSkippedBackpressure: 0,
    orientReceived: 0,
    ctrlSent: 0,
    ctrlReceived: 0,
    dropped: 0,
    rejected: 0,
  };
  private subs = new Set<(m: MirrorMessage) => void>();
  private extraSubs = new Set<(m: LinkExtra) => void>();
  private closed = false;
  private readonly onMotionMsg = (e: MessageEvent) => {
    const f = e.data instanceof ArrayBuffer ? unpackOrient(e.data) : null;
    if (!f) {
      this.counters.rejected++;
      return;
    }
    this.counters.orientReceived++;
    const m: MirrorMessage = { type: "orient", t: f.t, seq: f.seq, alpha: f.alpha, beta: f.beta, gamma: f.gamma, screenAngle: f.screenAngle };
    this.subs.forEach((s) => s(m));
  };

  constructor(private readonly peer: HandshakePeer) {
    // the peer keeps every motion frame in motionRx for its own lab; we do not need that history
    peer.onMotion = () => {
      peer.motionRx.length = 0;
    };
    peer.onCtrlText = (s) => this.onCtrl(s);
    peer.motion.addEventListener("message", this.onMotionMsg);
  }

  private onCtrl(s: string) {
    let v: unknown;
    try {
      v = JSON.parse(s);
    } catch {
      this.counters.rejected++;
      return;
    }
    this.counters.ctrlReceived++;
    if (isMirrorMessage(v)) this.subs.forEach((cb) => cb(v));
    else if (isLinkExtra(v)) this.extraSubs.forEach((cb) => cb(v));
    else this.counters.rejected++;
  }

  private sendCtrl(obj: unknown) {
    if (this.closed || this.peer.ctrl.readyState !== "open") {
      this.counters.dropped++;
      return;
    }
    try {
      this.peer.ctrl.send(JSON.stringify(obj));
      this.counters.ctrlSent++;
    } catch {
      this.counters.dropped++;
    }
  }

  send(msg: MirrorMessage): void {
    if (msg.type === "orient") {
      const ch = this.peer.motion;
      if (this.closed || ch.readyState !== "open") {
        this.counters.dropped++;
        return;
      }
      if (ch.bufferedAmount > MAX_MOTION_BUFFER) {
        this.counters.orientSkippedBackpressure++;
        return;
      }
      try {
        ch.send(packOrient(msg));
        this.counters.orientSent++;
      } catch {
        this.counters.dropped++;
      }
      return;
    }
    if (msg.type === "motion") return;
    this.sendCtrl(msg);
  }

  sendExtra(msg: LinkExtra): void {
    this.sendCtrl(msg);
  }

  onMessage(cb: (msg: MirrorMessage) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  onExtra(cb: (msg: LinkExtra) => void): () => void {
    this.extraSubs.add(cb);
    return () => this.extraSubs.delete(cb);
  }

  /** Detaches from the peer. The peer (and its connection) belongs to the page and is closed there. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.subs.clear();
    this.extraSubs.clear();
    this.peer.motion.removeEventListener("message", this.onMotionMsg);
    this.peer.onCtrlText = null;
    this.peer.onMotion = null;
  }
}
