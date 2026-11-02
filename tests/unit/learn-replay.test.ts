import { describe, expect, it } from "vitest";
import { createRecorder, newPose, type Ghost } from "@/components/offhours/night/ghost";
import { FAST_RATE, Playback } from "@/components/offhours/learn/replay";
import { Session, type Res } from "@/components/offhours/learn/session";

/** a car that drives straight down the road at 20 m/s for `time` seconds */
function drive(time: number): Ghost {
  const rec = createRecorder(120);
  const p = newPose();
  for (let k = 0; k <= time * 20; k++) {
    p.s = 12 + k;
    p.speed = 20;
    rec.push(k / 20, p);
  }
  return rec.snapshot(time, false);
}

describe("playing a generation back", () => {
  it("is not over before it starts, and counts the cars still driving", () => {
    const pb = new Playback(true);
    expect(pb.over).toBe(false);
    pb.set([drive(30), drive(5), drive(12)]);
    pb.update(6);
    expect(pb.driving).toBe(2);
    pb.update(7);
    expect(pb.driving).toBe(1);
  });

  it("lasts as long as its new cars drive, not as long as an elite car does", () => {
    const pb = new Playback(true);
    // the best car is an elite on a 30 s lap, the new cars all crashed within 5 s
    pb.set([drive(30), drive(5), drive(3)], 0, [false, true, true]);
    pb.update(5);
    expect(pb.over).toBe(false);
    pb.update(2);
    expect(pb.over).toBe(true);
  });

  it("goes on while a new best car drives on", () => {
    const pb = new Playback(true);
    pb.set([drive(40), drive(5)], 0, [true, true]);
    pb.update(30);
    expect(pb.over).toBe(false);
    pb.update(11);
    expect(pb.over).toBe(true);
  });

  it("does not wait on a slow new car once the best car has stopped", () => {
    const pb = new Playback(true);
    pb.set([drive(10), drive(100)], 0, [true, true]);
    pb.update(12);
    expect(pb.over).toBe(false);
    pb.update(2);
    expect(pb.over).toBe(true);
  });

  it("treats every car as new unless told", () => {
    const pb = new Playback(true);
    pb.set([drive(20), drive(4)]);
    pb.update(15);
    expect(pb.over).toBe(false);
    pb.update(6);
    expect(pb.over).toBe(true);
  });

  it("draws the others as ghosts that go a moment after their run ends", () => {
    const pb = new Playback(true);
    pb.set([drive(20), drive(2), drive(10)]);
    const [a, b] = [pb.scene.ghosts[2], pb.scene.ghosts[3]];
    pb.update(1);
    expect(a.show).toBe(true);
    expect(b.show).toBe(true);
    expect(a.kind).toBe(2);
    pb.update(1.5);
    // one car stopped half a second ago: still there, fading
    expect(a.show).toBe(true);
    expect(a.alpha).toBeLessThan(1);
    pb.update(1);
    expect(a.show).toBe(false);
    expect(b.show).toBe(true);
    // the Night run's own two ghosts are never drawn here
    expect(pb.scene.ghosts[0].show).toBe(false);
    expect(pb.scene.ghosts[1].show).toBe(false);
  });

  it("puts the camera's car where the best car is, and starts over on a new set", () => {
    const pb = new Playback(true);
    pb.set([drive(20)]);
    pb.update(5);
    expect(pb.scene.car.s).toBeCloseTo(12 + 100, 0);
    pb.set([drive(20)]);
    expect(pb.t).toBe(0);
    expect(pb.scene.car.s).toBeCloseTo(12, 0);
  });

  describe("the 4x tail", () => {
    const play = (pb: Playback, fast: boolean) => {
      let frames = 0;
      while (!pb.over && frames < 100_000) {
        pb.update(0.05, fast);
        frames++;
      }
      return frames;
    };

    it("starts only once a long generation is down to a couple of cars, and only in Watch", () => {
      const slow = new Playback(true);
      slow.set([drive(60), drive(3)]);
      slow.update(14, true);
      expect(slow.rate).toBe(1);
      slow.update(2, true);
      slow.update(0.05, true);
      expect(slow.rate).toBe(FAST_RATE);
      // not in the skip replay, which does not ask for it
      const still = new Playback(true);
      still.set([drive(60)]);
      still.update(20);
      expect(still.rate).toBe(1);
      // three cars still driving: no
      const crowd = new Playback(true);
      crowd.set([drive(60), drive(50), drive(40)]);
      crowd.update(20, true);
      expect(crowd.rate).toBe(1);
      // and none after they have all stopped
      const done = new Playback(true);
      done.set([drive(20)]);
      done.update(21, true);
      expect(done.rate).toBe(1);
    });

    it("plays the same drives to the same end, in a quarter of the frames, and touches nothing it plays", () => {
      const cars = () => [drive(60), drive(3)];
      const data = cars().map((g) => Array.from(g.data));
      const a = new Playback(true);
      const b = new Playback(true);
      const ca = cars();
      const cb = cars();
      a.set(ca, 0, [true, true]);
      b.set(cb, 0, [true, true]);
      const slow = play(a, false);
      const fast = play(b, true);
      expect(fast).toBeLessThan(slow * 0.6);
      expect(b.scene.car.s).toBeCloseTo(a.scene.car.s, 6);
      expect(ca.map((g) => Array.from(g.data))).toEqual(data);
      expect(cb.map((g) => Array.from(g.data))).toEqual(data);
    });

    it("leaves what the session simulated alone: the same seed gives the same generations whether or not they were played fast", { timeout: 60_000 }, () => {
      const run = (fast: boolean) => {
        const s = new Session();
        const out: Res[] = [];
        s.post = (r) => out.push(r);
        s.request({ type: "start", seed: 5 });
        const stats: unknown[] = [];
        const pb = new Playback(true);
        for (let g = 0; g < 4; g++) {
          s.request({ type: "step", gens: 1, trace: true });
          while (s.work(1000));
          const r = out[out.length - 1];
          if (r.type !== "gen" || !r.cars) throw new Error("no generation");
          stats.push({ stat: r.stat, champion: r.champion, times: r.cars.map((c) => c.time), dists: r.cars.map((c) => c.dist) });
          pb.set(r.cars, 0, r.fresh);
          play(pb, fast);
        }
        return stats;
      };
      expect(run(true)).toEqual(run(false));
    });
  });
});
