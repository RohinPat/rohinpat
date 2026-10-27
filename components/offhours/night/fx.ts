// Particles: tyre smoke and rail sparks, in fixed pools (struct-of-arrays) so a
// frame allocates nothing. World coordinates (x, z on the ground, y up). The
// renderer projects them with the same camera as the road.

export const SMOKE_N = 72;
export const SPARK_N = 64;

export type Fx = {
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
  svx: Float32Array;
  svy: Float32Array;
  svz: Float32Array;
  sage: Float32Array;
  slife: Float32Array;
  ssize: Float32Array;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  pvx: Float32Array;
  pvy: Float32Array;
  pvz: Float32Array;
  plife: Float32Array;
  smokeI: number;
  sparkI: number;
  smokeAcc: number;
  sparkAcc: number;
};

export function newFx(): Fx {
  const f = (n: number) => new Float32Array(n);
  return {
    sx: f(SMOKE_N), sy: f(SMOKE_N), sz: f(SMOKE_N), svx: f(SMOKE_N), svy: f(SMOKE_N), svz: f(SMOKE_N), sage: new Float32Array(SMOKE_N).fill(9), slife: f(SMOKE_N), ssize: f(SMOKE_N),
    px: f(SPARK_N), py: f(SPARK_N), pz: f(SPARK_N), pvx: f(SPARK_N), pvy: f(SPARK_N), pvz: f(SPARK_N), plife: f(SPARK_N),
    smokeI: 0, sparkI: 0, smokeAcc: 0, sparkAcc: 0,
  };
}

export function clearFx(fx: Fx) {
  fx.sage.fill(9);
  fx.plife.fill(0);
  fx.smokeAcc = fx.sparkAcc = 0;
}

export function puff(fx: Fx, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) {
  const i = fx.smokeI;
  fx.smokeI = (i + 1) % SMOKE_N;
  fx.sx[i] = x; fx.sy[i] = y; fx.sz[i] = z;
  fx.svx[i] = vx; fx.svy[i] = vy; fx.svz[i] = vz;
  fx.sage[i] = 0; fx.slife[i] = life; fx.ssize[i] = size;
}

export function spark(fx: Fx, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
  const i = fx.sparkI;
  fx.sparkI = (i + 1) % SPARK_N;
  fx.px[i] = x; fx.py[i] = y; fx.pz[i] = z;
  fx.pvx[i] = vx; fx.pvy[i] = vy; fx.pvz[i] = vz;
  fx.plife[i] = life;
}

export function stepFx(fx: Fx, dt: number) {
  for (let i = 0; i < SMOKE_N; i++) {
    if (fx.sage[i] >= fx.slife[i]) continue;
    fx.sage[i] += dt;
    const k = Math.exp(-dt * 1.6);
    fx.svx[i] *= k;
    fx.svz[i] *= k;
    fx.svy[i] = fx.svy[i] * k + 0.25 * dt;
    fx.sx[i] += fx.svx[i] * dt;
    fx.sy[i] += fx.svy[i] * dt;
    fx.sz[i] += fx.svz[i] * dt;
  }
  for (let i = 0; i < SPARK_N; i++) {
    if (fx.plife[i] <= 0) continue;
    fx.plife[i] -= dt;
    fx.pvy[i] -= 9 * dt;
    fx.px[i] += fx.pvx[i] * dt;
    fx.py[i] += fx.pvy[i] * dt;
    fx.pz[i] += fx.pvz[i] * dt;
  }
}
