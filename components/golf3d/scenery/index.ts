import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { makeHeight } from "./height";
import { buildOcean } from "./ocean";
import { makeTreeKeep } from "./openings";
import { buildRings } from "./rings";
import { sceneryFor } from "./scenes";
import { DEFAULT_SKIN } from "./skin";
import { makeTint } from "./tint";
import type { P, SceneryRecord, Skin, Tier } from "./types";
import { buildWalls } from "./wall";

export { applySkin } from "./skin";
export type { Skin, Tier } from "./types";

export type Prepared = {
  rec: SceneryRecord;
  heightAt: (x: number, z: number) => number;
  tint: ReturnType<typeof makeTint>;
  treeKeep?: (x: number, z: number, h: number) => boolean;
  skin?: Skin;
  /** whether the scene brings its own far mountains (the renderer's default ridge is hidden) */
  rings: boolean;
  /** what it adds: triangles, for the tests and the budget */
  stats: { tris: number; calls: number };
  build: () => { group: THREE.Group; dispose: () => void };
};

/**
 * Everything a hole's backdrop is: the drawn ground (heights and colours), which trees stay, the sky, and the meshes.
 * A hole with no record gets the original hills and nothing else.
 */
export function prepareScenery(hole: BuiltHole, ground: (x: number, z: number) => number, tier: Tier, opts: { reduce?: boolean; sun?: THREE.Vector3 } = {}): Prepared {
  const rec = sceneryFor(hole.def.n);
  const { heightAt, beyond } = makeHeight(hole, ground, rec);
  const tint = makeTint(rec, beyond);
  const treeKeep = makeTreeKeep(hole, rec, beyond);
  const stats = { tris: 0, calls: 0 };
  return {
    rec,
    heightAt,
    tint,
    treeKeep,
    skin: rec.skin,
    rings: !!rec.rings?.length,
    stats,
    build: () => {
      const group = new THREE.Group();
      const disposables: { dispose: () => void }[] = [];
      const add = (m: THREE.Mesh, tris: number) => {
        group.add(m);
        disposables.push(m.geometry, m.material as THREE.Material);
        stats.tris += tris;
        stats.calls++;
      };
      const haze = rec.skin?.haze ?? DEFAULT_SKIN.haze;
      const rings = buildRings(hole, rec, tier, haze);
      if (rings) add(rings, (rings.geometry.attributes.position.count / 3) | 0);
      if (rec.coast) {
        const box = hole.shape.box;
        const mx = (box.x0 + box.x1) / 2, mz = (box.z0 + box.z1) / 2;
        const half = (v: number, c: number) => Math.max(c - 1800, Math.min(c + 1800, v));
        const x0 = half(box.x0 - 945, mx), x1 = half(box.x1 + 945, mx), z0 = half(box.z0 - 945, mz), z1 = half(box.z1 + 945, mz);
        const o = buildOcean(rec.coast, tier, { x0, z0, w: x1 - x0, l: z1 - z0 }, opts.sun ?? new THREE.Vector3(0, 1, 0), !!opts.reduce);
        if (o) {
          group.add(o.mesh);
          disposables.push({ dispose: o.dispose });
          stats.tris += o.tris;
          stats.calls++;
        }
      }
      const w = buildWalls(hole, rec.walls ?? [], heightAt, tier);
      if (w) add(w.mesh, w.tris);
      return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
    },
  };
}
