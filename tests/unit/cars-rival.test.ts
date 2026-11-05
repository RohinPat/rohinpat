import { describe, expect, it } from "vitest";
import { getTarget } from "@/components/offhours/night/target";
import { ghostLine } from "@/components/offhours/night/hud";
import { Attract } from "@/components/offhours/night/attract";
import { NightGame, forgetBestRun } from "@/components/offhours/night/game";
import { BOTS, playRun, type RunStat } from "./cars-bots";

// The rival: the ghost on the road is a faster run of the target driver, and its pace is set from the scripted drivers. These pin
// how often each of them beats it (the finish time on the car against the ghost's, no penalties), and that the decent driver
// is within three seconds of it for most of the run. 16 seeded runs of each driver, with the assist Light and Off.

const bot = (name: string) => BOTS.find((b) => b.name === name)!;
const runs = (name: string, track: "canyon" | "climb", assist: 0 | 1) =>
  Array.from({ length: 16 }, (_, i) =>
    playRun(bot(name), i + 1, (g) => {
      if (track === "climb") g.setTrack("climb");
      g.assist = assist;
    }),
  );
const beats = (rs: RunStat[], time: number) => rs.filter((r) => r.finished && r.time < time).length / rs.length;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("the rival, against the scripted drivers", { timeout: 120_000 }, () => {
  for (const track of ["canyon", "climb"] as const) {
    for (const assist of [1, 0] as const) {
      it(`${track}, assist ${assist === 1 ? "Light" : "Off"}: the cautious driver rarely beats it, the decent one about as often as not, the precise and the drifting ones mostly do`, () => {
        const time = getTarget(track).rival.time;
        const by = Object.fromEntries(["cautious", "decent", "precise", "drifter"].map((n) => [n, runs(n, track, assist)]));
        expect(beats(by.cautious, time)).toBeLessThanOrEqual(0.2);
        expect(beats(by.decent, time)).toBeGreaterThanOrEqual(0.25);
        expect(beats(by.decent, time)).toBeLessThanOrEqual(0.55);
        expect(beats(by.precise, time)).toBeGreaterThanOrEqual(0.4);
        expect(beats(by.precise, time)).toBeLessThanOrEqual(0.95);
        expect(beats(by.drifter, time)).toBeGreaterThanOrEqual(0.7);
        // a rival to see, lose and catch: the decent driver is within 3 s of it for most of the run, and it is on the road ahead for a good share
        expect(mean(by.decent.map((r) => r.nearFrac))).toBeGreaterThan(0.8);
        expect(mean(by.decent.map((r) => r.seenFrac))).toBeGreaterThan(0.25);
        // the gap the card reports is the clock on the car against the ghost's: no rail penalty in it
        for (const r of by.decent) if (r.finished) expect(r.vsGhost).toBeCloseTo(r.time - time, 1);
      });
    }
  }

  it("leaves the clock where it was: the start time and gate bonuses come from the target's run, not the rival's", () => {
    const t = getTarget();
    expect(t.rival.time).toBeLessThan(t.ghost.time * 0.85);
    expect(t.startS).toBe(21.5);
    expect(t.legT[7]).toBeCloseTo(t.ghost.time, 0);
  });
});

describe("the gap to the ghost", () => {
  it("is the live time gap at the same distance, with the clock on the car and nothing added for a rail", () => {
    forgetBestRun();
    const g = new NightGame(true);
    g.start();
    for (let i = 0; i < 60 * 16; i++) g.update(1 / 60, { steer: 0, throttle: 1, brake: 0, hand: 0 });
    expect(g.deltaOn).toBe(true);
    const before = g.deltaS;
    g.railS += 3;
    g.update(1 / 60, { steer: 0, throttle: 1, brake: 0, hand: 0 });
    expect(Math.abs(g.deltaS - before)).toBeLessThan(0.1);
    // and it is the rival that is drawn: its pose at the clock
    const rival = getTarget().rival;
    const at = Math.min(rival.n - 1, Math.round(g.clock * 20));
    expect(Math.abs(g.scene.ghosts[0].pose.s - rival.data[at * 7])).toBeLessThan(2);
    forgetBestRun();
  });

  it("is said on the end card as who was ahead and by how much, in a few words", () => {
    expect(ghostLine(-1.34)).toBe("1.3s AHEAD");
    expect(ghostLine(2.06)).toBe("2.1s BEHIND");
    expect(ghostLine(0.02)).toBe("LEVEL");
    expect(ghostLine(-12)).toBe("12.0s AHEAD");
  });

  it("is in the result of a finished run, and not of one that did not finish", () => {
    forgetBestRun();
    const g = new NightGame(true);
    g.start();
    for (let i = 0; i < 60 * 40 && g.phase !== "done"; i++) g.update(1 / 60, { steer: 0, throttle: 0, brake: 1, hand: 0 });
    forgetBestRun();
    expect(g.result?.finished).toBe(false);
    expect(g.result?.vsGhostS).toBeNull();
  });
});

describe("the tile replays the rival", () => {
  it("reads the rival's run", () => {
    const a = new Attract(true);
    expect(a.target.rival).toBe(getTarget().rival);
  });
});
