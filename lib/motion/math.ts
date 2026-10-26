import type { Vec3 } from "./types";

export const G = 9.80665;
export const DEG = Math.PI / 180;

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const unit = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n > 1e-12 ? scale(a, 1 / n) : [0, 0, 0];
};

/** Clamp a time step: samples arrive with jitter and the odd long gap. */
export const safeDt = (dt: number) => clamp(dt, 0.001, 0.1);

/** Exponential smoothing coefficient for a time constant tau (seconds). */
export const emaAlpha = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(tau, 1e-6));

export function wrapPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

// ---- quaternions [w, x, y, z]; a unit quaternion q rotates device -> world ----
export type Quat = [number, number, number, number];

export const qIdentity = (): Quat => [1, 0, 0, 0];

export function qMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Quaternion for a rotation vector (axis * angle), radians. */
export function qFromRotVec(r: Vec3): Quat {
  const ang = norm(r);
  if (ang < 1e-12) return [1, 0, 0, 0];
  const h = ang / 2;
  const s = Math.sin(h) / ang;
  return [Math.cos(h), r[0] * s, r[1] * s, r[2] * s];
}

/** Rotate a device-frame vector into the world frame. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  // v' = v + 2w(u x v) + 2 u x (u x v), u = (x,y,z)
  const u: Vec3 = [x, y, z];
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return [v[0] + 2 * (w * uv[0] + uuv[0]), v[1] + 2 * (w * uv[1] + uuv[1]), v[2] + 2 * (w * uv[2] + uuv[2])];
}

/** The world "up" axis expressed in device coordinates (third row of the rotation matrix). */
export function qUpInDevice(q: Quat): Vec3 {
  const [w, x, y, z] = q;
  return [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}

/** Swing-twist: signed rotation (radians, (-pi, pi]) of q about device axis 0|1|2. */
export function qTwist(q: Quat, axis: 0 | 1 | 2): number {
  return wrapPi(2 * Math.atan2(q[1 + axis], q[0]));
}

/** Dominant axis of sum(v v^T) by power iteration (sign arbitrary). */
export function dominantAxis(vs: readonly Vec3[], seed: Vec3): Vec3 {
  let a = unit(seed);
  if (norm(a) === 0) a = [1, 0, 0];
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const v of vs) {
    xx += v[0] * v[0]; xy += v[0] * v[1]; xz += v[0] * v[2];
    yy += v[1] * v[1]; yz += v[1] * v[2]; zz += v[2] * v[2];
  }
  for (let i = 0; i < 24; i++) {
    const b: Vec3 = [
      xx * a[0] + xy * a[1] + xz * a[2],
      xy * a[0] + yy * a[1] + yz * a[2],
      xz * a[0] + yz * a[1] + zz * a[2],
    ];
    const n = norm(b);
    if (n < 1e-12) break;
    a = scale(b, 1 / n);
  }
  return a;
}
