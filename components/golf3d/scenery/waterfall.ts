import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { hash1, lerp } from "./geo";
import { blobTexture } from "./mist";
import type { SceneryRecord, Tier, WaterfallSpec } from "./types";
import { wallSpine, wallStations } from "./wall";

// Phase 3, hole 2: a waterfall down the granite wall into a pool of its own at the foot (never joined to the pond in
// play: the wall stands more than 60 m from it). A narrow strip hung just clear of the rock, with streaks of white that
// run down it in the shader, and a small bowl of turquoise water where it lands, with a puff of spray over it. Cheap:
// about a hundred triangles and two draws. On the middle tier it stands still and has no spray; on the cheapest there
// is no wall, so no fall. Under reduced motion nothing moves.

const SEGS: Record<Tier, { strip: number; pool: number }> = { high: { strip: 14, pool: 22 }, low: { strip: 8, pool: 12 }, soft: { strip: 0, pool: 0 } };
export const TONES = { water: "#bfe9ea", froth: "#ffffff", pool: "#4fc4c0" };
/** the least clearance (m) between the strip and the rock face */
const CLEAR = 0.35;
/** triangles of the spray: two crossed quads */
export const SPRAY_TRIS = 4;

/** the seconds the water has run by `now` ms: frozen under reduced motion */
export const fallClock = (nowMs: number, reduce: boolean) => (reduce ? 0 : nowMs / 1000);

export type FallData = {
  /** x y z of every vertex, non-indexed triangles */
  positions: Float32Array;
  /** per vertex: across the strip -1..1 (or the pool's radius 0..1), down it in metres (or the pool's distance from the landing), the kind */
  marks: Float32Array;
  tris: number;
  /** where the water lands, and the pool's level */
  landing: [number, number, number];
  pool: { x: number; z: number; y: number; r: number };
  /** the lip's height, m above the pool */
  drop: number;
};

/** the strip and the pool as triangle data, or null on a tier without a wall */
export function waterfallData(hole: BuiltHole, rec: SceneryRecord, heightAt: (x: number, z: number) => number, tier: Tier): FallData | null {
  const spec = rec.waterfall, wall = rec.walls?.[spec?.wall ?? -1];
  const seg = SEGS[tier];
  if (!spec || !wall || !seg.strip) return null;
  const { st } = wallStations(wall, heightAt, tier, wallSpine(hole, wall));
  if (st.length < 2) return null;
  const i = Math.max(0, Math.min(st.length - 1, Math.round(spec.at * (st.length - 1))));
  const s = st[i];
  const flare = Math.min(0.35 * s.H, 18);
  const tx = -s.nz, tz = s.nx;
  // out from the spine at a height fraction: the stepped face at its furthest, and a hand clear of it
  const outAt = (t: number) => flare * (1 - t) * (1 - t) + 0.03 * s.H + CLEAR - 0.04 * s.H * t;
  const footOut = outAt(0.05);
  const px = s.x + s.nx * (footOut + spec.pool * 0.4), pz = s.z + s.nz * (footOut + spec.pool * 0.4);
  // the pool sits just over the highest ground under it, so it shows whole; its bank drops away below, hiding the gap
  let poolY = heightAt(px, pz);
  for (let k = 0; k < 8; k++) poolY = Math.max(poolY, heightAt(px + Math.cos(k * 0.785) * spec.pool, pz + Math.sin(k * 0.785) * spec.pool));
  poolY += 0.2;
  const yTop = s.f + s.H, y0 = poolY + 0.1;
  const K = seg.strip, P = seg.pool;
  const tris = K * 2 + P * 3;
  const pos = new Float32Array(tris * 9), mk = new Float32Array(tris * 9);
  let n = 0;
  const vert = (x: number, y: number, z: number, a: number, b: number, kind: number) => {
    pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
    mk[n * 3] = a; mk[n * 3 + 1] = b; mk[n * 3 + 2] = kind;
    n++;
  };
  // the strip: rows from the pool up to the lip, wider at the foot, a little unsteady
  const row = (j: number) => {
    const u = j / K;
    const y = lerp(y0, yTop, u);
    const t = Math.pow(Math.max(0, (y - s.f) / s.H), 1 / 0.9);
    const o = outAt(t);
    const half = (lerp(spec.width[1], spec.width[0], u) / 2) * (0.92 + 0.16 * hash1(j, 5));
    const sway = (hash1(j, 9) - 0.5) * 0.8;
    const cx = s.x + s.nx * o + tx * sway, cz = s.z + s.nz * o + tz * sway;
    return { y, down: yTop - y, l: [cx - tx * half, cz - tz * half] as const, r: [cx + tx * half, cz + tz * half] as const };
  };
  let a = row(0);
  for (let j = 0; j < K; j++) {
    const b = row(j + 1);
    vert(a.l[0], a.y, a.l[1], -1, a.down, 0); vert(a.r[0], a.y, a.r[1], 1, a.down, 0); vert(b.l[0], b.y, b.l[1], -1, b.down, 0);
    vert(a.r[0], a.y, a.r[1], 1, a.down, 0); vert(b.r[0], b.y, b.r[1], 1, b.down, 0); vert(b.l[0], b.y, b.l[1], -1, b.down, 0);
    a = b;
  }
  // the pool: a disc at its level, and a bank round it that drops away, so a pool on a slope never floats
  const lx = s.x + s.nx * footOut, lz = s.z + s.nz * footOut;
  const rim = (k: number, f: number, y: number) => {
    const ang = (k / P) * Math.PI * 2;
    const rr = spec.pool * (1 + 0.1 * (hash1(k % P, 3) - 0.5)) * f;
    return [px + Math.cos(ang) * rr, y, pz + Math.sin(ang) * rr] as const;
  };
  const dist = (x: number, z: number) => Math.min(1.5, Math.hypot(x - lx, z - lz) / spec.pool);
  for (let k = 0; k < P; k++) {
    const p0 = rim(k, 1, poolY), p1 = rim(k + 1, 1, poolY);
    vert(px, poolY, pz, 0, dist(px, pz), 1);
    vert(p0[0], p0[1], p0[2], 1, dist(p0[0], p0[2]), 1);
    vert(p1[0], p1[1], p1[2], 1, dist(p1[0], p1[2]), 1);
    const q0 = rim(k, 1.14, poolY - 6), q1 = rim(k + 1, 1.14, poolY - 6);
    vert(p0[0], p0[1], p0[2], 1, 1, 2); vert(q0[0], q0[1], q0[2], 1, 1, 2); vert(p1[0], p1[1], p1[2], 1, 1, 2);
    vert(p1[0], p1[1], p1[2], 1, 1, 2); vert(q0[0], q0[1], q0[2], 1, 1, 2); vert(q1[0], q1[1], q1[2], 1, 1, 2);
  }
  return { positions: pos, marks: mk, tris: n / 3, landing: [lx, poolY, lz], pool: { x: px, z: pz, y: poolY, r: spec.pool }, drop: yTop - poolY };
}

const VERT = `attribute vec3 mark;
varying vec3 vM;
#include <fog_pars_vertex>
void main(){
  vM = mark;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = `uniform float t; uniform vec3 water; uniform vec3 froth; uniform vec3 pool;
varying vec3 vM;
#include <fog_pars_fragment>
void main(){
  vec3 col;
  if (vM.z < 0.5) {
    float u = vM.x, d = vM.y;
    // a ragged edge, so the strip is not a ruled band
    if (abs(u) > 0.84 + 0.16 * sin(d * 0.9 + 1.7) * sin(d * 0.31)) discard;
    float s = 0.5 + 0.5 * sin(u * 6.5 + sin(d * 0.6) * 2.2);
    float f = fract(d * 0.16 - t * 0.55 + s * 0.45 + u * 0.12);
    float f2 = fract(d * 0.07 - t * 0.33 - s * 0.3);
    col = mix(water, froth, clamp(0.4 + 0.55 * smoothstep(0.45, 0.9, f) + 0.4 * smoothstep(0.55, 0.95, f2), 0.0, 1.0));
    col = mix(col, froth, smoothstep(0.62, 0.95, abs(u)) * 0.55);
  } else if (vM.z < 1.5) {
    float r = vM.x, near = 1.0 - smoothstep(0.1, 0.62, vM.y);
    float ring = 0.5 + 0.5 * sin(vM.y * 16.0 - t * 2.0);
    col = mix(pool, pool * 0.72, smoothstep(0.1, 0.9, r));
    col = mix(col, froth, near * (0.35 + 0.5 * ring) + smoothstep(0.84, 1.0, r) * 0.55);
  } else {
    col = vec3(0.5, 0.56, 0.54);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export type Fall = { group: THREE.Group; tris: number; calls: number; dispose: () => void };

export function buildWaterfall(hole: BuiltHole, rec: SceneryRecord, heightAt: (x: number, z: number) => number, tier: Tier, reduce: boolean): Fall | null {
  const d = waterfallData(hole, rec, heightAt, tier);
  if (!d || !rec.waterfall) return null;
  const spec: WaterfallSpec = rec.waterfall;
  const tones = { ...TONES, ...spec.tones };
  const group = new THREE.Group();
  const frees: { dispose: () => void }[] = [];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute("mark", new THREE.BufferAttribute(d.marks, 3));
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { t: { value: 0 }, water: { value: new THREE.Color(tones.water) }, froth: { value: new THREE.Color(tones.froth) }, pool: { value: new THREE.Color(tones.pool) } },
  ]);
  const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, fog: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  const animate = tier === "high" && !reduce;
  if (animate) mesh.onBeforeRender = () => (m.uniforms.t.value = fallClock(performance.now(), false));
  group.add(mesh);
  frees.push(g, m);
  let tris = d.tris, calls = 1;
  if (tier === "high") {
    // spray over the landing: two crossed soft quads
    const tex = blobTexture();
    const sm = new THREE.MeshBasicMaterial({ map: tex, color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false, fog: true, side: THREE.DoubleSide });
    const sw = Math.max(18, spec.pool * 1.7), sh = Math.min(30, d.drop * 0.3 + 10);
    const [lx, ly, lz] = d.landing, yc = ly + sh * 0.35, hw = sw / 2, hh = sh / 2;
    const pos = new Float32Array([
      lx - hw, yc + hh, lz, lx + hw, yc + hh, lz, lx - hw, yc - hh, lz, lx + hw, yc - hh, lz,
      lx, yc + hh, lz - hw, lx, yc + hh, lz + hw, lx, yc - hh, lz - hw, lx, yc - hh, lz + hw,
    ]);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    mg.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0], 2));
    mg.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
    const spray = new THREE.Mesh(mg, sm);
    spray.frustumCulled = false;
    spray.renderOrder = 4;
    if (animate) spray.onBeforeRender = () => (sm.opacity = 0.42 + 0.1 * Math.sin(fallClock(performance.now(), false) * 1.3));
    group.add(spray);
    frees.push(mg, sm, tex);
    tris += SPRAY_TRIS;
    calls++;
  }
  return { group, tris, calls, dispose: () => frees.forEach((f) => f.dispose()) };
}
