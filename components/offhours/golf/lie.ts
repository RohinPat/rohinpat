import { CLUBS, type Lie, type Shot, type Surface } from "./flight";

// How the ball lies, in one table, and what happens when it ends somewhere it
// should not. The table is multipliers on the swing (flight.ts applies them);
// water, the woods and gorse cost a stroke and a drop, and out of bounds a stroke and the shot again.

/** the sand wedge's index in CLUBS */
const SAND_WEDGE = 5;

/** what the ground under the ball does to a swing with this club (undefined: nothing) */
export function lieFor(surface: Surface, club: number): Lie | undefined {
  switch (surface) {
    case "rough":
      // grass in the face: slower, little check, a poorer strike, and the face wanders a little
      return { speed: 0.88, spin: 0.55, contactCap: 0.85, faceNoise: 0.1 };
    case "bunker":
      return club === SAND_WEDGE ? { speed: 0.8, contactCap: 0.9 } : { speed: 0.5, contactCap: 0.6, launch: 0.6 };
    case "fescue":
      // long wispy grass round the club and the ball: worse than the rough
      return { speed: 0.78, spin: 0.4, contactCap: 0.75, faceNoise: 0.14 };
    case "waste":
      // firm sand and scrub, any club will do: the ball sits a little uneven, so a poorer strike but little else
      return { speed: 0.8, spin: 0.7, contactCap: 0.8, faceNoise: 0.06 };
    case "fringe":
      return { speed: 0.95 };
    default:
      return undefined;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** a slope under the ball smaller than this (rise per metre) is played as flat */
export const SLOPE_FLAT = 0.025;

/**
 * The ground under the ball tilted, for a shot along `yaw`: up the line of the shot adds loft (higher and shorter), down
 * it takes loft away; across it, a ball above the golfer's feet starts left and one below them right. (The golfer stands
 * to the left of the ball, looking down the line.) `sx` and `sz` are the ground's rise per metre to +x and +z.
 */
export function slopeLie(sx: number, sz: number, yaw: number, club: number): Lie | undefined {
  const up = sx * Math.sin(yaw) + sz * Math.cos(yaw);
  const side = sx * Math.cos(yaw) - sz * Math.sin(yaw);
  if (Math.abs(up) < SLOPE_FLAT && Math.abs(side) < SLOPE_FLAT) return undefined;
  const deg = (Math.atan(up) * 180) / Math.PI;
  return { launch: clamp(1 + deg / CLUBS[club].launch, 0.6, 1.6), face: clamp(-side * 9, -0.6, 0.6) };
}

/** two lies at once (sand on a slope): the multipliers multiply, the caps and wanders take the worse, the pushes add */
export function bothLies(a: Lie | undefined, b: Lie | undefined): Lie | undefined {
  if (!a) return b;
  if (!b) return a;
  const cap = Math.min(a.contactCap ?? 1, b.contactCap ?? 1);
  return {
    speed: (a.speed ?? 1) * (b.speed ?? 1),
    spin: (a.spin ?? 1) * (b.spin ?? 1),
    launch: (a.launch ?? 1) * (b.launch ?? 1),
    contactCap: cap < 1 ? cap : undefined,
    faceNoise: Math.max(a.faceNoise ?? 0, b.faceNoise ?? 0) || undefined,
    face: (a.face ?? 0) + (b.face ?? 0) || undefined,
  };
}

/** the slope under the ball in a few words, or null when it is not enough to call out */
export function slopeWords(sx: number, sz: number, yaw: number): string | null {
  const up = sx * Math.sin(yaw) + sz * Math.cos(yaw);
  const side = sx * Math.cos(yaw) - sz * Math.sin(yaw);
  if (Math.max(Math.abs(up), Math.abs(side)) < SLOPE_FLAT * 1.4) return null;
  if (Math.abs(up) >= Math.abs(side)) return up > 0 ? "UPHILL LIE" : "DOWNHILL LIE";
  return side > 0 ? "BALL ABOVE FEET" : "BALL BELOW FEET";
}

/** the lies from best to worst: a shot from a later one never goes further than from an earlier one, club for club */
export const LIE_ORDER: Surface[] = ["fairway", "fringe", "rough", "waste", "fescue", "bunker"];

/**
 * A penalty drop. `why`: "water", "out" (the woods), "gorse" (unplayable: dropped beside it, no nearer the hole) or "oob"
 * (out of bounds: stroke and distance, so the ball goes back to where the shot was played from).
 */
export type Drop = { x: number; z: number; why: "water" | "out" | "gorse" | "oob"; /** strokes added */ penalty: number; say: string };

/** a ball dropped out of gorse is at least this far (m) from any other gorse */
export const GORSE_CLEAR = 1.5;
/** the grounds a ball dropped out of water may be put on besides the fairway */
const DRY_ROUGH: ReadonlySet<Surface> = new Set<Surface>(["rough", "fescue", "waste"]);
/** the ground a ball can be dropped on */
const OPEN: ReadonlySet<Surface> = new Set<Surface>(["fairway", "rough", "fescue", "waste", "fringe", "green"]);

/**
 * Where a ball in gorse is dropped: the nearest open ground that is GORSE_CLEAR from the gorse and from water and no
 * nearer the pin than the ball is, and of that ring the point nearest the pin (null if there is none within 40 m).
 */
export function gorseDrop(surfaceAt: (x: number, z: number) => Surface, x: number, z: number, pin: [number, number]): { x: number; z: number } | null {
  const d0 = Math.hypot(pin[0] - x, pin[1] - z);
  for (let r = 1; r <= 40; r += 0.5) {
    const n = Math.max(16, Math.round(r * 8));
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!OPEN.has(surfaceAt(px, pz))) continue;
      const dp = Math.hypot(pin[0] - px, pin[1] - pz);
      if (dp < d0 || dp >= bd) continue;
      let clear = true;
      for (let k = 0; k < 8 && clear; k++) {
        const b = (k / 8) * Math.PI * 2;
        if (surfaceAt(px + Math.cos(b) * GORSE_CLEAR, pz + Math.sin(b) * GORSE_CLEAR) === "gorse") clear = false;
      }
      if (!clear || waterWithin(surfaceAt, px, pz, 1) !== null) continue;
      best = { x: px, z: pz };
      bd = dp;
    }
    if (best) return best;
  }
  return null;
}

/** the nearest water to a point, m, looked for out to `max` (Infinity-ish when there is none) */
export function waterWithin(surfaceAt: (x: number, z: number) => Surface, x: number, z: number, max = 2) {
  for (let r = 0; r <= max + 1e-9; r += 0.25) {
    const n = r === 0 ? 1 : Math.max(8, Math.round(r * 12));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (surfaceAt(x + Math.cos(a) * r, z + Math.sin(a) * r) === "water") return r;
    }
  }
  return null;
}

/** how far back from the water's edge a dropped ball is put, m */
export const DROP_CLEAR = 2;
/** water whose way back along the line is longer than this (m) to playable ground (a creek in the woods) is dropped beside, as the woods are */
export const DROP_BACK_MAX = 23;

/**
 * A ball that ended in water or the woods: where it is dropped, and what that costs (null: play it as it lies).
 * Water: back along the flight line from where it crossed in, to the first dry ground at least DROP_CLEAR from the
 * water, the fairway if there is any on the line, else the rough. If that is more than DROP_BACK_MAX back (water in
 * the woods, with nothing playable on the line until near the tee), it is dropped beside where it went in, toward the
 * middle of the hole, as a ball in the woods is.
 */
export function dropFor(shot: Shot, ground: Surface, edgeDrop: (x: number, z: number) => [number, number], surfaceAt?: (x: number, z: number) => Surface, pin?: [number, number]): Drop | null {
  const n = shot.n;
  const ex = shot.ox + shot.pts[(n - 1) * 4 + 1], ez = shot.oz + shot.pts[(n - 1) * 4 + 3];
  if (ground === "water") {
    const d = shot.drop ?? { x: 0, z: 0 };
    let best = { x: shot.ox + d.x, z: shot.oz + d.z };
    if (surfaceAt) {
      // walk back along the ground track, from the crossing to the ball
      let from = n - 1;
      while (from > 0 && surfaceAt(shot.ox + shot.pts[from * 4 + 1], shot.oz + shot.pts[from * 4 + 3]) === "water") from--;
      let rough: { x: number; z: number } | null = null;
      let found = false;
      for (let i = from; i >= 0 && !found; i--) {
        const x = shot.ox + shot.pts[i * 4 + 1], z = shot.oz + shot.pts[i * 4 + 3];
        const sf = surfaceAt(x, z);
        if ((sf !== "fairway" && !DRY_ROUGH.has(sf)) || waterWithin(surfaceAt, x, z, DROP_CLEAR) !== null) continue;
        if (sf === "fairway") {
          best = { x, z };
          found = true;
        } else rough ??= { x, z };
      }
      if (!found && rough) best = rough;
      const cx = shot.ox + shot.pts[from * 4 + 1], cz = shot.oz + shot.pts[from * 4 + 3];
      if (Math.hypot(best.x - cx, best.z - cz) > DROP_BACK_MAX) {
        const side = besideWater(cx, cz, edgeDrop, surfaceAt);
        if (side && Math.hypot(side.x - cx, side.z - cz) < Math.hypot(best.x - cx, best.z - cz)) best = side;
      }
    }
    return { x: best.x, z: best.z, why: "water", penalty: 1, say: "Water. One stroke added. Dropping." };
  }
  if (ground === "oob") {
    // stroke and distance: the shot again from where it was played, and a stroke on top
    return { x: shot.ox, z: shot.oz, why: "oob", penalty: 1, say: "Out of bounds. One stroke added. Play it again." };
  }
  if (ground === "gorse") {
    const g = surfaceAt && pin ? gorseDrop(surfaceAt, ex, ez, pin) : null;
    const [x, z] = g ? [g.x, g.z] : edgeDrop(ex, ez);
    return { x, z, why: "gorse", penalty: 1, say: "In the gorse. Unplayable. One stroke added. Dropping." };
  }
  if (ground === "out") {
    const [x, z] = edgeDrop(ex, ez);
    return { x, z, why: "out", penalty: 1, say: "In the trees. One stroke added. Dropping." };
  }
  return null;
}

/** a drop beside the water at (x, z): the woods' drop toward the middle of the hole, then on until it is DROP_CLEAR clear (null if it never is) */
function besideWater(x: number, z: number, edgeDrop: (x: number, z: number) => [number, number], surfaceAt: (x: number, z: number) => Surface) {
  const [ex, ez] = edgeDrop(x, z);
  const dx = ex - x, dz = ez - z, l = Math.hypot(dx, dz);
  if (l < 1e-6) return null;
  for (let d = l; d <= l + 25; d += 0.5) {
    const px = x + (dx / l) * d, pz = z + (dz / l) * d;
    const sf = surfaceAt(px, pz);
    if ((sf === "fairway" || DRY_ROUGH.has(sf)) && waterWithin(surfaceAt, px, pz, DROP_CLEAR) === null) return { x: px, z: pz };
  }
  return null;
}
