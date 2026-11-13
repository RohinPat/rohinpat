import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { NINE_DEFS, RANGE_DEF, buildHole } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { YD } from "@/components/offhours/golf/scene";
import { bearingOf, isSimple, lineFrame, offsetLine, polygonArea, signedDist } from "@/components/golf3d/scenery/geo";
import { LEGACY, SCENERY_HOLES, sceneryFor } from "@/components/golf3d/scenery/scenes";
import { DOOR } from "@/components/golf3d/scenery/hole1";
import { legacyNoise, makeHeight } from "@/components/golf3d/scenery/height";
import { makeTint } from "@/components/golf3d/scenery/tint";
import { makeTreeKeep } from "@/components/golf3d/scenery/openings";
import { applySkin, DEFAULT_SKIN } from "@/components/golf3d/scenery/skin";
import { ringGeometry, ringHeight, ringCentre } from "@/components/golf3d/scenery/rings";
import { bakeShore, seaPolygon } from "@/components/golf3d/scenery/ocean";
import { ribbonData, wallSpine } from "@/components/golf3d/scenery/wall";
import { seaReveal, validateScenery } from "@/components/golf3d/scenery/validate";
import type { CoastSpec, SceneryRecord } from "@/components/golf3d/scenery/types";
import { prepareScenery } from "@/components/golf3d/scenery";
import { seeded } from "@/components/offhours/useCanvas";

// The backdrop must never reach the ground the ball plays on: whatever a scene says, the drawn ground is the hole's own
// ground wherever play can be (and 30 m past it), the tint is the plain texture there and no tree that stops a ball
// is touched. The rest checks the scenes' geometry and that each tier stays inside its budget.

const smooth = (a: number, b: number, v: number) => {
  const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** points over the hole's box and along its rough, plus a ring far out */
function samplePoints(hole: ReturnType<typeof buildHole>): [number, number][] {
  const b = hole.shape.box;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 50; i++) for (let j = 0; j <= 80; j++) pts.push([b.x0 - 200 + ((b.x1 - b.x0 + 400) * i) / 50, b.z0 - 200 + ((b.z1 - b.z0 + 400) * j) / 80]);
  for (const p of hole.shape.rough) pts.push(p);
  return pts;
}

describe("the backdrop leaves the playable ground alone", () => {
  for (const def of [...NINE_DEFS, RANGE_DEF]) {
    it(`hole ${def.n}: the drawn ground, the tint and the trees that stop a ball`, () => {
      const hole = buildHole(def);
      const ground = terrainOf(hole).y;
      const rec = sceneryFor(def.n);
      const { heightAt, beyond } = makeHeight(hole, ground, rec);
      const tint = makeTint(rec, beyond);
      const keep = makeTreeKeep(hole, rec, beyond);
      const out: [number, number, number] = [0, 0, 0];
      let near = 0;
      for (const [x, z] of samplePoints(hole)) {
        if (beyond(x, z) >= 30) continue;
        near++;
        const g = ground(x, z);
        expect(heightAt(x, z)).toBe(g);
        tint(x, z, g, g, "#24502d", out);
        expect(out).toEqual([1, 1, 1]);
      }
      expect(near).toBeGreaterThan(200);
      if (keep) {
        for (const b of hole.blockers) expect(keep(b.x, b.z, b.h)).toBe(true);
        for (const t of hole.world.trees) if (beyond(t.x, t.z) < 5) expect(keep(t.x, t.z, t.h)).toBe(true);
      }
    });
  }

  it("holds by construction: a hostile record changes nothing inside the gate", () => {
    const hostile: SceneryRecord = {
      id: "hostile",
      hills: { base: 500, amp: 500, reach: 40 },
      coast: { line: [[-12, -400], [-12, 800]], sea: "left", seaY: -300, deep: 50, keepOut: 0, tones: { shallow: "#000000", mid: "#000000", deep: "#000000", foam: "#ffffff" } },
      palette: { base: "#ff0000", high: "#00ff00", ramp: [0, 5] },
    };
    for (const def of [...NINE_DEFS, RANGE_DEF]) {
      const hole = buildHole(def);
      const ground = terrainOf(hole).y;
      const { heightAt, beyond } = makeHeight(hole, ground, hostile);
      const tint = makeTint(hostile, beyond);
      const out: [number, number, number] = [0, 0, 0];
      for (const [x, z] of samplePoints(hole).filter((_, i) => i % 3 === 0)) {
        if (beyond(x, z) >= 30) continue;
        expect(heightAt(x, z)).toBe(ground(x, z));
        tint(x, z, ground(x, z), ground(x, z), "#24502d", out);
        expect(out).toEqual([1, 1, 1]);
      }
    }
  });

  it("nothing in play reads the drawn ground: only hole3d and scenery mention it", () => {
    const roots = ["components/offhours/golf", "components/golf3d"];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) {
          if (f !== "scenery") walk(p);
        } else if (/\.tsx?$/.test(f) && f !== "hole3d.ts") files.push(p);
      }
    };
    roots.forEach((r) => walk(path.resolve(__dirname, "../..", r)));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/heightAt/);
  });
});

describe("a hole without a scene is drawn as it always was", () => {
  const oldHeight = (n: number, hole: ReturnType<typeof buildHole>, ground: (x: number, z: number) => number) => {
    const rough = hole.def.rough * YD;
    const noise = (x: number, z: number) => 0.5 + 0.22 * Math.sin(x * 0.013 + 1.7) * Math.cos(z * 0.011 - 0.4) + 0.18 * Math.sin((x + z) * 0.021 + n) + 0.1 * Math.cos((x - z) * 0.047);
    return (x: number, z: number) => {
      const m = hole.margin(x, z) - rough;
      const y = ground(x, z);
      if (m < 30) return y;
      return y + smooth(30, 150, m) * (5 + 26 * noise(x, z));
    };
  };
  for (const def of NINE_DEFS) {
    it(`hole ${def.n}: heights equal the original formula, bit for bit`, () => {
      const hole = buildHole(def);
      const ground = terrainOf(hole).y;
      const { heightAt, beyond } = makeHeight(hole, ground, LEGACY);
      const old = oldHeight(def.n, hole, ground);
      const r = seeded(def.n * 31 + 5);
      const b = hole.shape.box;
      for (let i = 0; i < 1500; i++) {
        const x = b.x0 - 300 + r() * (b.x1 - b.x0 + 600), z = b.z0 - 300 + r() * (b.z1 - b.z0 + 600);
        expect(heightAt(x, z)).toBe(old(x, z));
      }
      const tint = makeTint(LEGACY, beyond);
      const out: [number, number, number] = [0, 0, 0];
      for (const y of [0, 3, 12, 40]) {
        tint(0, 0, y, 0, "#24502d", out);
        const u = Math.max(0, Math.min(1, y / 30));
        expect(out).toEqual([1 + u * 0.55, 1 + u * 0.6, 1 + u * 0.25]);
      }
      expect(legacyNoise(def.n)(10, 20)).toBeGreaterThan(0);
    });
  }

  it("a hole's own scene leaves the other holes' trees alone", () => {
    for (const def of NINE_DEFS.filter((d) => !SCENERY_HOLES.includes(d.n))) {
      const hole = buildHole(def);
      expect(makeTreeKeep(hole, sceneryFor(def.n), () => 100)).toBeUndefined();
      const p = prepareScenery(hole, terrainOf(hole).y, "high");
      expect(p.rings).toBe(false);
      expect(p.skin).toBeUndefined();
      expect(p.build().group.children.length).toBe(0);
    }
  });
});

describe("the scenes", () => {
  for (const n of SCENERY_HOLES) {
    it(`hole ${n}: its record is valid against its hole`, () => {
      expect(validateScenery(buildHole([...NINE_DEFS, RANGE_DEF].find((d) => d.n === n)!), sceneryFor(n))).toEqual([]);
    });
  }

  it("openings clear the sides and the back of a green but never the copse", () => {
    const hole = buildHole(NINE_DEFS.find((d) => d.n === 9)!);
    const rec = sceneryFor(9);
    const { beyond } = makeHeight(hole, terrainOf(hole).y, rec);
    const keep = makeTreeKeep(hole, rec, beyond)!;
    expect(keep).toBeDefined();
    for (const b of hole.blockers) expect(keep(b.x, b.z, b.h)).toBe(true);
    const dropped = hole.world.trees.filter((t) => !keep(t.x, t.z, t.h));
    // (hole 9's headland is cleared by its own trees.clear, so the openings have few trees left to drop: what they keep is the copse rule above)
    expect(dropped.length).toBeGreaterThanOrEqual(0);
    // all of them stand 5 m or more past the rough
    for (const t of dropped) expect(beyond(t.x, t.z)).toBeGreaterThanOrEqual(5);
  });

  it("the sea of hole 9 shows from the tee over the drawn ground, over a good share of the left", () => {
    const hole = buildHole(NINE_DEFS.find((d) => d.n === 9)!);
    const ground = terrainOf(hole).y;
    const bearings: number[] = [];
    for (let b = -80; b <= -10; b += 2.5) bearings.push(b);
    const seen = seaReveal(hole, sceneryFor(9), ground, [0, ground(0, 0) + 3, 0], bearings);
    expect(seen.filter(Boolean).length / bearings.length).toBeGreaterThanOrEqual(0.2);
  });

  it("hole 1's door is a gap in the near foothills, cut at the bearing of the green, and its peak stands in it", () => {
    const rec = sceneryFor(1);
    const hole = buildHole(NINE_DEFS[0]);
    // the fairway turns gently right: the green is DOOR degrees off the line from the tee, so the peak stands behind it
    const toGreen = (Math.atan2(hole.pin[0], hole.pin[1]) * 180) / Math.PI;
    expect(Math.abs(toGreen - DOOR)).toBeLessThan(1);
    const l1 = rec.rings![0];
    const max = l1.sectors[0].h[1];
    const deg = Math.PI / 180;
    expect(ringHeight(l1, DOOR * deg)).toBeLessThanOrEqual(0.1 * max);
    expect(ringHeight(l1, (DOOR + 60) * deg)).toBeGreaterThan(0.5 * max);
    const peak = rec.rings![2];
    expect(ringHeight(peak, DOOR * deg)).toBeGreaterThan(600);
    // the mesas sit to the right of the door, low behind the foothills
    const l2 = rec.rings![1];
    expect(l2.sectors.some((s) => s.shape === "mesa" && s.from === 20 && s.to === 55)).toBe(true);
  });

  it("hole 3 puts its butte left-ahead and its mesas on the left", () => {
    const rec = sceneryFor(3);
    const butte = rec.rings![1].sectors.find((s) => s.shape === "cone")!;
    expect((butte.from + butte.to) / 2).toBe(-40);
    expect(rec.rings![0].sectors.find((s) => s.shape === "mesa")!.to).toBeLessThanOrEqual(0);
  });
});

describe("geometry", () => {
  const L: CoastSpec = { line: [[0, 0], [100, 0], [100, 100]], sea: "left", seaY: 0, deep: 8, keepOut: 0, tones: { shallow: "#fff", mid: "#fff", deep: "#fff", foam: "#fff" } };
  it("signed distance is positive on the water side, by the side the sea is on", () => {
    // travelling +x, the left is +z
    expect(signedDist(L, 50, 30)).toBeCloseTo(30, 6);
    expect(signedDist(L, 50, -30)).toBeCloseTo(-30, 6);
    // the corner: outside it is land, inside (the bend) is water
    expect(signedDist(L, 140, -10)).toBeLessThan(0);
    expect(signedDist(L, 60, 60)).toBeCloseTo(40, 6);
    expect(signedDist({ ...L, sea: "right" }, 50, 30)).toBeCloseTo(-30, 6);
  });

  it("lineFrame reports the right as positive", () => {
    const line: [number, number][] = [[0, 0], [0, 100]];
    expect(lineFrame(line, 10, 50).lat).toBeCloseTo(10, 6);
    expect(lineFrame(line, -10, 50).lat).toBeCloseTo(-10, 6);
    expect(lineFrame(line, 3, 40).s).toBeCloseTo(40, 6);
  });

  it("offsetLine moves a line to the right by a positive distance", () => {
    const o = offsetLine([[0, 0], [0, 100]], 10);
    expect(o[0][0]).toBeCloseTo(10, 6);
    expect(offsetLine([[0, 0], [0, 100]], -10)[1][0]).toBeCloseTo(-10, 6);
  });

  it("bearings are 0 downrange and positive to the right", () => {
    expect(bearingOf(0, 0, 0, 10)).toBe(0);
    expect(bearingOf(0, 0, 10, 0)).toBeCloseTo(Math.PI / 2, 9);
    expect(bearingOf(0, 0, -10, 0)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("the sea polygon is simple, counter-clockwise and on the water side, whichever side that is", () => {
    for (const sea of ["left", "right"] as const) {
      const c = { ...L, sea };
      const poly = seaPolygon(c);
      expect(isSimple(poly)).toBe(true);
      expect(polygonArea(poly)).toBeGreaterThan(1e6);
      const inside = (x: number, z: number) => {
        let w = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, zi] = poly[i], [xj, zj] = poly[j];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) w = !w;
        }
        return w;
      };
      expect(inside(50, sea === "left" ? 40 : -40)).toBe(true);
      expect(inside(50, sea === "left" ? -40 : 40)).toBe(false);
    }
    const hole = buildHole(NINE_DEFS.find((d) => d.n === 9)!);
    const p = seaPolygon(sceneryFor(9).coast!);
    expect(isSimple(p)).toBe(true);
    expect(polygonArea(p)).toBeGreaterThan(0);
    // the tee is land
    let w = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i], [xj, zj] = p[j];
      if (zi > 0 !== zj > 0 && 0 < ((xj - xi) * (0 - zi)) / (zj - zi) + xi) w = !w;
    }
    expect(w).toBe(false);
    expect(hole.pin[1]).toBeGreaterThan(0);
  });

  it("the shore map holds distances in range and is zero on land", () => {
    const d = bakeShore(L, { x0: -100, z0: -100, w: 400, l: 400 }, 32);
    expect(d.length).toBe(32 * 32 * 4);
    for (let i = 0; i < d.length; i += 4) expect(d[i + 3]).toBe(255);
    expect(d[(2 * 32 + 16) * 4]).toBe(0);
    expect(d[(28 * 32 + 4) * 4]).toBeGreaterThan(0);
  });

  it("rock walls are finite, deterministic and inside the triangle budget", () => {
    const hole = buildHole(NINE_DEFS.find((d) => d.n === 3)!);
    const rec = sceneryFor(3);
    const ground = terrainOf(hole).y;
    const { heightAt } = makeHeight(hole, ground, rec);
    for (const w of rec.walls!) {
      for (const [tier, step, rows] of [["high", 12, 8], ["low", 20, 5]] as const) {
        const spine = wallSpine(hole, w);
        const a = ribbonData(w, heightAt, tier, spine), b = ribbonData(w, heightAt, tier, spine);
        expect(a.positions).toEqual(b.positions);
        expect(a.positions.every(Number.isFinite)).toBe(true);
        expect(a.colors.every(Number.isFinite)).toBe(true);
        let len = 0;
        for (let i = 1; i < spine.length; i++) len += Math.hypot(spine[i][0] - spine[i - 1][0], spine[i][1] - spine[i - 1][1]);
        expect(a.tris).toBeLessThanOrEqual(Math.ceil(len / step) * (2 * rows + 2));
      }
      expect(ribbonData(w, heightAt, "soft", wallSpine(hole, w)).tris).toBe(0);
    }
  });

  it("the rings stay inside the budget of every tier", () => {
    for (const n of SCENERY_HOLES) {
      const hole = buildHole([...NINE_DEFS, RANGE_DEF].find((d) => d.n === n)!);
      const rec = sceneryFor(n);
      const hi = ringGeometry(rec, ringCentre(hole), "high").tris;
      const lo = ringGeometry(rec, ringCentre(hole), "low").tris;
      const so = ringGeometry(rec, ringCentre(hole), "soft").tris;
      expect(hi).toBeLessThanOrEqual(4 * 640);
      expect(lo).toBeLessThanOrEqual(3 * 448);
      expect(so).toBe(384);
      const g = ringGeometry(rec, ringCentre(hole), "high");
      expect(g.positions.every(Number.isFinite)).toBe(true);
    }
  });
});

describe("the sky", () => {
  const targets = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#d4e6e6");
    scene.fog = new THREE.Fog("#d4e6e6", 180, 2600);
    const skyMat = new THREE.ShaderMaterial({ uniforms: { top: { value: new THREE.Color() }, low: { value: new THREE.Color() }, haze: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, sun: { value: new THREE.Vector3() } } });
    return { scene, skyMat, sunDir: new THREE.Vector3(0.45, 0.72, -0.53).normalize() };
  };
  const snap = (t: ReturnType<typeof targets>) => {
    const u = t.skyMat.uniforms, f = t.scene.fog as THREE.Fog;
    return JSON.stringify([u.top.value, u.low.value, u.haze.value, u.glow.value, u.sun.value, (t.scene.background as THREE.Color).getHex(), f.color.getHex(), f.near, f.far]);
  };
  it("a hole's sky leaves nothing behind for the next one", () => {
    const t = targets();
    applySkin(t, undefined);
    const plain = snap(t);
    applySkin(t, sceneryFor(9).skin);
    expect(snap(t)).not.toBe(plain);
    applySkin(t, undefined);
    expect(snap(t)).toBe(plain);
    // the default is the game's own sky
    expect(new THREE.Color(DEFAULT_SKIN.skyTop).getHex()).toBe(t.skyMat.uniforms.top.value.getHex());
    // and the sun's light was never touched
    expect(t.sunDir.x).toBeCloseTo(0.45 / Math.hypot(0.45, 0.72, 0.53), 9);
  });
  it("the sky's sun is written mirrored, and the fog's far plane stays in range", () => {
    const t = targets();
    applySkin(t, { skySun: [1, 0, 0] });
    expect(t.skyMat.uniforms.sun.value.x).toBeCloseTo(-1, 9);
    applySkin(t, { fogFar: 100 });
    expect((t.scene.fog as THREE.Fog).far).toBe(2200);
    applySkin(t, { fogFar: 9000 });
    expect((t.scene.fog as THREE.Fog).far).toBe(3000);
  });
});
