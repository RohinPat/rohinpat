// The rules of the penalty shootout, with no drawing in them: shot types and
// how the ball flies for each, the goalkeeper's brain (what he reads, when he
// commits, where he dives) and his body (a pose he blends through, solved to
// joints, so the ball can actually hit a glove, an arm or a boot).
//
// Units are metres and seconds. x runs across the goal, y up, z toward it.

export const GW = 3.66; // half goal width
export const GH = 2.44;
export const SPOT_Z = 0;
export const GOAL_Z = 11;
export const NET_Z = 12.2;
export const KEEPER_Z = 10.6; // the plane the keeper stands in
export const BALL_R = 0.11;
export const RUNUP = 0.36; // seconds from release to the ball leaving the boot

export type Rnd = () => number;
export type Vec = { x: number; y: number };

// ───────────────────────────── shots ─────────────────────────────

export type ShotId = "placed" | "driven" | "curlL" | "curlR" | "dipper" | "knuckle" | "panenka";

export type ShotDef = {
  id: ShotId;
  name: string;
  /** one line for the caption under the buttons */
  blurb: string;
  /** power that is cleanest for this kick, and how far either side still is */
  sweet: number;
  width: number;
  /** flight time (s) to the goal line at no power and at full power */
  tSlow: number;
  tFast: number;
  /** the gravity this kick "feels" (topspin pulls a drive down less, a lob more) */
  grav: number;
  /** sideways acceleration: the Magnus force of side-spin (+ bends to the right) */
  curl: number;
  /** extra downward acceleration: topspin on a dipper */
  dip: number;
  /** knuckleball wobble, 0 for none */
  wob: number;
  /** typical miss (m) when struck cleanly */
  err: number;
  /** how hard it is for the keeper to read: subtracted from his read chance */
  hide: number;
  /** how much of the bend a keeper picks up on his own */
  aware: number;
  /** spin of the ball, rad/s about x, y, z (top-spin is +x) */
  spin: [number, number, number];
};

export const SHOTS: ShotDef[] = [
  {
    id: "placed", name: "Placed", blurb: "Side-foot it. The safest kick: steady, true, and the keeper reads it best.",
    sweet: 0.5, width: 0.24, tSlow: 0.92, tFast: 0.58, grav: 5.2, curl: 0, dip: 0, wob: 0, err: 0.1, hide: 0, aware: 0, spin: [4, 0, 0],
  },
  {
    id: "driven", name: "Driven", blurb: "Low and hard, struck through the ball. Hold near the top: the keeper has no time.",
    sweet: 0.86, width: 0.13, tSlow: 0.6, tFast: 0.35, grav: 1.6, curl: 0, dip: 0, wob: 0, err: 0.34, hide: 0.05, aware: 0, spin: [26, 0, 0],
  },
  {
    id: "curlL", name: "Curl ↶", blurb: "Bend it left. It starts right of your aim and swings in; keepers dive for where it starts.",
    sweet: 0.62, width: 0.2, tSlow: 1.0, tFast: 0.66, grav: 5.4, curl: -6.2, dip: 0, wob: 0, err: 0.26, hide: 0.18, aware: 0.18, spin: [5, 17, 0],
  },
  {
    id: "curlR", name: "Curl ↷", blurb: "Bend it right. It starts left of your aim and swings in; keepers dive for where it starts.",
    sweet: 0.62, width: 0.2, tSlow: 1.0, tFast: 0.66, grav: 5.4, curl: 6.2, dip: 0, wob: 0, err: 0.26, hide: 0.18, aware: 0.18, spin: [5, -17, 0],
  },
  {
    id: "dipper", name: "Dipper", blurb: "Top-spin. It climbs, then drops late under the bar. Aim at the top corners.",
    sweet: 0.68, width: 0.16, tSlow: 1.0, tFast: 0.7, grav: 6, curl: 0, dip: 5.2, wob: 0, err: 0.28, hide: 0.2, aware: 0.2, spin: [30, 0, 0],
  },
  {
    id: "knuckle", name: "Knuckle", blurb: "No spin, so it wobbles. Nobody knows where it goes, you included.",
    sweet: 0.82, width: 0.14, tSlow: 0.86, tFast: 0.52, grav: 5.4, curl: 0, dip: 0, wob: 1, err: 0.2, hide: 0.14, aware: 0, spin: [0.7, 0.5, 0.4],
  },
  {
    id: "panenka", name: "Panenka", blurb: "A soft chip down the middle. Wins if he dives early; he catches it if he waits.",
    sweet: 0.3, width: 0.15, tSlow: 1.4, tFast: 1.08, grav: 9.8, curl: 0, dip: 0, wob: 0, err: 0.14, hide: 0.1, aware: 0, spin: [-13, 0, 0],
  },
];

export const shotById = (id: ShotId) => SHOTS.find((s) => s.id === id)!;

export function gauss(r: Rnd) {
  let u = 0;
  for (let i = 0; i < 4; i++) u += r();
  return (u - 2) * 1.73; // ~N(0,1), clipped at about 3.5 sigma
}

type Wob = { fx: [number, number]; px: [number, number]; fy: number; py: number; ax: number; ay: number };

export type Strike = {
  shot: ShotDef;
  power: number;
  aim: Vec;
  /** where it is bent/dipped to land, after the miss-hit */
  target: Vec;
  /** where it actually crosses the line (a knuckleball adds its wobble) */
  end: Vec;
  /** where a keeper who ignored curl, dip and wobble would think it ends */
  naive: Vec;
  /** the same two guesses at the keeper's own plane (z = KEEPER_Z), which is where he has to meet it */
  seen: { naive: Vec; target: Vec };
  T: number;
  h: number;
  v: [number, number, number];
  wob: Wob | null;
  /** how far off the sweet spot (0 = clean) */
  off: number;
};

function accel(st: { shot: ShotDef; wob: Wob | null; T: number }, t: number, ex: { curl: boolean; wob: boolean }): [number, number] {
  const { shot, wob } = st;
  let ax = ex.curl ? shot.curl : 0;
  let ay = -shot.grav - (ex.curl ? shot.dip : 0);
  if (ex.wob && wob) {
    const env = 0.3 + 0.7 * Math.min(1, t / st.T);
    const tw = Math.PI * 2 * t;
    ax += wob.ax * env * (Math.sin(tw * wob.fx[0] + wob.px[0]) + 0.55 * Math.sin(tw * wob.fx[1] + wob.px[1]));
    ay += wob.ay * env * Math.sin(tw * wob.fy + wob.py);
  }
  return [ax, ay];
}

function integrate(st: { shot: ShotDef; wob: Wob | null; T: number }, n: number, h: number, vx: number, vy: number, ex: { curl: boolean; wob: boolean }, x0 = 0, y0 = BALL_R) {
  let x = x0, y = y0, t = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = accel(st, t, ex);
    vx += ax * h;
    vy += ay * h;
    x += vx * h;
    y += vy * h;
    t += h;
  }
  return { x, y };
}

export function flightTime(shot: ShotDef, power: number) {
  return shot.tSlow + (shot.tFast - shot.tSlow) * power;
}

/** Turn an aim and a power into a flight: miss-hit, launch velocity, where it really ends. */
export function makeStrike(shot: ShotDef, aim: Vec, power: number, rnd: Rnd): Strike {
  const T = flightTime(shot, power);
  // how far from this kick's sweet spot; only the far side of the band costs you
  const off = Math.max(0, Math.abs(power - shot.sweet) - shot.width);
  const sigma = shot.err + off * 1.9;
  let tx = aim.x + gauss(rnd) * sigma;
  let ty = aim.y + gauss(rnd) * sigma * 0.6;
  // hit it too hard and it climbs
  const over = shot.id === "panenka" ? Math.max(0, power - shot.sweet - shot.width) * 5.5 : Math.max(0, power - 0.88) * 3.2;
  ty += over;
  if (shot.id === "panenka") ty -= Math.max(0, shot.sweet - shot.width - power) * 2.5;
  ty = Math.max(0.16, ty);
  const wob: Wob | null = shot.wob
    ? {
        fx: [0.8 + rnd() * 0.7, 1.9 + rnd() * 1.3],
        px: [rnd() * 6.28, rnd() * 6.28],
        fy: 1 + rnd() * 1.2,
        py: rnd() * 6.28,
        ax: 17 * (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.5),
        ay: 8,
      }
    : null;
  const n = Math.max(8, Math.ceil(T * 240));
  const h = T / n;
  const base = { shot, wob, T };
  // linear in the launch velocity: one pass gives the correction
  const e0 = integrate(base, n, h, 0, 0, { curl: true, wob: false });
  const vx = (tx - e0.x) / T;
  const vy = (ty - e0.y) / T;
  const plain = integrate(base, n, h, vx, vy, { curl: false, wob: false });
  const wobOnly = wob ? integrate(base, n, h, 0, 0, { curl: false, wob: true }, 0, 0) : { x: 0, y: 0 };
  const end = { x: tx + wobOnly.x, y: ty + wobOnly.y };
  const nK = Math.round(n * ((KEEPER_Z - SPOT_Z) / (GOAL_Z - SPOT_Z)));
  const atK = integrate(base, nK, h, vx, vy, { curl: true, wob: false });
  const plainK = integrate(base, nK, h, vx, vy, { curl: false, wob: false });
  return {
    shot,
    power,
    aim,
    target: { x: tx, y: ty },
    end,
    naive: { x: plain.x, y: plain.y },
    seen: { naive: { x: plainK.x, y: plainK.y }, target: { x: atK.x, y: atK.y } },
    T,
    h,
    v: [vx, vy, (GOAL_Z - SPOT_Z) / T],
    wob,
    off,
  };
}

export type Ball = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  t: number;
  /** orientation (row-major 3x3) and spin (rad/s) for the panels */
  rot: number[];
  w: [number, number, number];
};

export const newBall = (): Ball => ({
  x: 0, y: BALL_R, z: SPOT_Z, vx: 0, vy: 0, vz: 0, t: 0,
  rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  w: [0, 0, 0],
});

export function launch(b: Ball, st: Strike) {
  b.x = 0;
  b.y = BALL_R;
  b.z = SPOT_Z;
  [b.vx, b.vy, b.vz] = st.v;
  b.t = 0;
  b.w = [...st.shot.spin];
}

/** one fixed step of the flight, the same stepping the solver used */
export function stepBall(b: Ball, st: Strike, h: number) {
  const [ax, ay] = accel(st, b.t, { curl: true, wob: true });
  b.vx += ax * h;
  b.vy += ay * h;
  b.x += b.vx * h;
  b.y += b.vy * h;
  b.z += b.vz * h;
  b.t += h;
  if (b.y < BALL_R && b.vy < 0) {
    b.y = BALL_R;
    b.vy = -b.vy * 0.45;
  }
}

/** turn the ball's orientation by its spin over dt */
export function spinBall(b: Ball, dt: number) {
  const [wx, wy, wz] = b.w;
  const m = Math.hypot(wx, wy, wz);
  if (m < 1e-4) return;
  const ang = m * dt;
  const kx = wx / m, ky = wy / m, kz = wz / m;
  const c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  const R = [
    c + kx * kx * C, kx * ky * C - kz * s, kx * kz * C + ky * s,
    ky * kx * C + kz * s, c + ky * ky * C, ky * kz * C - kx * s,
    kz * kx * C - ky * s, kz * ky * C + kx * s, c + kz * kz * C,
  ];
  const o = b.rot;
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = R[i * 3] * o[j] + R[i * 3 + 1] * o[3 + j] + R[i * 3 + 2] * o[6 + j];
  b.rot = out;
}

// ───────────────────────────── the keeper's body ─────────────────────────────

const TORSO = 0.62;
const SW = 0.2; // half shoulder width
const HW = 0.11; // half hip width
const UA = 0.36; // upper arm
const FA = 0.44; // forearm to glove centre
const THIGH = 0.47;
const SHIN = 0.47;
const ARM = UA + FA;
export const MAX_DIVE = 2.45; // furthest his hips travel
/** furthest a glove can be from his hips, stretched out */
export const ARM_REACH = TORSO + ARM;

/** A pose, as numbers so it can be blended: hip, lean, two hands, two feet, gaze. */
export type Pose = number[];
const I = { hx: 0, hy: 1, th: 2, ax: 3, ay: 4, bx: 5, by: 6, fax: 7, fay: 8, fbx: 9, fby: 10, look: 11 };

export type Joints = {
  hip: [number, number];
  sh: [number, number];
  shA: [number, number]; shB: [number, number];
  elA: [number, number]; elB: [number, number];
  hA: [number, number]; hB: [number, number];
  hpA: [number, number]; hpB: [number, number];
  knA: [number, number]; knB: [number, number];
  ftA: [number, number]; ftB: [number, number];
  head: [number, number];
  th: number;
};

type P2 = [number, number];

function ik(ax: number, ay: number, tx: number, ty: number, l1: number, l2: number, nx: number, ny: number): { end: P2; mid: P2 } {
  let dx = tx - ax, dy = ty - ay;
  let d = Math.hypot(dx, dy);
  if (d < 1e-4) {
    dx = 0;
    dy = -1;
    d = 1;
  }
  const ux = dx / d, uy = dy / d;
  const dd = Math.min(d, l1 + l2 - 1e-3);
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let px = -uy, py = ux;
  if (px * nx + py * ny < 0) {
    px = -px;
    py = -py;
  }
  return { end: [ax + ux * dd, ay + uy * dd], mid: [ax + ux * a + px * hgt, ay + uy * a + py * hgt] };
}

export function solve(p: Pose): Joints {
  const th = p[I.th];
  const ax = Math.sin(th), ay = Math.cos(th); // hip to shoulders
  const px = Math.cos(th), py = -Math.sin(th); // across the shoulders
  const hip: P2 = [p[I.hx], p[I.hy]];
  const sh: P2 = [hip[0] + ax * TORSO, hip[1] + ay * TORSO];
  const shA: P2 = [sh[0] + px * SW, sh[1] + py * SW];
  const shB: P2 = [sh[0] - px * SW, sh[1] - py * SW];
  const hpA: P2 = [hip[0] + px * HW, hip[1] + py * HW];
  const hpB: P2 = [hip[0] - px * HW, hip[1] - py * HW];
  const armA = ik(shA[0], shA[1], p[I.ax], p[I.ay], UA, FA, px, py - 0.6);
  const armB = ik(shB[0], shB[1], p[I.bx], p[I.by], UA, FA, -px, -py - 0.6);
  const legA = ik(hpA[0], hpA[1], p[I.fax], p[I.fay], THIGH, SHIN, px + 0.5, 0.2);
  const legB = ik(hpB[0], hpB[1], p[I.fbx], p[I.fby], THIGH, SHIN, -px - 0.5, 0.2);
  const head: P2 = [sh[0] + ax * 0.27 + p[I.look] * 0.03, sh[1] + ay * 0.27];
  return {
    hip, sh, shA, shB, elA: armA.mid, elB: armB.mid, hA: armA.end, hB: armB.end,
    hpA, hpB, knA: legA.mid, knB: legB.mid, ftA: legA.end, ftB: legB.end, head, th,
  };
}

/**
 * On the line before a kick: hands up, weight forward. `crouch` (0 to 1) sinks
 * him into the set position as the kicker arrives: knees bent, feet and hands wider.
 */
export function readyPose(x: number, phase: number, lean: number, step: number, crouch = 0): Pose {
  const bob = Math.sin(phase * 6.5) * 0.015 * (1 - crouch);
  const lift = Math.max(0, Math.sin(phase * 13)) * Math.min(1, Math.abs(step) * 3);
  const lx = lean * 0.12;
  const hw = 0.6 + 0.1 * crouch;
  const hy = 1.12 + bob - 0.12 * crouch;
  const fw = 0.34 + 0.1 * crouch;
  return [
    x + lx * 0.5, 0.88 + bob - 0.1 * crouch, lean * 0.1,
    x + hw + lx, hy, x - hw + lx, hy,
    x + fw + lx * 0.3, 0.02 + (step > 0 ? lift * 0.07 : 0), x - fw + lx * 0.3, 0.02 + (step < 0 ? lift * 0.07 : 0),
    lean,
  ];
}

/**
 * Staying up for a ball: a step toward it (no more than 0.7 m), sunk for a low
 * one or up on his toes for a high one, both gloves together on the spot.
 */
export function holdPose(x0: number, P: Vec): Pose {
  const hx = x0 + clamp(P.x - x0, -0.7, 0.7);
  const hy = P.y < 0.9 ? 0.88 - (0.9 - P.y) * 0.5 : 0.88 + Math.max(0, P.y - 1.7) * 0.22;
  const th = clamp((P.x - hx) / 1.5, -0.5, 0.5) * 0.7;
  const fw = 0.38;
  return [
    hx, hy, th,
    P.x + 0.13, P.y, P.x - 0.13, P.y,
    hx + fw, 0.02, hx - fw, 0.02,
    clamp((P.x - hx) / 1.5, -1, 1),
  ];
}

/** one knee down, a hand on the turf: the middle of getting up from a dive */
export function kneelPose(x: number, dir: number): Pose {
  return [
    x, 0.5, dir * 0.4,
    x + dir * 0.45, 0.32, x - dir * 0.2, 0.72,
    x + dir * 0.3, 0.02, x - dir * 0.28, 0.07,
    dir * 0.3,
  ];
}

const THETA_BY_Y: [number, number][] = [[0.3, 1.42], [0.9, 1.2], [1.5, 0.92], [2.0, 0.64], [2.6, 0.42]];
function thetaForHeight(y: number) {
  if (y <= THETA_BY_Y[0][0]) return THETA_BY_Y[0][1];
  for (let i = 1; i < THETA_BY_Y.length; i++) {
    const [y1, t1] = THETA_BY_Y[i];
    const [y0, t0] = THETA_BY_Y[i - 1];
    if (y <= y1) return t0 + ((t1 - t0) * (y - y0)) / (y1 - y0);
  }
  return THETA_BY_Y[THETA_BY_Y.length - 1][1];
}

/** how one dive differs from another: the body angle, and how far apart the gloves sit */
export type Build = { jump: number; th: number; spread: number };
const PLAIN: Build = { jump: 1, th: 0, spread: 0.3 };

/** laid out full stretch toward (P.x, P.y), hands leading and legs trailing */
export function divePose(x0: number, P: Vec, v: Build = PLAIN): Pose {
  const dx = P.x - x0;
  const dir = dx < 0 ? -1 : 1;
  const adx = Math.abs(dx);
  const thAbs = clamp(thetaForHeight(P.y) + v.th, 0.2, 1.5) * Math.min(1, 0.28 + adx / 1.3);
  const th = dir * thAbs;
  const ax = Math.sin(th), ay = Math.cos(th);
  const th2 = dir * Math.min(1.5, thAbs + 0.16);
  const dX = Math.sin(th2), dY = Math.cos(th2);
  let sx = P.x - dX * ARM * 0.9;
  let sy = P.y - dY * ARM * 0.9;
  let hx = sx - ax * TORSO;
  let hy = sy - ay * TORSO;
  if (hy < 0.32) hy = 0.32;
  if (Math.abs(hx - x0) > MAX_DIVE) hx = x0 + dir * MAX_DIVE;
  sx = hx + ax * TORSO;
  sy = hy + ay * TORSO;
  // second glove sits just under the first, across the line of the arms (the same for a dive either way)
  const spread = v.spread;
  const px = Math.cos(th), py = -Math.sin(th);
  const shA: P2 = [sx + px * SW, sy + py * SW];
  const shB: P2 = [sx - px * SW, sy - py * SW];
  const dA = Math.hypot(shA[0] - P.x, shA[1] - P.y);
  const dB = Math.hypot(shB[0] - P.x, shB[1] - P.y);
  const lead: P2 = [P.x, P.y];
  const trail: P2 = [P.x + dir * dY * spread, Math.max(0.06, P.y - Math.abs(dX) * spread)];
  const hA = dA <= dB ? lead : trail;
  const hB = dA <= dB ? trail : lead;
  const back = 0.84;
  return [
    hx, hy, th,
    hA[0], hA[1], hB[0], hB[1],
    hx - ax * back + px * 0.2, Math.max(0.03, hy - ay * back + py * 0.2),
    hx - ax * (back - 0.08) - px * 0.14, Math.max(0.03, hy - ay * (back - 0.08) - py * 0.14),
    dir * 0.6,
  ];
}

export function lerpPose(a: Pose, b: Pose, e: { hip: number; hands: number; feet: number; th: number }): Pose {
  const m = (i: number, k: number) => a[i] + (b[i] - a[i]) * k;
  return [
    m(I.hx, e.hip), m(I.hy, e.hip), m(I.th, e.th),
    m(I.ax, e.hands), m(I.ay, e.hands), m(I.bx, e.hands), m(I.by, e.hands),
    m(I.fax, e.feet), m(I.fay, e.feet), m(I.fbx, e.feet), m(I.fby, e.feet),
    m(I.look, e.th),
  ];
}

// ───────────────────────────── contact ─────────────────────────────

export type Contact = {
  kind: "glove" | "arm" | "body" | "leg" | "head";
  /** 0 at the middle of the part, 1 at its very edge */
  edge: number;
  /** from the part toward the ball */
  nx: number;
  ny: number;
  hand: 0 | 1;
  /** world position of the touching part's centre */
  px: number;
  py: number;
};

function segDist(px: number, py: number, a: P2, b: P2) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby || 1e-6;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby) / l2));
  const cx = a[0] + abx * t, cy = a[1] + aby * t;
  return { d: Math.hypot(px - cx, py - cy), cx, cy };
}

const GLOVE_R = 0.16;

/** is the ball touching any part of him? the nearest part, by how deep. */
export function contact(j: Joints, bx: number, by: number): Contact | null {
  let best: Contact | null = null;
  let bestScore = 1;
  const test = (kind: Contact["kind"], r: number, a: P2, b: P2, hand: 0 | 1 = 0) => {
    const { d, cx, cy } = segDist(bx, by, a, b);
    const reach = r + BALL_R;
    if (d >= reach) return;
    const score = d / reach;
    if (score < bestScore) {
      bestScore = score;
      const len = d || 1e-4;
      best = { kind, edge: score, nx: (bx - cx) / len, ny: (by - cy) / len, hand, px: cx, py: cy };
    }
  };
  test("glove", GLOVE_R, j.hA, j.hA, 0);
  test("glove", GLOVE_R, j.hB, j.hB, 1);
  test("arm", 0.085, j.shA, j.elA, 0);
  test("arm", 0.075, j.elA, j.hA, 0);
  test("arm", 0.085, j.shB, j.elB, 1);
  test("arm", 0.075, j.elB, j.hB, 1);
  test("body", 0.22, j.hip, j.sh);
  test("head", 0.125, j.head, j.head);
  test("leg", 0.115, j.hpA, j.knA);
  test("leg", 0.095, j.knA, j.ftA);
  test("leg", 0.115, j.hpB, j.knB);
  test("leg", 0.095, j.knB, j.ftB);
  return best;
}

// ───────────────────────────── the keeper's mind ─────────────────────────────

/** one kick of this shootout, as he remembers it: which side, how high, what with */
export type Seen = { side: -1 | 0 | 1; high: boolean; shot: ShotId; /** where it crossed (or was stopped), when known */ x?: number; y?: number };
export type Brain = { hist: Seen[] };

export type Plan = {
  mode: "dive" | "stand";
  /**
   * why: a bet before the kick (gamble), your settled reticle (read), the ball
   * once it had left the boot (react), a lob he held for (wait), or a lean he
   * showed you that he didn't mean (bait)
   */
  style: "gamble" | "read" | "react" | "wait" | "bait";
  /** seconds from the start of the run-up when he commits */
  tc: number;
  D: number;
  x0: number;
  P: Vec;
  start: Pose | null;
  final: Pose | null;
  /** how this dive differs from the last one */
  v: Build;
  /** the way his weight goes just before he commits (-1 left, 1 right, 0 none): the last thing you can see */
  tip: -1 | 0 | 1;
};

/** what he is showing you while you aim: a bait lean, left or right, or none */
export type Stance = { bait: -1 | 0 | 1 };

const sideOf = (x: number): -1 | 0 | 1 => (x < -1.05 ? -1 : x > 1.05 ? 1 : 0);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** how much of your aim he has made out: nothing until the reticle has sat still a moment, all of it after about three seconds */
export const tellOf = (dwell: number) => clamp((dwell - 0.6) / 2.2, 0, 1);

export function diveTime(x0: number, P: Vec) {
  return 0.38 + 0.13 * Math.abs(P.x - x0) + 0.07 * Math.max(0, P.y - 1) + (P.y < 0.45 ? 0.04 : 0);
}

export type Memory = {
  /** how likely he thinks left, middle, right: even to start with, and leaning toward where you have been shooting */
  side: [number, number, number];
  /** how likely he thinks high */
  high: number;
  /** Panenkas he has seen this shootout */
  pan: number;
  /** kicks in a row to the same side, ending with the last */
  streak: number;
  /** the last kick was one that bends or wobbles, so he is watching for it */
  bend: boolean;
};

/** What he has noticed this shootout. It lives only in the Brain (no storage) and goes when the shootout does. */
export function memoryOf(brain: Brain, diff: number): Memory {
  const recent = brain.hist.slice(-8);
  const n = recent.length;
  const side: [number, number, number] = [1, 0.35, 1];
  let hs = 0, hw = 0, pan = 0;
  recent.forEach((h, i) => {
    const w = 0.6 + (0.4 * (i + 1)) / n;
    side[h.side + 1] += (0.9 + 2.4 * diff) * w;
    hs += (h.high ? 1 : 0) * w;
    hw += w;
    if (h.shot === "panenka") pan++;
  });
  let streak = 0;
  for (let i = n - 1; i >= 0 && n && recent[i].side === recent[n - 1].side && recent[n - 1].side !== 0; i--) streak++;
  const last = n ? recent[n - 1].shot : null;
  return { side, high: (hs + 0.5) / (hw + 1), pan, streak, bend: !!last && ["curlL", "curlR", "dipper", "knuckle"].includes(last) };
}

/** which way he leans while you aim, -1..1: toward where you have been shooting, and nowhere with no history */
export function favourite(brain: Brain, diff: number) {
  const [l, m, r] = memoryOf(brain, diff).side;
  return (r - l) / (l + m + r);
}

/**
 * What the keeper does about a kick. `diff` runs 0 to 1. `tell` (0 to 1) is how
 * long your reticle sat still: the only thing he knows of your aim, and only
 * as well as he saw it. `x0` is where he is standing.
 *
 * He knows four things, and nothing else: where you have been shooting this
 * shootout (a bet, made before the kick), your reticle if it was settled (a
 * read, made as you strike), the ball once it has left the boot (a reaction,
 * which is late, and as good as his eye and his reach), and what he showed you
 * himself. How he plays a kick is decided from draws made up front, before he
 * looks at the ball, so a bet or a read can never see where the kick goes.
 */
export function think(brain: Brain, diff: number, st: Strike, tell: number, x0: number, rnd: Rnd, stance: Stance = { bait: 0 }): Plan {
  const shot = st.shot;
  const mem = memoryOf(brain, diff);
  const U = Array.from({ length: 20 }, () => rnd());
  const g = (i: number) => (U[i] + U[i + 1] + U[i + 2] - 1.5) * 2; // ~N(0,1)
  const v: Build = { jump: 0.8 + 0.4 * U[8], th: (U[9] - 0.5) * 0.2, spread: 0.22 + 0.16 * U[10] };
  const dScale = 0.94 + 0.12 * U[11];
  const pan = shot.id === "panenka";

  const stand = (style: Plan["style"], tc: number, P: Vec): Plan => ({
    mode: "stand", style, tc, D: 0.3, x0, P: { x: clamp(P.x, -GW, GW), y: clamp(P.y, 0.2, 2.3) }, start: null, final: null, v, tip: 0,
  });
  const dive = (style: Plan["style"], tc: number, P: Vec, tip: -1 | 0 | 1): Plan => {
    const Pc = { x: clamp(P.x, -GW - 0.3, GW + 0.3), y: clamp(P.y, 0.12, 2.85) };
    return { mode: "dive", style, tc, D: diveTime(x0, Pc) * dScale, x0, P: Pc, start: null, final: null, v, tip };
  };
  // where he thinks it goes on a side: where your kicks there have gone (the more of them, the closer he gets), else a corner
  const corner = (side: -1 | 1): Vec => {
    const seen = brain.hist.slice(-6).filter((h) => h.side === side && h.x !== undefined && h.y !== undefined);
    if (!seen.length) return { x: side * (1.8 + U[5] * 1.4), y: U[4] < mem.high ? 1.3 + U[6] : 0.2 + U[6] * 0.6 };
    let wx = 0, wy = 0, ww = 0;
    seen.forEach((h, i) => {
      const w = 1 + i;
      wx += h.x! * w;
      wy += h.y! * w;
      ww += w;
    });
    const sd = 0.22 + 0.6 / seen.length;
    return { x: wx / ww + (U[5] - 0.5) * 2 * sd, y: wy / ww + (U[6] - 0.5) * 2 * sd * 0.8 };
  };
  const pickSide = (): -1 | 0 | 1 => {
    const tot = mem.side[0] + mem.side[1] + mem.side[2];
    let r = U[3] * tot;
    for (let i = 0; i < 3; i++) {
      r -= mem.side[i];
      if (r <= 0) return (i - 1) as -1 | 0 | 1;
    }
    return 0;
  };

  // 1. he leaned one way to bait you, and means to go the other
  if (stance.bait !== 0 && U[0] < 0.5) {
    const side = (-stance.bait) as -1 | 1;
    return dive("bait", RUNUP - 0.08 - 0.08 * U[7], corner(side), side);
  }
  // 2. your reticle sat still long enough for him to make it out
  const pRead = clamp(0.03 + 0.5 * tell + 0.08 * diff - 0.5 * shot.hide, 0, 0.8);
  if (U[1] < pRead) {
    const sg = 0.36 * (1.5 - diff - 0.4 * tell);
    const P = { x: st.aim.x + g(12) * sg, y: st.aim.y + g(15) * sg * 0.8 };
    const tc = RUNUP - 0.03 + 0.07 * U[7];
    return Math.abs(P.x) < 0.7 && P.y < 1.7 ? stand("read", tc, P) : dive("read", tc, P, Math.sign(P.x - x0) as -1 | 0 | 1);
  }
  // 3. a bet before the kick, on where you have been shooting. Against a Panenka the bet is a dive, and it is the one he loses.
  const pWait = clamp(0.12 + 0.45 * diff + 0.15 * Math.min(2, mem.pan), 0.1, 0.85);
  const pEarly = pan ? 1 - pWait : clamp(0.14 + 0.26 * diff + 0.14 * Math.min(4, mem.streak), 0.1, 0.85);
  if (U[2] < pEarly) {
    const side = pickSide();
    const tc = RUNUP - 0.05 - 0.12 * U[7];
    return side === 0 ? stand("gamble", tc, { x: 0, y: mem.high > 0.5 ? 1.5 : 0.7 }) : dive("gamble", tc, corner(side), side);
  }
  // 4. he waits for the ball, and reacts to what it does. His eye is worse for a fast ball; a lob he can wait on longer.
  const react = 0.29 - 0.07 * diff + (U[7] - 0.5) * 0.08 + (pan ? 0.14 : 0);
  const aware = clamp(shot.aware + (shot.aware > 0 ? 0.3 * diff : 0) + (mem.bend ? 0.18 : 0), 0, 0.7);
  const sg = (0.02 + 0.01 * (GOAL_Z / st.T)) * (1.5 - diff) * (pan ? 0.6 : 1);
  const P = {
    x: st.seen.naive.x + (st.seen.target.x - st.seen.naive.x) * aware + g(12) * sg,
    y: st.seen.naive.y + (st.seen.target.y - st.seen.naive.y) * aware + g(15) * sg * 0.8,
  };
  const style = pan ? "wait" : "react";
  const tc = RUNUP + react;
  const near = pan ? 1.5 : 0.8;
  return Math.abs(P.x - x0) < near && P.y < 1.9 ? stand(style, tc, P) : dive(style, tc, P, 0);
}

// ───────────────────────────── the keeper in time ─────────────────────────────

export type KeeperState = {
  x: number; // where he stands on the line
  vx: number;
  lean: number; // -1..1, which way he is leaning (reading you)
  ph: number;
  plan: Plan | null;
  tk: number; // seconds since the run-up began
  cur: Pose;
  joints: Joints;
  /** he has tipped, parried or grabbed it: freeze the dive where it is */
  done: boolean;
  /** getting up after a dive, 0 (on the ground) to 1 (on his feet), and the pose he lay in */
  rise: number;
  lie: Pose | null;
  /** seconds he has spent watching you aim this kick, and when (if ever) he'll show a bait lean */
  aimT: number;
  baitAt: number;
  baitEnd: number;
  bait: -1 | 0 | 1;
  rolled: boolean;
};

export function newKeeper(): KeeperState {
  const cur = readyPose(0, 0, 0, 0);
  return { x: 0, vx: 0, lean: 0, ph: 0, plan: null, tk: 0, cur, joints: solve(cur), done: false, rise: 1, lie: null, aimT: 0, baitAt: Infinity, baitEnd: 0, bait: 0, rolled: false };
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeOut3 = (u: number) => 1 - Math.pow(1 - u, 3);
const easeIO = (u: number) => u * u * (3 - 2 * u);
const same = (e: number) => ({ hip: e, hands: e, feet: e, th: e });
const RISE = 0.95; // seconds to get up from a dive

export type IdleOpts = {
  /** -1..1: where he has noticed you shoot (see favourite()); he stands a little that way */
  bias?: number;
  /** for his one bait lean per kick; without it he never baits */
  rnd?: Rnd;
};

/** on the line before a kick: shuffling, leaning toward where you seem to be aiming and where you usually do */
export function keeperIdle(k: KeeperState, dt: number, aimX: number, tell: number, active: boolean, o: IdleOpts = {}) {
  k.ph += dt;
  if (k.plan) {
    // the kick is over: if he went to ground, he gets up from where he lies
    if (k.plan.start && k.plan.mode === "dive") {
      k.lie = k.cur;
      k.rise = 0;
      k.x = k.cur[I.hx];
      k.vx = 0;
    }
    k.plan = null;
    k.done = false;
    k.aimT = 0;
    k.bait = 0;
    k.baitAt = Infinity;
    k.rolled = false;
  }
  if (!k.rolled && o.rnd) {
    k.rolled = true;
    k.baitAt = o.rnd() < 0.4 ? 1.3 + o.rnd() * 1.3 : Infinity;
  }
  if (active) k.aimT += dt;
  if (active && k.bait === 0 && k.aimT > k.baitAt) {
    k.bait = Math.abs(aimX) > 0.8 ? ((-Math.sign(aimX)) as -1 | 1) : o.rnd && o.rnd() < 0.5 ? -1 : 1;
    k.baitEnd = k.aimT + 1.4;
    k.baitAt = Infinity;
  }
  if (k.bait !== 0 && (!active || k.aimT > k.baitEnd)) k.bait = 0;

  const bias = o.bias ?? 0;
  const wander = Math.sin(k.ph * 1.15) * 0.34 + Math.sin(k.ph * 0.47 + 1) * 0.14;
  const readX = active ? clamp(aimX / GW, -1, 1) * (0.5 * tell) : 0;
  let goal = wander * (1 - 0.6 * tell) + readX * 0.6 + bias * 0.3;
  let leanGoal = clamp(readX * 1.4 + bias * 0.5 + k.vx * 0.6, -1, 1);
  // the bait is a step and a lean, quicker than his usual shuffle so it reads as a choice
  const rate = k.bait !== 0 ? 4.5 : 2.2;
  if (k.bait !== 0) {
    goal = k.bait * 0.65;
    leanGoal = k.bait;
  }

  if (k.rise < 1 && k.lie) {
    k.rise = Math.min(1, k.rise + dt / RISE);
    const r = k.rise;
    const prev = k.x;
    // on his feet he walks back toward where he stands
    if (r > 0.5) k.x += clamp(goal - k.x, -1.7 * dt, 1.7 * dt);
    k.vx = (k.x - prev) / Math.max(dt, 1e-3);
    const rdy = readyPose(k.x, k.ph, 0, k.vx);
    const kneel = kneelPose(k.x, k.lie[I.th] < 0 ? -1 : 1);
    k.cur = r < 0.42 ? lerpPose(k.lie, kneel, same(easeIO(r / 0.42))) : lerpPose(kneel, rdy, same(easeOut((r - 0.42) / 0.58)));
    k.joints = solve(k.cur);
    if (r >= 1) k.lie = null;
    return;
  }

  const prev = k.x;
  k.x += (goal - k.x) * Math.min(1, dt * rate);
  k.vx = (k.x - prev) / Math.max(dt, 1e-3);
  k.lean += (leanGoal - k.lean) * Math.min(1, dt * 3);
  const rdy = readyPose(k.x, k.ph, k.lean, k.vx);
  // settle back from wherever the last kick left him
  const f = Math.min(1, dt * 4.5);
  k.cur = k.cur.map((v, i) => v + (rdy[i] - v) * f);
  k.joints = solve(k.cur);
}

export function keeperStartPlan(k: KeeperState, plan: Plan) {
  k.plan = plan;
  k.tk = 0;
  k.done = false;
  k.bait = 0;
}

/** advance a plan by dt and set his pose */
export function keeperRun(k: KeeperState, dt: number) {
  k.tk += dt;
  k.ph += dt;
  const p = k.plan;
  if (!p || k.done) return;
  if (k.tk < p.tc) {
    // still deciding: he sinks into the set position as the kicker arrives, and if he has made up his mind, his weight goes that way
    const set = easeOut(clamp(k.tk / (RUNUP * 0.9), 0, 1));
    const shift = p.tip * easeIO(clamp((k.tk - (p.tc - 0.12)) / 0.12, 0, 1));
    const sway = Math.sin(k.ph * 1.6) * 0.03 * (1 - set);
    k.vx = 0;
    k.cur = readyPose(k.x + sway, k.ph, k.lean * (1 - set) + shift * 0.9, 0, set);
    k.joints = solve(k.cur);
    return;
  }
  if (!p.start) {
    p.start = k.cur;
    p.final = p.mode === "stand" ? holdPose(k.x, p.P) : divePose(k.x, p.P, p.v);
    p.x0 = k.x;
  }
  const u = clamp((k.tk - p.tc) / p.D, 0, 1);
  // a dive pushes off first, so the hips start slower than they finish
  const e = {
    hip: 0.55 * easeOut(u) + 0.45 * easeIO(u),
    hands: easeOut3(clamp(u * 1.18, 0, 1)),
    feet: easeIO(u) * 0.85 + easeOut(u) * 0.15,
    th: easeOut(u),
  };
  let pose = lerpPose(p.start, p.final!, e);
  if (p.mode === "dive") {
    // a push-off: up before down
    const jump = (p.P.y > 1.7 ? 0.28 : 0.16) * p.v.jump * Math.sin(Math.PI * u) * Math.min(1, Math.abs(p.P.x - p.x0) / 0.8 + 0.5);
    pose = pose.slice();
    pose[I.hy] += jump;
    pose[I.fay] += jump * 1.1;
    pose[I.fby] += jump * 1.1;
  }
  k.cur = pose;
  k.joints = solve(pose);
}

/** an arm of his, for resting a held ball on */
export function glovePos(j: Joints, hand: 0 | 1): P2 {
  return hand ? j.hB : j.hA;
}

export function poseEnd(k: KeeperState) {
  return !!k.plan && !!k.plan.start && k.tk - k.plan.tc >= k.plan.D;
}

export { clamp, easeOut, easeOut3 };

/**
 * Why a kick that missed the frame missed: hit too hard (it climbed, or the
 * power was past the kick's band), too soft, or just not where it was aimed.
 * `aim` is where the player pointed; `end` is where the ball crossed the line.
 */
export function missWhy(st: Strike, end: Vec): "TOO HARD" | "TOO SOFT" | "OFF TARGET" {
  const { shot, power, aim } = st;
  // pointed outside the frame: the ball went where it was sent
  if (Math.abs(aim.x) > GW - 0.05 || aim.y > GH - 0.05) return "OFF TARGET";
  if (power > shot.sweet + shot.width || (shot.id !== "panenka" && power > 0.88 && end.y > GH)) return "TOO HARD";
  if (power < shot.sweet - shot.width) return "TOO SOFT";
  return "OFF TARGET";
}

// ───────────────────────────── what a touch or a crossing means ─────────────────────────────

export type Resolution =
  | { kind: "graze" }
  | { kind: "stop"; how: "held" | "tip" | "parry" | "foot" | "block"; detail: string; hand: 0 | 1 };

/**
 * The ball meets some part of him. Fingertips only slow and bend it; a glove
 * that is slow enough to hold, holds; a hand otherwise parries (or tips it
 * over); anything else just blocks it. Sets the ball's new velocity.
 */
export function resolveContact(b: Ball, st: Strike, j: Joints, c: Contact, grazed: boolean, rnd: Rnd): Resolution {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  const hand = c.kind === "glove" || c.kind === "arm";
  // the rim of a glove only slows and bends a hard ball; a soft one is knocked away
  if (c.kind === "glove" && c.edge > 0.8 && !grazed && sp >= 13) {
    b.vz *= 0.6;
    b.vx += c.nx * 2.8;
    b.vy += c.ny * 2.8;
    return { kind: "graze" };
  }
  // a slow ball is held, a hard one is not: the chance of holding it falls from sure at 11 m/s to none at 19
  if (c.kind === "glove" && c.edge < 0.62 && st.shot.id !== "knuckle" && rnd() < clamp((19 - sp) / 8, 0, 1)) {
    b.vx = b.vy = b.vz = 0;
    return { kind: "stop", how: "held", detail: "SAFE HANDS", hand: c.hand };
  }
  if (hand) {
    const tip = b.y > 1.85 && j.hA[1] > 1.9 && c.ny > 0.1;
    if (tip) {
      b.vy = 4.2 + rnd() * 1.5;
      b.vz = -sp * 0.1;
      b.vx = c.nx * 2 + (b.x > 0 ? 1 : -1) * 1.2;
      return { kind: "stop", how: "tip", detail: "TIPPED OVER THE BAR", hand: c.hand };
    }
    b.vx = c.nx * sp * 0.3 + (b.x > 0 ? 1 : -1) * 1.5;
    b.vy = c.ny * sp * 0.25 + 1.5;
    b.vz = -sp * 0.2;
    return { kind: "stop", how: "parry", detail: st.shot.id === "knuckle" ? "PARRIED, IT MOVED IN HIS HANDS" : "PARRIED AWAY", hand: c.hand };
  }
  b.vx = c.nx * sp * 0.22 + (rnd() - 0.5) * 2;
  b.vy = Math.abs(c.ny) * sp * 0.15 + 1;
  b.vz = -sp * 0.18;
  return { kind: "stop", how: c.kind === "leg" ? "foot" : "block", detail: c.kind === "leg" ? "SAVED WITH HIS FOOT" : "BLOCKED", hand: 0 };
}

/** A kick that was going over the bar or wide was never going in: he cannot save it, so it is a miss whatever his glove does. */
export function missesFrame(st: Strike) {
  return Math.abs(st.end.x) > GW + 0.05 || st.end.y > GH + 0.05;
}

/** What the ball did at the goal line, if nothing stopped it. */
export function atLineResult(b: { x: number; y: number }, st: Strike, plan: Plan | null, grazed: boolean): { result: "goal" | "post" | "miss"; detail: string } {
  const onFrame = (Math.abs(Math.abs(b.x) - GW) < 0.16 && b.y < GH + 0.1) || (Math.abs(b.y - GH) < 0.14 && Math.abs(b.x) < GW + 0.1);
  if (onFrame) return { result: "post", detail: Math.abs(b.y - GH) < 0.14 ? "OFF THE BAR" : "OFF THE POST" };
  if (Math.abs(b.x) > GW || b.y > GH) return { result: "miss", detail: st.shot.id === "panenka" && b.y > GH ? "TOO MUCH LOFT" : missWhy(st, { x: b.x, y: b.y }) };
  let d = "";
  if (grazed) d = "FINGERTIPS, BUT NOT ENOUGH";
  else if (plan && plan.mode === "dive" && Math.abs(b.x) > 1.05 && Math.sign(plan.P.x - plan.x0) !== Math.sign(b.x)) d = "WRONG-FOOTED";
  else if (st.shot.id === "panenka") d = plan && plan.mode === "dive" ? "HE WENT EARLY" : "PANENKA";
  else if (plan && plan.mode === "stand" && Math.abs(b.x) > 1.4) d = "HE NEVER MOVED";
  else d = { placed: "PLACED", driven: "BLASTED IN", curlL: "BENT IN", curlR: "BENT IN", dipper: "DIPPED UNDER THE BAR", knuckle: "KNUCKLEBALL", panenka: "PANENKA" }[st.shot.id];
  return { result: "goal", detail: d };
}

/** he takes note of where a kick went (or was pointed, if it missed the frame) */
export function remember(brain: Brain, result: "goal" | "save" | "miss" | "post", st: Strike, ballX: number, ballY: number) {
  if (result !== "miss") brain.hist.push({ side: sideOf(ballX), high: ballY > 1.3, shot: st.shot.id, x: ballX, y: ballY });
  else brain.hist.push({ side: sideOf(st.aim.x), high: st.aim.y > 1.3, shot: st.shot.id, x: st.aim.x, y: st.aim.y });
}

/**
 * What the save says on screen. A read, a lucky guess and a bait each say so,
 * but only when his dive was where the ball went: a body in the way of a ball
 * he was not going for is just a block, whatever he had planned.
 */
export function saveNote(plan: Plan | null, at: Vec, detail: string): string {
  if (!plan || plan.style === "react") return detail;
  const near = Math.hypot(plan.P.x - at.x, plan.P.y - at.y) < 1.1;
  if (!near) return detail;
  return { read: "HE READ IT", wait: "HE WAITED FOR IT", bait: "HE BAITED YOU", gamble: "GUESSED RIGHT" }[plan.style];
}
