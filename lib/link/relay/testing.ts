// Test doubles shared by the link unit tests. Not imported by production code.

import type { RedisOps } from "./bus";
import type { RelayConn, RelayHub, RelaySocket } from "./hub";
import type { SocketLike } from "../client";
import type { DirectPeer } from "../peer";

/** An in-memory stand-in for the Redis server and its pub/sub, speaking the RedisOps interface. */
export class FakeRedis implements RedisOps {
  kv = new Map<string, { v: string; exp: number }>();
  channels = new Map<string, (p: Uint8Array) => void>();
  commands: string[] = [];
  casFailuresToInject = 0;

  private live(k: string) {
    const e = this.kv.get(k);
    if (e && e.exp <= Date.now()) {
      this.kv.delete(k);
      return undefined;
    }
    return e;
  }
  async setNx(k: string, v: string, ttlSec: number) {
    this.commands.push("SET NX");
    if (this.live(k)) return false;
    this.kv.set(k, { v, exp: Date.now() + ttlSec * 1000 });
    return true;
  }
  async get(k: string) {
    this.commands.push("GET");
    return this.live(k)?.v ?? null;
  }
  async cas(k: string, prev: string, next: string, ttlSec: number) {
    this.commands.push("EVAL");
    if (this.casFailuresToInject > 0) {
      this.casFailuresToInject--;
      // someone else wrote in between
      const e = this.live(k);
      if (e) e.v = e.v + " ";
      return false;
    }
    const e = this.live(k);
    if (!e || e.v !== prev) return false;
    this.kv.set(k, { v: next, exp: Date.now() + ttlSec * 1000 });
    return true;
  }
  async del(k: string) {
    this.commands.push("DEL");
    this.kv.delete(k);
  }
  async expire(k: string, ttlSec: number) {
    this.commands.push("EXPIRE");
    const e = this.live(k);
    if (e) e.exp = Date.now() + ttlSec * 1000;
  }
  async publish(channel: string, payload: Uint8Array) {
    this.commands.push("PUBLISH");
    const l = this.channels.get(channel);
    if (l) queueMicrotask(() => l(new Uint8Array(payload)));
  }
  async subscribe(channel: string, onMessage: (p: Uint8Array) => void) {
    this.commands.push("SUBSCRIBE");
    this.channels.set(channel, onMessage);
  }
  async unsubscribe(channel: string) {
    this.commands.push("UNSUBSCRIBE");
    this.channels.delete(channel);
  }
  async quit() {
    this.commands.push("QUIT");
  }
}


// ---- hub-side fake socket ---------------------------------------------------------------

/** What a hub sees as a client: records everything it is sent. */
export class FakeRelaySocket implements RelaySocket {
  sent: (string | Uint8Array)[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  bufferedAmount = 0;
  conn: RelayConn;

  constructor(hub: RelayHub) {
    this.conn = hub.connect(this);
  }
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
  }
  /** client -> relay */
  tx(frame: object | string | Uint8Array) {
    this.conn.message(typeof frame === "string" || frame instanceof Uint8Array ? frame : JSON.stringify(frame));
  }
  /** parsed JSON frames the relay sent */
  get frames(): Record<string, unknown>[] {
    return this.sent.filter((x): x is string => typeof x === "string").map((x) => JSON.parse(x));
  }
  /** frames of one type */
  of(t: string) {
    return this.frames.filter((f) => f.t === t);
  }
  get binary(): Uint8Array[] {
    return this.sent.filter((x): x is Uint8Array => typeof x !== "string");
  }
  /** the transport dropped */
  drop() {
    this.conn.close();
  }
}

// ---- client-side fake socket wired into a real hub -----------------------------------------

/** A WebSocket-shaped object whose far end is a RelayHub in the same process. */
export class LoopSocket implements SocketLike {
  readyState = 0;
  binaryType = "blob";
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  bufferedAmount = 0;
  /** every frame the client sent */
  sent: (string | ArrayBufferLike | ArrayBufferView)[] = [];
  private conn: RelayConn | null = null;
  private closing = false;

  constructor(
    private readonly net: LoopNet,
    readonly url: string,
  ) {
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      if (net.refuse) {
        this.readyState = 3;
        this.onclose?.();
        return;
      }
      this.readyState = 1;
      this.conn = net.hub.connect({
        send: (d) => queueMicrotask(() => this.deliver(d)),
        close: () => this.remoteClose(),
        get bufferedAmount() {
          return 0;
        },
      });
      this.onopen?.();
    });
  }
  private deliver(d: string | Uint8Array) {
    if (this.readyState === 3) return;
    const data = typeof d === "string" ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    this.onmessage?.({ data });
  }
  send(data: string | ArrayBufferLike | ArrayBufferView) {
    if (this.readyState !== 1 || this.closing) throw new Error("socket not open");
    this.sent.push(data);
    if (typeof data === "string") this.conn?.message(data);
    else if (ArrayBuffer.isView(data)) this.conn?.message(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    else this.conn?.message(new Uint8Array(data as ArrayBuffer));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.conn?.close();
    queueMicrotask(() => this.onclose?.());
  }
  /** The far end closed: frames it sent first are still delivered, as on a real socket. */
  private remoteClose() {
    if (this.readyState === 3 || this.closing) return;
    this.closing = true;
    queueMicrotask(() => {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.conn?.close();
      this.onclose?.();
    });
  }
  /** the network dropped */
  drop() {
    this.remoteClose();
  }
}

export class LoopNet {
  sockets: LoopSocket[] = [];
  /** new connections are refused while true */
  refuse = false;
  constructor(readonly hub: RelayHub) {}
  create = (url: string): SocketLike => {
    const s = new LoopSocket(this, url);
    this.sockets.push(s);
    return s;
  };
  get live(): LoopSocket[] {
    return this.sockets.filter((s) => s.readyState === 1);
  }
}

// ---- fake direct peers ------------------------------------------------------------------------

export class FakePeer implements DirectPeer {
  onOpen: (() => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  onReliable: ((text: string) => void) | null = null;
  onUnreliable: ((buf: ArrayBuffer) => void) | null = null;
  isOpen = false;
  closed = false;
  remote: FakePeer | null = null;
  reliableSent: string[] = [];
  unreliableSent: ArrayBuffer[] = [];
  offered: string | null = null;

  constructor(
    readonly net: FakePeerNet,
    readonly id: string,
  ) {}

  async createOffer() {
    this.offered = `offer:${this.id}`;
    return this.offered;
  }
  async acceptOffer(payload: string) {
    if (!payload.startsWith("offer:")) throw new Error("bad offer");
    this.remote = this.net.peers.get(payload.slice(6)) ?? null;
    return `answer:${this.id}`;
  }
  async acceptAnswer(payload: string) {
    if (!payload.startsWith("answer:")) throw new Error("bad answer");
    this.remote = this.net.peers.get(payload.slice(7)) ?? null;
    if (this.net.works && this.remote) {
      const r = this.remote;
      r.remote = this;
      queueMicrotask(() => {
        if (this.closed || r.closed) return;
        this.isOpen = r.isOpen = true;
        this.onOpen?.();
        r.onOpen?.();
      });
    }
  }
  sendReliable(text: string) {
    if (!this.isOpen) return false;
    this.reliableSent.push(text);
    const r = this.remote;
    if (r && !this.net.blackhole) queueMicrotask(() => r.isOpen && r.onReliable?.(text));
    return true;
  }
  sendUnreliable(buf: ArrayBuffer) {
    if (!this.isOpen) return false;
    this.unreliableSent.push(buf);
    const r = this.remote;
    if (r && !this.net.blackhole) queueMicrotask(() => r.isOpen && r.onUnreliable?.(buf.slice(0)));
    return true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.isOpen = false;
    const r = this.remote;
    if (r && !r.closed) {
      r.closed = true;
      r.isOpen = false;
      queueMicrotask(() => r.onClose?.("remote closed"));
    }
  }
  /** the connection died on its own */
  fail() {
    const r = this.remote;
    this.closed = true;
    this.isOpen = false;
    this.onClose?.("failed");
    if (r) {
      r.closed = true;
      r.isOpen = false;
      r.onClose?.("failed");
    }
  }
}

export class FakePeerNet {
  peers = new Map<string, FakePeer>();
  made: FakePeer[] = [];
  /** when false, negotiation completes but the channel never opens */
  works = true;
  /** when true, frames sent on an open channel vanish (a path that died silently) */
  blackhole = false;
  /** when true, createPeer returns null (no WebRTC) */
  unsupported = false;
  private n = 0;
  make = (): DirectPeer | null => {
    if (this.unsupported) return null;
    const p = new FakePeer(this, String(++this.n));
    this.peers.set(p.id, p);
    this.made.push(p);
    return p;
  };
}
