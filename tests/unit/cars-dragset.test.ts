import { describe, expect, it } from "vitest";
import { DEFAULT_CONDS, LAUNCH, SET_RUNS, TREE_WAIT, WITHIN_PAR, dragConds, freshCar, launchBand, noteRun, parEt, setResult, stepDrag, treeTime, type DragConds } from "@/components/offhours/dragModel";
import { DRAG_BOTS, runDrag } from "./cars-dragbots";

// The drag strip as a best of three: a set's conditions, par under them, and what the set card says.

const bot = (name: string) => DRAG_BOTS.find((b) => b.name === name)!;
/** the runs of a set, driven by a bot under the set's conditions */
const playSet = (name: string, n: number, seed = 1) => {
  const cond = dragConds(n);
  const runs = Array.from({ length: SET_RUNS }, (_, i) => runDrag(bot(name), n * 10 + i + seed, undefined, undefined, cond));
  return { cond, runs, result: setResult(runs.map((r) => noteRun(r.car)), cond) };
};

describe("drag strip: the conditions of a set", () => {
  it("draw the same for the same counter (the counter, not the date, is the seed)", () => {
    for (let n = 0; n < 12; n++) expect(dragConds(n)).toEqual(dragConds(n));
  });

  it("differ from one set to the next: the launch band moves by a few hundred rpm and the tree's range changes", () => {
    for (let n = 1; n < 40; n++) {
      const a = dragConds(n - 1);
      const b = dragConds(n);
      expect(Math.abs(b.shift - a.shift)).toBeGreaterThanOrEqual(150);
      expect(`${b.treeMin}|${b.treeSpread}`).not.toBe(`${a.treeMin}|${a.treeSpread}`);
    }
    for (let n = 0; n < 40; n++) {
      const c = dragConds(n);
      expect(Math.abs(c.shift)).toBeGreaterThanOrEqual(150);
      expect(Math.abs(c.shift)).toBeLessThanOrEqual(300);
      expect(c.treeMin).toBeGreaterThanOrEqual(TREE_WAIT.min);
      expect(c.treeSpread).toBeGreaterThanOrEqual(0.3);
      expect(c.treeMin + c.treeSpread).toBeLessThanOrEqual(1.3);
    }
    // it is not one repeating pair: many different bands and ranges turn up
    expect(new Set(Array.from({ length: 40 }, (_, n) => dragConds(n).shift)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(Array.from({ length: 40 }, (_, n) => `${dragConds(n).treeMin}|${dragConds(n).treeSpread}`)).size).toBeGreaterThanOrEqual(10);
  });

  it("stay the same for all three runs of a set: the band and the tree's range are the set's, and the green waits inside the range", () => {
    for (const n of [0, 1, 2, 3]) {
      const cond = dragConds(n);
      const waits: number[] = [];
      for (const r of [0, 0.5, 0.999]) {
        const c = freshCar(null, cond);
        c.throttle = true;
        c.pedal = 1;
        const path: number[] = [];
        for (let i = 0; i < 120 && c.phase !== "tree"; i++) stepDrag(c, 1 / 120, i / 120, path, {}, () => r);
        expect(c.phase).toBe("tree");
        expect(c.cond).toBe(cond);
        expect(c.wait).toBeGreaterThanOrEqual(cond.treeMin);
        expect(c.wait).toBeLessThanOrEqual(cond.treeMin + cond.treeSpread);
        waits.push(c.wait);
      }
      expect(new Set(waits).size).toBe(3);
    }
  });

  it("move the band: a rev that is a launch in one set bogs or spins in another", () => {
    const launchAt = (rpm: number, cond: DragConds) => {
      const c = freshCar(null, cond);
      c.phase = "tree";
      c.wait = 0;
      c.tree = treeTime(c) - 0.001;
      c.rpm = rpm;
      // the green comes on the next step, with the revs where they were put
      stepDrag(c, 0.002, 0, [], {}, () => 0.5);
      return c.launch;
    };
    const up = { ...DEFAULT_CONDS, shift: 300 };
    const down = { ...DEFAULT_CONDS, shift: -300 };
    expect(launchBand(up).sweet).toBe(LAUNCH.sweet + 300);
    expect(launchBand(down).lo).toBe(LAUNCH.lo - 300);
    // 3300 is in the default band and under the raised one (bogged); 6700 is over the default band and in the raised one
    expect(launchAt(3300, DEFAULT_CONDS)).not.toBe("BOGGED");
    expect(launchAt(3300, up)).toBe("BOGGED");
    expect(launchAt(6700, DEFAULT_CONDS)).toBe("WHEELSPIN");
    expect(launchAt(6700, up)).not.toBe("WHEELSPIN");
    expect(launchAt(6300, down)).toBe("WHEELSPIN");
    expect(launchAt(launchBand(up).sweet, up)).toBe("PERFECT LAUNCH");
    expect(launchAt(launchBand(down).sweet, down)).toBe("PERFECT LAUNCH");
  });
});

describe("drag strip: par moves with the conditions", () => {
  it("is the same 10.33 with the old conditions, and a different number under others", () => {
    expect(parEt()).toBeCloseTo(10.33, 1);
    expect(parEt(DEFAULT_CONDS)).toBe(parEt());
    const pars = Array.from({ length: 12 }, (_, n) => parEt(dragConds(n)));
    expect(Math.max(...pars) - Math.min(...pars)).toBeGreaterThan(0.2);
    for (const p of pars) {
      expect(p).toBeGreaterThan(9.8);
      expect(p).toBeLessThan(11.2);
    }
    // a higher band is a grippier set (quicker), a lower one is slower
    expect(parEt({ ...DEFAULT_CONDS, shift: 300 })).toBeLessThan(parEt() - 0.1);
    expect(parEt({ ...DEFAULT_CONDS, shift: -300 })).toBeGreaterThan(parEt() + 0.1);
    // the tree's range changes the wait before the green, not the time from it
    expect(parEt({ ...DEFAULT_CONDS, treeMin: 0.55, treeSpread: 0.3 })).toBe(parEt());
  });

  it("is reached by a perfect bot in every set, and no sloppier bot gets there", () => {
    for (let n = 0; n < 24; n++) {
      const set = playSet("perfect", n);
      for (const r of set.runs) {
        expect(r.launch).toBe("PERFECT LAUNCH");
        expect(r.car.shifts.perfect).toBe(4);
        expect(Math.abs(r.et - parEt(set.cond))).toBeLessThan(0.06);
      }
      expect(set.result.off).toBeGreaterThan(-0.06);
      expect(set.result.off).toBeLessThan(0.06);
      expect(set.result.within).toBe(true);
      expect(set.result.tip).toBeNull();
      for (const name of ["early shifts", "hold throttle", "bogged", "misses green .3"]) expect(playSet(name, n).result.within).toBe(false);
    }
  });

  it("is read from the run's own conditions: a perfect run is on par in its set and well off the par of a quicker one", () => {
    const slow = dragConds(1);
    const run = runDrag(bot("perfect"), 3, undefined, undefined, slow);
    expect(run.et).toBeCloseTo(parEt(slow), 1);
    expect(Math.abs(run.et - parEt({ ...DEFAULT_CONDS, shift: 300 }))).toBeGreaterThan(0.1);
  });
});

describe("drag strip: the set card", () => {
  it("has the three times in order, the best one marked, and how far off par it was", () => {
    const set = playSet("good (human)", 2);
    const r = set.result;
    expect(r.ets).toHaveLength(SET_RUNS);
    expect(r.ets).toEqual(set.runs.map((x) => x.car.t));
    expect(r.best).toBe(Math.min(...r.ets));
    expect(r.ets[r.bestAt]).toBe(r.best);
    expect(r.par).toBe(parEt(set.cond));
    expect(r.off).toBeCloseTo(r.best - r.par, 10);
  });

  it("says within par at the threshold and not past it", () => {
    const runs = (t: number) => [{ ...noteRun(freshCar()), t, launch: "PERFECT LAUNCH", reaction: 0 }];
    const p = parEt();
    expect(setResult(runs(p + WITHIN_PAR - 0.01), DEFAULT_CONDS).within).toBe(true);
    expect(setResult(runs(p + WITHIN_PAR + 0.02), DEFAULT_CONDS).within).toBe(false);
    expect(setResult(runs(p - 0.02), DEFAULT_CONDS).within).toBe(true);
  });

  it("shows a sloppy bot why: the best run's first fault, set after set", () => {
    for (let n = 0; n < 6; n++) {
      expect(playSet("hold throttle", n).result.tip).toMatch(/TOO MANY REVS/);
      expect(playSet("bogged", n).result.tip).toMatch(/TOO FEW REVS/);
      expect(playSet("early shifts", n).result.tip).toMatch(/EARLY SHIFT/);
      expect(playSet("late shifts", n).result.tip).toMatch(/LATE SHIFT/);
      expect(playSet("misses green .6", n).result.tip).toMatch(/GET ON THE THROTTLE/);
      const human = playSet("good (human)", n).result;
      expect(human.tip).not.toBeNull();
      expect(human.off).toBeGreaterThan(0);
    }
  });

  it("takes the tip from the best run, not the worst", () => {
    const set = playSet("perfect", 0);
    const clean = noteRun(set.runs[0].car);
    const spun = { ...noteRun(runDrag(bot("hold throttle"), 2, undefined, undefined, set.cond).car) };
    // the spun run is slower, so the clean one is the best and nothing is blamed
    const r = setResult([spun, clean, spun], set.cond);
    expect(r.bestAt).toBe(1);
    expect(r.tip).toBeNull();
  });
});
