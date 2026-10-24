// Where rooms live and how frames cross between server instances.
//
// A WebSocket is pinned to the instance that accepted it, and the host and the
// phone can land on different instances. So the room record (who holds which
// seat) lives in a shared store, and a frame for a socket on another instance
// goes through a pub/sub channel that instance subscribed to. The hub skips
// all of this when both sockets are on the same instance.
//
// Two implementations: MemoryBus (one instance: dev, tests, and production
// when no Redis is configured) and RedisBus (REDIS_URL, or KV_URL).

import type { RoomRecord, Side } from "./room";

/** A frame addressed to one side of a room: relay JSON as text, orientation as bytes. */
export type BusFrame = string | Uint8Array;

export const KEEP = Symbol("keep");
export const DELETE = Symbol("delete");
/** What an update callback returns: a new record, or leave it alone, or remove the room. */
export type Mutation = RoomRecord | typeof KEEP | typeof DELETE;

export interface UpdateResult {
  /** the room existed when we looked */
  found: boolean;
  /** the record afterwards (null once deleted or if it was never there) */
  rec: RoomRecord | null;
}

export interface Bus {
  readonly kind: "memory" | "redis";
  /** Claim a code atomically. False if it is taken. */
  reserve(code: string, rec: RoomRecord, ttlMs: number): Promise<boolean>;
  get(code: string): Promise<RoomRecord | null>;
  /** Read-modify-write that retries if someone else wrote in between. `fn` must be pure. */
  update(code: string, fn: (r: RoomRecord) => Mutation, ttlMs: (r: RoomRecord) => number): Promise<UpdateResult>;
  remove(code: string): Promise<void>;
  /** Push a record's expiry out. */
  touch(code: string, ttlMs: number): Promise<void>;
  publish(code: string, to: Side, frame: BusFrame): Promise<void>;
  /** Receive frames addressed to `side`. Resolves once the subscription is live. */
  subscribe(code: string, side: Side, cb: (frame: BusFrame) => void): Promise<() => void>;
  close(): Promise<void>;
}

const chan = (code: string, side: Side) => `link:ch:${code}:${side}`;
const key = (code: string) => `link:room:${code}`;

// ---- memory --------------------------------------------------------------------------

export class MemoryBus implements Bus {
  readonly kind = "memory" as const;
  private rooms = new Map<string, { json: string; exp: number }>();
  private subs = new Map<string, Set<(f: BusFrame) => void>>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private read(code: string): RoomRecord | null {
    const e = this.rooms.get(code);
    if (!e) return null;
    if (e.exp <= this.now()) {
      this.rooms.delete(code);
      return null;
    }
    return JSON.parse(e.json) as RoomRecord;
  }

  private write(code: string, rec: RoomRecord, ttlMs: number) {
    this.rooms.set(code, { json: JSON.stringify(rec), exp: this.now() + ttlMs });
  }

  async reserve(code: string, rec: RoomRecord, ttlMs: number): Promise<boolean> {
    if (this.read(code)) return false;
    this.write(code, rec, ttlMs);
    return true;
  }

  async get(code: string): Promise<RoomRecord | null> {
    return this.read(code);
  }

  async update(code: string, fn: (r: RoomRecord) => Mutation, ttlMs: (r: RoomRecord) => number): Promise<UpdateResult> {
    const cur = this.read(code);
    if (!cur) return { found: false, rec: null };
    const m = fn(cur);
    if (m === KEEP) return { found: true, rec: cur };
    if (m === DELETE) {
      this.rooms.delete(code);
      return { found: true, rec: null };
    }
    this.write(code, m, ttlMs(m));
    return { found: true, rec: m };
  }

  async remove(code: string): Promise<void> {
    this.rooms.delete(code);
  }

  async touch(code: string, ttlMs: number): Promise<void> {
    const e = this.rooms.get(code);
    if (e && e.exp > this.now()) e.exp = this.now() + ttlMs;
  }

  async publish(code: string, to: Side, frame: BusFrame): Promise<void> {
    const set = this.subs.get(chan(code, to));
    if (!set) return;
    // asynchronous on purpose, like a real network hop
    for (const cb of Array.from(set)) queueMicrotask(() => cb(frame));
  }

  async subscribe(code: string, side: Side, cb: (frame: BusFrame) => void): Promise<() => void> {
    const c = chan(code, side);
    let set = this.subs.get(c);
    if (!set) this.subs.set(c, (set = new Set()));
    set.add(cb);
    return () => {
      const s = this.subs.get(c);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.subs.delete(c);
    };
  }

  async close(): Promise<void> {
    this.rooms.clear();
    this.subs.clear();
  }

  /** for tests */
  get size(): number {
    return this.rooms.size;
  }
}

// ---- redis ----------------------------------------------------------------------------

/**
 * The handful of Redis operations the bus needs, so tests can stand in for a
 * server and the real client stays behind one small adapter.
 */
export interface RedisOps {
  /** SET key value NX EX seconds */
  setNx(k: string, v: string, ttlSec: number): Promise<boolean>;
  get(k: string): Promise<string | null>;
  /** replace `k` with `next` only if it still holds `prev` (a Lua script), keeping a TTL */
  cas(k: string, prev: string, next: string, ttlSec: number): Promise<boolean>;
  del(k: string): Promise<void>;
  expire(k: string, ttlSec: number): Promise<void>;
  publish(channel: string, payload: Uint8Array): Promise<void>;
  /** one listener per channel is enough; the bus fans out locally */
  subscribe(channel: string, onMessage: (payload: Uint8Array) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  quit(): Promise<void>;
}

const TEXT = 0;
const BIN = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

function pack(frame: BusFrame): Uint8Array {
  const body = typeof frame === "string" ? enc.encode(frame) : frame;
  const out = new Uint8Array(body.length + 1);
  out[0] = typeof frame === "string" ? TEXT : BIN;
  out.set(body, 1);
  return out;
}

function unpack(p: Uint8Array): BusFrame {
  const body = p.subarray(1);
  return p[0] === TEXT ? dec.decode(body) : new Uint8Array(body);
}

const ttlSec = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

export class RedisBus implements Bus {
  readonly kind = "redis" as const;
  private readonly redis: RedisOps;
  private local = new Map<string, Set<(f: BusFrame) => void>>();
  /** channels with a Redis SUBSCRIBE in flight or live, so a quick unsubscribe/subscribe cannot interleave */
  private pending = new Map<string, Promise<void>>();

  constructor(redis: RedisOps) {
    this.redis = redis;
  }

  async reserve(code: string, rec: RoomRecord, ttlMs: number): Promise<boolean> {
    return this.redis.setNx(key(code), JSON.stringify(rec), ttlSec(ttlMs));
  }

  async get(code: string): Promise<RoomRecord | null> {
    const s = await this.redis.get(key(code));
    return s ? (JSON.parse(s) as RoomRecord) : null;
  }

  async update(code: string, fn: (r: RoomRecord) => Mutation, ttlMs: (r: RoomRecord) => number): Promise<UpdateResult> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const prev = await this.redis.get(key(code));
      if (!prev) return { found: false, rec: null };
      const cur = JSON.parse(prev) as RoomRecord;
      const m = fn(cur);
      if (m === KEEP) return { found: true, rec: cur };
      if (m === DELETE) {
        await this.redis.del(key(code));
        return { found: true, rec: null };
      }
      if (await this.redis.cas(key(code), prev, JSON.stringify(m), ttlSec(ttlMs(m)))) return { found: true, rec: m };
    }
    throw new Error("link bus: room update kept conflicting");
  }

  async remove(code: string): Promise<void> {
    await this.redis.del(key(code));
  }

  async touch(code: string, ttlMs: number): Promise<void> {
    await this.redis.expire(key(code), ttlSec(ttlMs));
  }

  async publish(code: string, to: Side, frame: BusFrame): Promise<void> {
    await this.redis.publish(chan(code, to), pack(frame));
  }

  async subscribe(code: string, side: Side, cb: (frame: BusFrame) => void): Promise<() => void> {
    const c = chan(code, side);
    let set = this.local.get(c);
    if (!set) {
      set = new Set();
      this.local.set(c, set);
      const fan = set;
      const p = this.redis.subscribe(c, (payload) => {
        let f: BusFrame;
        try {
          f = unpack(payload);
        } catch {
          return;
        }
        for (const l of Array.from(fan)) l(f);
      });
      this.pending.set(c, p);
      try {
        await p;
      } catch (e) {
        this.local.delete(c);
        this.pending.delete(c);
        throw e;
      }
    } else {
      await this.pending.get(c);
    }
    set.add(cb);
    return () => {
      const s = this.local.get(c);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) {
        this.local.delete(c);
        const prior = this.pending.get(c) ?? Promise.resolve();
        // unsubscribe only after the subscribe has settled
        const done = prior.then(() => this.redis.unsubscribe(c)).catch(() => undefined);
        this.pending.set(c, done);
        void done.then(() => {
          if (this.pending.get(c) === done) this.pending.delete(c);
        });
      }
    };
  }

  async close(): Promise<void> {
    this.local.clear();
    await this.redis.quit();
  }
}

// ---- the real client behind RedisOps ---------------------------------------------------------

const CAS_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]) return 1 else return 0 end";

/** Connects node-redis lazily (the module is only loaded when a Redis URL is configured). */
export async function connectRedis(url: string): Promise<RedisOps> {
  const { createClient } = await import("redis");
  const client = createClient({ url, socket: { reconnectStrategy: (n: number) => Math.min(2000, 100 * 2 ** n) } });
  // an unhandled 'error' event would take the process down; the bus surfaces failures per call
  client.on("error", () => undefined);
  const sub = client.duplicate();
  sub.on("error", () => undefined);
  await Promise.all([client.connect(), sub.connect()]);
  const listeners = new Map<string, (m: Buffer) => void>();
  return {
    async setNx(k, v, ttl) {
      const r = await client.set(k, v, { condition: "NX", expiration: { type: "EX", value: ttl } });
      return r === "OK";
    },
    async get(k) {
      return client.get(k);
    },
    async cas(k, prev, next, ttl) {
      const r = await client.eval(CAS_LUA, { keys: [k], arguments: [prev, next, String(ttl)] });
      return r === 1;
    },
    async del(k) {
      await client.del(k);
    },
    async expire(k, ttl) {
      await client.expire(k, ttl);
    },
    async publish(channel, payload) {
      await client.publish(channel, Buffer.from(payload));
    },
    async subscribe(channel, onMessage) {
      const l = (m: Buffer) => onMessage(new Uint8Array(m));
      listeners.set(channel, l);
      await sub.subscribe(channel, l, true);
    },
    async unsubscribe(channel) {
      const l = listeners.get(channel);
      listeners.delete(channel);
      if (l) await sub.unsubscribe(channel, l, true);
    },
    async quit() {
      await Promise.allSettled([client.quit(), sub.quit()]);
    },
  };
}

// ---- choosing one ----------------------------------------------------------------------------

export interface BusEnv {
  REDIS_URL?: string;
  KV_URL?: string;
  NODE_ENV?: string;
  [k: string]: string | undefined;
}

let warned = false;

/**
 * REDIS_URL (the Upstash integration's name for the redis:// URL) or, failing that, KV_URL.
 * With neither: the memory bus, and in production one warning, because rooms
 * then only work when both sockets land on the same instance.
 */
export async function createBus(env: BusEnv = process.env, log: (m: string) => void = (m) => console.warn(m)): Promise<Bus> {
  const url = env.REDIS_URL || env.KV_URL;
  if (url) return new RedisBus(await connectRedis(url));
  if (env.NODE_ENV === "production" && !warned) {
    warned = true;
    log("[link] REDIS_URL/KV_URL not set: using the in-memory relay bus. Phone and laptop only pair when they reach the same server instance.");
  }
  return new MemoryBus();
}

/** for tests */
export function _resetWarnedForTests() {
  warned = false;
}
