import { describe, expect, it } from "vitest";
import { getCourse } from "@/components/offhours/ski/course";
import { MISS_CAP, getPar, medalByTime, medalFor } from "@/components/offhours/ski/game";
import { DT, botInput, newBot, newRun, step, type BotTuck, type Input, type Run } from "@/components/offhours/ski/sim";

// The medals must not be handed out for sliding down the hill. Each run below
// is a scripted skier on the real course and physics.

const C = getCourse();

function ski(ctl: (s: Run, b: ReturnType<typeof newBot>) => Input) {
  const s = newRun();
  const b = newBot();
  const ev: Parameters<typeof step>[4] = [];
  for (let n = 0; !(s.finished && s.v < 0.2) && n < 120 * 400; n++) {
    ev.length = 0;
    step(s, C, DT, ctl(s, b), ev);
  }
  const total = s.finishT + s.pen;
  return { total, missed: s.missed, medal: medalFor(total, s.missed) };
}
const bot = (skill: number, tuck: BotTuck) => ski((s, b) => botInput(s, C, b, skill, tuck));

describe("powder medals", () => {
  it("sets par from a clean, tucking run", () => {
    const p = getPar();
    expect(p.gold).toBeLessThan(p.silver);
    expect(p.silver).toBeLessThan(p.bronze);
    // gold is within 10% of the best clean run, not of an easier one
    const clean = bot(1, "smart");
    expect(clean.missed).toBe(0);
    expect(p.gold).toBeCloseTo(clean.total * 1.1, 0);
  });

  it("gives no medal for no input", () => {
    const idle = ski(() => ({ steer: 0, tuck: false }));
    expect(idle.missed).toBeGreaterThan(MISS_CAP[2]);
    expect(idle.medal).toBe(0);
    expect(medalByTime(idle.total)).toBe(0);
    expect(ski(() => ({ steer: 0, tuck: true })).medal).toBe(0);
  });

  it("gives a held tuck with loose steering no better than silver", () => {
    for (const skill of [1, 0.92, 0.85]) {
      const r = bot(skill, "hold");
      expect(r.missed, `skill ${skill}`).toBeGreaterThan(MISS_CAP[0]);
      expect(r.medal === 0 || r.medal >= 2, `skill ${skill}`).toBe(true);
    }
  });

  it("gives a clean, carving run gold", () => {
    for (const tuck of ["smart", "auto"] as const) {
      const r = bot(1, tuck);
      expect(r.missed).toBe(0);
      expect(r.medal, tuck).toBe(1);
    }
  });

  it("lets a decent player reach silver", () => {
    // a run a few gates short of clean, tucking where it can
    const r = bot(0.95, "smart");
    expect(r.missed).toBeLessThanOrEqual(MISS_CAP[1]);
    expect(r.medal).toBe(2);
  });

  it("caps a medal by missed gates", () => {
    const p = { gold: 50, silver: 60, bronze: 70 };
    expect(medalFor(49, 0, p)).toBe(1);
    expect(medalFor(49, MISS_CAP[0], p)).toBe(1);
    expect(medalFor(49, MISS_CAP[0] + 1, p)).toBe(2);
    expect(medalFor(49, MISS_CAP[1] + 1, p)).toBe(3);
    expect(medalFor(49, MISS_CAP[2] + 1, p)).toBe(0);
    expect(medalFor(65, 0, p)).toBe(3);
    expect(medalFor(71, 0, p)).toBe(0);
  });
});
