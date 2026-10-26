import { describe, expect, it } from "vitest";
import type { HandshakePeer } from "@/lib/lab/handshake/peer";
import type { MirrorMessage } from "@/lib/lab/mirror/transport";
import {
  IntervalTracker,
  RateCounter,
  SeqTracker,
  buildResults,
  classifyAddress,
  fmtPair,
  summarizeMs,
  summarizePair,
  type LinkSnapshot,
} from "@/lib/lab/link/diagnostics";
import { askMotionPermission } from "@/lib/lab/link/permission";
import { ORIENT_FRAME_BYTES, describeGesture, isLinkExtra, packOrient, unpackOrient, type LinkExtra } from "@/lib/lab/link/protocol";
import { HandshakeTransport } from "@/lib/lab/link/transport";

// ---- a fake pair of HandshakePeers wired back to back -------------------------------

class FakeChannel extends EventTarget {
  readyState: "open" | "closed" = "open";
  bufferedAmount = 0;
  sent: unknown[] = [];
  other: FakeChannel | null = null;
  /** drop every nth frame, to model the unreliable channel */
  dropEvery = 0;
  private n = 0;
  send(data: unknown) {
    this.sent.push(data);
    this.n++;
    if (this.dropEvery && this.n % this.dropEvery === 0) return;
    const peer = this.other;
    queueMicrotask(() => peer?.dispatchEvent(new MessageEvent("message", { data })));
  }
}

function fakePair() {
  const mk = () => {
    const ctrl = new FakeChannel();
    const motion = new FakeChannel();
    const peer = {
      ctrl,
      motion,
      motionRx: [] as unknown[],
      onMotion: null as unknown,
      onCtrlText: null as ((s: string) => void) | null,
    };
    ctrl.addEventListener("message", (e) => peer.onCtrlText?.(String((e as MessageEvent).data)));
    return peer;
  };
  const a = mk();
  const b = mk();
  a.ctrl.other = b.ctrl;
  b.ctrl.other = a.ctrl;
  a.motion.other = b.motion;
  b.motion.other = a.motion;
  return [a, b] as const;
}
const asPeer = (p: ReturnType<typeof fakePair>[number]) => p as unknown as HandshakePeer;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("link protocol", () => {
  it("round-trips an orientation frame, and its first 24 bytes match the handshake motion frame", () => {
    const buf = packOrient({ seq: 4242, t: 1_700_000_000_123.456, alpha: 137.5, beta: -62.25, gamma: 4.5, screenAngle: 90 });
    expect(buf.byteLength).toBe(ORIENT_FRAME_BYTES);
    const dv = new DataView(buf);
    expect(dv.getUint32(0)).toBe(4242); // HandshakePeer reads seq here
    expect(dv.getFloat32(12)).toBeCloseTo(137.5); // and alpha here
    const f = unpackOrient(buf)!;
    expect(f.seq).toBe(4242);
    expect(f.t).toBeCloseTo(1_700_000_000_123.456, 2);
    expect([f.alpha, f.beta, f.gamma, f.screenAngle]).toEqual([137.5, -62.25, 4.5, 90]);
  });

  it("rejects short or non-finite frames", () => {
    expect(unpackOrient(new ArrayBuffer(24))).toBeNull();
    const bad = packOrient({ seq: 1, t: 1, alpha: NaN, beta: 0, gamma: 0, screenAngle: 0 });
    expect(unpackOrient(bad)).toBeNull();
  });

  const golf = {
    type: "golf-swing",
    t: 1,
    peakRate: 20,
    clubSpeed: 38.9,
    clubSpeedMph: 87,
    tempo: 3.1,
    backswingS: 0.9,
    downswingS: 0.29,
    faceAngleDeg: 4,
    planarity: 0.9,
    saturated: false,
    radius: 1.4,
  } as const;
  const flick = { type: "flick-up", t: 1, peakAccel: 14, impulse: 1.8, power: 0.7, aim: -0.1, aimDeg: -3, lateralAimDeg: -3, yawDeg: 0, widthS: 0.2 } as const;

  it("validates extras and refuses garbage", () => {
    expect(isLinkExtra({ type: "gesture", t: 1, gesture: "golf", event: golf })).toBe(true);
    expect(isLinkExtra({ type: "gesture", t: 1, gesture: "flick", event: flick })).toBe(true);
    expect(isLinkExtra({ type: "gesture", t: 1, gesture: "golf", event: flick })).toBe(false);
    expect(isLinkExtra({ type: "mode", t: 1, mode: "swing", recogniser: "golf" })).toBe(true);
    expect(isLinkExtra({ type: "mode", t: 1, mode: "swing", recogniser: "spin" })).toBe(false);
    expect(isLinkExtra({ type: "diag", t: 1, d: { a: 1 } })).toBe(true);
    expect(isLinkExtra({ type: "diag", t: 1, d: 5 })).toBe(false);
    expect(isLinkExtra({ type: "gesture-reject", t: 1, gesture: "golf", reason: "shake" })).toBe(true);
    expect(isLinkExtra(null)).toBe(false);
    expect(isLinkExtra({ type: "unknown", t: 1 })).toBe(false);
  });

  it("phrases a gesture the way it is shown on the laptop", () => {
    expect(describeGesture({ type: "gesture", t: 1, gesture: "golf", event: golf }).line).toBe("Golf: 87 mph, tempo 3.1:1, face +4°");
    expect(describeGesture({ type: "gesture", t: 1, gesture: "flick", event: flick }).line).toBe("Flick: power 0.7, aim −3°");
  });
});

describe("HandshakeTransport", () => {
  it("sends orientation on the unreliable channel and everything else on ctrl", async () => {
    const [pa, pb] = fakePair();
    const a = new HandshakeTransport(asPeer(pa));
    const b = new HandshakeTransport(asPeer(pb));
    const got: MirrorMessage[] = [];
    const extras: LinkExtra[] = [];
    b.onMessage((m) => got.push(m));
    b.onExtra((m) => extras.push(m));

    a.send({ type: "orient", t: 5, seq: 0, alpha: 10, beta: 20, gamma: 30, screenAngle: 0 });
    a.send({ type: "unlock", t: 6 });
    a.send({ type: "tap", t: 7, x: 0.25, y: 0.75 });
    a.send({ type: "recalibrate", t: 8 });
    a.send({ type: "ping", t0: 9 });
    a.sendExtra({ type: "mode", t: 10, mode: "swing", recogniser: "flick" });
    a.send({ type: "motion", t: 11, ax: 0, ay: 0, az: 9.8, ra: 0, rb: 0, rg: 0 }); // deliberately not sent
    await tick();

    expect(pa.motion.sent).toHaveLength(1);
    expect(pa.ctrl.sent).toHaveLength(5);
    expect(got.map((m) => m.type)).toEqual(["orient", "unlock", "tap", "recalibrate", "ping"]);
    const o = got[0] as Extract<MirrorMessage, { type: "orient" }>;
    expect([o.t, o.seq, o.alpha, o.beta, o.gamma]).toEqual([5, 0, 10, 20, 30]);
    expect(extras).toEqual([{ type: "mode", t: 10, mode: "swing", recogniser: "flick" }]);
    expect(a.counters.orientSent).toBe(1);
    expect(b.counters.orientReceived).toBe(1);
  });

  it("ignores junk on both channels instead of throwing", async () => {
    const [pa, pb] = fakePair();
    const b = new HandshakeTransport(asPeer(pb));
    const got: unknown[] = [];
    b.onMessage((m) => got.push(m));
    b.onExtra((m) => got.push(m));
    pa.ctrl.send("not json");
    pa.ctrl.send(JSON.stringify({ type: "tap", t: 1 })); // missing x/y
    pa.ctrl.send(JSON.stringify({ type: "gesture", t: 1, gesture: "golf", event: {} }));
    pa.motion.send(new ArrayBuffer(8));
    await tick();
    expect(got).toEqual([]);
    expect(b.counters.rejected).toBe(4);
  });

  it("skips orientation instead of queueing it behind a backlog, and never sends on a closed channel", () => {
    const [pa] = fakePair();
    const a = new HandshakeTransport(asPeer(pa));
    pa.motion.bufferedAmount = 100_000;
    a.send({ type: "orient", t: 1, seq: 0, alpha: 0, beta: 0, gamma: 0, screenAngle: 0 });
    expect(pa.motion.sent).toHaveLength(0);
    expect(a.counters.orientSkippedBackpressure).toBe(1);
    pa.ctrl.readyState = "closed";
    a.send({ type: "unlock", t: 2 });
    expect(pa.ctrl.sent).toHaveLength(0);
    expect(a.counters.dropped).toBe(1);
  });

  it("measures loss from sequence numbers on a lossy motion channel", async () => {
    const [pa, pb] = fakePair();
    pa.motion.dropEvery = 10;
    const a = new HandshakeTransport(asPeer(pa));
    const b = new HandshakeTransport(asPeer(pb));
    const seq = new SeqTracker();
    b.onMessage((m) => m.type === "orient" && seq.add(m.seq));
    for (let i = 0; i < 100; i++) a.send({ type: "orient", t: i, seq: i, alpha: 0, beta: 0, gamma: 0, screenAngle: 0 });
    await tick();
    expect(seq.received).toBe(90);
    expect(seq.expected).toBe(99); // the very last frame (seq 99) was the dropped one
    expect(seq.dropped).toBe(9);
    expect(seq.dropRate).toBeCloseTo(9 / 99);
  });

  it("detaches from the peer on close", async () => {
    const [pa, pb] = fakePair();
    const b = new HandshakeTransport(asPeer(pb));
    const got: unknown[] = [];
    b.onMessage((m) => got.push(m));
    b.close();
    expect(pb.onCtrlText).toBeNull();
    pa.ctrl.send(JSON.stringify({ type: "unlock", t: 1 }));
    await tick();
    expect(got).toEqual([]);
  });
});

describe("diagnostics maths", () => {
  it("SeqTracker counts gaps and reordering", () => {
    const s = new SeqTracker();
    for (const n of [5, 6, 8, 7, 10]) s.add(n);
    expect(s.received).toBe(5);
    expect(s.expected).toBe(6);
    expect(s.dropped).toBe(1);
    expect(s.outOfOrder).toBe(1);
    s.reset();
    expect(s.dropRate).toBe(0);
  });

  it("RateCounter: recent rate and rate over only the seconds that had traffic", () => {
    const r = new RateCounter();
    for (let i = 0; i < 120; i++) r.hit(10_000 + i * (1000 / 60)); // two seconds at 60 Hz
    expect(r.recentHz(12_000, 2000)).toBeCloseTo(60, 0);
    // a long pause adds no seconds with traffic, so the "while moving" rate stays 60
    for (let i = 0; i < 60; i++) r.hit(60_000 + i * (1000 / 60));
    expect(r.activeHz).toBeCloseTo(60, 0);
    expect(r.recentHz(70_000, 2000)).toBe(0);
  });

  it("IntervalTracker: median and p95 of the gaps, ignoring pauses, keeping the raw reported interval", () => {
    const t = new IntervalTracker();
    let now = 1000;
    for (let i = 0; i < 100; i++) {
      t.add(now, 16);
      now += i === 50 ? 5000 : i % 20 === 0 ? 40 : 16.7;
    }
    const s = t.summary()!;
    expect(s.medianMs).toBeCloseTo(16.7, 1);
    expect(s.p95Ms).toBeGreaterThanOrEqual(16.7);
    expect(s.hz).toBeCloseTo(60, 0);
    expect(s.reportedInterval).toBe(16);
    expect(s.events).toBe(100);
    expect(new IntervalTracker().summary()).toBeNull();
  });

  it("summarizeMs gives median and p95", () => {
    const s = summarizeMs(Array.from({ length: 100 }, (_, i) => i + 1))!;
    expect(s.medianMs).toBe(50);
    expect(s.p95Ms).toBe(95);
    expect(s.maxMs).toBe(100);
    expect(summarizeMs([])).toBeNull();
  });

  it("classifyAddress keeps the kind and drops the address", () => {
    expect(classifyAddress("3fa85f64-5717-4562-b3fc-2c963f66afa6.local")).toBe("mdns");
    expect(classifyAddress("192.168.1.20")).toBe("ipv4-private");
    expect(classifyAddress("10.0.4.7")).toBe("ipv4-private");
    expect(classifyAddress("172.20.1.1")).toBe("ipv4-private");
    expect(classifyAddress("172.32.1.1")).toBe("ipv4-public");
    expect(classifyAddress("169.254.9.9")).toBe("ipv4-linklocal");
    expect(classifyAddress("100.64.1.1")).toBe("ipv4-cgnat");
    expect(classifyAddress("8.8.8.8")).toBe("ipv4-public");
    expect(classifyAddress("fe80::1")).toBe("ipv6-linklocal");
    expect(classifyAddress("fd12::1")).toBe("ipv6-ula");
    expect(classifyAddress("2001:db8::1")).toBe("ipv6-global");
    expect(classifyAddress(undefined)).toBe("hidden");
  });

  it("summarizePair redacts addresses and converts the STUN rtt", () => {
    const p = summarizePair({
      pair: { state: "succeeded", rtt: 0.0042 },
      local: { type: "host", address: "192.168.1.20", protocol: "udp" },
      remote: { type: "host", address: "abc.local", protocol: "udp" },
    })!;
    expect(p.local).toEqual({ type: "host", addr: "ipv4-private", protocol: "udp" });
    expect(p.remote?.addr).toBe("mdns");
    expect(p.stunRttMs).toBeCloseTo(4.2);
    expect(JSON.stringify(p)).not.toContain("192.168");
    expect(fmtPair(p)).toContain("host/ipv4-private");
    expect(summarizePair({})).toBeNull();
  });

  it("buildResults produces a JSON-safe summary with no raw IPs", () => {
    const snap: LinkSnapshot = {
      role: "laptop",
      connectionState: "connected",
      iceState: "connected",
      answerToOpenMs: 812.345,
      shownToOpenMs: 9000,
      scanMs: 4100.9,
      pair: { local: { type: "host", addr: "mdns", protocol: "udp" }, remote: { type: "host", addr: "mdns", protocol: "udp" }, stunRttMs: 3.21 },
      localCandidates: [{ type: "host", proto: "udp", addr: "mdns" }],
      rtt: { n: 50, medianMs: 4.04, p95Ms: 9.99, maxMs: 14, lastMs: 4 },
      orientRx: { received: 590, expected: 600, dropped: 10, dropRate: 10 / 600, outOfOrder: 1, recentHz: 58, activeHz: 59.4 },
      orientTx: { total: 0, recentHz: 0, activeHz: 0 },
      devicemotion: null,
      userAgent: "UA",
      extra: {},
    };
    const out = buildResults({
      origin: "https://preview.example.vercel.app",
      laptop: snap,
      phone: { role: "phone" },
      phoneHello: { ua: "iPhone", platform: "ios", screen: { w: 390, h: 844 } },
      clock: { rttMs: 4.1, offsetMs: -1200.2 },
      gestures: [{ at: "2026-01-01T00:00:00Z", line: "Golf: 87 mph", gesture: "golf" }],
      gestureRejects: 2,
      failure: null,
    });
    const text = JSON.stringify(out);
    expect(JSON.parse(text)).toEqual(out);
    expect(out.host).toBe("preview.example.vercel.app");
    expect(out.connection.answerToOpenMs).toBe(812.3);
    expect(out.orientation.dropRatePct).toBe(1.7);
    expect(out.rtt).toEqual({ n: 50, medianMs: 4, p95Ms: 10, maxMs: 14 });
  });
});

describe("askMotionPermission", () => {
  const win = (o: unknown) => o as unknown as Window;
  it("calls requestPermission once, synchronously, and maps the answer", async () => {
    let calls = 0;
    const w = win({ DeviceOrientationEvent: { requestPermission: () => (calls++, Promise.resolve("granted")) }, DeviceMotionEvent: { requestPermission: () => (calls++, Promise.resolve("granted")) } });
    const p = askMotionPermission(w);
    expect(calls).toBe(1); // already called before the first await resolves
    expect(await p).toBe("granted");
    expect(calls).toBe(1); // one prompt covers both
  });
  it("reports denied, and swallows a throw as denied", async () => {
    expect(await askMotionPermission(win({ DeviceOrientationEvent: { requestPermission: () => Promise.resolve("denied") } }))).toBe("denied");
    expect(await askMotionPermission(win({ DeviceMotionEvent: { requestPermission: () => Promise.reject(new Error("no")) } }))).toBe("denied");
  });
  it("does not gate where the platform does not", async () => {
    expect(await askMotionPermission(win({ DeviceOrientationEvent: {}, DeviceMotionEvent: {} }))).toBe("not-needed");
    expect(await askMotionPermission(win({}))).toBe("not-needed");
  });
});
