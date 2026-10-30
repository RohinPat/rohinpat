import { ENGINE_CAL, type NightInput, type NightView } from "../engineRemote";
import { engineRpm } from "../engineModel";
import { newCar, resetCar, shiftGear, speedOf, stepCar, type Car } from "./car";
import { clearFx, stepFx } from "./fx";
import { better, createRecorder, newPose, samplePose, timeAt, type Ghost } from "./ghost";
import { bankNow, loseDrift, newDrift, pending, stepDrift, type Drift } from "./score";
import { launchSmoke, newScene, stepCamera, stepFxFromCar, type Scene } from "./scene";
import { medalsAt, nextMedal } from "./medals";
import { TRACKS, type Track, type TrackId } from "./tracks";
import { getTarget, poseOf, type Target } from "./target";
import { planSpeed } from "./ai";
import { assistSteer, newAssist, type AssistLevel } from "./assist";
import { curvatureAt, getRoad, pointAt, type Road } from "./road";

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

const DRIFT = ENGINE_CAL.drift;
const STEP = 1 / 120;
/** the countdown: a second apiece on a first run (it is also the time to read the screen), and half that on the runs after it, so a second try is under two seconds from the key to the road */
const COUNT_STEP = 0.9;
const COUNT_FAST = 0.5;
/** the dash's SHIFT after a good shift stays up this long, s */
const SHIFT_FLASH_S = 0.6;
const START_S = 12;

export type Phase = "ready" | "count" | "run" | "done";
export type Tone = "good" | "bad" | "info" | "drift";
/** where a toast is drawn: the middle of the road (what just happened), or by the drift panel (what a slide paid) */
export type Slot = "main" | "bank";
/** `age` below zero is a message waiting its turn; `held` is the time the corner warning has kept one off the screen */
export type Toast = { text: string; sub: string; tone: Tone; age: number; life: number; slot: Slot; held?: number };

/** a message is on screen at least this long before the next one takes its place, s */
const TOAST_MIN_S = 0.8;
/** a rail touch this long after the last one is a new incident, s */
const RAIL_GAP_S = 0.9;

export type GameEvent =
  | { kind: "count"; n: number }
  | { kind: "go"; rpm: number }
  | { kind: "checkpoint"; n: number; of: number; bonusS: number; timeLeft: number }
  | { kind: "hit"; speed: number }
  | { kind: "spin" }
  | { kind: "chain"; combo: number }
  | { kind: "bank"; points: number; combo: number }
  | { kind: "lost"; points: number }
  | { kind: "shift"; up: boolean; hard: boolean; /** a manual upshift in the green window: it pays */ good: boolean }
  | { kind: "kick" }
  | { kind: "backfire" }
  | { kind: "medal"; n: number }
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
  /** rail incidents (one contact: grinding along it is one), the seconds they took, spins, and the legs driven clean */
  rails: number;
  railS: number;
  spins: number;
  cleanLegs: number;
  score: number;
  /** a new best run of this visit */
  newBest: boolean;
  /** the best score of this visit including this run, and the best before it (0 on the first run) */
  bestScore: number;
  prevBestScore: number;
  /** seconds behind (+) or ahead (-) of the target driver at the finish, or null if the run did not finish */
  vsTargetS: number | null;
  /** medals this run earned (0 to 3), the most any run of this visit has, and the next one to go for from the visit's best (null at the top) */
  medals: number;
  bestMedals: number;
  next: { name: string; score: number } | null;
};

/** The corner coming up faster than the car can take it: which way it turns (-1 left, 1 right) and how far off, m. */
export type CornerCue = { on: boolean; dir: -1 | 1; dist: number };

/** The best run of this visit on each track: memory only, gone when the page is. */
const bestRuns: Partial<Record<TrackId, Ghost>> = {};
const bestScores: Partial<Record<TrackId, number>> = {};
/** runs finished this visit: the coach speaks on the first and not after */
let runsDone = 0;
export const getBestRun = (track: TrackId = "canyon") => bestRuns[track] ?? null;
export const getBestScore = (track: TrackId = "canyon") => bestScores[track] ?? 0;
export const forgetBestRun = () => {
  delete bestRuns.canyon;
  delete bestRuns.climb;
  delete bestScores.canyon;
  delete bestScores.climb;
  runsDone = 0;
  coached.clear();
};

/**
 * The corner warning looks this many seconds of road ahead (and a little more), and
 * lights when the car is over the plan's speed there by this much. The plan's speed
 * already allows for braking at 8.2 m/s^2, so the look-ahead has to be long: a driver
 * who floors it on the opening straight gets the first warning 0.4 s sooner than at
 * 1.5 s / 10 m (13.8 s into the run, not 14.2), and one at 80% of the plan's pace
 * still sees it under 2% of the run.
 */
const CUE = ENGINE_CAL.run.cue;

/** a first run is coached: the lines it is told, once each per visit, are kept here (memory only) */
const coached = new Set<string>();

const MPH = 2.2369;
export const mph = (ms: number) => ms * MPH;
export const milesOf = (m: number) => m / 1609.34;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class NightGame {
  /** the road being driven, its target driver and its picture: `setTrack` changes them */
  track: Track = TRACKS.canyon;
  /** the run's numbers on this track */
  get run() {
    return this.track.run;
  }
  target: Target = getTarget();
  road: Road = getRoad();
  readonly car: Car = newCar(START_S, 0);
  scene: Scene;
  readonly rec = createRecorder();
  drift: Drift = newDrift();
  phase: Phase = "ready";
  phaseT = 0;
  /** seconds a number of the countdown stays up */
  countStep = COUNT_STEP;
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
  /** the clock's last second flashes; the gate just passed lights up (and the seconds it added are shown for a moment) */
  cpFlash = 0;
  bonusShown = 0;
  bonusS = 0;
  /** rail incidents this run, the seconds they cost, spins, legs driven clean */
  rails = 0;
  railS = 0;
  spins = 0;
  cleanLegs = 0;
  /** the seconds the last rail incident took, and how long the clock shows it for */
  penaltyS = 0;
  penaltyShown = 0;
  hitFlash = 0;
  /** a shift in the green window has just paid: the dash says SHIFT for this long (s) */
  shiftFlash = 0;
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
  /** a line of help for a first run (a key the dash turns into words), and how long it has left on screen */
  coach = "";
  coachT = 0;
  /** this run has no best score before it: it is coached */
  firstRun = true;
  /** medals earned so far this run */
  medals = 0;
  /** the steering assist: 0 off, 1 light, 2 full (the page sets it; the phone held like a wheel runs with it off), and how much of it is on this moment (it fades while the car slides) */
  assist: AssistLevel = 0;
  readonly assistState = newAssist();
  private slideT = 0;
  onEvent: (e: GameEvent) => void = () => {};

  private acc = 0;
  private driven: NightInput = { steer: 0, throttle: 0, brake: 0, hand: 0 };
  private spinT = 0;
  private recoverT = 0;
  private lastHitAt = -9;
  private kicked = false;
  /** the rail was last touched at this time: a touch more than RAIL_GAP_S after that is a new incident (and costs time) */
  private lastContactAt = -9;
  /** the leg since the last gate has had no rail and no spin (a clean leg pays at the gate) */
  private legClean = true;
  /** the handbrake has been used this run (the first run is told what it is for until it has been) */
  private handUsed = false;
  private lastCount = 4;
  private anim = 0;
  private pose = newPose();
  private finishAt = 0;
  private cueOn = 0;
  private cueOff = 0;

  private readonly reduce: boolean;

  constructor(reduce = false, track: TrackId = "canyon") {
    this.reduce = reduce;
    this.scene = newScene(this.road, reduce);
    this.scene.cam.fresh = true;
    this.syncScene(0);
    this.timeLeft = this.target.startS;
    this.car.auto = true;
    if (track !== "canyon") this.setTrack(track);
  }

  /**
   * Take the car to another track: its road, its target driver, its medals and its best run. Only between runs (on the
   * ready screen or the end card): the run in hand is left alone. It comes back to the ready screen.
   */
  setTrack(id: TrackId): boolean {
    if (this.phase === "count" || this.phase === "run") return false;
    if (id === this.track.id) {
      if (this.phase === "done") this.reset();
      return true;
    }
    this.track = TRACKS[id];
    this.target = getTarget(id);
    this.road = getRoad(id);
    this.scene = newScene(this.road, this.reduce);
    this.reset();
    this.syncScene(0);
    return true;
  }

  get speed() {
    return speedOf(this.car);
  }

  /** the score on the board: banked drift points, checkpoints and the finish */
  get score() {
    return Math.round(this.drift.total + this.bonusPoints);
  }

  get count(): number {
    return this.phase === "count" ? Math.max(1, 3 - Math.floor(this.phaseT / this.countStep)) : 0;
  }

  /** gas pressed on the ready or end screen: stage a fresh run */
  start() {
    if (this.phase === "ready" || (this.phase === "done" && this.phaseT > 0.7)) {
      this.reset();
      this.firstRun = runsDone === 0;
      this.countStep = this.firstRun ? COUNT_STEP : COUNT_FAST;
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
    this.cpFlash = this.hitFlash = this.bankFlash = this.goFlash = this.shiftFlash = 0;
    this.bonusShown = 0;
    this.penaltyShown = 0;
    this.rails = this.railS = this.spins = this.cleanLegs = 0;
    this.legClean = true;
    this.handUsed = false;
    this.lastContactAt = -9;
    this.coach = "";
    this.coachT = 0;
    this.medals = 0;
    this.assistState.fade = 1;
    this.assistState.hold = 0;
    this.slideT = 0;
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
    // the car says it shifted (car.shifted), whoever asked: the page hears it with the automatic box's changes
    shiftGear(this.car, dir);
  }

  toast(text: string, sub: string, tone: Tone, life = 1.6, slot: Slot = "main") {
    if (slot === "bank") {
      // one by the drift panel: a new one replaces the one there
      this.toasts = this.toasts.filter((t) => t.slot !== "bank");
      this.toasts.push({ text, sub, tone, age: 0, life, slot });
      return;
    }
    // One message at a time in the middle of the road. A new one waits its turn behind the one showing (which keeps the
    // screen for a moment at least), and if another is already waiting the newest of them is the one kept.
    let showing: Toast | null = null;
    let waiting: Toast | null = null;
    for (const t of this.toasts) {
      if (t.slot !== "main") continue;
      if (t.age >= 0) showing = t;
      else waiting = t;
    }
    if (!showing) {
      this.toasts.push({ text, sub, tone, age: 0, life, slot });
      return;
    }
    showing.life = Math.min(showing.life, Math.max(showing.age, TOAST_MIN_S));
    const start = -Math.max(0, showing.life - showing.age);
    if (waiting) {
      Object.assign(waiting, { text, sub, tone, life, age: start });
    } else this.toasts.push({ text, sub, tone, age: start, life, slot });
  }

  /** a line of help for a first run, once per visit */
  private help(key: string, life = 4.2): boolean {
    if (!this.firstRun || coached.has(key)) return false;
    coached.add(key);
    this.coach = key;
    this.coachT = life;
    return true;
  }

  /** why the car hit the rail, for the line of help a first run gets: too fast for the bend, a slide that went wide, or steering off the line */
  private crashWhy(): string {
    const c = this.car;
    if (speedOf(c) > planSpeed(this.target.plan, this.road, c.s) * 1.08) return "wall-fast";
    if (Math.abs(c.slip) > 0.3) return "wall-slide";
    return "wall-line";
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
      const e = stepDrift(this.drift, c.slip, speedOf(c), dt, curvatureAt(this.road, c.s), this.track.driftPay);
      if (e.kind === "bank") {
        this.bankFlash = 1;
        this.toast(`+${e.points.toLocaleString("en-US")}`, e.combo > 1 ? `drift ×${e.combo}` : "drift", "drift", 1.6, "bank");
        this.scene.cam.kick = Math.max(this.scene.cam.kick, Math.min(0.5, 0.15 + e.combo * 0.06));
        this.onEvent({ kind: "bank", points: e.points, combo: e.combo });
      } else if (e.kind === "chain") {
        this.onEvent({ kind: "chain", combo: e.combo });
      }
    }
    if (this.phase === "run" && this.endWhy === null) this.stepHelp(dt);
    if (this.phase === "run" && this.endWhy === null && this.recoverT <= 0) this.stepCue(dt);
    else {
      this.cue.on = false;
      this.cueOn = this.cueOff = 0;
    }
    this.cpFlash = Math.max(0, this.cpFlash - dt);
    this.bonusShown = Math.max(0, this.bonusShown - dt);
    this.penaltyShown = Math.max(0, this.penaltyShown - dt);
    this.coachT = Math.max(0, this.coachT - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
    this.shiftFlash = Math.max(0, this.shiftFlash - dt);
    this.bankFlash = Math.max(0, this.bankFlash - dt * 1.8);
    this.goFlash = Math.max(0, this.goFlash - dt);
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      // the corner warning has the middle of the screen: what is on it waits (for a while at most)
      if (t.slot === "main" && this.cue.on && t.age >= 0 && (t.held ?? 0) < 1.2) {
        t.held = (t.held ?? 0) + dt;
        continue;
      }
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
      if (this.phase === "count" && this.phaseT >= this.countStep * 3) this.go();
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
    else {
      if (drive.hand > 0.5) this.handUsed = true;
      // the assist pulls the wheel toward the line (and lets go while the car slides)
      const d = this.driven;
      d.steer = assistSteer(this.assistState, this.assist, c, this.road, this.target.plan, inp, STEP);
      d.throttle = inp.throttle;
      d.brake = inp.brake;
      d.hand = inp.hand;
      drive = d;
    }
    if (this.recoverT > 0) this.recover(c);
    stepCar(c, drive, this.road, STEP);
    this.rec.push(this.clock, poseOf(c, this.pose));
    this.carEvents();

    if (!ending) {
      if (this.clock > this.run.graceS) this.timeLeft -= STEP;
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
      if (c.scrape || c.hit > 0) this.lastContactAt = this.anim;
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

  /** what the car did this step that the page shows and plays: a gear change, a crackle off the throttle */
  private carEvents() {
    const c = this.car;
    if (c.shifted !== 0) {
      const up = c.shifted > 0;
      const good = c.boostGood;
      this.onEvent({ kind: "shift", up, hard: up && c.pedal > 0.5, good });
      if (up && c.pedal > 0.5) this.scene.cam.kick = Math.max(this.scene.cam.kick, good ? 0.38 : 0.22);
      if (good) this.shiftFlash = SHIFT_FLASH_S;
      c.shifted = 0;
      c.boostGood = false;
    }
    if (c.kickT > 0 && c.kickK > 0 && !this.kicked) {
      this.kicked = true;
      this.onEvent({ kind: "kick" });
    } else if (c.kickT <= 0) this.kicked = false;
    if (c.lift) {
      c.lift = false;
      this.onEvent({ kind: "backfire" });
    }
  }

  private go() {
    this.phase = "run";
    this.phaseT = 0;
    this.clock = 0;
    this.goFlash = 1.1;
    this.rec.reset();
    // the launch: the revs that were held against the brakes go to the tyres (smoke, a punch of the lens)
    const held = Math.max(0, Math.min(1, (this.car.rpm - 2000) / 3500));
    launchSmoke(this.scene, held);
    this.scene.cam.kick = Math.max(this.scene.cam.kick, 0.35 + 0.65 * held);
    this.onEvent({ kind: "go", rpm: this.car.rpm });
  }

  private gate() {
    const road = this.road;
    this.cp++;
    this.cpN++;
    this.bonusPoints += this.run.checkpointPoints;
    // a leg with no rail and no spin pays more
    const clean = this.legClean;
    this.legClean = true;
    if (clean) {
      this.bonusPoints += this.run.cleanLegPoints;
      this.cleanLegs++;
    }
    const last = this.cp >= road.checks.length;
    const add = last ? 0 : this.target.bonusS[this.cp - 1];
    this.timeLeft += add;
    this.cpFlash = 1.6;
    this.bonusS = add;
    this.bonusShown = add > 0 ? 2.4 : 0;
    this.scene.cam.kick = Math.max(this.scene.cam.kick, 0.5);
    const cleanTxt = clean ? ` · CLEAN +${this.run.cleanLegPoints}` : "";
    this.toast(last ? "FINISH" : `CHECKPOINT ${this.cp} OF ${road.checks.length}`, (add ? `+${add.toFixed(1).replace(/\.0$/, "")} SECONDS` : `${Math.round(this.timeLeft)} s left`) + cleanTxt, "good", 2);
    this.onEvent({ kind: "checkpoint", n: this.cp, of: road.checks.length, bonusS: add, timeLeft: this.timeLeft });
    if (last) {
      this.finishAt = this.clock;
      this.bonusPoints += Math.round(this.timeLeft * this.run.finishSecondPoints);
      this.beginEnd("finish");
    }
  }

  private wall(speed: number) {
    this.hitN++;
    this.hitFlash = 1;
    this.scene.cam.shake = ENGINE_CAL.cam.shakeHitPx;
    // the first touch after a clear spell is an incident: it takes time off the clock and the leg is no longer clean. Grinding along the rail is the one incident
    const fresh = this.anim - this.lastContactAt > RAIL_GAP_S;
    const e = loseDrift(this.drift);
    if (fresh) {
      this.rails++;
      this.railS += this.run.railPenaltyS;
      this.legClean = false;
      this.timeLeft = Math.max(0, this.timeLeft - this.run.railPenaltyS);
      this.penaltyS = this.run.railPenaltyS;
      this.penaltyShown = 1.4;
      const lost = e.kind === "lost" && e.points >= 100 ? ` · COMBO −${e.points.toLocaleString("en-US")}` : "";
      this.toast("RAIL", `−${this.run.railPenaltyS.toFixed(1).replace(/\.0$/, "")} S${lost}`, "bad", 1.6);
    }
    if (e.kind === "lost") this.onEvent({ kind: "lost", points: e.points });
    if (!this.help(this.crashWhy())) this.help(e.kind === "lost" ? "wall-points" : "wall");
    this.onEvent({ kind: "hit", speed });
  }

  private spin() {
    this.spinT = 0;
    this.recoverT = DRIFT.recoverS;
    this.spins++;
    this.legClean = false;
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

  /** the medals as the score crosses them, and the lines of help a first run gets */
  private stepHelp(dt: number) {
    const m = medalsAt(this.score, this.track.medals);
    if (m > this.medals) {
      this.medals = m;
      const medal = this.track.medals[m - 1];
      this.toast(medal.name, `${medal.score.toLocaleString("en-US")} POINTS`, "good", 2.2);
      this.onEvent({ kind: "medal", n: m });
    }
    if (this.firstRun) {
      if (this.clock > 0.8 && this.clock < 1.2) this.help("steer", 5);
      // a corner is coming, the car is quick and has not slid: this is what the handbrake is for
      if (!this.handUsed && !this.drift.sliding && this.clock > 10 && speedOf(this.car) > 22 && Math.abs(curvatureAt(this.road, this.car.s + 40)) > 1 / 200) this.help("hand", 5);
      if (this.drift.sliding) {
        this.slideT += dt;
        if (this.slideT > 0.3) this.help("slide");
      } else this.slideT = 0;
    }
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
    const lead = CUE.leadS * v + CUE.leadM;
    const over = !this.drift.sliding && v > 14 && v > planSpeed(this.target.plan, this.road, c.s + lead) * CUE.margin;
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
    this.endT = this.run.coastS;
    const e = bankNow(this.drift);
    if (e.kind === "bank") this.toast(`+${e.points.toLocaleString("en-US")}`, "banked at the end", "drift", 1.5);
    this.toast(why === "time" ? "TIME" : "FINISH", why === "time" ? "out of time" : "you made it", why === "time" ? "bad" : "good", 2);
  }

  private finishRun() {
    const c = this.car;
    const finished = this.endWhy === "finish";
    const score = this.score;
    const run = this.rec.snapshot(finished ? this.finishAt : this.clock, finished);
    const id = this.track.id;
    const newBest = better(run, bestRuns[id] ?? null);
    if (newBest) bestRuns[id] = run;
    const prevBestScore = bestScores[id] ?? 0;
    const bestScore = Math.max(prevBestScore, score);
    bestScores[id] = bestScore;
    runsDone++;
    this.result = {
      finished,
      time: run.time,
      metres: Math.max(0, c.s - START_S),
      miles: milesOf(Math.max(0, c.s - START_S)),
      bestDrift: this.drift.best,
      driftTotal: this.drift.total,
      checkpoints: this.cp,
      rails: this.rails,
      railS: this.railS,
      spins: this.spins,
      cleanLegs: this.cleanLegs,
      score,
      newBest,
      bestScore,
      prevBestScore,
      vsTargetS: finished ? run.time - this.target.ghost.time : null,
      medals: medalsAt(score, this.track.medals),
      bestMedals: medalsAt(bestScore, this.track.medals),
      next: nextMedal(bestScore, this.track.medals),
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
    // the handbrake lights the tail lamps, as a real one does
    r.brake = this.phase === "ready" || this.phase === "count" ? 0.5 : Math.max(c.brake, c.hand > 0.5 ? 0.75 : 0);
    r.pedal = c.pedal;
    r.ay = c.ay;
    r.ax = c.ax;
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
    const best = bestRuns[this.track.id] ?? null;
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
