import { ENGINE_CAL } from "../engineRemote";
import { MARK_GAP_M, mark, newFx, puff, spark, type Fx } from "./fx";
import { headingAt, heightAt, pointAt, type Point, type Road } from "./road";
import type { Pose } from "./ghost";

// What the renderer draws, and the two things that turn a car's state into it:
// the chase camera (it sits behind the car on a heading that is partly the
// road's and partly the car's, so a drift swings the flank into view) and the
// particles the car throws (tyre smoke, rail sparks).

const CAM = ENGINE_CAL.cam;

export type RenderCar = {
  s: number;
  lat: number;
  psi: number;
  speed: number;
  slip: number;
  /** 0..1: how hard the tyres are working */
  skid: number;
  /** brake lights, 0..1; the pedal, 0..1 */
  brake: number;
  pedal: number;
  /** sideways acceleration, m/s^2 */
  ay: number;
  /** forward acceleration, m/s^2 (smoothed): the camera leans back on it */
  ax: number;
  /** an upshift just popped the exhaust, 1 -> 0 */
  pop: number;
  /** grinding along a rail now, and which */
  scrape: boolean;
  wallSide: -1 | 1;
};

export const newRenderCar = (): RenderCar => ({ s: 0, lat: 0, psi: 0, speed: 0, slip: 0, skid: 0, brake: 0, pedal: 0, ay: 0, ax: 0, pop: 0, scrape: false, wallSide: 1 });

export type Cam = {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** radians: positive looks up */
  pitch: number;
  /** horizontal field of view, rad */
  fov: number;
  /** pixels of shake, decays */
  shake: number;
  /** a punch of field of view (launch, a shift, a gate): 1 -> 0 */
  kick: number;
  /** how far the camera has leant back on the throttle (+) or forward on the brakes (-), m */
  lean: number;
  fresh: boolean;
};

export const newCam = (): Cam => ({ x: 0, y: 0, z: 0, heading: 0, pitch: 0, fov: (CAM.fovDeg * Math.PI) / 180, shake: 0, kick: 0, lean: 0, fresh: true });

export type GhostDraw = { pose: Pose; world: Point; /** 0 the target, 1 your best */ kind: 0 | 1; show: boolean; alpha: number };

export type Scene = {
  road: Road;
  cam: Cam;
  car: RenderCar;
  carWorld: Point;
  ghosts: GhostDraw[];
  fx: Fx;
  /** seconds, for animation */
  clock: number;
  /** checkpoints passed (the gates behind are drawn lit) */
  cp: number;
  reduce: boolean;
};

export function newScene(road: Road, reduce: boolean): Scene {
  return {
    road,
    cam: newCam(),
    car: newRenderCar(),
    carWorld: { x: 0, y: 0, z: 0, phi: 0 },
    ghosts: [
      { pose: { s: 0, lat: 0, psi: 0, speed: 0, slip: 0, skid: 0, brake: 0 }, world: { x: 0, y: 0, z: 0, phi: 0 }, kind: 0, show: false, alpha: 1 },
      { pose: { s: 0, lat: 0, psi: 0, speed: 0, slip: 0, skid: 0, brake: 0 }, world: { x: 0, y: 0, z: 0, phi: 0 }, kind: 1, show: false, alpha: 1 },
    ],
    fx: newFx(),
    clock: 0,
    cp: 0,
    reduce,
  };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Put the world point of a pose into `out` (the car's centre on the road). */
export function worldOf(road: Road, s: number, lat: number, out: Point): Point {
  return pointAt(road, s, lat, out);
}

/** Move the chase camera toward where it should be for the car in `scene.car`. */
export function stepCamera(sc: Scene, dt: number) {
  const { cam, car, road } = sc;
  const phi = headingAt(road, car.s);
  const ahead = headingAt(road, car.s + CAM.lookM);
  // the camera looks along the road a little ahead of the car, and toward the car's nose by the follow share
  const want = phi + clamp(car.psi, -0.9, 0.9) * CAM.yawFollow + (ahead - phi) * 0.3;
  if (cam.fresh) cam.heading = want;
  else cam.heading += (want - cam.heading) * (1 - Math.exp(-dt / CAM.yawSmoothS));
  const w = sc.carWorld;
  // the camera trails the car on the throttle and closes up on the brakes (the body's pitch, as a chase camera sees it)
  const leanWant = sc.reduce ? 0 : clamp(car.ax * CAM.leanPerMs2, -CAM.leanMaxM * 0.7, CAM.leanMaxM);
  cam.lean = cam.fresh ? leanWant : cam.lean + (leanWant - cam.lean) * (1 - Math.exp(-dt / 0.18));
  const back = CAM.backM + cam.lean;
  const targetX = w.x - Math.sin(cam.heading) * back;
  const targetZ = w.z - Math.cos(cam.heading) * back;
  const targetY = heightAt(road, car.s - CAM.backM * 0.9) + CAM.heightM;
  if (cam.fresh) {
    cam.x = targetX;
    cam.z = targetZ;
    cam.y = targetY;
  } else {
    // follow tightly: a chase camera that lags shows the car sliding off screen
    const k = 1 - Math.exp(-dt / 0.035);
    cam.x += (targetX - cam.x) * k;
    cam.z += (targetZ - cam.z) * k;
    cam.y += (targetY - cam.y) * (1 - Math.exp(-dt / 0.12));
  }
  // the horizon rides the slope ahead
  const rise = heightAt(road, car.s + CAM.lookM) - cam.y;
  const pitch = clamp(Math.atan2(rise, CAM.lookM) * 0.7, -0.2, 0.2);
  cam.pitch = cam.fresh ? pitch : cam.pitch + (pitch - cam.pitch) * (1 - Math.exp(-dt / 0.25));
  cam.kick = sc.reduce ? 0 : Math.max(0, cam.kick - dt * 2.4);
  cam.fov = ((CAM.fovDeg + CAM.fovSpeedDeg * clamp(car.speed / 60, 0, 1) + CAM.fovKickDeg * cam.kick) * Math.PI) / 180;
  cam.shake = Math.max(0, cam.shake - dt * 22);
  cam.fresh = false;
}

/** the rear tyres' contact patches in the car's frame: how far back of the centre, and how far to each side, m */
const REAR_M = 1.35;
const TRACK_M = 0.78;

/** A burst of tyre smoke from both rear wheels: the launch (the revs held against the brakes, then let go). */
export function launchSmoke(sc: Scene, strength: number) {
  const { fx, carWorld: w, car } = sc;
  const theta = w.phi + car.psi;
  const fx_ = Math.sin(theta);
  const fz_ = Math.cos(theta);
  const rx = Math.cos(theta);
  const rz = -Math.sin(theta);
  const n = Math.round(10 + 14 * strength);
  for (let i = 0; i < n; i++) {
    const side = i & 1 ? -TRACK_M : TRACK_M;
    puff(
      fx,
      w.x - fx_ * REAR_M + rx * side,
      w.y + 0.25,
      w.z - fz_ * REAR_M + rz * side,
      -fx_ * (1 + Math.random() * 2) + rx * side * (0.5 + Math.random()) + (Math.random() - 0.5) * 1.2,
      0.4 + Math.random() * 0.7,
      -fz_ * (1 + Math.random() * 2) + rz * side * (0.5 + Math.random()) + (Math.random() - 0.5) * 1.2,
      0.8 + Math.random() * 0.6,
      0.9 + Math.random() * 0.9,
    );
  }
}

/** Smoke and a dark line on the road from the rear tyres while they work, sparks while the rail is under the car. */
export function stepFxFromCar(sc: Scene, dt: number) {
  const { fx, car, carWorld: w } = sc;
  const theta = w.phi + car.psi;
  const fx_ = Math.sin(theta);
  const fz_ = Math.cos(theta);
  const rx = Math.cos(theta);
  const rz = -Math.sin(theta);
  const vel = w.phi + car.psi + car.slip;
  const vx = Math.sin(vel) * car.speed;
  const vz = Math.cos(vel) * car.speed;
  const working = car.skid > 0.45 && car.speed > 2.5;
  if (working && (car.speed > 7 || car.pedal > 0.6)) {
    fx.smokeAcc += dt * 60 * (car.skid - 0.35);
    while (fx.smokeAcc >= 1) {
      fx.smokeAcc -= 1;
      const side = Math.random() < 0.5 ? -TRACK_M : TRACK_M;
      puff(
        fx,
        w.x - fx_ * REAR_M + rx * side,
        w.y + 0.25,
        w.z - fz_ * REAR_M + rz * side,
        vx * 0.28 + (Math.random() - 0.5) * 1.6,
        0.3 + Math.random() * 0.6,
        vz * 0.28 + (Math.random() - 0.5) * 1.6,
        0.7 + Math.random() * 0.5,
        1.0 + Math.random() * 0.8,
      );
    }
  } else fx.smokeAcc = 0;
  // skid marks: a point every MARK_GAP_M of road while the tyres work; a gap in the work ends the line
  if (!sc.reduce) {
    const cps = Math.cos(car.psi);
    const sps = Math.sin(car.psi);
    const last = fx.markLastS;
    // sliding, or the launch's burnout (the first gear spins the tyres up to about 30 mph); not the whole run's wheelspin
    if (working && car.speed > 4 && (Math.abs(car.slip) > 0.1 || car.speed < 14)) {
      if (car.s - last >= MARK_GAP_M || car.s < last) {
        const dark = Math.min(1, 0.35 + car.skid * 0.65);
        for (let wh = 0; wh < 2; wh++) {
          const side = wh ? TRACK_M : -TRACK_M;
          mark(fx, wh, car.s - REAR_M * cps - side * sps, car.lat - REAR_M * sps + side * cps, dark);
        }
        fx.markLastS = car.s;
        fx.markDown = true;
      }
    } else if (fx.markDown) {
      // lifted: end both lines
      for (let wh = 0; wh < 2; wh++) mark(fx, wh, car.s, car.lat, 0);
      fx.markDown = false;
    }
  }
  if (car.scrape && car.speed > 4) {
    fx.sparkAcc += dt * 110;
    const side = car.wallSide;
    while (fx.sparkAcc >= 1) {
      fx.sparkAcc -= 1;
      spark(
        fx,
        w.x + rx * side * 1.0 - fx_ * (Math.random() * 3 - 0.5),
        w.y + 0.3 + Math.random() * 0.4,
        w.z + rz * side * 1.0 - fz_ * (Math.random() * 3 - 0.5),
        vx * 0.15 - rx * side * (1 + Math.random() * 3) + (Math.random() - 0.5) * 3,
        1 + Math.random() * 3,
        vz * 0.15 - rz * side * (1 + Math.random() * 3) + (Math.random() - 0.5) * 3,
        0.25 + Math.random() * 0.35,
      );
    }
  } else fx.sparkAcc = 0;
}
