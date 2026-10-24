// The browser side of the phone link: implements LinkSession (see session.ts).
//
//   1. Open a WebSocket to the first-party relay, get a room (host) or join one
//      with the code (phone). Say hello.
//   2. Both sides are paired and talking through the relay. The host then
//      offers a direct WebRTC connection, with the SDP carried over the relay
//      and `iceServers: []`, so no third-party server is ever contacted.
//   3. If a direct channel opens within `directTimeoutMs` (8 s), messages and
//      orientation go that way (`path: "direct"`, orientation up to 60 Hz).
//      Otherwise, or if it later dies, they stay on the relay (30 Hz, small
//      binary frames). The UI only ever sees onState callbacks.
//   4. The relay connection closes after at most five minutes (the function's
//      maxDuration) and whenever the network blips. Either side reconnects
//      with exponential backoff and takes its seat back with a secret it keeps
//      in memory; the relay holds the seat for a grace period.
//
// Nothing is stored on the device: no cookies, no localStorage; the secret
// lives in this object and dies with it.

import type { LinkMsg, LinkPath, LinkSession, LinkState, LinkStats, Orient, Role } from "./session";
import { MedianWindow, RateWindow, SeqTracker } from "./diagnostics";
import { createRtcPeer, type DirectPeer } from "./peer";
import {
  isLinkMsg,
  normalizeCode,
  packOrient,
  parseServerFrame,
  unpackOrient,
  type ForwardFrame,
  type ControlFrame,
  type ServerFrame,
} from "./wire";

/** The slice of WebSocket the client uses; tests pass a fake. */
export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export type MotionState = "granted" | "denied" | "not-needed" | "unavailable";

export interface LinkOptions {
  /** ws(s):// URL of the relay. Default: NEXT_PUBLIC_LINK_RELAY, else same-origin /api/link. */
  relayUrl?: string;
  /** Origin for pairUrl. Default: location.origin. */
  origin?: string;
  createSocket?: (url: string) => SocketLike;
  /** A direct peer, or null to stay on the relay. Default: a real RTCPeerConnection. */
  createPeer?: () => DirectPeer | null;
  /** How long to wait for the direct channel before settling on the relay. Default 8000. */
  directTimeoutMs?: number;
  /** After a direct path drops, the host tries again this often (up to 3 times). 0 disables. Default 10000. */
  directRetryMs?: number;
  /** What the hello says about motion permission (phone). Re-send hello after the permission outcome. */
  motion?: () => MotionState;
  /** Clock for throttling and RTT; default performance.now(). */
  now?: () => number;
  /** Default Math.random; for deterministic backoff in tests. */
  random?: () => number;
}

const WS_OPEN = 1;

export const RELAY_ORIENT_HZ = 30;
export const DIRECT_ORIENT_HZ = 60;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** how long a lost relay connection is retried before the session gives up */
const GIVE_UP_MS = 35_000;
const KEEPALIVE_MS = 20_000;
const TICK_MS = 1000;
const RELAY_PING_EVERY_MS = 3000;
/** nothing at all from the other side for this long on the relay: call it quiet */
const PEER_QUIET_MS = 10_000;
/** nothing at all on a direct path for this long: it is dead */
const DIRECT_DEAD_MS = 4000;
const QUEUE_MAX = 64;
const MAX_DIRECT_RETRIES = 3;
/** a pose behind this much unsent relay data is stale: skip it */
const MAX_RELAY_BUFFER = 32 * 1024;

function defaultRelayUrl(): string {
  const env = process.env.NEXT_PUBLIC_LINK_RELAY;
  if (env) return env;
  if (typeof location === "undefined") return "wss://localhost/api/link";
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/link`;
}

function defaultSocket(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike;
}

function defaultMotion(): MotionState {
  if (typeof DeviceOrientationEvent === "undefined") return "unavailable";
  const needsAsk = typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === "function";
  return needsAsk ? "denied" : "not-needed";
}

interface Direct {
  peer: DirectPeer;
  id: number;
  open: boolean;
}

class LinkClient implements LinkSession {
  readonly role: Role;
  private _state: LinkState;
  private _path: LinkPath | null = null;
  private _code: string | null;
  private token: string | null = null;

  private readonly opts: LinkOptions;
  private readonly now: () => number;
  private readonly rand: () => number;
  private readonly relayUrl: string;
  private readonly directTimeoutMs: number;
  private readonly directRetryMs: number;

  private ws: SocketLike | null = null;
  private relayUp = false;
  private attempt = 0;
  /** when the relay connection was lost (or the session began); null while connected */
  private lostAt: number | null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private ended = false;
  /** the relay told us the room is over; do not reconnect */
  private relayDone = false;
  private peerPresent = false;
  private peerAway = false;
  private quiet = false;
  private settled = false;
  private direct: Direct | null = null;
  /** phone: a peer made ahead of the offer, so a device without WebRTC settles on the relay at once */
  private spare: DirectPeer | null = null;
  private directIds = 0;
  private retries = 0;
  private queue: LinkMsg[] = [];

  private lastPeerRx = 0;
  private lastDirectRx = 0;
  private lastPingAt = 0;
  private lastRelayPingAt = 0;
  private pingId = 0;
  private pings = new Map<number, number>();
  private rtt = new MedianWindow(5);
  private rx = new RateWindow(1000);
  private tx = new RateWindow(1000);
  private seq = new SeqTracker();
  private wireSeq = 0;
  private lastOrientSentAt = -Infinity;
  private pendingOrient: Orient | null = null;

  private msgSubs = new Set<(m: LinkMsg) => void>();
  private orientSubs = new Set<(o: Orient) => void>();
  private stateSubs = new Set<(s: LinkState, p: LinkPath | null) => void>();

  constructor(role: Role, code: string | null, opts: LinkOptions) {
    this.role = role;
    this.opts = opts;
    this._code = code;
    this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.rand = opts.random ?? Math.random;
    this.relayUrl = opts.relayUrl ?? defaultRelayUrl();
    this.directTimeoutMs = opts.directTimeoutMs ?? 8000;
    this.directRetryMs = opts.directRetryMs ?? 10_000;
    this._state = role === "host" ? "waiting" : "connecting";
    this.lostAt = this.now();

    if (role === "phone" && code === null) {
      // not a code: closed straight away, announced once listeners had a chance to attach
      this._state = "closed";
      this.ended = true;
      queueMicrotask(() => this.stateSubs.forEach((cb) => this.safe(() => cb("closed", null))));
      return;
    }
    this.connectRelay();
  }

  // ---------- LinkSession ----------

  get state(): LinkState {
    return this._state;
  }
  get path(): LinkPath | null {
    return this._state === "live" ? this._path : null;
  }
  get code(): string | null {
    return this.role === "host" ? this._code : null;
  }
  get pairUrl(): string | null {
    if (this.role !== "host" || !this._code) return null;
    const origin = this.opts.origin ?? (typeof location !== "undefined" ? location.origin : "");
    return `${origin}/p#c=${this._code}`;
  }

  stats(): LinkStats {
    const t = this.now();
    return {
      path: this.path,
      rttMs: this.rtt.value,
      orientHz: Math.round(this.role === "host" ? this.rx.hz(t) : this.tx.hz(t)),
      lossPct: Math.round(this.seq.lossPct * 10) / 10,
    };
  }

  send(msg: LinkMsg): void {
    if (this.ended) return;
    if (this.direct?.open && this.direct.peer.sendReliable(JSON.stringify(msg))) return;
    if (this.relayUp && this.peerPresent && !this.peerAway) {
      this.relaySend({ t: "m", d: msg });
      return;
    }
    // between sockets with a peer still expected: hold it for the reconnect
    if (this.peerPresent && (this._state === "reconnecting" || this._state === "live" || this._state === "connecting")) {
      if (this.queue.length >= QUEUE_MAX) this.queue.shift();
      this.queue.push(msg);
    }
  }

  sendOrient(o: Orient): void {
    if (this.ended || (this._state !== "live" && this._state !== "connecting")) return;
    const direct = !!this.direct?.open;
    if (!direct && !(this.relayUp && this.peerPresent && !this.peerAway)) return;
    const t = this.now();
    const interval = 1000 / (direct ? DIRECT_ORIENT_HZ : RELAY_ORIENT_HZ);
    const due = this.lastOrientSentAt + interval - 1; // 1 ms of slack for timer jitter
    if (t >= due) {
      this.pendingOrient = null;
      this.transmitOrient(o, t);
      return;
    }
    // too soon: keep the newest and send it when the slot opens, so the last pose before a pause still arrives
    this.pendingOrient = o;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const p = this.pendingOrient;
        this.pendingOrient = null;
        if (p && !this.ended) this.sendOrient(p);
      }, Math.max(0, due - t));
    }
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
    if (this.ended) return;
    const bye: LinkMsg = { type: "bye" };
    if (this.direct?.open) this.direct.peer.sendReliable(JSON.stringify(bye));
    if (this.relayUp) this.relayRaw(JSON.stringify({ t: "bye" } satisfies ControlFrame));
    this.finish();
  }

  // ---------- state ----------

  private safe(fn: () => void) {
    try {
      fn();
    } catch {
      /* a listener's bug must not break the link */
    }
  }

  private setState(state: LinkState, force = false) {
    const prevPath = this.path;
    const prev = this._state;
    this._state = state;
    if (!force && prev === state && prevPath === this.path) return;
    this.emit();
  }

  private emit() {
    const s = this._state;
    const p = this.path;
    this.stateSubs.forEach((cb) => this.safe(() => cb(s, p)));
  }

  private setPath(path: LinkPath | null) {
    if (this._path === path) return;
    const before = this.path;
    this._path = path;
    this.rtt.reset();
    this.lastPingAt = 0;
    if (this.path !== before) this.emit();
  }

  /** Done for good: stop everything and tell listeners. */
  private finish() {
    if (this.ended && this._state === "closed") return;
    this.ended = true;
    this.relayDone = true;
    for (const t of [this.reconnectTimer, this.settleTimer, this.attemptTimer, this.retryTimer, this.flushTimer]) {
      if (t) clearTimeout(t);
    }
    this.reconnectTimer = this.settleTimer = this.attemptTimer = this.retryTimer = this.flushTimer = null;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.keepaliveTimer = this.tickTimer = null;
    this.dropDirect();
    this.spare?.close();
    this.spare = null;
    const ws = this.ws;
    this.ws = null;
    this.relayUp = false;
    this.queue = [];
    this.pendingOrient = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, "bye");
      } catch {
        /* ignore */
      }
    }
    this._path = null;
    this.setState("closed");
  }

  // ---------- relay socket ----------

  private connectRelay() {
    if (this.ended) return;
    let ws: SocketLike;
    try {
      ws = (this.opts.createSocket ?? defaultSocket)(this.relayUrl);
    } catch {
      this.onRelayLost(null);
      return;
    }
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.relayUp = true;
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = setInterval(() => this.relaySend({ t: "k" }), KEEPALIVE_MS);
      if (this.token && this._code) this.relaySend({ t: "resume", c: this._code, k: this.token, r: this.role });
      else if (this.role === "host") this.relaySend({ t: "host" });
      else this.relaySend({ t: "join", c: this._code! });
    };
    ws.onmessage = (ev) => {
      if (this.ws === ws) this.onRelayData(ev.data);
    };
    ws.onerror = () => {
      /* a close always follows */
    };
    ws.onclose = () => this.onRelayLost(ws);
  }

  private relaySend(f: ControlFrame | ForwardFrame) {
    this.relayRaw(JSON.stringify(f));
  }

  private relayRaw(data: string | ArrayBufferLike) {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return;
    try {
      this.ws.send(data);
    } catch {
      /* the close handler deals with it */
    }
  }

  private onRelayLost(sock: SocketLike | null) {
    if (sock && this.ws !== sock) return;
    this.ws = null;
    this.relayUp = false;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    if (this.ended || this.relayDone) return;
    // with a direct channel up, the relay is only the fallback: reconnect without bothering the UI
    if (this.peerPresent && !this.direct?.open && (this._state === "live" || this._state === "connecting")) {
      this.setState("reconnecting");
    }
    if (this.lostAt === null) this.lostAt = this.now();
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt);
    this.attempt++;
    const delay = Math.min(BACKOFF_MAX_MS, Math.round(base * (0.75 + 0.5 * this.rand())));
    // the relay keeps a seat for ~20 s; a retry that would land long after that is pointless
    if (this.now() + delay - this.lostAt > GIVE_UP_MS) {
      this.finish();
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectRelay();
    }, delay);
  }

  private connected() {
    this.attempt = 0;
    this.lostAt = null;
  }

  private onRelayData(data: unknown) {
    if (typeof data !== "string") {
      this.onOrientFrame(data);
      return;
    }
    const f = parseServerFrame(data);
    if (!f) {
      this.onForwarded(data);
      return;
    }
    this.onServerFrame(f);
  }

  private onServerFrame(f: ServerFrame) {
    switch (f.t) {
      case "room":
        this.connected();
        this.token = f.k;
        this._code = f.c;
        this.setState("waiting", true); // same state, but the code is there now
        return;
      case "joined":
        this.connected();
        this.token = f.k;
        this.onPaired(true);
        return;
      case "resumed":
        this.connected();
        if (f.peer) {
          this.peerPresent = true;
          this.peerAway = false;
          this.onPaired(false);
        } else if (f.seat) {
          // the other side holds its seat but its socket is away: wait for "back" (or "gone")
          this.peerPresent = true;
          this.peerAway = true;
          if (!this.direct?.open && (this._state === "live" || this._state === "connecting")) this.setState("reconnecting");
        } else if (this.peerPresent) {
          // the phone gave up its seat while we were away
          this.onPeerGone();
        }
        return;
      case "peer":
        if (f.s === "joined") this.onPaired(true);
        else if (f.s === "back") {
          this.peerAway = false;
          this.peerPresent = true;
          this.onPaired(false);
        } else if (f.s === "away") {
          this.peerAway = true;
          if (!this.direct?.open && (this._state === "live" || this._state === "connecting")) this.setState("reconnecting");
        } else if (f.s === "gone") this.onPeerGone();
        return;
      case "closed":
        this.relayDone = true;
        this.finish();
        return;
      case "err":
        if (f.e === "bad-code" || f.e === "expired" || f.e === "full" || f.e === "bad-token" || f.e === "no-room") {
          this.relayDone = true;
          this.finish();
        } else if (f.e === "busy" && !this.token) {
          // the relay hit trouble creating or joining: back off and try again
          try {
            this.ws?.close();
          } catch {
            /* ignore */
          }
        }
        return;
    }
  }

  // ---------- pairing ----------

  private hello(): LinkMsg {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "";
    const motion = this.role === "phone" ? (this.opts.motion ?? defaultMotion)() : "not-needed";
    return { type: "hello", role: this.role, ua, motion };
  }

  /**
   * The other side is on the relay with us. `fresh` means a new socket took the
   * seat (a first scan, or a reload), so any old direct path is stale.
   */
  private onPaired(fresh: boolean) {
    if (this.ended) return;
    this.peerPresent = true;
    this.peerAway = false;
    this.lastPeerRx = this.now();
    this.quiet = false;
    if (!this.tickTimer) this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    if (fresh) {
      this.dropDirect();
      this.setPath("relay");
    } else if (!this.direct?.open) this.setPath("relay");
    if (this._state === "waiting" || (this._state === "connecting" && !this.settleTimer && !this.settled)) {
      this.setState("connecting");
      this.armSettle();
    } else if (this._state === "reconnecting") {
      this.setState(this.settled ? "live" : "connecting");
      if (!this.settled) this.armSettle();
    }
    this.relaySend({ t: "m", d: this.hello() });
    this.flushQueue();
    if (this.role === "host" && !this.direct) this.startDirect();
    else if (this.role === "phone" && !this.direct && !this.spare) {
      this.spare = this.makePeer();
      if (!this.spare && this._state === "connecting") this.settleOnRelay(); // no WebRTC here: the relay it is
    }
  }

  private onPeerGone() {
    this.peerPresent = false;
    this.peerAway = false;
    this.dropDirect();
    this.queue = [];
    this.pendingOrient = null;
    this.settled = false;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.seq.reset();
    this.setPath(null);
    if (this.role === "host") this.setState("waiting", true);
    else this.finish();
  }

  /** connecting -> live on the relay if the direct upgrade has not happened by then. */
  private armSettle() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this._state === "connecting") this.settleOnRelay();
    }, this.directTimeoutMs);
  }

  private settleOnRelay() {
    this.settled = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.setPath(this.direct?.open ? "direct" : "relay");
    this.setState("live");
    this.flushQueue();
  }

  private flushQueue() {
    if (!this.queue.length) return;
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.send(m);
  }

  // ---------- direct path ----------

  private makePeer(): DirectPeer | null {
    try {
      return (this.opts.createPeer ?? createRtcPeer)();
    } catch {
      return null;
    }
  }

  private newDirect(id: number): Direct | null {
    const peer = this.spare ?? this.makePeer();
    this.spare = null;
    if (!peer) return null;
    this.dropDirect();
    const d: Direct = { peer, id, open: false };
    this.direct = d;
    peer.onOpen = () => this.onDirectOpen(d);
    peer.onClose = () => this.onDirectDown(d);
    peer.onReliable = (text) => this.onDirectText(text);
    peer.onUnreliable = (buf) => this.onOrientFrame(buf);
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    this.attemptTimer = setTimeout(() => {
      this.attemptTimer = null;
      if (this.direct === d && !d.open) this.onDirectDown(d);
    }, this.directTimeoutMs);
    return d;
  }

  /** Host: offer a direct channel. */
  private startDirect() {
    if (this.role !== "host" || this.ended || !this.peerPresent) return;
    const d = this.newDirect(++this.directIds);
    if (!d) {
      if (this._state === "connecting") this.settleOnRelay();
      return;
    }
    d.peer
      .createOffer()
      .then((p) => {
        if (this.direct === d) this.relaySend({ t: "s", k: "offer", n: d.id, p });
      })
      .catch(() => this.onDirectDown(d));
  }

  private onSignal(f: Extract<ForwardFrame, { t: "s" }>) {
    if (typeof f.p !== "string" || f.p.length > 3000 || typeof f.n !== "number") return;
    if (f.k === "offer" && this.role === "phone") {
      const d = this.newDirect(f.n);
      if (!d) return;
      d.peer
        .acceptOffer(f.p)
        .then((p) => {
          if (this.direct === d) this.relaySend({ t: "s", k: "answer", n: d.id, p });
        })
        .catch(() => this.onDirectDown(d));
    } else if (f.k === "answer" && this.role === "host") {
      const d = this.direct;
      if (!d || d.id !== f.n) return;
      d.peer.acceptAnswer(f.p).catch(() => this.onDirectDown(d));
    }
  }

  private onDirectOpen(d: Direct) {
    if (this.direct !== d || this.ended) return;
    d.open = true;
    this.retries = 0;
    this.lastDirectRx = this.now();
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    this.attemptTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.settled = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.quiet = false;
    this.rtt.reset();
    this.setPath("direct");
    if (this._state !== "live") this.setState("live");
    // the relay may have carried messages meanwhile; anything queued goes now
    this.flushQueue();
  }

  private onDirectDown(d: Direct) {
    if (this.direct !== d) return;
    const wasOpen = d.open;
    this.dropDirect();
    if (this.ended) return;
    if (wasOpen) {
      // back to the relay; the UI hears about it only through onState
      this.lastPeerRx = this.now();
      this.setPath(this.relayUp ? "relay" : null);
      if (!this.relayUp && this._state === "live" && this.peerPresent) this.setState("reconnecting");
    } else if (this._state === "connecting") {
      this.settleOnRelay();
    }
    this.scheduleDirectRetry();
  }

  private scheduleDirectRetry() {
    if (this.role !== "host" || this.directRetryMs <= 0 || this.retries >= MAX_DIRECT_RETRIES || this.retryTimer || !this.peerPresent) return;
    this.retries++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.direct && this.peerPresent && !this.ended) this.startDirect();
    }, this.directRetryMs);
  }

  private dropDirect() {
    const d = this.direct;
    this.direct = null;
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    this.attemptTimer = null;
    if (!d) return;
    d.peer.onOpen = d.peer.onClose = d.peer.onReliable = d.peer.onUnreliable = null;
    try {
      d.peer.close();
    } catch {
      /* ignore */
    }
  }

  // ---------- incoming ----------

  private touchPeer() {
    this.lastPeerRx = this.now();
    if (this.quiet) {
      this.quiet = false;
      if (this._state === "reconnecting" && this.peerPresent && !this.peerAway) this.setState("live");
    }
  }

  private onDirectText(text: string) {
    this.lastDirectRx = this.now();
    this.touchPeer();
    if (text.startsWith("p:")) {
      this.direct?.peer.sendReliable("e:" + text.slice(2));
    } else if (text.startsWith("e:")) {
      this.pong(Number(text.slice(2)));
    } else this.onForwarded(text);
  }

  /** A text frame that is not a relay event: a message, a signal, or a ping. */
  private onForwarded(text: string) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof v !== "object" || v === null) return;
    const f = v as { t?: unknown; d?: unknown; n?: unknown };
    this.touchPeer();
    if (f.t === "m" || (f.t === undefined && "type" in f)) {
      // relay envelope {t:"m",d}, or a bare LinkMsg from the direct channel
      const msg = f.t === "m" ? f.d : v;
      if (isLinkMsg(msg)) this.deliver(msg);
    } else if (f.t === "s") {
      this.onSignal(v as Extract<ForwardFrame, { t: "s" }>);
    } else if (f.t === "p" && typeof f.n === "number") {
      this.relaySend({ t: "o", n: f.n });
    } else if (f.t === "o" && typeof f.n === "number") {
      this.pong(f.n);
    }
  }

  private deliver(msg: LinkMsg) {
    this.msgSubs.forEach((cb) => this.safe(() => cb(msg)));
    if (msg.type === "bye") {
      // the other side is leaving; the relay will say so too
      if (this.role === "phone") {
        this.relayDone = true;
        this.finish();
      } else this.onPeerGone();
    }
  }

  private onOrientFrame(buf: unknown) {
    const r = unpackOrient(buf);
    if (!r) return;
    this.touchPeer();
    const t = this.now();
    if (this.direct?.open) this.lastDirectRx = t;
    this.seq.add(r.wireSeq);
    this.rx.hit(t);
    this.orientSubs.forEach((cb) => this.safe(() => cb(r.o)));
  }

  private pong(id: number) {
    const t0 = this.pings.get(id);
    if (t0 === undefined) return;
    this.pings.delete(id);
    this.rtt.add(this.now() - t0);
  }

  // ---------- outgoing orientation ----------

  private transmitOrient(o: Orient, t: number) {
    const frame = packOrient(this.wireSeq, o);
    let sent = false;
    if (this.direct?.open) {
      sent = this.direct.peer.sendUnreliable(frame);
    } else if (this.relayUp && this.ws && (this.ws.bufferedAmount ?? 0) < MAX_RELAY_BUFFER) {
      this.relayRaw(frame);
      sent = true;
    }
    if (!sent) return;
    this.wireSeq = (this.wireSeq + 1) >>> 0;
    this.lastOrientSentAt = t;
    this.tx.hit(t);
  }

  // ---------- heartbeat ----------

  private tick() {
    if (this.ended || !this.peerPresent) return;
    if (this._state !== "live" && this._state !== "connecting" && this._state !== "reconnecting") return;
    const t = this.now();
    const d = this.direct;
    if (d?.open) {
      if (t - this.lastDirectRx > DIRECT_DEAD_MS) {
        this.onDirectDown(d);
        return;
      }
      const id = ++this.pingId;
      this.pings.set(id, t);
      this.lastPingAt = t;
      d.peer.sendReliable("p:" + id);
    } else if (this.relayUp && !this.peerAway) {
      if (t - this.lastRelayPingAt >= RELAY_PING_EVERY_MS) {
        this.lastRelayPingAt = t;
        const id = ++this.pingId;
        this.pings.set(id, t);
        this.relaySend({ t: "p", n: id });
      }
      if (!this.quiet && t - this.lastPeerRx > PEER_QUIET_MS) {
        this.quiet = true;
        if (this._state === "live") this.setState("reconnecting");
      }
    }
    if (this.pings.size > 32) {
      const oldest = this.pings.keys().next().value;
      if (oldest !== undefined) this.pings.delete(oldest);
    }
  }
}

/** The laptop side: asks the relay for a room and shows `code` / `pairUrl`. */
export function hostLink(opts: LinkOptions = {}): LinkSession {
  return new LinkClient("host", null, opts);
}

/** The phone side: joins the room named by `code` (a bad one gives a `closed` session). */
export function joinLink(code: string, opts: LinkOptions = {}): LinkSession {
  return new LinkClient("phone", normalizeCode(code), opts);
}
