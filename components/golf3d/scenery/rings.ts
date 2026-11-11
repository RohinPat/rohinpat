import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { lerp, pathLength, smooth, wrapDeg } from "./geo";
import type { P, RingLayer, Sector, SceneryRecord, Tier } from "./types";

// Layers of far mountains all the way round, one opaque mesh with vertex colours: each layer is a vertical wall at its
// radius whose top is a height by bearing. Nearer layers hide farther ones through the depth buffer. They sit in the
// hole's group, so bearings are the course's (0 downrange, positive to the right).

const SEGS: Record<Tier, number> = { high: 160, low: 112, soft: 96 };
const LAYERS: Record<Tier, number> = { high: 99, low: 3, soft: 1 };
const DEG = Math.PI / 180;

const sstep = (a: number, b: number, v: number) => smooth(a, b, v);

function shapeValue(s: Sector, deg: number): number {
  const seed = s.seed ?? 1;
  const [lo, hi] = s.h;
  const th = deg * DEG;
  switch (s.shape) {
    case "flat":
      return lo;
    case "rolling": {
      const a = 5 + (seed % 4), b = 11 + (seed % 5), c = 23 + (seed % 7);
      const v = 0.5 * Math.sin(a * th + seed * 1.3) + 0.3 * Math.sin(b * th + seed * 2.1) + 0.2 * Math.sin(c * th + seed * 0.7);
      return lo + (hi - lo) * (0.5 + 0.5 * v);
    }
    case "jagged": {
      const k1 = 14 + (seed % 5), k2 = 31 + (seed % 7);
      const v = 0.6 * Math.abs(Math.sin(k1 * th + seed)) + 0.4 * Math.abs(Math.sin(k2 * th + seed * 1.7));
      return lo + (hi - lo) * Math.pow(1 - v, 1.4);
    }
    case "mesa": {
      const k = 16 + (seed % 5);
      return lo + (hi - lo) * sstep(0.42, 0.5, 0.5 + 0.5 * Math.sin(k * th + seed));
    }
    case "cone": {
      const c = (s.from + s.to) / 2, spread = ((s.to - s.from) / 2) * 0.5 * DEG;
      const d = wrapDeg(deg - c) * DEG;
      return lo + (hi - lo) * Math.exp(-((d / spread) ** 2));
    }
  }
}

/** the share of a sector at a bearing: 1 inside, easing to 0 over `feather` degrees at its edges */
function windowOf(s: Sector, deg: number): number {
  const c = (s.from + s.to) / 2, half = (s.to - s.from) / 2;
  const d = Math.abs(wrapDeg(deg - c));
  const f = s.feather ?? 8;
  if (f <= 0) return d <= half ? 1 : 0;
  return sstep(half, half - f, d);
}

/** a layer's height above its base at a bearing (radians) */
export function ringHeight(layer: RingLayer, bearing: number): number {
  const deg = bearing / DEG;
  const floor = layer.floor ?? 0;
  let h = floor;
  for (const s of layer.sectors) {
    const w = windowOf(s, deg);
    if (w > 0) h = lerp(h, shapeValue(s, deg), w);
  }
  const n = layer.notch;
  if (n) h = floor + (h - floor) * (1 - n.depth * (1 - sstep(0, n.half, Math.abs(wrapDeg(deg - n.bearing)))));
  return h;
}

/** the layer's colour at a bearing: the sector's own where it has one, snow on the peaks of a snowy sector */
function sectorOf(layer: RingLayer, deg: number): Sector | undefined {
  let best: Sector | undefined, bw = 0.5;
  for (const s of layer.sectors) {
    const w = windowOf(s, deg);
    if (w >= bw) [best, bw] = [s, w];
  }
  return best;
}

const SNOW = new THREE.Color("#f1f6f8");

export function ringCentre(hole: BuiltHole): P {
  const line = hole.line;
  const half = pathLength(line) / 2;
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const l = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (s + l >= half) {
      const u = (half - s) / (l || 1);
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * u, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * u];
    }
    s += l;
  }
  return line[line.length - 1];
}

/**
 * The rings of a scene as triangle data: three rows per bearing (the foot, hazed; the shoulder; the crest), two strips.
 * `haze` is the colour the foot fades into.
 */
export function ringGeometry(rec: SceneryRecord, centre: P, tier: Tier, haze = "#d4e6e6"): { positions: Float32Array; colors: Float32Array; tris: number } {
  const layers = (rec.rings ?? []).filter((l) => (tier === "soft" ? l.soft : true)).slice(0, LAYERS[tier]);
  const S = SEGS[tier];
  const y0 = rec.ringY0 ?? 0;
  const tris = layers.length * S * 4;
  const positions = new Float32Array(tris * 9), colors = new Float32Array(tris * 9);
  let k = 0;
  const hz = new THREE.Color(haze);
  const col = new THREE.Color(), foot = new THREE.Color(), top = new THREE.Color();
  const v = (x: number, y: number, z: number, c: THREE.Color) => {
    positions[k * 3] = x; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z;
    colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
    k++;
  };
  for (const layer of layers) {
    const base = new THREE.Color(layer.color);
    const at = (i: number) => {
      const th = (i / S) * Math.PI * 2;
      const deg = th / DEG;
      const h = ringHeight(layer, th);
      const sec = sectorOf(layer, deg);
      col.copy(sec?.color ? new THREE.Color(sec.color) : base);
      const x = centre[0] + Math.sin(th) * layer.radius, z = centre[1] + Math.cos(th) * layer.radius;
      const floor = layer.floor ?? 0;
      const rel = h - floor;
      top.copy(col);
      if (sec?.snow !== undefined && rel > 0) {
        const hi = sec.h[1] - floor;
        const share = hi > 0 ? rel / hi : 0;
        top.lerp(SNOW, sstep(sec.snow, Math.min(1, sec.snow + 0.12), share));
      }
      foot.copy(col).lerp(hz, 0.85);
      return { x, z, h, mid: col.clone(), top: top.clone(), foot: foot.clone() };
    };
    let a = at(0);
    for (let i = 0; i < S; i++) {
      const b = at(i + 1);
      const y = (p: { h: number }, r: number) => (r === 0 ? y0 - 60 : r === 1 ? y0 + (layer.floor ?? 0) + 0.15 * (p.h - (layer.floor ?? 0)) : y0 + p.h);
      for (const r of [0, 1]) {
        const ca = r === 0 ? a.foot : a.mid, cb = r === 0 ? b.foot : b.mid;
        const ta = r === 0 ? a.mid : a.top, tb = r === 0 ? b.mid : b.top;
        v(a.x, y(a, r), a.z, ca); v(b.x, y(b, r), b.z, cb); v(a.x, y(a, r + 1), a.z, ta);
        v(b.x, y(b, r), b.z, cb); v(b.x, y(b, r + 1), b.z, tb); v(a.x, y(a, r + 1), a.z, ta);
      }
      a = b;
    }
  }
  return { positions, colors, tris: k / 3 };
}

export function buildRings(hole: BuiltHole, rec: SceneryRecord, tier: Tier, haze?: string): THREE.Mesh | null {
  if (!rec.rings?.length) return null;
  const d = ringGeometry(rec, ringCentre(hole), tier, haze);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(d.positions.subarray(0, d.tris * 9), 3));
  g.setAttribute("color", new THREE.BufferAttribute(d.colors.subarray(0, d.tris * 9), 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return mesh;
}
