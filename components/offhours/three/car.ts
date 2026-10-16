import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { carbonTex, drawnTex, mats, paint } from "./materials";
import type { Model, Part } from "./viewer";

// Two cars from one generator, in metres: X forward, Y up, Z to the side,
// ground at y = 0. The body is lofted: ~120 cross-sections from tail to
// nose, each a pair of superellipses (lower body, upper body narrowing into
// the glasshouse) driven by keyframed proportions — belt line, roof/deck
// height, half-width, glasshouse width, fender bulge — with the floor lifted
// into wheel arches. Faces in the glasshouse become glass; the roof can be
// carbon. Under it: wheels, carbon-ceramic brakes, suspension, the engine
// (flat-six behind the rear axle, or a V10 behind the seats), gearbox,
// exhaust, radiators, cage and seats, floor, wings. Each part explodes
// along its own vector.

export type CarId = "gt3rs" | "huracan";
export const PAINTS: Record<CarId, { name: string; hex: string }[]> = {
  gt3rs: [
    { name: "Python Green", hex: "#6aa82a" },
    { name: "Shark Blue", hex: "#1192cf" },
    { name: "Guards Red", hex: "#c0141f" },
    { name: "GT Silver", hex: "#a9adb2" },
    { name: "Racing Green", hex: "#1d5e3f" },
  ],
  huracan: [
    { name: "Verde Mantis", hex: "#5fbf1f" },
    { name: "Arancio Anthaeus", hex: "#f2620c" },
    { name: "Giallo Inti", hex: "#f2bc0a" },
    { name: "Nero Noctis", hex: "#121214" },
    { name: "Racing Green", hex: "#1d5e3f" },
  ],
};

type Key = [x: number, bottom: number, belt: number, top: number, half: number, halfTop: number, fender: number];
type Spec = {
  name: string;
  nose: number;
  tail: number;
  axles: [front: number, rear: number];
  wheelR: [number, number];
  track: [number, number];
  tyreW: [number, number];
  keys: Key[];
  glass: [from: number, to: number];
  roof: [from: number, to: number];
  nL: number;
  nU: number;
  engine: "flat6" | "v10";
  engineX: number;
  gearboxX: number;
  wing: "swan" | "ala";
  spokes: number;
  caliper: string;
};

const SPECS: Record<CarId, Spec> = {
  // 992 GT3 RS: 4.57 m long, 1.90 m wide, 1.32 m tall, 2.46 m wheelbase
  gt3rs: {
    name: "911 GT3 RS",
    nose: 2.285,
    tail: -2.285,
    axles: [1.25, -1.21],
    wheelR: [0.335, 0.355],
    track: [1.62, 1.56],
    tyreW: [0.275, 0.335],
    keys: [
      [-2.285, 0.3, 0.74, 0.84, 0.72, 0.66, 0],
      [-2.2, 0.2, 0.8, 0.92, 0.88, 0.8, 0.02],
      [-2.0, 0.16, 0.85, 0.95, 0.95, 0.86, 0.04],
      [-1.75, 0.15, 0.87, 0.98, 0.98, 0.84, 0.06],
      [-1.45, 0.14, 0.88, 1.03, 0.995, 0.72, 0.07],
      [-1.15, 0.14, 0.885, 1.12, 0.995, 0.64, 0.07],
      [-0.85, 0.13, 0.86, 1.22, 0.96, 0.6, 0.03],
      [-0.55, 0.13, 0.83, 1.29, 0.91, 0.58, 0],
      [-0.25, 0.13, 0.81, 1.315, 0.885, 0.58, 0],
      [0.05, 0.13, 0.79, 1.27, 0.88, 0.6, 0],
      [0.3, 0.13, 0.775, 1.16, 0.885, 0.64, 0],
      [0.55, 0.13, 0.76, 1.0, 0.895, 0.7, 0.02],
      [0.75, 0.13, 0.74, 0.86, 0.91, 0.8, 0.05],
      [1.0, 0.13, 0.715, 0.75, 0.94, 0.86, 0.09],
      [1.25, 0.13, 0.69, 0.71, 0.95, 0.86, 0.1],
      [1.6, 0.13, 0.65, 0.67, 0.94, 0.85, 0.1],
      [1.9, 0.13, 0.58, 0.6, 0.9, 0.82, 0.08],
      [2.12, 0.15, 0.48, 0.5, 0.82, 0.76, 0.04],
      [2.285, 0.21, 0.36, 0.38, 0.6, 0.55, 0],
    ],
    glass: [-1.6, 0.72],
    roof: [-0.95, 0.2],
    nL: 3.2,
    nU: 3.4,
    engine: "flat6",
    engineX: -1.66,
    gearboxX: -0.86,
    wing: "swan",
    spokes: 10,
    caliper: "#f2c21a",
  },
  // Huracán Performante: 4.51 m long, 1.92 m wide, 1.17 m tall, 2.62 m wheelbase
  huracan: {
    name: "Huracán Performante",
    nose: 2.25,
    tail: -2.25,
    axles: [1.28, -1.34],
    wheelR: [0.33, 0.345],
    track: [1.67, 1.62],
    tyreW: [0.245, 0.305],
    keys: [
      [-2.25, 0.32, 0.8, 0.86, 0.8, 0.74, 0],
      [-2.12, 0.22, 0.86, 0.94, 0.94, 0.86, 0],
      [-1.8, 0.16, 0.88, 0.98, 0.985, 0.88, 0.02],
      [-1.4, 0.14, 0.87, 1.0, 0.99, 0.84, 0.03],
      [-1.0, 0.12, 0.84, 1.06, 0.975, 0.72, 0.02],
      [-0.6, 0.12, 0.79, 1.13, 0.955, 0.6, 0],
      [-0.25, 0.12, 0.75, 1.165, 0.95, 0.56, 0],
      [0.1, 0.12, 0.72, 1.14, 0.95, 0.58, 0],
      [0.4, 0.12, 0.69, 1.02, 0.95, 0.66, 0],
      [0.7, 0.12, 0.66, 0.82, 0.95, 0.82, 0.01],
      [1.0, 0.12, 0.64, 0.7, 0.95, 0.88, 0.03],
      [1.3, 0.12, 0.62, 0.66, 0.95, 0.88, 0.05],
      [1.7, 0.12, 0.54, 0.56, 0.93, 0.87, 0.03],
      [2.05, 0.13, 0.42, 0.44, 0.85, 0.8, 0],
      [2.25, 0.18, 0.28, 0.3, 0.66, 0.62, 0],
    ],
    glass: [-1.1, 0.75],
    roof: [-0.6, 0.2],
    nL: 6,
    nU: 6,
    engine: "v10",
    engineX: -0.72,
    gearboxX: -1.5,
    wing: "ala",
    spokes: 5,
    caliper: "#e2541a",
  },
};

const PART_INFO: Record<string, { label: string; note: Record<CarId, string> }> = {
  wing: { label: "Rear wing", note: { gt3rs: "Swan-neck wing with a DRS flap. Taller than the roof: 860 kg of downforce at 285 km/h.", huracan: "ALA active aero: flaps in the wing open and close to stall or load it, and can torque-vector air side to side." } },
  lid: { label: "Front lid", note: { gt3rs: "Carbon, with the vents that let the central radiator breathe out through the top.", huracan: "Forged composite, with vents for the front aero." } },
  body: { label: "Body", note: { gt3rs: "Steel and aluminium shell with carbon doors, roof and fenders. Louvres over the front wheels bleed off pressure.", huracan: "Aluminium and carbon hybrid chassis under an angular body: hexagons everywhere." } },
  interior: { label: "Cage + seats", note: { gt3rs: "Clubsport roll cage and carbon full bucket seats.", huracan: "Carbon bucket seats, roll protection, the hexagon-themed cockpit." } },
  engine: { label: "Engine", note: { gt3rs: "4.0 litre flat-six behind the rear axle. 525 PS, revs to 9,000.", huracan: "5.2 litre V10 behind the seats, 90° vee. 640 CV, revs to 8,500." } },
  gearbox: { label: "Gearbox", note: { gt3rs: "7-speed PDK dual-clutch, ahead of the rear axle.", huracan: "7-speed LDF dual-clutch, behind the engine, driving all four wheels." } },
  exhaust: { label: "Exhaust", note: { gt3rs: "Titanium, two centre tailpipes.", huracan: "Two high-mounted pipes poking through the rear grille." } },
  radiators: { label: "Radiators", note: { gt3rs: "One big central radiator up front, angled, where the boot used to be. Frees the bumper for aero.", huracan: "Side radiators, fed by the intakes ahead of the rear wheels." } },
  wheels: { label: "Wheels + tyres", note: { gt3rs: "Forged centre-lock wheels, Michelin Cup 2 R tyres.", huracan: "Forged 20-inch wheels, Pirelli P Zero Trofeo R tyres." } },
  brakes: { label: "Brakes", note: { gt3rs: "Carbon-ceramic discs (PCCB), yellow calipers.", huracan: "Carbon-ceramic discs (CCB)." } },
  suspension: { label: "Suspension", note: { gt3rs: "Double wishbones up front, multi-link rear, adjustable from the wheel.", huracan: "Double wishbones all round, magnetorheological dampers." } },
  chassis: { label: "Floor + aero", note: { gt3rs: "Flat floor, front splitter and rear diffuser.", huracan: "Flat floor, splitter and diffuser feeding the ALA ducts." } },
};
const ORDER = ["wing", "lid", "body", "interior", "radiators", "engine", "gearbox", "exhaust", "wheels", "brakes", "suspension", "chassis"];
export const CAR_PARTS = ORDER.map((id) => ({ id, label: PART_INFO[id].label }));

// Keyframe interpolation: monotone cubic Hermite (Fritsch–Carlson) per
// column — smooth (C1) like a drawn curve, with no overshoot or ripples.
const tangentCache = new WeakMap<Key[], number[][]>();
function tangents(keys: Key[]) {
  let t = tangentCache.get(keys);
  if (t) return t;
  const n = keys.length;
  t = [];
  for (let c = 1; c < 7; c++) {
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((keys[i + 1][c] - keys[i][c]) / (keys[i + 1][0] - keys[i][0]));
    const m: number[] = [d[0]];
    for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
    m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) {
        const s = 3 / Math.sqrt(h);
        m[i] = s * a * d[i];
        m[i + 1] = s * b * d[i];
      }
    }
    t.push(m);
  }
  tangentCache.set(keys, t);
  return t;
}
function sample(keys: Key[], x: number): Key {
  if (x <= keys[0][0]) return keys[0];
  if (x >= keys[keys.length - 1][0]) return keys[keys.length - 1];
  let i = 0;
  while (keys[i + 1][0] < x) i++;
  const T = tangents(keys);
  const a = keys[i], b = keys[i + 1];
  const h = b[0] - a[0], f = (x - a[0]) / h;
  const h00 = 2 * f ** 3 - 3 * f ** 2 + 1, h10 = f ** 3 - 2 * f ** 2 + f, h01 = -2 * f ** 3 + 3 * f ** 2, h11 = f ** 3 - f ** 2;
  const out = [x] as unknown as Key;
  for (let c = 1; c < 7; c++) out[c] = h00 * a[c] + h10 * h * T[c - 1][i] + h01 * b[c] + h11 * h * T[c - 1][i + 1];
  return out;
}

// One point on a cross-section. s runs 0 → 1 around the upper body (belt
// → roof centre); below the belt the lower body is a superellipse down to
// the floor. The upper body has three zones, like a real car: a shoulder
// that steps in from the belt, the side glass rising almost vertically to the
// roof rail, then the roof arc. zone: 0 shoulder, 1 side glass, 2 roof.
const S1 = 0.18, S2 = 0.68;
function upper(S: Spec, k: Key, s: number) {
  const [, , belt, top, half, halfTop, fender] = k;
  const h = Math.max(0.005, top - belt);
  const rise = Math.min(0.035, h * 0.3);
  const rail = belt + rise + (h - rise) * 0.72;
  const inner = Math.min(half, halfTop + 0.06);
  let y: number, z: number, zone: number;
  if (s < S1) {
    const f = s / S1, e = f * f * (3 - 2 * f);
    z = half + (inner - half) * e;
    y = belt + rise * f;
    zone = 0;
  } else if (s < S2) {
    const f = (s - S1) / (S2 - S1);
    z = inner - (inner - halfTop) * f;
    y = belt + rise + (rail - belt - rise) * f;
    zone = 1;
  } else {
    const f = (s - S2) / (1 - S2), ph = (f * Math.PI) / 2;
    z = halfTop * Math.pow(Math.cos(ph), 2 / S.nU);
    y = rail + (top - rail) * Math.pow(Math.sin(ph), 2 / S.nU);
    zone = 2;
  }
  y += fender * Math.exp(-(((z - half * 0.8) / (half * 0.16)) ** 2)) * Math.max(0, 1 - s / S2);
  return { y, z, zone };
}

function bodyGeometry(S: Spec) {
  const NX = 150, NL = 16, NUp = 30; // stations, points below / above the belt per side
  const per = NL + NUp; // points per side, bottom centre → top centre
  const ring = per * 2;
  const pos: number[] = [];
  const meta: { x: number; y: number; z: number; zone: number }[] = [];
  for (let i = 0; i < NX; i++) {
    const x = S.tail + ((S.nose - S.tail) * i) / (NX - 1);
    const k = sample(S.keys, x);
    const [, base, belt, , half] = k;
    let bottom = base;
    S.axles.forEach((ax, a) => {
      const Ra = S.wheelR[a] + 0.045;
      const dx = x - ax;
      if (Math.abs(dx) < Ra) bottom = Math.max(bottom, S.wheelR[a] + Math.sqrt(Ra * Ra - dx * dx) - 0.02);
    });
    bottom = Math.min(bottom, belt - 0.015);
    const side: { y: number; z: number; zone: number }[] = [];
    for (let j = 0; j < NL; j++) {
      const th = -Math.PI / 2 + (Math.PI / 2) * (j / NL);
      const c = Math.cos(th), sn = Math.sin(th);
      side.push({ z: half * Math.pow(Math.max(0, c), 2 / S.nL), y: belt - (belt - bottom) * Math.pow(-sn, 2 / S.nL), zone: -1 });
    }
    for (let j = 0; j < NUp; j++) side.push(upper(S, k, j / (NUp - 1)));
    for (let j = 0; j < ring; j++) {
      const right = j < per;
      const p = right ? side[j] : side[ring - 1 - j];
      const z = right ? p.z : -p.z;
      pos.push(x, p.y, z);
      meta.push({ x, y: p.y, z, zone: p.zone });
    }
  }
  const paintIdx: number[] = [], glassIdx: number[] = [], roofIdx: number[] = [];
  for (let i = 0; i < NX - 1; i++)
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j, b = i * ring + ((j + 1) % ring), c2 = (i + 1) * ring + j, d = (i + 1) * ring + ((j + 1) % ring);
      const m = [a, b, c2, d].map((q) => meta[q]);
      const cx = (m[0].x + m[3].x) / 2;
      const zone = Math.min(m[0].zone, m[1].zone, m[2].zone, m[3].zone);
      const inCabin = cx > S.glass[0] && cx < S.glass[1];
      const inRoof = cx > S.roof[0] && cx < S.roof[1];
      const list = zone === 2 && inRoof ? roofIdx : zone >= 1 && inCabin ? glassIdx : paintIdx;
      list.push(a, c2, b, b, c2, d);
    }
  const capStart = pos.length / 3;
  [0, NX - 1].forEach((i, e) => {
    let cy = 0;
    for (let j = 0; j < ring; j++) cy += pos[(i * ring + j) * 3 + 1];
    pos.push(pos[i * ring * 3], cy / ring, 0);
    const ci = capStart + e;
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j, b = i * ring + ((j + 1) % ring);
      if (e === 0) paintIdx.push(ci, b, a);
      else paintIdx.push(ci, a, b);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([...paintIdx, ...glassIdx, ...roofIdx]);
  g.addGroup(0, paintIdx.length, 0);
  g.addGroup(paintIdx.length, glassIdx.length, 1);
  g.addGroup(paintIdx.length + glassIdx.length, roofIdx.length, 2);
  g.computeVertexNormals();
  return { g };
}

// the height of the body's top surface at (x, z)
function surfaceY(S: Spec, x: number, z: number) {
  const k = sample(S.keys, x);
  const zz = Math.abs(z);
  for (let i = 100; i >= 0; i--) {
    const p = upper(S, k, i / 100);
    if (p.z >= zz) return p.y;
  }
  return k[2];
}

class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private h: number, private turns: number) {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.r, t * this.h - this.h / 2, Math.sin(a) * this.r);
  }
}

export function buildCar(id: CarId, paintHex: string, cam?: [number, number, number]): Model & { setPaint: (hex: string) => void } {
  const S = SPECS[id];
  const M = mats();
  const bodyPaint = paint(paintHex);
  const carbon = new THREE.MeshPhysicalMaterial({ map: carbonTex(1), metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 });
  carbon.map!.repeat.set(14, 14);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0 }); // tinted, reflective, as glass reads from outside
  const chrome = M.steel;
  const darkTrim = new THREE.MeshPhysicalMaterial({ color: 0x111214, roughness: 0.55 });
  const caliper = new THREE.MeshPhysicalMaterial({ color: S.caliper, roughness: 0.35, clearcoat: 1 });

  const root = new THREE.Group();
  const groups: Record<string, THREE.Group> = {};
  const movers: Record<string, { obj: THREE.Object3D; dir: THREE.Vector3 }[]> = {};
  const G = (pid: string, dir: THREE.Vector3, parent: THREE.Object3D = root) => {
    const g = new THREE.Group();
    parent.add(g);
    (movers[pid] ??= []).push({ obj: g, dir });
    groups[pid] ??= g;
    return g;
  };
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m as THREE.Material);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, parent: THREE.Object3D) => {
    const len = a.distanceTo(b);
    const o = mesh(new THREE.CylinderGeometry(r, r, len, 10), m, parent);
    o.position.copy(a).add(b).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return o;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ---------- body (with glass and a carbon roof)
  const body = G("body", V(0, 1.35, 0));
  const { g: bodyGeo } = bodyGeometry(S);
  mesh(bodyGeo, [bodyPaint, glass, carbon], body);
  // lights, mirrors, details
  const lightGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.6, thickness: 0.05, emissive: 0xfff4e0, emissiveIntensity: 0.25 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x5a0508, emissive: 0xff1a1a, emissiveIntensity: 0.9 });
  if (id === "gt3rs") {
    for (const sz of [-1, 1]) {
      const hl = mesh(new THREE.SphereGeometry(0.11, 24, 16), lightGlass, body, 1.98, surfaceY(S, 1.98, 0.66) - 0.03, sz * 0.66);
      hl.scale.set(1.25, 0.55, 0.85);
      hl.rotation.z = -0.45;
    }
    mesh(new THREE.BoxGeometry(0.03, 0.05, 1.5), tail, body, -2.27, 0.83, 0);
  } else {
    for (const sz of [-1, 1]) {
      const hl = mesh(new THREE.BoxGeometry(0.28, 0.025, 0.2), lightGlass, body, 1.92, surfaceY(S, 1.92, 0.68) - 0.02, sz * 0.66);
      hl.rotation.set(0, sz * 0.25, -0.35);
      mesh(new THREE.BoxGeometry(0.03, 0.05, 0.42), tail, body, -2.24, 0.82, sz * 0.55).rotation.y = sz * 0.3;
      // side intake: a dark trapezoid let into the flank ahead of the rear wheel
      const tz = new THREE.Shape();
      tz.moveTo(-0.34, 0.12);
      tz.lineTo(0.3, 0.12);
      tz.lineTo(0.16, -0.12);
      tz.lineTo(-0.2, -0.12);
      tz.closePath();
      const ig = new THREE.ShapeGeometry(tz);
      const ix0 = -0.66;
      const flank = sample(S.keys, ix0)[4];
      const intake = mesh(ig, new THREE.MeshPhysicalMaterial({ color: 0x0a0b0c, roughness: 0.7, side: THREE.DoubleSide }), body, ix0, 0.6, sz * (flank + 0.004));
      intake.rotation.y = sz > 0 ? 0 : Math.PI;
      intake.rotation.y += sz * -0.08;
    }
  }
  for (const sz of [-1, 1]) {
    const mx = S.glass[1] - 0.12;
    tube(V(mx, sample(S.keys, mx)[2] + 0.01, sz * 0.82), V(mx - 0.04, sample(S.keys, mx)[2] + 0.09, sz * 0.98), 0.012, darkTrim, body);
    const mirror = mesh(new THREE.SphereGeometry(0.08, 20, 14), bodyPaint, body, mx - 0.08, sample(S.keys, mx)[2] + 0.1, sz * 1.01);
    mirror.scale.set(1.2, 0.7, 0.75);
  }

  // ---------- front lid (carbon), sits on the body top
  const lid = G("lid", V(0.35, 1.75, 0));
  {
    const x0 = id === "gt3rs" ? 0.95 : 0.85, x1 = S.nose - 0.22;
    const nx = 26, nz = 16, zw = 0.5;
    const pts: number[] = [];
    const ix: number[] = [];
    for (let i = 0; i <= nx; i++)
      for (let j = 0; j <= nz; j++) {
        const x = x0 + ((x1 - x0) * i) / nx, z = -zw + (2 * zw * j) / nz;
        pts.push(x, surfaceY(S, x, z) + 0.008, z);
      }
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const a = i * (nz + 1) + j, b = a + 1, c = a + nz + 1, d = c + 1;
        ix.push(a, b, c, b, d, c);
      }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    lg.setIndex(ix);
    lg.computeVertexNormals();
    const uv: number[] = [];
    for (let i = 0; i < pts.length; i += 3) uv.push(pts[i] * 0.6, pts[i + 2] * 0.6);
    lg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    mesh(lg, bodyPaint, lid); // painted to match; the vents are carbon
    // vents
    const vx = id === "gt3rs" ? 1.55 : 1.45;
    for (const sz of [-1, 1]) {
      const v = mesh(new RoundedBoxGeometry(0.36, 0.03, 0.18, 2, 0.01), darkTrim, lid, vx, surfaceY(S, vx, sz * 0.2) + 0.012, sz * 0.2);
      v.rotation.z = -0.12;
      for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(0.34, 0.012, 0.012), carbon, lid, vx, surfaceY(S, vx, sz * 0.2) + 0.03, sz * 0.2 - 0.06 + k * 0.04);
    }
  }

  // ---------- wing
  const wing = G("wing", V(-0.45, 1.9, 0));
  {
    const chord = S.wing === "swan" ? 0.44 : 0.34, span = S.wing === "swan" ? 1.62 : 1.66;
    const wx = S.wing === "swan" ? -2.02 : -2.02, wy = S.wing === "swan" ? 1.4 : 1.13;
    const foil = new THREE.Shape();
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = (1 - Math.cos(t * Math.PI)) / 2;
      const yt = 0.12 * 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4) * chord;
      if (i === 0) foil.moveTo(chord / 2 - x * chord, yt + 0.05 * chord * Math.sin(Math.PI * x));
      else foil.lineTo(chord / 2 - x * chord, yt + 0.05 * chord * Math.sin(Math.PI * x));
    }
    for (let i = n; i >= 0; i--) {
      const t = i / n, x = (1 - Math.cos(t * Math.PI)) / 2;
      const yt = 0.12 * 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4) * chord;
      foil.lineTo(chord / 2 - x * chord, -yt * 0.6 + 0.05 * chord * Math.sin(Math.PI * x));
    }
    const fg = new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -span / 2);
    // invert: a wing makes downforce
    fg.rotateX(Math.PI);
    const main = mesh(fg, carbon, wing, wx, wy, 0);
    main.rotation.z = -0.12;
    const flapGeo = new THREE.ExtrudeGeometry(foil, { depth: span - 0.04, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -(span - 0.04) / 2).rotateX(Math.PI).scale(0.55, 0.55, 1);
    const flap = mesh(flapGeo, carbon, wing, wx - chord * 0.42, wy + 0.08, 0);
    flap.rotation.z = -0.5;
    for (const sz of [-1, 1]) {
      const ep = mesh(new RoundedBoxGeometry(chord * 1.35, 0.2, 0.012, 2, 0.004), carbon, wing, wx - 0.05, wy + 0.02, sz * (span / 2 + 0.006));
      ep.rotation.z = -0.12;
    }
    // mounts
    const deckY = sample(S.keys, wx + 0.15)[3];
    for (const sz of [-1, 1]) {
      if (S.wing === "swan") {
        const path = new THREE.CatmullRomCurve3([V(wx + 0.25, deckY - 0.02, sz * 0.36), V(wx + 0.2, deckY + 0.3, sz * 0.36), V(wx + 0.05, wy + 0.12, sz * 0.36), V(wx - 0.08, wy + 0.05, sz * 0.36)]);
        mesh(new THREE.TubeGeometry(path, 30, 0.022, 8), M.darkSteel, wing);
      } else {
        const pylon = mesh(new RoundedBoxGeometry(0.2, wy - deckY + 0.02, 0.025, 2, 0.008), carbon, wing, wx + 0.06, (wy + deckY) / 2 - 0.02, sz * 0.42);
        pylon.rotation.z = 0.25;
      }
    }
  }

  // ---------- interior: cage, seats, wheel, dash
  const interior = G("interior", V(0, 0.7, 0));
  {
    const cx = (S.glass[0] + S.glass[1]) / 2;
    const seatX = id === "gt3rs" ? -0.25 : -0.15;
    for (const sz of [-1, 1]) {
      const seat = new THREE.Group();
      seat.position.set(seatX, 0.22, sz * 0.38);
      interior.add(seat);
      mesh(new RoundedBoxGeometry(0.5, 0.08, 0.46, 3, 0.03), carbon, seat, 0.05, 0, 0);
      const back = mesh(new RoundedBoxGeometry(0.08, 0.7, 0.46, 3, 0.03), carbon, seat, -0.22, 0.32, 0);
      back.rotation.z = 0.22;
      for (const w of [-1, 1]) mesh(new RoundedBoxGeometry(0.4, 0.16, 0.05, 2, 0.02), darkTrim, seat, 0.0, 0.1, w * 0.22);
      mesh(new RoundedBoxGeometry(0.06, 0.5, 0.34, 2, 0.02), new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0x444444) }), seat, -0.18, 0.32, 0).rotation.z = 0.22;
    }
    // steering wheel (left-hand drive) + dash
    const swX = seatX + 0.5;
    const sw = mesh(new THREE.TorusGeometry(0.17, 0.018, 10, 40), darkTrim, interior, swX, 0.62, 0.38);
    sw.rotation.y = Math.PI / 2;
    sw.rotation.x = 0.35;
    mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), new THREE.MeshStandardMaterial({ color: 0xf2c21a }), interior, swX, 0.79, 0.38);
    mesh(new RoundedBoxGeometry(0.3, 0.16, 1.5, 3, 0.04), darkTrim, interior, S.glass[1] - 0.18, 0.55, 0);
    // roll cage
    const cage = id === "gt3rs" ? M.darkSteel : darkTrim;
    const hx = seatX - 0.32, top = sample(S.keys, hx)[3] - 0.08;
    for (const sz of [-1, 1]) {
      tube(V(hx, 0.15, sz * 0.62), V(hx, top, sz * 0.48), 0.02, cage, interior);
      tube(V(hx, top, sz * 0.48), V(cx + 0.45, sample(S.keys, cx + 0.45)[3] - 0.12, sz * 0.52), 0.018, cage, interior);
      tube(V(hx, top - 0.1, sz * 0.5), V(hx - 0.6, 0.55, sz * 0.5), 0.018, cage, interior);
    }
    tube(V(hx, top, -0.48), V(hx, top, 0.48), 0.02, cage, interior);
    tube(V(hx, top, -0.48), V(hx, 0.25, 0.55), 0.018, cage, interior);
  }

  // ---------- radiators
  const rad = G("radiators", id === "gt3rs" ? V(0.9, 0.55, 0) : V(0, 0.35, 0));
  const radiator = (w: number, h: number) => {
    const g = new THREE.Group();
    const core = drawnTex(256, (c, s) => {
      c.fillStyle = "#22252a";
      c.fillRect(0, 0, s, s);
      c.strokeStyle = "#5d636b";
      c.lineWidth = 1;
      for (let i = 0; i < s; i += 4) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i, s);
        c.stroke();
      }
    });
    core.wrapS = core.wrapT = THREE.RepeatWrapping;
    core.repeat.set(4, 2);
    mesh(new THREE.BoxGeometry(0.06, h, w), [M.alu, M.alu, M.alu, M.alu, new THREE.MeshStandardMaterial({ map: core, metalness: 0.6, roughness: 0.5 }), M.alu] as unknown as THREE.Material, g);
    for (const sz of [-1, 1]) mesh(new THREE.BoxGeometry(0.09, h + 0.02, 0.05), M.alu, g, 0, 0, sz * (w / 2 + 0.02));
    return g;
  };
  if (id === "gt3rs") {
    const r = radiator(0.9, 0.4);
    r.position.set(1.78, 0.38, 0);
    r.rotation.z = 0.95;
    rad.add(r);
  } else {
    for (const sz of [-1, 1]) {
      const r = radiator(0.45, 0.36);
      r.position.set(-0.5, 0.5, sz * 0.78);
      r.rotation.y = sz * 1.2;
      const sub = G("radiators", V(0, 0.35, sz * 0.5), root);
      sub.add(r);
    }
  }

  // ---------- engine
  const engine = G("engine", id === "gt3rs" ? V(-0.9, 0.55, 0) : V(-0.15, 1.05, 0));
  const red = new THREE.MeshPhysicalMaterial({ color: 0xb3121b, roughness: 0.35, clearcoat: 0.8 });
  if (S.engine === "flat6") {
    const ex = S.engineX, ey = 0.42;
    mesh(new RoundedBoxGeometry(0.5, 0.3, 0.36, 3, 0.04), M.alu, engine, ex, ey, 0);
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const cyl = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 20), M.alu, engine, ex - 0.14 + k * 0.14, ey, sz * 0.28);
        cyl.rotation.x = Math.PI / 2;
        for (let f = 0; f < 5; f++) {
          const fin = mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.008, 20), M.alu, engine, ex - 0.14 + k * 0.14, ey, sz * (0.2 + f * 0.035));
          fin.rotation.x = Math.PI / 2;
        }
      }
      mesh(new RoundedBoxGeometry(0.46, 0.2, 0.1, 3, 0.03), M.alu, engine, ex, ey, sz * 0.43);
      mesh(new RoundedBoxGeometry(0.44, 0.06, 0.12, 3, 0.02), new THREE.MeshPhysicalMaterial({ color: 0x1a1b1e, roughness: 0.4 }), engine, ex, ey + 0.12, sz * 0.43);
    }
    // carbon intake plenum + six throttle bodies
    mesh(new RoundedBoxGeometry(0.46, 0.12, 0.5, 3, 0.05), carbon, engine, ex, ey + 0.26, 0);
    for (const sz of [-1, 1]) for (let k = 0; k < 3; k++) tube(V(ex - 0.14 + k * 0.14, ey + 0.22, sz * 0.18), V(ex - 0.14 + k * 0.14, ey + 0.1, sz * 0.4), 0.025, M.darkSteel, engine);
    const pulley = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), M.darkSteel, engine, ex - 0.27, ey + 0.05, 0);
    pulley.rotation.z = Math.PI / 2;
  } else {
    const ex = S.engineX, ey = 0.4;
    mesh(new RoundedBoxGeometry(0.75, 0.26, 0.32, 3, 0.04), M.alu, engine, ex, ey, 0);
    for (const sz of [-1, 1]) {
      const bank = new THREE.Group();
      bank.position.set(ex, ey + 0.08, sz * 0.12);
      bank.rotation.x = sz * -Math.PI / 4;
      engine.add(bank);
      for (let k = 0; k < 5; k++) mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 20), M.alu, bank, -0.3 + k * 0.15, 0.13, 0);
      mesh(new RoundedBoxGeometry(0.8, 0.07, 0.15, 3, 0.03), red, bank, 0, 0.27, 0); // red cam covers
    }
    mesh(new RoundedBoxGeometry(0.7, 0.1, 0.22, 3, 0.04), carbon, engine, ex, ey + 0.32, 0);
    for (let k = 0; k < 5; k++)
      for (const sz of [-1, 1]) tube(V(ex - 0.3 + k * 0.15, ey + 0.32, sz * 0.08), V(ex - 0.3 + k * 0.15, ey + 0.28, sz * 0.2), 0.02, M.darkSteel, engine);
  }

  // ---------- gearbox
  const gearbox = G("gearbox", id === "gt3rs" ? V(-0.25, 0.95, 0) : V(-0.6, 0.75, 0));
  {
    const gx = S.gearboxX;
    const gb = new THREE.LatheGeometry([0.08, 0.14, 0.16, 0.15, 0.12, 0.09].map((r, i) => new THREE.Vector2(r, i * 0.11)), 32).rotateZ(id === "gt3rs" ? -Math.PI / 2 : Math.PI / 2);
    mesh(gb, M.alu, gearbox, gx + (id === "gt3rs" ? 0.27 : -0.27), 0.38, 0);
    mesh(new RoundedBoxGeometry(0.3, 0.22, 0.4, 3, 0.04), M.alu, gearbox, gx, 0.36, 0);
    for (const sz of [-1, 1]) tube(V(gx, 0.36, sz * 0.2), V(S.axles[1], S.wheelR[1], sz * (S.track[1] / 2 - 0.2)), 0.025, M.darkSteel, gearbox);
  }

  // ---------- exhaust
  const exhaust = G("exhaust", id === "gt3rs" ? V(-1.25, 0.25, 0) : V(-0.9, 0.85, 0));
  {
    const ti = M.titanium;
    if (id === "gt3rs") {
      mesh(new RoundedBoxGeometry(0.3, 0.16, 1.2, 3, 0.05), ti, exhaust, -2.02, 0.3, 0);
      for (const sz of [-1, 1]) {
        const tip = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 20, 1, true), ti, exhaust, -2.25, 0.33, sz * 0.09);
        tip.rotation.z = Math.PI / 2;
        tube(V(-1.66, 0.36, sz * 0.43), V(-1.95, 0.28, sz * 0.4), 0.03, ti, exhaust);
      }
    } else {
      mesh(new RoundedBoxGeometry(0.35, 0.18, 0.9, 3, 0.05), ti, exhaust, -1.95, 0.55, 0);
      for (const sz of [-1, 1]) {
        const tip = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 20, 1, true), ti, exhaust, -2.2, 0.66, sz * 0.12);
        tip.rotation.z = Math.PI / 2;
        tube(V(-0.72, 0.62, sz * 0.25), V(-1.82, 0.58, sz * 0.3), 0.03, ti, exhaust);
      }
    }
  }

  // ---------- wheels, brakes, suspension — four corners
  const tyreGeo = (R: number, W: number, rim: number) => {
    const pts: THREE.Vector2[] = [];
    const rr = 0.035;
    pts.push(new THREE.Vector2(rim, -W / 2 + 0.01));
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector2(R - rr + Math.cos(a + Math.PI) * -rr * -1 + 0 * i, -W / 2 + rr + Math.sin(a) * rr));
    }
    pts.length = 1;
    pts.push(new THREE.Vector2(R - 0.05, -W / 2), new THREE.Vector2(R - 0.01, -W / 2 + 0.025), new THREE.Vector2(R, -W / 2 + 0.06), new THREE.Vector2(R, W / 2 - 0.06), new THREE.Vector2(R - 0.01, W / 2 - 0.025), new THREE.Vector2(R - 0.05, W / 2), new THREE.Vector2(rim, W / 2 - 0.01));
    return new THREE.LatheGeometry(pts, 64).rotateX(Math.PI / 2);
  };
  const rimMat = id === "gt3rs" ? new THREE.MeshPhysicalMaterial({ color: 0x2b2d30, metalness: 1, roughness: 0.3 }) : new THREE.MeshPhysicalMaterial({ color: 0x1a1a1c, metalness: 0.8, roughness: 0.35, clearcoat: 1 });
  const discTex = drawnTex(512, (c, s) => {
    c.fillStyle = "#3a3b3e";
    c.fillRect(0, 0, s, s);
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s / 2);
    g.addColorStop(0, "#55575c");
    g.addColorStop(1, "#2c2d30");
    c.fillStyle = g;
    c.beginPath();
    c.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#121214";
    for (let ring = 0; ring < 3; ring++)
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + ring * 0.15;
        const r = s * (0.3 + ring * 0.06);
        c.beginPath();
        c.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, s * 0.012, 0, Math.PI * 2);
        c.fill();
      }
    c.fillStyle = "#8a8f96";
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
    c.fill();
  });
  const discFace = new THREE.MeshPhysicalMaterial({ map: discTex, metalness: 0.4, roughness: 0.6 });
  S.axles.forEach((ax, a) => {
    const R = S.wheelR[a], W = S.tyreW[a], rim = R - 0.11, tz = S.track[a] / 2;
    for (const sz of [-1, 1]) {
      const z = sz * (tz - W / 2);
      // wheel
      const wg = G("wheels", V(0, 0, sz * 0.95));
      wg.position.set(ax, R, z);
      mesh(tyreGeo(R, W, rim), M.rubber, wg);
      const barrel = new THREE.LatheGeometry([new THREE.Vector2(rim - 0.01, -W / 2 + 0.01), new THREE.Vector2(rim + 0.012, -W / 2), new THREE.Vector2(rim + 0.012, -W / 2 + 0.03), new THREE.Vector2(rim - 0.015, -W / 2 + 0.04), new THREE.Vector2(rim - 0.015, W / 2 - 0.02), new THREE.Vector2(rim, W / 2)], 64).rotateX(Math.PI / 2);
      mesh(barrel, rimMat, wg);
      const face = new THREE.Group();
      face.position.z = sz * (W / 2 - 0.05);
      wg.add(face);
      const n = S.spokes;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const sp = mesh(new RoundedBoxGeometry(rim - 0.06, n > 6 ? 0.03 : 0.06, 0.03, 2, 0.01), rimMat, face, Math.cos(ang) * (rim / 2 + 0.03), Math.sin(ang) * (rim / 2 + 0.03), 0);
        sp.rotation.z = ang;
        if (n <= 6) {
          // Y-spokes: a second arm splits off each spoke
          for (const d of [-0.22, 0.22]) {
            const a2 = ang + d;
            const sp2 = mesh(new RoundedBoxGeometry(rim * 0.45, 0.025, 0.025, 2, 0.008), rimMat, face, Math.cos(a2) * rim * 0.72, Math.sin(a2) * rim * 0.72, 0);
            sp2.rotation.z = a2;
          }
        }
      }
      mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 6).rotateX(Math.PI / 2), id === "gt3rs" ? new THREE.MeshPhysicalMaterial({ color: 0xb3121b, metalness: 0.8, roughness: 0.3 }) : chrome, face, 0, 0, sz * 0.02);
      // brakes
      const bg = G("brakes", V(0, 0, sz * 0.58));
      bg.position.set(ax, R, sz * (tz - W / 2 - 0.02));
      const dR = R * 0.82 - 0.06;
      mesh(new THREE.CylinderGeometry(dR, dR, 0.034, 64).rotateX(Math.PI / 2), [M.darkSteel, discFace, discFace] as unknown as THREE.Material, bg);
      const cal = new THREE.Group();
      cal.rotation.z = a === 0 ? 0.6 : 2.5;
      bg.add(cal);
      const cg = mesh(new RoundedBoxGeometry(0.11, 0.26, 0.09, 3, 0.03), caliper, cal, dR - 0.03, 0, 0);
      cg.rotation.z = 0;
      // suspension
      const sg = G("suspension", V(0, 0.15, sz * 0.32));
      const hubZ = sz * (tz - W / 2 - 0.08);
      const inZ = sz * 0.42;
      for (const [yh, yi] of [[R + 0.13, R + 0.18], [R - 0.12, R - 0.1]]) {
        tube(V(ax, yh, hubZ), V(ax + 0.18, yi, inZ), 0.016, M.darkSteel, sg);
        tube(V(ax, yh, hubZ), V(ax - 0.18, yi, inZ), 0.016, M.darkSteel, sg);
      }
      const top = V(ax + 0.02, R + 0.42, sz * 0.5), bot = V(ax + 0.02, R - 0.04, hubZ * 0.85);
      tube(bot, top, 0.025, M.darkSteel, sg);
      const spring = mesh(new THREE.TubeGeometry(new Helix(0.055, top.distanceTo(bot) * 0.6, 7), 160, 0.009, 6), new THREE.MeshPhysicalMaterial({ color: id === "gt3rs" ? 0xd8b04a : 0xb3121b, roughness: 0.35, clearcoat: 1 }), sg);
      spring.position.copy(top).add(bot).multiplyScalar(0.5);
      spring.quaternion.setFromUnitVectors(V(0, 1, 0), top.clone().sub(bot).normalize());
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 20).rotateX(Math.PI / 2), M.alu, sg, ax, R, hubZ);
    }
  });

  // ---------- floor + aero
  const chassis = G("chassis", V(0, -0.0001, 0));
  {
    const len = S.nose - S.tail - 0.5;
    mesh(new RoundedBoxGeometry(len - 0.9, 0.03, 1.45, 2, 0.01), carbon, chassis, (S.nose + S.tail) / 2 - 0.05, 0.11, 0);
    mesh(new RoundedBoxGeometry(0.2, 0.02, 1.15, 2, 0.008), carbon, chassis, S.nose - 0.28, 0.1, 0);
    for (let k = 0; k < 6; k++) {
      const f = mesh(new RoundedBoxGeometry(0.5, 0.18, 0.012, 2, 0.004), carbon, chassis, S.tail + 0.32, 0.18, -0.55 + k * 0.22);
      f.rotation.z = -0.25;
    }
    mesh(new RoundedBoxGeometry(0.55, 0.02, 1.5, 2, 0.008), carbon, chassis, S.tail + 0.32, 0.26, 0).rotation.z = -0.28;
  }

  // ---------- parts
  const anchorAt: Record<string, THREE.Vector3> = {
    wing: V(-2.0, id === "gt3rs" ? 1.45 : 1.2, 0.8),
    lid: V(1.6, 0.75, 0.45),
    body: V(-0.4, 1.0, 0.95),
    interior: V(-0.2, 0.9, 0.5),
    radiators: id === "gt3rs" ? V(1.8, 0.45, 0.4) : V(-0.5, 0.6, 0.8),
    engine: V(S.engineX, 0.6, 0.45),
    gearbox: V(S.gearboxX, 0.45, 0.2),
    exhaust: V(-2.2, 0.4, 0.4),
    wheels: V(S.axles[0], S.wheelR[0] * 2, S.track[0] / 2),
    brakes: V(S.axles[1], S.wheelR[1] * 1.6, S.track[1] / 2 - 0.2),
    suspension: V(S.axles[0], S.wheelR[0] + 0.4, 0.5),
    chassis: V(S.tail + 0.4, 0.15, 0.85),
  };
  const parts: Part[] = ORDER.map((pid) => {
    const anchor = new THREE.Object3D();
    anchor.position.copy(anchorAt[pid]);
    groups[pid].add(anchor);
    return { id: pid, label: PART_INFO[pid].label, note: PART_INFO[pid].note[id], movers: movers[pid], anchor };
  });

  return {
    root,
    parts,
    view: { position: cam ?? [5.2, 1.85, 6.1], target: [0, 0.62, 0], fov: 30, near: 0.1, far: 300, minDistance: 3.5, maxDistance: 30 },
    background: "#ebe3d0",
    floorY: 0,
    shadowSize: 4.5,
    explodeZoom: 1.55,
    explodeLift: [0, 0.55, 0],
    setPaint: (hex: string) => {
      bodyPaint.color.set(hex);
    },
  };
}
