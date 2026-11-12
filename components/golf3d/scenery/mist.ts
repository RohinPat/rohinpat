import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { hash1, smooth } from "./geo";
import { ringCentre } from "./rings";
import type { MistSpec, Tier } from "./types";

// Phase 3: low banks of mist lying round the hole, beyond the trees (hole 4's morning). Each layer is an open ring (a
// wall of quads) whose soft edge comes from a small DataTexture: banks of different heights along the ring, thickest at
// the ground and gone by the top. One transparent mesh for every layer, drawn after the trees and the terrain. It
// drifts round the middle of the hole very slowly; with reduced motion it stays where it is. Only the top tier has it.

/** ring segments per layer, 0 where the tier has no mist */
export const MIST_SEGS: Record<Tier, number> = { high: 48, low: 0, soft: 0 };
export const MIST_LAYERS = 3;
/** how far below the hole's ground a ring starts, so the ground always meets it */
const BELOW = 40;
/** radians a second */
export const MIST_DRIFT = 0.0022;
const TW = 64, TH = 32;

/** the angle the mist has drifted by `now` ms in; nothing under reduced motion */
export const mistAngle = (nowMs: number, reduce: boolean) => (reduce ? 0 : (nowMs / 1000) * MIST_DRIFT);

/** the strength of the mist at a point of its texture: u round the ring (it wraps), v 0 at the hole's ground to 1 at the top */
export function mistAlpha(u: number, v: number, seed = 1): number {
  const a = u * Math.PI * 2;
  const bank = 0.5 + 0.5 * (0.5 * Math.sin(a * 3 + seed * 1.7) + 0.3 * Math.sin(a * 7 + seed * 0.9) + 0.2 * Math.sin(a * 13 + seed * 2.3));
  // a tall bank reaches the top of the ring, a thin one stays low; between banks it thins out
  const top = 0.3 + 0.7 * smooth(0.1, 0.9, bank);
  const body = 1 - smooth(0.12, top, v);
  return Math.max(0, Math.min(1, body * (0.35 + 0.65 * smooth(0.05, 0.6, bank))));
}

export function mistTexture(seed = 1): THREE.DataTexture {
  const data = new Uint8Array(TW * TH * 4);
  for (let j = 0; j < TH; j++)
    for (let i = 0; i < TW; i++) {
      const q = (j * TW + i) * 4;
      data[q] = data[q + 1] = data[q + 2] = 255;
      data[q + 3] = Math.round(mistAlpha(i / TW, j / (TH - 1), seed) * 255);
    }
  const tex = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** a round soft blob of white (alpha falls from the middle), for the spray at the foot of a waterfall */
export function blobTexture(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const r = Math.hypot((i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5) * 2;
      const q = (j * n + i) * 4;
      data[q] = data[q + 1] = data[q + 2] = 255;
      data[q + 3] = Math.round((1 - smooth(0.15, 1, r)) * 255);
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** the rings as triangle data, centred on (0, 0) at y = 0 (the mesh is placed at the hole's middle and ground) */
export function mistGeometry(spec: MistSpec, tier: Tier): { positions: Float32Array; uvs: Float32Array; colors: Float32Array; tris: number } {
  const S = MIST_SEGS[tier];
  const layers = S ? spec.layers.slice(0, MIST_LAYERS) : [];
  const tris = layers.length * S * 4;
  const positions = new Float32Array(tris * 9), uvs = new Float32Array(tris * 6), colors = new Float32Array(tris * 12);
  const c = new THREE.Color(spec.color);
  let k = 0;
  const v = (x: number, y: number, z: number, u: number, w: number, a: number) => {
    positions.set([x, y, z], k * 3);
    uvs.set([u, w], k * 2);
    colors.set([c.r, c.g, c.b, a], k * 4);
    k++;
  };
  layers.forEach((l, li) => {
    // each ring starts its banks somewhere else, so the layers do not line up
    const off = hash1(li, (spec.seed ?? 1) + 5);
    for (let i = 0; i < S; i++) {
      const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
      const x0 = Math.sin(a0) * l.radius, z0 = Math.cos(a0) * l.radius, x1 = Math.sin(a1) * l.radius, z1 = Math.cos(a1) * l.radius;
      const u0 = i / S + off, u1 = (i + 1) / S + off;
      // under the hole's ground the ring is full strength (so it always meets the ground); from there it thins to the top
      const lo = -BELOW, hi = l.top;
      v(x0, lo, z0, u0, 0, l.alpha); v(x1, lo, z1, u1, 0, l.alpha); v(x0, 0, z0, u0, 0, l.alpha);
      v(x1, lo, z1, u1, 0, l.alpha); v(x1, 0, z1, u1, 0, l.alpha); v(x0, 0, z0, u0, 0, l.alpha);
      v(x0, 0, z0, u0, 0, l.alpha); v(x1, 0, z1, u1, 0, l.alpha); v(x0, hi, z0, u0, 1, l.alpha);
      v(x1, 0, z1, u1, 0, l.alpha); v(x1, hi, z1, u1, 1, l.alpha); v(x0, hi, z0, u0, 1, l.alpha);
    }
  });
  return { positions, uvs, colors, tris };
}

export type Mist = { mesh: THREE.Mesh; tris: number; dispose: () => void };

export function buildMist(hole: BuiltHole, spec: MistSpec | undefined, groundAt: (x: number, z: number) => number, tier: Tier, reduce: boolean): Mist | null {
  if (!spec || !MIST_SEGS[tier]) return null;
  const d = mistGeometry(spec, tier);
  if (!d.tris) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(d.uvs, 2));
  g.setAttribute("color", new THREE.BufferAttribute(d.colors, 4));
  const tex = mistTexture(spec.seed ?? 1);
  const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  const [cx, cz] = ringCentre(hole);
  mesh.position.set(cx, groundAt(cx, cz), cz);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  if (!reduce) mesh.onBeforeRender = () => (mesh.rotation.y = mistAngle(performance.now(), false));
  return { mesh, tris: d.tris, dispose: () => [g, m, tex].forEach((x) => x.dispose()) };
}
