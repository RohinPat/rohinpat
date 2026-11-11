import * as THREE from "three";
import { clamp, signedDist } from "./geo";
import type { CoastSpec, P, Tier } from "./types";

// The sea: a polygon on the water side of the coast line (so no water shows under land), a baked map of the distance to
// the shore, and a small shader that tints by that distance, draws foam at the shore, and on the best tier glitters.
// The mesh sits under the course's mirrored parent; the shader works in the course's x.

/** the water polygon: the coast line run out to a square of half-size `reach` and closed round the water side, counter-clockwise */
export function seaPolygon(c: CoastSpec, reach = 6500): P[] {
  // water on the left of the direction of travel makes the polygon counter-clockwise; on the right, run the line the other way
  const line: P[] = c.sea === "left" ? c.line.map((p) => [...p] as P) : c.line.map((p) => [...p] as P).reverse();
  const toEdge = (from: P, dir: P): P => {
    let t = Infinity;
    for (const ax of [0, 1]) {
      if (Math.abs(dir[ax]) < 1e-9) continue;
      const tt = ((dir[ax] > 0 ? reach : -reach) - from[ax]) / dir[ax];
      if (tt > 0) t = Math.min(t, tt);
    }
    return [from[0] + dir[0] * t, from[1] + dir[1] * t];
  };
  const unit = (a: P, b: P): P => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const n = line.length;
  const s = toEdge(line[0], unit(line[1], line[0]));
  const e = toEdge(line[n - 1], unit(line[n - 2], line[n - 1]));
  // the position round the square's edge, counter-clockwise from the bottom left
  const perim = (p: P) => {
    const eps = 1e-6 * reach;
    if (Math.abs(p[1] + reach) < eps) return p[0] + reach;
    if (Math.abs(p[0] - reach) < eps) return 2 * reach + (p[1] + reach);
    if (Math.abs(p[1] - reach) < eps) return 4 * reach + (reach - p[0]);
    return 6 * reach + (reach - p[1]);
  };
  const corners: [number, P][] = [[0, [-reach, -reach]], [2 * reach, [reach, -reach]], [4 * reach, [reach, reach]], [6 * reach, [-reach, reach]]];
  const total = 8 * reach;
  const pe = perim(e);
  let ps = perim(s);
  if (ps <= pe) ps += total;
  const poly: P[] = [s, ...line, e];
  for (let lap = 0; lap < 2; lap++)
    for (const [pos, p] of corners) {
      const q = pos + lap * total;
      if (q > pe && q < ps) poly.push(p);
    }
  // `s` and `e` are both on the boundary: from `e` the boundary is walked on to `s`; the polygon closes by itself
  return poly;
}

/** the distance to the shore map: RGBA, R = sea-side distance / 240 m (0 on land), B = low noise for sand bars */
export function bakeShore(c: CoastSpec, region: { x0: number; z0: number; w: number; l: number }, size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = region.x0 + ((i + 0.5) / size) * region.w, z = region.z0 + ((j + 0.5) / size) * region.l;
      const sd = signedDist(c, x, z);
      const q = (j * size + i) * 4;
      data[q] = Math.round(clamp(sd / 240, 0, 1) * 255);
      data[q + 1] = 0;
      data[q + 2] = 128;
      data[q + 3] = 255;
    }
  return data;
}

const VERT = `varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = `uniform sampler2D shore; uniform vec4 region; uniform vec3 shallow; uniform vec3 mid; uniform vec3 deep; uniform vec3 foam; uniform vec3 sun;
uniform float t; uniform float cap; uniform float glit;
varying vec3 vW;
#include <fog_pars_fragment>
void main(){
  vec2 c = vec2(-vW.x, vW.z);
  vec2 uv = (c - region.xy) * region.zw;
  float sd = (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? 240.0 : texture2D(shore, uv).r * 240.0;
  vec3 col = mix(shallow, mid, smoothstep(2., 40., sd));
  col = mix(col, deep, smoothstep(30., 200., sd));
  #ifndef LOW
    float n = sin(c.x * 0.05 + t * 0.6) * sin(c.y * 0.043 - t * 0.5);
    col *= 1.0 + 0.04 * n;
  #endif
  float f = (1.0 - smoothstep(1.5, 7.0, sd)) * (0.65 + 0.35 * sin(sd * 0.45 - t * 1.3));
  col = mix(col, foam, f * step(0.01, sd));
  #ifndef LOW
    vec3 V = normalize(cameraPosition - vW);
    vec3 N = normalize(vec3(0.07 * cos(vW.x * 0.31 + t), 1.0, 0.07 * sin(vW.z * 0.27 - t * 1.3)));
    col += vec3(1.0, 0.86, 0.62) * pow(max(dot(reflect(-V, N), normalize(sun)), 0.0), 220.0) * glit;
  #endif
  float ff = min(smoothstep(fogNear, fogFar, vFogDepth), cap);
  gl_FragColor = vec4(mix(col, fogColor, ff), 1.0);
  #include <colorspace_fragment>
}`;

export type Ocean = { mesh: THREE.Mesh; tris: number; dispose: () => void };

/**
 * `sun` is the sky's own sun uniform (so the sea's glitter is where the sky's glow is), world coordinates.
 * A flat tone on the cheapest tier.
 */
export function buildOcean(c: CoastSpec, tier: Tier, region: { x0: number; z0: number; w: number; l: number }, sun: THREE.Vector3, reduce: boolean): Ocean | null {
  const poly = seaPolygon(c);
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = new Float32Array(poly.length * 3);
  poly.forEach(([x, z], i) => {
    pos[i * 3] = x;
    pos[i * 3 + 1] = c.seaY;
    pos[i * 3 + 2] = z;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(faces.flat());
  const disposables: { dispose: () => void }[] = [g];
  let mat: THREE.Material;
  if (tier === "soft") {
    mat = new THREE.MeshBasicMaterial({ color: c.tones.mid, fog: true, side: THREE.DoubleSide });
  } else {
    const size = tier === "high" ? 256 : 128;
    const tex = new THREE.DataTexture(new Uint8Array(bakeShore(c, region, size)), size, size, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const col = (h: string) => new THREE.Color(h);
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        shore: { value: tex },
        region: { value: new THREE.Vector4(region.x0, region.z0, 1 / region.w, 1 / region.l) },
        shallow: { value: col(c.tones.shallow) },
        mid: { value: col(c.tones.mid) },
        deep: { value: col(c.tones.deep) },
        foam: { value: col(c.tones.foam) },
        sun: { value: sun },
        t: { value: 0 },
        cap: { value: 0.62 },
        glit: { value: c.glitter ?? 0 },
      },
    ]);
    const sm = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, fog: true, side: THREE.DoubleSide, defines: tier === "low" ? { LOW: "" } : {} });
    mat = sm;
    disposables.push(tex);
  }
  disposables.push(mat);
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  if (mat instanceof THREE.ShaderMaterial && tier === "high") {
    mesh.onBeforeRender = () => {
      mat.uniforms.t.value = reduce ? 0 : performance.now() / 1000;
    };
  }
  return { mesh, tris: faces.length, dispose: () => disposables.forEach((d) => d.dispose()) };
}
