import * as THREE from "three";
import { seeded } from "@/components/offhours/useCanvas";
import type { BuiltHole } from "@/components/offhours/golf/course";

// The standing part of a hole's waste and fescue (areas3d.ts paints the ground under them): sandy scrub, a scatter of
// low grey-green bushes with dry grass and the odd stone, and long grass, tufts of tall tapering blades that lean out.
// Each kind is one InstancedMesh (so +2 draw calls however many areas a hole has), placed on a jittered grid inside its
// areas wherever hole.surfaceAt agrees, so a bunker or a green cut out of a field stays clear. The "soft" tier (no GPU)
// draws the paint alone.

type Tier = "high" | "low" | "soft";

/** most instances per tier: [scrub, tufts] */
const CAP: Record<Tier, [number, number]> = { high: [300, 2000], low: [150, 900], soft: [0, 0] };
/** square metres of area per bush and per tuft before the cap */
const PER_BUSH = 10, PER_TUFT = 1.5;

export type Scrub = { group: THREE.Group; calls: number; tris: number; dispose: () => void };

/** a vertex-coloured triangle soup, flat shaded */
class Soup {
  pos: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], ca: THREE.Color, cb = ca, cc = ca) {
    this.pos.push(...a, ...b, ...c);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.computeVertexNormals();
    return g;
  }
  get tris() {
    return this.pos.length / 9;
  }
}

/** a tuft of long grass: tall tapering blades from one point, leaning outward and curling over, dark at the root and pale at the tip */
function tuftGeometry() {
  const r = seeded(11);
  const s = new Soup();
  const root = [new THREE.Color("#857a3a"), new THREE.Color("#93883f"), new THREE.Color("#7a7a3c")];
  const tip = [new THREE.Color("#e6d98c"), new THREE.Color("#d4c677"), new THREE.Color("#b9bd68"), new THREE.Color("#efe4a0")];
  const N = 5;
  for (let k = 0; k < N; k++) {
    const ang = (k / N) * Math.PI * 2 + r() * 0.8;
    const h = 0.4 + r() * 0.26;
    const lean = h * (0.28 + r() * 0.3);
    const w = 0.065 + r() * 0.03;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    // the blade's width runs across its lean
    const wx = -dz * w, wz = dx * w;
    const bx = dx * 0.05, bz = dz * 0.05;
    const c0 = root[k % root.length], c1 = tip[Math.floor(r() * tip.length)];
    s.tri([bx - wx, 0, bz - wz], [bx + wx, 0, bz + wz], [bx + dx * lean, h, bz + dz * lean], c0, c0, c1);
  }
  return s;
}

/** a low bush of sandy scrub: a squashed, lumpy dome with a few stalks of dry grass and a stone beside it */
function scrubGeometry() {
  const r = seeded(7);
  const s = new Soup();
  const ico = new THREE.IcosahedronGeometry(0.5, 0);
  const p = ico.attributes.position.array as Float32Array;
  const dark = new THREE.Color("#6c7345"), lit = new THREE.Color("#8d9663"), pale = new THREE.Color("#a9ad7a");
  // every corner of the icosahedron is pulled the same way wherever it appears, so the dome has no cracks
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const memo = new Map<string, [number, number, number]>();
  const lump = (x: number, y: number, z: number): [number, number, number] => {
    const k = key(x, y, z);
    let v = memo.get(k);
    if (!v) {
      const f = 0.82 + r() * 0.36;
      v = [x * f * 1.3, Math.max(0, y * f * 0.5 + 0.06), z * f * 1.3];
      memo.set(k, v);
    }
    return v;
  };
  for (let i = 0; i < p.length; i += 9) {
    const a = lump(p[i], p[i + 1], p[i + 2]), b = lump(p[i + 3], p[i + 4], p[i + 5]), c = lump(p[i + 6], p[i + 7], p[i + 8]);
    const top = (a[1] + b[1] + c[1]) / 3 > 0.14;
    s.tri(a, b, c, top ? lit : dark, top ? lit : dark, top ? pale : dark);
  }
  // stalks: thin blades of dry grass standing out of the bush
  const straw = [new THREE.Color("#cdb97a"), new THREE.Color("#b8a463"), new THREE.Color("#dccb8c")];
  for (let k = 0; k < 8; k++) {
    const ang = r() * Math.PI * 2, rad = 0.05 + r() * 0.4, h = 0.45 + r() * 0.45, lean = 0.12 + r() * 0.28;
    const dx = Math.cos(ang), dz = Math.sin(ang), x = dx * rad, z = dz * rad, w = 0.035;
    const c = straw[k % straw.length];
    s.tri([x - dz * w, 0.08, z + dx * w], [x + dz * w, 0.08, z - dx * w], [x + dx * lean, h, z + dz * lean], c, c, straw[(k + 1) % straw.length]);
  }
  // a stone beside it
  const st = new THREE.OctahedronGeometry(0.17, 0);
  const q = st.attributes.position.array as Float32Array;
  const grey = [new THREE.Color("#b6ab92"), new THREE.Color("#9b917d")];
  for (let i = 0; i < q.length; i += 9) {
    const c = grey[(i / 9) & 1];
    s.tri([q[i] + 0.55, Math.max(0, q[i + 1] * 0.7 + 0.04), q[i + 2] - 0.2], [q[i + 3] + 0.55, Math.max(0, q[i + 4] * 0.7 + 0.04), q[i + 5] - 0.2], [q[i + 6] + 0.55, Math.max(0, q[i + 7] * 0.7 + 0.04), q[i + 8] - 0.2], c);
  }
  ico.dispose();
  st.dispose();
  return s;
}

/** the area of a ring, m2 */
const ringArea = (ring: [number, number][]) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
};

/**
 * where things of one kind stand: a jittered grid over each of the hole's areas of that kind, thinned to `cap` and kept
 * only where the hole itself says the ground is of that kind. Deterministic.
 */
export function scatter(hole: BuiltHole, kind: "waste" | "fescue", per: number, cap: number, seed: number): [number, number][] {
  const out: [number, number][] = [];
  if (cap <= 0) return out;
  const r = seeded(seed * 131 + hole.def.n);
  const rings = hole.areas.filter((a) => a.kind === kind).map((a) => a.ring);
  if (!rings.length) return out;
  const total = rings.reduce((s, g) => s + ringArea(g), 0);
  // one per `per` m2, or fewer if that is over the cap
  const g = Math.sqrt(Math.max(per, total / cap));
  for (const ring of rings) {
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    for (let z = z0; z < z1; z += g)
      for (let x = x0; x < x1; x += g) {
        const px = x + (r() - 0.5) * g * 0.9, pz = z + (r() - 0.5) * g * 0.9;
        if (hole.surfaceAt(px, pz) === kind) out.push([px, pz]);
      }
  }
  return out.slice(0, cap);
}

export function buildScrub(hole: BuiltHole, ground: { y: (x: number, z: number) => number }, tier: Tier, disposables: { dispose: () => void }[]): Scrub | null {
  const [capScrub, capTuft] = CAP[tier];
  const spots = { waste: scatter(hole, "waste", PER_BUSH, capScrub, 1), fescue: scatter(hole, "fescue", PER_TUFT, capTuft, 2) };
  if (!spots.waste.length && !spots.fescue.length) return null;
  const group = new THREE.Group();
  const own: { dispose: () => void }[] = [];
  let calls = 0, tris = 0;
  const make = (soup: Soup, at: [number, number][], size: [number, number], seed: number, tone: [number, number], side: THREE.Side) => {
    if (!at.length) return;
    const geo = soup.geometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side });
    const mesh = new THREE.InstancedMesh(geo, mat, at.length);
    const r = seeded(seed * 17 + hole.def.n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), cc = new THREE.Color();
    at.forEach(([x, z], i) => {
      const k = size[0] + r() * (size[1] - size[0]);
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      sc.set(k * (0.85 + r() * 0.3), k, k * (0.85 + r() * 0.3));
      p.set(x, ground.y(x, z) - 0.03, z);
      m4.compose(p, q, sc);
      mesh.setMatrixAt(i, m4);
      const t = tone[0] + r() * (tone[1] - tone[0]);
      cc.setRGB(t, t * (0.97 + 0.06 * r()), t * 0.94);
      mesh.setColorAt(i, cc);
    });
    mesh.frustumCulled = false;
    group.add(mesh);
    own.push(geo, mat, mesh);
    calls++;
    tris += soup.tris * at.length;
  };
  make(scrubGeometry(), spots.waste, [0.7, 1.35], 3, [0.85, 1.12], THREE.FrontSide);
  make(tuftGeometry(), spots.fescue, [0.8, 1.45], 4, [0.82, 1.14], THREE.DoubleSide);
  disposables.push(...own);
  return { group, calls, tris, dispose: () => own.forEach((o) => o.dispose()) };
}
