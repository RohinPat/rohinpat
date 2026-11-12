import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seeded } from "@/components/offhours/useCanvas";
import { polyOf, ringSd, type BuiltHole, type Creek, type CreekPt } from "@/components/offhours/golf/course";
import type { Terrain } from "@/components/offhours/golf/terrain";
import type { Tier } from "./scenery";

// The water in play. The ground under it is dug by terrain.ts (a creek in a banked trench, a pond in a hollow with a
// lip), so this file draws the sheet that lies in that dig: one shader, shaded from a baked map of how deep the water
// really is and how far it is from the shore (shallow bed showing at the edge, deep in the middle, foam on the bank),
// with streaks that run along a creek's own path and a faster, whiter stretch at a riffle. The tones are the bay's
// (scenery/ocean.ts), so a pond and the sea behind it read as the same water. Hazard stakes stand along the banks (one
// merged mesh with the rocks). The cheapest tier is a flat tone; under reduced motion the water holds still.

type P = [number, number];
type Tones = { shallow: string; mid: string; deep: string; foam: string };

/** the hole's water tones when it has no bay of its own: the bay's, from hole 8 */
const TONES: Tones = { shallow: "#9fd6cf", mid: "#5aa7b5", deep: "#2f6f8f", foam: "#f4fbfb" };
/** the gravel under the shallows */
const BED = "#a89a78";
/** the depth the map holds, m, and the shore distance it holds, m */
const DEPTH_MAX = 1.8, SHORE_MAX = 6;
/** the baked depth map's longest side, texels, per tier */
const MAP_CAP: Record<Tier, number> = { high: 192, low: 112, soft: 0 };

const VERT = `varying vec3 vP; varying vec3 vW; varying vec3 vF;
attribute vec3 flowUV;
#include <fog_pars_vertex>
void main(){
  vP = position; vF = flowUV;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

// flowUV: x the distance along the creek (m), y across it (-1 to 1), z how much of a riffle this is (0 to 1)
const FRAG = `uniform sampler2D map; uniform vec4 region; uniform vec3 cShallow; uniform vec3 cMid; uniform vec3 cDeep; uniform vec3 cBed; uniform vec3 foam; uniform vec3 sun;
uniform float t; uniform float flow; uniform float glit;
varying vec3 vP; varying vec3 vW; varying vec3 vF;
#include <fog_pars_fragment>
void main(){
  vec2 uv = (vP.xz - region.xy) * region.zw;
  vec4 m = texture2D(map, clamp(uv, 0.002, 0.998));
  float depth = m.r * ${DEPTH_MAX.toFixed(1)};
  float sd = m.g * ${SHORE_MAX.toFixed(1)};
  vec3 col = mix(cShallow, cMid, smoothstep(0.05, 0.7, depth));
  col = mix(col, cDeep, smoothstep(0.55, 1.5, depth));
  // the bed shows through in the shallows
  col = mix(col, cBed, (1.0 - smoothstep(0.0, 0.42, depth)) * 0.6);
  float s = vF.x, a = vF.y, rif = vF.z;
  float nz = 0.5 + 0.5 * sin(s * 1.9 - t * (1.6 + 1.4 * rif) + a * 5.0 + sin(s * 0.37) * 2.0);
  if (flow > 0.5) {
    // streaks of light running with the current, quicker over a riffle
    float line = sin(a * 7.0 + sin(s * 0.11) * 2.6 + sin(s * 0.047 + a) * 1.5);
    float pulse = 0.5 + 0.5 * sin(s * 0.7 - t * (2.6 + 2.0 * rif) + a * 2.0);
    col += vec3(0.1, 0.14, 0.15) * smoothstep(0.86, 0.98, line) * (0.35 + 0.65 * pulse);
    col -= vec3(0.03, 0.05, 0.04) * smoothstep(0.9, 1.0, -line);
    // a riffle breaks the surface white
    float chop = smoothstep(0.55, 0.85, nz * (0.6 + 0.4 * sin(a * 9.0 + s * 1.3 - t * 3.0)));
    col = mix(col, foam, rif * chop * 0.7);
  } else {
    float r = sin(vP.x * 0.9 + t * 0.7) * sin(vP.z * 0.8 - t * 0.9);
    col += vec3(0.03, 0.05, 0.05) * smoothstep(0.3, 0.9, r);
  }
  // foam at the bank, ragged and moving; a thinner, quieter line on a still pond
  float fe = flow > 0.5 ? 1.0 - smoothstep(0.1 + 0.35 * nz, 0.55 + 0.9 * nz, sd) : 1.0 - smoothstep(0.08 + 0.12 * nz, 0.34 + 0.2 * nz, sd);
  col = mix(col, foam, fe * (flow > 0.5 ? 0.9 : 0.65));
  vec3 V = normalize(cameraPosition - vW);
  float fr = pow(1.0 - max(V.y, 0.0), 3.0);
  col = mix(col, vec3(0.62, 0.8, 0.92), fr * 0.22);
  #ifndef LOW
    vec3 N = normalize(vec3(0.09 * cos(vW.x * 0.9 + t * 1.3 + s * 0.4), 1.0, 0.09 * sin(vW.z * 0.8 - t * 1.1)));
    col += vec3(1.0, 0.92, 0.75) * pow(max(dot(reflect(-V, N), normalize(sun)), 0.0), 140.0) * glit;
  #endif
  float ff = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor = vec4(mix(col, fogColor, ff), 1.0);
  #include <colorspace_fragment>
}`;

/** rings of foam round a rock in the stream */
const FOAM_FRAG = `uniform float t; varying vec3 vF;
#include <fog_pars_fragment>
void main(){
  float r = length(vF.xy);
  float ring = smoothstep(1.0, 0.55, r) * (0.55 + 0.45 * sin(r * 16.0 - t * 2.5 + vF.x * 4.0));
  float ff = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor = vec4(mix(vec3(0.96, 0.99, 1.0), fogColor, ff), clamp(ring, 0.0, 1.0) * 0.9);
  #include <colorspace_fragment>
}`;

export type WaterOpts = {
  hole: BuiltHole;
  ground: Terrain;
  tier: Tier;
  sun: THREE.Vector3;
  reduce: boolean;
  /** the hole's bay tones (its scenery's coast), so water in play matches it */
  bay?: Tones;
  group: THREE.Group;
  disposables: { dispose: () => void }[];
};

const normalAt = (poly: CreekPt[], i: number): P => {
  const a = poly[Math.max(0, i - 1)], b = poly[Math.min(poly.length - 1, i + 1)];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return [(b.z - a.z) / l, -(b.x - a.x) / l];
};

/** how much of a riffle each point of a creek is: where it runs narrower than its own average, 0 to 1 */
export function riffles(poly: CreekPt[]): number[] {
  const mean = poly.reduce((a, p) => a + p.hw, 0) / poly.length;
  return poly.map((p) => Math.max(0, Math.min(1, (0.95 - p.hw / mean) / 0.2)));
}

/**
 * Where the hazard stakes stand: along each bank, a little outside the waterline, on ground in play or the rough.
 * (data, for the stakes drawn here and for anything else that marks the hazard)
 */
export function waterStakes(hole: BuiltHole, every = 14): { x: number; z: number; water: number }[] {
  const out: { x: number; z: number; water: number }[] = [];
  const ok = (x: number, z: number) => {
    const sf = hole.surfaceAt(x, z);
    return sf === "rough" || sf === "fairway";
  };
  hole.def.water.forEach((w, wi) => {
    if ("path" in w) {
      const poly = polyOf(w as Creek);
      let next = every / 2;
      poly.forEach((p, i) => {
        if (p.s < next) return;
        next += every;
        const [nx, nz] = normalAt(poly, i);
        for (const sg of [-1, 1]) {
          const x = p.x + nx * sg * (p.hw + 1.1), z = p.z + nz * sg * (p.hw + 1.1);
          if (ok(x, z)) out.push({ x, z, water: wi });
        }
      });
    } else {
      const ring = hole.world.water[wi] as P[];
      let acc = every / 2;
      ring.forEach(([x, z], i) => {
        const [bx, bz] = ring[(i + 1) % ring.length];
        acc -= Math.hypot(bx - x, bz - z);
        if (acc > 0) return;
        acc += every;
        const l = Math.hypot(bx - x, bz - z) || 1;
        let nx = -(bz - z) / l, nz = (bx - x) / l;
        if (ringSd(ring, x + nx * 0.5, z + nz * 0.5) < 0) (nx = -nx), (nz = -nz);
        const sx = x + nx * 1.1, sz = z + nz * 1.1;
        if (ok(sx, sz)) out.push({ x: sx, z: sz, water: wi });
      });
    }
  });
  return out;
}

/** a chamfered distance transform of a mask (texels), in place */
function distance(mask: Uint8Array, nx: number, nz: number): Float32Array {
  const dist = new Float32Array(nx * nz);
  for (let k = 0; k < nx * nz; k++) dist[k] = mask[k] ? 1e3 : 0;
  const D = 1, DD = 1.414;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!dist[k]) continue;
      let d = dist[k];
      if (i > 0) d = Math.min(d, dist[k - 1] + D);
      if (j > 0) d = Math.min(d, dist[k - nx] + D);
      if (i > 0 && j > 0) d = Math.min(d, dist[k - nx - 1] + DD);
      if (i < nx - 1 && j > 0) d = Math.min(d, dist[k - nx + 1] + DD);
      dist[k] = d;
    }
  for (let j = nz - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (!dist[k]) continue;
      let d = dist[k];
      if (i < nx - 1) d = Math.min(d, dist[k + 1] + D);
      if (j < nz - 1) d = Math.min(d, dist[k + nx] + D);
      if (i < nx - 1 && j < nz - 1) d = Math.min(d, dist[k + nx + 1] + DD);
      if (i > 0 && j < nz - 1) d = Math.min(d, dist[k + nx - 1] + DD);
      dist[k] = d;
    }
  return dist;
}

const colored = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, rnd?: () => number) => {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const j = rnd ? 1 + (rnd() - 0.5) * jitter : 1;
    col.set([c.r * j, c.g * j, c.b * j], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
};

export function buildWater(o: WaterOpts) {
  const { hole, ground, tier, group, disposables } = o;
  const def = hole.def;
  const clock: { value: number }[] = [];
  // only the best tier animates, and not under reduced motion
  const animate = tier === "high" && !o.reduce;
  const tick = () => {
    const tt = performance.now() / 1000;
    for (const u of clock) u.value = tt;
  };
  const sheets: THREE.Mesh[] = [];
  const bits: THREE.BufferGeometry[] = [], foamRings: THREE.BufferGeometry[] = [];
  const rnd = seeded(def.n * 313 + 7);
  const fogU = THREE.UniformsLib.fog;
  const tones = o.bay ?? TONES;

  const addRock = (x: number, z: number, y: number, r: number) => {
    const g = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
    g.scale(r * (0.9 + rnd() * 0.5), r * (0.5 + rnd() * 0.35), r * (0.9 + rnd() * 0.5));
    g.rotateY(rnd() * 6.28);
    g.translate(x, y + r * 0.12, z);
    colored(g, "#8c9594", 0.3, rnd);
    bits.push(g);
    if (tier === "soft") return;
    const f = new THREE.CircleGeometry(r * 2.1, 14);
    f.rotateX(-Math.PI / 2);
    f.translate(x, y + 0.03, z);
    const n = f.attributes.position.count, uv = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      uv[i * 3] = (f.attributes.position.getX(i) - x) / (r * 2.1);
      uv[i * 3 + 1] = (f.attributes.position.getZ(i) - z) / (r * 2.1);
    }
    f.setAttribute("flowUV", new THREE.BufferAttribute(uv, 3));
    foamRings.push(f);
  };

  // ------------------------------------------------------------------ each body of water
  def.water.forEach((w, wi) => {
    const ring = hole.world.water[wi] as P[];
    let cx = 0, cz = 0;
    ring.forEach(([x, z]) => ((cx += x), (cz += z)));
    cx /= ring.length;
    cz /= ring.length;
    const poly: CreekPt[] | null = "path" in w ? polyOf(w as Creek) : null;

    // ---- the sheet
    let g: THREE.BufferGeometry;
    const rif = poly ? riffles(poly) : [];
    if (poly) {
      const pos: number[] = [], fl: number[] = [], idx: number[] = [];
      poly.forEach((p, i) => {
        const [nxx, nzz] = normalAt(poly, i);
        const y = ground.waterY(p.x, p.z);
        for (const sgn of [-1, 0, 1]) {
          // the outer verts reach a little past the waterline, under the bank
          const off = sgn * (p.hw + (sgn ? 0.35 : 0));
          pos.push(p.x + nxx * off, y, p.z + nzz * off);
          fl.push(p.s, sgn, rif[i]);
        }
        if (i) {
          const q = i * 3, r = (i - 1) * 3;
          idx.push(r, r + 1, q, q, r + 1, q + 1, r + 1, r + 2, q + 1, q + 1, r + 2, q + 2);
        }
      });
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("flowUV", new THREE.Float32BufferAttribute(fl, 3));
      g.setIndex(idx);
    } else {
      const grown = ring.map(([x, z]) => [cx + (x - cx) * 1.03, cz + (z - cz) * 1.03] as P);
      // (a shape is counter-clockwise in its own plane; the ring may wind either way)
      const shape = new THREE.Shape(grown.map(([x, z]) => new THREE.Vector2(x, -z)));
      g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, ground.waterY(cx, cz), 0);
      g.setAttribute("flowUV", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    }

    if (tier === "soft") {
      const mat = new THREE.MeshBasicMaterial({ color: tones.mid, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      group.add(mesh);
      disposables.push(g, mat);
    } else {
      // ---- the depth map: R is the water's depth, G its distance from the shore
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of ring) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z));
      x0 -= 3; z0 -= 3; x1 += 3; z1 += 3;
      const texel = Math.max(0.5, Math.max(x1 - x0, z1 - z0) / MAP_CAP[tier]);
      const nx = Math.ceil((x1 - x0) / texel), nz = Math.ceil((z1 - z0) / texel);
      const pondY = poly ? 0 : ground.waterY(cx, cz);
      const mask = new Uint8Array(nx * nz), depth = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const x = x0 + (i + 0.5) * texel, z = z0 + (j + 0.5) * texel;
          if (hole.surfaceAt(x, z) === "water") {
            mask[j * nx + i] = 1;
            depth[j * nx + i] = Math.max(0.02, (poly ? ground.waterY(x, z) : pondY) - ground.y(x, z));
          }
        }
      const dist = distance(mask, nx, nz);
      const data = new Uint8Array(nx * nz * 4);
      for (let k = 0; k < nx * nz; k++) {
        data[k * 4] = mask[k] ? Math.min(255, (depth[k] / DEPTH_MAX) * 255) : 0;
        data[k * 4 + 1] = mask[k] ? Math.min(255, ((dist[k] * texel) / SHORE_MAX) * 255) : 0;
        data[k * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      disposables.push(tex);

      // a creek is a shade deeper and greener than the bay; a pond or lake is the bay's own
      const tone = poly ? { shallow: "#86cbb4", mid: tones.mid, deep: tones.deep } : { shallow: tones.shallow, mid: tones.mid, deep: tones.deep };
      const U = {
        ...THREE.UniformsUtils.clone(fogU),
        map: { value: tex },
        region: { value: new THREE.Vector4(x0, z0, 1 / (nx * texel), 1 / (nz * texel)) },
        cShallow: { value: new THREE.Color(tone.shallow) },
        cMid: { value: new THREE.Color(tone.mid) },
        cDeep: { value: new THREE.Color(tone.deep) },
        cBed: { value: new THREE.Color(BED) },
        foam: { value: new THREE.Color(tones.foam) },
        sun: { value: o.sun },
        t: { value: 0 },
        flow: { value: poly ? 1 : 0 },
        glit: { value: 0.55 },
      };
      if (animate) clock.push(U.t);
      const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: U, fog: true, side: THREE.DoubleSide, defines: tier === "low" ? { LOW: "" } : {}, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      group.add(mesh);
      sheets.push(mesh);
      disposables.push(g, mat);
    }

    // ---- stones in the stream, where the creek runs narrow and quick
    if (poly) {
      for (let i = 3; i < poly.length - 3; i += 4) {
        if (rif[i] < 0.3 || rnd() > 0.55) continue;
        const p = poly[i], [nxx, nzz] = normalAt(poly, i);
        const off = (rnd() - 0.5) * p.hw * 1.2;
        addRock(p.x + nxx * off, p.z + nzz * off, ground.waterY(p.x, p.z), 0.28 + rnd() * 0.3);
      }
    }
  });

  // ------------------------------------------------------------------ hazard stakes
  for (const s of waterStakes(hole)) {
    const y = ground.y(s.x, s.z);
    const post = new THREE.BoxGeometry(0.12, 1.7, 0.12).toNonIndexed();
    post.translate(s.x, y + 0.85, s.z);
    colored(post, "#f1efe6");
    const cap = new THREE.BoxGeometry(0.14, 0.45, 0.14).toNonIndexed();
    cap.translate(s.x, y + 1.55, s.z);
    colored(cap, "#e8c23a");
    bits.push(post, cap);
  }

  // ------------------------------------------------------------------ merged props: one mesh, and the foam rings
  if (bits.length) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mg = mergeGeometries(bits, false);
    const me = new THREE.Mesh(mg, mat);
    me.castShadow = tier !== "soft";
    me.receiveShadow = true;
    group.add(me);
    disposables.push(mg, mat);
  }
  if (foamRings.length) {
    const mg = mergeGeometries(foamRings, false);
    const FU = { ...THREE.UniformsUtils.clone(fogU), t: { value: 0 } };
    if (animate) clock.push(FU.t);
    const fm = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FOAM_FRAG, uniforms: FU, fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    group.add(new THREE.Mesh(mg, fm));
    disposables.push(mg, fm);
  }
  // one clock for all of it, ticked as the first sheet draws
  if (clock.length) {
    if (sheets[0]) sheets[0].onBeforeRender = tick;
  }
}
