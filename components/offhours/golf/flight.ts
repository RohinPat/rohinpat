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

/**
 * What the ball lies on. "out" is the woods; "oob" is out of bounds (stroke and distance), "gorse" an unplayable bush (a
 * drop and a stroke), "fescue" long rough, "waste" firm sandy scrub (see lie.ts for what each costs).
 */
export type Surface = "green" | "fringe" | "fairway" | "rough" | "bunker" | "water" | "out" | "fescue" | "gorse" | "waste" | "oob";

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
/** a ball rolling down a slope is pulled on by this much of g per unit of slope */
const ROLL_G = (5 / 7) * G;
/** a rolling ball whose middle passes this close to the middle of the cup (m), no faster than HOLE_V (m/s), drops in */
const HOLE_R = 0.06, HOLE_V = 1.5;

const SURF: Record<Surface, { e: number; et: number; mu: number; roll: number; keep: number }> = {
  green: { e: 0.22, et: 0.55, mu: 0.8, roll: 0.9, keep: 0.45 },
  fringe: { e: 0.24, et: 0.3, mu: 0.7, roll: 1.6, keep: 0.6 },
  fairway: { e: 0.28, et: 0.0, mu: 0.6, roll: 2.4, keep: 0.62 },
  rough: { e: 0.12, et: 0, mu: 0.8, roll: 6, keep: 0.4 },
  bunker: { e: 0.05, et: 0, mu: 0.9, roll: 9, keep: 0.1 },
  // never used to bounce: water ends the shot where it lands
  water: { e: 0, et: 0, mu: 1, roll: 40, keep: 0 },
  out: { e: 0.05, et: 0, mu: 0.9, roll: 14, keep: 0.1 },
  // long, wispy grass: grabs the ball more than the rough
  fescue: { e: 0.1, et: 0, mu: 0.85, roll: 8, keep: 0.35 },
  // a bush: the ball stops dead in it
  gorse: { e: 0.04, et: 0, mu: 0.95, roll: 22, keep: 0.05 },
  // firm sand and scrub: between the fairway and a bunker, it takes a little bounce and rolls out less than the rough
  waste: { e: 0.14, et: 0, mu: 0.85, roll: 5, keep: 0.3 },
  // over the stakes: it rolls like the woods (the shot is played again anyway)
  oob: { e: 0.05, et: 0, mu: 0.9, roll: 14, keep: 0.1 },
};
/** surfaces a ball does not bounce off: it plugs, and rolls from there */
const DEAD: ReadonlySet<Surface> = new Set<Surface>(["bunker", "out", "gorse", "oob"]);

/** how the ball lies changes the strike: multipliers on what the swing gives (see golf/lie.ts) */
export type Lie = {
  /** ball speed */
  speed?: number;
  /** backspin */
  spin?: number;
  /** contact can be no better than this */
  contactCap?: number;
  /** launch angle */
  launch?: number;
  /** the start line wanders by up to this much either way (the `face` scale, -1..1) */
  faceNoise?: number;
  /** the start line is pushed this much (the `face` scale; a ball above the feet goes left) */
  face?: number;
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
  /** asked in world coordinates: the shot's own (x, z) plus `origin` */
  surfaceAt: (x: number, z: number) => Surface;
  /** where the ball sits in the world. The flight is worked out in a frame that starts at the ball, so it is the same
   *  from anywhere; this only moves where the surface is looked up. Default (0, 0). */
  origin?: [number, number];
  /** how the ball lies */
  lie?: Lie;
  /** the hand for anything random in the shot (a lie's wander); default Math.random */
  rng?: () => number;
  /** trees a ball in the air can hit (world metres: x, z, crown radius, height): it loses most of its speed and drops */
  trees?: { x: number; z: number; r: number; h: number }[];
  /** the ground's height (m) and slope in world coordinates (terrain.ts); flat at 0 without it */
  ground?: { y: (x: number, z: number) => number; slope: (x: number, z: number) => [number, number] };
  /** the cup, in world coordinates: a ball that rolls over it slowly enough drops in */
  cup?: [number, number];
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
  /** the ball's world position when it was struck: pts, bounces and drop are relative to it (its height, the ground's there) */
  ox: number;
  oy: number;
  oz: number;
  /** a ball that ended in water: the last dry ground it passed over (relative to the origin) */
  drop: { x: number; z: number } | null;
  /** where it hit a tree in the air (relative to the origin), if it did */
  tree: { x: number; z: number } | null;
  /** it rolled into the cup */
  holed: boolean;
};

const YD = 0.9144;

export function simulate(inp: ShotIn): Shot {
  const { club } = inp;
  const [ox, oz] = inp.origin ?? [0, 0];
  const surfAt = (x: number, z: number) => inp.surfaceAt(x + ox, z + oz);
  // the ground, as a height above the ground the ball was struck from (none: flat, and every step below is the flat one)
  const gr = inp.ground;
  const oy = gr ? gr.y(ox, oz) : 0;
  const gy = (x: number, z: number) => (gr ? gr.y(x + ox, z + oz) - oy : 0);
  // a lie changes the swing before it is flown; with none, every number below is the swing's own
  let sp = inp.speed, contact = inp.contact, face = inp.face, spinMul = 1, launchMul = 1;
  const lie = inp.lie;
  if (lie) {
    sp *= lie.speed ?? 1;
    spinMul = lie.spin ?? 1;
    launchMul = lie.launch ?? 1;
    if (lie.contactCap !== undefined) contact = Math.min(contact, lie.contactCap);
    if (lie.faceNoise) face += (((inp.rng ?? Math.random)() * 2) - 1) * lie.faceNoise;
    if (lie.face) face += lie.face;
  }
  const speed = club.speed * sp * (0.78 + 0.22 * contact);
  const la = ((club.launch * launchMul * (inp.lift ?? 1)) * Math.PI) / 180;
  const az = inp.yaw + face * 0.085;
  let vx = Math.sin(az) * Math.cos(la) * speed;
  let vy = Math.sin(la) * speed;
  let vz = Math.cos(az) * Math.cos(la) * speed;
  let x = 0, y = 0.04, z = 0;
  // spin in rad/s: back and side
  const back0 = ((club.spin * spinMul * (0.7 + 0.3 * contact) * (0.55 + 0.45 * sp)) * 2 * Math.PI) / 60;
  let wb = back0;
  let ws = inp.curve * ((2600 * 2 * Math.PI) / 60);
  const [wx, wz] = inp.wind;

  const pts: number[] = [0, x, y, z];
  const bounces: Shot["bounces"] = [];
  let t = 0;
  let apex = 0, apexT = 0, landT = 0, carry = 0, curveY = 0;
  let rolling = false;
  let holed = false;
  let tree: Shot["tree"] = null;
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
      if (inp.trees && !tree && y > 0) {
        for (const tr of inp.trees) {
          const dx = x + ox - tr.x, dz = z + oz - tr.z;
          if (y < tr.h + (gr ? gr.y(tr.x, tr.z) - oy : 0) && dx * dx + dz * dz < tr.r * tr.r) {
            // into the branches: most of the speed is gone, and the ball drops
            tree = { x, z };
            vx *= 0.12;
            vz *= 0.12;
            vy = Math.min(vy, 0) * 0.3 - 0.5;
            wb *= 0.3;
            ws = 0;
            break;
          }
        }
      }
      const floor = gr ? gy(x, z) : 0;
      // the ground's normal (straight up on the flat)
      let nx = 0, ny = 1, nz = 0;
      if (gr && y <= floor) {
        const [sx, sz] = gr.slope(x + ox, z + oz);
        const l = Math.hypot(sx, 1, sz);
        nx = -sx / l;
        ny = 1 / l;
        nz = -sz / l;
      }
      if (y <= floor && vx * nx + vy * ny + vz * nz < 0) {
        y = floor;
        const surf = surfAt(x, z);
        const P = SURF[surf];
        // into the ground and along it
        const vn = vx * nx + vy * ny + vz * nz;
        const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
        const vh = Math.hypot(tx, ty, tz);
        const vin = -vn;
        if (!bounces.length) {
          landT = t;
          carry = Math.hypot(x, z) / YD;
          curveY = (x * z0 - z * x0) / YD;
        }
        bounces.push({ t, x, z, vy: vin, surface: surf });
        if (surf === "water") {
          // a splash: the ball is gone
          vx = 0;
          vz = 0;
          t += DT;
          steps++;
          break;
        }
        // the tangential slip: sliding forward plus the backspin at the contact point
        const s = vh + R * wb;
        const full = ((1 + P.et) * Math.abs(s)) / 3.5; // impulse that leaves a clean roll (with tangential give)
        const grip = P.mu * (1 + P.e) * vin;
        const dv = Math.min(full, grip) * Math.sign(s);
        const nvh = vh - dv;
        const k = vh > 1e-6 ? (nvh / vh) * (nvh > 0 ? P.keep : 1) : 0;
        wb -= (2.5 * dv) / R;
        // sidespin skids off, taking some sideways speed with it
        ws *= 0.3;
        const up = vin * P.e;
        if (!gr) {
          vx *= k;
          vz *= k;
          vy = up;
        } else {
          vx = tx * k + nx * up;
          vy = ty * k + ny * up;
          vz = tz * k + nz * up;
        }
        if (up < 1.1 || DEAD.has(surf)) {
          vy = 0;
          rolling = true;
        }
      }
    } else {
      const surf = surfAt(x, z);
      if (surf === "water") {
        // rolled into a pond
        bounces.push({ t, x, z, vy: 0, surface: surf });
        vx = 0;
        vz = 0;
        t += DT;
        steps++;
        break;
      }
      const dec = SURF[surf].roll;
      // downhill pulls a rolling ball on (5/7 of g along the slope, for a ball that rolls without slipping)
      let ax = 0, az = 0;
      if (gr) {
        const [sx, sz] = gr.slope(x + ox, z + oz);
        ax = -ROLL_G * sx;
        az = -ROLL_G * sz;
        vx += ax * DT;
        vz += az * DT;
      }
      const vh = Math.hypot(vx, vz);
      const d = Math.min(vh, dec * DT);
      if (vh > 1e-6) {
        vx -= (vx / vh) * d;
        vz -= (vz / vh) * d;
      }
      x += vx * DT;
      z += vz * DT;
      y = gy(x, z);
      if (inp.cup && Math.hypot(x + ox - inp.cup[0], z + oz - inp.cup[1]) < HOLE_R && Math.hypot(vx, vz) < HOLE_V) {
        // in the hole
        holed = true;
        x = inp.cup[0] - ox;
        z = inp.cup[1] - oz;
        vx = 0;
        vz = 0;
        t += DT;
        steps++;
        break;
      }
      // it stops when it is slow and the slope cannot start it again
      if (vh - d < 0.04 && Math.hypot(ax, az) < dec) {
        vx = 0;
        vz = 0;
        t += DT;
        steps++;
        if (steps % 4 === 0) pts.push(t, x, y, z);
        break;
      }
    }
    t += DT;
    steps++;
    if (steps % 4 === 0) pts.push(t, x, gr ? Math.max(gy(x, z), y) : Math.max(0, y), z);
  }
  pts.push(t, x, gy(x, z) - (holed ? 0.06 : 0), z);
  const n = pts.length / 4;
  const total = Math.hypot(x, z) / YD;
  const rx = Math.cos(az), rz = -Math.sin(az);
  void rx;
  void rz;
  const aimX = Math.sin(inp.yaw), aimZ = Math.cos(inp.yaw);
  const side = (x * aimZ - z * aimX) / YD;
  const surface = surfAt(x, z);
  let drop: Shot["drop"] = null;
  if (surface === "water") {
    // back along the flight to the last point that was not over water
    drop = { x: 0, z: 0 };
    for (let i = pts.length / 4 - 1; i >= 0; i--) {
      const px = pts[i * 4 + 1], pz = pts[i * 4 + 3];
      if (surfAt(px, pz) !== "water") {
        drop = { x: px, z: pz };
        break;
      }
    }
  }
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
    surface,
    ox,
    oy,
    oz,
    drop,
    tree,
    holed,
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
