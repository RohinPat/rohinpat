import { G, cross, dot, norm, qFromRotVec, qMul, qNormalize, qRotate, qUpInDevice, safeDt, scale, unit } from "./math";
import type { Quat } from "./math";
import type { MotionSample, Vec3 } from "./types";

/**
 * Gyro + gravity complementary filter (Mahony style). Tracks the device
 * orientation relative to a gravity-aligned world frame (z up, heading
 * arbitrary: it drifts, which is fine for one-second gestures).
 *
 * The accelerometer only corrects tilt while its magnitude is close to 1 g,
 * so a flick or a swing does not drag the estimate sideways, and the gyro
 * carries the orientation through the motion.
 */
export class OrientationFilter {
  q: Quat = [1, 0, 0, 0];
  private lastT: number | null = null;
  private initialised = false;
  /** Gain (1/s) while the accelerometer looks like pure gravity. */
  kpQuiet = 2.0;
  /** Extra-fast gain for the first `warmupS` seconds, so the start-up tilt (taken from one noisy sample) converges quickly. */
  kpWarm = 8.0;
  warmupS = 0.5;
  private startT: number | null = null;
  /** Floor gain while it clearly does not, so gyro bias cannot run away. */
  kpMoving = 0.05;
  /** Width (m/s^2) of the Gaussian that fades the correction as |acc| leaves 1 g. */
  gate = 1.5;

  reset() {
    this.q = [1, 0, 0, 0];
    this.lastT = null;
    this.startT = null;
    this.initialised = false;
  }

  /** Feed a sample; read the state from the accessors. */
  update(s: MotionSample) {
    const accN = norm(s.acc);
    if (!this.initialised) {
      if (accN < 1) return;
      this.q = tiltQuat(unit(s.acc));
      this.initialised = true;
      this.lastT = s.t;
      this.startT = s.t;
      return;
    }
    const dt = safeDt(s.t - (this.lastT ?? s.t));
    this.lastT = s.t;
    const up = qUpInDevice(this.q);
    let w: Vec3 = s.gyro;
    if (accN > 1) {
      const m = scale(s.acc, 1 / accN);
      const dev = (accN - G) / this.gate;
      const warm = this.startT !== null && s.t - this.startT < this.warmupS;
      const kp = this.kpMoving + ((warm ? this.kpWarm : this.kpQuiet) - this.kpMoving) * Math.exp(-dev * dev);
      const c = cross(m, up);
      w = [w[0] + kp * c[0], w[1] + kp * c[1], w[2] + kp * c[2]];
    }
    this.q = qNormalize(qMul(this.q, qFromRotVec(scale(w, dt))));
  }

  /** World up in device coordinates (unit). */
  up(): Vec3 {
    return qUpInDevice(this.q);
  }

  toWorld(v: Vec3): Vec3 {
    return qRotate(this.q, v);
  }

  /** Linear acceleration (gravity removed) in the device frame. */
  linearDevice(s: MotionSample): Vec3 {
    if (s.lin) return s.lin;
    const up = this.up();
    return [s.acc[0] - G * up[0], s.acc[1] - G * up[1], s.acc[2] - G * up[2]];
  }

  /** Rate about the world vertical (rad/s, counter-clockwise seen from above). */
  yawRate(gyro: Vec3): number {
    return dot(gyro, this.up());
  }
}

/** Shortest rotation taking device-frame up (given) onto world z, as a device->world quaternion. */
function tiltQuat(upDev: Vec3): Quat {
  const z: Vec3 = [0, 0, 1];
  const c = dot(upDev, z);
  if (c < -0.999999) return [0, 1, 0, 0];
  const a = cross(upDev, z);
  return qNormalize([1 + c, a[0], a[1], a[2]]);
}
