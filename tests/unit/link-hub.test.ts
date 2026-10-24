import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBus, RedisBus, type Bus } from "@/lib/link/relay/bus";
import { RelayHub } from "@/lib/link/relay/hub";
import { FakeRedis, FakeRelaySocket } from "@/lib/link/relay/testing";
import { CODE_ALPHABET, packOrient } from "@/lib/link/wire";

const settle = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** Advance time while the given sockets keep sending keep-alives, as real clients do. */
async function advanceAlive(ms: number, ...socks: FakeRelaySocket[]) {
  for (let left = ms; left > 0; left -= 20_000) {
    await advance(Math.min(20_000, left));
    for (const s of socks) s.tx({ t: "k" });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

/** host asks for a room */
async function host(hub: RelayHub) {
  const s = new FakeRelaySocket(hub);
  s.tx({ t: "host" });
  await settle();
  const room = s.of("room")[0] as { c: string; k: string; ttl: number };
  return { s, code: room?.c, key: room?.k, room };
}

async function phone(hub: RelayHub, code: string) {
  const s = new FakeRelaySocket(hub);
  s.tx({ t: "join", c: code });
  await settle();
  return { s, joined: s.of("joined")[0] as { k: string } | undefined };
}

async function pair(hub: RelayHub) {
  const h = await host(hub);
  const p = await phone(hub, h.code);
  return { h, p };
}

describe("RelayHub: rooms", () => {
  it("gives the host a short code, a secret and the 120 s TTL", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { room, code } = await host(hub);
    expect(code).toHaveLength(5);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    expect(code).not.toMatch(/[01OIL]/);
    expect(room.k).toMatch(/^[0-9a-f]{32}$/);
    expect(room.ttl).toBe(120_000);
  });

  it("pairs a phone by code and tells the host", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    expect(p.joined?.k).toMatch(/^[0-9a-f]{32}$/);
    expect(h.s.of("peer")).toEqual([{ t: "peer", s: "joined" }]);
  });

  it("accepts the code in any case, with spaces", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const h = await host(hub);
    const p = await phone(hub, ` ${h.code.toLowerCase()} `);
    expect(p.joined).toBeDefined();
  });

  it("answers a wrong code with bad-code, and closes a socket that keeps guessing", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const s = new FakeRelaySocket(hub);
    for (let i = 0; i < 4; i++) {
      s.tx({ t: "join", c: "ZZZZZ" });
      await settle();
    }
    expect(s.of("err").map((f) => f.e)).toEqual(["bad-code", "bad-code", "bad-code", "bad-code"]);
    expect(s.of("closed")[0]).toEqual({ t: "closed", why: "abuse" });
    expect(s.closedWith?.code).toBe(1008);
  });

  it("rejects a malformed code without touching the store", async () => {
    const bus = new MemoryBus();
    const get = vi.spyOn(bus, "get");
    const hub = new RelayHub({ bus });
    const s = new FakeRelaySocket(hub);
    s.tx({ t: "join", c: "12345" });
    await settle();
    expect(s.of("err")[0].e).toBe("bad-code");
    expect(get).not.toHaveBeenCalled();
  });

  it("allows one phone per room", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h } = await pair(hub);
    const second = await phone(hub, h.code);
    expect(second.joined).toBeUndefined();
    expect(second.s.of("err")[0].e).toBe("full");
  });

  it("expires an unpaired code after 120 s and closes the host", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const h = await host(hub);
    await advanceAlive(119_000, h.s);
    expect(h.s.of("closed")).toEqual([]);
    await advanceAlive(2000, h.s);
    expect(h.s.of("closed")).toEqual([{ t: "closed", why: "expired" }]);
    expect(h.s.closedWith).not.toBeNull();
    const late = await phone(hub, h.code);
    expect(late.joined).toBeUndefined();
    expect(late.s.of("err")[0].e).toBe("bad-code");
  });

  it("a paired room does not expire at 120 s", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    // keep both sockets alive past the idle timeout
    for (let i = 0; i < 6; i++) {
      await advance(30_000);
      h.s.tx({ t: "k" });
      p.s.tx({ t: "k" });
    }
    expect(h.s.of("closed")).toEqual([]);
    expect(p.s.of("closed")).toEqual([]);
  });
});

describe("RelayHub: forwarding", () => {
  it("forwards text frames untouched in both directions", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    const m = '{"t":"m","d":{"type":"tap","x":0.5,"y":0.25}}';
    p.s.tx(m);
    h.s.tx('{"t":"s","k":"offer","n":1,"p":"AB"}');
    await settle();
    expect(h.s.sent).toContain(m);
    expect(p.s.sent).toContain('{"t":"s","k":"offer","n":1,"p":"AB"}');
  });

  it("forwards orientation frames as bytes", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    const frame = new Uint8Array(packOrient(1, { seq: 1, t: 2, alpha: 3, beta: 4, gamma: 5, screenAngle: 0 }));
    p.s.tx(frame);
    await settle();
    expect(h.s.binary).toHaveLength(1);
    expect(Array.from(h.s.binary[0])).toEqual(Array.from(frame));
  });

  it("ignores binary that is not an orientation frame", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.tx(new Uint8Array([9, 9, 9]));
    await settle();
    expect(h.s.binary).toHaveLength(0);
  });

  it("does not forward relay control frames, and counts unknown ones as bad", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.tx({ t: "peer", s: "gone" }); // not a client frame
    p.s.tx({ t: "closed", why: "bye" });
    p.s.tx("not json");
    await settle();
    expect(p.s.of("err").map((f) => f.e)).toEqual(["bad-frame", "bad-frame", "bad-frame"]);
    expect(h.s.of("closed")).toEqual([]);
    expect(h.s.of("peer").filter((f) => f.s === "gone")).toEqual([]);
  });

  it("cannot spoof a relay event through a forwarded frame", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    // duplicate keys: JSON.parse takes the last t ("m"), the prefix looks like a relay event
    p.s.tx('{"t":"closed","why":"bye","t":"m","d":{"type":"unlock"}}');
    await settle();
    expect(h.s.closedWith).toBeNull();
  });

  it("refuses to forward before the socket has a room", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const s = new FakeRelaySocket(hub);
    s.tx({ t: "m", d: { type: "unlock" } });
    s.tx(new Uint8Array(packOrient(1, { seq: 1, t: 2, alpha: 3, beta: 4, gamma: 5, screenAngle: 0 })));
    await settle();
    expect(s.of("err")[0].e).toBe("no-room");
  });

  it("enforces the 4 KB cap", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.tx(JSON.stringify({ t: "m", d: { type: "open", app: "x".repeat(4100) } }));
    await settle();
    expect(p.s.of("err")[0].e).toBe("size");
    expect(h.s.sent.filter((x) => typeof x === "string" && x.includes("xxxx"))).toHaveLength(0);
    // a frame just under the cap passes
    const ok = JSON.stringify({ t: "m", d: { type: "open", app: "y".repeat(4000) } });
    p.s.tx(ok);
    await settle();
    expect(h.s.sent).toContain(ok);
  });

  it("rate limits a flooding socket and recovers", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    const ping = '{"t":"p","n":1}';
    for (let i = 0; i < 300; i++) p.s.tx(ping);
    await settle();
    const got = h.s.sent.filter((x) => x === ping).length;
    expect(got).toBeGreaterThanOrEqual(115);
    expect(got).toBeLessThanOrEqual(125);
    expect(p.s.of("err").filter((f) => f.e === "rate").length).toBeGreaterThanOrEqual(1);
    expect(p.s.of("err").filter((f) => f.e === "rate").length).toBeLessThanOrEqual(2); // not echoed as a flood
    await advance(1000);
    p.s.tx(ping);
    await settle();
    expect(h.s.sent.filter((x) => x === ping).length).toBe(got + 1);
  });

  it("never logs message contents", async () => {
    const log = vi.fn();
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    const hub = new RelayHub({ bus: new MemoryBus(), log });
    const { h, p } = await pair(hub);
    p.s.tx('{"t":"m","d":{"type":"open","app":"TOP-SECRET-PAYLOAD"}}');
    p.s.tx("TOP-SECRET-PAYLOAD not json");
    await settle();
    h.s.drop();
    await advance(60_000);
    const everything = JSON.stringify([log.mock.calls, ...spies.map((s) => s.mock.calls)]);
    expect(everything).not.toContain("TOP-SECRET-PAYLOAD");
    spies.forEach((s) => s.mockRestore());
  });
});

describe("RelayHub: leaving", () => {
  it("a phone's bye frees its seat; the host keeps its room and a new phone can join", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.tx({ t: "bye" });
    await settle();
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "gone"]);
    expect(p.s.closedWith).not.toBeNull();
    expect(h.s.closedWith).toBeNull();
    const again = await phone(hub, h.code);
    expect(again.joined).toBeDefined();
  });

  it("a bye followed at once by the socket closing is a bye, not a dropped network", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.tx({ t: "bye" });
    p.s.drop(); // what a browser does: send, then close
    await settle();
    await advance(30_000);
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "gone"]); // no "away" first
    const hb = await host(hub);
    const pb = await phone(hub, hb.code);
    hb.s.tx({ t: "bye" });
    hb.s.drop();
    await settle();
    expect(pb.s.of("closed")).toEqual([{ t: "closed", why: "bye" }]);
  });

  it("a host's bye ends the room and closes the phone", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    h.s.tx({ t: "bye" });
    await settle();
    expect(p.s.of("closed")).toEqual([{ t: "closed", why: "bye" }]);
    expect(p.s.closedWith).not.toBeNull();
    const late = await phone(hub, h.code);
    expect(late.joined).toBeUndefined();
  });

  it("a dropped socket is marked away, and the other side is told", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.drop();
    await settle();
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "away"]);
  });

  it("lets the phone resume within the grace period with its key", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.drop();
    await advance(15_000);
    const back = new FakeRelaySocket(hub);
    back.tx({ t: "resume", c: h.code, k: p.joined!.k, r: "phone" });
    await settle();
    expect(back.of("resumed")).toEqual([{ t: "resumed", peer: true, seat: true }]);
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "away", "back"]);
    // and it stays: the grace timers find nothing to give up
    await advance(60_000);
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "away", "back"]);
    // frames flow to the new socket
    h.s.tx('{"t":"m","d":{"type":"unlock"}}');
    await settle();
    expect(back.sent).toContain('{"t":"m","d":{"type":"unlock"}}');
  });

  it("frees a phone's seat after the 20 s grace and tells the host it is gone", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.drop();
    await advance(19_000);
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "away"]);
    await advance(2000);
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "away", "gone"]);
    expect(h.s.closedWith).toBeNull();
    const late = new FakeRelaySocket(hub);
    late.tx({ t: "resume", c: h.code, k: p.joined!.k, r: "phone" });
    await settle();
    expect(late.of("err")[0].e).toBe("bad-token");
  });

  it("ends the room when the host stays away past the grace period", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    h.s.drop();
    await advance(21_000);
    expect(p.s.of("closed")).toEqual([{ t: "closed", why: "away" }]);
    const late = new FakeRelaySocket(hub);
    late.tx({ t: "resume", c: h.code, k: h.key, r: "host" });
    await settle();
    expect(late.of("err")[0].e).toBe("bad-code");
  });

  it("resume needs the right secret", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h } = await pair(hub);
    h.s.drop();
    const thief = new FakeRelaySocket(hub);
    thief.tx({ t: "resume", c: h.code, k: "0".repeat(32), r: "host" });
    await settle();
    expect(thief.of("err")[0].e).toBe("bad-token");
    const owner = new FakeRelaySocket(hub);
    owner.tx({ t: "resume", c: h.code, k: h.key, r: "host" });
    await settle();
    expect(owner.of("resumed")).toHaveLength(1);
  });

  it("a reloaded phone page (no key) can take over its dropped seat", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    p.s.drop();
    await settle();
    const reload = await phone(hub, h.code);
    expect(reload.joined).toBeDefined();
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "away", "joined"]);
    // the old key no longer works
    const old = new FakeRelaySocket(hub);
    old.tx({ t: "resume", c: h.code, k: p.joined!.k, r: "phone" });
    await settle();
    expect(old.of("err")[0].e).toBe("bad-token");
  });

  it("a stale socket closing after its seat was resumed does not mark the seat away", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    const fresh = new FakeRelaySocket(hub);
    fresh.tx({ t: "resume", c: h.code, k: p.joined!.k, r: "phone" });
    await settle();
    p.s.drop(); // the half-open old socket finally closes
    await settle();
    await advance(30_000);
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "back"]);
  });

  it("closes a socket that goes silent for the idle timeout", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { h, p } = await pair(hub);
    // the phone stays chatty, the host says nothing at all
    for (let i = 0; i < 7; i++) {
      await advance(15_000);
      p.s.tx({ t: "k" });
    }
    expect(h.s.closedWith?.code).toBe(4408);
    expect(p.s.of("peer").map((f) => f.s)).toContain("away");
  });

  it("restarts the code clock when the phone leaves", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const h = await host(hub);
    await advanceAlive(100_000, h.s);
    const p = await phone(hub, h.code);
    await advanceAlive(50_000, h.s, p.s);
    p.s.tx({ t: "bye" });
    await settle();
    // 150 s after creation, but only a fresh 120 s window for the next scan
    await advanceAlive(100_000, h.s);
    const again = await phone(hub, h.code);
    expect(again.joined).toBeDefined();
  });
});

describe.each<[string, () => Bus]>([
  ["MemoryBus", () => new MemoryBus()],
  ["RedisBus (fake server)", () => new RedisBus(new FakeRedis())],
])("RelayHub across two instances: %s", (_n, makeBus) => {
  it("pairs and forwards when the host and phone are on different instances", async () => {
    const bus = makeBus();
    const a = new RelayHub({ bus });
    const b = new RelayHub({ bus });
    const h = await host(a);
    const p = await phone(b, h.code);
    expect(p.joined).toBeDefined();
    expect(h.s.of("peer")).toEqual([{ t: "peer", s: "joined" }]);

    p.s.tx('{"t":"m","d":{"type":"unlock"}}');
    const frame = new Uint8Array(packOrient(5, { seq: 5, t: 1, alpha: 1, beta: 2, gamma: 3, screenAngle: 0 }));
    p.s.tx(frame);
    h.s.tx('{"t":"s","k":"offer","n":1,"p":"QQ"}');
    await settle();
    expect(h.s.sent).toContain('{"t":"m","d":{"type":"unlock"}}');
    expect(Array.from(h.s.binary[0])).toEqual(Array.from(frame));
    expect(p.s.sent).toContain('{"t":"s","k":"offer","n":1,"p":"QQ"}');
  });

  it("carries away, back, gone and bye across instances", async () => {
    const bus = makeBus();
    const a = new RelayHub({ bus });
    const b = new RelayHub({ bus });
    const h = await host(a);
    const p = await phone(b, h.code);
    p.s.drop();
    await settle();
    const back = new FakeRelaySocket(a); // the phone comes back on the host's instance this time
    back.tx({ t: "resume", c: h.code, k: p.joined!.k, r: "phone" });
    await settle();
    expect(back.of("resumed")[0]).toEqual({ t: "resumed", peer: true, seat: true });
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "away", "back"]);
    h.s.tx({ t: "bye" });
    await settle();
    expect(back.of("closed")).toEqual([{ t: "closed", why: "bye" }]);
  });

  it("the survivor's instance gives up a seat whose own instance never reports (backstop timer)", async () => {
    const bus = makeBus();
    const a = new RelayHub({ bus });
    const b = new RelayHub({ bus });
    const h = await host(a);
    const p = await phone(b, h.code);
    // the phone's instance dies silently: nobody marks it away. Simulate by marking away from outside.
    const rec = await bus.get(h.code);
    await bus.update(h.code, (r) => ({ ...r, phone: { ...r.phone!, away: Date.now() } }), () => 60_000);
    await bus.publish(h.code, "host", JSON.stringify({ t: "peer", s: "away" }));
    expect(rec?.phone?.conn).toBeTruthy();
    await advance(25_000);
    expect(h.s.of("peer").map((f) => f.s)).toEqual(["joined", "away", "gone"]);
    void p;
  });

  it("host on one instance, phone on another: expiry and closing work", async () => {
    const bus = makeBus();
    const a = new RelayHub({ bus });
    const b = new RelayHub({ bus });
    const h = await host(a);
    await advanceAlive(125_000, h.s);
    expect(h.s.of("closed")).toEqual([{ t: "closed", why: "expired" }]);
    const late = await phone(b, h.code);
    expect(late.joined).toBeUndefined();
  });
});

describe("RelayHub: bus traffic", () => {
  it("skips the bus entirely when both sockets are on the same instance", async () => {
    const bus = new MemoryBus();
    const publish = vi.spyOn(bus, "publish");
    const hub = new RelayHub({ bus });
    const { h, p } = await pair(hub);
    publish.mockClear();
    for (let i = 0; i < 20; i++) {
      p.s.tx(new Uint8Array(packOrient(i, { seq: i, t: i, alpha: 0, beta: 0, gamma: 0, screenAngle: 0 })));
      h.s.tx({ t: "m", d: { type: "lock" } });
    }
    await settle();
    expect(h.s.binary).toHaveLength(20);
    expect(publish).not.toHaveBeenCalled();
  });

  it("uses the bus for frames only when the peer is elsewhere", async () => {
    const bus = new MemoryBus();
    const publish = vi.spyOn(bus, "publish");
    const a = new RelayHub({ bus });
    const b = new RelayHub({ bus });
    const h = await host(a);
    const p = await phone(b, h.code);
    publish.mockClear();
    p.s.tx({ t: "m", d: { type: "lock" } });
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0].slice(0, 2)).toEqual([h.code, "host"]);
  });

  it("makes at most a few Redis commands to pair, and none per same-instance frame", async () => {
    const redis = new FakeRedis();
    const hub = new RelayHub({ bus: new RedisBus(redis) });
    const { h, p } = await pair(hub);
    const afterPair = redis.commands.length;
    expect(afterPair).toBeLessThanOrEqual(10);
    for (let i = 0; i < 50; i++) p.s.tx({ t: "p", n: i });
    await settle();
    expect(redis.commands.length).toBe(afterPair);
    void h;
  });
});

describe("RelayHub: protocol misuse", () => {
  it("rejects a second host frame on the same socket", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const h = await host(hub);
    h.s.tx({ t: "host" });
    await settle();
    expect(h.s.of("err")[0].e).toBe("bad-frame");
    expect(h.s.of("room")).toHaveLength(1);
  });

  it("releases everything when a socket closes mid-join", async () => {
    const bus = new MemoryBus();
    const hub = new RelayHub({ bus });
    const h = await host(hub);
    const s = new FakeRelaySocket(hub);
    s.tx({ t: "join", c: h.code });
    s.drop(); // closes before the join has finished
    await settle();
    await advance(25_000);
    // the ghost seat was given back, so a real phone can still join
    const p = await phone(hub, h.code);
    expect(p.joined).toBeDefined();
  });

  it("stats count sockets", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const { p } = await pair(hub);
    expect(hub.stats().sockets).toBe(2);
    p.s.drop();
    expect(hub.stats().sockets).toBe(1);
  });
});
