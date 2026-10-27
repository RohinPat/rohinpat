import { ENGINE_CAL } from "../engineRemote";
import { seeded } from "../useCanvas";

// The canyon road: built once, from a seed, so every visitor drives the same
// road and the ghosts line up. The road is a centre line sampled every segM
// metres: its curvature (rad per metre, + turns right), the heading, the
// position on the ground (x right, z ahead at the start), and the height.
// Everything that drives on it works in road coordinates (s along it, lat
// across it, + right); the renderer turns those into world points with pointAt.
//
// A road is built from straights and corners: the corners ease in and out (a
// smooth ramp of curvature), they get tighter and more frequent as you go, and
// every checkpoint and the tunnel and the bridge sit on straight road. Hills
// are three smooth waves that fade out where the road must be flat.

const C = ENGINE_CAL.road;

/** per-segment flags */
export const TUNNEL = 1;
export const BRIDGE = 2;
/** a rock wall on this side (no wall: the ground falls away to the valley and its lights) */
export const ROCK_L = 4;
export const ROCK_R = 8;

export type Sign = { s: number; /** which side of the road it stands: -1 left, 1 right */ side: -1 | 1; /** which way the corner turns: -1 left, 1 right */ dir: -1 | 1 };

export type Road = {
  seed: number;
  /** segments, and the road's length in metres */
  n: number;
  length: number;
  segM: number;
  /** paved half-width and the guardrail's, m */
  half: number;
  railHalf: number;
  /** nodes 0..n */
  kappa: Float32Array;
  phi: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** segments 0..n-1 */
  flags: Uint8Array;
  signs: Sign[];
  /** the checkpoint gates, m along the road; the last is the finish */
  checks: number[];
  finish: number;
};

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

type Kind = "gentle" | "medium" | "tight" | "hairpin";
/** radius range (m) and the angle it turns through (deg) */
const KINDS: Record<Kind, { r: [number, number]; a: [number, number] }> = {
  gentle: { r: [230, 420], a: [22, 55] },
  medium: { r: [120, 230], a: [35, 85] },
  tight: { r: [70, 125], a: [55, 105] },
  hairpin: { r: [48, 68], a: [120, 165] },
};

/** which corner comes next, given how far along (0..1) the road is: it gets harder */
function pickKind(rng: () => number, progress: number): Kind {
  const r = rng();
  const hard = Math.min(1, progress * 1.25);
  if (progress < 0.1) return r < 0.55 ? "gentle" : "medium";
  if (r < 0.34 - 0.2 * hard) return "gentle";
  if (r < 0.7 - 0.18 * hard) return "medium";
  if (r < 0.94 - 0.1 * hard) return "tight";
  return "hairpin";
}

export function buildRoad(seed = C.seed): Road {
  const rng = seeded(seed);
  const seg = C.segM;
  const finish = C.checkpoints * C.checkEveryM;
  const length = finish + C.runOutM;
  const n = Math.ceil(length / seg);
  const kappa = new Float32Array(n + 1);

  // zones where the road must be straight: the start, each gate, and the tunnel and bridge
  const tunnelAt = C.checkEveryM * (2.35 + rng() * 0.3);
  const tunnelLen = 190;
  const bridgeAt = C.checkEveryM * (4.45 + rng() * 0.3);
  const bridgeLen = 150;
  const straights: [number, number][] = [[0, C.startStraightM], [tunnelAt - 50, tunnelAt + tunnelLen + 50], [bridgeAt - 50, bridgeAt + bridgeLen + 50]];
  for (let k = 1; k <= C.checkpoints; k++) straights.push([k * C.checkEveryM - 38, k * C.checkEveryM + 38]);
  straights.push([finish - 60, length]);
  const keep = (s: number) => {
    let m = 1;
    for (const [a, b] of straights) {
      if (s >= a && s <= b) return 0;
      const d = s < a ? a - s : s - b;
      if (d < 36) m = Math.min(m, smooth(d / 36));
    }
    return m;
  };

  // the corners
  let i = Math.round(C.startStraightM / seg);
  let dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
  while (i < n) {
    const straight = Math.round((50 + rng() * 150 * (1 - 0.5 * Math.min(1, (i * seg) / finish))) / seg);
    i += straight;
    const kind = pickKind(rng, (i * seg) / finish);
    const k = KINDS[kind];
    const radius = k.r[0] + rng() * (k.r[1] - k.r[0]);
    const angle = ((k.a[0] + rng() * (k.a[1] - k.a[0])) * Math.PI) / 180;
    const arcM = angle * radius;
    const ramp = Math.max(8, Math.min(Math.round(arcM / seg / 3), Math.round(90 / seg)));
    const len = Math.max(ramp * 2 + 2, Math.round(arcM / seg));
    if (rng() < 0.72) dir = (dir * -1) as 1 | -1;
    const peak = (1 / radius) * dir;
    for (let j = 0; j < len && i + j <= n; j++) {
      const e = Math.min(smooth(j / ramp), smooth((len - 1 - j) / ramp));
      kappa[i + j] += peak * e;
    }
    i += len;
  }
  for (let j = 0; j <= n; j++) kappa[j] *= keep(j * seg);

  // the heading and the position, integrated along it
  const phi = new Float32Array(n + 1);
  const x = new Float32Array(n + 1);
  const z = new Float32Array(n + 1);
  for (let j = 0; j < n; j++) {
    phi[j + 1] = phi[j] + 0.5 * (kappa[j] + kappa[j + 1]) * seg;
    const mid = 0.5 * (phi[j] + phi[j + 1]);
    x[j + 1] = x[j] + Math.sin(mid) * seg;
    z[j + 1] = z[j] + Math.cos(mid) * seg;
  }

  // the hills: three waves, read at a warped distance that stands still on the
  // straights that must be level (so the height holds, with no cliff at the edge)
  const p1 = rng() * 6.28, p2 = rng() * 6.28, p3 = rng() * 6.28;
  const y = new Float32Array(n + 1);
  const pace = (s: number) => {
    let m = smooth(s / 260);
    for (const [a, b] of [straights[1], straights[2]]) {
      if (s >= a && s <= b) return 0;
      const d = s < a ? a - s : s - b;
      if (d < 90) m = Math.min(m, smooth(d / 90));
    }
    return m;
  };
  let warped = 0;
  for (let j = 0; j <= n; j++) {
    warped += pace(j * seg) * seg;
    y[j] = 9 * Math.sin(warped / 430 + p1) + 5 * Math.sin(warped / 210 + p2) + 1.6 * Math.sin(warped / 95 + p3);
  }
  const y0 = y[0];
  for (let j = 0; j <= n; j++) y[j] -= y0;

  // the zones, then which side has a rock wall
  const flags = new Uint8Array(n);
  const mark = (a: number, len: number, f: number) => {
    for (let j = Math.floor(a / seg); j < Math.min(n, Math.ceil((a + len) / seg)); j++) flags[j] |= f;
  };
  mark(tunnelAt, tunnelLen, TUNNEL);
  mark(bridgeAt, bridgeLen, BRIDGE);
  for (let j = 0; j < n; ) {
    const len = 30 + Math.floor(rng() * 80);
    const r = rng();
    const f = r < 0.34 ? ROCK_L : r < 0.62 ? ROCK_R : r < 0.76 ? ROCK_L | ROCK_R : 0;
    for (let q = 0; q < len && j + q < n; q++) flags[j + q] |= f;
    j += len;
  }
  for (let j = 0; j < n; j++) if (flags[j] & (BRIDGE | TUNNEL)) flags[j] &= ~(ROCK_L | ROCK_R);

  // chevron boards on the outside of the corners that bite
  const signs: Sign[] = [];
  let j = 0;
  while (j < n) {
    if (Math.abs(kappa[j]) > 1 / 135) {
      const d = Math.sign(kappa[j]) as 1 | -1;
      let e = j;
      while (e < n && Math.abs(kappa[e]) > 1 / 135 && Math.sign(kappa[e]) === d) e++;
      const mid = (j + e) / 2;
      const span = Math.min(4, Math.max(2, Math.floor((e - j) / 6)));
      for (let q = 0; q < span; q++) signs.push({ s: (mid + (q - (span - 1) / 2) * 6) * seg, side: (-d) as -1 | 1, dir: d });
      j = e;
    } else j++;
  }

  const checks: number[] = [];
  for (let k = 1; k <= C.checkpoints; k++) checks.push(k * C.checkEveryM);

  return { seed, n, length, segM: seg, half: C.halfWidthM, railHalf: C.halfWidthM + C.railOffsetM, kappa, phi, x, y, z, flags, signs, checks, finish };
}

let cached: Road | null = null;
/** The one road (built on first use). */
export function getRoad(): Road {
  return (cached ??= buildRoad());
}

/** Curvature (rad/m) at `s` metres along the road. */
export function curvatureAt(r: Road, s: number): number {
  const u = Math.min(Math.max(s / r.segM, 0), r.n - 1e-6);
  const i = Math.floor(u);
  return r.kappa[i] + (r.kappa[i + 1] - r.kappa[i]) * (u - i);
}

/** Heading of the road at `s`, rad (clockwise from the start direction: the road turning right makes it grow). */
export function headingAt(r: Road, s: number): number {
  const u = Math.min(Math.max(s / r.segM, 0), r.n - 1e-6);
  const i = Math.floor(u);
  return r.phi[i] + (r.phi[i + 1] - r.phi[i]) * (u - i);
}

/** The height of the road at `s`, m. */
export function heightAt(r: Road, s: number): number {
  const u = Math.min(Math.max(s / r.segM, 0), r.n - 1e-6);
  const i = Math.floor(u);
  return r.y[i] + (r.y[i + 1] - r.y[i]) * (u - i);
}

/** The flags of the segment at `s`. */
export function flagsAt(r: Road, s: number): number {
  return r.flags[Math.min(Math.max(Math.floor(s / r.segM), 0), r.n - 1)];
}

export type Point = { x: number; y: number; z: number; /** the road's heading there, rad */ phi: number };

/** A world point `lat` metres right of the road's centre at `s` (written into `out`, so a frame allocates nothing). */
export function pointAt(r: Road, s: number, lat: number, out: Point): Point {
  const u = Math.min(Math.max(s / r.segM, 0), r.n - 1e-6);
  const i = Math.floor(u);
  const f = u - i;
  const phi = r.phi[i] + (r.phi[i + 1] - r.phi[i]) * f;
  out.x = r.x[i] + (r.x[i + 1] - r.x[i]) * f + lat * Math.cos(phi);
  out.z = r.z[i] + (r.z[i + 1] - r.z[i]) * f - lat * Math.sin(phi);
  out.y = r.y[i] + (r.y[i + 1] - r.y[i]) * f;
  out.phi = phi;
  return out;
}

/**
 * Project a world point into the camera: translate, then turn by the camera's
 * heading. `out.x` is right of the camera's axis, `out.z` ahead of it, `out.y`
 * above the camera. Pure, so it is unit-tested.
 */
export function toCamera(px: number, py: number, pz: number, camX: number, camY: number, camZ: number, heading: number, out: { x: number; y: number; z: number }) {
  const dx = px - camX;
  const dz = pz - camZ;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
  out.y = py - camY;
  return out;
}
