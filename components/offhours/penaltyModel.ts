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
    sweet: 0.86, width: 0.13, tSlow: 0.6, tFast: 0.35, grav: 1.6, curl: 0, dip: 0, wob: 0, err: 0.3, hide: 0.05, aware: 0, spin: [26, 0, 0],
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
  return {
    shot,
    power,
    aim,
    target: { x: tx, y: ty },
    end,
    naive: { x: plain.x, y: plain.y },
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

/** crouched on the line, hands up, weight forward */
export function readyPose(x: number, phase: number, lean: number, step: number): Pose {
  const bob = Math.sin(phase * 6.5) * 0.015;
  const lift = Math.max(0, Math.sin(phase * 13)) * Math.min(1, Math.abs(step) * 3);
  const lx = lean * 0.12;
  return [
    x + lx * 0.5, 0.88 + bob, lean * 0.1,
    x + 0.6 + lx, 1.12 + bob, x - 0.6 + lx, 1.12 + bob,
    x + 0.34 + lx * 0.3, 0.02 + (step > 0 ? lift * 0.07 : 0), x - 0.34 + lx * 0.3, 0.02 + (step < 0 ? lift * 0.07 : 0),
    lean,
  ];
}

/** up on his toes, arms and legs wide: making himself big */
export function bigPose(x: number): Pose {
  return [x, 0.86, 0, x + 1.0, 2.2, x - 1.0, 2.2, x + 0.52, 0.03, x - 0.52, 0.03, 0];
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

/** laid out full stretch toward (P.x, P.y), hands leading and legs trailing */
export function divePose(x0: number, P: Vec): Pose {
  const dx = P.x - x0;
  const dir = dx < 0 ? -1 : 1;
  const adx = Math.abs(dx);
  const thAbs = thetaForHeight(P.y) * Math.min(1, 0.28 + adx / 1.3);
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
  // second glove sits beside the first, across the line of the arms
  const qx = dY, qy = -dX;
  const spread = 0.3;
  const px = Math.cos(th), py = -Math.sin(th);
  const shA: P2 = [sx + px * SW, sy + py * SW];
  const shB: P2 = [sx - px * SW, sy - py * SW];
  const dA = Math.hypot(shA[0] - P.x, shA[1] - P.y);
  const dB = Math.hypot(shB[0] - P.x, shB[1] - P.y);
  const lead: P2 = [P.x, P.y];
  const trail: P2 = [P.x + qx * spread * (dA <= dB ? 1 : -1) * dir, Math.max(0.06, P.y + qy * spread * (dA <= dB ? 1 : -1) * dir)];
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

export type Seen = { side: -1 | 0 | 1; high: boolean; shot: ShotId };
export type Brain = { hist: Seen[] };

export type Plan = {
  mode: "dive" | "stand";
  /** why: a guess before the strike, a read of the ball, a guess after a glimpse, a wait */
  style: "gamble" | "read" | "guess" | "wait";
  /** seconds from the start of the run-up when he commits */
  tc: number;
  D: number;
  x0: number;
  P: Vec;
  start: Pose | null;
  final: Pose | null;
};

const sideOf = (x: number): -1 | 0 | 1 => (x < -1.05 ? -1 : x > 1.05 ? 1 : 0);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function diveTime(x0: number, P: Vec) {
  return 0.3 + 0.115 * Math.abs(P.x - x0) + 0.07 * Math.max(0, P.y - 1) + (P.y < 0.45 ? 0.04 : 0);
}

/**
 * What the keeper does about a kick. `diff` runs 0 to 1, `tell` is how long you
 * hovered on one spot (he reads that, a little), `x0` is where he's standing.
 */
export function think(brain: Brain, diff: number, st: Strike, tell: number, x0: number, rnd: Rnd): Plan {
  const shot = st.shot;
  const recent = brain.hist.slice(-6);
  // tendencies: where you've been shooting (and what with)
  const w = [1, 1, 1];
  recent.forEach((h, i) => {
    w[h.side + 1] += (0.5 + 0.9 * diff) * (0.5 + i / recent.length);
  });
  const lastBend = recent.length && ["curlL", "curlR", "dipper", "knuckle"].includes(recent[recent.length - 1].shot);
  const pickSide = (): -1 | 0 | 1 => {
    const tot = w[0] + w[1] + w[2];
    let r = rnd() * tot;
    for (let i = 0; i < 3; i++) {
      r -= w[i];
      if (r <= 0) return (i - 1) as -1 | 0 | 1;
    }
    return 0;
  };
  const highBias = recent.length ? recent.filter((h) => h.high).length / recent.length : 0.4;
  const aware = clamp(shot.aware + (shot.aware > 0 ? 0.3 * diff : 0) + (lastBend ? 0.18 : 0), 0, 0.9);
  const sigma = 0.3 * (1.35 - diff);
  const seenX = st.naive.x + (st.target.x - st.naive.x) * aware + gauss(rnd) * sigma;
  const seenY = st.naive.y + (st.target.y - st.naive.y) * aware + gauss(rnd) * sigma * 0.8;
  const conf = clamp(0.3 + 0.4 * diff + 0.16 * tell - shot.hide, 0.08, 0.9);
  const sameSide = recent.length >= 2 && recent[recent.length - 1].side === recent[recent.length - 2].side && recent[recent.length - 1].side !== 0;
  const pGamble = 0.07 + 0.1 * diff + (sameSide ? 0.06 + 0.1 * diff : 0);
  const react = 0.3 - 0.13 * diff + (rnd() - 0.5) * 0.08;

  const stand = (style: Plan["style"], tc: number): Plan => ({ mode: "stand", style, tc, D: 0.3, x0, P: { x: x0, y: 1.2 }, start: null, final: null });
  const dive = (style: Plan["style"], tc: number, P: Vec): Plan => {
    const Pc = { x: clamp(P.x, -GW - 0.3, GW + 0.3), y: clamp(P.y, 0.12, 2.85) };
    return { mode: "dive", style, tc, D: diveTime(x0, Pc), x0, P: Pc, start: null, final: null };
  };
  const corner = (side: number): Vec => ({ x: side * (1.7 + rnd() * 1.5), y: rnd() < 0.5 + (highBias - 0.4) * 0.5 ? 0.9 + rnd() * 1.3 : 0.2 + rnd() * 0.6 });

  const roll = rnd();
  if (roll < pGamble) {
    const side = pickSide();
    const tc = RUNUP - 0.04 - rnd() * 0.1;
    return side === 0 ? stand("gamble", tc) : dive("gamble", tc, corner(side));
  }
  if (rnd() < conf) {
    // he sees it clearly
    if (shot.id === "panenka") {
      // he can tell it's a lob. Does he have the nerve to wait for it?
      if (rnd() < 0.28 + 0.4 * diff) return stand("wait", RUNUP + react + 0.08);
      const side = rnd() < 0.5 ? -1 : 1;
      return dive("guess", RUNUP + react, corner(pickSide() || side));
    }
    if (Math.abs(seenX) < 0.75 && seenY < 2.05) return rnd() < 0.82 ? stand("read", RUNUP + react) : dive("read", RUNUP + react, { x: seenX, y: seenY });
    return dive("read", RUNUP + react, { x: seenX, y: seenY });
  }
  // a glimpse: probably the right side
  const seenSide = sideOf(seenX);
  const side = rnd() < 0.45 + 0.25 * diff ? seenSide : pickSide();
  if (side === 0) return stand("guess", RUNUP + react + 0.04);
  const c = corner(side);
  return dive("guess", RUNUP + react + 0.04, { x: c.x, y: rnd() < 0.5 ? c.y : (c.y + seenY) / 2 });
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
};

export function newKeeper(): KeeperState {
  const cur = readyPose(0, 0, 0, 0);
  return { x: 0, vx: 0, lean: 0, ph: 0, plan: null, tk: 0, cur, joints: solve(cur), done: false };
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeOut3 = (u: number) => 1 - Math.pow(1 - u, 3);
const easeIO = (u: number) => u * u * (3 - 2 * u);

/** on the line before a kick: shuffling, leaning toward where you seem to be aiming */
export function keeperIdle(k: KeeperState, dt: number, aimX: number, tell: number, active: boolean) {
  k.ph += dt;
  const wander = Math.sin(k.ph * 1.15) * 0.34 + Math.sin(k.ph * 0.47 + 1) * 0.14;
  const readX = active ? clamp(aimX / GW, -1, 1) * (0.5 * tell) : 0;
  const goal = wander * (1 - 0.6 * tell) + readX * 0.6;
  const prev = k.x;
  k.x += (goal - k.x) * Math.min(1, dt * 2.2);
  k.vx = (k.x - prev) / Math.max(dt, 1e-3);
  k.lean += (clamp(readX * 1.4 + k.vx * 0.6, -1, 1) - k.lean) * Math.min(1, dt * 3);
  const rdy = readyPose(k.x, k.ph, k.lean, k.vx);
  // settle back from wherever the last dive left him
  const f = Math.min(1, dt * 4.5);
  k.cur = k.cur.map((v, i) => v + (rdy[i] - v) * f);
  k.joints = solve(k.cur);
  k.plan = null;
  k.done = false;
}

export function keeperStartPlan(k: KeeperState, plan: Plan) {
  k.plan = plan;
  k.tk = 0;
  k.done = false;
}

/** advance a plan by dt and set his pose */
export function keeperRun(k: KeeperState, dt: number) {
  k.tk += dt;
  k.ph += dt;
  const p = k.plan;
  if (!p || k.done) return;
  if (k.tk < p.tc) {
    // still reading: shuffle on, watching the ball
    const goal = Math.sin(k.ph * 1.6) * 0.1;
    const prev = k.x;
    k.x += (goal - k.x) * Math.min(1, dt * 2);
    k.vx = (k.x - prev) / Math.max(dt, 1e-3);
    const rdy = readyPose(k.x, k.ph, k.lean, k.vx);
    k.cur = rdy;
    k.joints = solve(rdy);
    return;
  }
  if (!p.start) {
    p.start = k.cur;
    p.final = p.mode === "stand" ? bigPose(k.x) : divePose(k.x, p.P);
    p.x0 = k.x;
  }
  const u = clamp((k.tk - p.tc) / p.D, 0, 1);
  const e = {
    hip: easeOut(u),
    hands: easeOut3(clamp(u * 1.18, 0, 1)),
    feet: easeIO(u) * 0.85 + easeOut(u) * 0.15,
    th: easeOut(u),
  };
  let pose = lerpPose(p.start, p.final!, e);
  if (p.mode === "dive") {
    // a push-off: up before down
    const jump = (p.P.y > 1.7 ? 0.28 : 0.16) * Math.sin(Math.PI * u) * Math.min(1, Math.abs(p.P.x - p.x0) / 0.8 + 0.5);
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
