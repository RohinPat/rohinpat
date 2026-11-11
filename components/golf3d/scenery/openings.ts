import type { BuiltHole } from "@/components/offhours/golf/course";
import { hash2, lineFrame, pathLength, signedDist } from "./geo";
import type { SceneryRecord } from "./types";
import { onWall } from "./wall";

/**
 * Which decorative trees stay. Trees that stop a ball (the copse) and anything within 5 m of the rough are never
 * touched. Without openings, a coast or walls there is nothing to filter and this is undefined.
 */
export function makeTreeKeep(hole: BuiltHole, rec: SceneryRecord, beyond: (x: number, z: number) => number) {
  const ops = rec.openings ?? [];
  const coast = rec.coast;
  const walls = rec.walls ?? [];
  if (!ops.length && !coast && !walls.length) return undefined;
  const total = pathLength(hole.line);
  const end = hole.line[hole.line.length - 1], prev = hole.line[hole.line.length - 2];
  const hl = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
  const hx = (end[0] - prev[0]) / hl, hz = (end[1] - prev[1]) / hl;
  const isCopse = (x: number, z: number) => hole.blockers.some((b) => Math.abs(b.x - x) < 0.01 && Math.abs(b.z - z) < 0.01);
  return (x: number, z: number, _h: number): boolean => {
    if (beyond(x, z) < 5) return true;
    if (isCopse(x, z)) return true;
    // never over a cliff or in the sea, nor in the foot of a rock wall
    if (coast && signedDist(coast, x, z) > -8) return false;
    if (walls.length && onWall(hole, walls, x, z)) return false;
    for (const o of ops) {
      let inside = false;
      if (o.kind === "side") {
        const f = lineFrame(hole.line, x, z);
        const onSide = o.side === "left" ? f.lat < 0 : f.lat > 0;
        const u = f.s / total;
        inside = onSide && u >= (o.from ?? 0) && u <= (o.to ?? 1);
      } else {
        const dx = x - end[0], dz = z - end[1];
        const along = dx * hx + dz * hz, lat = dx * hz - dz * hx;
        inside = along > 0 && along <= o.depth && Math.abs(lat) <= o.halfWidth;
      }
      if (inside && hash2(x, z, 91) >= o.keep) return false;
    }
    return true;
  };
}
