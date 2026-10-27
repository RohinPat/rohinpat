// Ghosts. A run is recorded as the car's pose twenty times a second (how far
// along the road, how far across it, the angle of the nose, speed, slide, how
// hard the tyres work, the brake) and played back by time: the same road, the same clock,
// so a ghost is exactly where that run was at that moment. Two ghosts exist:
// the target driver (the AI, recorded once) and your best run of this visit,
// which lives in memory only and is gone when the page is.

export const GHOST_HZ = 20;
/** numbers per sample */
export const GHOST_STRIDE = 7;
const STRIDE = GHOST_STRIDE;

export type Pose = { s: number; lat: number; psi: number; speed: number; slip: number; skid: number; brake: number };

export type Ghost = {
  /** samples; the sample k is at time k / GHOST_HZ */
  n: number;
  data: Float32Array;
  /** how far it got (m), how long it ran (s), and whether it reached the finish */
  dist: number;
  time: number;
  finished: boolean;
};

export const newPose = (): Pose => ({ s: 0, lat: 0, psi: 0, speed: 0, slip: 0, skid: 0, brake: 0 });

export function createRecorder(maxSeconds = 420) {
  const cap = Math.ceil(maxSeconds * GHOST_HZ);
  const data = new Float32Array(cap * STRIDE);
  let n = 0;
  return {
    reset() {
      n = 0;
    },
    /** call every step with the run clock; it keeps a sample whenever one is due */
    push(t: number, p: Pose) {
      if (n >= cap || t * GHOST_HZ < n - 1e-6) return;
      const o = n * STRIDE;
      data[o] = p.s;
      data[o + 1] = p.lat;
      data[o + 2] = p.psi;
      data[o + 3] = p.speed;
      data[o + 4] = p.slip;
      data[o + 5] = p.skid;
      data[o + 6] = p.brake;
      n++;
    },
    count: () => n,
    /** a copy of the run so far, for keeping */
    snapshot(time: number, finished: boolean): Ghost {
      const out = data.slice(0, n * STRIDE);
      return { n, data: out, dist: n ? out[(n - 1) * STRIDE] : 0, time, finished };
    },
  };
}

/** Where a ghost is at run time `t` (written into `out`; after its end it stays where it stopped). */
export function samplePose(g: Ghost, t: number, out: Pose): Pose {
  if (g.n === 0) return out;
  const x = Math.max(0, t * GHOST_HZ);
  const i = Math.min(g.n - 1, Math.floor(x));
  const j = Math.min(g.n - 1, i + 1);
  const f = i === j ? 0 : Math.min(1, x - i);
  const a = i * STRIDE;
  const b = j * STRIDE;
  const d = g.data;
  out.s = d[a] + (d[b] - d[a]) * f;
  out.lat = d[a + 1] + (d[b + 1] - d[a + 1]) * f;
  // the angle wraps: take the short way round
  let dp = d[b + 2] - d[a + 2];
  if (dp > Math.PI) dp -= 2 * Math.PI;
  else if (dp < -Math.PI) dp += 2 * Math.PI;
  out.psi = d[a + 2] + dp * f;
  out.speed = d[a + 3] + (d[b + 3] - d[a + 3]) * f;
  out.slip = d[a + 4] + (d[b + 4] - d[a + 4]) * f;
  out.skid = d[a + 5] + (d[b + 5] - d[a + 5]) * f;
  out.brake = d[a + 6] + (d[b + 6] - d[a + 6]) * f;
  return out;
}

/** The time at which a ghost was `s` metres along the road, or null if it never got there. */
export function timeAt(g: Ghost, s: number): number | null {
  if (g.n === 0 || g.data[(g.n - 1) * STRIDE] < s) return null;
  let lo = 0;
  let hi = g.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.data[mid * STRIDE] < s) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  const a = g.data[(lo - 1) * STRIDE];
  const b = g.data[lo * STRIDE];
  const f = b > a ? (s - a) / (b - a) : 0;
  return (lo - 1 + f) / GHOST_HZ;
}

/** Is `a` a better run than `b` (null = no run yet)? Finishing beats not; then the faster time; or, short of the finish, the further. */
export function better(a: Ghost, b: Ghost | null): boolean {
  if (!b) return true;
  if (a.finished !== b.finished) return a.finished;
  return a.finished ? a.time < b.time : a.dist > b.dist;
}
