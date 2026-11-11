import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import { bearingOf, clamp, hash1, hash2, lerp, nearest, resample, signedDist, wrapDeg } from "./geo";
import { GATE } from "./height";
import { COAST_ROCK } from "./rock";
import type { P, PropsSpec, SceneryRecord, Tier } from "./types";

// Things that stand in the backdrop: sea stacks off a coast and a lighthouse. Every one is placed well outside the gate
// (more than PROP_KEEP m past the rough), so none can touch play, and everything is deterministic from the record.

/** the least distance (m) from the rough that a prop may stand */
export const PROP_KEEP = GATE + 50;
/** the same for the lighthouse, a slim tower that may stand nearer */
export const LIGHT_KEEP = GATE + 45;
const SIDES = 8;
/** triangles of one sea stack (column, turf cap, foam skirt) and of the lighthouse */
export const STACK_TRIS = SIDES * 6 * 2 + SIDES + SIDES * 2;

type RGB = [number, number, number];
const c3 = (hex: string): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** a small deterministic generator, 0 up to (not including) 1 */
function rng(seed: number): () => number {
  let s = (Math.imul(seed | 0, 2654435761) + 1013904223) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export type StackAt = { x: number; z: number; h: number; r: number; rot: number };

/** where the sea stacks stand: on the sea side, in water, well outside the gate, near the hole, apart from each other */
export function placeStacks(hole: BuiltHole, rec: SceneryRecord, count: number): StackAt[] {
  const spec = rec.props?.stacks, coast = rec.coast;
  if (!spec || !coast || count <= 0) return [];
  const [s0, s1] = spec.sd ?? [30, 160];
  const [h0, h1] = spec.height ?? [14, 34];
  const rough = hole.def.rough * YD;
  const b = hole.shape.box;
  const rand = rng(spec.seed);
  const out: StackAt[] = [];
  for (let tries = 0; tries < 1200 && out.length < count; tries++) {
    const x = b.x0 - 450 + rand() * (b.x1 - b.x0 + 900), z = b.z0 - 450 + rand() * (b.z1 - b.z0 + 900);
    const sd = signedDist(coast, x, z);
    const h = lerp(h0, h1, rand()), r = 4.5 + h * 0.2 + rand() * 3, rot = rand() * Math.PI * 2;
    if (sd < s0 || sd > s1) continue;
    if (hole.margin(x, z) - rough < PROP_KEEP + 40) continue;
    if (nearest(hole.line, x, z).d > 560) continue;
    // apart from each other, so they do not merge into one block
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + r) * 1.8 + 20)) continue;
    out.push({ x, z, h, r, rot });
  }
  return out;
}

/** the unit stack: radius 1, height 1, waterline at y = 0, with a flat skirt of foam. Colours carry alpha (4 values). */
export function stackGeometry(rock: string[], turf: string, foam: string, shallow: string): THREE.BufferGeometry {
  const R = 7;
  const rc = rock.map(c3), turfC = c3(turf);
  const pos: number[] = [], col: number[] = [];
  const v = (p: RGB, c: RGB, a = 1) => {
    pos.push(p[0], p[1], p[2]);
    col.push(c[0], c[1], c[2], a);
  };
  const pt = (i: number, j: number): RGB => {
    const t = i / (R - 1);
    const r = (1 - 0.42 * Math.pow(t, 1.15)) * (0.8 + 0.4 * hash2(i, j, 31) + (i % 2 ? -0.05 : 0.06)) * (i === R - 1 ? 0.8 : 1);
    const a = ((j + 0.3 * (hash2(i, j, 7) - 0.5)) / SIDES) * Math.PI * 2;
    return [Math.cos(a) * r, lerp(-0.14, 1, t), Math.sin(a) * r];
  };
  // banded rock, light at the top and dark at the water
  const shade = (i: number, j: number): RGB => {
    const t = (i + 0.5) / (R - 1);
    const band = clamp(Math.floor(t * rc.length * 0.999 + (hash2(0, j % 3, 3) - 0.5) * 0.6), 0, rc.length - 1);
    const base = rc[rc.length - 1 - band];
    const k = (i % 2 ? 0.88 : 1) * (0.9 + 0.18 * hash2(i, j, 5));
    const c: RGB = [base[0] * k, base[1] * k, base[2] * k];
    return t < 0.18 ? mix([c[0] * 0.5, c[1] * 0.55, c[2] * 0.55], c, t / 0.18) : c;
  };
  for (let i = 0; i < R - 1; i++)
    for (let j = 0; j < SIDES; j++) {
      const j1 = (j + 1) % SIDES;
      const a = pt(i, j), b = pt(i, j1), c = pt(i + 1, j), d = pt(i + 1, j1);
      const k = shade(i, j);
      v(a, k); v(c, k); v(b, k);
      v(b, k); v(c, k); v(d, k);
    }
  // the top: a turf cap
  for (let j = 0; j < SIDES; j++) {
    const k = mix(turfC, [turfC[0] * 0.8, turfC[1] * 0.85, turfC[2] * 0.7], hash1(j, 9));
    v(pt(R - 1, j), k); v([0, 1.06, 0], k); v(pt(R - 1, (j + 1) % SIDES), k);
  }
  // the foam: a ring flat at the waterline, white at the rock and clear at its outer edge
  const fc = c3(foam), edge = mix(fc, c3(shallow), 0.3);
  const ang = (j: number) => (j / SIDES) * Math.PI * 2;
  const rin = (j: number) => 0.78 + 0.2 * hash2(j, 1, 11), rout = (j: number) => 1.55 + 0.4 * hash2(j, 2, 11);
  const P = (j: number, r: number): RGB => [Math.cos(ang(j)) * r, 0, Math.sin(ang(j)) * r];
  for (let j = 0; j < SIDES; j++) {
    const j1 = (j + 1) % SIDES;
    v(P(j, rin(j)), fc, 0.9); v(P(j1, rin(j1)), fc, 0.9); v(P(j, rout(j)), edge, 0);
    v(P(j1, rin(j1)), fc, 0.9); v(P(j1, rout(j1)), edge, 0); v(P(j, rout(j)), edge, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 4));
  g.computeVertexNormals();
  return g;
}

/** where the lighthouse stands: given, or on the coast's lip nearest a bearing (deg) and distance (m) from the pin */
export function placeLighthouse(hole: BuiltHole, rec: SceneryRecord): P | null {
  const spec = rec.props?.lighthouse;
  if (!spec) return null;
  if (spec.at) return spec.at;
  const coast = rec.coast;
  if (!coast) return null;
  const rough = hole.def.rough * YD;
  const [px, pz] = hole.pin;
  const wantB = spec.bearing ?? 0, wantD = spec.distance ?? 500;
  let best: P | null = null, bestCost = Infinity;
  for (const [x, z] of resample(coast.line, 12)) {
    if (hole.margin(x, z) - rough < LIGHT_KEEP + 12) continue;
    const db = Math.abs(wrapDeg((bearingOf(px, pz, x, z) * 180) / Math.PI - wantB));
    const cost = db + Math.abs(Math.hypot(x - px, z - pz) - wantD) / 25;
    if (cost < bestCost) {
      bestCost = cost;
      best = [x, z];
    }
  }
  if (!best) return null;
  // a little back from the lip, on the land (the lip is where the signed distance is 0)
  let [x, z] = best;
  const e = 2;
  const gx = signedDist(coast, x + e, z) - signedDist(coast, x - e, z), gz = signedDist(coast, x, z + e) - signedDist(coast, x, z - e);
  const gl = Math.hypot(gx, gz) || 1;
  for (let k = 0; k < 6 && signedDist(coast, x, z) > -6; k++) {
    const nx = x - (gx / gl) * 3, nz = z - (gz / gl) * 3;
    if (hole.margin(nx, nz) - rough < LIGHT_KEEP) break;
    x = nx;
    z = nz;
  }
  return [x, z];
}

/** the lighthouse as one geometry in metres (base at y = 0, sunk 3 m below it): a banded tower, gallery, lantern, roof */
export function lighthouseGeometry(sun: [number, number, number]): { geometry: THREE.BufferGeometry; tris: number } {
  const white = c3("#f1ebe0"), red = c3("#c4413a"), dark = c3("#3c3a44"), glass = c3("#ffe9a6"), roof = c3("#b43a36");
  const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  const L: RGB = [sun[0] / sl, sun[1] / sl, sun[2] / sl];
  const pos: number[] = [], col: number[] = [];
  /** a triangle shaded flat by the sun (baked, so the lantern can be left bright) */
  const tri = (a: RGB, b: RGB, c: RGB, base: RGB, lit = true) => {
    let k = 1;
    if (lit) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      k = 0.5 + 0.55 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
    }
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      col.push(base[0] * k, base[1] * k, base[2] * k);
    }
  };
  const ring = (y: number, r: number, j: number): RGB => {
    const a = ((j + 0.5) / SIDES) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  const frustum = (y0: number, r0: number, y1: number, r1: number, colour: RGB, lit = true) => {
    for (let j = 0; j < SIDES; j++) {
      tri(ring(y0, r0, j), ring(y1, r1, j), ring(y0, r0, j + 1), colour, lit);
      tri(ring(y0, r0, j + 1), ring(y1, r1, j), ring(y1, r1, j + 1), colour, lit);
    }
  };
  const disc = (y: number, r0: number, r1: number, colour: RGB) => {
    for (let j = 0; j < SIDES; j++) {
      tri(ring(y, r0, j), ring(y, r0, j + 1), ring(y, r1, j), colour);
      tri(ring(y, r0, j + 1), ring(y, r1, j + 1), ring(y, r1, j), colour);
    }
  };
  const R = (y: number) => lerp(2.5, 1.55, clamp(y / 24, 0, 1));
  const cuts = [-3, 5, 11, 17, 24];
  for (let i = 0; i < 4; i++) frustum(cuts[i], R(cuts[i]), cuts[i + 1], R(cuts[i + 1]), i % 2 ? white : red);
  // the gallery: a wide ledge under a flat deck
  frustum(24, R(24) + 0.3, 25, R(24) + 1.1, dark);
  disc(25, R(24) + 1.1, 1.15, dark);
  // the lantern: glass that glows (unshaded), under a red roof
  frustum(25, 1.15, 28.4, 1.15, glass, false);
  for (let j = 0; j < SIDES; j++) tri(ring(28.4, 1.5, j), [0, 31, 0], ring(28.4, 1.5, j + 1), roof);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  return { geometry: g, tris: pos.length / 9 };
}

export function buildProps(
  hole: BuiltHole,
  rec: SceneryRecord,
  heightAt: (x: number, z: number) => number,
  tier: Tier,
): { group: THREE.Group; tris: number; calls: number; dispose: () => void } | null {
  const spec: PropsSpec | undefined = rec.props;
  if (!spec) return null;
  const group = new THREE.Group();
  const frees: { dispose: () => void }[] = [];
  let tris = 0, calls = 0;
  const coast = rec.coast;

  if (spec.stacks && coast && tier !== "soft") {
    const want = tier === "low" ? Math.ceil(spec.stacks.count / 2) : spec.stacks.count;
    const at = placeStacks(hole, rec, Math.min(8, want));
    if (at.length) {
      const g = stackGeometry(coast.cliff?.rock ?? COAST_ROCK, "#7d8f52", coast.tones.foam, coast.tones.shallow);
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true });
      const mesh = new THREE.InstancedMesh(g, m, at.length);
      const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      at.forEach((s, i) => {
        q.setFromAxisAngle(up, s.rot);
        mat.compose(new THREE.Vector3(s.x, coast.seaY + 0.15, s.z), q, new THREE.Vector3(s.r, s.h, s.r));
        mesh.setMatrixAt(i, mat);
        const k = 0.92 + 0.16 * hash1(i, spec.stacks!.seed);
        mesh.setColorAt(i, new THREE.Color(k, k, k));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      group.add(mesh);
      frees.push(g, m, mesh);
      tris += at.length * STACK_TRIS;
      calls++;
    }
  }

  const lp = spec.lighthouse ? placeLighthouse(hole, rec) : null;
  if (lp) {
    const { geometry, tris: t } = lighthouseGeometry(rec.skin?.skySun ?? [0.3, 0.7, 0.5]);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geometry, m);
    // stand on the lowest ground under the base
    let y = Infinity;
    for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) y = Math.min(y, heightAt(lp[0] + dx, lp[1] + dz));
    mesh.position.set(lp[0], y, lp[1]);
    mesh.frustumCulled = false;
    group.add(mesh);
    frees.push(geometry, m);
    tris += t;
    calls++;
  }

  if (!calls) return null;
  return { group, tris, calls, dispose: () => frees.forEach((f) => f.dispose()) };
}
