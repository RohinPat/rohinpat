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

/** a ball that ended in water or the woods: where it is dropped, and what that costs (null: play it as it lies) */
export function dropFor(shot: Shot, ground: Surface, edgeDrop: (x: number, z: number) => [number, number]): Drop | null {
  const ex = shot.ox + shot.pts[(shot.n - 1) * 4 + 1], ez = shot.oz + shot.pts[(shot.n - 1) * 4 + 3];
  if (ground === "water") {
    const d = shot.drop ?? { x: 0, z: 0 };
    return { x: shot.ox + d.x, z: shot.oz + d.z, why: "water", penalty: 1, say: "Water. One stroke added. Dropping." };
  }
  if (ground === "out") {
    const [x, z] = edgeDrop(ex, ez);
    return { x, z, why: "out", penalty: 1, say: "In the trees. One stroke added. Dropping." };
  }
  return null;
}
