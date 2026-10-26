import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LinkMsg, LinkPath, LinkSession, LinkState } from "@/lib/link/session";
import { parsePieceApp, pieceApp, PIECE_META, PIECE_IDS, type PieceId } from "@/components/offhours/pieces";
import { GOLF_CAL, parseSwing, powerFromSpeed, shotFromSwing, speedForPower } from "@/components/offhours/golf/remoteSwing";
import { CLUBS } from "@/components/offhours/golf/flight";
import { resolvePiece } from "@/components/link/controllers";
import { createGolfDetector, createStillGate, eventsOf, runDetector } from "@/lib/motion";
import { genGolf, genStill } from "./lab-swing-traces";

// The host session the games look at is module state in useLink.ts; stand it in.
let current: LinkSession | null = null;
const watchers = new Set<() => void>();
vi.mock("@/lib/link/useLink", () => ({
  peekHost: () => current,
  onHostChange: (cb: () => void) => {
    watchers.add(cb);
    return () => watchers.delete(cb);
  },
}));

import { routeRemote, useRemote, useRemoteList } from "@/lib/link/remote";

class FakeSession implements LinkSession {
  readonly role = "host" as const;
  state: LinkState = "live";
  path: LinkPath | null = "direct";
  code = "ABC234";
  pairUrl = "http://x/p#c=ABC234";
  sent: LinkMsg[] = [];
  private msg = new Set<(m: LinkMsg) => void>();
  private st = new Set<(s: LinkState, p: LinkPath | null) => void>();
  stats() {
    return { path: this.path, rttMs: 1, orientHz: 0, lossPct: 0 };
  }
  send(m: LinkMsg) {
    this.sent.push(m);
  }
  sendOrient() {}
  onMessage(cb: (m: LinkMsg) => void) {
    this.msg.add(cb);
    return () => void this.msg.delete(cb);
  }
  onOrient() {
    return () => {};
  }
  onState(cb: (s: LinkState, p: LinkPath | null) => void) {
    this.st.add(cb);
    return () => void this.st.delete(cb);
  }
  close() {}
  // test helpers
  hear(m: LinkMsg) {
    this.msg.forEach((cb) => cb(m));
  }
  setState(s: LinkState, p: LinkPath | null = this.path) {
    this.state = s;
    this.path = p;
    this.st.forEach((cb) => cb(s, p));
  }
  screens() {
    return this.sent.filter((m) => m.type === "screen") as Extract<LinkMsg, { type: "screen" }>[];
  }
}

beforeEach(() => {
  current = null;
  window.history.pushState({}, "", "/interests");
});
afterEach(() => {
  current = null;
});

describe("routeRemote", () => {
  it("hands gestures and axes to the handlers and ignores the rest", () => {
    const gesture = vi.fn();
    const axis = vi.fn();
    expect(routeRemote({ gesture, axis }, { type: "gesture", name: "golf-swing", data: { speedMph: 90 } })).toBe(true);
    expect(gesture).toHaveBeenCalledWith("golf-swing", { speedMph: 90 });
    expect(routeRemote({ gesture, axis }, { type: "axis", name: "steer", v: -0.4 })).toBe(true);
    expect(axis).toHaveBeenCalledWith("steer", -0.4);
    expect(routeRemote({ gesture, axis }, { type: "tap", x: 0.5, y: 0.5 })).toBe(false);
    expect(routeRemote({ gesture, axis }, { type: "open", app: "piece:golf" })).toBe(false);
    expect(gesture).toHaveBeenCalledTimes(1);
    expect(axis).toHaveBeenCalledTimes(1);
  });
  it("drops a non-finite axis and tolerates missing handlers", () => {
    const axis = vi.fn();
    routeRemote({ axis }, { type: "axis", name: "steer", v: Number.NaN });
    expect(axis).not.toHaveBeenCalled();
    expect(routeRemote({}, { type: "gesture", name: "x", data: {} })).toBe(false);
    expect(routeRemote({ gesture: vi.fn() }, { type: "axis", name: "steer", v: 1 })).toBe(false);
  });
});

describe("useRemote", () => {
  it("is a no-op without a session: not linked, nothing to call", () => {
    const gesture = vi.fn();
    const { result, unmount } = renderHook(() => useRemote("golf", { gesture }));
    expect(result.current.linked).toBe(false);
    expect(() => result.current.send({ type: "recenter" })).not.toThrow();
    unmount();
    expect(gesture).not.toHaveBeenCalled();
  });

  it("tells the phone which game is open, routes its gestures, and says list on the way out", () => {
    const s = new FakeSession();
    current = s;
    const gesture = vi.fn();
    const axis = vi.fn();
    const { result, unmount } = renderHook(() => useRemote("golf", { gesture, axis }));
    expect(result.current.linked).toBe(true);
    expect(s.screens()).toEqual([{ type: "screen", name: "piece", piece: "golf" }]);

    act(() => s.hear({ type: "gesture", name: "golf-swing", data: { speedMph: 88, tempo: 3, faceDeg: 1 } }));
    expect(gesture).toHaveBeenCalledWith("golf-swing", { speedMph: 88, tempo: 3, faceDeg: 1 });
    act(() => s.hear({ type: "axis", name: "steer", v: 0.25 }));
    expect(axis).toHaveBeenCalledWith("steer", 0.25);

    // a phone that reconnects mid-game says hello and is told where it is
    act(() => s.hear({ type: "hello", role: "phone", ua: "x", motion: "granted" }));
    expect(s.screens().at(-1)).toEqual({ type: "screen", name: "piece", piece: "golf" });

    unmount();
    expect(s.screens().at(-1)).toEqual({ type: "screen", name: "piece", piece: "list" });
    // and it stopped listening
    act(() => s.hear({ type: "gesture", name: "golf-swing", data: {} }));
    expect(gesture).toHaveBeenCalledTimes(1);
  });

  it("uses the latest handlers without resubscribing", () => {
    const s = new FakeSession();
    current = s;
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ g }) => useRemote("golf", { gesture: g }), { initialProps: { g: first } });
    rerender({ g: second });
    act(() => s.hear({ type: "gesture", name: "a", data: {} }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(s.screens()).toHaveLength(1);
  });

  it("does not put the phone back on the list when the visitor has left /interests", () => {
    const s = new FakeSession();
    current = s;
    const { unmount } = renderHook(() => useRemote("golf"));
    window.history.pushState({}, "", "/colophon");
    unmount();
    expect(s.screens().map((m) => m.piece)).toEqual(["golf"]);
  });

  it("stays quiet in a tile preview (no piece id) and while unpaired", () => {
    const s = new FakeSession();
    current = s;
    const gesture = vi.fn();
    const preview = renderHook(() => useRemote(null, { gesture }));
    expect(preview.result.current.linked).toBe(false);
    act(() => s.hear({ type: "gesture", name: "a", data: {} }));
    expect(gesture).not.toHaveBeenCalled();
    expect(s.sent).toHaveLength(0);
    preview.unmount();

    s.setState("waiting", null);
    const unpaired = renderHook(() => useRemote("golf", { gesture }));
    expect(unpaired.result.current.linked).toBe(false);
    expect(s.sent).toHaveLength(0);
    // pairing later announces the game then
    act(() => s.setState("live", "direct"));
    expect(unpaired.result.current.linked).toBe(true);
    expect(s.screens()).toEqual([{ type: "screen", name: "piece", piece: "golf" }]);
  });

  it("notices a session that appears or goes away", () => {
    const { result } = renderHook(() => useRemote("golf"));
    expect(result.current.linked).toBe(false);
    const s = new FakeSession();
    act(() => {
      current = s;
      watchers.forEach((cb) => cb());
    });
    expect(result.current.linked).toBe(true);
    act(() => s.setState("closed", null));
    expect(result.current.linked).toBe(false);
  });

  it("send reaches the phone only while paired", () => {
    const s = new FakeSession();
    current = s;
    const { result } = renderHook(() => useRemote("golf"));
    result.current.send({ type: "gesture", name: "golf-club", data: { index: 2 } });
    expect(s.sent.at(-1)).toEqual({ type: "gesture", name: "golf-club", data: { index: 2 } });
    const n = s.sent.length;
    s.state = "closed";
    result.current.send({ type: "recenter" });
    expect(s.sent).toHaveLength(n);
  });
});

describe("useRemoteList", () => {
  it("says list while the grid shows and turns piece opens into callbacks", () => {
    const s = new FakeSession();
    current = s;
    const onOpen = vi.fn();
    const { rerender } = renderHook(({ open }) => useRemoteList({ onOpen, open }), { initialProps: { open: null as PieceId | null } });
    expect(s.screens()).toEqual([{ type: "screen", name: "piece", piece: "list" }]);

    act(() => s.hear({ type: "open", app: "piece:golf" }));
    expect(onOpen).toHaveBeenLastCalledWith("golf");
    act(() => s.hear({ type: "open", app: "piece:list" }));
    expect(onOpen).toHaveBeenLastCalledWith("list");
    // not a piece, or not a real one: ignored
    act(() => s.hear({ type: "open", app: "offhours" }));
    act(() => s.hear({ type: "open", app: "piece:nope" }));
    expect(onOpen).toHaveBeenCalledTimes(2);

    // a stage opens: the phone is told which game, even if the game has no controller of its own
    rerender({ open: "maze" });
    expect(s.screens().at(-1)).toEqual({ type: "screen", name: "piece", piece: "maze" });
    act(() => s.hear({ type: "hello", role: "phone", ua: "x", motion: "granted" }));
    expect(s.screens().at(-1)).toEqual({ type: "screen", name: "piece", piece: "maze" });
    // it closes: the grid tells the phone again
    rerender({ open: null });
    expect(s.screens().at(-1)).toEqual({ type: "screen", name: "piece", piece: "list" });
  });

  it("answers a phone's hello with list while the grid is up, and does nothing without a session", () => {
    const quiet = renderHook(() => useRemoteList({ onOpen: vi.fn(), open: null }));
    expect(quiet.result.current.linked).toBe(false);
    quiet.unmount();

    const s = new FakeSession();
    current = s;
    renderHook(() => useRemoteList({ onOpen: vi.fn(), open: null }));
    const n = s.screens().length;
    act(() => s.hear({ type: "hello", role: "phone", ua: "x", motion: "granted" }));
    expect(s.screens()).toHaveLength(n + 1);
  });
});

describe("the nine pieces", () => {
  it("names them, round-trips the open message and refuses strangers", () => {
    expect(PIECE_IDS).toEqual(["watch", "maze", "hoops", "penalty", "decks", "engine", "keyboard", "golf", "powder"]);
    expect(PIECE_META.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const id of PIECE_IDS) expect(parsePieceApp(pieceApp(id))).toBe(id);
    expect(parsePieceApp("piece:list")).toBe("list");
    expect(parsePieceApp("piece:nope")).toBeNull();
    expect(parsePieceApp("offhours")).toBeNull();
  });
  it("routes the phone: the grid, a game, or someone else's page", () => {
    expect(resolvePiece(undefined)).toBe("list");
    expect(resolvePiece("list")).toBe("list");
    expect(resolvePiece("/interests")).toBe("list");
    expect(resolvePiece("golf")).toBe("golf");
    expect(resolvePiece("/colophon")).toBeNull();
    expect(resolvePiece("unknown")).toBeNull();
  });
});

describe("golf: phone swing to range shot", () => {
  it("reads a golf-swing gesture and rejects junk", () => {
    expect(parseSwing({ speedMph: 90, tempo: 3.1, faceDeg: -2 })).toEqual({ speedMph: 90, tempo: 3.1, faceDeg: -2 });
    expect(parseSwing({ speedMph: 90 })).toEqual({ speedMph: 90, tempo: GOLF_CAL.idealTempo, faceDeg: 0 });
    expect(parseSwing({})).toBeNull();
    expect(parseSwing({ speedMph: "fast" })).toBeNull();
    expect(parseSwing({ speedMph: 4 })).toBeNull();
    expect(parseSwing({ speedMph: 9000 })).toBeNull();
  });

  it("has one full-speed per club, in the range's club order", () => {
    expect(GOLF_CAL.fullMph).toHaveLength(CLUBS.length);
    for (let i = 1; i < GOLF_CAL.fullMph.length; i++) expect(GOLF_CAL.fullMph[i]).toBeLessThanOrEqual(GOLF_CAL.fullMph[i - 1]);
  });

  it("gives a full shot for a 85-95 mph swing with a driver or wood, and less for a slower one", () => {
    for (const club of [0, 1]) for (const mph of [85, 90, 95]) expect(powerFromSpeed(mph, club)).toBeGreaterThan(0.85);
    expect(powerFromSpeed(GOLF_CAL.fullMph[0], 0)).toBeCloseTo(1, 5);
    expect(powerFromSpeed(GOLF_CAL.fullMph[3], 3)).toBeCloseTo(1, 5);
    expect(powerFromSpeed(60, 0)).toBeLessThan(powerFromSpeed(80, 0));
    expect(powerFromSpeed(30, 0)).toBeLessThan(0.3);
  });

  it("is monotonic, floors at a soft chip, and caps over-swinging just above full", () => {
    let prev = -1;
    for (let mph = 15; mph <= 140; mph += 5) {
      const p = powerFromSpeed(mph, 2);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(powerFromSpeed(15, 5)).toBeGreaterThanOrEqual(0.05);
    expect(powerFromSpeed(300, 0)).toBeLessThanOrEqual(1 + GOLF_CAL.overPowerMax + 1e-9);
    // an enthusiastic swing with a wedge isn't read as a mishit: it stays within the range's no-penalty band
    expect(powerFromSpeed(95, 4)).toBeLessThanOrEqual(1.04 + 0.03);
  });

  it("speedForPower undoes powerFromSpeed", () => {
    for (const club of [0, 3, 5]) for (const p of [0.1, 0.5, 0.9, 1, 1.04, 1.06]) expect(powerFromSpeed(speedForPower(p, club), club)).toBeCloseTo(p, 5);
  });

  it("clamps a bad club index instead of throwing", () => {
    expect(Number.isFinite(powerFromSpeed(90, -4))).toBe(true);
    expect(Number.isFinite(powerFromSpeed(90, 99))).toBe(true);
  });

  it("a square, 3:1 swing is pure; an open face slices; a closed face hooks; a bad tempo costs contact", () => {
    const pure = shotFromSwing({ speedMph: 90, tempo: 3, faceDeg: 0 }, 0);
    expect(pure.contact).toBe(1);
    expect(pure.face).toBe(0);
    expect(pure.curve).toBe(0);

    const open = shotFromSwing({ speedMph: 90, tempo: 3, faceDeg: 8 }, 0);
    expect(open.face).toBeGreaterThan(0);
    expect(open.curve).toBeGreaterThan(0);
    const closed = shotFromSwing({ speedMph: 90, tempo: 3, faceDeg: -8 }, 0);
    expect(closed.face).toBeLessThan(0);
    expect(closed.curve).toBeLessThan(0);
    expect(closed.face).toBeCloseTo(-open.face, 9);

    const rushed = shotFromSwing({ speedMph: 90, tempo: 1.4, faceDeg: 0 }, 0);
    expect(rushed.contact).toBeLessThan(pure.contact);
    expect(shotFromSwing({ speedMph: 90, tempo: 9, faceDeg: 0 }, 0).contact).toBeGreaterThanOrEqual(1 - GOLF_CAL.tempoCostMax - 1e-9);

    const wild = shotFromSwing({ speedMph: 90, tempo: 3, faceDeg: 40 }, 0);
    expect(wild.face).toBeCloseTo(GOLF_CAL.startLineGain, 9);
    expect(wild.contact).toBeLessThan(1);
    expect(wild.contact).toBeGreaterThanOrEqual(0.35);
  });

  it("the whole phone pipeline: a synthetic swing in, a believable range shot out", () => {
    const swing = genGolf(7);
    const events = eventsOf(runDetector(createGolfDetector({ radius: GOLF_CAL.radiusM }), swing.samples));
    expect(events).toHaveLength(1);
    const data = { speedMph: events[0].clubSpeedMph, tempo: events[0].tempo, faceDeg: events[0].faceAngleDeg };
    const parsed = parseSwing(data);
    expect(parsed).not.toBeNull();
    const shot = shotFromSwing(parsed!, 0);
    expect(shot.power).toBeGreaterThan(0.05);
    expect(shot.power).toBeLessThanOrEqual(1 + GOLF_CAL.overPowerMax);
    expect(shot.contact).toBeGreaterThanOrEqual(0.35);
    expect(shot.contact).toBeLessThanOrEqual(1);
  });
});

describe("the still gate", () => {
  it("is ready only after a held-still moment, and drops the moment it moves", () => {
    const gate = createStillGate();
    const still = genStill(3, 1.5, { held: true });
    let ready = false;
    let firstReady = -1;
    for (const s of still) {
      ready = gate.push(s);
      if (ready && firstReady < 0) firstReady = s.t - still[0].t;
    }
    expect(ready).toBe(true);
    expect(firstReady).toBeGreaterThanOrEqual(0.3);
    expect(firstReady).toBeLessThan(0.8);
    const last = still[still.length - 1];
    const dt = 1 / 60;
    let t = last.t;
    let after = true;
    for (let i = 0; i < 12; i++) {
      t += dt;
      after = gate.push({ ...last, t, gyro: [8, 0, 0] });
    }
    expect(after).toBe(false);
    gate.reset();
    expect(gate.ready).toBe(false);
  });
});
