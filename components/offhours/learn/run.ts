import type { NightInput } from "../engineRemote";
import { newCar, speedOf, stepCar, type Car } from "../night/car";
import { createRecorder, newPose, type Ghost } from "../night/ghost";
import type { Road } from "../night/road";
import { poseOf } from "../night/target";
import { forward, newHidden, type Genome } from "./net";
import { newSenses, sense } from "./sense";

// One learner's run: the net drives the same car the player has, on the same
// road, at the game's own fixed step (1/120 s). The net decides 30 times a
// second and holds its answer between decisions. The run ends at the first
// touch of a rail, when the car has not got further along the road for two
// seconds (stalled, or backing up), at the finish, or at the cap.

/** the game's step, and where it puts the car on the line */
export const STEP = 1 / 120;
export const START_S = 12;
/** the net decides every this many steps */
const DECIDE_EVERY = 4;
/** no new ground for this long ends the run, s */
const STALL_S = 2;
/** ground that counts as progress, m */
const PROGRESS_M = 0.5;
/** the run's cap, as a multiple of the target driver's time on the road */
export const CAP_SHARE = 1.4;
/** what a finish is worth over any run that does not, and per second under the cap */
export const FINISH_BASE = 2000;
export const FINISH_PER_S = 20;
/** metres per m/s of average speed, the bonus for being quick */
const SPEED_BONUS = 8;

export type Why = "rail" | "stall" | "cap" | "finish";

export type Outcome = {
  /** metres driven from the line, the average speed over the run (m/s), the run's length (s), and whether it reached the finish */
  dist: number;
  meanSpeed: number;
  time: number;
  finished: boolean;
  why: Why;
  fitness: number;
};

/** How good a run was. A finish beats any run that did not, and a quicker finish beats a slower; short of it, further beats shorter, with a little for the speed it was driven at. */
export function fitnessOf(o: { dist: number; meanSpeed: number; time: number; finished: boolean }, road: Road, capS: number): number {
  if (o.finished) return road.finish - START_S + FINISH_BASE + Math.max(0, capS - o.time) * FINISH_PER_S;
  return o.dist + SPEED_BONUS * o.meanSpeed;
}

export class Run {
  readonly car: Car = newCar(START_S, 0);
  t = 0;
  done = false;
  why: Why = "cap";
  private steps = 0;
  private bestS = START_S;
  private lastGain = 0;
  private sumV = 0;
  private readonly x = newSenses();
  private readonly hid = newHidden();
  private readonly inp: NightInput = { steer: 0, throttle: 0, brake: 0, hand: 0 };
  private readonly pose = newPose();
  private readonly rec: ReturnType<typeof createRecorder> | null;

  constructor(
    readonly genome: Genome,
    readonly road: Road,
    readonly capS: number,
    record = false,
  ) {
    this.rec = record ? createRecorder(capS + 2) : null;
  }

  /** Drive up to `maxSteps` steps; true when the run is over. */
  advance(maxSteps: number): boolean {
    const c = this.car;
    const road = this.road;
    for (let n = 0; n < maxSteps && !this.done; n++) {
      if (this.steps % DECIDE_EVERY === 0) forward(this.genome, sense(c, road, this.x), this.hid, this.inp);
      stepCar(c, this.inp, road, STEP);
      this.steps++;
      this.t = this.steps * STEP;
      this.sumV += speedOf(c);
      if (this.rec) this.rec.push(this.t, poseOf(c, this.pose));
      if (c.s >= road.finish) {
        this.end("finish");
      } else if (c.scrape) {
        this.end("rail");
      } else {
        if (c.s > this.bestS + PROGRESS_M) {
          this.bestS = c.s;
          this.lastGain = this.t;
        }
        if (this.t - this.lastGain > STALL_S) this.end("stall");
        else if (this.t >= this.capS) this.end("cap");
      }
    }
    return this.done;
  }

  private end(why: Why) {
    this.done = true;
    this.why = why;
  }

  outcome(): Outcome {
    const dist = Math.max(0, this.car.s - START_S);
    const meanSpeed = this.t > 0 ? this.sumV / this.steps : 0;
    const finished = this.why === "finish";
    const o = { dist, meanSpeed, time: this.t, finished };
    return { ...o, why: this.why, fitness: fitnessOf(o, this.road, this.capS) };
  }

  /** the run as a ghost (the same record the game keeps of a drive): only if it was made with `record` */
  ghost(): Ghost | null {
    return this.rec ? this.rec.snapshot(this.t, this.why === "finish") : null;
  }
}

/** Drive a genome to the end of its run. */
export function runGenome(genome: Genome, road: Road, capS: number, record = false): Run {
  const r = new Run(genome, road, capS, record);
  while (!r.advance(2400));
  return r;
}
