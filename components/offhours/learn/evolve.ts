import { seeded } from "../rng";
import { mutate, randomGenome, type Genome } from "./net";

// Neuroevolution. A population of nets is driven (run.ts) and scored; the best
// few go through unchanged (elitism, so the best never gets worse), and the rest
// are children: two parents are picked by tournament, a child takes each weight
// from one or the other, and is then nudged by a mutation whose size follows how
// the search is going (it shrinks while the best is still improving and grows
// when it has stalled). Everything random comes from one seeded generator, so a
// seed gives the same learning curve every time.

export type Params = {
  pop: number;
  elite: number;
  tournament: number;
  /** the share of children that mix two parents rather than copy one */
  mix: number;
  sigma: number;
  sigmaMin: number;
  sigmaMax: number;
  /** the chance each weight is nudged */
  rate: number;
  /** the mutation's size is scaled by these when the best improved, and when it did not */
  shrink: number;
  grow: number;
  /** fresh random nets in each generation (a few, for the first ones) */
  fresh: number;
};

export const PARAMS: Params = { pop: 24, elite: 3, tournament: 3, mix: 0.3, sigma: 0.3, sigmaMin: 0.05, sigmaMax: 0.5, rate: 0.2, shrink: 0.93, grow: 1.1, fresh: 0 };

export class Evolution {
  readonly rng: () => number;
  pop: Genome[];
  gen = 0;
  sigma: number;
  private bestFit = -Infinity;

  constructor(
    readonly seed: number,
    readonly params: Params = PARAMS,
  ) {
    this.rng = seeded(seed);
    this.sigma = params.sigma;
    this.pop = [];
    for (let i = 0; i < params.pop; i++) this.pop.push(randomGenome(this.rng));
  }

  private pick(order: number[]): number {
    // order is best-first: the lowest rank among a few random draws wins
    let best = order.length;
    for (let i = 0; i < this.params.tournament; i++) best = Math.min(best, Math.floor(this.rng() * order.length));
    return order[best];
  }

  /** Make the next generation from this one's scores (`fits[i]` is the fitness of `pop[i]`). Returns the population's indices best first. */
  breed(fits: number[]): number[] {
    const p = this.params;
    const order = fits.map((_, i) => i).sort((a, b) => fits[b] - fits[a] || a - b);
    const top = fits[order[0]];
    // the search is helped along while it improves, and shaken when it does not
    if (top > this.bestFit + 1e-9) this.sigma = Math.max(p.sigmaMin, this.sigma * p.shrink);
    else this.sigma = Math.min(p.sigmaMax, this.sigma * p.grow);
    this.bestFit = Math.max(this.bestFit, top);

    const next: Genome[] = [];
    for (let i = 0; i < p.elite; i++) next.push(this.pop[order[i]]);
    while (next.length < p.pop - p.fresh) {
      const a = this.pop[this.pick(order)];
      let base: Genome = a;
      if (this.rng() < p.mix) {
        const b = this.pop[this.pick(order)];
        base = Float64Array.from(a, (v, k) => (this.rng() < 0.5 ? v : b[k]));
      }
      next.push(mutate(base, this.sigma, p.rate, this.rng));
    }
    while (next.length < p.pop) next.push(randomGenome(this.rng));
    this.pop = next;
    this.gen++;
    return order;
  }
}
