import * as THREE from "three";
import type { Surface } from "@/components/offhours/golf/flight";

// Little bursts where the ball meets the ground: turf and dust off the
// fairway, a spray of sand out of a bunker, a splash and rings on water, a puff
// of grass at the strike. One instanced mesh of chips for all of them, and a few
// rings; nothing is allocated while they fly.

const MAX = 220;
const RINGS = 4;
const G = 9.8;
/** a chip is never drawn smaller than this, px */
const MIN_PX = 3;
const PUFFS = 6;
/** a puff of dust is never smaller than this across, px, at its widest */
const PUFF_PX = 26;

type P = { x: number; y: number; z: number; fy: number; vx: number; vy: number; vz: number; life: number; age: number; size: number; drag: number; grav: number; spin: number };

export type Fx3D = {
  group: THREE.Group;
  /** a burst where the ball came down on `surface`, at speed `v` (m/s, downward) */
  land: (x: number, z: number, surface: Surface, v: number, y?: number) => void;
  /** the strike: grass off the turf, or sand out of a bunker */
  strike: (x: number, z: number, surface: Surface, yaw: number, y?: number) => void;
  step: (dt: number, cam: THREE.Vector3, F: number) => void;
  clear: () => void;
  /** chips in the air now */
  count: () => number;
  dispose: () => void;
};

// light against the grass so a puff reads from far off: dust and blades, with a little soil off the fairway and rough
const COLORS: Partial<Record<Surface, string[]>> = {
  fairway: ["#e9f5c8", "#c7e39a", "#8a6a44", "#f6fbe6"],
  rough: ["#d6eab0", "#a9cf7c", "#7a5c3a"],
  green: ["#f4fbe4", "#dcf0b8", "#ffffff"],
  fringe: ["#eef8d8", "#cfe8a6"],
  bunker: ["#f3e6c4", "#e2cc98", "#fff4dc", "#d2b783"],
  water: ["#ffffff", "#eef8fc", "#d8eef6"],
  out: ["#c9dca8", "#7a5c3a"],
};

export function createFx3D(reduce = false): Fx3D {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  group.add(mesh);
  const parts: P[] = [];
  const cols: THREE.Color[] = [];
  const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = Array.from({ length: RINGS }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#f2fafc", transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    m.visible = false;
    group.add(m);
    return { m, age: 0, life: 1, r: 1 };
  });
  let ringNext = 0;
  // soft puffs of dust: low spheres that swell and fade
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const puffs = Array.from({ length: PUFFS }, () => {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, depthWrite: false, fog: true }));
    m.visible = false;
    group.add(m);
    return { m, age: 0, life: 1, r: 1, op: 0.6 };
  });
  let puffNext = 0;
  /** the ground's height under the burst being made */
  let gy = 0;
  const puff = (x: number, z: number, color: string, r: number, life: number, op: number) => {
    const p = puffs[puffNext++ % PUFFS];
    p.m.position.set(x, gy, z);
    (p.m.material as THREE.MeshBasicMaterial).color.set(color);
    p.age = 0;
    p.life = life;
    p.r = r;
    p.op = op;
    p.m.visible = true;
  };
  const tmpC = new THREE.Color();
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3(), E = new THREE.Euler();

  const add = (p: P, color: string) => {
    if (parts.length >= MAX) {
      parts.shift();
      cols.shift();
    }
    parts.push(p);
    cols.push(tmpC.set(color).clone());
  };
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const burst = (x: number, z: number, surface: Surface, n: number, up: number, out: number, size: number, opts: { dir?: number; life?: number; drag?: number; grav?: number } = {}) => {
    const pal = COLORS[surface] ?? COLORS.fairway!;
    for (let i = 0; i < n; i++) {
      const a = opts.dir !== undefined ? opts.dir + rnd(-0.7, 0.7) : rnd(0, Math.PI * 2);
      const o = rnd(0.3, 1) * out;
      add(
        { x, y: gy + 0.03, z, fy: gy + 0.01, vx: Math.sin(a) * o, vy: rnd(0.45, 1) * up, vz: Math.cos(a) * o, life: rnd(0.6, 1) * (opts.life ?? 1.1), age: 0, size: rnd(0.6, 1.2) * size, drag: opts.drag ?? 1.2, grav: opts.grav ?? 1, spin: rnd(4, 12) },
        pal[i % pal.length],
      );
    }
  };
  const ring = (x: number, z: number, r: number, life: number, delay = 0) => {
    const g = rings[ringNext++ % RINGS];
    g.m.position.set(x, gy + 0.04, z);
    g.age = -delay;
    g.life = life;
    g.r = r;
    g.m.visible = true;
  };
  const k = reduce ? 0.4 : 1;

  return {
    group,
    land(x, z, surface, v, y = 0) {
      gy = y;
      const s = Math.min(1, Math.abs(v) / 14);
      if (s < 0.08) return;
      if (surface === "water") {
        burst(x, z, "water", Math.round(30 * k), 4 + 5 * s, 1.4, 0.09, { life: 1.1, drag: 0.6 });
        puff(x, z, "#f4fbfd", 1.1, 0.9, 0.7);
        ring(x, z, 2.6, 1.3);
        ring(x, z, 1.8, 1.1, 0.18);
      } else if (surface === "bunker") {
        burst(x, z, "bunker", Math.round(26 * s * k + 4), 3.2 * s + 0.6, 2.2 * s + 0.4, 0.07, { life: 1.2, drag: 1.6 });
        puff(x, z, "#efdcae", 1.4, 1.4, 0.75);
      } else {
        const n = surface === "green" || surface === "fringe" ? 6 : 12;
        burst(x, z, surface, Math.round(n * s * k + 2), 2.2 * s + 0.4, 1.6 * s + 0.3, 0.08, { life: 0.9, drag: 1.8 });
        puff(x, z, surface === "green" || surface === "fringe" ? "#f2f8e2" : "#e8efcf", 0.6 + 0.5 * s, 0.8, 0.55);
      }
    },
    strike(x, z, surface, yaw, y = 0) {
      gy = y;
      if (surface === "bunker") {
        burst(x, z, "bunker", Math.round(34 * k), 3.6, 2.6, 0.06, { dir: yaw, life: 1.3, drag: 1.4 });
        puff(x + Math.sin(yaw) * 0.6, z + Math.cos(yaw) * 0.6, "#efdcae", 1.2, 1.3, 0.7);
      }
      else if (surface === "fairway" || surface === "rough") burst(x, z, surface, Math.round(9 * k), 2.4, 3, 0.055, { dir: yaw, life: 0.9, drag: 1.6 });
    },
    step(dt, cam, F) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) {
          parts.splice(i, 1);
          cols.splice(i, 1);
          continue;
        }
        const d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vz *= d;
        p.vy -= G * p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < p.fy) {
          p.y = p.fy;
          p.vy *= -0.2;
          p.vx *= 0.5;
          p.vz *= 0.5;
        }
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const fade = 1 - Math.max(0, (p.age - p.life * 0.6) / (p.life * 0.4));
        const dist = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
        const sz = Math.max(p.size, (MIN_PX * dist) / F) * fade;
        E.set(p.age * p.spin, p.age * p.spin * 0.7, 0);
        Q.setFromEuler(E);
        M.compose(T.set(p.x, p.y, p.z), Q, S.set(sz, sz * 0.7, sz));
        mesh.setMatrixAt(i, M);
        mesh.setColorAt(i, cols[i]);
      }
      mesh.count = parts.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      for (const p of puffs) {
        if (!p.m.visible) continue;
        p.age += dt;
        const u = p.age / p.life;
        if (u >= 1) {
          p.m.visible = false;
          continue;
        }
        const dist = Math.hypot(p.m.position.x - cam.x, p.m.position.z - cam.z) || 1;
        const r = Math.max(p.r, (PUFF_PX * 0.5 * dist) / F) * (0.35 + 0.65 * Math.sqrt(u));
        p.m.scale.set(r, r * 0.55, r);
        p.m.position.y = r * 0.25 + u * 0.3;
        (p.m.material as THREE.MeshBasicMaterial).opacity = p.op * (1 - u) * (1 - u);
      }
      for (const g of rings) {
        if (!g.m.visible) continue;
        g.age += dt;
        const u = Math.max(0, g.age) / g.life;
        if (u >= 1) {
          g.m.visible = false;
          continue;
        }
        g.m.scale.setScalar(0.3 + g.r * Math.sqrt(u));
        (g.m.material as THREE.MeshBasicMaterial).opacity = g.age < 0 ? 0 : 0.85 * (1 - u);
      }
    },
    count: () => parts.length,
    clear() {
      parts.length = 0;
      cols.length = 0;
      mesh.count = 0;
      rings.forEach((g) => (g.m.visible = false));
      puffs.forEach((p) => (p.m.visible = false));
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      ringGeo.dispose();
      puffGeo.dispose();
      puffs.forEach((p) => (p.m.material as THREE.Material).dispose());
      rings.forEach((g) => (g.m.material as THREE.Material).dispose());
      mesh.dispose();
    },
  };
}
