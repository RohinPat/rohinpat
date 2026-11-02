import { describe, expect, it } from "vitest";
import { seeded } from "@/components/offhours/rng";
import { Evolution, PARAMS } from "@/components/offhours/learn/evolve";
import { N_HID, N_IN, N_OUT, N_W, forward, mutate, newHidden, randomGenome } from "@/components/offhours/learn/net";
import { CAP_SHARE, START_S, Run, fitnessOf, runGenome } from "@/components/offhours/learn/run";
import { newSenses, sense } from "@/components/offhours/learn/sense";
import { bestText, chartValue, clock } from "@/components/offhours/learn/chart";
import { newCar } from "@/components/offhours/night/car";
import { getRoad } from "@/components/offhours/night/road";
import { getTarget } from "@/components/offhours/night/target";

const road = getRoad();
const capS = getTarget().ghost.time * CAP_SHARE;

/** a net whose three outputs sit at fixed values (every weight zero but the output biases) */
function fixed(steer: number, gas: number, brake: number) {
  const w = new Float64Array(N_W);
  const o = N_HID * (N_IN + 1);
  w[o + N_HID] = steer;
  w[o + (N_HID + 1) + N_HID] = gas;
  w[o + 2 * (N_HID + 1) + N_HID] = brake;
  return w;
}

describe("the net", () => {
  it("has the shape the sizes say", () => {
    expect(N_IN).toBe(9);
    expect(N_OUT).toBe(3);
    expect(N_W).toBe(N_HID * (N_IN + 1) + N_OUT * (N_HID + 1));
    expect(randomGenome(seeded(1))).toHaveLength(N_W);
    expect(newSenses()).toHaveLength(N_IN);
  });

  it("answers within the controls' ranges, and nothing for zero weights", () => {
    const out = { steer: 9, throttle: 9, brake: 9, hand: 9 };
    const x = new Float64Array(N_IN).fill(1.5);
    forward(new Float64Array(N_W), x, newHidden(), out);
    expect(out).toEqual({ steer: 0, throttle: 0, brake: 0, hand: 0 });
    const rng = seeded(5);
    for (let k = 0; k < 50; k++) {
      forward(randomGenome(rng, 3), x, newHidden(), out);
      expect(Math.abs(out.steer)).toBeLessThanOrEqual(1);
      expect(out.throttle).toBeGreaterThanOrEqual(0);
      expect(out.throttle).toBeLessThanOrEqual(1);
      expect(out.brake).toBeGreaterThanOrEqual(0);
      expect(out.brake).toBeLessThanOrEqual(1);
      expect(out.hand).toBe(0);
    }
  });

  it("reads its outputs off the biases", () => {
    const out = { steer: 0, throttle: 0, brake: 0, hand: 0 };
    forward(fixed(2, 2, -2), new Float64Array(N_IN), newHidden(), out);
    expect(out.steer).toBeCloseTo(Math.tanh(2), 9);
    expect(out.throttle).toBeCloseTo(Math.tanh(2), 9);
    expect(out.brake).toBe(0);
  });
});

describe("what a learner sees", () => {
  it("is nine bounded numbers, and zero across the road on the line", () => {
    const c = newCar(START_S, 0);
    const x = sense(c, road, newSenses());
    expect(x).toHaveLength(N_IN);
    expect(x[1]).toBe(0);
    for (const v of Array.from(x)) expect(Math.abs(v)).toBeLessThanOrEqual(2);
    // far across the road, and fast, reads as such
    c.lat = 4;
    c.u = 40;
    const y = sense(c, road, newSenses());
    expect(y[1]).toBeGreaterThan(0.5);
    expect(y[0]).toBeGreaterThan(x[0]);
  });

  it("sees the bend coming: more of it on the way into the first corner than on the opening straight", () => {
    const straight = sense(newCar(60, 0), road, newSenses());
    const corner = sense(newCar(480, 0), road, newSenses());
    expect(corner[8]).toBeGreaterThan(straight[8]);
  });
});

describe("mutation and breeding", () => {
  it("is the same for the same seed, and different for another", () => {
    const parent = randomGenome(seeded(3));
    const a = mutate(parent, 0.3, 0.2, seeded(9));
    const b = mutate(parent, 0.3, 0.2, seeded(9));
    const c = mutate(parent, 0.3, 0.2, seeded(10));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    // the parent is not touched, and the child differs from it
    expect(Array.from(parent)).toEqual(Array.from(randomGenome(seeded(3))));
    expect(Array.from(a)).not.toEqual(Array.from(parent));
  });

  it("always moves at least one weight", () => {
    const parent = randomGenome(seeded(1));
    expect(Array.from(mutate(parent, 0.3, 0, seeded(2)))).not.toEqual(Array.from(parent));
  });

  it("keeps the elite as they were and the population the same size", () => {
    const ev = new Evolution(4);
    expect(ev.pop).toHaveLength(PARAMS.pop);
    const before = ev.pop.slice();
    const fits = before.map((_, i) => (i * 37) % 24);
    const order = ev.breed(fits);
    expect(ev.pop).toHaveLength(PARAMS.pop);
    for (let i = 0; i < PARAMS.elite; i++) expect(ev.pop[i]).toBe(before[order[i]]);
    expect(ev.gen).toBe(1);
  });

  it("gives the same generations for the same seed", () => {
    const a = new Evolution(6);
    const b = new Evolution(6);
    for (let g = 0; g < 3; g++) {
      const fits = a.pop.map((_, i) => Math.sin(i + g * 7) * 100);
      a.breed(fits);
      b.breed(fits.slice());
    }
    expect(a.pop.map((w) => Array.from(w))).toEqual(b.pop.map((w) => Array.from(w)));
    expect(a.sigma).toBe(b.sigma);
    const other = new Evolution(7);
    expect(Array.from(other.pop[0])).not.toEqual(Array.from(a.pop[0]));
  });

  it("opens the mutation up when the best stops improving, and closes it while it does", () => {
    const ev = new Evolution(2);
    const fits = ev.pop.map((_, i) => i);
    ev.breed(fits);
    const s1 = ev.sigma;
    ev.breed(ev.pop.map(() => 0));
    expect(ev.sigma).toBeGreaterThan(s1);
    ev.breed(ev.pop.map((_, i) => 1000 + i));
    expect(ev.sigma).toBeLessThan(PARAMS.sigmaMax);
  });
});

describe("fitness", () => {
  const o = (dist: number, meanSpeed = 20, time = 60, finished = false) => ({ dist, meanSpeed, time, finished });

  it("puts further ahead of shorter", () => {
    expect(fitnessOf(o(1200), road, capS)).toBeGreaterThan(fitnessOf(o(900), road, capS));
  });

  it("puts a faster finish ahead of a slower one, and any finish ahead of a run that did not", () => {
    const quick = fitnessOf(o(3668, 30, 120, true), road, capS);
    const slow = fitnessOf(o(3668, 20, 180, true), road, capS);
    const short = fitnessOf(o(3660, 60, 100, false), road, capS);
    expect(quick).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(short);
  });

  it("gives a little for speed when two runs got equally far", () => {
    expect(fitnessOf(o(1000, 30), road, capS)).toBeGreaterThan(fitnessOf(o(1000, 20), road, capS));
  });
});

describe("a run", () => {
  it("ends at the rail when the wheel is held over", () => {
    const r = runGenome(fixed(5, 3, 0), road, capS);
    expect(r.why).toBe("rail");
    expect(r.car.scrape).toBe(true);
    expect(r.outcome().finished).toBe(false);
    expect(r.t).toBeLessThan(30);
  });

  it("ends as a stall for a car that never moves, after about two seconds", () => {
    const r = runGenome(fixed(0, 0, 0), road, capS);
    expect(r.why).toBe("stall");
    expect(r.t).toBeGreaterThan(2);
    expect(r.t).toBeLessThan(2.1);
    expect(r.outcome().dist).toBeLessThan(1);
  });

  it("ends at the cap", () => {
    const r = runGenome(fixed(0, 3, 0), road, 1);
    expect(r.why).toBe("cap");
    expect(r.t).toBeCloseTo(1, 1);
  });

  it("is the same run every time, and records a ghost when asked", () => {
    const w = randomGenome(seeded(8));
    const a = runGenome(w, road, capS, true);
    const b = runGenome(w, road, capS);
    expect(a.outcome()).toEqual(b.outcome());
    const g = a.ghost();
    expect(g).not.toBeNull();
    expect(g?.finished).toBe(false);
    expect(g?.time).toBeCloseTo(a.t, 6);
    expect(b.ghost()).toBeNull();
  });

  it("can be driven in pieces", () => {
    const w = randomGenome(seeded(8));
    const r = new Run(w, road, capS);
    let n = 0;
    while (!r.advance(100)) n++;
    expect(n).toBeGreaterThan(0);
    expect(r.outcome()).toEqual(runGenome(w, road, capS).outcome());
  });
});

describe("learning the canyon", () => {
  // five seeds, each until its best car has finished and twenty generations beyond; the first finish is
  // required inside 60 generations for at least four of them
  it("finishes the road within 60 generations, and gets quicker after", { timeout: 90_000 }, () => {
    const firsts: number[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const ev = new Evolution(seed);
      let first = -1;
      let firstTime = 0;
      let bestTime = Infinity;
      let g = 0;
      while (g < 70 && (first < 0 || g < first + 20)) {
        const outs = ev.pop.map((w) => runGenome(w, road, capS).outcome());
        const order = ev.breed(outs.map((x) => x.fitness));
        const top = outs[order[0]];
        g++;
        if (top.finished) {
          if (first < 0) {
            first = g;
            firstTime = top.time;
          }
          bestTime = Math.min(bestTime, top.time);
        }
      }
      firsts.push(first);
      if (first > 0) expect(bestTime).toBeLessThanOrEqual(firstTime);
    }
    expect(firsts.filter((f) => f > 0 && f <= 60).length).toBeGreaterThanOrEqual(4);
  });
});

describe("what the page shows", () => {
  it("draws a finish above any distance, and a quicker finish above a slower", () => {
    const len = road.finish;
    const far = chartValue(len - START_S + 300, len, capS);
    const slow = chartValue(fitnessOf({ dist: len - START_S, meanSpeed: 20, time: 180, finished: true }, road, capS), len, capS);
    const quick = chartValue(fitnessOf({ dist: len - START_S, meanSpeed: 30, time: 120, finished: true }, road, capS), len, capS);
    expect(far).toBeLessThanOrEqual(0.7);
    expect(slow).toBeGreaterThanOrEqual(0.7);
    expect(quick).toBeGreaterThan(slow);
    expect(quick).toBeLessThanOrEqual(1);
    expect(chartValue(0, len, capS)).toBe(0);
  });

  it("writes the best so far", () => {
    expect(clock(161.3)).toBe("2:41.3");
    expect(clock(59.96)).toBe("1:00.0");
    expect(bestText(null)).toBe("BEST -");
    expect(bestText({ finished: false, time: 20, dist: 1234 })).toBe("BEST 1.2 KM");
    expect(bestText({ finished: true, time: 134.4, dist: 3668 })).toBe("BEST 2:14.4");
  });
});
