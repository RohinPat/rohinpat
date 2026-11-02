import type { Ghost } from "../night/ghost";
import { newPose, samplePose, type Pose } from "../night/ghost";
import { clearFx, stepFx } from "../night/fx";
import { getRoad, pointAt, type Road } from "../night/road";
import { newScene, stepCamera, stepFxFromCar, type GhostDraw, type Scene } from "../night/scene";
import type { TrackId } from "../night/tracks";

// Playing a generation back. Every car's drive comes from the worker as a ghost
// (the same record the game keeps of a run), so this is the Night run's own
// renderer with nobody at the wheel: the camera follows the generation's best
// car, drawn as the main car, and the rest are translucent ghosts that fade a
// moment after their run ends. The Skip ahead view is the same thing with one
// car: the best so far, on a loop.

/** a car's ghost fades out over this long once its run is over, s */
const FADE_S = 0.9;
/**
 * A generation is over this long after its last new car stops. The elite are the same cars as last time, so they do not
 * keep it going: a generation whose children all crash in the first corner is a few seconds, however long the best
 * car's lap is. A new best car that drives on keeps it going until it stops. It is never longer than FOCUS_HOLD_S after
 * the best car stops, and never shorter than MIN_S (or the best car's run, if that is shorter).
 */
const HOLD_S = 0.8;
const FOCUS_HOLD_S = 3;
const MIN_S = 6;
/**
 * Watch plays the rest of a generation at FAST_RATE once only FAST_LEFT cars or fewer are still driving and it has run
 * FAST_AFTER_S. A display speed only: the cars' drives are not touched, only how fast the clock walks along them.
 */
const FAST_AFTER_S = 15;
const FAST_LEFT = 2;
export const FAST_RATE = 4;

export class Playback {
  readonly road: Road;
  readonly scene: Scene;
  cars: Ghost[] = [];
  /** which of the cars are new this generation (the rest are the elite, carried over) */
  private fresh: boolean[] = [];
  t = 0;
  /** the playback speed now: 1, or FAST_RATE */
  rate = 1;
  private pose = newPose();
  private lastSpeed = 0;
  private learners: GhostDraw[] = [];

  constructor(reduce: boolean, readonly size = 24, track: TrackId = "canyon") {
    this.road = getRoad(track);
    this.scene = newScene(this.road, reduce);
    // the Night run's own two ghosts are not used here
    for (const g of this.scene.ghosts) g.show = false;
    for (let i = 0; i < size; i++) {
      const g: GhostDraw = { pose: newPose(), world: { x: 0, y: 0, z: 0, phi: 0 }, kind: 2, show: false, alpha: 1 };
      this.learners.push(g);
      this.scene.ghosts.push(g);
    }
    this.place(0);
  }

  /** play these cars (best first) from `from` seconds in; `fresh` says which are new (default: all) */
  set(cars: Ghost[], from = 0, fresh: boolean[] = []) {
    this.cars = cars;
    this.fresh = fresh;
    this.t = from;
    this.scene.cam.fresh = true;
    clearFx(this.scene.fx);
    this.lastSpeed = 0;
    this.place(0);
  }

  /** the generation is over: its new cars have stopped */
  get over(): boolean {
    const cars = this.cars;
    if (cars.length === 0) return false;
    let last = 0;
    for (let i = 0; i < cars.length; i++) if (this.fresh[i] ?? true) last = Math.max(last, cars[i].time);
    const focusEnd = cars[0].time + FOCUS_HOLD_S;
    return this.t > Math.min(Math.max(last + HOLD_S, Math.min(focusEnd, MIN_S)), focusEnd);
  }

  /** how many cars are still driving */
  get driving(): number {
    let n = 0;
    for (const g of this.cars) if (this.t < g.time) n++;
    return n;
  }

  /** Move on `dt` seconds. With `allowFast` (Watch), the tail of a long generation goes by at FAST_RATE. */
  update(dt: number, allowFast = false) {
    const d = allowFast && this.t > FAST_AFTER_S && this.driving > 0 && this.driving <= FAST_LEFT ? dt * FAST_RATE : dt;
    this.rate = d > dt ? FAST_RATE : 1;
    this.t += d;
    this.place(d);
  }

  private place(dt: number) {
    const sc = this.scene;
    const road = this.road;
    const cars = this.cars;
    // the cars behind the best
    for (let i = 0; i < this.learners.length; i++) {
      const d = this.learners[i];
      const g = cars[i + 1];
      if (!g) {
        d.show = false;
        continue;
      }
      const gone = this.t - g.time;
      d.show = gone < FADE_S;
      if (!d.show) continue;
      d.alpha = gone > 0 ? 1 - gone / FADE_S : 1;
      samplePose(g, this.t, d.pose);
      pointAt(road, d.pose.s, d.pose.lat, d.world);
    }
    // the best car is the camera's
    const focus = cars[0];
    const c = sc.car;
    if (focus) {
      const p: Pose = samplePose(focus, this.t, this.pose);
      c.s = p.s;
      c.lat = p.lat;
      c.psi = p.psi;
      c.speed = p.speed;
      c.slip = p.slip;
      c.skid = p.skid;
      c.brake = p.brake;
      c.pedal = p.brake > 0.05 ? 0 : 0.8;
      c.ay = -p.slip * p.speed * 0.6;
      if (dt > 0) c.ax += ((p.speed - this.lastSpeed) / dt - c.ax) * Math.min(1, dt * 10);
      this.lastSpeed = p.speed;
      c.pop = 0;
      c.scrape = false;
    }
    pointAt(road, c.s, c.lat, sc.carWorld);
    sc.clock += dt;
    if (dt > 0) {
      stepFxFromCar(sc, dt);
      stepFx(sc.fx, dt);
      stepCamera(sc, dt);
    } else stepCamera(sc, 0.016);
  }
}
