import * as THREE from "three";
import { seeded } from "@/components/offhours/useCanvas";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import { DECK_THICK, RAIL_H, bridgeShape, rockCluster, wallRuns, type Prop, type PropGround } from "@/components/offhours/golf/solids";

// A hole's props (HoleDef.props, solids.ts) as three.js meshes. Everything is built into two merged meshes however
// many props there are: one for the solid things (stone, wood, paint: one draw call, vertex-coloured, flat-shaded)
// and one for the plants (reeds and tufts, double-sided). Merged rather than instanced because the pieces differ
// (every stone of a wall is its own box) and each hole's props are few and always in the same place; the signature
// prototypes drew 45 boulders as 45 meshes, which took a hole from 13 draw calls to 61.
//
// Tiers (quality.ts, hole3d.ts TIERS): "high" is the full build; "low" has bigger stones, fewer courses, rocks with
// 20 faces instead of 80 and 60% of the plants; "soft" is the same as low with a third of the plants.

type Tier = "high" | "low" | "soft";
type P = [number, number];

const TIER = {
  high: { course: 0.3, stone: 0.78, ico: 1, sides: 8, plank: 0.34, plants: 1, mid: true },
  low: { course: 0.4, stone: 1.1, ico: 0, sides: 6, plank: 0.6, plants: 0.6, mid: false },
  soft: { course: 0.4, stone: 1.1, ico: 0, sides: 6, plank: 0.6, plants: 0.35, mid: false },
};

const STONE = ["#8f8c84", "#a39f94", "#7d7a73", "#9a968a", "#b0aa9c"];
const MOSS = new THREE.Color("#5f7a45");
const STAKE: Record<string, string> = { red: "#d6403f", yellow: "#f0c419", white: "#f2efe6" };

/** a number in [0, 1) from a position and a seed, the same every time (so a template's shared corners move together) */
const hash = (x: number, y: number, z: number, s: number) => {
  let h = Math.imul(Math.round(x * 997) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(Math.round(y * 991) ^ s, 0xc2b2ae35) ^ Math.imul(Math.round(z * 983), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 100000) / 100000;
};

type Tpl = Float32Array;
const tpl = (g: THREE.BufferGeometry): Tpl => {
  const n = g.index ? g.toNonIndexed() : g;
  const a = new Float32Array(n.attributes.position.array);
  return a;
};

class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  private v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();
  private c = new THREE.Color();

  /** a template placed by `m`; corners pulled by up to `jit` (local units); upward faces mixed toward moss by `moss`; undersides dropped when `ground` */
  add(t: Tpl, m: THREE.Matrix4, base: THREE.Color, o: { jit?: number; seed?: number; moss?: number; ground?: boolean; vary?: number } = {}) {
    const { jit = 0, seed = 0, moss = 0, ground = false, vary = 0.1 } = o;
    const v = this.v;
    for (let i = 0; i < t.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const x = t[i + k * 3], y = t[i + k * 3 + 1], z = t[i + k * 3 + 2];
        if (jit) v[k].set(x + (hash(x, y, z, seed) - 0.5) * 2 * jit, y + (hash(x, y, z, seed + 1) - 0.5) * 2 * jit, z + (hash(x, y, z, seed + 2) - 0.5) * 2 * jit);
        else v[k].set(x, y, z);
        v[k].applyMatrix4(m);
      }
      this.e1.subVectors(v[1], v[0]);
      this.e2.subVectors(v[2], v[0]);
      this.e1.cross(this.e2);
      const l = this.e1.length();
      if (l < 1e-9) continue;
      this.e1.multiplyScalar(1 / l);
      if (ground && this.e1.y < -0.7) continue;
      this.c.copy(base);
      if (moss && this.e1.y > 0.5) this.c.lerp(MOSS, moss * Math.min(1, (this.e1.y - 0.5) * 2));
      const sh = 1 - vary / 2 + vary * hash(v[0].x, v[0].y, v[0].z, seed + 7);
      for (let k = 0; k < 3; k++) {
        this.pos.push(v[k].x, v[k].y, v[k].z);
        this.nor.push(this.e1.x, this.e1.y, this.e1.z);
        this.col.push(this.c.r * sh, this.c.g * sh, this.c.b * sh);
      }
    }
  }

  /** one flat triangle (plants) */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ca: THREE.Color, cb: THREE.Color = ca, cc: THREE.Color = ca) {
    this.e1.subVectors(b, a);
    this.e2.subVectors(c, a);
    this.e1.cross(this.e2).normalize();
    for (const [p, q] of [[a, ca], [b, cb], [c, cc]] as const) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(this.e1.x, this.e1.y, this.e1.z);
      this.col.push(q.r, q.g, q.b);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const Q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const S = new THREE.Vector3();
const T = new THREE.Vector3();
const M4 = new THREE.Matrix4();
const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, tilt = 0) => {
  Q.setFromAxisAngle(UP, yaw);
  if (tilt) Q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
  return M4.compose(T.set(x, y, z), Q, S.set(sx, sy, sz));
};

export type Props3D = {
  group: THREE.Group;
  /** the number of triangles and meshes (draw calls) this adds */
  tris: number;
  meshes: number;
  dispose: () => void;
};

/** The props of one hole as one group; null for a hole with none. */
export function buildProps3D(hole: BuiltHole, ground: PropGround, tier: Tier, disposables: { dispose: () => void }[] = []): Props3D | null {
  const props = hole.def.props;
  if (!props || !props.length) return null;
  const TR = TIER[tier];
  const solid = new Mesher();
  const plant = new Mesher();
  const seed0 = hole.def.n * 101;

  const BOX = tpl(new THREE.BoxGeometry(1, 1, 1));
  const ICO = tpl(new THREE.IcosahedronGeometry(1, TR.ico));
  const ICO0 = tpl(new THREE.IcosahedronGeometry(1, 0));
  const cyl = (top: number, bot: number, sides: number) => tpl(new THREE.CylinderGeometry(top, bot, 1, sides).translate(0, 0.5, 0));
  const POLE = cyl(1, 1, 6);
  const CONE = tpl(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0));
  const col = (h: string) => new THREE.Color(h);
  /** the lowest ground under a footprint, so a stone on a slope sits on the downhill side */
  const low = (x: number, z: number, r: number) => Math.min(ground.y(x, z), ground.y(x + r, z), ground.y(x - r, z), ground.y(x, z + r), ground.y(x, z - r));
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, c: string, o: Parameters<Mesher["add"]>[3] = {}) =>
    solid.add(BOX, place(x, y + sy / 2, z, sx, sy, sz, yaw), col(c), { ground: true, ...o });

  props.forEach((p, pi) => {
    const rnd = seeded(seed0 + pi * 17 + (("seed" in p && p.seed) || 0) * 131);
    switch (p.kind) {
      case "boulder": {
        const s = p.size;
        const x = p.at[0] * YD, z = p.at[1] * YD;
        const w = s * (1 + rnd() * 0.18), d = s * (0.92 + rnd() * 0.18), h = s * (0.78 + rnd() * 0.16);
        const y0 = low(x, z, s * 0.8);
        solid.add(ICO, place(x, y0 + h * 0.5, z, w, h, d, rnd() * 6.28, (rnd() - 0.5) * 0.15), col(STONE[Math.floor(rnd() * STONE.length)]), { jit: TR.ico ? 0.14 : 0.2, seed: pi, moss: 0.5, ground: true, vary: 0.14 });
        // a smaller one leaning on it
        if (s > 1.3) {
          const a = rnd() * 6.28;
          const bx = x + Math.cos(a) * s * 0.9, bz = z + Math.sin(a) * s * 0.9;
          solid.add(ICO, place(bx, low(bx, bz, s * 0.4) + s * 0.2, bz, s * 0.5, s * 0.38, s * 0.45, rnd() * 6.28), col(STONE[Math.floor(rnd() * STONE.length)]), { jit: 0.16, seed: pi + 5, moss: 0.4, ground: true, vary: 0.14 });
        }
        break;
      }
      case "rocks": {
        for (const k of rockCluster(p)) solid.add(ICO0, place(k.x, low(k.x, k.z, k.s) + k.s * 0.35, k.z, k.s, k.s * 0.7, k.s * 0.9, k.rot), col(STONE[Math.floor(rnd() * STONE.length)]), { jit: 0.18, seed: pi, moss: 0.35, ground: true, vary: 0.14 });
        break;
      }
      case "wall": {
        const h = p.h ?? 1.2;
        const rows = Math.max(2, Math.round(h / TR.course));
        const ch = h / rows;
        for (const run of wallRuns(p)) {
          // along the run in stones, a course at a time, each course starting half a stone later than the one below
          let total = 0;
          const cum = [0];
          for (let i = 1; i < run.length; i++) cum.push((total += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1])));
          const at = (s: number): [number, number, number] => {
            let i = 0;
            while (i < run.length - 2 && s > cum[i + 1]) i++;
            const k = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
            return [run[i][0] + (run[i + 1][0] - run[i][0]) * k, run[i][1] + (run[i + 1][1] - run[i][1]) * k, Math.atan2(run[i + 1][0] - run[i][0], run[i + 1][1] - run[i][1])];
          };
          for (let row = 0; row <= rows; row++) {
            const cap = row === rows;
            let s = -((row % 2) * 0.5 + rnd() * 0.2) * TR.stone;
            while (s < total) {
              const len = (cap ? 1.15 : 0.7 + rnd() * 0.5) * (TR.stone / 0.78) * (cap ? 0.85 : 1);
              const a = Math.max(0, s), b = Math.min(total, s + len);
              s += len;
              if (b - a < 0.2) continue;
              const [x0, z0] = at(a), [x1, z1] = at(b);
              const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
              const yaw = Math.atan2(x1 - x0, z1 - z0);
              // a stone sits on the lower end of its own length, and its first course is let into the ground
              const gy = Math.min(low(x0, z0, 0.3), low(x1, z1, 0.3)) - 0.1;
              const taper = 1 - (row / (rows + 1)) * 0.22;
              const th = (cap ? 0.78 : 0.62 * taper) * (0.92 + rnd() * 0.16);
              const sh = ch * (cap ? 0.72 : 0.92 + rnd() * 0.16);
              const dark = 0.86 + 0.14 * (row / rows);
              const c = new THREE.Color(cap ? "#b7b1a2" : STONE[Math.floor(rnd() * STONE.length)]).multiplyScalar(dark);
              solid.add(BOX, place(mx, gy + row * ch + sh / 2 + (cap ? 0.05 : 0), mz, Math.hypot(x1 - x0, z1 - z0) * 0.97, sh, th, yaw), c, { jit: 0.1, seed: pi * 3 + row, ground: true, moss: cap ? 0.45 : 0, vary: 0.16 });
            }
          }
        }
        break;
      }
      case "gatepost": {
        const sx = Math.sin(p.yaw) * p.gap / 2, sz = Math.cos(p.yaw) * p.gap / 2;
        for (const side of [-1, 1]) {
          const x = p.at[0] * YD + side * sx, z = p.at[1] * YD + side * sz;
          const y0 = low(x, z, 0.3) - 0.1;
          const ph = p.h ?? 1.6, pw = ph > 2.5 ? 0.9 : 0.55;
          box(x, y0, z, pw, ph, pw, p.yaw + 0.05 * side, "#a39f94", { jit: 0.05, seed: pi, vary: 0.16 });
          box(x, y0 + ph, z, pw * 1.38, 0.14 + (ph - 1.6) * 0.04, pw * 1.38, p.yaw + 0.05 * side, "#b7b1a2", { jit: 0.03, seed: pi + 1, moss: 0.3 });
        }
        break;
      }
      case "post": {
        const h = p.h ?? 2.4, r = p.r ?? 0.12;
        const x = p.at[0] * YD, z = p.at[1] * YD;
        const y0 = low(x, z, 0.5);
        const [c0, c1] = p.colors ?? ["#e5484d", "#f4efe4"];
        const band = Math.max(0.3, h / 9);
        const n = Math.max(2, Math.round(h / band));
        for (let i = 0; i < n; i++) solid.add(POLE, place(x, y0 + (i * h) / n, z, r, h / n + 0.002, r), col(i % 2 ? c1 : c0), { vary: 0.03 });
        // a ball on top, and a cairn at the foot
        solid.add(ICO0, place(x, y0 + h + r * 1.2, z, r * 1.8, r * 1.8, r * 1.8), col(c0), { vary: 0.03 });
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7 + rnd();
          solid.add(ICO0, place(x + Math.cos(a) * r * 3, y0 + 0.08, z + Math.sin(a) * r * 3, 0.26, 0.2, 0.24, a), col(STONE[i % STONE.length]), { jit: 0.15, seed: i, ground: true });
        }
        break;
      }
      case "stake": {
        const x = p.at[0] * YD, z = p.at[1] * YD;
        const y0 = low(x, z, 0.1) - 0.05;
        solid.add(BOX, place(x, y0 + 0.5, z, 0.06, 1.0, 0.06, rnd() * 3), col("#e9e3d2"), { vary: 0.02 });
        solid.add(BOX, place(x, y0 + 0.82, z, 0.072, 0.34, 0.072, 0), col(STAKE[p.color]), { vary: 0.02 });
        break;
      }
      case "bench": {
        const x = p.at[0] * YD, z = p.at[1] * YD;
        const y0 = low(x, z, 0.8);
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        // yaw 0 faces +z: the long side runs along x
        const off = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
        const seat = off(0, 0);
        box(seat[0], y0 + 0.42, seat[1], 1.6, 0.06, 0.45, p.yaw, "#8a6a4a");
        const back = off(0, -0.2);
        box(back[0], y0 + 0.64, back[1], 1.6, 0.34, 0.05, p.yaw, "#7b5c3e");
        for (const u of [-0.7, 0.7]) {
          const l = off(u, 0);
          box(l[0], y0, l[1], 0.08, 0.42, 0.4, p.yaw, "#4f4a44");
        }
        break;
      }
      case "sign": {
        const x = p.at[0] * YD, z = p.at[1] * YD;
        const y0 = low(x, z, 0.3);
        box(x, y0 - 0.1, z, 0.1, 1.5, 0.1, p.yaw, "#6f5238");
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        box(x + s * 0.07, y0 + 0.9, z + c * 0.07, 0.75, 0.42, 0.04, p.yaw, "#e9e1c8");
        box(x + s * 0.1, y0 + 1.03, z + c * 0.1, 0.55, 0.05, 0.02, p.yaw, "#3d6f4a");
        break;
      }
      case "bridge": {
        const b = bridgeShape(p, ground);
        const yaw = Math.atan2(b.ux, b.uz);
        const at = (k: number, across = 0): [number, number] => [b.ax + (b.bx - b.ax) * k + b.nx * across, b.az + (b.bz - b.az) * k + b.nz * across];
        // the deck: planks across, on two stringers
        const np = Math.max(2, Math.round(b.len / TR.plank));
        const pl = b.len / np;
        for (let i = 0; i < np; i++) {
          const [x, z] = at((i + 0.5) / np);
          box(x, b.deckY - DECK_THICK, z, b.w, DECK_THICK, pl * 0.9, yaw, i % 2 ? "#a58660" : "#b3946c", { jit: 0.02, seed: i, vary: 0.1, ground: false });
        }
        for (const side of [-0.38, 0.38]) {
          const [x, z] = at(0.5, side * b.w);
          box(x, b.deckY - DECK_THICK - 0.28, z, 0.2, 0.28, b.len, yaw, "#6f5238", { ground: false });
        }
        // rails: posts every 2 m, a top rail and a lower one
        const nr = Math.max(2, Math.round(b.len / 2));
        for (const side of [-1, 1]) {
          for (let i = 0; i <= nr; i++) {
            const [x, z] = at(i / nr, side * (b.w / 2 - 0.06));
            box(x, b.deckY, z, 0.12, RAIL_H, 0.12, yaw, "#7b5c3e", { ground: false });
          }
          const [rx, rz] = at(0.5, side * (b.w / 2 - 0.06));
          box(rx, b.deckY + RAIL_H - 0.1, rz, 0.1, 0.1, b.len, yaw, "#8a6a4a", { ground: false });
          if (TR.mid) box(rx, b.deckY + 0.42, rz, 0.06, 0.07, b.len, yaw, "#8a6a4a", { ground: false });
        }
        // stone abutments at both ends, let down to the ground whatever its height (a carved bank leaves them taller)
        for (const [k, dir] of [[0, 1], [1, -1]] as const) {
          const [x, z] = at(k, 0);
          const ex = x + b.ux * dir * 0.45, ez = z + b.uz * dir * 0.45;
          const g0 = low(ex, ez, b.w / 2) - 0.4;
          box(ex, g0, ez, b.w + 0.7, Math.max(0.3, b.deckY - DECK_THICK - g0), 1.5, yaw, "#9b968a", { jit: 0.05, seed: pi + k, moss: 0.25, vary: 0.16 });
        }
        // trestles under the span, standing on whatever is below (nothing where the ground comes up to the deck)
        if (b.len > 8) {
          for (const k of [0.3, 0.5, 0.7]) {
            for (const side of [-1, 1]) {
              const [x, z] = at(k, side * (b.w / 2 - 0.2));
              const g = ground.y(x, z) - 0.3;
              if (b.deckY - DECK_THICK - g < 0.2) continue;
              solid.add(POLE, place(x, g, z, 0.1, b.deckY - DECK_THICK - 0.3 - g, 0.1), col("#6f5238"), { vary: 0.05 });
            }
          }
        }
        break;
      }
      case "reeds":
      case "tuft": {
        plantInto(plant, p, rnd, ground, TR.plants);
        break;
      }
    }
  });

  const group = new THREE.Group();
  const out: { dispose: () => void }[] = [];
  let tris = 0, meshes = 0;
  if (solid.pos.length) {
    const g = solid.geometry();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    out.push(g, m);
    tris += solid.pos.length / 9;
    meshes++;
  }
  if (plant.pos.length) {
    const g = plant.geometry();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    group.add(mesh);
    out.push(g, m);
    tris += plant.pos.length / 9;
    meshes++;
  }
  disposables.push(...out);
  return { group, tris, meshes, dispose: () => out.forEach((d) => d.dispose()) };
}

/** blades: a reed is a tall tapering blade with a seed head, a tuft a fan of short ones */
function plantInto(m: Mesher, p: Extract<Prop, { kind: "reeds" | "tuft" }>, rnd: () => number, ground: PropGround, share: number) {
  const reed = p.kind === "reeds";
  const n = Math.max(3, Math.round(p.n * share));
  const greens = reed ? ["#6f8f3c", "#86a24a", "#a2a853", "#5f7f38"] : ["#5e9a45", "#78b04f", "#4f8a3f", "#8cc25a"];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const ang = rnd() * 6.28, rad = Math.sqrt(rnd()) * p.r * YD;
    const x = p.at[0] * YD + Math.cos(ang) * rad, z = p.at[1] * YD + Math.sin(ang) * rad;
    const y = ground.y(x, z) - 0.03;
    const blades = reed ? 1 : 4;
    for (let k = 0; k < blades; k++) {
      const h = reed ? 0.9 + rnd() * 0.9 : 0.22 + rnd() * 0.2;
      const w = reed ? 0.045 : 0.05;
      const dir = rnd() * 6.28, lean = h * (0.12 + rnd() * 0.25);
      const lx = Math.cos(dir), lz = Math.sin(dir);
      const wx = -lz, wz = lx;
      const c0 = new THREE.Color(greens[Math.floor(rnd() * greens.length)]);
      const c1 = c0.clone().lerp(new THREE.Color("#d8d28a"), reed ? 0.35 : 0.25);
      // a lower quad and a tip, bending away
      const mx = x + lx * lean * 0.3, mz = z + lz * lean * 0.3, my = y + h * 0.55;
      const tx = x + lx * lean, tz = z + lz * lean, ty = y + h;
      a.set(x - wx * w, y, z - wz * w);
      b.set(x + wx * w, y, z + wz * w);
      c.set(mx + wx * w * 0.5, my, mz + wz * w * 0.5);
      d.set(mx - wx * w * 0.5, my, mz - wz * w * 0.5);
      m.tri(a, b, c, c0, c0, c1);
      m.tri(a, c, d, c0, c1, c1);
      m.tri(d, c, new THREE.Vector3(tx, ty, tz), c1, c1, c1);
      if (reed && rnd() < 0.3) {
        // a brown seed head
        const hh = 0.22;
        const head = new THREE.Color("#6b4a2e");
        const hx = tx - lx * 0.0, hz = tz - lz * 0.0;
        a.set(hx - wx * 0.035, ty - hh, hz - wz * 0.035);
        b.set(hx + wx * 0.035, ty - hh, hz + wz * 0.035);
        c.set(hx, ty + 0.04, hz);
        m.tri(a, b, c, head);
      }
    }
  }
}

/** every side of a hole's props, for a test: what would be drawn, with no GL */
export const propKinds = (props: Prop[] | undefined) => Array.from(new Set((props ?? []).map((p) => p.kind)));
export type { Prop };
void (null as unknown as P);
