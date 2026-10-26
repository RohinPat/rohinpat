import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETE,
  KEEP,
  MemoryBus,
  RedisBus,
  createBus,
  _resetWarnedForTests,
  type Bus,
  type BusFrame,
} from "@/lib/link/relay/bus";
import { FakeRedis } from "@/lib/link/relay/testing";
import { joinRoom, newRoom, type RoomRecord } from "@/lib/link/relay/room";

const T0 = 1_000_000;
const rec = (code = "ABCDE"): RoomRecord => newRoom(code, "hk", "h1", T0);
const ttl = () => 60_000;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const impls: [string, () => Bus][] = [
  ["MemoryBus", () => new MemoryBus()],
  ["RedisBus (fake server)", () => new RedisBus(new FakeRedis())],
];

describe.each(impls)("Bus contract: %s", (_name, make) => {
  let bus: Bus;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    bus = make();
  });
  afterEach(() => vi.useRealTimers());

  it("reserves a code once", async () => {
    expect(await bus.reserve("ABCDE", rec(), 60_000)).toBe(true);
    expect(await bus.reserve("ABCDE", rec(), 60_000)).toBe(false);
    expect((await bus.get("ABCDE"))?.code).toBe("ABCDE");
    expect(await bus.get("ZZZZZ")).toBeNull();
  });

  it("expires reserved codes with their TTL", async () => {
    await bus.reserve("ABCDE", rec(), 120_000);
    vi.setSystemTime(T0 + 119_000);
    expect(await bus.get("ABCDE")).not.toBeNull();
    vi.setSystemTime(T0 + 121_000);
    expect(await bus.get("ABCDE")).toBeNull();
    // and the code can be reserved again
    expect(await bus.reserve("ABCDE", rec(), 120_000)).toBe(true);
  });

  it("updates, keeps, and deletes", async () => {
    await bus.reserve("ABCDE", rec(), 60_000);
    const j = await bus.update(
      "ABCDE",
      (r) => {
        const x = joinRoom(r, "pk", "p1", T0);
        return x.ok ? x.rec : KEEP;
      },
      ttl,
    );
    expect(j.found).toBe(true);
    expect(j.rec?.phone?.key).toBe("pk");
    expect((await bus.get("ABCDE"))?.phone?.conn).toBe("p1");

    const kept = await bus.update("ABCDE", () => KEEP, ttl);
    expect(kept.rec?.phone?.key).toBe("pk");

    expect(await bus.update("MISSING", () => KEEP, ttl)).toEqual({ found: false, rec: null });

    const del = await bus.update("ABCDE", () => DELETE, ttl);
    expect(del).toEqual({ found: true, rec: null });
    expect(await bus.get("ABCDE")).toBeNull();
  });

  it("touch pushes the expiry out; remove deletes", async () => {
    await bus.reserve("ABCDE", rec(), 10_000);
    await bus.touch("ABCDE", 100_000);
    vi.setSystemTime(T0 + 50_000);
    expect(await bus.get("ABCDE")).not.toBeNull();
    await bus.remove("ABCDE");
    expect(await bus.get("ABCDE")).toBeNull();
  });

  it("delivers text and binary frames to the side they are addressed to, and only that side", async () => {
    const host: BusFrame[] = [];
    const phone: BusFrame[] = [];
    const un1 = await bus.subscribe("ABCDE", "host", (f) => host.push(f));
    const un2 = await bus.subscribe("ABCDE", "phone", (f) => phone.push(f));
    await bus.publish("ABCDE", "phone", '{"t":"m"}');
    await bus.publish("ABCDE", "host", new Uint8Array([1, 2, 3]));
    await bus.publish("OTHER", "phone", "elsewhere");
    await flush();
    expect(phone).toEqual(['{"t":"m"}']);
    expect(host).toHaveLength(1);
    expect(host[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(host[0] as Uint8Array)).toEqual([1, 2, 3]);
    un1();
    un2();
    await bus.publish("ABCDE", "phone", "after unsubscribe");
    await flush();
    expect(phone).toHaveLength(1);
  });

  it("supports several local listeners on one channel, and only the unsubscribed one stops", async () => {
    const a: BusFrame[] = [];
    const b: BusFrame[] = [];
    const ua = await bus.subscribe("ABCDE", "host", (f) => a.push(f));
    await bus.subscribe("ABCDE", "host", (f) => b.push(f));
    ua();
    await bus.publish("ABCDE", "host", "x");
    await flush();
    expect(a).toEqual([]);
    expect(b).toEqual(["x"]);
  });
});

describe("RedisBus specifics", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("retries a conflicting update and applies it to the fresh record", async () => {
    const redis = new FakeRedis();
    const bus = new RedisBus(redis);
    await bus.reserve("ABCDE", rec(), 60_000);
    redis.casFailuresToInject = 2;
    let calls = 0;
    const res = await bus.update(
      "ABCDE",
      (r) => {
        calls++;
        return { ...r, createdAt: 5 };
      },
      ttl,
    );
    expect(res.rec?.createdAt).toBe(5);
    expect(calls).toBe(3);
  });

  it("gives up with an error if updates keep conflicting", async () => {
    const redis = new FakeRedis();
    const bus = new RedisBus(redis);
    await bus.reserve("ABCDE", rec(), 60_000);
    redis.casFailuresToInject = 100;
    await expect(bus.update("ABCDE", (r) => ({ ...r }), ttl)).rejects.toThrow(/conflict/);
  });

  it("subscribes to Redis once per channel and unsubscribes with the last listener", async () => {
    const redis = new FakeRedis();
    const bus = new RedisBus(redis);
    const u1 = await bus.subscribe("ABCDE", "host", () => undefined);
    const u2 = await bus.subscribe("ABCDE", "host", () => undefined);
    expect(redis.commands.filter((c) => c === "SUBSCRIBE")).toHaveLength(1);
    u1();
    await flush();
    expect(redis.commands).not.toContain("UNSUBSCRIBE");
    u2();
    await flush();
    expect(redis.commands.filter((c) => c === "UNSUBSCRIBE")).toHaveLength(1);
  });

  it("reserve is a single SET NX", async () => {
    const redis = new FakeRedis();
    await new RedisBus(redis).reserve("ABCDE", rec(), 120_000);
    expect(redis.commands).toEqual(["SET NX"]);
    expect(redis.kv.get("link:room:ABCDE")).toBeDefined();
  });
});

describe("createBus", () => {
  afterEach(() => _resetWarnedForTests());

  it("uses memory and, in production, warns exactly once when no Redis URL is set", async () => {
    const log = vi.fn();
    const a = await createBus({ NODE_ENV: "production" }, log);
    const b = await createBus({ NODE_ENV: "production" }, log);
    expect(a.kind).toBe("memory");
    expect(b.kind).toBe("memory");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/REDIS_URL/);
  });

  it("stays quiet outside production", async () => {
    const log = vi.fn();
    await createBus({ NODE_ENV: "development" }, log);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("connectRedis (the node-redis adapter, against a stubbed module)", () => {
  it("speaks the commands the bus relies on: SET NX EX, an EVAL compare-and-set, buffer-mode pub/sub", async () => {
    const calls: [string, ...unknown[]][] = [];
    const listeners = new Map<string, (m: Buffer) => void>();
    const mk = () => ({
      on: () => undefined,
      connect: async () => calls.push(["connect"]),
      set: async (...a: unknown[]) => (calls.push(["set", ...a]), "OK"),
      get: async (k: string) => (calls.push(["get", k]), "v"),
      eval: async (...a: unknown[]) => (calls.push(["eval", ...a]), 1),
      del: async (k: string) => calls.push(["del", k]),
      expire: async (k: string, s: number) => calls.push(["expire", k, s]),
      publish: async (...a: unknown[]) => calls.push(["publish", ...a]),
      subscribe: async (c: string, l: (m: Buffer) => void, buf: boolean) => (calls.push(["subscribe", c, buf]), listeners.set(c, l)),
      unsubscribe: async (c: string, _l: unknown, buf: boolean) => calls.push(["unsubscribe", c, buf]),
      quit: async () => calls.push(["quit"]),
      duplicate: () => mk(),
    });
    vi.resetModules();
    vi.doMock("redis", () => ({ createClient: () => mk() }));
    const { connectRedis, RedisBus } = await import("@/lib/link/relay/bus");
    const ops = await connectRedis("rediss://example");
    expect(await ops.setNx("k", "v", 120)).toBe(true);
    expect(calls.find((c) => c[0] === "set")).toEqual(["set", "k", "v", { condition: "NX", expiration: { type: "EX", value: 120 } }]);
    expect(await ops.cas("k", "old", "new", 90)).toBe(true);
    const ev = calls.find((c) => c[0] === "eval")!;
    expect(String(ev[1])).toContain("GET");
    expect(ev[2]).toEqual({ keys: ["k"], arguments: ["old", "new", "90"] });
    await ops.publish("ch", new Uint8Array([0, 65]));
    const pub = calls.find((c) => c[0] === "publish")!;
    expect(Buffer.isBuffer(pub[2])).toBe(true);

    const bus = new RedisBus(ops);
    const got: BusFrame[] = [];
    await bus.subscribe("ABCDE", "host", (f) => got.push(f));
    expect(calls.find((c) => c[0] === "subscribe")).toEqual(["subscribe", "link:ch:ABCDE:host", true]);
    listeners.get("link:ch:ABCDE:host")!(Buffer.from([0, 104, 105])); // text frame "hi"
    expect(got).toEqual(["hi"]);
    vi.doUnmock("redis");
    vi.resetModules();
  });
});
