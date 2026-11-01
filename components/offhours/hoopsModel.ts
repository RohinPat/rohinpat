// Hoops' physics and hoop motion, kept apart from the canvas so a test can fly
// thousands of shots. Metres, seconds; the camera and drawing stay in Hoops.tsx.

export const G = 9.8;
export const BALL = 0.12;
export const RIM_R = 0.23;
export const RIM_Y = 3.05;
export const HOOP_Z = 4.4;
export const BOARD_Z = HOOP_Z + 0.36;
export const START = { y: 1.0, z: 0.6 };
/** how much of a shot's aim and power error the assist takes out */
export const ASSIST = 0.55;
/** the keys (a charge meter and arrow taps) get less: sideways must be aimed, depth keeps some slack */
export const KEY_ASSIST = { x: 0.1, z: 0.3 };
/** keys: how fast Space charges, per second (1 is a perfect shot), and the aim step per tap, metres */
export const KEY_CHARGE = 1.8;
export const KEY_AIM_STEP = 0.08;

/** the hoop starts to slide at this score, and speeds up at the second */
export const HOOP_SLIDE_AT = 20;
export const HOOP_FAST_AT = 32;
export const HOOP_AMP = 0.7;

export type V3 = { x: number; y: number; z: number };
export type Hoop = { x: number; t: number };

export type Flight = {
  ball: V3;
  vel: V3;
  spin: number;
  rot: number;
  flyT: number;
  scored: boolean;
  touched: boolean;
  hitBoard: boolean;
  lastHit: number;
  /** where the ball was, against the rim's centre, when it first came down through rim height */
  cross: { dx: number; dz: number } | null;
};

export type FlightEvents = {
  /** the ball touched the rim, glass or floor; `loud` is false for a graze right after another touch */
  contact?: (kind: "rim" | "board" | "floor", speed: number, loud: boolean) => void;
  /** it came down through rim height, inside the rim or not */
  cross?: (dx: number, dz: number) => void;
  score?: (swish: boolean) => void;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const hoopRate = (score: number) => (score >= HOOP_FAST_AT ? 1.7 : 1.1);

/** One frame of the hoop: it eases to the middle until the slide starts, then swings side to side. */
export function stepHoop(h: Hoop, score: number, dt: number) {
  if (score >= HOOP_SLIDE_AT) {
    h.t += dt * hoopRate(score);
    h.x = Math.sin(h.t) * HOOP_AMP;
  } else h.x += (0 - h.x) * Math.min(1, dt * 3);
}

/** the hoop's sideways speed, metres per second */
export const hoopVx = (h: Hoop, score: number) => (score >= HOOP_SLIDE_AT ? Math.cos(h.t) * HOOP_AMP * hoopRate(score) : 0);

/** where the hoop will be `T` seconds from now */
export const hoopAfter = (h: Hoop, score: number, T: number) => (score >= HOOP_SLIDE_AT ? Math.sin(h.t + hoopRate(score) * T) * HOOP_AMP : h.x);

export function newFlight(ball: V3): Flight {
  return { ball, vel: { x: 0, y: 0, z: 0 }, spin: 0, rot: 0, flyT: 0, scored: false, touched: false, hitBoard: false, lastHit: -9, cross: null };
}

/**
 * The launch velocity for a shot: `aimX` is the world x the player went for
 * (power ~1 is perfect). The assist pulls a decent shot toward the rim; misses
 * still miss. It aims at where the hoop will be when the ball arrives, so a
 * shot at a sliding hoop is judged by how far it was from the hoop, not by
 * where the hoop was at release.
 */
export function launch(ball: V3, hoop: Hoop, score: number, aimX: number, power: number, opts: { assist?: number; assistX?: number; lead?: boolean } = {}) {
  const assist = opts.assist ?? ASSIST;
  const assistX = opts.assistX ?? assist;
  const T = 0.85 + 0.12 * Math.min(1.5, power);
  const errX = clamp(aimX - hoop.x, -1.4, 1.4) * (1 - assistX);
  const errZ = clamp((power - 1) * 1.4, -1.6, 1.6) * (1 - assist);
  const hx = opts.lead === false ? hoop.x : hoopAfter(hoop, score, T);
  const target = { x: hx + errX, y: RIM_Y + 0.08, z: HOOP_Z + errZ };
  return {
    T,
    errX,
    errZ,
    vel: { x: (target.x - ball.x) / T, y: (target.y - ball.y) / T + 0.5 * G * T, z: (target.z - ball.z) / T },
  };
}

/** Advance a ball in flight by dt: rim, glass, the hoop's net and the floor. */
export function stepFlight(f: Flight, hoopX: number, dt: number, t: number, ev: FlightEvents = {}) {
  f.flyT += dt;
  const b = f.ball, v = f.vel;
  const py = b.y;
  v.y -= G * dt;
  b.x += v.x * dt;
  b.y += v.y * dt;
  b.z += v.z * dt;
  f.rot += f.spin * dt;
  // rim: 24 points round the ring
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rx = hoopX + Math.cos(a) * RIM_R, rz = HOOP_Z + Math.sin(a) * RIM_R;
    const dx = b.x - rx, dy = b.y - RIM_Y, dz = b.z - rz;
    const d = Math.hypot(dx, dy, dz), min = BALL + 0.012;
    if (d < min && d > 0) {
      const nx = dx / d, ny = dy / d, nz = dz / d;
      b.x = rx + nx * min;
      b.y = RIM_Y + ny * min;
      b.z = rz + nz * min;
      const vn = v.x * nx + v.y * ny + v.z * nz;
      if (vn < 0) {
        v.x -= 1.55 * vn * nx;
        v.y -= 1.55 * vn * ny;
        v.z -= 1.55 * vn * nz;
        v.x *= 0.85;
        v.z *= 0.85;
        f.touched = true;
        ev.contact?.("rim", -vn, t - f.lastHit > 0.08);
        f.lastHit = t;
      }
    }
  }
  // glass
  if (b.z + BALL > BOARD_Z && v.z > 0 && Math.abs(b.x - hoopX) < 0.9 && b.y > 2.9 && b.y < 4.0) {
    b.z = BOARD_Z - BALL;
    ev.contact?.("board", v.z, true);
    v.z *= -0.55;
    f.touched = true;
    f.hitBoard = true;
  }
  // down through rim height
  if (py >= RIM_Y && b.y < RIM_Y && v.y < 0) {
    const dx = b.x - hoopX, dz = b.z - HOOP_Z;
    if (!f.cross) f.cross = { dx, dz };
    ev.cross?.(dx, dz);
    if (!f.scored && Math.hypot(dx, dz) < RIM_R - BALL * 0.35) {
      f.scored = true;
      ev.score?.(!f.touched);
      // slow the ball through the net
      v.x *= 0.3;
      v.z *= 0.3;
    }
  }
  // floor
  if (b.y < BALL) {
    b.y = BALL;
    if (Math.abs(v.y) > 1) ev.contact?.("floor", -v.y, true);
    v.y = -v.y * 0.62;
    v.x *= 0.8;
    v.z *= 0.8;
  }
}

/** how long after the first touch the next ball comes back, and after a make or a clear miss */
export const READY_AFTER_TOUCH = 0.5;
export const READY_AFTER_MAKE = 0.4;
/** a ball that comes down this far outside the rim is a clear miss and comes back at once */
export const CLEAR_MISS = RIM_R + BALL + 0.12;

/** Why a missed shot missed, from where it came down. */
export function missWhy(f: Flight): "SHORT" | "LONG" | "LEFT" | "RIGHT" {
  const c = f.cross;
  if (!c) return f.hitBoard || f.ball.z > HOOP_Z ? "LONG" : "SHORT";
  if (Math.abs(c.dx) > Math.abs(c.dz)) return c.dx < 0 ? "LEFT" : "RIGHT";
  // a ball that came off the glass came down short of the rim, but it was hit too hard
  if (f.hitBoard) return "LONG";
  return c.dz < 0 ? "SHORT" : "LONG";
}
