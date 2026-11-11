import type { BuiltHole } from "@/components/offhours/golf/course";
import { isSimple, nearest, polygonArea, resample } from "./geo";
import { makeHeight } from "./height";
import { ringHeight } from "./rings";
import { seaPolygon } from "./ocean";
import type { P, SceneryRecord } from "./types";
import { wallSpine } from "./wall";

// Checks a scene's geometry against its hole, so a record that would put rock or water too near play, or a ring layer
// that is out of range, fails a test instead of showing up on screen.

const HEX = /^#[0-9a-f]{6}$/i;
/** how near a wall may stand to the rough, water or sand, m */
export const WALL_KEEP = 60;

/** the outlines a backdrop must keep clear of */
function playRings(hole: BuiltHole): P[][] {
  return [hole.shape.rough, ...hole.world.water, ...(hole.world.sand ?? [])];
}

/** the least distance from a path (sampled every 15 m) to any outline of play */
export function clearanceOf(hole: BuiltHole, path: P[]): number {
  const rings = playRings(hole).map((r) => [...r, r[0]] as P[]);
  let best = Infinity;
  for (const [x, z] of resample(path, 15)) for (const r of rings) best = Math.min(best, nearest(r, x, z).d);
  return best;
}

export function validateScenery(hole: BuiltHole, rec: SceneryRecord): string[] {
  const bad: string[] = [];
  const colors: string[] = [];
  if (rec.coast) {
    const c = rec.coast;
    const d = clearanceOf(hole, c.line);
    if (d < c.keepOut) bad.push(`coast comes within ${d.toFixed(0)} m of play (keep ${c.keepOut})`);
    const poly = seaPolygon(c);
    if (!isSimple(poly)) bad.push("sea polygon crosses itself");
    if (!(polygonArea(poly) > 0)) bad.push("sea polygon has no area");
    if (c.deep < 6) bad.push("sea is too shallow under the water");
    colors.push(...Object.values(c.tones), ...(c.cliff ? [...c.cliff.rock, c.cliff.foot] : []));
  }
  for (const w of rec.walls ?? []) {
    const d = clearanceOf(hole, wallSpine(hole, w));
    if (d < WALL_KEEP) bad.push(`wall comes within ${d.toFixed(0)} m of play (keep ${WALL_KEEP})`);
    colors.push(...w.rock, w.cap, w.foot);
  }
  if (rec.rings?.length) {
    if (rec.rings.filter((l) => l.soft).length !== 1) bad.push("exactly one ring layer must be kept on the soft tier");
    for (const l of rec.rings) {
      if (l.radius < 2300 || l.radius > 3900) bad.push(`ring radius ${l.radius} outside 2300..3900`);
      for (let i = 0; i < 720; i++) if (!Number.isFinite(ringHeight(l, (i / 720) * Math.PI * 2 - Math.PI))) bad.push("ring height is not finite");
      colors.push(l.color, ...l.sectors.flatMap((s) => (s.color ? [s.color] : [])));
    }
  }
  if (rec.skin) colors.push(...[rec.skin.skyTop, rec.skin.skyLow, rec.skin.haze, rec.skin.glow].filter((c): c is string => !!c));
  if (rec.palette) colors.push(rec.palette.base, rec.palette.high);
  for (const c of colors) if (!HEX.test(c)) bad.push(`colour ${c} does not parse`);
  return bad;
}

/**
 * From an eye, which bearings (degrees) see the sea: a ray is marched along each over the drawn ground (trees ignored)
 * and the sea shows where its surface comes up at a greater angle than the ground in front of it.
 */
export function seaReveal(hole: BuiltHole, rec: SceneryRecord, ground: (x: number, z: number) => number, eye: [number, number, number], bearings: number[]): boolean[] {
  const { heightAt } = makeHeight(hole, ground, rec);
  const seaY = rec.coast?.seaY ?? -Infinity;
  return bearings.map((deg) => {
    const a = (deg * Math.PI) / 180, sx = Math.sin(a), sz = Math.cos(a);
    let top = -Infinity;
    for (let d = 20; d <= 2500; d += d < 400 ? 5 : 25) {
      const x = eye[0] + sx * d, z = eye[2] + sz * d;
      const h = heightAt(x, z);
      if (h < seaY) {
        // water over this ground: its surface is seen if it comes up above everything nearer
        if ((seaY - eye[1]) / d > top) return true;
      } else top = Math.max(top, (h - eye[1]) / d);
    }
    return false;
  });
}

