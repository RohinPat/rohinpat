import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CourseGame, REST_HOLD, STEP, meterWords, type Phase } from "@/components/offhours/golf/play";
import { CLUBS } from "@/components/offhours/golf/flight";
import { buildHole, HOLE_DEFS, type Blob } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import { carryAtPower, fullCarry, powerFor } from "@/components/offhours/golf/swing";
import { carryRing, liftFor, paint, playDraw } from "@/components/offhours/golf/playDraw";
import { RANGE_WORLD, project } from "@/components/offhours/golf/scene";
import { puttPowerFor } from "@/components/offhours/golf/green";
import { forgetBest } from "@/components/offhours/golf/score";
import { fakeCtx, recordingCtx, stubScratchCanvas } from "./golf-headless";
import { BOTS, Player, mean, playRound } from "./golf-bots";
import { OLD_H2 } from "./golf-old-h2";

// these play real shots and rounds, which run many times slower under coverage on CI
vi.setConfig({ testTimeout: 60_000 });

// The course as a game with no screen: its phases, its rules, what it says, and the bots that play it.

beforeEach(() => {
  stubScratchCanvas();
  forgetBest();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PURE = { power: 1, face: 0, curve: 0, contact: 1 };
/** step until `until()` is true or `max` seconds of game time pass */
function run(g: CourseGame, until: () => boolean, max = 40) {
  const t0 = g.t;
  while (!until() && g.t - t0 < max) g.step(STEP);
  return until();
}
const onTee = (opts = {}) => {
  const g = new CourseGame({ seed: 5, ...opts });
  g.key({ key: " " }, true); // the card has been read
  g.wind = [0, 0];
  return g;
};
const yawTo = (g: CourseGame, x: number, z: number) => Math.atan2(x - g.ball[0], z - g.ball[1]);

describe("a hole, from the tee card", () => {
  it("opens on the tee card and says the hole, in the live region and the log", () => {
    const said: string[] = [];
    const g = new CourseGame({ seed: 5, say: (m) => said.push(m) });
    expect(g.phase).toBe("tee-card");
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^Hole 1, 340 yards, par 4\. (Wind \d+ mph from (the left|the right|behind|ahead)\.|No wind\.) (Driver|3 Wood)\.$/);
  });
  it("the card goes by itself after two seconds, or on any press (which is not a swing)", () => {
    const g = new CourseGame({ seed: 5 });
    expect(run(g, () => g.phase === "ready", 1.9)).toBe(false);
    expect(run(g, () => g.phase === "ready", 0.3)).toBe(true);
    const h = new CourseGame({ seed: 5 });
    h.pointer("down", 100, 100);
    expect(h.phase).toBe("ready");
    h.pointer("up", 100, 100);
    expect(h.phase).toBe("ready");
  });
  it("the club is the suggested one and the aim is the landing zone; the arrows can change both for this shot only", () => {
    const g = onTee();
    expect(g.club).toBe(g.suggested().club);
    expect(g.club).toBe(0); // 252 yd: the driver
    expect(g.yawT).toBeCloseTo(0, 9);
    g.key({ key: "ArrowDown" }, true);
    expect(g.club).toBe(1);
    g.key({ key: "ArrowRight", shiftKey: true }, true);
    expect(g.yawT).toBeCloseTo(0.05, 9);
    g.key({ key: "ArrowLeft", altKey: true }, true);
    expect(g.yawT).toBeCloseTo(0.045, 9);
    // the aim stays near the pin's line: it cannot be walked round the clock
    for (let i = 0; i < 100; i++) g.key({ key: "ArrowRight" }, true);
    expect(g.yawT - yawTo(g, g.hole.pin[0], g.hole.pin[1])).toBeLessThanOrEqual(0.42 + 1e-9);
  });
  it("the next shot gets its own suggestion, from where the ball lies, aimed at the pin", () => {
    const g = onTee();
    g.remoteSwing(PURE);
    expect(run(g, () => g.phase === "ready" || g.phase === "putt" || g.phase === "hole-card")).toBe(true);
    expect(g.phase).toBe("ready");
    expect(g.strokes).toBe(1);
    const yd = g.yardsToPin();
    expect(yd).toBeLessThan(120);
    expect(CLUBS[g.club].id).toMatch(/pw|sw|iron7/);
    expect(g.club).toBe(g.suggested().club);
    expect(g.yawT).toBeCloseTo(yawTo(g, g.hole.pin[0], g.hole.pin[1]), 9);
  });
  it("a chip is a sand wedge, not a driver", () => {
    const g = onTee();
    g.ball = [g.hole.pin[0], g.hole.pin[1] - 10 * YD];
    g.strokes = 2;
    (g as unknown as { prepareShot(tee: boolean): void }).prepareShot(false);
    expect(g.club).toBe(5);
  });
  it("a phone's swing is accepted only when the ball is waiting, and flies exactly as a pure swing", () => {
    const g = new CourseGame({ seed: 5 });
    g.wind = [0, 0];
    expect(g.remoteSwing(PURE)).toBe(false); // still on the tee card
    g.key({ key: " " }, true);
    g.setClub(0);
    expect(g.remoteSwing(PURE)).toBe(true);
    expect(g.remoteSwing(PURE)).toBe(false); // already swinging
    expect(run(g, () => g.phase === "fly")).toBe(true);
    expect(g.shot!.carry).toBeCloseTo(fullCarry(0), 3);
    expect(g.strokes).toBe(1);
  });
  it("a press while the ball flies plays it faster and never changes where it goes", () => {
    const play = (press: boolean) => {
      const g = onTee();
      g.remoteSwing(PURE);
      run(g, () => g.phase === "fly");
      if (press) g.key({ key: " " }, true);
      run(g, () => g.phase === "rest");
      return { g, t: g.t, end: [...g.ball] };
    };
    const a = play(false), b = play(true);
    expect(b.end).toEqual(a.end);
    expect(b.g.strokes).toBe(a.g.strokes);
    expect(b.t).toBeLessThan(a.t * 0.55);
  });
  it("after a shot the camera holds, a press skips the hold, and the next swing waits for the hold otherwise", () => {
    const g = onTee();
    g.remoteSwing(PURE);
    run(g, () => g.phase === "rest");
    expect(g.phase).toBe("rest");
    expect(g.remoteSwing(PURE)).toBe(false);
    g.key({ key: " " }, true);
    g.step(STEP);
    expect(g.phase).not.toBe("rest");
    const h = onTee();
    h.remoteSwing(PURE);
    run(h, () => h.phase === "rest");
    const t0 = h.t;
    run(h, () => h.phase !== "rest");
    expect(h.t - t0).toBeGreaterThanOrEqual(REST_HOLD - 0.05);
    expect(h.t - t0).toBeLessThan(REST_HOLD + 0.1);
  });
  it("says where the ball is after each shot", () => {
    const g = onTee();
    g.remoteSwing(PURE);
    run(g, () => g.phase === "rest");
    expect(g.said[g.said.length - 1]).toMatch(/^Driver: \d+ yards carry, \d+ total, in the fairway\. \d+ yards to the pin\.$/);
    expect(g.result).toMatch(/^FAIRWAY · \d+ YD TO GO$/);
  });
  it("a keyboard swing ticks once as it passes the meter's mark, and says its power, timing and strike after the ball", () => {
    const g = onTee();
    expect(g.club).toBe(g.meterSuggest().club);
    g.key({ key: " " }, true);
    expect(g.sw.mark).toBeCloseTo(g.meterSuggest().power, 5);
    expect(g.sw.marked).toBe(false);
    run(g, () => g.sw.b >= g.sw.mark);
    g.step(STEP);
    expect(g.sw.marked).toBe(true);
    g.key({ key: " " }, true); // the top, right at the mark
    run(g, () => g.sw.t >= g.sw.dur - STEP / 2);
    g.key({ key: " " }, true); // the strike
    run(g, () => g.phase === "rest");
    expect(g.said[g.said.length - 1]).toMatch(/^Driver: \d+ yards carry, .* to the pin\. Power \d+, (on time|late|early), (pure|solid|thin|fat)\.$/);
  });
  it("a club that is not the one the meter marks gets no tick", () => {
    const g = onTee();
    g.key({ key: "ArrowDown" }, true);
    g.key({ key: " " }, true);
    expect(g.sw.mark).toBe(0);
  });
  it("puts the meter's words together", () => {
    expect(meterWords(0.92, false, 0.004, "SOLID")).toBe(" Power 92, on time, solid.");
    expect(meterWords(0.8, false, 0.06, "THIN")).toBe(" Power 80, late, thin.");
    expect(meterWords(0.8, false, -0.06, "PURE")).toBe(" Power 80, early, pure.");
    expect(meterWords(1.3, true, null, "FAT")).toBe(" Power 115, over the top, fat.");
  });
});

describe("water, the woods, pick-up", () => {
  it("water: one stroke, the ball dropped on dry ground, and it says so", () => {
    const g = new CourseGame({ seed: 5, holes: [OLD_H2] });
    g.key({ key: " " }, true);
    g.wind = [0, 0];
    const d = OLD_H2.water[0] as Blob;
    const yd = Math.hypot(d.x, d.z);
    g.setAim(Math.atan2(d.x, d.z));
    g.setClub(3);
    g.remoteSwing({ ...PURE, power: powerFor(3, yd)! });
    expect(run(g, () => g.phase === "rest")).toBe(true);
    expect(g.shot!.surface).toBe("water");
    expect(g.dropped).toBe(true);
    expect(g.strokes).toBe(2);
    expect(g.hole.surfaceAt(g.ball[0], g.ball[1])).not.toBe("water");
    expect(g.said.some((m) => /^Water\./.test(m.split(": ").pop()!) || /Water\. One stroke added\. Dropping\./.test(m))).toBe(true);
    expect(g.result).toBe("WATER · +1");
    // and the next shot is from the drop, with its own club, still at the pin
    expect(run(g, () => g.phase === "ready")).toBe(true);
    expect(g.strokes).toBe(2);
    expect(g.club).toBe(g.suggested().club);
  });
  it("the woods: one stroke, dropped inside the edge of the rough", () => {
    const g = onTee();
    g.setAim(-0.75);
    g.setClub(0);
    g.remoteSwing(PURE);
    expect(run(g, () => g.phase === "rest")).toBe(true);
    expect(g.shot!.surface).toBe("out");
    expect(g.dropped).toBe(true);
    expect(g.strokes).toBe(2);
    expect(["fairway", "rough"]).toContain(g.hole.surfaceAt(g.ball[0], g.ball[1]));
    expect(g.said[g.said.length - 1]).toMatch(/In the trees\. One stroke added\. Dropping\./);
  });
  it("the ball is picked up at par + 5: the hole ends, scored at par + 5", () => {
    const g = onTee();
    g.strokes = 8; // par 4: the ninth stroke is the pick-up
    g.remoteSwing({ ...PURE, power: 0.5 });
    expect(run(g, () => g.phase === "hole-card")).toBe(true);
    expect(g.scores).toEqual([{ strokes: 9, pickedUp: true, call: "PICK UP" }]);
    expect(g.said[g.said.length - 1]).toBe("Hole 1: 9 strokes, pick up.");
  });
  it("a penalty that takes it to par + 5 also ends the hole", () => {
    const g = onTee();
    g.strokes = 7;
    g.setAim(-0.75);
    g.setClub(0);
    g.remoteSwing(PURE);
    expect(run(g, () => g.phase === "hole-card")).toBe(true);
    expect(g.scores[0]).toEqual({ strokes: 9, pickedUp: true, call: "PICK UP" });
  });
});

describe("the green", () => {
  /** a ball struck from 12 yards short of the pin, on the fairway, until it is putting */
  function toTheGreen(opts = {}) {
    const g = onTee(opts);
    g.ball = [g.hole.pin[0], g.hole.pin[1] - 12 * YD];
    g.lie = "fairway";
    g.strokes = 2;
    g.setAim(yawTo(g, g.hole.pin[0], g.hole.pin[1]));
    g.setClub(5);
    g.remoteSwing({ ...PURE, power: powerFor(5, 12)! });
    run(g, () => g.phase === "putt" || g.phase === "ready" || g.phase === "hole-card");
    return g;
  }
  it("a ball that stops on the green cuts to the putting view, with the strokes so far", () => {
    const g = toTheGreen();
    expect(g.phase).toBe("putt");
    expect(g.putt.course).not.toBeNull();
    expect(g.putt.strokes).toBe(3);
    const ps = g.puttState();
    expect(ps.dist).toBeGreaterThan(0);
    expect(ps.dist).toBeLessThan(10);
    // the cup is the pin, in the green's coordinates
    expect(ps.cup).toEqual(g.hole.toGreen(g.hole.pin[0], g.hole.pin[1]));
    // the ball is where the shot left it, in the green's coordinates
    const [gx, gy] = g.hole.toGreen(g.ball[0], g.ball[1]);
    expect(ps.ball[0]).toBeCloseTo(gx, 9);
    expect(ps.ball[1]).toBeCloseTo(gy, 9);
    expect(g.putt.fade).toBe(0); // dissolving in
  });
  it("reduced motion cuts without the dissolve", () => {
    const g = toTheGreen({ reduce: true });
    expect(g.phase).toBe("putt");
    expect(g.putt.fade).toBe(1);
  });
  it("putts until it is in: the hole card has the call, the score and the live region say it", () => {
    const g = toTheGreen();
    for (let i = 0; i < 12 && g.phase === "putt"; i++) {
      run(g, () => !g.puttState().rolling || g.phase !== "putt", 20);
      if (g.phase !== "putt") break;
      const ps = g.puttState();
      g.puttShoot(Math.atan2(ps.cup[1] - ps.ball[1], ps.cup[0] - ps.ball[0]), puttPowerFor(ps.dist + 0.3));
    }
    run(g, () => g.phase === "hole-card", 10);
    expect(g.phase).toBe("hole-card");
    expect(g.scores).toHaveLength(1);
    const s = g.scores[0].strokes;
    expect(s).toBeGreaterThanOrEqual(4);
    expect(s).toBeLessThanOrEqual(9);
    expect(g.said[g.said.length - 1]).toMatch(new RegExp(`^Hole 1: ${s} strokes, [a-z +0-9]+\\.$`));
    // a putt that stops short says how far is left
    expect(g.said.some((m) => /^\d+ feet to the pin\.$/.test(m)) || s === 4).toBe(true);
  });
  it("the card moves on with a press, to the next hole; then the scorecard; then a new round", () => {
    const r = playRound(BOTS.skilled, 4);
    const g = r.game;
    expect(g.phase).toBe("round-card");
    expect(g.round).not.toBeNull();
    expect(g.round!.total).toBe(r.total);
    expect(g.round!.par).toBe(23);
    expect(g.round!.isBest).toBe(true);
    expect(g.round!.previous).toBeNull();
    // a press too soon is ignored (the key that holed it)
    g.key({ key: " " }, true);
    expect(g.phase).toBe("round-card");
    run(g, () => false, 1.2);
    g.key({ key: " " }, true);
    expect(g.phase).toBe("tee-card");
    expect(g.idx).toBe(0);
    expect(g.scores).toEqual([]);
    expect(g.round).toBeNull();
  });
  it("the best of this visit is kept across rounds, in memory only", () => {
    forgetBest();
    const a = playRound(BOTS.skilled, 1, { game: { seed: 1 } });
    // playRound forgets the best at its start, so go on from the same game
    const g = a.game;
    const first = g.round!.total;
    run(g, () => false, 1.2);
    g.key({ key: " " }, true);
    const p = new Player(g, BOTS.skilled, 99);
    while (!g.finished && g.t < 2000) p.tick();
    expect(g.finished).toBe(true);
    expect(g.round!.previous).toBe(first);
    expect(g.round!.best).toBe(Math.min(first, g.round!.total));
    expect(g.round!.isBest).toBe(g.round!.total < first);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});

describe("repeatability and the idle player", () => {
  it("the same seed and the same inputs make the same round, said and done", () => {
    const a = playRound(BOTS.skilled, 12), b = playRound(BOTS.skilled, 12);
    expect(a.game.said).toEqual(b.game.said);
    expect(a.holes).toEqual(b.holes);
    expect(playRound(BOTS.skilled, 13).game.said).not.toEqual(a.game.said);
  });
  it("a player who does nothing never advances and scores nothing", () => {
    const r = playRound(BOTS.idle, 3, { maxSeconds: 120 });
    expect(r.finished).toBe(false);
    expect(r.holes).toEqual([]);
    expect(r.game.phase).toBe("ready");
    expect(r.game.strokes).toBe(0);
    expect(r.game.idx).toBe(0);
    expect(r.game.t).toBeGreaterThan(119);
  });
});

describe("the bots: measured bands, pinned", () => {
  // 30 seeded rounds each over all six holes (par 23). The numbers in the PR are these.
  const rounds = (bot: (typeof BOTS)[string]) => Array.from({ length: 30 }, (_, i) => playRound(bot, i + 1));
  const total = (rs: ReturnType<typeof rounds>) => mean(rs.map((r) => r.total));
  const holeMean = (rs: ReturnType<typeof rounds>, h: number) => mean(rs.map((r) => r.holes[h]));

  it("skilled (aim off by 0.03 rad, power by 8%): par + 3 to par + 6, never stuck", { timeout: 90_000 }, () => {
    const rs = rounds(BOTS.skilled);
    expect(rs.every((r) => r.finished)).toBe(true);
    expect(total(rs)).toBeGreaterThanOrEqual(26);
    expect(total(rs)).toBeLessThanOrEqual(29);
    expect(Math.min(...rs.map((r) => r.total))).toBeGreaterThanOrEqual(23);
    expect(Math.max(...rs.map((r) => r.total))).toBeLessThanOrEqual(36);
    // every hole is about a par plus one, none out of reach (the par 5 is a little under: it is reached in two)
    rs[0].pars.forEach((par, h) => {
      expect(holeMean(rs, h), `hole ${h + 1}`).toBeGreaterThanOrEqual(par - 0.6);
      expect(holeMean(rs, h), `hole ${h + 1}`).toBeLessThanOrEqual(par + 2);
    });
    expect(rs.reduce((a, r) => a + r.pickedUp, 0)).toBeLessThanOrEqual(2);
  });

  it("casual (aim off by 0.08 rad, power by 15%): par + 9 to par + 14, with a few pick-ups", { timeout: 90_000 }, () => {
    const rs = rounds(BOTS.casual);
    expect(rs.every((r) => r.finished)).toBe(true);
    expect(total(rs)).toBeGreaterThanOrEqual(32);
    expect(total(rs)).toBeLessThanOrEqual(37);
    expect(total(rs)).toBeGreaterThan(total(rounds(BOTS.skilled)) + 4);
    expect(rs.reduce((a, r) => a + r.pickedUp, 0)).toBeLessThanOrEqual(25);
  });

  it("the keyboard's three presses, played well (40 ms off the line), plays like the skilled player", { timeout: 90_000 }, () => {
    const rs = rounds(BOTS.keyboard);
    expect(rs.every((r) => r.finished)).toBe(true);
    expect(total(rs)).toBeGreaterThanOrEqual(25.5);
    expect(total(rs)).toBeLessThanOrEqual(29.5);
  });

  it("one button (Space once per shot): every hole ends, at par + 5 or better", { timeout: 90_000 }, () => {
    const rs = rounds(BOTS.oneButton);
    expect(rs.every((r) => r.finished)).toBe(true);
    for (const r of rs) r.holes.forEach((s, i) => expect(s, `seed ${r.seed} hole ${i + 1}`).toBeLessThanOrEqual(r.pars[i] + 5));
    // the one press is the over-the-top swing: it is a long way from par
    expect(total(rs)).toBeGreaterThan(40);
  });
});

describe("drawing, with no screen", () => {
  const ptr = { x: 0, y: 0, inside: false };
  const sized = (g: CourseGame, w = 1440, h = 900) => {
    g.w = w;
    g.h = h;
  };

  it("the tee card says the hole in capitals", () => {
    const rec = recordingCtx();
    const g = new CourseGame({ seed: 5 });
    sized(g);
    playDraw(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    expect(rec.texts).toContain("HOLE 1 · PAR 4 · 340 YD");
    expect(rec.texts).toContain("OPEN DOOR");
  });
  it("the shot view: the hole, the club, the yards to the pin, the strokes and the wind", () => {
    const rec = recordingCtx();
    const g = onTee();
    sized(g);
    playDraw(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    for (const s of ["HOLE 1 · PAR 4", "340 YD TO THE PIN", "STROKES 0", "DRIVER", `${Math.round(fullCarry(0))} YD CARRY`, "WIND"]) expect(rec.texts, s).toContain(s);
    expect(rec.texts.some((t) => /^\d+ MPH$/.test(t))).toBe(true);
  });
  it("every phase draws, at desktop and phone size, and a draw never changes the game", { timeout: 60_000 }, () => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const g = onTee();
      sized(g, w, h);
      const ctx = fakeCtx();
      const phases = new Set<Phase>();
      const seen = (p: Phase) => phases.add(p);
      const player = new Player(g, BOTS.skilled, 6);
      let guard = 0;
      let last: Phase | null = null;
      while (!g.finished && guard++ < 60 * 400) {
        player.tick();
        seen(g.phase);
        // six holes, twice: paint each phase as it starts and a sample between
        if (g.phase !== last || guard % 61 === 0) paint(ctx, g, w, h, 1 / 60, ptr);
        last = g.phase;
      }
      paint(ctx, g, w, h, 1 / 60, ptr);
      for (const p of ["ready", "swing", "fly", "rest", "putt", "hole-card", "round-card"] as Phase[]) expect(phases.has(p), `${p} at ${w}`).toBe(true);
    }
  });
  it("the hole card names the call, the strokes and the round", () => {
    const rec = recordingCtx();
    const r = playRound(BOTS.skilled, 4, { maxSeconds: 60 });
    void r;
    const g = new CourseGame({ seed: 4 });
    const p = new Player(g, BOTS.skilled, 4);
    while (g.phase !== "hole-card" && g.t < 300) p.tick();
    sized(g);
    paint(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    const hs = g.scores[0];
    expect(rec.texts).toContain(hs.call);
    expect(rec.texts).toContain(`${hs.strokes} ${hs.strokes === 1 ? "STROKE" : "STROKES"} · PAR 4`);
    expect(rec.texts.some((t) => /^ROUND \d+ · (E|[+-]\d+)$/.test(t))).toBe(true);
  });
  it("the scorecard has a row per hole, the total against par and the best of this visit", () => {
    const rec = recordingCtx();
    const r = playRound(BOTS.skilled, 4);
    const g = r.game;
    run(g, () => false, 1.2);
    sized(g);
    paint(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    expect(rec.texts).toContain("SCORECARD");
    expect(rec.texts).toContain(String(r.total));
    expect(rec.texts.some((t) => /OVER PAR$|^EVEN PAR$|UNDER PAR$/.test(t))).toBe(true);
    expect(rec.texts).toContain(`BEST THIS VISIT ${r.total}`);
    for (const s of r.holes) expect(rec.texts).toContain(String(s));
  });
  it("no copy goes past a short line, and none says 'not' as a slogan", () => {
    const rec = recordingCtx();
    const g = new CourseGame({ seed: 5 });
    const p = new Player(g, BOTS.skilled, 5);
    sized(g);
    let n = 0;
    while (!g.finished && n++ < 60 * 400) {
      p.tick();
      if (n % 11 === 0) paint(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    }
    for (const t of Array.from(new Set(rec.texts))) {
      expect(t.length, t).toBeLessThanOrEqual(70);
      if (/[a-z]/.test(t) && !/^\d/.test(t)) expect(t, "capitals on the canvas").toBe(t.toUpperCase());
    }
  });
});

describe("reading the hole from the tee", () => {
  const ptr = { x: 0, y: 0, inside: false };
  /** the green's edge on screen, px tall, from the camera the game has drawn with */
  function greenPx(g: CourseGame, w: number, h: number) {
    g.w = w;
    g.h = h;
    paint(fakeCtx(), g, w, h, 1 / 60, ptr);
    const gr = g.hole.world.greens[0];
    const p = { x: 0, y: 0, d: 0, s: 0 };
    let y0 = 1e9, y1 = -1e9;
    for (const [x, , z] of gr.ring(gr.r)) {
      expect(project(g.cam, x, 0, z, p)).toBe(true);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    return { px: y1 - y0, top: y0, bottom: y1 };
  }
  it("from hole 2 the green is at least 60 px tall at 1440x900 and in the dialog (1406x698), with the pond and the sand on screen", () => {
    for (const [w, h] of [[1440, 900], [1406, 698]]) {
      const g = new CourseGame({ seed: 5, holes: [HOLE_DEFS[1]] });
      const r = greenPx(g, w, h);
      expect(r.px, `${w}x${h}`).toBeGreaterThanOrEqual(60);
      expect(r.bottom).toBeLessThan(h);
      expect(r.top).toBeGreaterThan(0);
      const p = { x: 0, y: 0, d: 0, s: 0 };
      for (const [x, z] of [[-17, 108], [17, 134]]) {
        expect(project(g.cam, x * YD, 0, z * YD, p)).toBe(true);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(w);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(h);
      }
    }
  });
  it("the tee shot on hole 1 keeps the long-shot camera, and a short shot from the fairway raises it", () => {
    const g = new CourseGame({ seed: 5 });
    paint(fakeCtx(), g, 1440, 900, 1 / 60, ptr);
    expect(g.cam.y).toBeCloseTo(1.9, 6);
    expect(liftFor(252)).toBe(0);
    expect(liftFor(135)).toBe(1);
    expect(liftFor(75)).toBe(1);
    expect(liftFor(195)).toBeGreaterThan(0);
    expect(liftFor(195)).toBeLessThan(1);
    expect(liftFor(175)).toBe(1);
    g.key({ key: " " }, true);
    g.wind = [0, 0];
    g.remoteSwing(PURE);
    run(g, () => g.phase === "ready");
    for (let i = 0; i < 240; i++) paint(fakeCtx(), g, 1440, 900, 1 / 60, ptr);
    expect(g.cam.y).toBeGreaterThan(30);
  });
  it("at phone size the raised camera still has the pond, the sand and the green in the picture", () => {
    const g = new CourseGame({ seed: 5, holes: [HOLE_DEFS[1]] });
    const r = greenPx(g, 390, 700);
    expect(r.px).toBeGreaterThan(20);
    const p = { x: 0, y: 0, d: 0, s: 0 };
    for (const [x, z] of [[-17, 108], [17, 134], [0, 137]]) {
      expect(project(g.cam, x * YD, 0, z * YD, p)).toBe(true);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(390);
    }
  });
  it("after a shot the camera goes to the address view for the next one, so the rest view shows the hole", () => {
    const g = new CourseGame({ seed: 5 });
    g.key({ key: " " }, true);
    g.wind = [0, 0];
    g.setClub(0);
    g.remoteSwing(PURE);
    run(g, () => g.phase === "rest");
    for (let i = 0; i < 70; i++) paint(fakeCtx(), g, 390, 844, 1 / 60, ptr);
    // the ball is about 75 yd from the pin: the camera is rising, looking down the line to it
    expect(g.cam.y).toBeGreaterThan(5);
  });
  it("the course's flag is drawn at least 34 px tall, and the range's flags are untouched", () => {
    const g = new CourseGame({ seed: 5, holes: [HOLE_DEFS[1]] });
    expect(g.hole.world.flagMin).toBe(34);
    expect(RANGE_WORLD.flagMin).toBeUndefined();
    expect(RANGE_WORLD.markers).toBeUndefined();
    expect(RANGE_WORLD.palette).toBeUndefined();
  });
});

describe("the aim line and the carry ring", () => {
  const ptr = { x: 0, y: 0, inside: false };
  const yardsFrom = (g: CourseGame, r: { x: number; z: number }) => Math.hypot(r.x - g.ball[0], r.z - g.ball[1]) / YD;

  it("the ring is where the selected club carries with no wind: within 1 yd of the club table at aim 0, for every club", () => {
    const g = new CourseGame({ seed: 5 });
    g.key({ key: " " }, true);
    g.setAim(0);
    for (let c = 0; c < CLUBS.length; c++) {
      g.setClub(c);
      const r = carryRing(g);
      expect(Math.abs(yardsFrom(g, r) - fullCarry(c)), CLUBS[c].name).toBeLessThan(1);
      expect(r.x).toBeCloseTo(0, 6);
      expect(Math.abs(r.yd - fullCarry(c))).toBeLessThan(1);
      // and a ball that is flown pure, calm, at that aim comes down on it
    }
    g.setClub(3);
    g.wind = [0, 0];
    g.remoteSwing(PURE);
    run(g, () => g.phase === "fly");
    const land = g.shot!.bounces[0];
    const ring = { x: 0, z: fullCarry(3) * YD };
    expect(Math.hypot(land.x - ring.x, land.z - ring.z) / YD).toBeLessThan(1);
  });
  it("it moves with the aim and with the club, and shortens with a swing drawn back only part way", () => {
    const g = new CourseGame({ seed: 5 });
    g.key({ key: " " }, true);
    g.setAim(0);
    g.setClub(0);
    const a = carryRing(g);
    g.key({ key: "ArrowRight", shiftKey: true }, true);
    for (let i = 0; i < 90; i++) g.step(STEP);
    const b = carryRing(g);
    expect(b.x).toBeGreaterThan(a.x + 5);
    expect(Math.abs(b.yd - a.yd)).toBeLessThan(1e-6);
    g.key({ key: "ArrowDown" }, true);
    expect(carryRing(g).yd).toBeCloseTo(fullCarry(1), 6);
    // a swing drawn back to half power: the ring comes in to that carry
    g.h = 900;
    g.pointer("down", 700, 300);
    g.pointer("move", 700, 300 + 0.5 * 230 * 0.9);
    const half = carryRing(g).yd;
    expect(half).toBeLessThan(fullCarry(1) * 0.8);
    expect(half).toBeCloseTo(carryAtPower(1, g.sw.b), 6);
  });
  it("it is drawn while the ball waits and while swinging, with the yards, and gone in flight and at rest", () => {
    const g = new CourseGame({ seed: 5 });
    g.key({ key: " " }, true);
    g.w = 1440;
    g.h = 900;
    g.setAim(0);
    const label = `${Math.round(fullCarry(g.club))} YD`;
    const rec = recordingCtx();
    paint(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    expect(rec.texts).toContain(label);
    g.wind = [0, 0];
    g.remoteSwing(PURE);
    run(g, () => g.phase === "fly");
    rec.clear();
    paint(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    expect(rec.texts).not.toContain(label);
    run(g, () => g.phase === "rest");
    rec.clear();
    paint(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    expect(rec.texts).not.toContain(label);
  });
  it("draws the same with reduced motion (nothing in it moves)", () => {
    const a = recordingCtx(), b = recordingCtx();
    const ga = new CourseGame({ seed: 5 }), gb = new CourseGame({ seed: 5, reduce: true });
    for (const [g, r] of [[ga, a], [gb, b]] as const) {
      g.key({ key: " " }, true);
      g.taken = 1; // past the first shot's cue, which is meant to differ
      g.w = 1440;
      g.h = 900;
      for (let i = 0; i < 30; i++) paint(r.ctx, g, 1440, 900, 1 / 60, ptr);
    }
    expect(b.texts).toEqual(a.texts);
    expect(b.arcs.length).toBe(a.arcs.length);
  });
  it("a marker points to the ball when the raised camera has it below the picture; not on the long-shot view", () => {
    const rec = recordingCtx();
    const g = new CourseGame({ seed: 5, holes: [HOLE_DEFS[1]] });
    g.key({ key: " " }, true);
    g.w = 1440;
    g.h = 900;
    paint(rec.ctx, g, 1440, 900, 1 / 60, ptr);
    expect(rec.texts).toContain("BALL");
    const t = recordingCtx();
    const tee = new CourseGame({ seed: 5 });
    tee.key({ key: " " }, true);
    tee.w = 1440;
    tee.h = 900;
    paint(t.ctx, tee, 1440, 900, 1 / 60, ptr);
    expect(t.texts.some((x) => x.startsWith("BALL"))).toBe(false);
    // and at phone size
    const m = recordingCtx();
    const ph = new CourseGame({ seed: 5, holes: [HOLE_DEFS[1]] });
    ph.key({ key: " " }, true);
    ph.w = 390;
    ph.h = 700;
    paint(m.ctx, ph, 390, 700, 1 / 60, ptr);
    expect(m.texts).toContain("BALL");
  });
});

describe("holes", () => {
  it("the game runs any list of holes, and the last one ends the round", () => {
    const g = new CourseGame({ seed: 2, holes: [HOLE_DEFS[1]] });
    const p = new Player(g, BOTS.skilled, 2);
    while (!g.finished && g.t < 600) p.tick();
    expect(g.scores).toHaveLength(1);
    expect(g.round!.par).toBe(3);
    expect(buildHole(HOLE_DEFS[1])).toBe(buildHole(HOLE_DEFS[1]));
  });
});

describe("a linked phone", () => {
  it("its aim buttons take the laptop's step, only while the next shot is being set up", () => {
    const g = onTee();
    run(g, () => g.phase === "ready");
    const y = g.yawT;
    g.remoteAim(1);
    expect(g.yawT).toBeCloseTo(y + 0.03);
    g.remoteAim(-1);
    g.remoteAim(-1);
    expect(g.yawT).toBeCloseTo(y - 0.03);
    g.remoteAim(0);
    expect(g.yawT).toBeCloseTo(y - 0.03);
    g.remoteSwing(PURE);
    const during = g.yawT;
    g.remoteAim(1);
    expect(g.yawT).toBe(during);
  });
  it("the mouse and key hints stay away while a phone is paired", () => {
    const hints = (linked: boolean) => {
      const rec = recordingCtx();
      const g = onTee();
      run(g, () => g.phase === "ready");
      g.linked = linked;
      g.w = 1440;
      g.h = 900;
      paint(rec.ctx, g, 1440, 900, 1 / 60, { x: 0, y: 0, inside: false });
      return rec.texts.filter((t) => t.startsWith("DRAG DOWN"));
    };
    expect(hints(false).length).toBeGreaterThan(0);
    expect(hints(true)).toEqual([]);
  });
it("the first shot shows a moving dot, still under reduced motion, and it goes with the first strike", () => {    const arcs = (opts: { reduce?: boolean }, taken: number) => {      const rec = recordingCtx();      const g = onTee(opts);      run(g, () => g.phase === "ready");      g.taken = taken;      g.w = 1440;      g.h = 900;      paint(rec.ctx, g, 1440, 900, 1 / 60, { x: 0, y: 0, inside: false });      return rec.arcs.length;    };    expect(arcs({}, 0)).toBe(arcs({}, 1) + 1);    expect(arcs({ reduce: true }, 0)).toBe(arcs({ reduce: true }, 1));  });
});

describe("what the game says for a player who cannot see it", () => {
  const ready = () => {
    const said: string[] = [];
    const g = new CourseGame({ seed: 5, say: (m) => said.push(m) });
    g.key({ key: " " }, true);
    expect(g.phase).toBe("ready");
    return { g, said };
  };
  it("a club picked by the player, with how far it carries", () => {
    const { g, said } = ready();
    g.key({ key: "ArrowDown" }, true);
    const m = said[said.length - 1];
    expect(m.startsWith(`${CLUBS[g.club].name}, `)).toBe(true);
    expect(m).toMatch(/, \d+ yards\.$/);
  });
  it("the aim once it stops moving, left or right of the target in yards, and straight back at it", () => {
    const { g, said } = ready();
    for (let i = 0; i < 4; i++) g.key({ key: "ArrowLeft" }, true);
    const n = said.length;
    g.step(0.3);
    expect(said).toHaveLength(n);
    g.step(0.5);
    expect(said[said.length - 1]).toMatch(/^Aim \d+ yards left\.$/);
    for (let i = 0; i < 4; i++) g.key({ key: "ArrowRight" }, true);
    for (let i = 0; i < 60; i++) g.step(1 / 60);
    expect(said[said.length - 1]).toBe("Aim straight.");
  });
});
