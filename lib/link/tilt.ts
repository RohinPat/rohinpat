import type { Orient } from "./session";
import { SampleClock } from "./clock";
import { OrientationPipeline } from "./orient/pipeline";
import { DEG } from "./orient/quat";
import { toMatrix3d } from "./orient/orientation";

// The phone's tilt becomes a transform for the whole device on the home page.
// The same pipeline the lab proved (quaternion -> calibrate -> one-euro ->
// capped prediction -> swing/twist clamp), with a gentler clamp: the device is
// big, and the page around it should still read.

export const HOME_CLAMP = { maxTilt: 26 * DEG, maxRoll: 9 * DEG };
export const PERSPECTIVE_PX = 2200;

export class TiltDriver {
  readonly pipeline = new OrientationPipeline({ clamp: HOME_CLAMP });
  private clock = new SampleClock();

  get calibrated(): boolean {
    return this.pipeline.calibrated;
  }

  /** a new connection: forget the old neutral */
  reset(nowMs: number): void {
    this.clock.reset();
    this.pipeline.reset(nowMs);
  }

  recentre(nowMs: number): void {
    this.pipeline.recalibrate(nowMs);
  }

  /** `arrivalMs`: performance.now() on this device when the sample arrived */
  push(o: Orient, arrivalMs: number): void {
    const t = this.clock.place(o.t, arrivalMs);
    this.pipeline.push({ alpha: o.alpha, beta: o.beta, gamma: o.gamma, screenAngle: o.screenAngle }, t);
  }

  /** the CSS transform to draw at nowMs; call once a frame */
  css(nowMs: number): string {
    return `perspective(${PERSPECTIVE_PX}px) ${toMatrix3d(this.pipeline.pose(nowMs).q)}`;
  }
}
