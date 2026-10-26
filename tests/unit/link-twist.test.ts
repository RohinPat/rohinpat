import { describe, expect, it } from "vitest";
import { ENGINE_CAL, createAxisSender, createThrottleTrack, engineStateData, parseEngineState, parseThrottle, pedalStep, rpmRate } from "@/components/offhours/engineRemote";
import { WATCH_CAL, createCrownSender, createDetents, crownFromTwist, parseCrown } from "@/components/offhours/watchRemote";
import { createTwistFilter } from "@/lib/motion";
import type { MotionSample } from "@/lib/motion";
import { genTwist } from "./lab-swing-traces";

// The phone twist -> game mappings for the race dash (throttle) and the watch
// (crown): pure functions, plus the real twist recogniser on synthetic wrists.

const DT = 1 / 60;
/** a phone held still for `still` s, then turned at `rate` rad/s (negative = clockwise as the player sees it) for `turn` s, then still again */
function wrist(rate: number, turn: number, still = 0.5, after = 0.5): MotionSample[] {
  const out: MotionSample[] = [];
  const n = Math.round((still + turn + after) / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const on = t >= still && t < still + turn;
    out.push({ t, acc: [0, 0, 9.8], gyro: [0, 0, on ? rate : 0] });
  }
  return out;
}

describe("engine: twist to throttle", () => {
  const drive = (samples: MotionSample[]) => {
    const f = createTwistFilter({ invert: true });
    const track = createThrottleTrack();
    let last: number | null = null;
    const v: number[] = [];
    for (const s of samples) {
      const dt = last === null ? 0.016 : Math.min(0.1, Math.max(0.001, s.t - last));
      last = s.t;
      v.push(track.push(f.push(s).omega, dt));
    }
    return v;
  };

  it("starts at idle and a phone lying still stays there", () => {
    const v = drive(wrist(0, 0, 3, 0));
    expect(Math.max(...v)).toBe(0);
  });

  it("a clockwise wrist roll opens the throttle and it stays open when the wrist stops", () => {
    // 1.6 rad/s for 0.7 s is about 64 degrees, a little over full
    const v = drive(wrist(-1.6, 0.7));
    expect(v[v.length - 1]).toBe(1);
    // part-way: about 30 degrees is about half
    const half = drive(wrist(-1.5, 0.35));
    const end = half[half.length - 1];
    expect(end).toBeGreaterThan(0.3);
    expect(end).toBeLessThan(0.7);
  });

  it("turning back closes it, and turning past either end does not wind up", () => {
    const open = wrist(-1.6, 1.5, 0.5, 0.2); // far past full
    const back = wrist(1.6, 0.5, 0, 0.2).map((s) => ({ ...s, t: s.t + open[open.length - 1].t + DT }));
    const v = drive([...open, ...back]);
    expect(v[open.length - 1]).toBe(1);
    // 0.5 s back at 1.6 rad/s is about 46 degrees, not the ~86 it went past: closed by most of the way, not past the end
    const end = v[v.length - 1];
    expect(end).toBeLessThan(0.6);
    expect(end).toBeGreaterThan(0);
    // and going the wrong way from idle stays at idle
    expect(Math.max(...drive(wrist(1.6, 1)))).toBe(0);
  });

  it("stays inside 0..1 on arbitrary twisting, and set/zero put it back", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const v = drive(genTwist(seed).samples);
      expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...v)).toBeLessThanOrEqual(1);
    }
    const t = createThrottleTrack();
    t.set(0.5);
    expect(t.value()).toBeCloseTo(0.5, 5);
    t.set(1);
    expect(t.value()).toBe(1);
    t.zero();
    expect(t.value()).toBe(0);
    expect(t.deg()).toBe(0);
  });

  it("has an idle dead band: a few degrees is still zero", () => {
    const t = createThrottleTrack();
    t.push(1, ((ENGINE_CAL.idleDeadDeg - 1) * Math.PI) / 180);
    expect(t.value()).toBe(0);
  });
});

describe("engine: the dash's pedal", () => {
  it("rpmRate is the old on/off behaviour at the ends and straight between", () => {
    expect(rpmRate(1, 9000, 6000)).toBe(9000);
    expect(rpmRate(0, 9000, 6000)).toBe(-6000);
    expect(rpmRate(0.4, 9000, 6000)).toBeCloseTo(0, 6); // 40% holds the revs
    expect(rpmRate(2, 7000, 4000)).toBe(7000);
    expect(rpmRate(-1, 7000, 4000)).toBe(-4000);
  });
  it("pedalStep eases to the target without overshooting, and lands on it", () => {
    let p = 0;
    for (let i = 0; i < 6; i++) {
      p = pedalStep(p, 1, DT);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(p).toBeGreaterThan(0.5);
    for (let i = 0; i < 120; i++) p = pedalStep(p, 1, DT);
    expect(p).toBe(1);
    expect(pedalStep(0.3, 0.9, 0.01, 0)).toBe(0.9);
  });
  it("parseThrottle clamps and drops junk", () => {
    expect(parseThrottle(0.4)).toBe(0.4);
    expect(parseThrottle(3)).toBe(1);
    expect(parseThrottle(-2)).toBe(0);
    expect(parseThrottle(Number.NaN)).toBe(0);
    expect(parseThrottle("x")).toBe(0);
  });
  it("round-trips the state the dash tells the phone, and refuses junk", () => {
    const v = { rpm: 7312, gear: 2, phase: "run" as const, shift: true, call: "PERFECT", time: 4.567 };
    const back = parseEngineState(engineStateData(v));
    expect(back).toEqual({ ...v, rpm: 7300, time: 4.57 });
    expect(parseEngineState({ rpm: 1, gear: 1.5, phase: "run" })).toBeNull();
    expect(parseEngineState({ rpm: 1, gear: 1, phase: "burnout" })).toBeNull();
    expect(parseEngineState({ rpm: "a", gear: 1, phase: "run" })).toBeNull();
    expect(parseEngineState(undefined)).toBeNull();
  });
});

describe("axis sender", () => {
  it("sends on change, at most 30 a second, and goes straight to idle and full when the rate allows", () => {
    let clock = 0;
    const sent: number[] = [];
    const s = createAxisSender((v) => sent.push(v), ENGINE_CAL, () => clock);
    s.push(0); // nothing changed
    expect(sent).toEqual([]);
    clock = 100;
    s.push(0.2);
    clock = 110; // too soon
    s.push(0.3);
    clock = 140;
    s.push(0.304); // rounds to the last-but-one step: too small
    s.push(0.3);
    clock = 180;
    s.push(0.3); // same as last sent: nothing
    s.push(1); // the end goes out
    expect(sent).toEqual([0.2, 0.3, 1]);
    clock = 181;
    s.push(0); // too soon: the rate holds, flush is the way out
    expect(sent).toEqual([0.2, 0.3, 1]);
    s.flush(0);
    expect(sent).toEqual([0.2, 0.3, 1, 0]);
    expect(s.last()).toBe(0);
    s.reset();
    expect(s.last()).toBe(0);
  });
  it("never sends more than about 30 a second under a 1 kHz stream", () => {
    let clock = 0;
    let n = 0;
    const s = createAxisSender(() => n++, ENGINE_CAL, () => clock);
    for (let i = 0; i < 1000; i++) {
      clock = i;
      s.push(0.01 + (i / 1000) * 0.9);
    }
    expect(n).toBeLessThanOrEqual(31);
    expect(n).toBeGreaterThan(20);
  });
});

describe("watch: twist to crown", () => {
  it("reads crown gestures: signed degrees, clamped, junk refused", () => {
    expect(parseCrown({ deg: 12.5 })).toBe(12.5);
    expect(parseCrown({ deg: -3 })).toBe(-3);
    expect(parseCrown({ deg: 9999 })).toBe(WATCH_CAL.maxStepDeg);
    expect(parseCrown({ deg: -9999 })).toBe(-WATCH_CAL.maxStepDeg);
    expect(parseCrown({ deg: 0 })).toBeNull();
    expect(parseCrown({ deg: "x" })).toBeNull();
    expect(parseCrown({})).toBeNull();
  });
  it("gears a wrist up so a comfortable twist winds a real stroke", () => {
    expect(crownFromTwist(60)).toBe(60 * WATCH_CAL.twistGain);
    expect(crownFromTwist(-10)).toBe(-10 * WATCH_CAL.twistGain);
    // one 60-degree clockwise stroke is a dozen clicks
    expect(Math.floor(crownFromTwist(60) / WATCH_CAL.detentDeg)).toBeGreaterThanOrEqual(10);
  });
  it("batches turns: nothing under the minimum, 30 messages a second, the rest on flush, none lost", () => {
    let clock = 0;
    const got: number[] = [];
    const s = createCrownSender((d) => got.push(d), WATCH_CAL, () => clock);
    s.add(0.2); // under the minimum
    expect(got).toEqual([]);
    clock = 100;
    s.add(0.4); // now 0.6, and the rate allows it
    expect(got).toEqual([0.6]);
    clock = 110;
    s.add(5); // too soon
    s.add(5);
    expect(got).toEqual([0.6]);
    clock = 150;
    s.add(1);
    expect(got).toEqual([0.6, 11]);
    s.add(-0.05);
    s.flush(); // under 0.1: dropped, not sent
    expect(got).toHaveLength(2);
    expect(s.pending()).toBe(0);
    clock = 151;
    s.add(2);
    s.flush();
    expect(got[got.length - 1]).toBe(2);
    expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo(0.6 + 11 + 2, 6);
  });
  it("counts the clicks of a winding crown and ignores the turn back", () => {
    const d = createDetents();
    expect(d.add(WATCH_CAL.detentDeg - 1)).toBe(0);
    expect(d.add(2)).toBe(1);
    expect(d.add(-50)).toBe(0);
    expect(d.add(WATCH_CAL.detentDeg * 3)).toBe(3);
  });
  it("a clockwise twist through the real recogniser winds about gain x the angle; counter-clockwise adds none", () => {
    const run = (rate: number) => {
      const f = createTwistFilter({ invert: true });
      let wound = 0;
      let net = 0;
      let last: number | null = null;
      for (const s of wrist(rate, 0.5)) {
        const dt = last === null ? 0.016 : s.t - last;
        last = s.t;
        const st = f.push(s);
        const deg = crownFromTwist((st.omega * dt * 180) / Math.PI);
        net += deg;
        if (deg > 0) wound += deg;
      }
      return { wound, net };
    };
    const cw = run(-1.2); // 0.5 s at 1.2 rad/s is about 34 degrees of wrist
    expect(cw.wound).toBeGreaterThan(80);
    expect(cw.wound).toBeLessThan(115);
    expect(cw.net).toBeCloseTo(cw.wound, 3);
    const ccw = run(1.2);
    expect(ccw.wound).toBe(0);
    expect(ccw.net).toBeLessThan(-80);
  });
});
