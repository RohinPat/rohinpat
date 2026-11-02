import type { NightInput } from "../engineRemote";

// The learner's brain: a net of fixed shape, nine inputs (sense.ts), one layer
// of tanh units, three outputs. Its weights are a flat array (the genome), so
// copying, mutating and posting one to a worker is a plain array operation.
//
// The outputs are what a driver's hands do: the wheel (-1..1), the gas and the
// brake (0..1, with a dead zone: a net that has not found the pedals yet sits
// at zero rather than at half). There is no handbrake: the learners keep to
// the three controls that matter on a road.

export const N_IN = 9;
export const N_HID = 10;
export const N_OUT = 3;
/** weights, hidden layer first (each unit: its inputs, then its bias), then the outputs the same way */
export const N_W = N_HID * (N_IN + 1) + N_OUT * (N_HID + 1);

export type Genome = Float64Array;

/** a scratch buffer for the hidden layer, so a pass allocates nothing */
export const newHidden = () => new Float64Array(N_HID);

/** the net's answer to `x` (N_IN numbers) written into `out`: steer, throttle, brake; hand is left at 0 */
export function forward(w: ArrayLike<number>, x: ArrayLike<number>, hid: Float64Array, out: NightInput): NightInput {
  for (let j = 0; j < N_HID; j++) {
    const b = j * (N_IN + 1);
    let a = w[b + N_IN];
    for (let i = 0; i < N_IN; i++) a += w[b + i] * x[i];
    hid[j] = Math.tanh(a);
  }
  const o = N_HID * (N_IN + 1);
  const k = N_HID + 1;
  let a0 = w[o + N_HID];
  let a1 = w[o + k + N_HID];
  let a2 = w[o + 2 * k + N_HID];
  for (let j = 0; j < N_HID; j++) {
    const h = hid[j];
    a0 += w[o + j] * h;
    a1 += w[o + k + j] * h;
    a2 += w[o + 2 * k + j] * h;
  }
  out.steer = Math.tanh(a0);
  out.throttle = Math.max(0, Math.tanh(a1));
  out.brake = Math.max(0, Math.tanh(a2));
  out.hand = 0;
  return out;
}

/** a standard normal from two uniforms (Box-Muller), so a seeded generator gives the same weights everywhere */
export function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** a fresh net: small random weights, and a bias that leans on the gas so a first car at least rolls */
export function randomGenome(rng: () => number, spread = 0.6, gasBias = 0.4): Genome {
  const w = new Float64Array(N_W);
  for (let i = 0; i < N_W; i++) w[i] = gauss(rng) * spread;
  w[N_HID * (N_IN + 1) + N_HID + (N_HID + 1)] += gasBias;
  return w;
}

/** a child of `parent`: each weight is moved by a normal step of size `sigma` with chance `rate` (at least one always moves) */
export function mutate(parent: ArrayLike<number>, sigma: number, rate: number, rng: () => number): Genome {
  const w = Float64Array.from(parent);
  let moved = 0;
  for (let i = 0; i < N_W; i++) {
    if (rng() < rate) {
      w[i] += gauss(rng) * sigma;
      moved++;
    }
  }
  if (moved === 0) w[Math.floor(rng() * N_W)] += gauss(rng) * sigma;
  return w;
}
