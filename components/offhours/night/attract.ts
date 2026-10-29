import { clearFx, stepFx } from "./fx";
import { GHOST_HZ, GHOST_STRIDE, newPose, samplePose, type Ghost } from "./ghost";
import { pointAt } from "./road";
import { newScene, stepCamera, stepFxFromCar, type Scene } from "./scene";
import { getTarget, type Target } from "./target";

// The tile's attract mode: the target driver, replayed from its recording,
// cruising the canyon with the same camera, the same smoke and the same
// picture as the game, and none of the cost of driving: no physics, no input,
// no sound. It loops a stretch of the road with the biggest slide in it (the
// opening straight and the tunnel say little to someone scrolling past), and
// starts already rolling. Under reduced motion it is one still frame, caught at
// the biggest slide.

const START_T = 6;
const LOOP_PAD = 1.5;
/** the loop starts this long before the biggest slide, and runs this long, s */
const LEAD_S = 11;
const LOOP_S = 34;

/** the moment of the widest slide in the first minute and a half, for a still frame */
export function widestSlide(g: Ghost): number {
  let best = START_T;
  let top = 0;
  const to = Math.min(g.n, Math.round(90 * GHOST_HZ));
  for (let i = Math.round(10 * GHOST_HZ); i < to; i++) {
    const slip = Math.abs(g.data[i * GHOST_STRIDE + 4]);
    if (slip > top && g.data[i * GHOST_STRIDE + 3] > 20) {
      top = slip;
      best = i / GHOST_HZ;
    }
  }
  return best;
}

/** where the tile's loop starts and ends in the target's recording, s */
export function attractWindow(g: Ghost): { from: number; to: number } {
  const from = Math.max(START_T, widestSlide(g) - LEAD_S);
  return { from, to: Math.min(g.time + LOOP_PAD, from + LOOP_S) };
}

export class Attract {
  readonly target: Target = getTarget();
  readonly scene: Scene;
  private win = attractWindow(this.target.ghost);
  t = this.win.from;
  private pose = newPose();

  constructor(reduce: boolean) {
    this.scene = newScene(this.target.road, reduce);
    if (reduce) this.t = widestSlide(this.target.ghost);
    this.place(0);
  }

  private place(dt: number) {
    const sc = this.scene;
    const p = samplePose(this.target.ghost, this.t, this.pose);
    const c = sc.car;
    c.s = p.s;
    c.lat = p.lat;
    c.psi = p.psi;
    c.speed = p.speed;
    c.slip = p.slip;
    c.skid = p.skid;
    c.brake = p.brake;
    c.pedal = p.brake > 0.05 ? 0 : 0.8;
    c.ay = -p.slip * p.speed * 0.6;
    c.pop = 0;
    c.scrape = false;
    pointAt(this.target.road, p.s, p.lat, sc.carWorld);
    sc.clock += dt;
    sc.cp = 0;
    for (const g of sc.ghosts) g.show = false;
    if (dt > 0) {
      stepFxFromCar(sc, dt);
      stepFx(sc.fx, dt);
      stepCamera(sc, dt);
    } else stepCamera(sc, 0.016);
  }

  /** move the clock on and put the car where the recording says */
  update(dt: number) {
    if (dt > 0) {
      this.t += dt;
      if (this.t > this.win.to) {
        this.t = this.win.from;
        this.scene.cam.fresh = true;
        clearFx(this.scene.fx);
      }
    }
    this.place(dt);
  }
}
