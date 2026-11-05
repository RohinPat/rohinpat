import type { Ghost } from "../night/ghost";
import { getRoad, type Road } from "../night/road";
import { getTarget } from "../night/target";
import type { TrackId } from "../night/tracks";
import { Evolution } from "./evolve";
import type { Genome } from "./net";
import { CAP_SHARE, Run, runGenome, type Outcome } from "./run";

// One learning session, as a state machine that does its work in slices. The
// worker (learn.worker.ts) runs it off the page's thread; where there is no
// worker the page runs the same thing a few milliseconds a frame (link.ts).
// They talk by messages, so the page cannot tell which it has:
//
//   start {seed, track}   a new population from this seed         -> ready
//   step {gens, trace}    breed and drive this many generations   -> gen, one per generation
//   best                  the best car so far, driven again       -> best
//   stop                  drop what is queued and the session     -> stopped
//
// A `gen` message carries the generation's numbers and, when the step asked for
// a trace, every car's drive (best first) so the page can play them back. A
// generation is driven in full whether or not anyone watches: driving is
// deterministic, so the page replays what happened.

export type Req = { type: "start"; seed: number; track?: TrackId } | { type: "step"; gens: number; trace?: boolean } | { type: "best" } | { type: "stop" };

export type GenStat = {
  /** generations driven so far, this one included */
  gen: number;
  /** this generation: its best fitness and its mean, and its best car's distance (m), the time of the best finisher (s, null if none finished), and how many finished */
  best: number;
  mean: number;
  bestDist: number;
  bestTime: number | null;
  finishers: number;
  /** the mutation size the next generation will use */
  sigma: number;
};

/** the best car of the whole session so far */
export type Champion = { fitness: number; dist: number; finished: boolean; time: number; gen: number };

export type Res =
  | { type: "ready"; seed: number; capS: number; length: number; targetS: number; pop: number }
  | { type: "gen"; stat: GenStat; champion: Champion; improved: boolean; cars?: Ghost[]; /** with `cars`: for each, whether it is a new car (not an elite carried over unchanged), and why its run ended */ fresh?: boolean[]; reasons?: string[] }
  | { type: "best"; ghost: Ghost | null; champion: Champion | null }
  | { type: "stopped" };

/** steps a car is driven between looks at the clock (about 10 ms of work) */
const CHUNK = 1500;

type GenWork = { genomes: Genome[]; runs: Run[]; idx: number; trace: boolean };

export class Session {
  post: (res: Res, transfer?: Transferable[]) => void = () => {};
  private ev: Evolution | null = null;
  private road: Road | null = null;
  private capS = 0;
  private queue: Req[] = [];
  private job: { left: number; trace: boolean } | null = null;
  private work_: GenWork | null = null;
  private champ: Champion | null = null;
  private champGenome: Genome | null = null;

  /** Take a message. `start` and `stop` act at once (and drop anything queued); `step` and `best` wait their turn. */
  request(req: Req) {
    if (req.type === "start") {
      const track = req.track ?? "canyon";
      this.ev = new Evolution(req.seed);
      this.road = getRoad(track);
      const target = getTarget(track).ghost.time;
      this.capS = target * CAP_SHARE;
      this.queue = [];
      this.job = null;
      this.work_ = null;
      this.champ = null;
      this.champGenome = null;
      this.post({ type: "ready", seed: req.seed, capS: this.capS, length: this.road.finish, targetS: target, pop: this.ev.params.pop });
    } else if (req.type === "stop") {
      this.ev = null;
      this.queue = [];
      this.job = null;
      this.work_ = null;
      this.post({ type: "stopped" });
    } else if (this.ev) this.queue.push(req);
  }

  /** is there work waiting */
  get busy(): boolean {
    return !!this.ev && (this.job !== null || this.queue.length > 0);
  }

  /** Do work for about `budgetMs` milliseconds; true if there is more to do. */
  work(budgetMs: number): boolean {
    const t0 = performance.now();
    while (this.ev && this.road) {
      if (!this.job) {
        const next = this.queue.shift();
        if (!next) return false;
        if (next.type === "best") this.sendBest();
        else if (next.type === "step" && next.gens > 0) this.job = { left: Math.floor(next.gens), trace: !!next.trace };
        continue;
      }
      if (!this.work_) {
        const genomes = this.ev.pop.slice();
        // only the last generation of a step is wanted as a trace
        const trace = this.job.trace && this.job.left === 1;
        this.work_ = { genomes, runs: genomes.map((g) => new Run(g, this.road as Road, this.capS, trace)), idx: 0, trace };
      }
      const w = this.work_;
      if (w.runs[w.idx].advance(CHUNK)) {
        w.idx++;
        if (w.idx === w.runs.length) this.finishGen(w);
      }
      if (performance.now() - t0 >= budgetMs) break;
    }
    return this.busy;
  }

  private finishGen(w: GenWork) {
    const ev = this.ev as Evolution;
    const outs: Outcome[] = w.runs.map((r) => r.outcome());
    const fits = outs.map((o) => o.fitness);
    const first = ev.gen === 0;
    const order = ev.breed(fits);
    const top = outs[order[0]];
    let improved = false;
    if (!this.champ || top.fitness > this.champ.fitness) {
      improved = true;
      this.champ = { fitness: top.fitness, dist: top.dist, finished: top.finished, time: top.time, gen: ev.gen };
      this.champGenome = w.genomes[order[0]];
    }
    let sum = 0;
    let fin: Outcome | null = null;
    let finishers = 0;
    for (const o of outs) {
      sum += o.fitness;
      if (o.finished) {
        finishers++;
        if (!fin || o.time < fin.time) fin = o;
      }
    }
    const stat: GenStat = { gen: ev.gen, best: top.fitness, mean: sum / outs.length, bestDist: top.dist, bestTime: fin ? fin.time : null, finishers, sigma: ev.sigma };
    this.work_ = null;
    const job = this.job as { left: number; trace: boolean };
    job.left--;
    if (job.left <= 0) this.job = null;
    if (w.trace) {
      const cars = order.map((i) => w.runs[i].ghost() as Ghost);
      // the elite are the first few of the population and come through unchanged: only after the first generation are they not new
      const fresh = order.map((i) => first || i >= ev.params.elite);
      this.post({ type: "gen", stat, champion: this.champ as Champion, improved, cars, fresh, reasons: order.map((i) => outs[i].why) }, cars.map((g) => g.data.buffer));
    } else this.post({ type: "gen", stat, champion: this.champ as Champion, improved });
  }

  private sendBest() {
    if (!this.champGenome || !this.road) {
      this.post({ type: "best", ghost: null, champion: null });
      return;
    }
    const ghost = runGenome(this.champGenome, this.road, this.capS, true).ghost();
    this.post({ type: "best", ghost, champion: this.champ }, ghost ? [ghost.data.buffer] : []);
  }
}
