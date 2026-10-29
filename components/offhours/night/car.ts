import { ENGINE_CAL, type NightInput } from "../engineRemote";
import { IDLE, LIMIT, SHIFT_CUT_S, SHIFT_HOLD_S, TOP_GEAR, autoGear, engineRpm, tractiveForce } from "../engineModel";
import type { Road } from "./road";

// The car: a single-track ("bicycle") model with saturating tyres, which is
// what makes a drift a thing the car does rather than a thing the game
// scripts. Two axles, each with a cornering stiffness and a grip limit; a rear
// wheel drive with a friction circle (power takes grip from the sideways force:
// that is power oversteer); weight that moves forward under the brakes and
// back under the throttle (lifting or braking into a corner lightens the tail
// and it steps out); a handbrake that takes most of the rear's grip and gives
// the yaw a nudge toward the steering. The engine and gearbox are the shared
// ones (engineModel.ts).
//
// Arcade help, all tunable (ENGINE_CAL.car): speed-sensitive steering lock, and
// a counter-steer assist that turns the front wheels part of the way into a
// slide, so a drift is held rather than fought, while the car can still be
// thrown too far and spin.
//
// It runs in road coordinates: s along the road, lat across it (+ right), psi
// the angle of the nose to the road (+ right). The road turning under it is
// the only thing the road frame adds (psi shrinks and the car slides across by
// kappa * ds). Fixed steps, scalars only: nothing is allocated.

const P = ENGINE_CAL.car;
const G = 9.81;
const L = P.wheelbaseM;
const A = P.cgFrontM;
const B = L - A;
const N0F = (P.massKg * G * B) / L;
const N0R = (P.massKg * G * A) / L;

export type Car = {
  /** along the road (m), across it (m, + right), nose to the road (rad, + right) */
  s: number;
  lat: number;
  psi: number;
  /** body frame: forward speed, sideways speed (+ right), yaw rate (+ clockwise from above) */
  u: number;
  w: number;
  r: number;
  /** front wheel angle, rad */
  delta: number;
  gear: number;
  rpm: number;
  shiftT: number;
  holdT: number;
  auto: boolean;
  /** what the inputs were this step */
  pedal: number;
  brake: number;
  hand: number;
  handT: number;
  /** forward acceleration (m/s^2, smoothed): it moves the weight */
  ax: number;
  /** sideways acceleration, m/s^2 (for the camera lean and the sound) */
  ay: number;
  /** body slip: the angle of travel to the nose, rad (+ travelling right of the nose) */
  slip: number;
  /** how hard the tyres are working, 0..1 (smoke, squeal), and the share of the rear's grip in use */
  skid: number;
  rearSat: number;
  frontSat: number;
  /** wall: the biggest hit speed since this was last cleared (m/s), whether it is touching now, and which wall */
  hit: number;
  scrape: boolean;
  wallSide: -1 | 1;
  /** the rev limiter is cutting, and an upshift just popped the exhaust (1 -> 0) */
  limiter: boolean;
  pop: number;
  /** a gear change (+1 up, -1 down) happened since the game last looked, and the pedal was just lifted off high revs (the exhaust crackles); the game reads and clears them */
  shifted: 0 | 1 | -1;
  lift: boolean;
};

export function newCar(s = 0, lat = 0): Car {
  return {
    s, lat, psi: 0, u: 0, w: 0, r: 0, delta: 0, gear: 0, rpm: IDLE, shiftT: 0, holdT: 0, auto: true,
    pedal: 0, brake: 0, hand: 0, handT: 99, ax: 0, ay: 0, slip: 0, skid: 0, rearSat: 0, frontSat: 0, hit: 0, scrape: false, wallSide: 1, limiter: false, pop: 0, shifted: 0, lift: false,
  };
}

/** Put a car back on the line at rest (the game keeps one Car and reuses it). */
export function resetCar(c: Car, s = 0, lat = 0) {
  Object.assign(c, newCar(s, lat), { auto: c.auto });
}

/** Speed over the ground, m/s. */
export const speedOf = (c: Car) => Math.hypot(c.u, c.w);

/** The front wheel angle (rad) at full steering input at speed `v` (m/s): the lock closes with speed. */
export const lockAt = (v: number) => P.steerLockRad / (1 + (v / P.steerHalfMs) * (v / P.steerHalfMs));

/** The front wheel angle at full steering input for this car right now: the speed's lock, opened up when the car is sliding. */
export function lockOf(c: Car): number {
  const v = Math.hypot(c.u, c.w);
  const beta = Math.atan2(c.w, Math.max(c.u, 1));
  const base = lockAt(v);
  const room = clamp((Math.abs(beta) - 0.06) / 0.3, 0, 1);
  return base + (Math.max(P.steerSlideRad, base) - base) * room;
}

/** The part of the steering the road does for you: the wheel angle that follows the centre line's curve, scaled by the assist. */
export const roadSteer = (kap: number, u: number) => P.roadAssist * L * kap * clamp((u - 3) / 6, 0, 1);

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** A tyre: force (N, against the slip) from its slip angle, stiffness, and the most grip it has. */
function tyre(alpha: number, fmax: number): number {
  if (fmax <= 1) return 0;
  const x = (P.tyreStiffness * alpha) / fmax;
  const ax = Math.abs(x);
  const f = fmax * Math.tanh(x);
  // past the peak the tyre lets go a little
  const fall = ax > 1.8 ? P.fallOff * Math.min(1, (ax - 1.8) / 3) : 0;
  return -f * (1 - fall);
}

function shiftTo(c: Car, g: number) {
  if (g === c.gear) return;
  if (g > c.gear && c.pedal > 0.5) c.pop = 1;
  c.shifted = g > c.gear ? 1 : -1;
  c.gear = g;
  c.shiftT = SHIFT_CUT_S;
  c.holdT = SHIFT_HOLD_S;
}

/** A manual shift (+1 up, -1 down); false if it was not allowed. */
export function shiftGear(c: Car, dir: 1 | -1): boolean {
  const g = clamp(c.gear + dir, 0, TOP_GEAR);
  if (g === c.gear || c.shiftT > 0) return false;
  shiftTo(c, g);
  return true;
}

/**
 * Advance the car `dt` seconds (keep it at or under 1/90) on `road`. The
 * inputs: steer -1..1 (+ right), throttle and brake 0..1, hand (the
 * handbrake) 0..1.
 */
export function stepCar(c: Car, inp: NightInput, road: Road, dt: number) {
  const m = P.massKg;
  const u = Math.max(c.u, 0);
  const v = Math.hypot(c.u, c.w);
  const pedalNow = clamp(inp.throttle, 0, 1);
  // lifting off at high revs: the exhaust cracks (a flame and a pop for the game to show)
  if (c.pedal > 0.75 && pedalNow < 0.2 && c.rpm > 5200 && c.u > 10) {
    c.lift = true;
    c.pop = Math.max(c.pop, 0.75);
  }
  c.pedal = pedalNow;
  c.brake = clamp(inp.brake, 0, 1);
  const handNow = clamp(inp.hand, 0, 1);
  if (handNow > 0.5 && c.hand <= 0.5) c.handT = 0;
  else c.handT += dt;
  c.hand = handNow;
  c.shiftT = Math.max(0, c.shiftT - dt);
  c.holdT = Math.max(0, c.holdT - dt);
  c.pop = Math.max(0, c.pop - dt * 5);

  // ---- steering: the lock closes with speed, the wheels take a moment to turn; the road turns the wheel a share
  // of the way round its corner, and the assist counter-steers a slide
  const kap = curv(road, c.s);
  const beta = Math.atan2(c.w, Math.max(u, 1));
  // in a slide the wheels get more room to move: that is where you counter-steer
  const want = clamp(inp.steer, -1, 1) * lockOf(c);
  c.delta += clamp(want - c.delta, -P.steerRate * dt, P.steerRate * dt);
  const help = clamp(P.assist * Math.sign(beta) * Math.max(0, Math.abs(beta) - P.assistDeadRad), -P.assistMaxRad, P.assistMaxRad) * clamp((u - 4) / 8, 0, 1);
  const delta = clamp(c.delta + help + roadSteer(kap, u), -0.62, 0.62);

  // ---- the engine and the gearbox
  if (c.auto && c.shiftT <= 0 && c.holdT <= 0) {
    const g = autoGear(c.gear, c.rpm, c.pedal, c.brake > 0.3);
    if (g !== c.gear) shiftTo(c, g);
  }
  c.rpm = engineRpm(c.rpm, u, c.gear, c.pedal, dt, c.shiftT > 0);
  c.limiter = c.rpm >= LIMIT - 20 && c.pedal > 0.2;
  const cut = c.shiftT > 0 || c.limiter;
  const drive = cut ? 0 : tractiveForce(c.rpm, c.gear, c.pedal) * P.powerScale;

  // ---- weight: forward under the brakes, back under the throttle, and pressed down by the air
  const shift = clamp(((m * c.ax * P.cgHeightM) / L) * P.loadTransfer, -0.4 * N0R, 0.55 * N0F);
  const press = 1 + P.downforce * v * v;
  const nf = Math.max(0.3 * N0F, N0F - shift) * press;
  const nr = Math.max(0.3 * N0R, N0R + shift) * press;
  const mu = P.gripG;
  // the handbrake bites hard at speed and less at a crawl (it would spin a slow car on the spot)
  const hb = P.handbrakeGrip + (1 - P.handbrakeGrip) * clamp((35 - u) / 20, 0, 1);
  const muR = mu * P.rearGrip * (c.hand > 0.5 ? hb : 1);

  // ---- forces along the car
  const fb = P.brakeN * c.brake;
  const fbf = fb * P.brakeFront;
  const fbr = fb * (1 - P.brakeFront) + P.handbrakeN * c.hand * (u > 2 ? 1 : 0);
  const lim = 0.92 * muR * nr;
  const fxr = clamp(drive - fbr, -lim, lim);
  const drag = P.dragC * u * u + (u > 0.2 ? P.rollingN : 0);
  const fx = fxr - fbf - drag;

  // ---- the tyres
  const lowS = clamp(u / P.crawlMs, 0, 1);
  const ue = Math.max(u, 1.2);
  const alF = Math.atan2(c.w + A * c.r, ue) - delta;
  const alR = Math.atan2(c.w - B * c.r, ue);
  const fmaxF = Math.sqrt(Math.max(0, (mu * nf) ** 2 - fbf * fbf));
  const fxc = fxr * (fxr > 0 ? P.powerSlide : 1);
  const fmaxR = Math.sqrt(Math.max(0, (muR * nr) ** 2 - fxc * fxc));
  const fyf = tyre(alF, fmaxF) * lowS;
  const fyr = tyre(alR, fmaxR) * lowS;
  c.frontSat = fmaxF > 1 ? Math.min(1, Math.abs((P.tyreStiffness * alF) / fmaxF) / 2.2) : 0;
  c.rearSat = fmaxR > 1 ? Math.min(1, Math.abs((P.tyreStiffness * alR) / fmaxR) / 2.2) : 0;
  const spin = Math.abs(drive) > 0.82 * muR * nr && u < 30 ? Math.min(1, (Math.abs(drive) / (muR * nr) - 0.82) * 4) : 0;
  c.skid = Math.max(c.rearSat, c.frontSat * 0.8, spin * clamp(c.pedal, 0, 1), c.hand > 0.5 && u > 6 ? 0.7 : 0);

  // ---- the handbrake's nudge: it swings the tail the way the wheel is turned
  let kick = 0;
  if (c.hand > 0.5 && c.handT < 0.32 && u > 8) {
    const dir = Math.abs(inp.steer) > 0.08 ? Math.sign(inp.steer) : Math.abs(c.r) > 0.05 ? Math.sign(c.r) : 0;
    kick = P.handbrakeKick * dir * clamp(u / 16, 0, 1.6) * (1 - c.handT / 0.32);
  }

  // ---- integrate
  const cd = Math.cos(delta);
  const fy = fyf * cd + fyr;
  const du = fx / m + c.w * c.r;
  const dw = fy / m - u * c.r;
  // past a wide slide the nose is pulled back toward the way the car is going (the stability help's last resort)
  const over = Math.max(0, Math.abs(beta) - P.rescueRad);
  const rescue = Math.sign(beta) * P.rescueNm * over * clamp((u - 5) / 8, 0, 1);
  let dr = (A * fyf * cd - B * fyr + kick + rescue - P.yawDamp * c.r * lowS) / P.yawInertia;
  // the car cannot whip round faster than this: past it the yaw is eased back
  if (Math.abs(c.r) > P.yawCap) dr -= Math.sign(c.r) * (Math.abs(c.r) - P.yawCap) * 14;
  c.u += du * dt;
  c.w += dw * dt;
  c.r += dr * dt;
  if (c.u < 0) {
    c.u = 0;
    if (c.brake > 0.1 || c.pedal < 0.05) c.w *= Math.exp(-dt * 6);
  }
  if (u < P.crawlMs) {
    // a nearly stopped car rolls like a plain one: no tyre physics to speak of at a crawl
    const k = 1 - lowS;
    c.r += ((u * Math.tan(delta)) / L - c.r) * Math.min(1, dt * 10) * k;
    c.w *= Math.exp(-dt * 8 * k);
  }
  c.ay = (fy / m) * 1;
  c.ax += (fx / m - c.ax) * Math.min(1, dt * 10);
  c.slip = Math.atan2(c.w, Math.max(c.u, 0.5));

  // ---- onto the road: the road turns under the car
  const sp = Math.sin(c.psi);
  const cp = Math.cos(c.psi);
  const vT = c.u * cp - c.w * sp;
  const vN = c.u * sp + c.w * cp;
  const ds = vT / (1 - kap * c.lat);
  c.s += ds * dt;
  c.lat += vN * dt;
  c.psi += (c.r - kap * ds) * dt;
  if (c.psi > Math.PI) c.psi -= 2 * Math.PI;
  else if (c.psi < -Math.PI) c.psi += 2 * Math.PI;

  wall(c, road, dt);
}

function curv(r: Road, s: number): number {
  const u = Math.min(Math.max(s / r.segM, 0), r.n - 1e-6);
  const i = Math.floor(u);
  return r.kappa[i] + (r.kappa[i + 1] - r.kappa[i]) * (u - i);
}

/** The guardrail: the car is pushed back, loses speed in proportion to how square it hit, and is turned away. */
function wall(c: Car, road: Road, dt: number) {
  const sp = Math.sin(c.psi);
  const cp = Math.cos(c.psi);
  const extent = P.halfWidthM * Math.abs(cp) + P.halfLenM * Math.abs(sp);
  const over = Math.abs(c.lat) + extent - road.railHalf;
  if (over <= 0) {
    c.scrape = false;
    return;
  }
  const side = c.lat < 0 ? -1 : 1;
  c.wallSide = side;
  c.scrape = true;
  c.lat -= side * over;
  const vT = c.u * cp - c.w * sp;
  const vN = c.u * sp + c.w * cp;
  const into = vN * side;
  if (into > 0) {
    // bounce a little and lose some speed in proportion to how square it hit
    const e = 0.22;
    const nN = -e * vN;
    const nT = vT * (1 - clamp(0.012 * into, 0, 0.25));
    c.u = nT * cp + nN * sp;
    c.w = -nT * sp + nN * cp;
    // the nose is knocked away from the wall
    c.r -= side * Math.min(1.2, into * 0.07);
    if (into > c.hit) c.hit = into;
  }
  // and while it is grinding along the rail it keeps losing speed
  c.u = Math.max(0, c.u - P.scrapeDecel * dt * clamp(c.u / 20, 0.3, 1));
  c.u = Math.max(0, c.u);
}
