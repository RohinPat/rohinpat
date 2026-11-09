import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIM_STEP, CUP_R, HOLES, MU, TAP_IN, makeHole, newPutt, puttDraw, puttKey, stepBall, type Putt, type PuttEnv } from "@/components/offhours/golf/green";
import { fakeCtx, recordingCtx, stubScratchCanvas } from "./golf-headless";

// Putting, with the ball model the game itself runs.

beforeEach(() => stubScratchCanvas());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const env = (over: Partial<PuttEnv> = {}): PuttEnv & { said: string[] } => {
  const said: string[] = [];
  return { play: true, say: (m) => said.push(m), said, ...over };
};
const ptr = { x: 0, y: 0, inside: false };
const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, repeat: false, ...mods }) as KeyboardEvent;

/** run the putt's own clock */
function run(p: Putt, e: PuttEnv, seconds: number, t0 = 1, ctx = fakeCtx()) {
  let t = t0;
  for (let i = 0; i < seconds * 60; i++) {
    puttDraw(ctx, p, 1200, 800, 1 / 60, t, e, ptr);
    t += 1 / 60;
  }
  return t;
}

/** a ball on its own, going nowhere: dead flat green, cup at (10, 6) */
function flatHole() {
  const H = makeHole(1);
  H.hills = [];
  H.tilt = [0, 0];
  H.cup = [10, 6];
  H.tee = [4, 6];
  return H;
}
const roll = (H: ReturnType<typeof flatHole>, ang: number, speed: number, from: [number, number] = H.tee) => {
  const b = { x: from[0], y: from[1], vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, moving: true, sunk: false };
  for (let i = 0; i < 8000 && b.moving; i++) if (stepBall(H, b, 1 / 240) === "sunk") return { sunk: true as const, b };
  return { sunk: false as const, b };
};

describe("the cup", () => {
  it("is 0.07 m, and a slow ball that clips its edge drops", () => {
    expect(CUP_R).toBe(0.07);
    const H = flatHole();
    // a slow ball aimed 6.5 cm to the side of the cup centre: inside the new cup, outside the old one (5.4 cm)
    const speed = Math.sqrt(2 * MU * 6.1);
    expect(roll(H, Math.atan2(0.065, 6), speed).sunk).toBe(true);
    // and a ball well outside it does not
    expect(roll(H, Math.atan2(0.14, 6), speed).sunk).toBe(false);
  });
});

describe("tap-in", () => {
  it("a ball that stops within 0.45 m of the cup is tapped in after a beat, as one more stroke", () => {
    expect(TAP_IN).toBe(0.45);
    const p = newPutt();
    const e = env();
    const H = p.hole;
    // the ball has come to rest 0.4 m from the cup, after one stroke
    p.strokes = 1;
    p.ball = { x: H.cup[0] - 0.4, y: H.cup[1], vx: 0.005, vy: 0, moving: true, sunk: false };
    const t = run(p, e, 0.2);
    expect(p.ball.moving).toBe(false);
    expect(p.tap).not.toBeNull();
    expect(p.call).toBe("TAP IN");
    expect(e.said).toContain("Tap in.");
    expect(p.ball.sunk).toBe(false);
    expect(p.strokes).toBe(1);
    // the putter steps up first: the ball has not moved, and the stroke is not counted yet
    const t2 = run(p, e, 0.45, t);
    expect(p.tap).not.toBeNull();
    expect(p.ball.x).toBe(p.tap!.x);
    expect(p.strokes).toBe(1);
    expect(p.call).toBe("TAP IN");
    // the tap: the stroke counts, and the ball is in
    run(p, e, 0.6, t2);
    expect(p.ball.sunk).toBe(true);
    expect(p.tap).toBeNull();
    expect(p.strokes).toBe(2);
    expect(p.scores[0]).toBe(2);
    // the usual call for the score follows
    expect(p.call).toBe("PAR");
    expect(e.said.some((m) => /Hole 1: 2 strokes, par/.test(m))).toBe(true);
  });
  it("a ball further out is not holed, and a putt can't start during the beat", () => {
    const p = newPutt();
    const e = env();
    const H = p.hole;
    p.strokes = 1;
    p.ball = { x: H.cup[0] - 0.7, y: H.cup[1], vx: 0.005, vy: 0, moving: true, sunk: false };
    run(p, e, 1.5);
    expect(p.ball.sunk).toBe(false);
    expect(p.tap).toBeNull();
    expect(p.strokes).toBe(1);
    // inside the beat, Space does not start charging a stroke
    const q = newPutt();
    q.strokes = 1;
    q.ball = { x: q.hole.cup[0] - 0.3, y: q.hole.cup[1], vx: 0.005, vy: 0, moving: true, sunk: false };
    const t = run(q, e, 0.15);
    expect(q.tap).not.toBeNull();
    puttKey(q, key(" "), true, t, e);
    expect(q.kCharging).toBe(false);
  });
  it("a pick-up stroke count still wins over a tap-in", () => {
    const p = newPutt();
    const e = env();
    p.strokes = 7;
    p.ball = { x: p.hole.cup[0] - 0.3, y: p.hole.cup[1], vx: 0.005, vy: 0, moving: true, sunk: false };
    run(p, e, 1);
    expect(p.tap).toBeNull();
    expect(p.scores[0]).toBe(7);
    expect(p.call).toBe("PICK UP");
  });
});

describe("fine aim", () => {
  it("Alt with an arrow steps the aim 0.005 rad; the plain and Shift steps are as they were", () => {
    const p = newPutt();
    const e = env();
    const a0 = p.kAngle;
    puttKey(p, key("ArrowRight", { altKey: true }), true, 1, e);
    expect(p.kAngle - a0).toBeCloseTo(0.005, 9);
    puttKey(p, key("ArrowLeft", { altKey: true }), true, 1, e);
    expect(p.kAngle).toBeCloseTo(a0, 9);
    puttKey(p, key("ArrowRight"), true, 1, e);
    expect(p.kAngle - a0).toBeCloseTo(AIM_STEP.normal, 9);
    puttKey(p, key("ArrowRight", { shiftKey: true }), true, 1, e);
    expect(p.kAngle - a0).toBeCloseTo(AIM_STEP.normal + AIM_STEP.big, 9);
    expect(AIM_STEP).toEqual({ fine: 0.005, normal: 0.03, big: 0.1 });
  });
  it("the key is taken, so the browser's Alt+Left (back) does not run", () => {
    const p = newPutt();
    expect(puttKey(p, key("ArrowLeft", { altKey: true }), true, 1, env())).toBe(true);
  });
  it("a 15 to 25 ft putt can be holed from the tee at some fine aim step", { timeout: 60_000 }, () => {
    // holes 1, 2, 3 and 5 are 15, 20, 25 and 23 ft. Count the 0.005 rad steps, either side of the cup line, where some pace rolls it in.
    for (const n of [1, 2, 3, 5]) {
      const H = makeHole(n);
      const dist = Math.hypot(H.cup[0] - H.tee[0], H.cup[1] - H.tee[1]);
      expect(dist * 3.281).toBeGreaterThan(14);
      expect(dist * 3.281).toBeLessThan(26);
      const base = Math.atan2(H.cup[1] - H.tee[1], H.cup[0] - H.tee[0]);
      let sinks = 0;
      for (let k = -80; k <= 80; k++)
        for (let f = 0.9; f <= 1.4001; f += 0.02) {
          const b = { x: H.tee[0], y: H.tee[1], vx: 0, vy: 0, moving: true, sunk: false };
          const sp = Math.sqrt(2 * MU * dist) * f;
          b.vx = Math.cos(base + k * AIM_STEP.fine) * sp;
          b.vy = Math.sin(base + k * AIM_STEP.fine) * sp;
          let ev: string | null = null;
          for (let i = 0; i < 8000 && b.moving && ev !== "sunk"; i++) ev = stepBall(H, b, 1 / 240);
          if (ev === "sunk") {
            sinks++;
            break;
          }
        }
      expect(sinks, `hole ${n}`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("a round, played by the sim players", () => {
  const seededRng = (s = 12345) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  /** nine holes by a player who rolls putts on the real ball model, with the tap-in rule */
  function round(strat: "naive" | "reader", angSd: number, spdSd: number, N: number) {
    const rng = seededRng();
    const gauss = () => {
      let u = 0;
      for (let i = 0; i < 6; i++) u += rng();
      return (u - 3) / 0.7071;
    };
    let total = 0, par = 0;
    for (let n = 1; n <= HOLES; n++) {
      const H = makeHole(n);
      par += H.par;
      for (let k = 0; k < N; k++) {
        let x = H.tee[0], y = H.tee[1], strokes = 0;
        for (;;) {
          if (strokes >= 7) break;
          const dist = Math.hypot(H.cup[0] - x, H.cup[1] - y);
          const base = Math.atan2(H.cup[1] - y, H.cup[0] - x);
          const rollFrom = (ang: number, sp: number) => {
            const b = { x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, moving: true, sunk: false };
            for (let i = 0; i < 8000 && b.moving; i++) if (stepBall(H, b, 1 / 240) === "sunk") return { sunk: true, x: H.cup[0], y: H.cup[1] };
            return { sunk: false, x: b.x, y: b.y };
          };
          let ang = base, spd = Math.sqrt(2 * MU * (dist + 0.5));
          if (strat === "reader") {
            let best = { sc: 1e9, a: base, s: spd };
            for (let da = -0.3; da <= 0.3; da += 0.02)
              for (const f of [0.9, 1.0, 1.1, 1.25]) {
                const s2 = Math.sqrt(2 * MU * dist) * f + 0.15;
                const r = rollFrom(base + da, s2);
                const sc = r.sunk ? -1 : Math.hypot(r.x - H.cup[0], r.y - H.cup[1]);
                if (sc < best.sc) best = { sc, a: base + da, s: s2 };
              }
            ang = best.a;
            spd = best.s;
          }
          ang += gauss() * angSd;
          spd *= 1 + gauss() * spdSd;
          strokes++;
          const r = rollFrom(ang, Math.max(0.12, spd));
          if (r.sunk) break;
          if (Math.hypot(r.x - H.cup[0], r.y - H.cup[1]) < TAP_IN && strokes < 7) {
            strokes++;
            break;
          }
          x = r.x;
          y = r.y;
        }
        total += strokes / N;
      }
    }
    return { total, par };
  }
  it("a green-reader is near par plus 2 to 4, and aiming at the cup is worse", { timeout: 60_000 }, () => {
    const reader = round("reader", 0.022, 0.06, 10);
    const naive = round("naive", 0.015, 0.05, 30);
    expect(reader.par).toBe(20);
    expect(reader.total - reader.par).toBeGreaterThanOrEqual(1.5);
    expect(reader.total - reader.par).toBeLessThanOrEqual(4.5);
    expect(naive.total).toBeGreaterThan(reader.total + 2);
  });
});

describe("the ball wears a ring until the first stroke", () => {
  const ringArcs = (arcs: [number, number, number][]) => arcs.filter(([, , r]) => r >= 10.5 && r <= 60);
  it("is drawn before the first stroke of a hole and gone after it", () => {
    const p = newPutt();
    const rec = recordingCtx();
    run(p, env(), 0.2, 1, rec.ctx);
    rec.clear();
    run(p, env(), 0.05, 2, rec.ctx);
    expect(ringArcs(rec.arcs).length).toBeGreaterThanOrEqual(2);
    // one stroke taken, the ball at rest again
    p.strokes = 1;
    rec.clear();
    run(p, env(), 0.05, 3, rec.ctx);
    expect(ringArcs(rec.arcs)).toHaveLength(0);
  });
  it("reads at 390 px as well as 1440 px", () => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const p = newPutt();
      const rec = recordingCtx();
      puttDraw(rec.ctx, p, w, h, 1 / 60, 1, env(), ptr);
      rec.clear();
      puttDraw(rec.ctx, p, w, h, 1 / 60, 2, env(), ptr);
      const ring = ringArcs(rec.arcs);
      expect(ring.length, `${w}`).toBeGreaterThanOrEqual(2);
      expect(Math.min(...ring.map((a) => a[2])), `${w}`).toBeGreaterThanOrEqual(10.5);
    }
  });
  it("pulses, and holds still under reduced motion", () => {
    const radii = (reduce: boolean) => {
      const p = newPutt();
      const e = env({ reduce });
      const out = new Set<number>();
      for (let i = 0; i < 40; i++) {
        const rec = recordingCtx();
        puttDraw(rec.ctx, p, 1200, 800, 1 / 60, 1 + i * 0.05, e, ptr);
        out.add(Math.round(Math.min(...ringArcs(rec.arcs).map((a) => a[2])) * 100));
      }
      return out;
    };
    expect(radii(false).size).toBeGreaterThan(3);
    expect(radii(true).size).toBe(1);
  });
});
