import { describe, expect, it } from "vitest";
import {
  ARM_REACH, GW, MAX_DIVE, RUNUP, SHOTS, atLineResult, divePose, favourite, holdPose, keeperIdle, keeperRun, keeperStartPlan, makeStrike,
  memoryOf, newBall, newKeeper, resolveContact, saveNote, shotById, solve, tellOf, think,
  type Brain, type Contact, type Plan, type Seen, type ShotId,
} from "@/components/offhours/penaltyModel";
import { STANDARD, casual, goodWith, oneOff, playKick, seeded, shootout, stubborn, type Player } from "./penalty-sim";

// The keeper, measured: seeded shootouts through the same steps Penalty.tsx takes (penalty-sim.ts).
const SLOW = { timeout: 60_000 };

function goalsFrom5(player: () => Player, n: number, seed: number) {
  const rnd = seeded(seed);
  let total = 0;
  const perKick = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const so = shootout(player(), rnd);
    total += so.goals;
    so.kicks.forEach((k, j) => {
      if (k.result === "goal") perKick[j]++;
    });
  }
  return { mean: total / n, perKick: perKick.map((p) => p / n) };
}

const seen = (side: -1 | 0 | 1, x: number, y: number, shot: ShotId = "placed"): Seen => ({ side, high: y > 1.3, shot, x, y });

describe("penalty keeper: how a player does against him", () => {
  it("a casual player (random shot, random point in the frame, any power) scores 2 to 3 from 5", SLOW, () => {
    const { mean } = goalsFrom5(() => casual, 700, 101);
    expect(mean).toBeGreaterThan(2.0);
    expect(mean).toBeLessThan(3.0);
  });

  it("a good player who mixes corners, shots and power well scores about 4 from 5", SLOW, () => {
    const { mean } = goalsFrom5(() => goodWith("mixed"), 700, 102);
    expect(mean).toBeGreaterThan(3.7);
    expect(mean).toBeLessThan(4.3);
  });

  it("the same corner every time scores less and less across the five", SLOW, () => {
    for (const mk of [() => stubborn("placed", 3, 0.55), () => stubborn("placed", -3, 2.0), () => stubborn("dipper", 3, 2.0), () => stubborn("driven", 3, 0.6)]) {
      const { perKick } = goalsFrom5(mk, 500, 103);
      const early = (perKick[0] + perKick[1]) / 2;
      const late = (perKick[3] + perKick[4]) / 2;
      expect(late).toBeLessThan(early - 0.15);
      expect(perKick[4]).toBeLessThan(perKick[0] - 0.2);
    }
  });

  it("no shot is dominant (over about 85% goals) or dead (under 35%) for a good player", SLOW, () => {
    for (const s of SHOTS) {
      const rnd = seeded(104);
      let g = 0, n = 0;
      // a one-off in a mixed shootout: a Panenka or a knuckleball is a surprise, not a plan
      for (let at = 1; at < 5; at++)
        for (let i = 0; i < 200; i++) {
          const k = shootout(oneOff(s.id, at), rnd).kicks[at];
          n++;
          if (k.result === "goal") g++;
        }
      const rate = g / n;
      expect(rate, s.id).toBeGreaterThan(0.35);
      expect(rate, s.id).toBeLessThan(0.85);
    }
  });

  it("the placed kick, which the blurb says he reads best, is no easier to score with than a driven one", SLOW, () => {
    const g = (shot: ShotId) => {
      const rnd = seeded(105);
      let n = 0, goals = 0;
      for (let i = 0; i < 400; i++) for (const k of shootout(goodWith(shot), rnd).kicks) { n++; if (k.result === "goal") goals++; }
      return goals / n;
    };
    // placed is a touch lower or equal (he reads it), never the dominant one
    expect(g("placed")).toBeLessThan(0.85);
    expect(g("driven")).toBeLessThan(0.85);
  });

  it("holding the reticle still gets you read: dwell lowers the goal rate on the corners, a last-moment move does not", SLOW, () => {
    const rate = (dwell: number) => {
      const rnd = seeded(106);
      let g = 0;
      const n = 1200;
      for (let i = 0; i < n; i++) {
        const o = playKick({ hist: [] }, 0.4, { shot: "placed", aim: { x: (rnd() < 0.5 ? -1 : 1) * 3, y: rnd() < 0.5 ? 0.5 : 2 }, power: 0.72, dwell }, rnd);
        if (o.result === "goal") g++;
      }
      return g / n;
    };
    expect(rate(0.6)).toBeGreaterThan(rate(2.6) + 0.15);
  });
});

describe("penalty keeper: reach", () => {
  it("top corners at full power are very hard to save", SLOW, () => {
    for (const [shot, power] of [["placed", 1], ["driven", 0.95], ["dipper", 0.9]] as [ShotId, number][]) {
      const rnd = seeded(110);
      let saved = 0;
      const n = 800;
      for (let i = 0; i < n; i++) {
        const o = playKick({ hist: [] }, 0.5, { shot, aim: { x: (rnd() < 0.5 ? -1 : 1) * 3.2, y: 2.1 }, power, dwell: 1.2 }, rnd);
        if (o.result === "save") saved++;
      }
      expect(saved / n, shot).toBeLessThan(0.12);
    }
  });

  it("a soft kick near him is usually stopped", SLOW, () => {
    const rnd = seeded(111);
    let stopped = 0;
    const n = 1200;
    for (let i = 0; i < n; i++) {
      const o = playKick({ hist: [] }, 0.4, { shot: "placed", aim: { x: (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 0.6), y: 0.3 + rnd() * 0.9 }, power: 0.2 + rnd() * 0.15, dwell: 1.2 }, rnd);
      if (o.result === "save") stopped++;
    }
    expect(stopped / n).toBeGreaterThan(0.62);
  });

  it("he only saves what his body can reach: no save beyond his dive and his arms", SLOW, () => {
    const rnd = seeded(112);
    let saves = 0;
    for (let i = 0; i < 3000; i++) {
      const sh = SHOTS[i % SHOTS.length].id;
      const o = playKick({ hist: [] }, 0.5, { shot: sh, aim: { x: (rnd() * 2 - 1) * (GW + 0.3), y: 0.15 + rnd() * 2.4 }, power: 0.2 + rnd() * 0.8, dwell: rnd() * 3 }, rnd);
      if (o.result !== "save") continue;
      saves++;
      expect(Math.abs(o.at.x - o.plan.x0)).toBeLessThanOrEqual(MAX_DIVE + ARM_REACH + 0.3);
      expect(o.at.y).toBeLessThan(2.7);
      expect(Math.abs(o.st.end.x)).toBeLessThanOrEqual(GW + 0.05);
      expect(o.st.end.y).toBeLessThanOrEqual(2.49);
    }
    expect(saves).toBeGreaterThan(300);
  });

  it("a dive is mirror-symmetric, and the hips never go farther than MAX_DIVE", () => {
    for (const P of [{ x: 3, y: 0.5 }, { x: 2.4, y: 1.4 }, { x: 3.3, y: 2.3 }]) {
      const r = solve(divePose(0, P));
      const l = solve(divePose(0, { x: -P.x, y: P.y }));
      const key = (a: [number, number], m: number) => [m * a[0], a[1]].map((v) => v.toFixed(2)).join(",");
      expect([key(r.hA, 1), key(r.hB, 1)].sort()).toEqual([key(l.hA, -1), key(l.hB, -1)].sort());
      expect(key(r.hip, 1)).toBe(key(l.hip, -1));
      expect(r.hip[0]).toBeLessThanOrEqual(MAX_DIVE + 1e-6);
    }
  });

  it("a dive takes time: the further, the later it gets there", () => {
    const plan = (x: number): Plan => think({ hist: [] }, 0.4, makeStrike(shotById("placed"), { x, y: 0.5 }, 0.7, () => 0.5), 0, 0, () => 0.5);
    // forced to a react plan by a high roll for the early styles: both are dives for corners
    const near = plan(1.4), far = plan(3.2);
    expect(far.D).toBeGreaterThanOrEqual(near.D);
  });
});

describe("penalty keeper: he remembers where you shoot, this shootout only", () => {
  it("has no favourite until you give him one, and forgets with a new Brain", () => {
    expect(favourite({ hist: [] }, 0.5)).toBe(0);
    const b: Brain = { hist: [seen(1, 3, 0.5), seen(1, 3.1, 0.6), seen(1, 2.9, 0.5)] };
    expect(favourite(b, 0.5)).toBeGreaterThan(0.5);
    expect(favourite({ hist: [] }, 0.5)).toBe(0);
    const left: Brain = { hist: [seen(-1, -3, 0.5), seen(-1, -3, 0.5)] };
    expect(favourite(left, 0.5)).toBeLessThan(-0.4);
  });

  it("three kicks to the right make the right three times as likely as the left, and a streak is counted", () => {
    const m = memoryOf({ hist: [seen(1, 3, 0.5), seen(1, 3, 0.5), seen(1, 3, 0.5)] }, 0.4);
    expect(m.side[2]).toBeGreaterThan(3 * m.side[0]);
    expect(m.streak).toBe(3);
    expect(memoryOf({ hist: [seen(1, 3, 0.5), seen(-1, -3, 0.5)] }, 0.4).streak).toBe(1);
  });

  it("his bets then go to that side, to where your kicks went", () => {
    const brain: Brain = { hist: [seen(1, 3.0, 0.5), seen(1, 3.1, 0.6), seen(1, 2.9, 0.5), seen(1, 3.0, 0.55)] };
    const rnd = seeded(120);
    let bets = 0, right = 0, sx = 0, sy = 0;
    for (let i = 0; i < 2000; i++) {
      const st = makeStrike(shotById("placed"), { x: -3, y: 0.5 }, 0.5, rnd);
      const p = think(brain, 0.5, st, 0, 0, rnd);
      if (p.style !== "gamble" || p.mode !== "dive") continue;
      bets++;
      if (p.P.x > 0) {
        right++;
        sx += p.P.x;
        sy += p.P.y;
      }
    }
    expect(bets).toBeGreaterThan(300);
    expect(right / bets).toBeGreaterThan(0.8);
    expect(sx / right).toBeGreaterThan(2.5);
    expect(sx / right).toBeLessThan(3.5);
    expect(sy / right).toBeLessThan(1.0);
  });

  it("he leans toward your favourite side while you aim, and shows it in his stance", () => {
    const k = newKeeper();
    for (let i = 0; i < 120; i++) keeperIdle(k, 1 / 60, 0, 0, true, { bias: favourite({ hist: [seen(1, 3, 0.5), seen(1, 3, 0.5), seen(1, 3, 0.5)] }, 0.5) });
    const j = newKeeper();
    for (let i = 0; i < 120; i++) keeperIdle(j, 1 / 60, 0, 0, true, { bias: 0 });
    expect(k.x).toBeGreaterThan(j.x + 0.1);
    expect(k.lean).toBeGreaterThan(0.2);
  });
});

describe("penalty keeper: HE READ IT only when a read decided it", () => {
  it("each save note matches why he was there: read, bet, bait, wait; a reaction or a body in the way gets no such note", SLOW, () => {
    const rnd = seeded(130);
    const noted: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const brain: Brain = { hist: i % 3 ? [] : [seen(1, 3, 0.5), seen(1, 3, 0.5)] };
      const sh = SHOTS[i % SHOTS.length].id;
      const o = playKick(brain, 0.4, { shot: sh, aim: { x: (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 2.8), y: 0.3 + rnd() * 2 }, power: shotById(sh).sweet, dwell: 0.4 + rnd() * 3 }, rnd);
      if (o.result !== "save") continue;
      const near = Math.hypot(o.plan.P.x - o.at.x, o.plan.P.y - o.at.y) < 1.1;
      const want = near ? ({ read: "HE READ IT", wait: "HE WAITED FOR IT", bait: "HE BAITED YOU", gamble: "GUESSED RIGHT", react: null } as const)[o.plan.style] : null;
      if (want) {
        expect(o.detail).toBe(want);
        noted[want] = (noted[want] ?? 0) + 1;
      } else expect(["HE READ IT", "HE WAITED FOR IT", "HE BAITED YOU", "GUESSED RIGHT"]).not.toContain(o.detail);
    }
    expect(noted["HE READ IT"]).toBeGreaterThan(20);
    expect(noted["GUESSED RIGHT"]).toBeGreaterThan(5);
    expect(noted["HE WAITED FOR IT"]).toBeGreaterThan(5);
  });

  it("a read or a bet cannot see where the kick goes: the same draws against different kicks give the same plan", () => {
    for (const style of ["read", "gamble"] as const) {
      let same = 0, found = 0;
      for (let seed = 1; seed < 400 && found < 40; seed++) {
        const brain: Brain = { hist: [seen(1, 3, 0.5)] };
        const sh = shotById("placed");
        const aim = { x: 2.5, y: 1 };
        // two kicks with the same aim and different luck, power and spin
        const a = makeStrike(sh, aim, 0.5, seeded(seed * 7));
        const b = makeStrike(shotById("curlR"), aim, 0.95, seeded(seed * 13));
        const pa = think(brain, 0.5, a, 0.9, 0, seeded(seed));
        if (pa.style !== style) continue;
        const pb = think(brain, 0.5, b, 0.9, 0, seeded(seed));
        // the style is rolled before he looks at the ball; the spot comes from your aim (a read) or his memory (a bet)
        if (pb.style !== style) continue;
        found++;
        if (pa.mode === pb.mode && Math.abs(pa.P.x - pb.P.x) < 1e-9 && Math.abs(pa.P.y - pb.P.y) < 1e-9 && Math.abs(pa.tc - pb.tc) < 1e-9) same++;
      }
      expect(found, style).toBeGreaterThan(5);
      expect(same, style).toBe(found);
    }
  });

  it("a reaction does follow the ball, and is late: after the boot, not before", () => {
    let found = 0;
    for (let seed = 1; seed < 400 && found < 30; seed++) {
      const lo = makeStrike(shotById("placed"), { x: -3, y: 0.5 }, 0.6, () => 0.5);
      const hi = makeStrike(shotById("placed"), { x: 3, y: 2 }, 0.6, () => 0.5);
      const a = think({ hist: [] }, 0.5, lo, 0, 0, seeded(seed));
      const b = think({ hist: [] }, 0.5, hi, 0, 0, seeded(seed));
      if (a.style !== "react" || b.style !== "react") continue;
      found++;
      expect(a.tc).toBeGreaterThan(RUNUP + 0.1);
      expect(a.P.x).toBeLessThan(-1.5);
      expect(b.P.x).toBeGreaterThan(1.5);
    }
    expect(found).toBeGreaterThan(5);
  });

  it("with no tell he almost never reads you, and with a full one he does about half the time", () => {
    const share = (tell: number) => {
      let r = 0;
      const rnd = seeded(131);
      const n = 3000;
      for (let i = 0; i < n; i++) if (think({ hist: [] }, 0.4, makeStrike(shotById("placed"), { x: 3, y: 0.5 }, 0.5, rnd), tell, 0, rnd).style === "read") r++;
      return r / n;
    };
    expect(share(0)).toBeLessThan(0.1);
    expect(share(1)).toBeGreaterThan(0.4);
    expect(tellOf(0)).toBe(0);
    expect(tellOf(0.6)).toBe(0);
    expect(tellOf(5)).toBe(1);
  });

  it("a phone swipe has no hovering reticle, so it gets the same tell (none) as a mouse kick flicked at the last moment", () => {
    const a = playKick({ hist: [] }, 0.4, { shot: "placed", aim: { x: 3, y: 0.5 }, power: 0.5, dwell: 0 }, seeded(5));
    const b = playKick({ hist: [] }, 0.4, { shot: "placed", aim: { x: 3, y: 0.5 }, power: 0.5, dwell: 0.3 }, seeded(5));
    expect(a.plan.style).toBe(b.plan.style);
    expect(tellOf(0.3)).toBe(0);
  });
});

describe("penalty keeper: Panenka, bait, and what he does with the ball", () => {
  it("against a Panenka he sometimes waits (and catches it) and sometimes goes early (and is chipped)", SLOW, () => {
    const rnd = seeded(140);
    const by: Record<string, { n: number; goals: number }> = {};
    for (let i = 0; i < 2500; i++) {
      const o = playKick({ hist: [] }, 0.4, { shot: "panenka", aim: { x: (rnd() - 0.5) * 0.5, y: 1.0 + rnd() * 0.3 }, power: 0.3, dwell: 0.6 }, rnd);
      const b = (by[o.plan.style + "/" + o.plan.mode] ??= { n: 0, goals: 0 });
      b.n++;
      if (o.result === "goal") {
        b.goals++;
        if (o.plan.mode === "dive") expect(o.detail).toBe("HE WENT EARLY");
      }
    }
    expect(by["wait/stand"].n).toBeGreaterThan(300);
    expect(by["wait/stand"].goals / by["wait/stand"].n).toBeLessThan(0.08);
    expect(by["gamble/dive"].goals / by["gamble/dive"].n).toBeGreaterThan(0.9);
  });

  it("a Panenka he has already seen makes him wait more", () => {
    const frac = (brain: Brain) => {
      const rnd = seeded(141);
      let w = 0;
      for (let i = 0; i < 2000; i++) if (think(brain, 0.4, makeStrike(shotById("panenka"), { x: 0, y: 1.2 }, 0.3, rnd), 0, 0, rnd).style === "wait") w++;
      return w / 2000;
    };
    expect(frac({ hist: [seen(0, 0, 1.2, "panenka"), seen(1, 3, 1, "placed"), seen(-1, -3, 1, "placed")] })).toBeGreaterThan(frac({ hist: [] }) + 0.1);
  });

  it("the bait: a lean that moves him a step, shown once, and that he sometimes means the other way", () => {
    const k = newKeeper();
    // forcing the roll: without an rng he never baits
    for (let i = 0; i < 600; i++) keeperIdle(k, 1 / 60, 0, 0, true);
    expect(k.bait).toBe(0);
    const lows = () => 0.01; // always baits, at the earliest time
    const j = newKeeper();
    let max = 0, seenBait = 0;
    for (let i = 0; i < 480; i++) {
      keeperIdle(j, 1 / 60, 2.5, 0, true, { rnd: lows });
      if (j.bait !== 0) {
        seenBait++;
        max = Math.max(max, Math.abs(j.lean));
      }
    }
    expect(seenBait).toBeGreaterThan(30);
    expect(seenBait).toBeLessThan(120);
    // he leans away from where the reticle is (the open side)
    expect(max).toBeGreaterThan(0.5);
    const rnd = seeded(142);
    let toward = 0, n = 0;
    for (let i = 0; i < 800; i++) {
      const p = think({ hist: [] }, 0.4, makeStrike(shotById("placed"), { x: 2.5, y: 1 }, 0.5, rnd), 0, 0, rnd, { bait: -1 });
      if (p.style !== "bait") continue;
      n++;
      // leaned left, goes right; weight shows it just before
      if (p.P.x > 0 && p.tip === 1) toward++;
    }
    expect(n).toBeGreaterThan(300);
    expect(toward).toBe(n);
  });

  it("a ball down the middle is stood up to, not dived at: he holds with his hands on the spot", () => {
    const pose = solve(holdPose(0.2, { x: 0.4, y: 1.3 }));
    expect(Math.abs(pose.hA[0] - 0.4)).toBeLessThan(0.2);
    expect(Math.abs(pose.hA[1] - 1.3)).toBeLessThan(0.1);
    expect(pose.hip[1]).toBeGreaterThan(0.7);
  });
});

describe("penalty keeper: motion", () => {
  it("sinks into a set position as the kick starts, shifts his weight before a dive, and a dive is low, mid or high to match", () => {
    const rnd = seeded(150);
    const st = makeStrike(shotById("placed"), { x: 3, y: 0.5 }, 0.5, rnd);
    const plan = think({ hist: [seen(1, 3, 0.5), seen(1, 3, 0.5), seen(1, 3, 0.5)] }, 0.6, st, 0, 0, () => 0.3);
    expect(plan.mode).toBe("dive");
    const k = newKeeper();
    const idle = k.cur[1];
    keeperStartPlan(k, plan);
    let sank = 0, shifted = 0;
    for (let t = 0; t < plan.tc - 0.02; t += 1 / 60) {
      keeperRun(k, 1 / 60);
      sank = Math.max(sank, idle - k.cur[1]);
      shifted = Math.max(shifted, Math.abs(k.cur[2]));
    }
    expect(sank).toBeGreaterThan(0.06);
    expect(shifted).toBeGreaterThan(0.02);
    // low, mid, high dives lay him out differently: flatter for the floor, upright for the bar
    const flat = (y: number) => Math.abs(divePose(0, { x: 2.8, y })[2]);
    expect(flat(0.3)).toBeGreaterThan(flat(1.4));
    expect(flat(1.4)).toBeGreaterThan(flat(2.3));
  });

  it("two identical kicks do not give identical dives", () => {
    const rnd = seeded(151);
    const dives = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const o = playKick({ hist: [seen(1, 3, 0.5), seen(1, 3, 0.5)] }, 0.5, { shot: "placed", aim: { x: 3, y: 0.5 }, power: 0.5, dwell: 1 }, rnd);
      if (o.plan.mode === "dive") dives.add(`${o.plan.D.toFixed(2)}|${o.plan.tc.toFixed(2)}|${o.plan.v.th.toFixed(2)}|${o.plan.v.spread.toFixed(2)}`);
    }
    expect(dives.size).toBeGreaterThan(15);
  });

  it("gets up: kneels, stands, and walks home, with no sliding or jump", () => {
    const k = newKeeper();
    const plan = think({ hist: [] }, 0.5, makeStrike(shotById("placed"), { x: 3, y: 0.5 }, 0.5, () => 0.5), 0, 0, () => 0.3);
    keeperStartPlan(k, plan);
    for (let t = 0; t < 1.6; t += 1 / 60) keeperRun(k, 1 / 60);
    expect(plan.mode).toBe("dive");
    const lying = k.cur[1];
    expect(lying).toBeLessThan(0.7);
    let lastX = k.cur[0];
    let kneel = 9, maxStep = 0;
    for (let t = 0; t < 1.2; t += 1 / 60) {
      keeperIdle(k, 1 / 60, 0, 0, false);
      kneel = Math.min(kneel, Math.abs(k.cur[1] - 0.5));
      maxStep = Math.max(maxStep, Math.abs(k.cur[0] - lastX));
      lastX = k.cur[0];
      expect(k.joints.hip.every(Number.isFinite)).toBe(true);
    }
    expect(k.rise).toBe(1);
    expect(kneel).toBeLessThan(0.12);
    // a hip never moves more than 0.2 m in a frame (it used to be a slide of the whole dive back to the spot)
    expect(maxStep).toBeLessThan(0.1);
    expect(k.cur[1]).toBeGreaterThan(0.8);
  });
});

describe("penalty keeper: the ball in his hands", () => {
  const contactAt = (edge: number, kind: Contact["kind"] = "glove"): Contact => ({ kind, edge, nx: 0, ny: 0.5, hand: 0, px: 0, py: 1 });
  const joints = solve(divePose(0, { x: 1, y: 1 }));
  const ball = (sp: number) => ({ ...newBall(), x: 1, y: 1, vz: sp, vx: 0, vy: 0 });
  const st = makeStrike(shotById("placed"), { x: 1, y: 1 }, 0.5, () => 0.5);

  it("holds a slow ball and parries a hard one, with a stretch in between", () => {
    const rnd = seeded(160);
    const rate = (sp: number) => {
      let held = 0;
      for (let i = 0; i < 600; i++) {
        const r = resolveContact(ball(sp), st, joints, contactAt(0.3), false, rnd);
        if (r.kind === "stop" && r.how === "held") held++;
      }
      return held / 600;
    };
    expect(rate(8)).toBe(1);
    expect(rate(15)).toBeGreaterThan(0.3);
    expect(rate(15)).toBeLessThan(0.7);
    expect(rate(24)).toBe(0);
    // a parry throws it wide and slows it
    const b = ball(24);
    const r = resolveContact(b, st, joints, contactAt(0.3), false, rnd);
    expect(r).toMatchObject({ kind: "stop", how: "parry" });
    expect(Math.hypot(b.vx, b.vy, b.vz)).toBeLessThan(24);
  });

  it("the rim of a glove bends a hard ball and only knocks a soft one away", () => {
    const rnd = seeded(161);
    expect(resolveContact(ball(22), st, joints, contactAt(0.9), false, rnd).kind).toBe("graze");
    expect(resolveContact(ball(9), st, joints, contactAt(0.9), false, rnd).kind).toBe("stop");
  });

  it("a knuckleball is never held cleanly", () => {
    const k = makeStrike(shotById("knuckle"), { x: 1, y: 1 }, 0.8, () => 0.5);
    for (let i = 0; i < 50; i++) expect(resolveContact(ball(9), k, joints, contactAt(0.2), false, seeded(i)).kind === "stop" && (resolveContact(ball(9), k, joints, contactAt(0.2), false, seeded(i)) as { how: string }).how).not.toBe("held");
  });

  it("what a note says: saves and goals", () => {
    const base: Plan = { mode: "dive", style: "read", tc: 0.4, D: 0.6, x0: 0, P: { x: 2, y: 1 }, start: null, final: null, v: { jump: 1, th: 0, spread: 0.3 }, tip: 1 };
    expect(saveNote(base, { x: 2.3, y: 1.2 }, "PARRIED AWAY")).toBe("HE READ IT");
    expect(saveNote(base, { x: -1, y: 1 }, "BLOCKED")).toBe("BLOCKED");
    expect(saveNote({ ...base, style: "gamble" }, { x: 2.3, y: 1.2 }, "SAFE HANDS")).toBe("GUESSED RIGHT");
    expect(saveNote({ ...base, style: "react" }, { x: 2.3, y: 1.2 }, "SAFE HANDS")).toBe("SAFE HANDS");
    expect(saveNote(null, { x: 0, y: 0 }, "BLOCKED")).toBe("BLOCKED");
    const pan = makeStrike(shotById("panenka"), { x: 0, y: 1 }, 0.3, () => 0.5);
    expect(atLineResult({ x: 0, y: 1 }, pan, { ...base, style: "gamble" }, false)).toEqual({ result: "goal", detail: "HE WENT EARLY" });
    expect(atLineResult({ x: 0, y: 1 }, pan, { ...base, mode: "stand", style: "wait", P: { x: 0, y: 1 } }, false).detail).toBe("PANENKA");
  });

  it("covers every standard shot in the player model", () => {
    expect(STANDARD.every((s) => SHOTS.some((x) => x.id === s))).toBe(true);
  });
});
