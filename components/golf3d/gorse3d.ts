import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seeded } from "@/components/offhours/useCanvas";
import type { BuiltHole } from "@/components/offhours/golf/course";

// Gorse as bushes: the paint (areas3d.ts) is the ground under them, and these stand on it, low and rounded with a few
// yellow flowers on the top, one instanced mesh for every gorse area on the hole. A ball in gorse is unplayable
// (course.ts); the bushes only draw it, they stop nothing.

type Tier = "high" | "low" | "soft";
/** metres between bushes on a jittered grid, and how many flowers each carries */
const TIER = { high: { gap: 1.9, bloom: 4, ico: 1 }, low: { gap: 2.6, bloom: 3, ico: 0 }, soft: { gap: 3.4, bloom: 0, ico: 0 } };

const BLOOM = ["#f3d233", "#ffe866"];

const inRing = (ring: [number, number][], x: number, z: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

/** a bush a unit across: a squashed ball of dark leaf with flowers dotted over its top */
function bushGeometry(bloom: number, ico: number) {
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const n = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(hex);
    const a = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < n.attributes.position.count; i++) [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]] = [c.r, c.g, c.b];
    n.setAttribute("color", new THREE.BufferAttribute(a, 3));
    n.deleteAttribute("uv");
    return n;
  };
  const parts: THREE.BufferGeometry[] = [paint(new THREE.IcosahedronGeometry(0.5, ico).scale(1, 0.62, 1).translate(0, 0.14, 0), "#2d612e")];
  for (let i = 0; i < bloom; i++) {
    const a = i * 2.4 + 0.7, r = 0.1 + 0.3 * ((i * 0.37) % 1);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // on the top of the dome
    const y = 0.14 + 0.62 * 0.5 * Math.sqrt(Math.max(0, 1 - (2 * r) ** 2)) + 0.01;
    parts.push(paint(new THREE.OctahedronGeometry(0.055).translate(x, y, z), BLOOM[i & 1]));
  }
  return mergeGeometries(parts)!;
}

export function buildGorse(hole: BuiltHole, ground: { y: (x: number, z: number) => number }, tier: Tier, disposables: { dispose: () => void }[]): THREE.InstancedMesh | null {
  const rings = hole.areas.filter((a) => a.kind === "gorse");
  if (!rings.length) return null;
  const T = TIER[tier];
  const rnd = seeded(hole.def.n * 313 + 5);
  type B = { x: number; z: number; w: number; h: number; rot: number; tint: number };
  const list: B[] = [];
  for (const a of rings) {
    const xs = a.ring.map((p) => p[0]), zs = a.ring.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    for (let z = z0; z <= z1; z += T.gap)
      for (let x = x0; x <= x1; x += T.gap) {
        const bx = x + (rnd() - 0.5) * T.gap * 0.9, bz = z + (rnd() - 0.5) * T.gap * 0.9;
        // a bunker or pond that cuts the field, or the field's own edge: nothing grows there
        if (!inRing(a.ring, bx, bz) || hole.surfaceAt(bx, bz) !== "gorse") continue;
        const w = 1.5 + rnd() * 1.3;
        list.push({ x: bx, z: bz, w, h: 0.7 + rnd() * 0.55, rot: rnd() * 6.28, tint: rnd() });
      }
  }
  if (!list.length) return null;
  const geo = bushGeometry(T.bloom, T.ico);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  disposables.push(geo, mat);
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    sc.set(b.w, b.h / 0.62 / 1.0, b.w);
    p.set(b.x, ground.y(b.x, b.z) - 0.05, b.z);
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(p, q, sc));
    // a little lighter or darker bush to bush (the flowers keep their yellow in step)
    const k = 0.78 + b.tint * 0.3;
    c.setRGB(k, k * 1.03, k * 0.95);
    mesh.setColorAt(i, c);
  });
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.gorse = list.length;
  return mesh;
}
