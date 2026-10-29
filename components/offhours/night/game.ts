import { ENGINE_CAL, type NightInput, type NightView } from "../engineRemote";
import { engineRpm } from "../engineModel";
import { newCar, resetCar, shiftGear, speedOf, stepCar, type Car } from "./car";
import { clearFx, stepFx } from "./fx";
import { better, createRecorder, newPose, samplePose, timeAt, type Ghost } from "./ghost";
import { bankNow, loseDrift, newDrift, pending, stepDrift, type Drift } from "./score";
import { newScene, stepCamera, stepFxFromCar, type Scene } from "./scene";
import { getTarget, poseOf, type Target } from "./target";
import { planSpeed } from "./ai";
import { getRoad, pointAt } from "./road";

// The run. The phases: ready (the car on the line, waiting for the gas), count
// (3, 2, 1), run (the clock is going), done (the end screen). The run ends when
// the clock hits zero or the last gate is crossed, and the car coasts a moment
// first. Checkpoints add time; sliding earns drift points that bank when the
// car straightens (score.ts); a rail takes the unbanked points and some speed;
// a spin does too, and the car is righted over a moment, slower.
//
// The game owns the car and the clock; the page owns the keys, the phone and the
// sound, and hears what happened through `onEvent`. Everything is fixed-step
// (120 Hz) so the same inputs give the same run, and a ghost can be replayed.

const RUN = ENGINE_CAL.run;
const DRIFT = ENGINE_CAL.drift;
const STEP = 1 / 120;
const COUNT_STEP = 0.9;
const START_S = 12;

export type Phase = "ready" | "count" | "run" | "done";
export type Tone = "good" | "bad" | "info" | "drift";
export type Toast = { text: string; sub: string; tone: Tone; age: number; life: number };

export type GameEvent =
  | { kind: "count"; n: number }
  | { kind: "go" }
  | { kind: "checkpoint"; n: number; of: number; bonusS: number; timeLeft: number }
  | { kind: "hit"; speed: number }
  | { kind: "spin" }
  | { kind: "chain"; combo: number }
  | { kind: "bank"; points: number; combo: number }
  | { kind: "lost"; points: number }
  | { kind: "shift"; up: boolean }
  | { kind: "end"; result: Result };

export type Result = {
  finished: boolean;
  time: number;
  /** distance driven, in miles and metres */
  miles: number;
  metres: number;
  bestDrift: number;
  driftTotal: number;
  checkpoints: number;
  score: number;
  /** a new best run of this visit */
  newBest: boolean;
  /** the best score of this visit including this run, and the best before it (0 on the first run) */
  bestScore: number;
  prevBestScore: number;
  /** seconds behind (+) or ahead (-) of the target driver at the finish, or null if the run did not finish */
  vsTargetS: number | null;
};

/** The corner coming up faster than the car can take it: which way it turns (-1 left, 1 right) and how far off, m. */
export type CornerCue = { on: boolean; dir: -1 | 1; dist: number };

/** The best run of this visit: memory only, gone when the page is. */
let bestRun: Ghost | null = null;
let bestScore = 0;
export const getBestRun = () => bestRun;
export const getBestScore = () => bestScore;
export const forgetBestRun = () => {
  bestRun = null;
  bestScore = 0;
};

/** The corner warning looks this many seconds of road ahead, and lights when the car is over the plan's speed there by this much. */
const CUE_LEAD_S = 1.5;
const CUE_MARGIN = 1.03;

const MPH = 2.2369;
export const mph = (ms: number) => ms * MPH;
export const milesOf = (m: number) => m / 1609.34;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class NightGame {
  readonly target: Target = getTarget();
  readonly road = getRoad();
  readonly car: Car = newCar(START_S, 0);
  readonly scene: Scene;
  readonly rec = createRecorder();
  drift: Drift = newDrift();
  phase: Phase = "ready";
  phaseT = 0;
  /** seconds since GO */
  clock = 0;
  timeLeft = 0;
  cp = 0;
  /** counters the phone buzzes on */
  cpN = 0;
  hitN = 0;
  /** points banked so far outside the drift (checkpoints, the finish) */
  bonusPoints = 0;
  result: Result | null = null;
  toasts: Toast[] = [];
  /** the clock's last second flashes; the gate just passed lights up */
  cpFlash = 0;
  hitFlash = 0;
  bankFlash = 0;
  goFlash = 0;
  /** the run is ending: the car coasts for this long, why */
  endT = 0;
  endWhy: "time" | "finish" | null = null;
  /** seconds ahead (-) or behind (+) the target driver at this point of the road, and metres */
  deltaS = 0;
  gapM = 0;
  deltaOn = false;
  /** the corner warning: lit while the road ahead needs more braking than the car has room for */
  readonly cue: CornerCue = { on: false, dir: 1, dist: 0 };
  onEvent: (e: GameEvent) => void = () => {};

  private acc = 0;
  private spinT = 0;
  private recoverT = 0;
  private lastHitAt = -9;
  private lastCount = 4;
  private anim = 0;
  private pose = newPose();
  private finishAt = 0;
  private cueOn = 0;
  private cueOff = 0;

  constructor(reduce = false) {
    this.scene = newScene(this.road, reduce);
    this.scene.cam.fresh = true;
    this.syncScene(0);
    this.timeLeft = this.target.startS;
    this.car.auto = true;
  }

  get speed() {
    return speedOf(this.car);
  }

  /** the score on the board: banked drift points, checkpoints and the finish */
  get score() {
    return Math.round(this.drift.total + this.bonusPoints);
  }

  get count(): number {
    return this.phase === "count" ? Math.max(1, 3 - Math.floor(this.phaseT / COUNT_STEP)) : 0;
  }

  /** gas pressed on the ready or end screen: stage a fresh run */
  start() {
    if (this.phase === "ready" || (this.phase === "done" && this.phaseT > 0.7)) {
      this.reset();
      this.phase = "count";
      this.phaseT = 0;
      this.lastCount = 4;
    }
  }

  reset() {
    resetCar(this.car, START_S, 0);
    this.drift = newDrift();
    this.clock = 0;
    this.timeLeft = this.target.startS;
    this.cp = 0;
    this.bonusPoints = 0;
    this.result = null;
    this.toasts.length = 0;
    this.cpFlash = this.hitFlash = this.bankFlash = this.goFlash = 0;
    this.endT = 0;
    this.endWhy = null;
    this.spinT = 0;
    this.recoverT = 0;
    this.deltaOn = false;
    this.cue.on = false;
    this.cueOn = this.cueOff = 0;
    this.rec.reset();
    this.phase = "ready";
    this.phaseT = 0;
    clearFx(this.scene.fx);
    this.scene.cam.fresh = true;
  }

  setAuto(on: boolean) {
    this.car.auto = on;
  }

  shift(dir: 1 | -1) {
    if (this.phase !== "run" || this.car.auto) return;
    if (shiftGear(this.car, dir)) this.onEvent({ kind: "shift", up: dir > 0 });
  }

  toast(text: string, sub: string, tone: Tone, life = 1.6) {
    if (this.toasts.length >= 4) this.toasts.shift();
    this.toasts.push({ text, sub, tone, age: 0, life });
  }

  /** advance by a frame's time with these inputs */
  update(dt: number, inp: NightInput) {
    this.anim += dt;
    this.phaseT += dt;
    const c = this.car;
    this.acc += Math.min(dt, 0.05);
    let n = 0;
    while (this.acc >= STEP && n < 8) {
      this.step(inp);
      this.acc -= STEP;
      n++;
    }
    if (n === 8) this.acc = 0;

    // frame level: scoring, flashes, toasts
    if (this.phase === "run" && this.endWhy === null && this.recoverT <= 0) {
      const e = stepDrift(this.drift, c.slip, speedOf(c), dt);
      if (e.kind === "bank") {
        this.bankFlash = 1;
        this.toast(`+${e.points.toLocaleString("en-US")}`, e.combo > 1 ? `drift ×${e.combo}` : "drift", "drift", 1.5);
        this.onEvent({ kind: "bank", points: e.points, combo: e.combo });
      } else if (e.kind === "chain") {
        this.onEvent({ kind: "chain", combo: e.combo });
      }
    }
    if (this.phase === "run" && this.endWhy === null && this.recoverT <= 0) this.stepCue(dt);
    else {
      this.cue.on = false;
      this.cueOn = this.cueOff = 0;
    }
    this.cpFlash = Math.max(0, this.cpFlash - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
    this.bankFlash = Math.max(0, this.bankFlash - dt * 1.8);
    this.goFlash = Math.max(0, this.goFlash - dt);
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.age += dt;
      if (t.age >= t.life) this.toasts.splice(i, 1);
    }

    // the countdown beeps
    if (this.phase === "count") {
      const k = this.count;
      if (k !== this.lastCount) {
        this.lastCount = k;
        this.onEvent({ kind: "count", n: k });
      }
    }

    // ghosts and the scene
    this.syncScene(dt);
  }

  private step(inp: NightInput) {
    const c = this.car;
    if (this.phase === "ready" || this.phase === "count") {
      // on the line: the engine revs against the brakes
      c.pedal = clamp(inp.throttle, 0, 1);
      c.rpm = engineRpm(c.rpm, 0, 0, c.pedal, STEP, false);
      c.brake = 1;
      c.skid = 0;
      c.slip = 0;
      c.pop = Math.max(0, c.pop - STEP * 5);
      if (this.phase === "count" && this.phaseT >= COUNT_STEP * 3) this.go();
      return;
    }
    if (this.phase === "done") {
      stepCar(c, { steer: 0, throttle: 0, brake: 0.3, hand: 0 }, this.road, STEP);
      c.hit = 0;
      return;
    }

    // ---- run
    this.clock += STEP;
    const ending = this.endWhy !== null;
    let drive = inp;
    if (ending) drive = { steer: 0, throttle: 0, brake: 0.18, hand: 0 };
    if (this.recoverT > 0) this.recover(c);
    stepCar(c, drive, this.road, STEP);
    this.rec.push(this.clock, poseOf(c, this.pose));

    if (!ending) {
      if (this.clock > RUN.graceS) this.timeLeft -= STEP;
      // the gates
      if (c.s >= this.road.checks[this.cp]) this.gate();
      if (this.timeLeft <= 0 && this.endWhy === null) {
        this.timeLeft = 0;
        this.beginEnd("time");
      }
      // the rail
      if (c.hit > 0.6) {
        if (this.anim - this.lastHitAt > 0.3) this.wall(c.hit);
        this.lastHitAt = this.anim;
      }
      c.hit = 0;
      // a spin
      if (this.recoverT <= 0 && Math.abs(c.slip) > (DRIFT.spinAngleDeg * Math.PI) / 180 && c.u > 5) {
        this.spinT += STEP;
        if (this.spinT >= DRIFT.spinS) this.spin();
      } else if (this.recoverT <= 0) this.spinT = Math.max(0, this.spinT - STEP * 2);
    } else {
      this.endT -= STEP;
      c.hit = 0;
      if (this.endT <= 0 && this.phase === "run") this.finishRun();
    }
  }

  private go() {
    this.phase = "run";
    this.phaseT = 0;
    this.clock = 0;
    this.goFlash = 1.1;
    this.rec.reset();
    this.onEvent({ kind: "go" });
  }

  private gate() {
    const road = this.road;
    this.cp++;
    this.cpN++;
    this.bonusPoints += RUN.checkpointPoints;
    const last = this.cp >= road.checks.length;
    const add = last ? 0 : this.target.bonusS[this.cp - 1];
    this.timeLeft += add;
    this.cpFlash = 1.6;
    this.toast(last ? "FINISH" : `CHECKPOINT ${this.cp}/${road.checks.length}`, add ? `+${add.toFixed(1).replace(/\.0$/, "")} s` : `${Math.round(this.timeLeft)} s left`, "good", 2);
    this.onEvent({ kind: "checkpoint", n: this.cp, of: road.checks.length, bonusS: add, timeLeft: this.timeLeft });
    if (last) {
      this.finishAt = this.clock;
      this.bonusPoints += Math.round(this.timeLeft * RUN.finishSecondPoints);
      this.beginEnd("finish");
    }
  }

  private wall(speed: number) {
    this.hitN++;
    this.hitFlash = 1;
    this.scene.cam.shake = ENGINE_CAL.cam.shakeHitPx;
    const e = loseDrift(this.drift);
    if (e.kind === "lost") {
      this.toast("COMBO LOST", `−${e.points.toLocaleString("en-US")}`, "bad", 1.6);
      this.onEvent({ kind: "lost", points: e.points });
    }
    this.onEvent({ kind: "hit", speed });
  }

  private spin() {
    this.spinT = 0;
    this.recoverT = DRIFT.recoverS;
    this.hitN++;
    this.hitFlash = 1;
    this.scene.cam.shake = ENGINE_CAL.cam.shakeHitPx * 0.8;
    const e = loseDrift(this.drift);
    this.toast("SPIN OUT", e.kind === "lost" ? `−${e.points.toLocaleString("en-US")}` : "", "bad", 1.6);
    if (e.kind === "lost") this.onEvent({ kind: "lost", points: e.points });
    this.onEvent({ kind: "spin" });
  }

  /** after a spin the car is righted over a moment, and slowed */
  private recover(c: Car) {
    this.recoverT -= STEP;
    const travel = c.psi + c.slip;
    c.r = clamp((travel - c.psi) * 9, -4, 4);
    c.w *= Math.exp(-STEP * 6);
    const k = Math.exp((-STEP * Math.log(1 / DRIFT.recoverSpeed)) / DRIFT.recoverS);
    c.u *= k;
  }

  /**
   * The corner warning. The target driver's plan knows the fastest speed the tyres
   * allow at every point of the road, braked back from each corner. If the car is
   * going faster than the plan allows a short way ahead (a second and a bit of
   * road), a corner is coming that it will not make without braking now. It waits
   * a moment before lighting (a blip is not a warning) and a moment before going
   * out, and stays quiet while the car is deliberately sliding.
   */
  private stepCue(dt: number) {
    const c = this.car;
    const v = speedOf(c);
    const lead = CUE_LEAD_S * v + 10;
    const over = !this.drift.sliding && v > 14 && v > planSpeed(this.target.plan, this.road, c.s + lead) * CUE_MARGIN;
    const cue = this.cue;
    if (over) {
      this.cueOff = 0;
      this.cueOn += dt;
      if (this.cueOn > 0.12) {
        if (!cue.on) {
          // which way the worst of the bend ahead turns
          const seg = this.road.segM;
          let k = 0;
          for (let s = c.s + lead; s <= c.s + lead + 90; s += seg) {
            const kk = this.road.kappa[Math.min(this.road.n, Math.max(0, Math.round(s / seg)))];
            if (Math.abs(kk) > Math.abs(k)) k = kk;
          }
          cue.dir = k < 0 ? -1 : 1;
        }
        cue.on = true;
        cue.dist = lead;
      }
    } else {
      this.cueOn = 0;
      this.cueOff += dt;
      if (this.cueOff > 0.45) cue.on = false;
    }
  }

  private beginEnd(why: "time" | "finish") {
    this.endWhy = why;
    this.endT = RUN.coastS;
    const e = bankNow(this.drift);
    if (e.kind === "bank") this.toast(`+${e.points.toLocaleString("en-US")}`, "banked at the end", "drift", 1.5);
    this.toast(why === "time" ? "TIME" : "FINISH", why === "time" ? "out of time" : "you made it", why === "time" ? "bad" : "good", 2);
  }

  private finishRun() {
    const c = this.car;
    const finished = this.endWhy === "finish";
    const score = this.score;
    const run = this.rec.snapshot(finished ? this.finishAt : this.clock, finished);
    const newBest = better(run, bestRun);
    if (newBest) bestRun = run;
    const prevBestScore = bestScore;
    bestScore = Math.max(bestScore, score);
    this.result = {
      finished,
      time: run.time,
      metres: Math.max(0, c.s - START_S),
      miles: milesOf(Math.max(0, c.s - START_S)),
      bestDrift: this.drift.best,
      driftTotal: this.drift.total,
      checkpoints: this.cp,
      score,
      newBest,
      bestScore,
      prevBestScore,
      vsTargetS: finished ? run.time - this.target.ghost.time : null,
    };
    this.phase = "done";
    this.phaseT = 0;
    this.onEvent({ kind: "end", result: this.result });
  }

  /** copy the car and the ghosts into the scene the renderer reads */
  private syncScene(dt: number) {
    const sc = this.scene;
    const c = this.car;
    const r = sc.car;
    r.s = c.s;
    r.lat = c.lat;
    r.psi = c.psi;
    r.speed = speedOf(c);
    r.slip = c.slip;
    r.skid = this.phase === "run" || this.phase === "done" ? c.skid : 0;
    r.brake = this.phase === "ready" || this.phase === "count" ? 0.5 : c.brake;
    r.pedal = c.pedal;
    r.ay = c.ay;
    r.pop = c.pop;
    r.scrape = c.scrape && (this.phase === "run" || this.phase === "done");
    r.wallSide = c.wallSide;
    sc.clock = this.anim;
    sc.cp = this.cp;
    pointAt(this.road, c.s, c.lat, sc.carWorld);

    const t = this.phase === "run" || this.phase === "done" ? this.clock : 0;
    const tg = sc.ghosts[0];
    samplePose(this.target.ghost, t, tg.pose);
    tg.show = true;
    tg.alpha = 1;
    pointAt(this.road, tg.pose.s, tg.pose.lat, tg.world);
    const bg = sc.ghosts[1];
    const best = bestRun;
    bg.show = !!best;
    if (best) {
      samplePose(best, t, bg.pose);
      pointAt(this.road, bg.pose.s, bg.pose.lat, bg.world);
    }

    // against the target: time at this point of the road, and the gap
    if (this.phase === "run" && this.endWhy === null) {
      const tt = timeAt(this.target.ghost, c.s);
      this.deltaOn = tt !== null && c.s > START_S + 30;
      if (tt !== null) {
        this.deltaS = this.clock - tt;
        this.gapM = tg.pose.s - c.s;
      }
    }

    if (dt > 0) {
      stepFxFromCar(sc, dt);
      stepFx(sc.fx, dt);
      stepCamera(sc, dt);
    } else stepCamera(sc, 0.016);
  }

  /** what the phone is told */
  view(): NightView {
    const c = this.car;
    return {
      phase: this.phase,
      speed: mph(speedOf(c)),
      gear: c.gear,
      auto: c.auto,
      combo: this.drift.combo,
      pending: pending(this.drift),
      score: this.score,
      time: this.timeLeft,
      cp: this.cp,
      cps: this.road.checks.length,
      cpN: this.cpN,
      hitN: this.hitN,
      count: this.count,
      miles: this.result?.miles ?? milesOf(Math.max(0, c.s - START_S)),
      best: this.drift.best,
    };
  }
}
