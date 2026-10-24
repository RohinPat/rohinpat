import { afterEach, describe, expect, it, vi } from "vitest";
import { codeFromHash, formatCode, looksLikeCode, normaliseCode } from "@/lib/link/code";
import { SampleClock } from "@/lib/link/clock";
import { hostLink, joinLink, newCode } from "@/lib/link/mock";
import { askMotionPermission } from "@/lib/link/permission";
import { pathExplainer, pillLabel } from "@/lib/link/pill";
import { makeQr, qrBox, qrPath } from "@/lib/link/qr";
import type { LinkMsg, LinkSession, Orient } from "@/lib/link/session";
import { clamp01, dragProgress, inSwipeZone, shouldUnlock } from "@/lib/link/swipe";
import { TiltDriver } from "@/lib/link/tilt";
import { parseMatrix3d } from "@/lib/link/orient/orientation";
import { DEG } from "@/lib/link/orient/quat";

describe("pairing codes", () => {
  it("tidies what a person types", () => {
    expect(normaliseCode("k7q-f2x")).toBe("K7QF2X");
    expect(normaliseCode(" ab c 12 ")).toBe("ABC12");
    expect(looksLikeCode("K7QF2X")).toBe(true);
    expect(looksLikeCode("AB")).toBe(false);
    expect(looksLikeCode("A".repeat(13))).toBe(false);
  });
  it("reads #c=CODE out of a fragment, among other params", () => {
    expect(codeFromHash("#c=K7QF2X")).toBe("K7QF2X");
    expect(codeFromHash("x=1&c=k7q-f2x")).toBe("K7QF2X");
    expect(codeFromHash("#c=")).toBeNull();
    expect(codeFromHash("#c=!!")).toBeNull();
    expect(codeFromHash("#d=K7QF2X")).toBeNull();
    expect(codeFromHash("")).toBeNull();
    expect(() => codeFromHash("#c=%E0%A4%A")).not.toThrow(); // a malformed escape is read as typed
  });
  it("groups a code in threes to read it out", () => {
    expect(formatCode("K7QF2X")).toBe("K7Q F2X");
    expect(formatCode("K7QF")).toBe("K7QF");
    expect(formatCode("K7QF2XY")).toBe("K7Q F2X Y");
  });
  it("makes codes from an alphabet without look-alikes", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe("the QR", () => {
  it("encodes the url as one path of dark runs inside a quiet zone", () => {
    const m = makeQr("https://rohinpat.vercel.app/p#c=K7QF2X");
    expect(m.size).toBeGreaterThanOrEqual(25);
    expect((m.size - 17) % 4).toBe(0); // a real QR version
    expect(qrBox(m)).toBe(m.size + 6);
    const d = qrPath(m);
    // every run starts inside the quiet zone, and the three finder patterns are there
    expect(d.startsWith("M3 3h7v1h-7z")).toBe(true);
    const dark = (d.match(/h\d+v1/g) ?? []).reduce((n, x) => n + Number(x.slice(1, -2)), 0);
    let expected = 0;
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.dark(r, c)) expected++;
    expect(dark).toBe(expected);
  });
});

describe("swipe to unlock", () => {
  it("won't start in the bottom 15%, where iOS Safari swipes", () => {
    expect(inSwipeZone(700, 844)).toBe(true);
    expect(inSwipeZone(844 * 0.85, 844)).toBe(true);
    expect(inSwipeZone(844 * 0.86, 844)).toBe(false);
    expect(inSwipeZone(830, 844)).toBe(false);
    expect(inSwipeZone(10, 0)).toBe(false);
  });
  it("turns finger travel into progress", () => {
    expect(dragProgress(-422, 844)).toBeCloseTo(0.5);
    expect(dragProgress(50, 844)).toBe(0); // down is nothing
    expect(dragProgress(-5000, 844)).toBe(1);
    expect(dragProgress(-10, 0)).toBe(0);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });
  it("unlocks on a long enough pull or a quick flick, not a nudge", () => {
    expect(shouldUnlock(0.2, 0.1)).toBe(true);
    expect(shouldUnlock(0.1, 0.2)).toBe(false);
    expect(shouldUnlock(0.08, 1.5)).toBe(true);
    expect(shouldUnlock(0.02, 5)).toBe(false);
  });
});

describe("the pill", () => {
  it("reads like the spec", () => {
    expect(pillLabel("live", "direct", 12.4)).toBe("Linked · direct · 12 ms");
    expect(pillLabel("live", "relay", 48)).toBe("Linked · relay · 48 ms");
    expect(pillLabel("live", "direct", null)).toBe("Linked · direct");
    expect(pillLabel("live", "direct", 0.2)).toBe("Linked · direct · 1 ms");
    expect(pillLabel("reconnecting", "relay", 90)).toBe("Reconnecting…");
    expect(pillLabel("idle", null, null)).toBe("Not linked");
    expect(pathExplainer("direct")).toMatch(/direct/i);
    expect(pathExplainer("relay")).toMatch(/relay/i);
  });
});

describe("sample clock", () => {
  it("places samples at sent + the fastest delay seen, whatever the clock offset", () => {
    const c = new SampleClock();
    const offset = 5_000_000; // the phone's clock is far from the laptop's
    // delays of 10, 14, 9, 30 ms
    expect(c.place(100, 100 + offset + 10)).toBe(100 + offset + 10);
    c.place(116, 116 + offset + 14);
    const t = c.place(133, 133 + offset + 9);
    expect(t).toBe(133 + offset + 9);
    // a late packet is placed as if on time, so it reads as old
    const late = c.place(150, 150 + offset + 30);
    expect(late).toBeLessThan(150 + offset + 12);
  });
  it("lets the floor creep up so drift can't leave it stuck", () => {
    const c = new SampleClock(0.1);
    c.place(0, 5);
    let t = 0;
    for (let i = 1; i <= 200; i++) t = c.place(i * 10, i * 10 + 50);
    expect(t - 2000).toBeGreaterThan(45);
  });
});

describe("tilt driver", () => {
  const sample = (beta: number, seq = 0, t = 0): Orient => ({ seq, t, alpha: 137, beta, gamma: -4, screenAngle: 0 });
  const feed = (d: TiltDriver, betas: number[], t0 = 1000) =>
    betas.forEach((b, i) => d.push(sample(b, i, t0 + i * 16), t0 + i * 16 + 3));
  const z = (css: string) => {
    const m = parseMatrix3d(css.replace(/^perspective\([^)]*\)\s*/, ""))!;
    return m[2][1];
  };

  it("is flat at the neutral pose, however the phone is held", () => {
    const d = new TiltDriver();
    d.reset(0);
    feed(d, Array(12).fill(62));
    expect(d.calibrated).toBe(true);
    expect(d.css(1300)).toMatch(/^perspective\(\d+px\) matrix3d\(/);
    expect(Math.abs(z(d.css(1300)))).toBeLessThan(0.002);
  });

  it("leans the top toward the viewer when the phone's top comes up, within the clamp", () => {
    const d = new TiltDriver();
    d.reset(0);
    feed(d, Array(8).fill(62));
    feed(d, Array(60).fill(62 + 25), 1200);
    const lean = -z(d.css(2500));
    expect(lean).toBeGreaterThan(0.15);
    expect(lean).toBeLessThan(Math.sin(26 * DEG) + 1e-6); // never past the clamp
    // way past it saturates, never flips
    feed(d, Array(60).fill(62 + 80), 3000);
    const far = -z(d.css(4500));
    expect(far).toBeGreaterThan(lean * 0.9);
    expect(far).toBeLessThan(Math.sin(26 * DEG) + 1e-6);
  });

  it("re-centres on request", () => {
    const d = new TiltDriver();
    d.reset(0);
    feed(d, Array(8).fill(62));
    feed(d, Array(40).fill(62 + 25), 1200);
    d.recentre(2500);
    expect(Math.abs(z(d.css(3300)))).toBeLessThan(0.01);
  });
});

describe("motion permission", () => {
  it("calls requestPermission synchronously, before any await", () => {
    let calledDuring = false;
    const win = { DeviceOrientationEvent: { requestPermission: () => ((calledDuring = true), Promise.resolve("granted")) } } as unknown as Window;
    const p = askMotionPermission(win);
    expect(calledDuring).toBe(true); // already ran, with no microtask turn in between
    return expect(p).resolves.toBe("granted");
  });
  it("maps the other cases", async () => {
    const deny = { DeviceOrientationEvent: { requestPermission: () => Promise.resolve("denied") } } as unknown as Window;
    expect(await askMotionPermission(deny)).toBe("denied");
    const boom = { DeviceOrientationEvent: { requestPermission: () => Promise.reject(new Error("no")) } } as unknown as Window;
    expect(await askMotionPermission(boom)).toBe("denied");
    expect(await askMotionPermission({ DeviceOrientationEvent: {} } as unknown as Window)).toBe("not-needed");
    expect(await askMotionPermission({} as unknown as Window)).toBe("unavailable");
  });
});

describe("mock session (BroadcastChannel)", () => {
  const open: LinkSession[] = [];
  afterEach(() => {
    open.splice(0).forEach((s) => s.close());
  });
  const track = <T extends LinkSession>(s: T): T => (open.push(s), s);
  const until = async (cond: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  it("a host waits with a code and a pair url that carries it", () => {
    const h = track(hostLink());
    expect(h.state).toBe("waiting");
    expect(h.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(h.pairUrl).toBe(`${location.origin}/p#c=${h.code}`);
    expect(h.path).toBeNull();
  });

  it("pairs by code, carries messages and orientation both ways, and reports stats", async () => {
    const h = track(hostLink());
    const p = track(joinLink(h.code!.toLowerCase()));
    const hostStates: string[] = [];
    h.onState((s) => hostStates.push(s));
    await until(() => h.state === "live" && p.state === "live");
    expect(h.path).toBe("direct");

    const got: LinkMsg[] = [];
    const orients: Orient[] = [];
    h.onMessage((m) => got.push(m));
    h.onOrient((o) => orients.push(o));
    p.send({ type: "unlock" });
    p.send({ type: "open", app: "work" });
    for (let i = 0; i < 5; i++) p.sendOrient({ seq: i, t: i, alpha: 1, beta: 2, gamma: 3, screenAngle: 0 });
    await until(() => got.length === 2 && orients.length === 5);
    expect(got.map((m) => m.type)).toEqual(["unlock", "open"]);
    expect(h.stats().orientHz).toBe(5);
    expect(h.stats().lossPct).toBe(0);

    const back: LinkMsg[] = [];
    p.onMessage((m) => back.push(m));
    h.send({ type: "screen", name: "home" });
    await until(() => back.length === 1);
    expect(back[0]).toEqual({ type: "screen", name: "home" });
  });

  it("counts lost samples from sequence gaps", async () => {
    const h = track(hostLink());
    const p = track(joinLink(h.code!));
    await until(() => h.state === "live");
    let n = 0;
    h.onOrient(() => n++);
    for (const seq of [0, 1, 4, 5]) p.sendOrient({ seq, t: 0, alpha: 0, beta: 0, gamma: 0, screenAngle: 0 });
    await until(() => n === 4);
    expect(h.stats().lossPct).toBeCloseTo(33.3, 0); // 2 of 6
  });

  it("measures a round trip with its heartbeat", async () => {
    const h = track(hostLink({ heartbeatMs: 20 }));
    track(joinLink(h.code!, { heartbeatMs: 20 }));
    await until(() => h.stats().rttMs !== null);
    expect(h.stats().rttMs!).toBeLessThan(500);
  });

  it("one phone per code: a second knocker is turned away", async () => {
    const h = track(hostLink());
    const a = track(joinLink(h.code!));
    await until(() => a.state === "live");
    const b = track(joinLink(h.code!));
    await until(() => b.state === "closed");
    expect(h.state).toBe("live");
    expect(a.state).toBe("live");
  });

  it("a code nobody shows, or that isn't one, closes the phone", async () => {
    const s = track(joinLink("QQQQQQ", { joinTimeoutMs: 80 }));
    expect(s.state).toBe("connecting");
    await until(() => s.state === "closed");
    expect(joinLink("!").state).toBe("closed");
  });

  it("an unpaired code dies after its time to live", async () => {
    const h = track(hostLink({ ttlMs: 40 }));
    const seen: string[] = [];
    h.onState((s) => seen.push(s));
    await until(() => h.state === "closed");
    expect(seen).toEqual(["closed"]);
    expect(h.path).toBeNull();
  });

  it("closing one side closes the other, and sending afterwards is harmless", async () => {
    const h = track(hostLink());
    const p = track(joinLink(h.code!));
    await until(() => p.state === "live");
    h.close();
    await until(() => p.state === "closed");
    expect(h.state).toBe("closed");
    expect(() => p.send({ type: "unlock" })).not.toThrow();
    expect(() => h.close()).not.toThrow();
  });

  it("a silent peer goes reconnecting, then is dropped", async () => {
    vi.useFakeTimers();
    try {
      const h = track(hostLink({ heartbeatMs: 100 }));
      const p = track(joinLink(h.code!, { heartbeatMs: 100 }));
      await vi.advanceTimersByTimeAsync(300);
      expect(h.state).toBe("live");
      // the phone's page freezes: nothing from it any more (its timers keep running here, so cut its channel)
      (p as unknown as { ch: BroadcastChannel }).ch.close();
      (p as unknown as { ch: BroadcastChannel | null }).ch = null;
      await vi.advanceTimersByTimeAsync(600);
      expect(h.state).toBe("reconnecting");
      await vi.advanceTimersByTimeAsync(1500);
      expect(h.state).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });
});
