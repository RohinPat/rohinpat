import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostLink, joinLink, type LinkOptions } from "@/lib/link/client";
import { createRtcPeer } from "@/lib/link/peer";
import type { LinkMsg, LinkPath, LinkSession, LinkState, Orient } from "@/lib/link/session";
import { MemoryBus } from "@/lib/link/relay/bus";
import { RelayHub } from "@/lib/link/relay/hub";
import { FakePeerNet, LoopNet } from "@/lib/link/relay/testing";
import { packOrient } from "@/lib/link/wire";

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(5_000_000);
});
afterEach(() => vi.useRealTimers());

interface Rec {
  states: [LinkState, LinkPath | null][];
  msgs: LinkMsg[];
  orients: Orient[];
}

function track(s: LinkSession): Rec {
  const r: Rec = { states: [], msgs: [], orients: [] };
  s.onState((st, p) => r.states.push([st, p]));
  s.onMessage((m) => r.msgs.push(m));
  s.onOrient((o) => r.orients.push(o));
  return r;
}

const orient = (i: number): Orient => ({ seq: i, t: i, alpha: i, beta: 0, gamma: 0, screenAngle: 0 });

function world(extra: Partial<LinkOptions> = {}) {
  const hub = new RelayHub({ bus: new MemoryBus() });
  const net = new LoopNet(hub);
  const peers = new FakePeerNet();
  const base: LinkOptions = {
    createSocket: net.create,
    createPeer: peers.make,
    now: () => Date.now(),
    random: () => 0.5, // backoff factor exactly 1
    origin: "https://rohinpat.test",
    ...extra,
  };
  return { hub, net, peers, base };
}

async function pairUp(extra: Partial<LinkOptions> = {}) {
  const w = world(extra);
  const host = hostLink(w.base);
  const h = track(host);
  await settle();
  const phone = joinLink(host.code!, w.base);
  const p = track(phone);
  await settle();
  return { ...w, host, phone, h, p };
}

describe("hosting and joining", () => {
  it("issues a code and a pair URL whose fragment carries the code", async () => {
    const { base } = world();
    const host = hostLink(base);
    expect(host.code).toBeNull();
    expect(host.pairUrl).toBeNull();
    expect(host.state).toBe("waiting");
    await settle();
    expect(host.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}$/);
    expect(host.pairUrl).toBe(`https://rohinpat.test/p#c=${host.code}`);
    expect(host.role).toBe("host");
    expect(host.path).toBeNull();
    host.close();
  });

  it("tells listeners when the code arrives (state waiting, again)", async () => {
    const { base } = world();
    const host = hostLink(base);
    const h = track(host);
    await settle();
    expect(h.states).toEqual([["waiting", null]]);
    host.close();
  });

  it("the phone side has no code or pair URL of its own", async () => {
    const { phone, host } = await pairUp();
    expect(phone.code).toBeNull();
    expect(phone.pairUrl).toBeNull();
    expect(phone.role).toBe("phone");
    host.close();
    phone.close();
  });

  it("pairs: connecting, then live on a direct path, on both sides", async () => {
    const { host, phone, h, p } = await pairUp();
    await advance(100);
    expect(host.state).toBe("live");
    expect(phone.state).toBe("live");
    expect(host.path).toBe("direct");
    expect(phone.path).toBe("direct");
    expect(h.states).toEqual([
      ["waiting", null],
      ["connecting", null],
      ["live", "direct"],
    ]);
    expect(phone.state).toBe("live");
    expect(p.states).toEqual([["live", "direct"]]); // it began in connecting, so only the change is announced
    host.close();
    phone.close();
  });

  it("says hello both ways with role, ua and motion", async () => {
    const { host, phone, h, p } = await pairUp({ motion: () => "granted" });
    await advance(100);
    const hh = h.msgs.find((m) => m.type === "hello");
    const ph = p.msgs.find((m) => m.type === "hello");
    expect(hh).toMatchObject({ type: "hello", role: "phone", motion: "granted" });
    expect(ph).toMatchObject({ type: "hello", role: "host", motion: "not-needed" });
    expect((hh as { ua: string }).ua.length).toBeLessThanOrEqual(200);
    host.close();
    phone.close();
  });

  it("accepts a code typed in lower case with a space", async () => {
    const { base } = world();
    const host = hostLink(base);
    await settle();
    const phone = joinLink(` ${host.code!.toLowerCase()} `, base);
    await settle();
    await advance(100);
    expect(phone.state).toBe("live");
    host.close();
    phone.close();
  });
});

describe("closed: bad, expired and ended codes", () => {
  it("a wrong code closes the phone session", async () => {
    const { base } = world();
    const phone = joinLink("ZZZZZ", base);
    const p = track(phone);
    await settle();
    expect(phone.state).toBe("closed");
    expect(p.states[p.states.length - 1]).toEqual(["closed", null]);
  });

  it("a malformed code is closed at once, and listeners still hear it", async () => {
    const { base, net } = world();
    const phone = joinLink("12345", base);
    expect(phone.state).toBe("closed");
    const seen: LinkState[] = [];
    phone.onState((s) => seen.push(s));
    await settle();
    expect(seen).toEqual(["closed"]);
    expect(net.sockets).toHaveLength(0); // never even connected
  });

  it("an expired code closes the host, and joining it afterwards is closed too", async () => {
    const { base } = world();
    const host = hostLink(base);
    const h = track(host);
    await settle();
    const code = host.code!;
    await advance(121_500);
    expect(host.state).toBe("closed");
    expect(h.states[h.states.length - 1]).toEqual(["closed", null]);
    const phone = joinLink(code, base);
    await settle();
    expect(phone.state).toBe("closed");
  });

  it("a code that was never paired but is joined after the host closed it is closed", async () => {
    const { base } = world();
    const host = hostLink(base);
    await settle();
    const code = host.code!;
    host.close();
    await settle();
    expect(host.state).toBe("closed");
    const phone = joinLink(code, base);
    await settle();
    expect(phone.state).toBe("closed");
  });

  it("the phone closes when the host leaves; the host goes back to waiting when the phone leaves", async () => {
    const a = await pairUp();
    await advance(100);
    a.phone.close();
    await advance(100);
    expect(a.phone.state).toBe("closed");
    expect(a.host.state).toBe("waiting");
    expect(a.host.path).toBeNull();
    // the same code takes a new phone
    const again = joinLink(a.host.code!, a.base);
    await advance(100);
    expect(again.state).toBe("live");
    expect(a.host.state).toBe("live");
    a.host.close();
    await advance(100);
    expect(again.state).toBe("closed");
  });
});

describe("falling back to the relay", () => {
  it("stays connecting until the direct upgrade settles, then goes live on the relay at 8 s", async () => {
    const w = world();
    w.peers.works = false;
    const host = hostLink(w.base);
    const phone = (await settle(), joinLink(host.code!, w.base));
    await advance(7_900);
    expect(host.state).toBe("connecting");
    expect(phone.state).toBe("connecting");
    await advance(300);
    expect(host.state).toBe("live");
    expect(host.path).toBe("relay");
    expect(phone.state).toBe("live");
    expect(phone.path).toBe("relay");
    host.close();
    phone.close();
  });

  it("messages already flow over the relay while still connecting", async () => {
    const w = world();
    w.peers.works = false;
    const host = hostLink(w.base);
    await settle();
    const phone = joinLink(host.code!, w.base);
    const h = track(host);
    await advance(500);
    expect(host.state).toBe("connecting");
    phone.send({ type: "tap", x: 0.5, y: 0.5 });
    await advance(10);
    expect(h.msgs).toContainEqual({ type: "tap", x: 0.5, y: 0.5 });
    host.close();
    phone.close();
  });

  it("goes live on the relay immediately when there is no WebRTC", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(50);
    expect(host.state).toBe("live");
    expect(host.path).toBe("relay");
    expect(phone.state).toBe("live");
    expect(phone.path).toBe("relay");
    host.close();
    phone.close();
  });

  it("drops back to the relay when the direct path fails, telling the UI only via onState", async () => {
    const { host, phone, peers, h, p } = await pairUp({ directRetryMs: 0 });
    await advance(100);
    expect(host.path).toBe("direct");
    peers.made[0].fail();
    await advance(10);
    expect(host.state).toBe("live");
    expect(host.path).toBe("relay");
    expect(phone.state).toBe("live");
    expect(phone.path).toBe("relay");
    expect(h.states[h.states.length - 1]).toEqual(["live", "relay"]);
    expect(p.states[p.states.length - 1]).toEqual(["live", "relay"]);
    // and traffic still gets through, both kinds
    phone.send({ type: "unlock" });
    phone.sendOrient(orient(1));
    await advance(10);
    expect(h.msgs).toContainEqual({ type: "unlock" });
    expect(h.orients.map((o) => o.seq)).toEqual([1]);
    host.close();
    phone.close();
  });

  it("notices a direct path that died silently (no frames for 4 s) and falls back", async () => {
    const { host, phone, peers, h } = await pairUp({ directRetryMs: 0 });
    await advance(100);
    peers.blackhole = true;
    await advance(6_000);
    expect(host.path).toBe("relay");
    expect(phone.path).toBe("relay");
    peers.blackhole = false;
    phone.send({ type: "lock" });
    await advance(10);
    expect(h.msgs).toContainEqual({ type: "lock" });
    host.close();
    phone.close();
  });

  it("the host tries the direct path again after a drop", async () => {
    const { host, phone, peers } = await pairUp({ directRetryMs: 10_000 });
    await advance(100);
    peers.made[0].fail();
    await advance(100);
    expect(host.path).toBe("relay");
    await advance(10_500);
    expect(host.path).toBe("direct");
    expect(phone.path).toBe("direct");
    host.close();
    phone.close();
  });

  it("gives up retrying the direct path after 3 failures", async () => {
    const { host, phone, peers } = await pairUp({ directRetryMs: 1000, directTimeoutMs: 500 });
    await advance(100);
    peers.works = false;
    peers.made[0].fail();
    await advance(20_000);
    expect(host.path).toBe("relay");
    // original + 3 retries
    expect(peers.made.filter((p) => p.offered).length).toBe(4);
    host.close();
    phone.close();
  });
});

describe("messages and orientation", () => {
  it("carries LinkMsg both ways over the direct channel, in order", async () => {
    const { host, phone, h, p, peers } = await pairUp();
    await advance(100);
    phone.send({ type: "drag", p: 0.1 });
    phone.send({ type: "drag", p: 0.6 });
    phone.send({ type: "unlock" });
    host.send({ type: "screen", name: "home" });
    await advance(10);
    expect(h.msgs.filter((m) => m.type !== "hello")).toEqual([{ type: "drag", p: 0.1 }, { type: "drag", p: 0.6 }, { type: "unlock" }]);
    expect(p.msgs.filter((m) => m.type !== "hello")).toEqual([{ type: "screen", name: "home" }]);
    // they went over the data channel, not the relay
    expect(peers.made.some((x) => x.reliableSent.some((t) => t.includes('"unlock"')))).toBe(true);
    host.close();
    phone.close();
  });

  it("carries LinkMsg both ways over the relay too", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    const h = track(host);
    await settle();
    const phone = joinLink(host.code!, w.base);
    const p = track(phone);
    await advance(100);
    phone.send({ type: "gesture", name: "swing", data: { mph: 82.5, club: "7i", clean: true } });
    host.send({ type: "screen", name: "piece", piece: "golf" });
    await advance(10);
    expect(h.msgs).toContainEqual({ type: "gesture", name: "swing", data: { mph: 82.5, club: "7i", clean: true } });
    expect(p.msgs).toContainEqual({ type: "screen", name: "piece", piece: "golf" });
    host.close();
    phone.close();
  });

  it("drops messages that fail shape validation", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    const h = track(host);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(100);
    phone.send({ type: "exec", cmd: "rm -rf" } as unknown as LinkMsg);
    phone.send({ type: "drag", p: "high" } as unknown as LinkMsg);
    phone.send({ type: "unlock" });
    await advance(10);
    expect(h.msgs.filter((m) => m.type !== "hello")).toEqual([{ type: "unlock" }]);
    host.close();
    phone.close();
  });

  it("throttles orientation to about 30 Hz on the relay and still delivers the final pose", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    const h = track(host);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(100);
    for (let i = 0; i < 120; i++) {
      phone.sendOrient(orient(i)); // 125 Hz
      await advance(8);
    }
    await advance(100);
    expect(h.orients.length).toBeGreaterThanOrEqual(28);
    expect(h.orients.length).toBeLessThanOrEqual(36);
    expect(h.orients[h.orients.length - 1].seq).toBe(119);
    host.close();
    phone.close();
  });

  it("allows 60 Hz on the direct path", async () => {
    const { host, phone, h } = await pairUp();
    await advance(100);
    const before = h.orients.length;
    for (let i = 0; i < 125; i++) {
      phone.sendOrient(orient(i)); // 125 Hz for a second
      await advance(8);
    }
    await advance(100);
    const got = h.orients.length - before;
    expect(got).toBeGreaterThanOrEqual(56);
    expect(got).toBeLessThanOrEqual(68);
    host.close();
    phone.close();
  });

  it("sends orientation as small binary frames", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(100);
    phone.sendOrient(orient(3));
    await settle();
    const bin = w.net.sockets[1].sent.filter((x) => typeof x !== "string") as ArrayBuffer[];
    expect(bin).toHaveLength(1);
    expect(bin[0].byteLength).toBe(packOrient(0, orient(0)).byteLength);
    expect(bin[0].byteLength).toBeLessThanOrEqual(40);
    host.close();
    phone.close();
  });

  it("passes the pose through exactly (float32 precision) and keeps the caller's seq", async () => {
    const { host, phone, h } = await pairUp();
    await advance(100);
    phone.sendOrient({ seq: 4242, t: 1234.5, alpha: 359.5, beta: -89.25, gamma: 12.5, screenAngle: 90 });
    await advance(10);
    expect(h.orients[0]).toEqual({ seq: 4242, t: 1234.5, alpha: 359.5, beta: -89.25, gamma: 12.5, screenAngle: 90 });
    host.close();
    phone.close();
  });

  it("does not send orientation before the pair exists or after close", async () => {
    const { base, net } = world();
    const host = hostLink(base);
    await settle();
    host.sendOrient(orient(1));
    host.send({ type: "lock" });
    await settle();
    expect(net.sockets[0].sent.filter((x) => typeof x !== "string")).toHaveLength(0);
    host.close();
    host.sendOrient(orient(2));
  });
});

describe("stats", () => {
  it("measures RTT on the direct path and the relay path", async () => {
    const a = await pairUp();
    await advance(3_000);
    expect(a.host.stats().path).toBe("direct");
    expect(a.host.stats().rttMs).not.toBeNull();
    a.host.close();
    a.phone.close();

    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(8_000);
    const st = host.stats();
    expect(st.path).toBe("relay");
    expect(st.rttMs).not.toBeNull();
    expect(st.rttMs!).toBeGreaterThanOrEqual(0);
    host.close();
    phone.close();
  });

  it("reports the receive rate on the host and loss from wire sequence numbers", async () => {
    const { host, phone, peers } = await pairUp();
    await advance(100);
    for (let i = 0; i < 60; i++) {
      phone.sendOrient(orient(i));
      await advance(17);
    }
    const s = host.stats();
    expect(s.orientHz).toBeGreaterThan(40);
    expect(s.lossPct).toBe(0);
    // lose every third frame on the wire
    const ch = peers.made.find((p) => p.unreliableSent.length)!;
    const orig = ch.remote!.onUnreliable!;
    let n = 0;
    ch.remote!.onUnreliable = (b) => {
      if (n++ % 3 !== 1) orig(b);
    };
    for (let i = 60; i < 150; i++) {
      phone.sendOrient(orient(i));
      await advance(17);
    }
    expect(host.stats().lossPct).toBeGreaterThan(10);
    expect(host.stats().lossPct).toBeLessThan(35);
    expect(phone.stats().orientHz).toBeGreaterThan(40); // the phone reports what it sends
    host.close();
    phone.close();
  });

  it("has null path and RTT before pairing", () => {
    const { base } = world();
    const host = hostLink(base);
    expect(host.stats()).toEqual({ path: null, rttMs: null, orientHz: 0, lossPct: 0 });
    host.close();
  });
});

describe("relay reconnects", () => {
  it("reconnects with exponential backoff (1, 2, 4, 8 ... capped at 30 s)", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(100);
    expect(host.state).toBe("live");
    w.net.refuse = true;
    const before = w.net.sockets.length;
    w.net.sockets.filter((s) => s.readyState === 1).forEach((s) => s.drop());
    await settle();
        const counts: number[] = [];
    for (const t of [900, 200, 1900, 200, 3900, 200, 7900, 200]) {
      await advance(t);
      counts.push(w.net.sockets.length - before);
    }
    // two clients, each retrying at +1 s, +3 s, +7 s, +15 s (delays 1, 2, 4, 8)
    expect(counts).toEqual([0, 2, 4, 4, 6, 6, 8, 8]);
    host.close();
    phone.close();
  });

  it("caps the backoff at 30 s", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    await settle();
    w.net.refuse = true;
    w.net.sockets[0].drop();
    const delays: number[] = [];
    let last = Date.now();
    let n = w.net.sockets.length;
    // watch connection attempts until the session gives up
    for (let i = 0; i < 80000 && host.state !== "closed"; i++) {
      await advance(500);
      if (w.net.sockets.length !== n) {
        n = w.net.sockets.length;
        delays.push(Date.now() - last);
        last = Date.now();
      }
    }
    expect(Math.max(...delays)).toBeLessThanOrEqual(30_500);
    host.close();
  });

  it("adds jitter", async () => {
    const times: number[] = [];
    for (const r of [0, 1]) {
      const w = world({ random: () => r });
      w.peers.unsupported = true;
      const host = hostLink(w.base);
      await settle();
      w.net.refuse = true;
      const n = w.net.sockets.length;
      w.net.sockets[0].drop();
      const t0 = Date.now();
      while (w.net.sockets.length === n) await advance(50);
      times.push(Date.now() - t0);
      host.close();
    }
    expect(times[0]).toBeLessThan(times[1]);
    expect(times[0]).toBeGreaterThanOrEqual(700);
    expect(times[1]).toBeLessThanOrEqual(1300);
  });

  it("drops to reconnecting on the relay path, resumes its seat, and goes live again", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    const h = track(host);
    await settle();
    const phone = joinLink(host.code!, w.base);
    const p = track(phone);
    await advance(100);
    expect(host.state).toBe("live");
    // the phone's socket drops
    w.net.sockets[1].drop();
    await advance(50);
    expect(host.state).toBe("reconnecting");
    expect(phone.state).toBe("reconnecting");
    await advance(1_500);
    expect(host.state).toBe("live");
    expect(phone.state).toBe("live");
    expect(h.states.map((s) => s[0])).toEqual(["waiting", "connecting", "live", "reconnecting", "live"]);
    // the same code and the same session carry on
    phone.send({ type: "unlock" });
    await advance(10);
    expect(h.msgs).toContainEqual({ type: "unlock" });
    expect(p.states[p.states.length - 1]).toEqual(["live", "relay"]);
    host.close();
    phone.close();
  });

  it("queues messages sent while reconnecting and delivers them after", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    const h = track(host);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(100);
    w.net.sockets[1].drop();
    await advance(50);
    phone.send({ type: "tap", x: 0.1, y: 0.9 });
    phone.send({ type: "unlock" });
    await advance(2_000);
    expect(h.msgs.filter((m) => m.type === "tap" || m.type === "unlock")).toEqual([{ type: "tap", x: 0.1, y: 0.9 }, { type: "unlock" }]);
    host.close();
    phone.close();
  });

  it("a relay drop on a direct path does not disturb the UI", async () => {
    const { host, phone, net, h, p } = await pairUp();
    await advance(100);
    const hs = h.states.length;
    const ps = p.states.length;
    net.sockets.filter((s) => s.readyState === 1).forEach((s) => s.drop());
    await advance(3_000);
    expect(h.states).toHaveLength(hs);
    expect(p.states).toHaveLength(ps);
    expect(host.path).toBe("direct");
    // the relay came back in the background
    expect(net.live).toHaveLength(2);
    // and still works: kill the direct path, the relay (reconnected) carries on
    phone.send({ type: "unlock" });
    await advance(10);
    expect(h.msgs).toContainEqual({ type: "unlock" });
    host.close();
    phone.close();
  });

  it("survives the five-minute connection close (both relay sockets end together)", async () => {
    const { host, phone, net, h } = await pairUp({ directRetryMs: 0 });
    await advance(100);
    await advance(30_000);
    net.live.forEach((s) => s.drop());
    await advance(3_000);
    expect(net.live).toHaveLength(2);
    expect(host.state).toBe("live");
    expect(phone.state).toBe("live");
    phone.send({ type: "lock" });
    await advance(10);
    expect(h.msgs).toContainEqual({ type: "lock" });
    host.close();
    phone.close();
  });

  it("gives up after the grace period: the host waits again and the phone closes", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    const h = track(host);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(100);
    w.net.refuse = true;
    w.net.sockets[1].drop();
    await advance(25_000);
    expect(host.state).toBe("waiting"); // the relay freed the phone's seat after ~20 s
    w.net.refuse = false;
    await advance(40_000);
    expect(phone.state).toBe("closed");
    expect(host.state).toBe("waiting");
    expect(h.states.map((s) => s[0])).toContain("reconnecting");
    host.close();
  });

  it("closes if the relay stays unreachable", async () => {
    const w = world();
    w.net.refuse = true;
    const host = hostLink(w.base);
    await advance(60_000);
    expect(host.state).toBe("closed");
  });

  it("calls the other side quiet after 10 s of silence on the relay, and recovers when it speaks", async () => {
    const w = world();
    w.peers.unsupported = true;
    const host = hostLink(w.base);
    await settle();
    const phone = joinLink(host.code!, w.base);
    await advance(100);
    const phoneSock = w.net.sockets[1];
    const realSend = phoneSock.send.bind(phoneSock);
    phoneSock.send = () => undefined; // the phone goes mute without closing
    await advance(11_000);
    expect(host.state).toBe("reconnecting");
    phoneSock.send = realSend;
    await advance(4_000);
    expect(host.state).toBe("live");
    host.close();
    phone.close();
  });
});

describe("privacy", () => {
  it("uses no storage, no cookies and no fetch during a full session", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const cookieBefore = document.cookie;
    const { host, phone } = await pairUp();
    await advance(5_000);
    phone.send({ type: "unlock" });
    phone.sendOrient(orient(1));
    host.close();
    phone.close();
    await advance(1_000);
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe(cookieBefore);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    setItem.mockRestore();
    getItem.mockRestore();
  });

  it("builds RTCPeerConnection with no ICE servers at all (no STUN, no TURN)", () => {
    const configs: unknown[] = [];
    class FakeChannel extends EventTarget {
      readyState = "connecting";
      bufferedAmount = 0;
      binaryType = "blob";
      close() {}
      send() {}
    }
    class FakePC extends EventTarget {
      iceGatheringState = "new";
      connectionState = "new";
      localDescription = null;
      constructor(cfg: unknown) {
        super();
        configs.push(cfg);
      }
      createDataChannel() {
        return new FakeChannel();
      }
      close() {}
    }
    vi.stubGlobal("RTCPeerConnection", FakePC);
    const peer = createRtcPeer();
    expect(peer).not.toBeNull();
    expect(configs).toEqual([{ iceServers: [] }]);
    peer!.close();
    vi.unstubAllGlobals();
  });

  it("returns no peer where WebRTC is missing", () => {
    vi.stubGlobal("RTCPeerConnection", undefined);
    expect(createRtcPeer()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("relay URL", () => {
  it("defaults to same-origin /api/link, wss on https", async () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const net = new LoopNet(hub);
    const w = window as unknown as { happyDOM?: { setURL(u: string): void } };
    w.happyDOM?.setURL("https://rohinpat.test/");
    const host = hostLink({ createSocket: net.create, createPeer: () => null, now: () => Date.now() });
    expect(net.sockets[0].url).toBe("wss://rohinpat.test/api/link");
    host.close();
  });

  it("honours the explicit relayUrl option", () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const net = new LoopNet(hub);
    const host = hostLink({ relayUrl: "ws://localhost:3311", createSocket: net.create, createPeer: () => null });
    expect(net.sockets[0].url).toBe("ws://localhost:3311");
    host.close();
  });

  it("honours NEXT_PUBLIC_LINK_RELAY", () => {
    const hub = new RelayHub({ bus: new MemoryBus() });
    const net = new LoopNet(hub);
    vi.stubEnv("NEXT_PUBLIC_LINK_RELAY", "ws://localhost:3399");
    const host = hostLink({ createSocket: net.create, createPeer: () => null });
    expect(net.sockets[0].url).toBe("ws://localhost:3399");
    host.close();
    vi.unstubAllEnvs();
  });
});

describe("listeners", () => {
  it("unsubscribe functions work and a throwing listener does not break the link", async () => {
    const { host, phone, h } = await pairUp();
    await advance(100);
    const seen: string[] = [];
    const off = host.onMessage((m) => seen.push(m.type));
    host.onMessage(() => {
      throw new Error("listener bug");
    });
    phone.send({ type: "lock" });
    await advance(10);
    off();
    phone.send({ type: "unlock" });
    await advance(10);
    expect(seen).toEqual(["lock"]);
    expect(h.msgs.map((m) => m.type)).toContain("unlock");
    host.close();
    phone.close();
  });

  it("close() is idempotent and ends with a single closed notification", async () => {
    const { host, phone, h } = await pairUp();
    await advance(100);
    host.close();
    host.close();
    expect(h.states.filter((s) => s[0] === "closed")).toHaveLength(1);
    await advance(100);
    expect(phone.state).toBe("closed");
    host.send({ type: "lock" }); // no throw after close
  });
});
