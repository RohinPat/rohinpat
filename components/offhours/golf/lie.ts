import type { Lie, Shot, Surface } from "./flight";

// How the ball lies, in one table, and what happens when it ends somewhere it
// should not. The table is multipliers on the swing (flight.ts applies them);
// water and the woods cost a stroke and a drop.

/** the sand wedge's index in CLUBS */
const SAND_WEDGE = 5;

/** what the ground under the ball does to a swing with this club (undefined: nothing) */
export function lieFor(surface: Surface, club: number): Lie | undefined {
  switch (surface) {
    case "rough":
      // grass in the face: slower, no check, a poorer strike, and the face wanders a little
      return { speed: 0.82, spin: 0.5, contactCap: 0.8, faceNoise: 0.1 };
    case "bunker":
      return club === SAND_WEDGE ? { speed: 0.8, contactCap: 0.9 } : { speed: 0.5, contactCap: 0.6, launch: 0.6 };
    case "fringe":
      return { speed: 0.95 };
    default:
      return undefined;
  }
}

/** the lies from best to worst: a shot from a later one never goes further than from an earlier one, club for club */
export const LIE_ORDER: Surface[] = ["fairway", "fringe", "rough", "bunker"];

export type Drop = { x: number; z: number; why: "water" | "out"; /** strokes added */ penalty: number; say: string };

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
export function dropFor(shot: Shot, ground: Surface, edgeDrop: (x: number, z: number) => [number, number], surfaceAt?: (x: number, z: number) => Surface): Drop | null {
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
        if ((sf !== "fairway" && sf !== "rough") || waterWithin(surfaceAt, x, z, DROP_CLEAR) !== null) continue;
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
    if ((sf === "fairway" || sf === "rough") && waterWithin(surfaceAt, px, pz, DROP_CLEAR) === null) return { x: px, z: pz };
  }
  return null;
}
