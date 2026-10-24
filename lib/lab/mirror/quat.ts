// Minimal quaternion maths for the mirror lab. Plain objects, no classes, so
// samples can cross a transport (BroadcastChannel / WebRTC) untouched.
//
// Convention: unit quaternion q = (x, y, z, w) rotating column vectors,
// right-handed. qMul(a, b) applies b first, then a (like matrix a * b).

export type Quat = { x: number; y: number; z: number; w: number };
export type Vec3 = { x: number; y: number; z: number };

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const qIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export function qMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export const qConj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const qNeg = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: -q.w });
export const qDot = (a: Quat, b: Quat): number => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (n < 1e-12) return qIdentity();
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** q and -q are the same rotation; return whichever is on a's side of the hypersphere. */
export const qSameHemisphere = (q: Quat, ref: Quat): Quat => (qDot(q, ref) < 0 ? qNeg(q) : q);

export function qFromAxisAngle(axis: Vec3, angle: number): Quat {
  const n = Math.hypot(axis.x, axis.y, axis.z);
  if (n < 1e-12) return qIdentity();
  const s = Math.sin(angle / 2) / n;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

/** Exponential map: rotation vector (axis * angle, radians) to quaternion. */
export function qExp(v: Vec3): Quat {
  const a = Math.hypot(v.x, v.y, v.z);
  if (a < 1e-9) return qNormalize({ x: v.x / 2, y: v.y / 2, z: v.z / 2, w: 1 });
  const s = Math.sin(a / 2) / a;
  return { x: v.x * s, y: v.y * s, z: v.z * s, w: Math.cos(a / 2) };
}

/** Log map: quaternion to rotation vector (radians), shortest way round (|v| <= pi). */
export function qLog(q: Quat): Vec3 {
  const p = q.w < 0 ? qNeg(q) : q;
  const s = Math.hypot(p.x, p.y, p.z);
  if (s < 1e-9) return { x: 2 * p.x, y: 2 * p.y, z: 2 * p.z };
  const angle = 2 * Math.atan2(s, p.w);
  const k = angle / s;
  return { x: p.x * k, y: p.y * k, z: p.z * k };
}

/** Smallest angle (radians, 0..pi) of the rotation q. */
export function qAngle(q: Quat): number {
  const s = Math.hypot(q.x, q.y, q.z);
  return 2 * Math.atan2(s, Math.abs(q.w));
}

/** Angle between two orientations, radians 0..pi. */
export const qAngleBetween = (a: Quat, b: Quat): number => qAngle(qMul(qConj(a), b));

export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  const bb = qSameHemisphere(b, a);
  let d = qDot(a, bb);
  if (d > 0.9995) {
    // nearly parallel: lerp + renormalise
    return qNormalize({
      x: a.x + (bb.x - a.x) * t,
      y: a.y + (bb.y - a.y) * t,
      z: a.z + (bb.z - a.z) * t,
      w: a.w + (bb.w - a.w) * t,
    });
  }
  d = Math.min(1, Math.max(-1, d));
  const theta = Math.acos(d);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return { x: a.x * wa + bb.x * wb, y: a.y * wa + bb.y * wb, z: a.z * wa + bb.z * wb, w: a.w * wa + bb.w * wb };
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  // v' = q * (v,0) * q^-1
  const p = qMul(qMul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), qConj(q));
  return { x: p.x, y: p.y, z: p.z };
}

/** 3x3 rotation matrix, row-major: [[r00 r01 r02] [r10 r11 r12] [r20 r21 r22]]. */
export function qToMatrix(q: Quat): number[][] {
  const { x, y, z, w } = qNormalize(q);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

/** Same rotation? (q and -q count as equal.) */
export const qEquivalent = (a: Quat, b: Quat, eps = 1e-6): boolean => 1 - Math.abs(qDot(qNormalize(a), qNormalize(b))) < eps;

// ---- W3C DeviceOrientation Euler angles ------------------------------------
// The spec's Tait-Bryan order is Z-X'-Y'': rotate alpha about Z, then beta
// about the new X, then gamma about the newest Y. The product Rz*Rx*Ry maps
// device coordinates to earth coordinates (x east, y north, z up).

export function qFromEulerZXY(alpha: number, beta: number, gamma: number): Quat {
  const qz = qFromAxisAngle({ x: 0, y: 0, z: 1 }, alpha);
  const qx = qFromAxisAngle({ x: 1, y: 0, z: 0 }, beta);
  const qy = qFromAxisAngle({ x: 0, y: 1, z: 0 }, gamma);
  return qNormalize(qMul(qMul(qz, qx), qy));
}

/**
 * Inverse of qFromEulerZXY, using the spec's ranges: alpha [0, 2pi),
 * beta [-pi, pi), gamma [-pi/2, pi/2). At beta = +-90 degrees (phone upright
 * or upside down) alpha and gamma are coupled and the split is arbitrary;
 * that is exactly the singularity the quaternion path avoids. This is used by
 * tests and by the Playwright sweep to produce what a real sensor would report.
 */
export function qToEulerZXY(q: Quat): { alpha: number; beta: number; gamma: number } {
  const r = qToMatrix(q);
  const gamma = Math.atan(-r[2][0] / (r[2][2] === 0 ? 1e-12 : r[2][2]));
  const cg = Math.cos(gamma);
  const cb = Math.abs(cg) < 1e-9 ? 0 : r[2][2] / cg;
  const beta = Math.atan2(r[2][1], cb);
  let alpha: number;
  let gammaOut = gamma;
  if (Math.abs(cb) < 1e-9) {
    // gimbal lock: only alpha +- gamma is defined; put it all in alpha
    gammaOut = 0;
    alpha = Math.atan2(r[1][0], r[0][0]);
  } else alpha = Math.atan2(-r[0][1] / cb, r[1][1] / cb);
  if (alpha < 0) alpha += 2 * Math.PI;
  return { alpha, beta, gamma: gammaOut };
}
