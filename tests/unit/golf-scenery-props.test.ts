import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NINE_DEFS, buildHole } from "@/components/offhours/golf/course";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { YD } from "@/components/offhours/golf/scene";
import { signedDist } from "@/components/golf3d/scenery/geo";
import { GATE, makeHeight } from "@/components/golf3d/scenery/height";
import { STACK_TRIS, buildProps, placeLighthouse, placeStacks } from "@/components/golf3d/scenery/props";
import { sceneryFor } from "@/components/golf3d/scenery/scenes";
import type { SceneryRecord } from "@/components/golf3d/scenery/types";

// Props (sea stacks, a lighthouse) stand only outside the gate, stacks in the water and the lighthouse on land at the lip.

const hole9 = buildHole(NINE_DEFS.find((d) => d.n === 9)!);
const rec9 = sceneryFor(9);
const beyondOf = (hole: ReturnType<typeof buildHole>, x: number, z: number) => hole.margin(x, z) - hole.def.rough * YD;

/** a coast with the sea on the right (east of the hole) and a shallow basin */
const rightSea: SceneryRecord = {
  id: "synthetic-right",
  coast: { line: [[300, -300], [300, 700]], sea: "right", seaY: -4, deep: 6, keepOut: 0, tones: { shallow: "#6fc1c0", mid: "#3f95a8", deep: "#1f5f86", foam: "#ffffff" } },
  props: { stacks: { count: 6, seed: 4, sd: [30, 120] }, lighthouse: { bearing: 40, distance: 400 } },
};

describe("sea stacks", () => {
  it("hole 9: on the sea side, in the sd range, outside the gate, apart, deterministic", () => {
    const at = placeStacks(hole9, rec9, 7);
    expect(at.length).toBeGreaterThanOrEqual(5);
    for (const s of at) {
      const sd = signedDist(rec9.coast!, s.x, s.z);
      expect(sd).toBeGreaterThanOrEqual(30);
      expect(sd).toBeLessThanOrEqual(150);
      expect(beyondOf(hole9, s.x, s.z)).toBeGreaterThan(GATE + 50);
    }
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) expect(Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z)).toBeGreaterThan(30);
    expect(placeStacks(hole9, rec9, 7)).toEqual(at);
  });
  it("a coast with the sea on the right and a shallow basin works too", () => {
    const at = placeStacks(hole9, rightSea, 6);
    expect(at.length).toBeGreaterThanOrEqual(3);
    for (const s of at) {
      expect(s.x).toBeGreaterThan(300);
      expect(signedDist(rightSea.coast!, s.x, s.z)).toBeGreaterThanOrEqual(30);
      expect(beyondOf(hole9, s.x, s.z)).toBeGreaterThan(GATE);
    }
  });
});

describe("the lighthouse", () => {
  it("hole 9: on land at the lip, outside the gate, toward the bearing", () => {
    const p = placeLighthouse(hole9, rec9)!;
    expect(p).toBeTruthy();
    const sd = signedDist(rec9.coast!, p[0], p[1]);
    expect(sd).toBeLessThan(0);
    expect(sd).toBeGreaterThan(-20);
    expect(beyondOf(hole9, p[0], p[1])).toBeGreaterThan(GATE + 45);
    const brg = (Math.atan2(p[0] - hole9.pin[0], p[1] - hole9.pin[1]) * 180) / Math.PI;
    // (the lighthouse stands behind the flag, bearing -8 from the pin, as the record asks)
    expect(Math.abs(brg + 8)).toBeLessThan(25);
    expect(placeLighthouse(hole9, rec9)).toEqual(p);
  });
  it("the sea-on-the-right coast puts it on land on the right", () => {
    const p = placeLighthouse(hole9, rightSea)!;
    expect(signedDist(rightSea.coast!, p[0], p[1])).toBeLessThan(0);
    expect(p[0]).toBeLessThan(300);
    expect(beyondOf(hole9, p[0], p[1])).toBeGreaterThan(GATE);
  });
  it("an explicit position is used as given", () => {
    expect(placeLighthouse(hole9, { ...rec9, props: { lighthouse: { at: [10, 20] } } })).toEqual([10, 20]);
  });
});

describe("buildProps", () => {
  const { heightAt } = makeHeight(hole9, terrainOf(hole9).y, rec9);
  const run = (tier: "high" | "low" | "soft") => buildProps(hole9, rec9, heightAt, tier)!;
  it("budgets per tier", () => {
    const hi = run("high"), lo = run("low"), so = run("soft");
    // (three calls: the stacks, the lighthouse and hole 9's clubhouse, each one mesh)
    expect(hi.calls).toBe(3);
    // (the clubhouse's posts, windows and roof are about 250 of these triangles: the cap is for the whole of hole 9's props)
    expect(hi.tris).toBeLessThanOrEqual(1300);
    expect(lo.calls).toBe(3);
    expect(lo.tris).toBeLessThan(hi.tris);
    // (the low tier keeps the clubhouse too, about 250 triangles, so its cap is the old one plus that)
    expect(lo.tris).toBeLessThanOrEqual(1200 / 2 + 200 + 250);
    // (soft: the lighthouse and the clubhouse, one mesh each, and no stacks)
    expect(so.calls).toBe(2);
    expect(so.tris).toBeLessThanOrEqual(150 + 300);
    expect(hi.tris).toBe(placeStacks(hole9, rec9, 7).length * STACK_TRIS + so.tris);
  });
  it("is empty without props and deterministic with them", () => {
    expect(buildProps(hole9, { ...rec9, props: undefined }, heightAt, "high")).toBeNull();
    const a = run("high"), b = run("high");
    const mesh = (r: ReturnType<typeof run>) => r.group.children.find((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)!;
    expect(Array.from(mesh(a).instanceMatrix.array)).toEqual(Array.from(mesh(b).instanceMatrix.array));
  });
  it("the lighthouse stands on the ground and the stacks on the sea", () => {
    const r = run("high");
    const light = r.group.children.find((c) => !(c instanceof THREE.InstancedMesh))!;
    expect(light.position.y).toBeLessThanOrEqual(heightAt(light.position.x, light.position.z) + 1e-6);
    const st = r.group.children.find((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)!;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    for (let i = 0; i < st.count; i++) {
      st.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      expect(v.y).toBeCloseTo(rec9.coast!.seaY + 0.15, 3);
    }
  });
  it("dispose frees every geometry and material", () => {
    const r = run("high");
    let freed = 0;
    r.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.addEventListener("dispose", () => freed++);
        (o.material as THREE.Material).addEventListener("dispose", () => freed++);
      }
    });
    const inst = r.group.children.find((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)!;
    let instFreed = false;
    inst.addEventListener("dispose", () => (instFreed = true));
    r.dispose();
    // (three meshes, each with a geometry and a material: the clubhouse is the third)
    expect(freed).toBe(6);
    expect(instFreed).toBe(true);
  });
});
