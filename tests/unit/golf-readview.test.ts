import { describe, expect, it } from "vitest";
import { HOLE_DEFS, buildHole, type BuiltHole } from "@/components/offhours/golf/course";
import { reliefOf } from "@/components/golf3d/relief";
import type { View } from "@/components/golf3d/flyover";
import { ReadCam, ReadInput, readPose } from "@/components/golf3d/readview";

// The hold-to-read view on the green: its input (Tab held, 1 and 2 switch) and its cameras. The map looks straight down
// with the ball low and the cup high in the frame; the low view sits a metre behind the ball, a little above the green,
// looking along the line to the cup.

const holes = HOLE_DEFS.map((d) => buildHole(d));
/** hole 6 and hole 3 (the ones the screenshots are of) */
const pick = (n: number) => holes.find((h) => h.def.n === n)!;

/** where a point of the course lands on screen through a view: the projection centre is at 40% of the height, as render3d's */
function project(v: View, q: [number, number, number], w: number, h: number) {
  const f = [v.tx - v.x, v.ty - v.y, v.tz - v.z];
  const fl = Math.hypot(f[0], f[1], f[2]);
  for (let i = 0; i < 3; i++) f[i] /= fl;
  const up = v.up ?? { x: 0, y: 1, z: 0 };
  // right = forward x up; screen up = right x forward (the part of up across the view)
  const r = [f[1] * up.z - f[2] * up.y, f[2] * up.x - f[0] * up.z, f[0] * up.y - f[1] * up.x];
  const rl = Math.hypot(r[0], r[1], r[2]);
  for (let i = 0; i < 3; i++) r[i] /= rl;
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d = [q[0] - v.x, q[1] - v.y, q[2] - v.z];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { x: w / 2 + (v.F * dot(d, r)) / z, y: 0.4 * h - (v.F * dot(d, u)) / z, depth: z };
}

/** a course point for a green point at ground height */
function onGround(hole: BuiltHole, gx: number, gy: number): [number, number, number] {
  const [x, z] = hole.fromGreen(gx, gy);
  return [x, reliefOf(hole).yG(gx, gy), z];
}

describe("the hold-to-read input", () => {
  it("opens while Tab is held and closes when it is let go", () => {
    const r = new ReadInput();
    expect(r.kind()).toBeNull();
    r.tab(true);
    expect(r.kind()).toBe("map");
    r.tab(false);
    expect(r.kind()).toBeNull();
  });
  it("1 and 2 switch the view while Tab is held, and the last choice is what the next hold shows", () => {
    const r = new ReadInput();
    r.tab(true);
    r.digit("low");
    expect(r.kind()).toBe("low");
    r.digit("map");
    expect(r.kind()).toBe("map");
    r.digit("low");
    r.tab(false);
    expect(r.kind()).toBeNull();
    r.tab(true);
    expect(r.kind()).toBe("low");
  });
  it("a chip held is the same hold, and the view it names is the one shown", () => {
    const r = new ReadInput();
    r.hold("low", true);
    expect(r.kind()).toBe("low");
    r.hold("low", false);
    expect(r.kind()).toBeNull();
  });
  it("1 or 2 latches the view when Tab is not held, a second press of the same key lets it go, and Tab closes it", () => {
    const r = new ReadInput();
    r.digit("low");
    expect(r.kind()).toBe("low");
    // a Tab press while latched closes it (and holding nothing after it)
    r.tab(true);
    expect(r.kind()).toBeNull();
    r.tab(false);
    expect(r.kind()).toBeNull();
    r.digit("low");
    expect(r.kind()).toBe("low");
    r.digit("low");
    expect(r.kind()).toBeNull();
    r.digit("map");
    expect(r.kind()).toBe("map");
  });
  it("a reset (the putt struck, the page paused) closes whatever is up", () => {
    const r = new ReadInput();
    r.tab(true);
    r.digit("low");
    r.reset();
    expect(r.kind()).toBeNull();
    r.digit("low");
    r.reset();
    expect(r.kind()).toBeNull();
  });
});

describe("the map view's camera", () => {
  for (const n of [6, 3]) {
    for (const [w, h] of [
      [1280, 720],
      [390, 844],
    ] as const) {
      it(`hole ${n} at ${w}x${h}: above the green, looking straight down, the ball low and the cup high in the frame`, () => {
        const hole = pick(n);
        const cup = hole.green.cup;
        // the ball 6 m short of the cup, on the line
        const ball: [number, number] = [cup[0], cup[1] + 6];
        const v = readPose(hole, ball, "map", w, h);
        const [bx, by, bz] = onGround(hole, ball[0], ball[1]);
        const [cx, cy, cz] = onGround(hole, cup[0], cup[1]);
        // above the green
        expect(v.y - by).toBeGreaterThan(1.5);
        expect(v.y - cy).toBeGreaterThan(1.5);
        // looking straight down: the look point is below the camera, on its own vertical
        expect(Math.abs(v.tx - v.x)).toBeLessThan(1e-9);
        expect(Math.abs(v.tz - v.z)).toBeLessThan(1e-9);
        expect(v.ty).toBeLessThan(v.y);
        // both in the frame, with a margin
        const pb = project(v, [bx, by, bz], w, h);
        const pc = project(v, [cx, cy, cz], w, h);
        for (const p of [pb, pc]) {
          expect(p.depth).toBeGreaterThan(0);
          expect(p.x).toBeGreaterThan(0.05 * w);
          expect(p.x).toBeLessThan(0.95 * w);
          expect(p.y).toBeGreaterThan(0.05 * h);
          expect(p.y).toBeLessThan(0.95 * h);
        }
        // north up the screen: the cup above the ball, and the ball near the bottom, the cup near the top
        expect(pc.y).toBeLessThan(pb.y);
        expect(pb.y / h).toBeGreaterThan(0.7);
        expect(pc.y / h).toBeLessThan(0.3);
      });
    }
  }
  it("a short putt is framed too: the cup and the ball still in the frame", () => {
    const hole = pick(6);
    const cup = hole.green.cup;
    const ball: [number, number] = [cup[0] + 1, cup[1]];
    const v = readPose(hole, ball, "map", 1280, 720);
    for (const q of [onGround(hole, ball[0], ball[1]), onGround(hole, cup[0], cup[1])]) {
      const p = project(v, q, 1280, 720);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(720);
    }
  });
  it("a ball holed on the cup gives a finite camera", () => {
    const hole = pick(6);
    const v = readPose(hole, hole.green.cup, "map", 1280, 720);
    for (const k of [v.x, v.y, v.z, v.tx, v.ty, v.tz, v.F]) expect(Number.isFinite(k)).toBe(true);
  });
});

describe("the low view's camera", () => {
  for (const n of [6, 3]) {
    it(`hole ${n}: below 0.3 m, a metre behind the ball, looking at the cup`, () => {
      const hole = pick(n);
      const cup = hole.green.cup;
      const ball: [number, number] = [cup[0] - 3, cup[1] + 4];
      const v = readPose(hole, ball, "low", 1280, 720);
      const [bx, , bz] = onGround(hole, ball[0], ball[1]);
      const [cx, , cz] = onGround(hole, cup[0], cup[1]);
      // a little above the green where the camera stands
      const camGreen = hole.toGreen(v.x, v.z);
      const hC = v.y - reliefOf(hole).yG(camGreen[0], camGreen[1]);
      expect(hC).toBeGreaterThan(0.1);
      expect(hC).toBeLessThan(0.3);
      // behind the ball: the camera is on the far side of it from the cup
      const toBall = [bx - v.x, bz - v.z];
      const toCup = [cx - bx, cz - bz];
      expect(toBall[0] * toCup[0] + toBall[1] * toCup[1]).toBeGreaterThan(0);
      const dist = Math.hypot(bx - v.x, bz - v.z);
      expect(dist).toBeGreaterThan(0.9);
      expect(dist).toBeLessThan(1.1);
      // looking at the cup: the look direction along the line from the ball
      const fwd = [v.tx - v.x, v.tz - v.z];
      const cosA = (fwd[0] * toCup[0] + fwd[1] * toCup[1]) / (Math.hypot(fwd[0], fwd[1]) * Math.hypot(toCup[0], toCup[1]));
      expect(cosA).toBeGreaterThan(0.999);
      expect(Math.abs(v.tx - cx)).toBeLessThan(1e-6);
      expect(Math.abs(v.tz - cz)).toBeLessThan(1e-6);
    });
  }
});

describe("the read camera's easing", () => {
  const putt: View = { x: 0, y: 2, z: -3, tx: 0, ty: 0, tz: 4, F: 500 };
  const pose = readPose(pick(6), [pick(6).green.cup[0], pick(6).green.cup[1] + 6], "map", 1280, 720);
  it("eases in over about 0.3 s, and returns to the putt's camera once let go", () => {
    const c = new ReadCam();
    expect(c.step(null, null, putt, 1 / 60, false)).toBeNull();
    let v: View | null = null;
    for (let i = 0; i < 18; i++) v = c.step("map", pose, putt, 1 / 60, false);
    expect(v?.look?.kind).toBe("map");
    expect(v!.look!.k).toBeGreaterThan(0.9);
    expect(v!.look!.k).toBeLessThan(1);
    for (let i = 0; i < 120; i++) v = c.step(null, null, putt, 1 / 60, false);
    expect(v).toBeNull();
  });
  it("is at the view at once under reduced motion", () => {
    const c = new ReadCam();
    const v = c.step("low", readPose(pick(6), [0, 0], "low", 1280, 720), putt, 1 / 60, true);
    expect(v?.look).toEqual({ kind: "low", k: 1 });
  });
});
