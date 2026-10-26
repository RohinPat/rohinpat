import { describe, expect, it } from "vitest";
import { MAZE_CAL, stickAxes, tiltAxes } from "@/components/offhours/mazeRemote";
import { POWDER_CAL } from "@/components/offhours/ski/remoteSteer";
import { createAxisSmoother, hysteresis, shape } from "@/components/offhours/remoteAxis";
import { createAxes } from "@/components/link/controllers/axes";
import { createTiltFilter, createWheelFilter, wrapDeg } from "@/lib/motion";
import type { LinkMsg } from "@/lib/link/session";
import type { MotionSample } from "@/lib/motion";

const G = 9.80665;
const D = Math.PI / 180;

/** A phone held perfectly still: gravity (device frame) from a wheel angle (in the screen plane) and a pitch (screen toward the sky). */
function wheelPose(t: number, wheelDeg: number, pitchDeg: number): MotionSample {
  const w = wheelDeg * D, p = pitchDeg * D;
  return { t, acc: [-Math.sin(w) * Math.cos(p) * G, Math.cos(w) * Math.cos(p) * G, Math.sin(p) * G], gyro: [0, 0, 0] };
}
/** The same for a phone lying roughly flat: roll (right edge down) and how high the top edge is. */
function flatPose(t: number, rollDeg: number, topUpDeg: number): MotionSample {
  const r = rollDeg * D, p = topUpDeg * D;
  return { t, acc: [-Math.sin(r) * Math.cos(p) * G, Math.sin(p) * G, Math.cos(r) * Math.cos(p) * G], gyro: [0, 0, 0] };
}
/** Hold a pose for `secs` at 60 Hz from `t0`; returns the last output and the time reached. */
function hold<S>(push: (s: MotionSample) => S, pose: (t: number) => MotionSample, t0: number, secs: number): { last: S; t: number } {
  let last!: S;
  let t = t0;
  for (; t < t0 + secs; t += 1 / 60) last = push(pose(t));
  return { last, t };
}

describe("wheel filter (the slalom's handlebars)", () => {
  const opts = { maxAngleDeg: POWDER_CAL.steerRangeDeg, deadZoneDeg: POWDER_CAL.steerDeadDeg, tuckRangeDeg: POWDER_CAL.tuckRangeDeg, tuckDeadDeg: POWDER_CAL.tuckDeadDeg };

  // landscape (the phone turned 90 degrees) and portrait must behave the same: the neutral is wherever it opens
  for (const [name, base] of [["landscape", 90], ["landscape the other way", -90], ["portrait", 0], ["upside down", 180]] as const) {
    it(`steers clockwise = right and counter-clockwise = left from a ${name} start`, () => {
      const f = createWheelFilter(opts);
      const open = hold((s) => f.push(s), (t) => wheelPose(t, base, 8), 0, 1.4);
      expect(open.last.calibrated).toBe(true);
      expect(open.last.steer).toBe(0);
      const right = hold((s) => f.push(s), (t) => wheelPose(t, base + 25, 8), open.t, 4);
      expect(right.last.steer).toBeCloseTo((25 - POWDER_CAL.steerDeadDeg) / (POWDER_CAL.steerRangeDeg - POWDER_CAL.steerDeadDeg), 1);
      expect(right.last.wheelDeg).toBeCloseTo(25, 0);
      const left = hold((s) => f.push(s), (t) => wheelPose(t, base - 25, 8), right.t, 4);
      expect(left.last.steer).toBeLessThan(-0.5);
      const lock = hold((s) => f.push(s), (t) => wheelPose(t, base + 60, 8), left.t, 4);
      expect(lock.last.steer).toBe(1);
    });
  }

  it("is exactly 0 inside the dead zone", () => {
    const f = createWheelFilter(opts);
    const open = hold((s) => f.push(s), (t) => wheelPose(t, 90, 5), 0, 1.4);
    const wobble = hold((s) => f.push(s), (t) => wheelPose(t, 90 + 3.5 * Math.sin(t * 9), 5), open.t, 3);
    expect(wobble.last.steer).toBe(0);
  });

  it("tucks as the top edge tips away, and not for a wheel turn", () => {
    const f = createWheelFilter(opts);
    const open = hold((s) => f.push(s), (t) => wheelPose(t, 90, 5), 0, 1.4);
    expect(open.last.tuck).toBe(0);
    const turned = hold((s) => f.push(s), (t) => wheelPose(t, 90 + 30, 5), open.t, 4);
    expect(turned.last.tuck).toBe(0);
    const lean = hold((s) => f.push(s), (t) => wheelPose(t, 90, 5 + 15), turned.t, 4);
    expect(lean.last.tuck).toBeCloseTo((15 - POWDER_CAL.tuckDeadDeg) / (POWDER_CAL.tuckRangeDeg - POWDER_CAL.tuckDeadDeg), 1);
    const full = hold((s) => f.push(s), (t) => wheelPose(t, 90, 5 + 40), lean.t, 4);
    expect(full.last.tuck).toBe(1);
    // leaning the other way (top edge toward you) is not a tuck
    const back = hold((s) => f.push(s), (t) => wheelPose(t, 90, 5 - 15), full.t, 4);
    expect(back.last.tuck).toBe(0);
  });

  it("recalibrate() makes the current pose straight ahead", () => {
    const f = createWheelFilter(opts);
    const open = hold((s) => f.push(s), (t) => wheelPose(t, 0, 5), 0, 1.4);
    const off = hold((s) => f.push(s), (t) => wheelPose(t, 90, 5), open.t, 4); // turned to landscape after opening: full lock
    expect(off.last.steer).toBe(1);
    f.recalibrate();
    const after = hold((s) => f.push(s), (t) => wheelPose(t, 90, 5), off.t, 0.2);
    expect(after.last.steer).toBe(0);
    expect(Math.abs(after.last.wheelDeg)).toBeLessThan(1);
  });

  it("says it cannot read the wheel when the phone lies flat, and outputs nothing", () => {
    const f = createWheelFilter(opts);
    const flat = hold((s) => f.push(s), (t) => wheelPose(t, 30, 85), 0, 2);
    expect(flat.last.valid).toBe(false);
    expect(flat.last.steer).toBe(0);
    expect(flat.last.tuck).toBe(0);
  });

  it("wraps across the half-turn and resets cleanly", () => {
    expect(wrapDeg(190)).toBeCloseTo(-170);
    expect(wrapDeg(-190)).toBeCloseTo(170);
    expect(wrapDeg(180)).toBe(180);
    const f = createWheelFilter(opts);
    hold((s) => f.push(s), (t) => wheelPose(t, 170, 5), 0, 1.4);
    // 170 -> 195 (= -165) is a 25 degree clockwise turn, not a 335 degree one
    const r = hold((s) => f.push(s), (t) => wheelPose(t, 195, 5), 1.5, 4);
    expect(r.last.wheelDeg).toBeCloseTo(25, 0);
    f.reset();
    expect(f.push(wheelPose(0, 0, 5)).calibrated).toBe(false);
  });
});

describe("maze tilt axes", () => {
  it("maps the tilt filter's lean and forward angles to turn (x) and walk (y)", () => {
    const f = createTiltFilter({ smoothingS: MAZE_CAL.phoneSmoothingS });
    const open = hold((s) => f.push(s), (t) => flatPose(t, 0, 0), 0, 1.4);
    let a = tiltAxes(open.last.leanDeg, open.last.forwardDeg);
    expect(a).toEqual({ x: 0, y: 0 });
    // right edge down 15 degrees: turn right
    const right = hold((s) => f.push(s), (t) => flatPose(t, 15, 0), open.t, 4);
    a = tiltAxes(right.last.leanDeg, right.last.forwardDeg);
    expect(a.x).toBeCloseTo((15 - MAZE_CAL.deadZoneDeg) / (MAZE_CAL.turnRangeDeg - MAZE_CAL.deadZoneDeg), 1);
    expect(a.y).toBe(0);
    // top edge down 12 degrees: walk forward
    const fwd = hold((s) => f.push(s), (t) => flatPose(t, 0, -12), right.t, 4);
    a = tiltAxes(fwd.last.leanDeg, fwd.last.forwardDeg);
    expect(a.x).toBe(0);
    expect(a.y).toBeGreaterThan(0.4);
    // top edge up: walk back
    const back = hold((s) => f.push(s), (t) => flatPose(t, 0, 12), fwd.t, 4);
    a = tiltAxes(back.last.leanDeg, back.last.forwardDeg);
    expect(a.y).toBeLessThan(-0.4);
    // and left edge down: turn left
    const left = hold((s) => f.push(s), (t) => flatPose(t, -30, 0), back.t, 4);
    expect(tiltAxes(left.last.leanDeg, left.last.forwardDeg).x).toBe(-1);
  });

  it("has a dead zone, saturates, and can flip the walk direction", () => {
    expect(tiltAxes(MAZE_CAL.deadZoneDeg - 0.5, MAZE_CAL.deadZoneDeg - 0.5)).toEqual({ x: 0, y: 0 });
    expect(tiltAxes(90, 90)).toEqual({ x: 1, y: 1 });
    expect(tiltAxes(0, 90, { ...MAZE_CAL, forwardSign: -1 }).y).toBe(-1);
  });

  it("re-centres: the pose held at open is the middle, however it is held", () => {
    const f = createTiltFilter({ smoothingS: MAZE_CAL.phoneSmoothingS });
    const open = hold((s) => f.push(s), (t) => flatPose(t, 6, 40), 0, 1.4); // propped up and a bit rolled
    expect(tiltAxes(open.last.leanDeg, open.last.forwardDeg)).toEqual({ x: 0, y: 0 });
    const moved = hold((s) => f.push(s), (t) => flatPose(t, -10, 25), open.t, 4);
    expect(tiltAxes(moved.last.leanDeg, moved.last.forwardDeg).y).toBeGreaterThan(0.3);
    f.recalibrate();
    const again = hold((s) => f.push(s), (t) => flatPose(t, -10, 25), moved.t, 0.2);
    expect(tiltAxes(again.last.leanDeg, again.last.forwardDeg)).toEqual({ x: 0, y: 0 });
  });

  it("the touch joystick: dead zone, full travel, up is forward", () => {
    expect(stickAxes(3, -3)).toEqual({ x: 0, y: 0 });
    expect(stickAxes(MAZE_CAL.stickRadiusPx / 2, 0).x).toBeCloseTo(0.5);
    expect(stickAxes(0, -MAZE_CAL.stickRadiusPx * 3)).toEqual({ x: 0, y: 1 });
    expect(stickAxes(0, MAZE_CAL.stickRadiusPx).y).toBe(-1);
  });
});

describe("laptop side: smoothing and shaping", () => {
  it("eases toward the last value, reaches it, and resets", () => {
    const s = createAxisSmoother(0.06);
    s.set(1);
    const a = s.update(1 / 60);
    expect(a).toBeGreaterThan(0.2);
    expect(a).toBeLessThan(0.3);
    for (let i = 0; i < 60; i++) s.update(1 / 60);
    expect(s.value).toBe(1);
    s.reset();
    expect(s.value).toBe(0);
    s.set(Number.NaN);
    expect(s.update(0.1)).toBe(0);
    const raw = createAxisSmoother(0);
    raw.set(0.7);
    expect(raw.update(0.016)).toBe(0.7);
  });

  it("shape keeps the sign, reaches full travel, and is gentle near the middle", () => {
    expect(shape(0.02, 0.04, 1.5)).toBe(0);
    expect(shape(1, 0.04, 1.5)).toBe(1);
    expect(shape(-1, 0.04, 1.5)).toBe(-1);
    expect(shape(2, 0.04, 1.5)).toBe(1);
    expect(shape(0.5, 0.04, 1.5)).toBeLessThan(0.5);
    expect(shape(0.5, 0.04, 1.5)).toBeGreaterThan(0.25);
  });

  it("tuck hysteresis: on at the top threshold, off at the bottom one, steady between", () => {
    const { tuckOn, tuckOff } = POWDER_CAL;
    let on = false;
    on = hysteresis(on, tuckOn - 0.05, tuckOn, tuckOff);
    expect(on).toBe(false);
    on = hysteresis(on, tuckOn, tuckOn, tuckOff);
    expect(on).toBe(true);
    on = hysteresis(on, (tuckOn + tuckOff) / 2, tuckOn, tuckOff);
    expect(on).toBe(true);
    on = hysteresis(on, tuckOff - 0.01, tuckOn, tuckOff);
    expect(on).toBe(false);
  });
});

describe("axes sender (phone side)", () => {
  function rig() {
    let now = 1000;
    const sent: LinkMsg[] = [];
    const timers: { at: number; fn: () => void }[] = [];
    const axes = createAxes((m) => sent.push(m), ["x", "y"], {
      now: () => now,
      setTimer: (fn, ms) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimer: (t) => {
        const i = timers.indexOf(t as (typeof timers)[number]);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    const advance = (ms: number) => {
      now += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at > now) continue;
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    };
    return { axes, sent, advance, timers };
  }

  it("sends on change only, snapping to the step and to 0 near the middle", () => {
    const { axes, sent } = rig();
    axes.set("x", 0.004);
    expect(sent).toEqual([]);
    axes.set("x", 0.503);
    expect(sent).toEqual([{ type: "axis", name: "x", v: 0.5 }]);
    axes.set("x", 0.506); // same step: nothing
    expect(sent).toHaveLength(1);
  });

  it("is rate limited to about 30 Hz and the last value always gets out", () => {
    const { axes, sent, advance, timers } = rig();
    axes.set("x", 0.2);
    expect(sent).toHaveLength(1);
    advance(10);
    axes.set("x", 0.4);
    advance(10);
    axes.set("x", 0.6); // both held back
    expect(sent).toHaveLength(1);
    expect(timers).toHaveLength(1);
    advance(20);
    expect(sent.at(-1)).toEqual({ type: "axis", name: "x", v: 0.6 });
    expect(sent).toHaveLength(2);
    // a steady stream of changes at 125 Hz comes out at <= ~30 per second
    let v = 0.6;
    for (let i = 0; i < 125; i++) {
      v += 0.04;
      axes.set("y", Math.sin(v));
      advance(8);
    }
    expect(sent.length - 2).toBeLessThanOrEqual(33);
    advance(40);
    expect(axes.sent("y")).toBeCloseTo(Math.sin(v), 1);
  });

  it("zero() lets go of everything at once, ignores unknown names and non-finite values", () => {
    const { axes, sent } = rig();
    axes.set("x", 0.5);
    axes.zero();
    expect(sent.at(-1)).toEqual({ type: "axis", name: "x", v: 0 });
    const n = sent.length;
    axes.set("nope", 1);
    axes.set("x", Number.NaN);
    axes.zero();
    expect(sent).toHaveLength(n);
  });

  it("dispose() cancels a pending send", () => {
    const { axes, sent, advance, timers } = rig();
    axes.set("x", 0.3);
    axes.set("x", 0.9);
    expect(timers).toHaveLength(1);
    axes.dispose();
    advance(100);
    expect(sent).toHaveLength(1);
  });
});
