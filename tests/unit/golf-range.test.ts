import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as M from "@/components/offhours/golf/range";
import { CLUBS } from "@/components/offhours/golf/flight";
import { TARGETS } from "@/components/offhours/golf/scene";
import { PURE, makeSim, recordingCtx, seedRandom, stubScratchCanvas } from "./golf-headless";

// these play real shots and rounds, which run many times slower under coverage on CI
vi.setConfig({ testTimeout: 60_000 });

// The driving range with no screen: the range's own state machine, stepped by hand.

beforeEach(() => {
  stubScratchCanvas();
  seedRandom(11);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** a pure full shot, stepped until the ball is struck; returns the sim at that moment */
function struck(club = 0) {
  const s = makeSim(M);
  s.r.club = club;
  s.calm();
  expect(M.rangeRemoteSwing(s.r, PURE, s.time())).toBe(true);
  expect(s.run(() => s.r.phase === "fly", 10)).not.toBeNull();
  return s;
}
/** seconds from the strike until a new swing is accepted, pressing at `pressAt` (or never) */
function cycle(s: ReturnType<typeof struck>, pressAt: number | null) {
  const t0 = s.time();
  let pressed = pressAt === null;
  while (s.time() - t0 < 40) {
    s.frame();
    if (!pressed && s.time() - t0 >= pressAt!) {
      s.press();
      s.release();
      pressed = true;
    }
    if (M.rangeRemoteSwing(s.r, PURE, s.time())) return s.time() - t0;
  }
  return Infinity;
}

describe("G6: faster shots", () => {
  it("the next swing is allowed as soon as the ball is at rest", () => {
    const s = struck();
    const rest = s.r.shot!.restT;
    expect(cycle(s, null)).toBeLessThan(rest + 0.1);
    expect(cycle(struck(), null)).toBeGreaterThan(rest - 0.1);
  });
  it("the result hold is about 1.2 s", () => {
    expect(M.RESULT_HOLD).toBeGreaterThanOrEqual(1);
    expect(M.RESULT_HOLD).toBeLessThanOrEqual(1.4);
  });
  it("a press in flight brings a full driver shot to the next swing in under 4.5 s", () => {
    for (let i = 0; i < 5; i++) {
      const s = makeSim(M);
      s.r.club = 0;
      s.r.wind = { x: (i - 2) * 1.2, z: (i % 2 ? 1 : -1) * 1.5 };
      M.rangeRemoteSwing(s.r, PURE, s.time());
      s.run(() => s.r.phase === "fly", 10);
      expect(cycle(s, 0.4), `shot ${i}`).toBeLessThan(4.5);
    }
  });
  it("a press while the ball flies or rolls never starts a swing and never changes the result", () => {
    const plain = struck();
    const pressed = struck();
    const shot = pressed.r.shot!;
    pressed.frame();
    pressed.press();
    pressed.release();
    expect(pressed.r.phase).toBe("fly");
    pressed.key(" ");
    pressed.key("Enter");
    expect(pressed.r.phase).toBe("fly");
    // and again once it is rolling
    pressed.run(() => pressed.r.shotT > shot.landT + 0.3, 10);
    pressed.press();
    expect(pressed.r.phase).toBe("fly");
    plain.run(() => plain.r.phase === "rest", 30);
    pressed.run(() => pressed.r.phase === "rest", 30);
    expect(pressed.r.phase).toBe("rest");
    expect(pressed.r.shot).toBe(shot);
    expect([shot.carry, shot.total]).toEqual([plain.r.shot!.carry, plain.r.shot!.total]);
    expect(pressed.r.landings).toEqual(plain.r.landings);
    // it ran faster, not differently: the press plays the same shot in about a quarter of the time
    expect(pressed.time()).toBeLessThan(plain.time() * 0.5);
  });
  it("the same press at rest does start a swing", () => {
    const s = struck();
    s.run(() => s.r.phase === "rest", 30);
    s.key(" ");
    expect(s.r.phase).toBe("back");
  });
  it("says 4X once it has been pressed, and offers it for the first shots", () => {
    const rec = recordingCtx();
    const s = makeSim(M, 1 / 60, rec.ctx);
    s.calm();
    M.rangeRemoteSwing(s.r, PURE, s.time());
    s.run(() => s.r.phase === "fly", 10);
    s.frame();
    expect(rec.texts).toContain("PRESS TO SPEED UP");
    s.press();
    rec.clear();
    s.frame();
    expect(rec.texts).toContain("4X");
  });
});

describe("G7: the suggested club is applied", () => {
  it("a new target selects the suggested club, and the arrows can still change it", () => {
    const s = makeSim(M);
    M.rangeSetMode(s.r, "challenge");
    const sg = (n: number) => M.suggest(TARGETS[n].yd).club;
    expect(s.r.club).toBe(sg(s.r.ch.target));
    // play a shot; the next target brings its own suggestion
    s.calm();
    M.rangeSetClub(s.r, 0);
    M.rangeRemoteSwing(s.r, PURE, s.time());
    s.run(() => s.r.phase === "rest", 40);
    expect(s.r.ch.n).toBe(1);
    expect(s.r.club).toBe(sg(s.r.ch.target));
    // still the player's call
    M.rangeSetClub(s.r, 2);
    s.key("ArrowDown");
    expect(s.r.club).toBe(3);
    s.frame();
    expect(s.r.club).toBe(3);
  });
  it("still shows the suggested club and its % swing", () => {
    const rec = recordingCtx();
    const s = makeSim(M, 1 / 60, rec.ctx);
    M.rangeSetMode(s.r, "challenge");
    s.frame();
    const sg = M.suggest(TARGETS[s.r.ch.target].yd);
    expect(rec.texts).toContain(`TRY ${CLUBS[sg.club].short} · ${Math.round(sg.power * 100)}% SWING`);
  });
});

describe("G10: a locked aim says so", () => {
  const tap = (s: ReturnType<typeof makeSim>) => {
    s.press();
    s.release();
  };
  it("a tap in the challenge says the aim is set, once, on the canvas and in the live region", () => {
    const rec = recordingCtx();
    const s = makeSim(M, 1 / 60, rec.ctx);
    M.rangeSetMode(s.r, "challenge");
    s.frame();
    expect(rec.texts).not.toContain("AIM IS SET FOR THE TARGET");
    const yaw = s.r.yawT;
    tap(s);
    s.frame();
    expect(rec.texts).toContain("AIM IS SET FOR THE TARGET");
    expect(s.said.filter((m) => /aim is set/i.test(m))).toHaveLength(1);
    expect(s.r.yawT).toBe(yaw);
    tap(s);
    tap(s);
    expect(s.said.filter((m) => /aim is set/i.test(m))).toHaveLength(1);
    // the message goes away by itself
    s.run(() => false, 3);
    rec.clear();
    s.frame();
    expect(rec.texts).not.toContain("AIM IS SET FOR THE TARGET");
  });
  it("it is said again for the next target, and never in practice", () => {
    const s = makeSim(M);
    M.rangeSetMode(s.r, "challenge");
    tap(s);
    s.calm();
    M.rangeRemoteSwing(s.r, PURE, s.time());
    s.run(() => s.r.phase === "rest", 40);
    tap(s);
    expect(s.said.filter((m) => /aim is set/i.test(m))).toHaveLength(2);
    const p = makeSim(M);
    tap(p);
    expect(p.said.filter((m) => /aim is set/i.test(m))).toHaveLength(0);
  });
  it("the arrow keys still nudge the aim in the challenge, so they are not a silent no-op", () => {
    const s = makeSim(M);
    M.rangeSetMode(s.r, "challenge");
    const yaw = s.r.yawT;
    s.key("ArrowRight");
    expect(s.r.yawT).toBeGreaterThan(yaw);
  });
});

describe("G11: over the top", () => {
  it("one press and waiting carries at most about 70% of a pure swing, for every club", () => {
    for (let c = 0; c < CLUBS.length; c++) {
      const pure = M.fullCarry(c);
      let worst = 0;
      for (let i = 0; i < 10; i++) {
        const s = makeSim(M, 1 / 30);
        s.r.club = c;
        s.calm();
        s.key(" ");
        expect(s.run(() => s.r.phase === "fly", 10)).not.toBeNull();
        worst = Math.max(worst, s.r.shot!.carry / pure);
      }
      expect(worst, CLUBS[c].name).toBeLessThanOrEqual(M.OVER_CARRY + 0.01);
      expect(worst, CLUBS[c].name).toBeGreaterThan(0.4);
    }
  }, 60_000);
  it("a swing that is timed still carries a full pure shot", () => {
    const s = makeSim(M);
    s.r.club = 3;
    s.calm();
    expect(M.rangeRemoteSwing(s.r, PURE, s.time())).toBe(true);
    s.run(() => s.r.phase === "fly", 10);
    expect(s.r.shot!.carry).toBeCloseTo(M.fullCarry(3), 3);
  });
});

describe("G12: timing", () => {
  it("a meter swing says early or late", () => {
    const rec = recordingCtx();
    const s = makeSim(M, 1 / 60, rec.ctx);
    s.r.club = 3;
    s.calm();
    s.key(" ");
    s.run(() => s.r.sw.b > 0.7, 5);
    s.key(" ");
    expect(s.r.phase).toBe("down");
    s.run(() => s.r.sw.dur - s.r.sw.t < 0.09, 5);
    s.key(" ");
    s.run(() => s.r.phase === "rest", 40);
    s.frame();
    expect(rec.texts.some((x) => /^EARLY \d+ MS$/.test(x))).toBe(true);
  });
});

describe("G13: the label says carry, and the number is the carry", () => {
  it("a pure 100% swing with no wind carries exactly the number on the label, for each club", () => {
    for (let c = 0; c < CLUBS.length; c++) {
      const rec = recordingCtx();
      const s = makeSim(M, 1 / 60, rec.ctx);
      s.r.club = c;
      s.calm();
      s.frame();
      const label = `${Math.round(M.fullCarry(c))} YD CARRY`;
      expect(rec.texts, CLUBS[c].name).toContain(label);
      expect(rec.texts.some((x) => /YD FULL/.test(x))).toBe(false);
      M.rangeRemoteSwing(s.r, PURE, s.time());
      s.run(() => s.r.phase === "fly", 10);
      expect(Math.round(s.r.shot!.carry), CLUBS[c].name).toBe(Math.round(M.fullCarry(c)));
    }
  });
});
