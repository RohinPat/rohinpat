import { describe, expect, it } from "vitest";
import { ENGINE_CAL } from "@/components/offhours/engineRemote";
import { ROCK_L, ROCK_R, getRoad, headingAt, heightAt, pointAt, type Point, type Road } from "@/components/offhours/night/road";
import { getScenery, type Scenery } from "@/components/offhours/night/scenery";
import { fadeAt, planRoadside, type Shown } from "@/components/offhours/night/roadside";
import { P, newView, project, type View } from "@/components/offhours/night/view";

// Cars: nothing beside the road shows where the road or a cliff hides it, or past
// the end of the drawn road. The plan (roadside.ts) is the game's own: the camera is
// set up as the chase camera sets it (stepCamera, fresh), and every thing the plan
// lists is checked against a horizon worked out here by brute force, from the road's
// own points, so the two cannot agree by sharing a bug.

const CAM = ENGINE_CAL.cam;
const W = 1440;
const H = 760;

/** the view the chase camera gives at `carS` (straight on, no lean, no shake) */
function viewAt(road: Road, carS: number): View {
  const v = newView();
  const phi = headingAt(road, carS);
  const want = phi + (headingAt(road, carS + CAM.lookM) - phi) * 0.3;
  const back = CAM.backM;
  const cw = pointAt(road, carS, 0, tmp);
  v.camX = cw.x - Math.sin(want) * back;
  v.camZ = cw.z - Math.cos(want) * back;
  v.camY = heightAt(road, carS - back * 0.9) + CAM.heightM;
  v.sinG = Math.sin(want);
  v.cosG = Math.cos(want);
  const w2 = W / 2;
  v.w = W;
  v.h = H;
  v.w2 = w2;
  v.f = Math.max(w2 / Math.tan((CAM.fovDeg * Math.PI) / 360), H * 0.72);
  v.hy = 380;
  return v;
}
const tmp: Point = { x: 0, y: 0, z: 0, phi: 0 };
const tmp2: Point = { x: 0, y: 0, z: 0, phi: 0 };

/** the node window the renderer draws from the car (as drawScene does) */
function windowAt(road: Road, carS: number, quality: number, decor: number) {
  const N = Math.min(decor > 2 ? 76 : CAM.drawSegs[quality], road.n - Math.max(0, Math.floor((carS - CAM.backM - 10) / road.segM)));
  const i0 = Math.max(0, Math.floor((carS - CAM.backM - 10) / road.segM));
  return { i0, N };
}

/** the screen line that hides a thing at depth z over columns x0..x1, worked out from the road's points: a crest across the picture, or a cliff's top over its columns */
function horizonByHand(road: Road, sc: Scenery, v: View, i0: number, N: number, z: number, x0: number, x1: number): number {
  let h = Infinity;
  const seg = road.segM;
  const rail = road.railHalf;
  for (let k = 0; k <= N; k++) {
    const i = i0 + k;
    if (i >= road.n) break;
    pointAt(road, i * seg, 0, tmp2);
    if (!project(v, tmp2.x, tmp2.y, tmp2.z)) continue;
    const nz = P.z;
    if (nz < 0.9 || nz >= z) continue;
    h = Math.min(h, P.y);
    const fl = road.flags[i] | (i > 0 ? road.flags[i - 1] : 0);
    for (const side of [-1, 1] as const) {
      if (!(fl & (side < 0 ? ROCK_L : ROCK_R))) continue;
      pointAt(road, i * seg, side * rail, tmp2);
      if (!project(v, tmp2.x, tmp2.y, tmp2.z)) continue;
      const xa = P.x;
      pointAt(road, i * seg, side * (rail + sc.rockOut[i]), tmp2);
      if (!project(v, tmp2.x, tmp2.y + sc.rockTop[i], tmp2.z)) continue;
      const lo = Math.min(xa, P.x), hi = Math.max(xa, P.x);
      if (hi < x0 || lo > x1) continue;
      h = Math.min(h, P.y);
    }
  }
  return h;
}

/** the plan for one camera and one level of detail */
function planAt(road: Road, sc: Scenery, carS: number, quality: number, decor: number, out: Shown[]) {
  const v = viewAt(road, carS);
  const { i0, N } = windowAt(road, carS, quality, decor);
  const n = planRoadside(road, sc, v, carS, i0, N, decor, out);
  return { v, i0, N, n, reach: (i0 + N) * road.segM - carS };
}

/** each of these is a level of the governor: its quality (the road's length) and its decor (what beside it is drawn) */
const LEVELS = [
  { level: 0, quality: 0, decor: 0 },
  { level: 1, quality: 1, decor: 1 },
  { level: 2, quality: 2, decor: 2 },
  { level: 3, quality: 2, decor: 3 },
];

describe("cars: nothing beside the road shows where it is hidden", () => {
  for (const track of ["canyon", "climb"] as const) {
    describe(`on the ${track}`, () => {
      const road = getRoad(track);
      const sc = getScenery(road);
      for (const L of LEVELS) {
        it(`hides every listed thing behind a crest or a cliff, and draws none past the road's end (governor level ${L.level})`, () => {
          const out: Shown[] = [];
          let listed = 0;
          const bad: string[] = [];
          const lim = Math.min(road.length - 400, 1500);
          for (let carS = 0; carS <= lim; carS += 10) {
            const { v, i0, N, n, reach } = planAt(road, sc, carS, L.quality, L.decor, out);
            for (let t = 0; t < n; t++) {
              const it = out[t];
              listed++;
              if (it.z > reach + 1e-3) bad.push(`${it.what} ${it.i} at ${it.z.toFixed(0)} m past the road's end ${reach.toFixed(0)} m, car ${carS}`);
              if (!(it.fade > 0 && it.fade <= 1)) bad.push(`${it.what} ${it.i} has fade ${it.fade}, car ${carS}`);
              const hz = horizonByHand(road, sc, v, i0, N, it.z, it.x0, it.x1);
              if (!(it.top < hz)) bad.push(`${it.what} ${it.i} top ${it.top.toFixed(1)} is under the line ${hz.toFixed(1)} in front of it, car ${carS}`);
              const cut = it.base > hz ? hz : Infinity;
              // the planner also cuts at the treeline, so its cut is never below the screen horizon
              const ok = cut === Infinity ? true : it.clip <= cut + 1e-6;
              if (!ok) bad.push(`${it.what} ${it.i} is cut at ${it.clip} but the horizon is ${cut}, car ${carS}`);
              // a thing past the fade's start is faded by its distance, not by the road alone
              if (it.z > reach * 0.7 + 1 && it.fade >= 1) bad.push(`${it.what} ${it.i} at ${it.z.toFixed(0)} m is not faded, car ${carS}`);
            }
          }
          expect(bad.slice(0, 5)).toEqual([]);
          // the test has something to test: the roadside is not empty at any level but the bare road
          expect(listed).toBeGreaterThan(L.decor === 3 ? 20 : 200);
        });
      }
    });
  }

  it("fades a landmark that is far down the drawn road, instead of cutting it off", () => {
    const road = getRoad("canyon");
    const sc = getScenery(road);
    const out: Shown[] = [];
    const carS = 0;
    const { n } = planAt(road, sc, carS, 0, 0, out);
    expect(n).toBeGreaterThan(0);
    // the first gate is 460 m on, round a bend to the left: it stands on the road, which the land beside the road does not hide, so it is listed; the road's own bulge cuts its foot
    const g0 = out.slice(0, n).find((it) => it.what === "gate" && it.i === 0);
    expect(g0).toBeDefined();
    expect(g0!.clip).toBeLessThan(g0!.base);
    expect(g0!.fade).toBeGreaterThan(0);
    expect(g0!.fade).toBeLessThan(1);
    // and whatever is listed in the far stretch of the drawn road is faded, never full strength
    let far = 0;
    for (let carS = 0; carS <= 1000; carS += 10) {
      const r = planAt(road, sc, carS, 0, 0, out);
      for (let t = 0; t < r.n; t++) {
        if (out[t].z <= 0.7 * r.reach) continue;
        far++;
        expect(out[t].fade).toBeLessThan(1);
      }
    }
    expect(far).toBeGreaterThan(0);
  });

  it("fades out over the last share of the drawn road, and nowhere before it", () => {
    const reach = 760;
    expect(fadeAt(0, reach)).toBe(1);
    expect(fadeAt(reach * 0.7, reach)).toBe(1);
    expect(fadeAt(reach * 0.85, reach)).toBeCloseTo(0.5, 5);
    expect(fadeAt(reach, reach)).toBe(0);
    expect(fadeAt(reach + 5, reach)).toBe(0);
  });
});
