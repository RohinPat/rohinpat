// The golf ball, in the air and on the ground. The whole shot is simulated up
// front at a fixed step (so it plays back identically at any frame rate and
// the camera can be scripted around where the ball is going to land).
//
// World: metres, x to the right, y up, z downrange (a left-handed frame, like
// a camera looks into). In the air the ball feels gravity, quadratic drag and
// a Magnus lift from backspin (up) and sidespin (sideways), both fading
// slowly. Each bounce is a small impulse model: the vertical speed is kept by
// a restitution, and the contact point slides until friction (or the ball
// rolling) stops the slip, which is how a wedge checks up and a driver runs.

export type Surface = "green" | "fringe" | "fairway" | "rough" | "bunker" | "out";

export type Club = {
  id: string;
  name: string;
  short: string;
  /** ball speed at a full, pure swing, m/s */
  speed: number;
  /** launch angle off the face, degrees */
  launch: number;
  /** backspin at launch, rpm */
  spin: number;
  /** shaft length, m (sets how far from the ball the golfer stands) */
  len: number;
};

export const CLUBS: Club[] = [
  { id: "driver", name: "Driver", short: "DR", speed: 64, launch: 11.5, spin: 2650, len: 1.12 },
  { id: "wood", name: "3 Wood", short: "3W", speed: 58, launch: 11, spin: 3500, len: 1.07 },
  { id: "iron5", name: "5 Iron", short: "5i", speed: 50, launch: 14, spin: 5200, len: 0.99 },
  { id: "iron7", name: "7 Iron", short: "7i", speed: 44, launch: 17, spin: 6700, len: 0.94 },
  { id: "pw", name: "Pitching wedge", short: "PW", speed: 37, launch: 24, spin: 8200, len: 0.9 },
  { id: "sw", name: "Sand wedge", short: "SW", speed: 30, launch: 32, spin: 9000, len: 0.89 },
];

const G = 9.81;
const RHO = 1.2;
const R = 0.02135;
const AREA = Math.PI * R * R;
const MASS = 0.04593;
const DT = 1 / 240;

const SURF: Record<Surface, { e: number; et: number; mu: number; roll: number; keep: number }> = {
  green: { e: 0.22, et: 0.55, mu: 0.8, roll: 0.9, keep: 0.7 },
  fringe: { e: 0.24, et: 0.3, mu: 0.7, roll: 1.6, keep: 0.6 },
  fairway: { e: 0.28, et: 0.0, mu: 0.6, roll: 2.4, keep: 0.62 },
  rough: { e: 0.12, et: 0, mu: 0.8, roll: 6, keep: 0.4 },
  bunker: { e: 0.05, et: 0, mu: 0.9, roll: 9, keep: 0.1 },
  out: { e: 0.05, et: 0, mu: 0.9, roll: 14, keep: 0.1 },
};

export type ShotIn = {
  club: Club;
  /** fraction of the club's ball speed (0..1.05) */
  speed: number;
  /** aim, radians (0 = straight down z, positive = right) */
  yaw: number;
  /** start line off the aim, -1 (left) .. 1 (right) */
  face: number;
  /** sidespin, -1 (hook) .. 1 (slice) */
  curve: number;
  /** contact: 1 pure, lower = thin / fat */
  contact: number;
  /** extra loft multiplier from the contact (fat = higher, thin = lower) */
  lift?: number;
  wind: [number, number];
  surfaceAt: (x: number, z: number) => Surface;
};

export type Shot = {
  /** t, x, y, z at 60 Hz */
  pts: Float32Array;
  n: number;
  bounces: { t: number; x: number; z: number; vy: number; surface: Surface }[];
  apex: number;
  apexT: number;
  landT: number;
  restT: number;
  carry: number; // yards, first landing
  total: number; // yards, at rest
  side: number; // yards off the aim line at rest (+ right)
  curve: number; // yards the ball bent from its start line at landing (+ right)
  speed: number; // mph
  launch: number; // degrees
  spin: number; // rpm
  surface: Surface; // where it ended
};

const YD = 0.9144;

export function simulate(inp: ShotIn): Shot {
  const { club } = inp;
  const speed = club.speed * inp.speed * (0.78 + 0.22 * inp.contact);
  const la = ((club.launch * (inp.lift ?? 1)) * Math.PI) / 180;
  const az = inp.yaw + inp.face * 0.085;
  let vx = Math.sin(az) * Math.cos(la) * speed;
  let vy = Math.sin(la) * speed;
  let vz = Math.cos(az) * Math.cos(la) * speed;
  let x = 0, y = 0.04, z = 0;
  // spin in rad/s: back and side
  const back0 = ((club.spin * (0.7 + 0.3 * inp.contact) * (0.55 + 0.45 * inp.speed)) * 2 * Math.PI) / 60;
  let wb = back0;
  let ws = inp.curve * ((2600 * 2 * Math.PI) / 60);
  const [wx, wz] = inp.wind;

  const pts: number[] = [0, x, y, z];
  const bounces: Shot["bounces"] = [];
  let t = 0;
  let apex = 0, apexT = 0, landT = 0, carry = 0, curveY = 0;
  let rolling = false;
  let steps = 0;
  const x0 = Math.sin(az), z0 = Math.cos(az);
  while (t < 28) {
    if (!rolling) {
      // relative air velocity
      const rx = vx - wx, ry = vy, rz = vz - wz;
      const v = Math.hypot(rx, ry, rz) || 1e-6;
      const S = (R * Math.hypot(wb, ws)) / v;
      const cd = 0.225 + 0.1 * S;
      const cl = Math.min(0.32, 0.56 * Math.pow(S, 0.42));
      const q = 0.5 * RHO * AREA * v * v;
      const drag = (q * cd) / MASS;
      const lift = S > 1e-6 ? (q * cl) / MASS : 0;
      // unit vectors: v̂, right of the flight, and the lift-up direction
      const ux = rx / v, uy = ry / v, uz = rz / v;
      let sx = uz, sz = -ux; // up × v̂ (horizontal, to the right of travel)
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl;
      sz /= sl;
      // lift-up = v̂ × right
      const lx = uy * sz - uz * 0;
      const ly = uz * sx - ux * sz;
      const lz = ux * 0 - uy * sx;
      const bShare = S > 1e-6 ? (R * wb) / v / S : 0;
      const sShare = S > 1e-6 ? (R * ws) / v / S : 0;
      const ax = -drag * ux + lift * (bShare * lx + sShare * sx);
      const ay = -G - drag * uy + lift * (bShare * ly);
      const az2 = -drag * uz + lift * (bShare * lz + sShare * sz);
      vx += ax * DT;
      vy += ay * DT;
      vz += az2 * DT;
      x += vx * DT;
      y += vy * DT;
      z += vz * DT;
      const decay = Math.exp(-0.035 * DT);
      wb *= decay;
      ws *= decay;
      if (y > apex) {
        apex = y;
        apexT = t;
      }
      if (y <= 0 && vy < 0) {
        y = 0;
        const surf = inp.surfaceAt(x, z);
        const P = SURF[surf];
        const vh = Math.hypot(vx, vz);
        const vin = -vy;
        if (!bounces.length) {
          landT = t;
          carry = Math.hypot(x, z) / YD;
          curveY = (x * z0 - z * x0) / YD;
        }
        bounces.push({ t, x, z, vy: vin, surface: surf });
        // the tangential slip: sliding forward plus the backspin at the contact point
        const s = vh + R * wb;
        const full = ((1 + P.et) * Math.abs(s)) / 3.5; // impulse that leaves a clean roll (with tangential give)
        const grip = P.mu * (1 + P.e) * vin;
        const dv = Math.min(full, grip) * Math.sign(s);
        const nvh = vh - dv;
        const k = vh > 1e-6 ? (nvh / vh) * (nvh > 0 ? P.keep : 1) : 0;
        vx *= k;
        vz *= k;
        wb -= (2.5 * dv) / R;
        // sidespin skids off, taking some sideways speed with it
        ws *= 0.3;
        vy = vin * P.e;
        if (vy < 1.1 || surf === "bunker" || surf === "out") {
          vy = 0;
          rolling = true;
        }
      }
    } else {
      const surf = inp.surfaceAt(x, z);
      const dec = SURF[surf].roll;
      const vh = Math.hypot(vx, vz);
      const d = Math.min(vh, dec * DT);
      if (vh > 1e-6) {
        vx -= (vx / vh) * d;
        vz -= (vz / vh) * d;
      }
      x += vx * DT;
      z += vz * DT;
      if (vh - d < 0.04) {
        vx = 0;
        vz = 0;
        t += DT;
        steps++;
        if (steps % 4 === 0) pts.push(t, x, 0, z);
        break;
      }
    }
    t += DT;
    steps++;
    if (steps % 4 === 0) pts.push(t, x, Math.max(0, y), z);
  }
  pts.push(t, x, 0, z);
  const n = pts.length / 4;
  const total = Math.hypot(x, z) / YD;
  const rx = Math.cos(az), rz = -Math.sin(az);
  void rx;
  void rz;
  const aimX = Math.sin(inp.yaw), aimZ = Math.cos(inp.yaw);
  const side = (x * aimZ - z * aimX) / YD;
  return {
    pts: new Float32Array(pts),
    n,
    bounces,
    apex,
    apexT,
    landT,
    restT: t,
    carry,
    total,
    side,
    curve: curveY,
    speed: speed * 2.23694,
    launch: (la * 180) / Math.PI,
    spin: Math.round((back0 * 60) / (2 * Math.PI) / 10) * 10,
    surface: inp.surfaceAt(x, z),
  };
}

/** position along a simulated shot at time t (clamped to the ends) */
export function at(shot: Shot, t: number, out: [number, number, number] = [0, 0, 0]) {
  const p = shot.pts;
  const f = Math.max(0, Math.min(shot.n - 1, t * 60));
  const i = Math.min(shot.n - 2, Math.floor(f));
  // sample times are 1/60 apart except the final one, so look it up by index
  const a = i * 4, b = a + 4;
  const t0 = p[a], t1 = p[b];
  const u = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
  out[0] = p[a + 1] + (p[b + 1] - p[a + 1]) * u;
  out[1] = p[a + 2] + (p[b + 2] - p[a + 2]) * u;
  out[2] = p[a + 3] + (p[b + 3] - p[a + 3]) * u;
  return out;
}
