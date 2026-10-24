// The relay's brain: takes sockets, runs rooms through the bus, forwards frames.
//
// Nothing here depends on a WebSocket library. The Vercel route and the dev
// relay each wrap their socket in a RelaySocket and hand frames to the
// RelayConn this returns. Frames are forwarded without being read: the relay
// parses only its own control frames, and it never logs message contents.

import { ORIENT_TAG, CONTROL_TYPES, FORWARD_TYPES, normalizeCode, type ServerFrame, type RelayErr, type ClosedWhy } from "../wire";
import { DELETE, KEEP, type Bus, type BusFrame } from "./bus";
import {
  DEFAULT_LIMITS,
  RateLimiter,
  awayTooLong,
  detachSeat,
  joinRoom,
  leaveSeat,
  makeCode,
  makeKey,
  newRoom,
  overSize,
  recordTtlMs,
  resumeRoom,
  type JoinResult,
  type Limits,
  type RoomRecord,
  type Side,
} from "./room";

export interface RelaySocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  /** bytes queued but not yet on the wire, if the library says */
  readonly bufferedAmount?: number;
}

export interface RelayConn {
  /** a frame arrived from the client */
  message(data: string | Uint8Array): void;
  /** the socket closed (for any reason) */
  close(): void;
}

export interface HubOptions {
  bus: Bus;
  limits?: Partial<Limits>;
  now?: () => number;
  /** operational messages only, never frame contents */
  log?: (msg: string) => void;
}

type Phase = "new" | "joining" | "ready" | "dead";
const other = (s: Side): Side => (s === "host" ? "phone" : "host");
/** drop orientation frames rather than queue them behind this much unsent data */
const MAX_BUFFERED = 64 * 1024;
const MAX_BAD_FRAMES = 20;
const MAX_BAD_JOINS = 4;
const MAX_VIOLATIONS = 400;
const TOUCH_EVERY_MS = 60_000;
const IDLE_CHECK_MS = 15_000;

function timer<T extends ReturnType<typeof setTimeout>>(t: T): T {
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}

const json = (f: ServerFrame): string => JSON.stringify(f);

export class RelayHub {
  readonly limits: Limits;
  readonly bus: Bus;
  readonly now: () => number;
  readonly log: (msg: string) => void;
  private readonly local = new Map<string, { host?: Conn; phone?: Conn }>();
  private readonly conns = new Set<Conn>();

  constructor(opts: HubOptions) {
    this.bus = opts.bus;
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.log ?? (() => undefined);
  }

  connect(socket: RelaySocket): RelayConn {
    const c = new Conn(this, socket);
    this.conns.add(c);
    return { message: (d) => c.onClientFrame(d), close: () => c.onSocketClosed() };
  }

  stats(): { sockets: number; rooms: number } {
    return { sockets: this.conns.size, rooms: this.local.size };
  }

  /** dev/test only: kill a socket as if the network dropped */
  debugDrop(code: string, side: Side): boolean {
    const c = this.local.get(code)?.[side];
    if (!c) return false;
    c.dropForTest();
    return true;
  }

  /** Close every socket (they will reconnect elsewhere) and the bus. */
  async shutdown(): Promise<void> {
    for (const c of Array.from(this.conns)) c.dropForTest();
    await this.bus.close();
  }

  // -- local registry (which sockets this instance holds) --

  register(c: Conn) {
    const e = this.local.get(c.code!) ?? {};
    e[c.side!] = c;
    this.local.set(c.code!, e);
  }

  unregister(c: Conn) {
    if (!c.code || !c.side) return;
    const e = this.local.get(c.code);
    if (!e) return;
    if (e[c.side] === c) delete e[c.side];
    if (!e.host && !e.phone) this.local.delete(c.code);
  }

  forget(c: Conn) {
    this.unregister(c);
    this.conns.delete(c);
  }

  /** Hand a frame to a side: straight to its socket if it is here, else over the bus. */
  deliver(code: string, to: Side, frame: BusFrame) {
    const here = this.local.get(code)?.[to];
    if (here && here.phase === "ready") {
      here.onFrame(frame);
      return;
    }
    this.bus.publish(code, to, frame).catch((e) => this.log(`[link] publish failed: ${String(e)}`));
  }

  /**
   * A seat has been away long enough: give it up. Safe to call from either
   * side's timer, and more than once.
   */
  async expireSeat(code: string, side: Side): Promise<void> {
    let left = false;
    const now = this.now();
    try {
      await this.bus.update(
        code,
        (r) => {
          left = false;
          if (!awayTooLong(r, side, now, this.limits)) return KEEP;
          left = true;
          return leaveSeat(r, side, now, this.limits) ?? DELETE;
        },
        (r) => recordTtlMs(r, this.now(), this.limits),
      );
    } catch (e) {
      this.log(`[link] expire failed: ${String(e)}`);
      return;
    }
    if (!left) return;
    if (side === "host") this.deliver(code, "phone", json({ t: "closed", why: "away" }));
    else this.deliver(code, "host", json({ t: "peer", s: "gone" }));
  }
}

class Conn {
  readonly id = makeKey().slice(0, 12);
  phase: Phase = "new";
  code: string | null = null;
  side: Side | null = null;
  private key: string | null = null;
  private lastRx: number;
  private readonly limiter: RateLimiter;
  private chain: Promise<void> = Promise.resolve();
  private unsub: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private touchTimer: ReturnType<typeof setInterval> | null = null;
  private awayTimer: ReturnType<typeof setTimeout> | null = null;
  private badFrames = 0;
  private badJoins = 0;
  private violations = 0;
  private lastErrAt = 0;
  private explicit = false;
  private readonly hub: RelayHub;
  private readonly socket: RelaySocket;

  constructor(hub: RelayHub, socket: RelaySocket) {
    this.hub = hub;
    this.socket = socket;
    this.lastRx = hub.now();
    this.limiter = new RateLimiter(hub.limits.ratePerSec, hub.now());
    this.idleTimer = timer(setInterval(() => this.checkIdle(), IDLE_CHECK_MS));
  }

  // ---------- from the client ----------

  onClientFrame(data: string | Uint8Array): void {
    if (this.phase === "dead") return;
    const now = this.hub.now();
    this.lastRx = now;
    if (overSize(data, this.hub.limits.maxMsgBytes)) {
      this.err("size");
      return;
    }
    if (!this.limiter.take(now)) {
      if (++this.violations > MAX_VIOLATIONS) this.end("abuse", 1008, true, true);
      else this.err("rate");
      return;
    }
    if (typeof data !== "string") {
      if (this.phase === "ready" && data.byteLength > 0 && data[0] === ORIENT_TAG) this.forward(data);
      return;
    }
    let t: unknown;
    try {
      t = (JSON.parse(data) as { t?: unknown } | null)?.t;
    } catch {
      t = undefined;
    }
    const ty = typeof t === "string" ? t : "";
    if (FORWARD_TYPES[ty]) {
      if (this.phase === "ready") this.forward(data);
      else this.err("no-room");
      return;
    }
    if (!CONTROL_TYPES[ty]) {
      this.bad();
      return;
    }
    if (ty === "k") return;
    // A client sends bye and closes in the same breath, so the close event can arrive before the
    // queued bye has run. Mark it now so that close is not mistaken for a dropped network.
    if (ty === "bye" && this.phase === "ready") this.explicit = true;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(data) as Record<string, unknown>;
    } catch {
      this.bad();
      return;
    }
    // control frames change room state: run them one at a time, in order
    this.chain = this.chain.then(() => this.control(ty, o)).catch((e) => {
      this.hub.log(`[link] control ${ty} failed: ${String(e)}`);
      this.err("busy");
    });
  }

  private bad() {
    this.err("bad-frame");
    if (++this.badFrames > MAX_BAD_FRAMES) this.end("abuse", 1008, true, true);
  }

  private err(e: RelayErr) {
    // one error frame a second at most, so a flood does not echo back as a flood
    const now = this.hub.now();
    if (e !== "rate" || now - this.lastErrAt > 1000) {
      this.lastErrAt = now;
      this.sendRaw(json({ t: "err", e }));
    }
  }

  private async control(ty: string, o: Record<string, unknown>): Promise<void> {
    if (this.phase === "dead") return;
    switch (ty) {
      case "host":
        return this.doHost();
      case "join":
        return this.doJoin(o.c);
      case "resume":
        return this.doResume(o.c, o.k, o.r);
      case "bye":
        return this.doBye();
    }
  }

  // ---------- control ----------

  private async doHost(): Promise<void> {
    if (this.phase !== "new") return this.bad();
    this.phase = "joining";
    const { hub } = this;
    const key = makeKey();
    for (let i = 0; i < 8; i++) {
      const code = makeCode();
      const rec = newRoom(code, key, this.id, hub.now(), hub.limits);
      if (!(await hub.bus.reserve(code, rec, recordTtlMs(rec, hub.now(), hub.limits)))) continue;
      if (this.phase !== "joining") {
        await hub.bus.remove(code);
        return;
      }
      this.code = code;
      this.side = "host";
      this.key = key;
      try {
        this.unsub = await hub.bus.subscribe(code, "host", (f) => this.onFrame(f));
      } catch (e) {
        await hub.bus.remove(code).catch(() => undefined);
        throw e;
      }
      if (this.phase !== "joining") {
        this.unsub?.();
        this.unsub = null;
        await hub.bus.remove(code).catch(() => undefined);
        return;
      }
      this.phase = "ready";
      hub.register(this);
      this.armDeadline(rec.pairDeadline!);
      this.sendRaw(json({ t: "room", c: code, k: key, ttl: hub.limits.codeTtlMs }));
      return;
    }
    this.err("busy");
    this.end("abuse", 1013);
  }

  /** Subscribe, then take or retake a seat atomically. On failure nothing is left subscribed. */
  private async takeSeat(
    code: string,
    side: Side,
    mutate: (r: RoomRecord, now: number) => JoinResult,
  ): Promise<{ rec: RoomRecord } | { err: RelayErr }> {
    const { hub } = this;
    const unsub = await hub.bus.subscribe(code, side, (f) => this.onFrame(f));
    try {
      const out: { failure: RelayErr | null; after: RoomRecord | null } = { failure: null, after: null };
      const res = await hub.bus.update(
        code,
        (r) => {
          out.failure = null;
          out.after = null;
          const j = mutate(r, hub.now());
          if (!j.ok) {
            out.failure = j.err;
            return KEEP;
          }
          out.after = j.rec;
          return j.rec;
        },
        (r) => recordTtlMs(r, hub.now(), hub.limits),
      );
      if (!res.found || out.failure || !out.after) {
        unsub();
        return { err: out.failure ?? "bad-code" };
      }
      this.unsub = unsub;
      return { rec: out.after };
    } catch (e) {
      unsub();
      throw e;
    }
  }

  private async doJoin(rawCode: unknown): Promise<void> {
    if (this.phase !== "new") return this.bad();
    const code = normalizeCode(rawCode);
    if (!code) return this.badJoin("bad-code");
    const { hub } = this;
    this.phase = "joining";
    try {
      // look before subscribing, so guessing codes does not cost a subscription each
      if (!(await hub.bus.get(code))) return this.failSeat("bad-code");
      const key = makeKey();
      const r = await this.takeSeat(code, "phone", (rec, now) => joinRoom(rec, key, this.id, now));
      if ("err" in r) return this.failSeat(r.err);
      this.code = code;
      this.side = "phone";
      this.key = key;
      if (!this.becomeReady()) return;
      this.sendRaw(json({ t: "joined", k: key }));
      hub.deliver(code, "host", json({ t: "peer", s: "joined" }));
    } catch (e) {
      this.failSeat("busy");
      throw e;
    }
  }

  private async doResume(rawCode: unknown, rawKey: unknown, rawSide: unknown): Promise<void> {
    if (this.phase !== "new") return this.bad();
    const code = normalizeCode(rawCode);
    const side: Side | null = rawSide === "host" || rawSide === "phone" ? rawSide : null;
    if (!code || !side || typeof rawKey !== "string" || rawKey.length > 64) return this.badJoin("bad-token");
    const { hub } = this;
    this.phase = "joining";
    try {
      const cur = await hub.bus.get(code);
      if (!cur) return this.failSeat("bad-code");
      const first = resumeRoom(cur, side, rawKey, this.id, hub.now());
      if (!first.ok) return this.failSeat(first.err);
      const r = await this.takeSeat(code, side, (rec, now) => resumeRoom(rec, side, rawKey, this.id, now));
      if ("err" in r) return this.failSeat(r.err);
      this.code = code;
      this.side = side;
      this.key = rawKey;
      if (!this.becomeReady()) return;
      const rec = r.rec;
      const otherSeat = side === "host" ? rec.phone : rec.host;
      const peer = !!otherSeat && otherSeat.conn !== null && otherSeat.away === null;
      this.sendRaw(json({ t: "resumed", peer, seat: !!otherSeat }));
      if (side === "host") {
        if (rec.pairDeadline !== null) this.armDeadline(rec.pairDeadline);
        else this.startTouching();
      }
      if (otherSeat) hub.deliver(code, other(side), json({ t: "peer", s: "back" }));
    } catch (e) {
      this.failSeat("busy");
      throw e;
    }
  }

  private badJoin(e: RelayErr) {
    this.err(e);
    if (++this.badJoins >= MAX_BAD_JOINS) this.end("abuse", 1008, true, false);
  }

  /** A seat attempt failed: back to "new" (unless the socket died meanwhile). */
  private failSeat(e: RelayErr) {
    if (this.phase === "joining") this.phase = "new";
    this.code = null;
    this.side = null;
    this.badJoin(e);
  }

  /**
   * The seat is ours in the store. If the socket died while we were getting
   * it, hand the seat straight back (as an away seat) instead of leaving a
   * ghost holding it.
   */
  private becomeReady(): boolean {
    if (this.phase !== "joining") {
      this.unsub?.();
      this.unsub = null;
      this.detachFlow();
      return false;
    }
    this.phase = "ready";
    this.hub.register(this);
    return true;
  }

  private async doBye(): Promise<void> {
    if (this.phase !== "ready" || !this.code || !this.side) {
      this.end("bye", 1000, false);
      return;
    }
    const code = this.code;
    const side = this.side;
    this.explicit = true;
    const now = this.hub.now();
    try {
      await this.hub.bus.update(
        code,
        (r) => leaveSeat(r, side, now, this.hub.limits) ?? DELETE,
        (r) => recordTtlMs(r, this.hub.now(), this.hub.limits),
      );
    } catch (e) {
      this.hub.log(`[link] bye failed: ${String(e)}`);
    }
    if (side === "host") this.hub.deliver(code, "phone", json({ t: "closed", why: "bye" }));
    else this.hub.deliver(code, "host", json({ t: "peer", s: "gone" }));
    this.end("bye", 1000, false);
  }

  // ---------- to the client ----------

  /** A frame addressed to this socket, from the other side or from the relay itself. */
  onFrame(f: BusFrame): void {
    if (this.phase !== "ready") return;
    if (typeof f === "string") {
      // only the relay's own events need a look; forwarded frames pass untouched
      if (f.startsWith('{"t":"peer"') || f.startsWith('{"t":"closed"')) {
        let ev: ServerFrame | null = null;
        try {
          ev = JSON.parse(f) as ServerFrame;
        } catch {
          ev = null;
        }
        if (ev?.t === "closed") {
          this.sendRaw(f);
          this.end(ev.why, 1000, false);
          return;
        }
        if (ev?.t === "peer") this.onPeerEvent(ev.s);
      }
      this.sendRaw(f);
      return;
    }
    if ((this.socket.bufferedAmount ?? 0) > MAX_BUFFERED) return; // orientation is perishable
    this.sendRaw(f);
  }

  private onPeerEvent(s: string) {
    const { hub } = this;
    if (s === "away") {
      // the other side's own timer should give its seat up; this is the backstop
      if (this.awayTimer) clearTimeout(this.awayTimer);
      const code = this.code!;
      const peer = other(this.side!);
      this.awayTimer = timer(setTimeout(() => void hub.expireSeat(code, peer), hub.limits.graceMs + 1500));
    } else if (this.awayTimer) {
      clearTimeout(this.awayTimer);
      this.awayTimer = null;
    }
    if (this.side === "host") {
      if (s === "joined" || s === "back") {
        if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
        this.deadlineTimer = null;
        this.startTouching();
      } else if (s === "gone") {
        this.stopTouching();
        this.armDeadline(hub.now() + hub.limits.codeTtlMs);
      }
    }
  }

  private forward(data: BusFrame) {
    const code = this.code!;
    this.hub.deliver(code, other(this.side!), data);
  }

  private sendRaw(data: string | Uint8Array) {
    try {
      this.socket.send(data);
    } catch {
      /* the socket is on its way out; its close event does the clean-up */
    }
  }

  // ---------- timers ----------

  private checkIdle() {
    if (this.phase === "dead") return;
    if (this.hub.now() - this.lastRx > this.hub.limits.idleMs) {
      this.hub.log("[link] idle socket closed");
      try {
        this.socket.close(4408, "idle");
      } catch {
        /* ignore */
      }
      this.onSocketClosed();
    }
  }

  /** The host's code stops working at `at` unless a phone has taken the seat by then. */
  private armDeadline(at: number) {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    const code = this.code!;
    const wait = Math.max(0, at - this.hub.now()) + 50;
    this.deadlineTimer = timer(
      setTimeout(async () => {
        this.deadlineTimer = null;
        if (this.phase !== "ready") return;
        try {
          const rec = await this.hub.bus.get(code);
          if (rec && rec.pairDeadline === null) return; // paired in the meantime
          if (rec && rec.pairDeadline !== null && this.hub.now() <= rec.pairDeadline) {
            this.armDeadline(rec.pairDeadline); // the phone left and the clock restarted
            return;
          }
          await this.hub.bus.remove(code);
        } catch {
          /* fall through: close the host either way */
        }
        if (this.phase !== "ready") return;
        this.sendRaw(json({ t: "closed", why: "expired" }));
        this.end("expired", 1000, false);
      }, wait),
    );
  }

  private startTouching() {
    if (this.touchTimer || !this.code) return;
    const code = this.code;
    this.touchTimer = timer(
      setInterval(() => {
        this.hub.bus.touch(code, this.hub.limits.pairedTtlMs).catch(() => undefined);
      }, TOUCH_EVERY_MS),
    );
  }

  private stopTouching() {
    if (this.touchTimer) clearInterval(this.touchTimer);
    this.touchTimer = null;
  }

  // ---------- closing ----------

  /** The transport closed. Unless we ended it on purpose, the seat goes "away" for the grace period. */
  onSocketClosed(): void {
    if (this.phase === "dead") return;
    if (this.explicit && this.phase === "ready") return; // a bye is being processed and will tear down
    const wasReady = this.phase === "ready";
    this.teardown();
    if (wasReady && !this.explicit) this.detachFlow();
  }

  /** Mark our seat away, tell the other side, and start the grace clock. */
  private detachFlow(): void {
    const { code, side, hub } = this;
    if (!code || !side) return;
    const mine = this.id;
    const now = hub.now();
    let changed = false;
    hub.bus
      .update(
        code,
        (r) => {
          const d = detachSeat(r, side, mine, now);
          changed = d !== null;
          return d ?? KEEP;
        },
        (r) => recordTtlMs(r, hub.now(), hub.limits),
      )
      .then(() => {
        if (!changed) return;
        hub.deliver(code, other(side), json({ t: "peer", s: "away" }));
        timer(setTimeout(() => void hub.expireSeat(code, side), hub.limits.graceMs + 250));
      })
      .catch((e) => hub.log(`[link] detach failed: ${String(e)}`));
  }

  /** End this conversation from our side, optionally telling the client why first. */
  private end(why: ClosedWhy, closeCode: number, tell = true, detach = false) {
    if (this.phase === "dead") return;
    const wasReady = this.phase === "ready";
    if (tell) this.sendRaw(json({ t: "closed", why }));
    this.teardown();
    try {
      this.socket.close(closeCode, why);
    } catch {
      /* ignore */
    }
    if (detach && wasReady) this.detachFlow();
  }

  private teardown() {
    this.phase = "dead";
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.awayTimer) clearTimeout(this.awayTimer);
    this.stopTouching();
    this.idleTimer = this.deadlineTimer = this.awayTimer = null;
    this.unsub?.();
    this.unsub = null;
    this.hub.forget(this);
  }

  dropForTest() {
    try {
      this.socket.close(1006, "drop");
    } catch {
      /* ignore */
    }
    this.onSocketClosed();
  }
}
