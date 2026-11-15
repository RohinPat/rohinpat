import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import type { Tier } from "./scenery";

// A lake's waterfall (HoleDef.falls): where a lake spills off its level down to a bay below, the water that is not in play
// (no physics reads this file). A curtain of water from the lip on the lake's shore, falling out and down in a free-fall
// arc to the bay, which is clamped to the drawn ground so it lies down a bank where the ground rises into its path. Streaks of
// white run down it in the shader, the lip is white, and there is a pool of foam where it lands. One surface, one foam disc:
// two draws. On the middle tier it stands still; on the cheapest it is a flat tone. Under reduced motion nothing moves.

const SEGS: Record<Tier, { along: number; across: number }> = { high: { along: 14, across: 4 }, low: { along: 8, across: 2 }, soft: { along: 4, across: 1 } };
const WATER = "#9fd8e6", FOAM = "#f4fbfb";
/** how far the sheet stands off the drawn ground, m */
const CLEAR = 0.25;

export type FallsOpts = {
  hole: BuiltHole;
  /** the drawn ground (m), so the sheet lies down a bank it meets */
  drawnAt: (x: number, z: number) => number;
  /** the lake's level at the lip (m) */
  lipY: number;
  /** the bay's level at the foot (m) */
  bayY: number;
  tier: Tier;
  reduce: boolean;
  disposables: { dispose: () => void }[];
};

/** the sheet's surface at (s along, lateral) in metres: a free fall from the lip, clamped to the drawn ground */
export function fallsPoints(from: [number, number], to: [number, number], width: number, lipY: number, bayY: number, drawnAt: (x: number, z: number) => number, along: number, across: number) {
  const fx = from[0] * YD, fz = from[1] * YD, tx = to[0] * YD, tz = to[1] * YD;
  const dx = tx - fx, dz = tz - fz;
  // across the fall, in plan: perpendicular to the flow
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len, nz = dx / len;
  const w = width * YD;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i <= along; i++) {
    const s = i / along;
    // horizontal launch from the lip: the water leaves it flat and falls away to the bay
    const yc = lipY - (lipY - bayY) * s * s;
    for (let j = 0; j <= across; j++) {
      const u = j / across;
      const lat = (u - 0.5) * w;
      const x = fx + dx * s + nx * lat, z = fz + dz * s + nz * lat;
      const y = Math.max(yc, drawnAt(x, z) + CLEAR);
      pos.push(x, y, z);
      uv.push(u, s);
    }
  }
  return { pos, uv, tx, tz, w };
}

export type Falls = { group: THREE.Group; calls: number; tris: number };

export function buildFalls(o: FallsOpts): Falls | null {
  const spec = o.hole.def.falls;
  if (!spec) return null;
  const seg = SEGS[o.tier];
  const { pos, uv, tx, tz, w } = fallsPoints(spec.from, spec.to, spec.width, o.lipY, o.bayY, o.drawnAt, seg.along, seg.across);
  const idx: number[] = [];
  const row = seg.across + 1;
  for (let i = 0; i < seg.along; i++)
    for (let j = 0; j < seg.across; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const group = new THREE.Group();
  const clock: { value: number }[] = [];
  const animate = o.tier === "high" && !o.reduce;
  const fogU = THREE.UniformsLib.fog;

  let sheetMat: THREE.Material;
  if (o.tier === "soft") {
    sheetMat = new THREE.MeshBasicMaterial({ color: WATER, side: THREE.DoubleSide, fog: true });
  } else {
    const U = { ...THREE.UniformsUtils.clone(fogU), t: { value: 0 }, cWater: { value: new THREE.Color(WATER) }, cFoam: { value: new THREE.Color(FOAM) } };
    if (animate) clock.push(U.t);
    sheetMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SHEET_FRAG, uniforms: U, fog: true, side: THREE.DoubleSide });
  }
  const sheet = new THREE.Mesh(g, sheetMat);
  sheet.frustumCulled = false;
  group.add(sheet);
  o.disposables.push(g, sheetMat);

  // the pool of foam where it lands: a disc flat on the bay, bright at the middle and fading out
  let foamMat: THREE.Material | null = null;
  if (o.tier !== "soft") {
    const r = w * 0.9;
    const fg = new THREE.CircleGeometry(r, 18).rotateX(-Math.PI / 2).translate(tx, o.bayY + 0.12, tz);
    // (the disc's uv, 0 to 1 across it, is mapped to the shader's own centre below)
    const FU = { ...THREE.UniformsUtils.clone(fogU), t: { value: 0 }, cFoam: { value: new THREE.Color(FOAM) } };
    if (animate) clock.push(FU.t);
    foamMat = new THREE.ShaderMaterial({ vertexShader: VERT_FOAM, fragmentShader: FOAM_FRAG, uniforms: FU, fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const fm = new THREE.Mesh(fg, foamMat);
    fm.frustumCulled = false;
    group.add(fm);
    o.disposables.push(fg, foamMat);
  }
  // one clock for both, ticked as the sheet draws
  if (clock.length) sheet.onBeforeRender = () => { const tt = performance.now() / 1000; for (const u of clock) u.value = tt; };
  return { group, calls: o.tier === "soft" ? 1 : 2, tris: idx.length / 3 + (o.tier === "soft" ? 0 : 36) };
}

const VERT = `varying vec2 vUv; varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

// u across the fall (0 to 1), s down it from the lip (0) to the bay (1)
const SHEET_FRAG = `uniform float t; uniform vec3 cWater; uniform vec3 cFoam;
varying vec2 vUv; varying vec3 vW;
#include <fog_pars_fragment>
void main(){
  float u = vUv.x, s = vUv.y;
  // streaks of white that run down the sheet, broken and quicker toward the foot
  float streak = sin(u * 26.0 + sin(s * 5.0 + u * 3.0) * 1.7);
  float run = 0.5 + 0.5 * sin(s * 12.0 - t * 9.0 + u * 4.0);
  float white = smoothstep(0.35, 0.95, streak * 0.5 + 0.5) * (0.45 + 0.55 * run);
  vec3 col = mix(cWater, cFoam, clamp(0.25 + 0.55 * white + 0.35 * smoothstep(0.55, 1.0, s), 0.0, 1.0));
  // the lip, where the water leaves the lake, is white
  col = mix(col, cFoam, 1.0 - smoothstep(0.0, 0.07, s));
  // a little darker at the edges, where the sheet meets the air
  col *= 0.94 + 0.06 * sin(u * 3.14159);
  float ff = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor = vec4(mix(col, fogColor, ff), 1.0);
  #include <colorspace_fragment>
}`;

const VERT_FOAM = `varying vec2 vUv;
#include <fog_pars_vertex>
void main(){
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FOAM_FRAG = `uniform float t; uniform vec3 cFoam; varying vec2 vUv;
#include <fog_pars_fragment>
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // a ring of bubbles that spreads out from the middle, and a bright core
  float ring = 0.5 + 0.5 * sin(r * 14.0 - t * 3.0);
  float a = smoothstep(1.0, 0.4, r) * (0.55 + 0.45 * ring);
  float ff = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor = vec4(mix(cFoam, fogColor, ff), clamp(a, 0.0, 1.0) * 0.9);
  #include <colorspace_fragment>
}`;
