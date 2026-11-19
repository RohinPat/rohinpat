import { describe, expect, it } from "vitest";
import { ENGINE_CAL } from "@/components/offhours/engineRemote";
import { BRIDGE, ROCK_L, ROCK_R, flagsAt, getRoad, headingAt, heightAt, pointAt, type Point, type Road } from "@/components/offhours/night/road";
import { getScenery, stretchAt, type Scenery } from "@/components/offhours/night/scenery";
import { planRoadside, type Shown } from "@/components/offhours/night/roadside";
import { P, newView, project, type View } from "@/components/offhours/night/view";

// Cars: the land beside the road is a treeline as high as the roadside pines, out past the
// verge, and it hides what is round the bends. This guard works the sightline out by hand, from
// the camera to each thing the plan lists, and checks it against the road's own centre-line
// points, so the plan cannot agree with itself by sharing a bug. It checks both ways: nothing
// whose sightline crosses the trees is listed whole, and nothing is cut by the trees unless its
// sightline does cross them. It uses only the APIs the earlier commits have, so it can be run
// against an older commit and fail there.

const CAM = ENGINE_CAL.cam;
const W = 1440;
const H = 760;
const TREE = 2.33 * 5.5; // the roadside pines' height (m)
const VERGE = 1.5; // the land starts this far out past the rail
const THICK = 20; // a thing less than this far behind the trees is not hidden by them

/** open ground, where the land is in view: the bridge over the valley, the start, the finish's stands, the canyon's bare ridge, the climb above the tree line */
function open(road: Road, s: number): boolean {
  if (flagsAt(road, s) & BRIDGE) return true;
  if (s < 200 || s > road.finish - 280) return true;
  const k = stretchAt(road, s);
  return road.track === "climb" ? k >= 4 : k === 3;
}

function viewAt(road: Road, carS: number): View {
  const v = newView();
  const phi = headingAt(road, carS);
  const want = phi + (headingAt(road, carS + CAM.lookM) - phi) * 0.3;
  const cw = pointAt(road, carS, 0, tmp);
  v.camX = cw.x - Math.sin(want) * CAM.backM;
  v.camZ = cw.z - Math.cos(want) * CAM.backM;
  v.camY = heightAt(road, carS - CAM.backM * 0.9) + CAM.heightM;
  v.sinG = Math.sin(want);
  v.cosG = Math.cos(want);
  v.w = W;
  v.h = H;
  v.w2 = W / 2;
  v.f = Math.max(W / 2 / Math.tan((CAM.fovDeg * Math.PI) / 360), H * 0.72);
  v.hy = 380;
  return v;
}
const tmp: Point = { x: 0, y: 0, z: 0, phi: 0 };

/** whether the sightline from the camera to the world point Q passes over land below the treeline's top before it gets to Q */
function crossesTrees(road: Road, v: View, Q: { x: number; y: number; z: number }, iLo: number, iHi: number): boolean {
  const zQ = (Q.x - v.camX) * v.sinG + (Q.z - v.camZ) * v.cosG;
  for (let k = 1; k < 30; k++) {
    const t = k / 30;
    const rx = v.camX + (Q.x - v.camX) * t;
    const ry = v.camY + (Q.y - v.camY) * t;
    const rz = v.camZ + (Q.z - v.camZ) * t;
    const zR = (rx - v.camX) * v.sinG + (rz - v.camZ) * v.cosG;
    if (zQ - zR < THICK) continue;
    // the centre-line node nearest the sample, and how far the sample is across the road from it
    let best = Infinity;
    let j = iLo;
    for (let n = iLo; n <= iHi && n < road.n; n++) {
      const dx = road.x[n] - rx;
      const dz = road.z[n] - rz;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        j = n;
      }
    }
    const phi = road.phi[j];
    const lat = (rx - road.x[j]) * Math.cos(phi) - (rz - road.z[j]) * Math.sin(phi);
    if (Math.abs(lat) > road.railHalf + VERGE && !open(road, j * road.segM) && ry < road.y[j] + TREE) return true;
  }
  return false;
}

/** the screen line of the crest or cliff in front of a thing at depth z over columns x0..x1, worked out from the road's points by brute force (the same as the planner's horizon, but not its code) */
function crestByHand(road: Road, sc: Scenery, v: View, i0: number, N: number, z: number, x0: number, x1: number): number {
  let h = Infinity;
  const seg = road.segM;
  const rail = road.railHalf;
  for (let k = 0; k <= N; k++) {
    const i = i0 + k;
    if (i >= road.n) break;
    pointAt(road, i * seg, 0, tmp);
    if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
    const nz = P.z;
    if (nz < 0.9 || nz >= z) continue;
    h = Math.min(h, P.y);
    const fl = road.flags[i] | (i > 0 ? road.flags[i - 1] : 0);
    for (const side of [-1, 1] as const) {
      if (!(fl & (side < 0 ? ROCK_L : ROCK_R))) continue;
      pointAt(road, i * seg, side * rail, tmp);
      if (!project(v, tmp.x, tmp.y, tmp.z)) continue;
      const xa = P.x;
      pointAt(road, i * seg, side * (rail + sc.rockOut[i]), tmp);
      if (!project(v, tmp.x, tmp.y + sc.rockTop[i], tmp.z)) continue;
      const lo = Math.min(xa, P.x), hi = Math.max(xa, P.x);
      if (hi < x0 || lo > x1) continue;
      h = Math.min(h, P.y);
    }
  }
  return h;
}

/** the world points a listed thing stands on (its base: the feet of a pylon or a tower are both checked) */
function feet(road: Road, sc: Scenery, it: Shown): { x: number; y: number; z: number; lat: number }[] {
  const rail = road.railHalf;
  const at = (s: number, lat: number) => {
    pointAt(road, s, lat, tmp);
    return { x: tmp.x, y: tmp.y, z: tmp.z, lat };
  };
  if (it.what === "prop") {
    const side = it.slot < 2 ? -1 : 1;
    const kd = sc.kind[it.i * 4 + it.slot];
    const lat = kd === 4 ? side * (rail + 1.1) : side * (rail + sc.out[it.i * 4 + it.slot] * 0.25);
    return [at(it.i * road.segM, lat)];
  }
  if (it.what === "sign") {
    const sg = road.signs[it.i];
    return [at(sg.s, sg.side * (rail + 1))];
  }
  if (it.what === "gate") return [at(road.checks[it.i], -(rail + 0.5))];
  const lm = sc.landmarks[it.i];
  if (lm.kind === "pylons" || lm.kind === "towers") return [at(lm.s, -(rail + lm.out)), at(lm.s, rail + lm.out)];
  // the canopy and the grandstand stand back from the rail
  const back = lm.kind === "canopy" ? 7 : lm.kind === "stand" ? 17 : 0;
  return [at(lm.s, lm.side * (rail + lm.out + back))];
}

const LEVELS = [
  { quality: 0, decor: 0 },
  { quality: 2, decor: 2 },
];

describe("cars: the land beside the road hides what is round the bends", () => {
  for (const track of ["canyon", "climb"] as const) {
    describe(`on the ${track}`, () => {
      const road = getRoad(track);
      const sc = getScenery(road);
      const seg = road.segM;
      const lim = Math.min(road.length - 500, 1500);

      it("no roadside thing whose sightline crosses the treeline is listed as fully visible, and none is cut by the trees unless it does", () => {
        const out: Shown[] = [];
        const bad: string[] = [];
        let listed = 0;
        let treeCut = 0;
        for (const L of LEVELS) {
          const N = L.decor > 2 ? 76 : CAM.drawSegs[L.quality];
          for (let carS = 0; carS <= lim; carS += 20) {
            const v = viewAt(road, carS);
            const i0 = Math.max(0, Math.floor((carS - CAM.backM - 10) / seg));
            const n = planRoadside(road, sc, v, carS, i0, N, L.decor, out);
            // whether the sightline to any foot of the thing crosses the trees (the corridor is open ground for the land beside it)
            const crosses = (it: Shown) => {
              for (const Q of feet(road, sc, it)) {
                if (Math.abs(Q.lat) <= road.railHalf + VERGE) continue;
                project(v, Q.x, Q.y, Q.z);
                const iHi = Math.min(i0 + N, Math.floor(P.z > 0 ? (carS + P.z + 40) / seg : 0) + 3, road.n - 1);
                if (crossesTrees(road, v, Q, i0, iHi)) return true;
              }
              return false;
            };
            for (let t = 0; t < n; t++) {
              const it = out[t];
              listed++;
              if (it.clip === Infinity) {
                if (crosses(it)) bad.push(`${it.what} ${it.i} at ${it.z.toFixed(0)} m, car ${carS}, level ${L.decor}: listed whole, its sightline crosses the treeline`);
                continue;
              }
              // cut lower than the crest or cliff in front of it can only be the treeline: its sightline must cross the trees
              if (it.clip < crestByHand(road, sc, v, i0, N, it.z, it.x0, it.x1) - 1e-6) {
                treeCut++;
                if (!crosses(it)) bad.push(`${it.what} ${it.i} at ${it.z.toFixed(0)} m, car ${carS}, level ${L.decor}: cut by the treeline, but its sightline does not cross it`);
              }
            }
          }
        }
        expect(bad.slice(0, 6)).toEqual([]);
        expect(listed).toBeGreaterThan(50);
        expect(treeCut).toBeGreaterThan(0);
      });

      it("the open ground keeps its view: the start's grandstand is listed whole at the start, and a tall mast shows over the trees", () => {
        if (track !== "canyon") return;
        const out: Shown[] = [];
        const v = viewAt(road, 0);
        const n = planRoadside(road, sc, v, 0, 0, CAM.drawSegs[0], 0, out);
        const stand = out.slice(0, n).find((it) => it.what === "landmark" && sc.landmarks[it.i].kind === "stand" && sc.landmarks[it.i].s < 200);
        expect(stand).toBeDefined();
        expect(stand!.clip).toBe(Infinity);
        // a mast is 36 m: somewhere on the way its foot is in the trees and its top above them
        let shownOverTrees = false;
        for (let carS = 0; carS <= lim && !shownOverTrees; carS += 20) {
          const vv = viewAt(road, carS);
          const i0 = Math.max(0, Math.floor((carS - CAM.backM - 10) / seg));
          const m = planRoadside(road, sc, vv, carS, i0, CAM.drawSegs[0], 0, out);
          shownOverTrees = out.slice(0, m).some((it) => it.what === "landmark" && sc.landmarks[it.i].kind === "mast" && it.clip < Infinity);
        }
        expect(shownOverTrees).toBe(true);
      });
    });
  }
});
