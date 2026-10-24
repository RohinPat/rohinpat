import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  RateLimiter,
  awayTooLong,
  bothHere,
  detachSeat,
  joinRoom,
  leaveSeat,
  makeCode,
  makeKey,
  newRoom,
  overSize,
  phoneHeld,
  recordTtlMs,
  resumeRoom,
} from "@/lib/link/relay/room";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  ORIENT_FRAME_BYTES,
  isLinkMsg,
  normalizeCode,
  packOrient,
  parseServerFrame,
  unpackOrient,
} from "@/lib/link/wire";

const T0 = 1_000_000;
const room = () => newRoom("ABCDE", "hostkey", "h1", T0);

describe("codes", () => {
  it("uses 5 symbols from an alphabet without 0 O 1 I L", () => {
    expect(CODE_LENGTH).toBe(5);
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
    for (let i = 0; i < 300; i++) {
      const c = makeCode();
      expect(c).toHaveLength(5);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it("is uniform enough: every symbol turns up, and a biased byte is rejected, not wrapped", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of makeCode()) seen.add(ch);
    expect(seen.size).toBe(CODE_ALPHABET.length);
    // bytes >= 248 (the largest multiple of 31 under 256) must be skipped
    let calls = 0;
    const fill = (a: Uint8Array) => {
      calls++;
      a.fill(calls === 1 ? 255 : 0);
      return a;
    };
    expect(makeCode(fill)).toBe(CODE_ALPHABET[0].repeat(5));
    expect(calls).toBe(2);
  });

  it("makes distinct secret keys", () => {
    const keys = new Set(Array.from({ length: 50 }, () => makeKey()));
    expect(keys.size).toBe(50);
    for (const k of Array.from(keys)) expect(k).toMatch(/^[0-9a-f]{32}$/);
  });

  it("normalizes what a person types", () => {
    expect(normalizeCode("abcde")).toBe("ABCDE");
    expect(normalizeCode(" ab cde ")).toBe("ABCDE");
    expect(normalizeCode("AB-CDE")).toBe("ABCDE");
    expect(normalizeCode("ABCD")).toBeNull();
    expect(normalizeCode("ABCDEF")).toBeNull();
    expect(normalizeCode("ABCD0")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeCode("ABCDI")).toBeNull();
    expect(normalizeCode(12345)).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });
});

describe("room transitions", () => {
  it("a new room has a host seat and an open phone seat that expires after 120 s", () => {
    const r = room();
    expect(r.host).toEqual({ key: "hostkey", conn: "h1", away: null });
    expect(r.phone).toBeNull();
    expect(r.pairDeadline).toBe(T0 + 120_000);
    expect(recordTtlMs(r, T0)).toBe(120_000);
  });

  it("a phone can join until the deadline, not after", () => {
    const r = room();
    const ok = joinRoom(r, "pk", "p1", T0 + 119_999);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.rec.phone).toEqual({ key: "pk", conn: "p1", away: null });
      expect(ok.rec.pairDeadline).toBeNull();
      expect(bothHere(ok.rec)).toBe(true);
    }
    expect(joinRoom(r, "pk", "p1", T0 + 120_001)).toEqual({ ok: false, err: "expired" });
  });

  it("allows one phone per room", () => {
    const r = room();
    const j = joinRoom(r, "pk", "p1", T0);
    if (!j.ok) throw new Error("join");
    expect(joinRoom(j.rec, "other", "p2", T0 + 1)).toEqual({ ok: false, err: "full" });
  });

  it("lets a fresh scan take over a seat whose socket dropped", () => {
    let r = room();
    const j = joinRoom(r, "pk", "p1", T0);
    if (!j.ok) throw new Error("join");
    r = detachSeat(j.rec, "phone", "p1", T0 + 5)!;
    expect(phoneHeld(r)).toBe(false);
    const again = joinRoom(r, "pk2", "p2", T0 + 6);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.rec.phone).toEqual({ key: "pk2", conn: "p2", away: null });
  });

  it("resumes with the right key only", () => {
    const r = room();
    expect(resumeRoom(r, "host", "nope", "h2", T0 + 1)).toEqual({ ok: false, err: "bad-token" });
    expect(resumeRoom(r, "phone", "x", "p1", T0 + 1)).toEqual({ ok: false, err: "bad-token" }); // no phone seat
    const ok = resumeRoom(r, "host", "hostkey", "h2", T0 + 1);
    expect(ok.ok && ok.rec.host.conn).toBe("h2");
  });

  it("a host cannot resume an unpaired room after its code expired", () => {
    expect(resumeRoom(room(), "host", "hostkey", "h2", T0 + 121_000)).toEqual({ ok: false, err: "expired" });
  });

  it("marks a seat away only for the socket that holds it", () => {
    const r = room();
    expect(detachSeat(r, "host", "someone-else", T0 + 1)).toBeNull(); // a stale socket closing late
    const d = detachSeat(r, "host", "h1", T0 + 1)!;
    expect(d.host.away).toBe(T0 + 1);
    expect(detachSeat(d, "host", "h1", T0 + 2)).toBeNull(); // already away
    const back = resumeRoom(d, "host", "hostkey", "h9", T0 + 3);
    expect(back.ok && back.rec.host).toEqual({ key: "hostkey", conn: "h9", away: null });
  });

  it("gives a seat up after the 20 s grace, not before", () => {
    const d = detachSeat(room(), "host", "h1", T0)!;
    expect(awayTooLong(d, "host", T0 + 19_999)).toBe(false);
    expect(awayTooLong(d, "host", T0 + 20_000)).toBe(true);
    expect(awayTooLong(d, "phone", T0 + 99_999)).toBe(false); // no such seat
    expect(DEFAULT_LIMITS.graceMs).toBe(20_000);
  });

  it("host leaving ends the room; phone leaving frees the seat and restarts the code clock", () => {
    const r = room();
    expect(leaveSeat(r, "host", T0)).toBeNull();
    const j = joinRoom(r, "pk", "p1", T0 + 10);
    if (!j.ok) throw new Error("join");
    const freed = leaveSeat(j.rec, "phone", T0 + 50_000)!;
    expect(freed.phone).toBeNull();
    expect(freed.pairDeadline).toBe(T0 + 50_000 + 120_000);
    expect(joinRoom(freed, "pk3", "p3", T0 + 60_000).ok).toBe(true);
  });

  it("keeps a paired record alive on a rolling TTL", () => {
    const j = joinRoom(room(), "pk", "p1", T0);
    if (!j.ok) throw new Error("join");
    expect(recordTtlMs(j.rec, T0 + 5000)).toBe(DEFAULT_LIMITS.pairedTtlMs);
  });
});

describe("per-socket limits", () => {
  it("rate limiter allows a burst of 120 then about 120 a second", () => {
    const rl = new RateLimiter(120, 0);
    let ok = 0;
    for (let i = 0; i < 200; i++) if (rl.take(0)) ok++;
    expect(ok).toBe(120);
    // half a second later: about 60 more
    let later = 0;
    for (let i = 0; i < 200; i++) if (rl.take(500)) later++;
    expect(later).toBeGreaterThanOrEqual(59);
    expect(later).toBeLessThanOrEqual(61);
  });

  it("a steady 30 Hz stream is never limited", () => {
    const rl = new RateLimiter(120, 0);
    for (let i = 0; i < 1000; i++) expect(rl.take(i * 33)).toBe(true);
  });

  it("caps frames at 4 KB by bytes, not characters", () => {
    expect(overSize("x".repeat(4096), 4096)).toBe(false);
    expect(overSize("x".repeat(4097), 4096)).toBe(true);
    expect(overSize("é".repeat(2049), 4096)).toBe(true); // 2 bytes each
    expect(overSize("é".repeat(2048), 4096)).toBe(false);
    expect(overSize("€".repeat(1366), 4096)).toBe(true); // 3 bytes each
    expect(overSize(new Uint8Array(4096), 4096)).toBe(false);
    expect(overSize(new Uint8Array(4097), 4096)).toBe(true);
  });
});

describe("wire format", () => {
  const o = { seq: 7, t: 123.5, alpha: 10.5, beta: -20.25, gamma: 3, screenAngle: 90 };

  it("round-trips an orientation frame", () => {
    const buf = packOrient(42, o);
    expect(buf.byteLength).toBe(ORIENT_FRAME_BYTES);
    expect(unpackOrient(buf)).toEqual({ wireSeq: 42, o });
    expect(unpackOrient(new Uint8Array(buf))?.o).toEqual(o);
  });

  it("rejects short, mistagged and non-finite frames", () => {
    expect(unpackOrient(new ArrayBuffer(10))).toBeNull();
    const bad = new Uint8Array(packOrient(1, o));
    bad[0] = 9;
    expect(unpackOrient(bad)).toBeNull();
    expect(unpackOrient(packOrient(1, { ...o, alpha: NaN }))).toBeNull();
    expect(unpackOrient("text")).toBeNull();
  });

  it("validates LinkMsg shapes", () => {
    expect(isLinkMsg({ type: "hello", role: "phone", ua: "x", motion: "granted" })).toBe(true);
    expect(isLinkMsg({ type: "hello", role: "phone", ua: "x", motion: "maybe" })).toBe(false);
    expect(isLinkMsg({ type: "drag", p: 0.5 })).toBe(true);
    expect(isLinkMsg({ type: "drag", p: "0.5" })).toBe(false);
    expect(isLinkMsg({ type: "tap", x: 0.1, y: 0.2 })).toBe(true);
    expect(isLinkMsg({ type: "screen", name: "piece", piece: "golf" })).toBe(true);
    expect(isLinkMsg({ type: "screen", name: "bogus" })).toBe(false);
    expect(isLinkMsg({ type: "gesture", name: "swing", data: { speed: 3, club: "iron", ok: true } })).toBe(true);
    expect(isLinkMsg({ type: "gesture", name: "swing", data: { nested: { a: 1 } } })).toBe(false);
    expect(isLinkMsg({ type: "axis", name: "tilt", v: Infinity })).toBe(false);
    expect(isLinkMsg({ type: "unlock" })).toBe(true);
    expect(isLinkMsg({ type: "exec", code: "1" })).toBe(false);
    expect(isLinkMsg(null)).toBe(false);
    expect(isLinkMsg([])).toBe(false);
  });

  it("parses only relay events as server frames", () => {
    expect(parseServerFrame('{"t":"room","c":"ABCDE","k":"k","ttl":1}')?.t).toBe("room");
    expect(parseServerFrame('{"t":"room","c":1}')).toBeNull();
    expect(parseServerFrame('{"t":"m","d":{}}')).toBeNull();
    expect(parseServerFrame("not json")).toBeNull();
  });
});
