import type { BuiltHole } from "@/components/offhours/golf/course";
import { GH, GW, shapeR } from "@/components/offhours/golf/green";
import { outsideGreen, terrainOf } from "@/components/offhours/golf/terrain";

// The ground the 3D course stands on, as the putting pieces (putt3d, puttcam,
// hole3d's green) ask for it: the terrain's (terrain.ts), which the ball plays on
// too, with the green's own height field raised on its pad. The drawn green is
// exaggerated: a real green's 1 to 6 per cent slope is nearly invisible on a
// screen, so the green's relief about its mean height is drawn K times as tall,
// and an apron blends that back into the ground past the collar. The ball is
// drawn on that surface too. Physics (terrain.ts, green.ts) is untouched.

export { PAD } from "@/components/offhours/golf/terrain";

/**
 * K is set per green from its own relief, not once for all of them: real greens run from about 1% (hole 1) to 6% (hole 6), so
 * one K makes hole 6 a hillside and leaves hole 1 flat. A green's typical slope is the 75th percentile of its true |slope| on the
 * putting surface; K takes that to EXAG_TARGET, clamped to EXAG_MIN..EXAG_MAX. K is full across the whole putting surface (the
 * tilt is magnified, not the bumps), so the target is the slope at which the fall reads from address without the shading. A
 * fade inside the green made a crown: the middle bulged while the edges stayed put, and a green falling left read as falling both
 * ways. 8 per cent is too faint to read; 16 domes (compare-targets.png). At 12 per cent the tilt was true but too weak to read from
 * address. At 24 per cent hole 6's apron widened to 14 m with no gain on hole 1, which is capped, or hole 8, which is limited by
 * its water. 18 per cent with a 10x cap is the pick from fu-shots/relief/compare-tilt-targets.png.
 */
export const EXAG_TARGET = 0.18;
export const EXAG_MIN = 1.5;
export const EXAG_MAX = 10;
/**
 * The apron is the bank from the collar out to the ground. Its width is set by a slope budget, not a fixed ratio to its offset: the
 * drawn slope on the bank is the lift's, which peaks at 1.5 x offset / W (scaled by outsideGreen's gradient) radially, plus the
 * ground's slope along the rim, and the ground's own radial slope comes off too; the total must stay under APRON_SLOPE (a 1:4 bank).
 * W is solved per rim direction with a 10 per cent margin (apronWidthAt), so a steep rim gets a wider apron, and K is lowered where
 * the green's own tilt at the collar alone uses the budget. At least APRON_MIN metres.
 */
export const APRON_SLOPE = 0.25;
export const APRON_MIN = 3;
/** headroom on the apron's slope budget, so a green's measured slope is not right at the limit */
export const APRON_MARGIN = 1.1;

export type Relief = {
  /** the drawn ground's height at a course point, m */
  y: (x: number, z: number) => number;
  /** the same in the green's own coordinates */
  yG: (gx: number, gy: number) => number;
  /** the green's drawn rise about its mean height, m (negative under its low side) */
  rise: (gx: number, gy: number) => number;
  /** drawn height less the true height at a course point, m: the exaggeration (0 past the apron) */
  lift: (x: number, z: number) => number;
};

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

type Design = {
  /** the drawn tilt's magnification (K), the green's mean height c (m), and the apron's width W (m) */
  K: number;
  c: number;
  W: number;
  /** the apron could not fit on land at any K above 1: the green is drawn true */
  flat: boolean;
  /** K was lowered from its tilt's own value so the apron fits on land (a lake is close) */
  waterLimited: boolean;
};

/** the green's rim point in a direction from its middle (the collar's outer edge, where outsideGreen is 0, at dr = 0.085) */
function rimPoint(hole: BuiltHole, phi: number, dr = 0.085): [number, number] {
  const rho = shapeR(hole.green, phi) + dr;
  return [GW / 2 + (GW / 2) * rho * Math.cos(phi), GH / 2 + (GH / 2) * rho * Math.sin(phi)];
}

const RIM_STEPS = 128;

/**
 * the apron's width at K from its slope budget, the widest rim direction setting it (Infinity if the ground alone uses the budget).
 * The lift's slope on the bank has a radial part (1.5 x offset x |grad outsideGreen| / W at the smoothstep's peak) and a part along
 * the rim (K - 1 times the ground's slope along the rim, which the offset follows; at the collar this is the green's own tilt, so
 * K is lowered where it alone uses the budget). They add as a vector, and the ground's own radial slope comes off the budget too.
 */
function apronWidthAt(hole: BuiltHole, t: ReturnType<typeof terrainOf>, c: number, K: number): number {
  let W = APRON_MIN;
  const SPAN = 0.02; // the ground's radial slope, measured over 0.02 of rho either side of the collar
  const D = (Math.PI * 2) / RIM_STEPS;
  for (let i = 0; i < RIM_STEPS; i++) {
    const phi = (i / RIM_STEPS) * Math.PI * 2;
    const [rx, ry] = rimPoint(hole, phi);
    const off = Math.abs((K - 1) * (t.rise(rx, ry) - c));
    const [ax, ay] = rimPoint(hole, phi, 0.085 + SPAN);
    const [bx, by] = rimPoint(hole, phi, 0.085 - SPAN);
    const sg = Math.abs(t.rise(ax, ay) - t.rise(bx, by)) / Math.hypot(ax - bx, ay - by);
    const [px, py] = rimPoint(hole, phi + D);
    const [qx, qy] = rimPoint(hole, phi - D);
    const tang = APRON_MARGIN * (K - 1) * Math.abs(t.rise(px, py) - t.rise(qx, qy)) / Math.hypot(px - qx, py - qy);
    // outsideGreen is not a unit-gradient distance (about 1.2 to 1.4 here), so the fade's slope in metres is scaled by its gradient
    const EO = 0.02;
    const gO = Math.hypot(
      (outsideGreen(hole, rx + EO, ry) - outsideGreen(hole, rx - EO, ry)) / (2 * EO),
      (outsideGreen(hole, rx, ry + EO) - outsideGreen(hole, rx, ry - EO)) / (2 * EO),
    );
    const along = APRON_SLOPE - sg;
    const radial = along * along - tang * tang;
    if (radial <= 0) return Infinity;
    W = Math.max(W, (APRON_MARGIN * 1.5 * off * gO) / Math.sqrt(radial));
  }
  return W;
}

/**
 * Does the apron at K fit on land? A point that the apron would lift must not be water (a lake or a creek): if one is, the
 * apron would push exaggerated ground into the water.
 */
function apronFits(hole: BuiltHole, W: number): boolean {
  const step = 0.5;
  for (let gy = -W; gy <= GH + W; gy += step)
    for (let gx = -W; gx <= GW + W; gx += step) {
      const o = outsideGreen(hole, gx, gy);
      if (o <= 0 || o >= W) continue;
      const [x, z] = hole.fromGreen(gx, gy);
      if (hole.surfaceAt(x, z) === "water") return false;
    }
  return true;
}

const designCache = new WeakMap<BuiltHole, Design>();
/** this green's drawing: K, its mean height and the apron's width (see EXAG_TARGET and APRON_SLOPE) */
export function designOf(hole: BuiltHole): Design {
  const got = designCache.get(hole);
  if (got) return got;
  const t = terrainOf(hole);
  // the putting surface, sampled: its mean height and the 75th percentile of its true slope
  const heights: number[] = [];
  const slopes: number[] = [];
  const e = 0.1;
  for (let gy = 0.2; gy < GH; gy += 0.2)
    for (let gx = 0.2; gx < GW; gx += 0.2) {
      if (outsideGreen(hole, gx, gy) > -0.85) continue;
      heights.push(t.rise(gx, gy));
      const sx = (t.rise(gx + e, gy) - t.rise(gx - e, gy)) / (2 * e);
      const sy = (t.rise(gx, gy + e) - t.rise(gx, gy - e)) / (2 * e);
      slopes.push(Math.hypot(sx, sy));
    }
  const c = heights.reduce((a, b) => a + b, 0) / Math.max(1, heights.length);
  slopes.sort((a, b) => a - b);
  const p75 = slopes[Math.floor(slopes.length * 0.75)] ?? 0;
  let K = p75 > 1e-6 ? Math.min(EXAG_MAX, Math.max(EXAG_MIN, EXAG_TARGET / p75)) : EXAG_MIN;
  // lower K until the apron it needs is on land (down to EXAG_MIN; below that the green is drawn true)
  const K0 = K;
  const fits = (w: number) => Number.isFinite(w) && apronFits(hole, w);
  let W = apronWidthAt(hole, t, c, K);
  while (K > EXAG_MIN && !fits(W)) {
    K = Math.max(EXAG_MIN, K - 0.5);
    W = apronWidthAt(hole, t, c, K);
  }
  let flat = false;
  if (!fits(W)) {
    flat = true;
    K = 1;
    W = APRON_MIN;
  }
  const d: Design = { K, c, W, flat, waterLimited: K < K0 && !flat };
  designCache.set(hole, d);
  return d;
}

/** the drawn offset from the true height at a green point (its own coordinates), m */
function liftG(hole: BuiltHole, gx: number, gy: number): number {
  const D = designOf(hole);
  if (D.K === 1) return 0;
  const t = terrainOf(hole);
  const o = outsideGreen(hole, gx, gy);
  // on the putting surface and at the collar: the green's own relief about its mean, magnified
  if (o <= 0) return (D.K - 1) * (t.rise(gx, gy) - D.c);
  if (o >= D.W) return 0;
  // the apron: the collar's offset, carried out along the same direction and fading to nothing over W
  const phi = Math.atan2((gy - GH / 2) / (GH / 2), (gx - GW / 2) / (GW / 2));
  const [rx, ry] = rimPoint(hole, phi);
  return (D.K - 1) * (t.rise(rx, ry) - D.c) * (1 - smooth(o / D.W));
}

export function reliefOf(hole: BuiltHole): Relief {
  const t = terrainOf(hole);
  const lift = (x: number, z: number) => {
    const [gx, gy] = hole.toGreen(x, z);
    return liftG(hole, gx, gy);
  };
  return {
    y: (x, z) => t.y(x, z) + lift(x, z),
    yG: (gx, gy) => t.yG(gx, gy) + liftG(hole, gx, gy),
    rise: (gx, gy) => t.rise(gx, gy) + liftG(hole, gx, gy),
    lift,
  };
}

/**
 * How far past its box the drawn green reaches, m: the terrain's bank (where its relief runs out) or the apron (where the drawn
 * lift runs out, W from the outline), whichever is wider. The apron is measured from the outline, and the outline can stand past
 * the box itself (a green's oval is wider than its box on some holes), so the reach adds that overhang too. The mesh and the
 * terrain's sink both stop at this reach, so the drawing has no edge inside its box and no step at its edge.
 */
export function drawnReachOf(hole: BuiltHole): number {
  let overhang = 0;
  for (let i = 0; i < RIM_STEPS; i++) {
    const [x, y] = rimPoint(hole, (i / RIM_STEPS) * Math.PI * 2);
    overhang = Math.max(overhang, -x, x - GW, -y, y - GH);
  }
  return Math.max(terrainOf(hole).greenReach, designOf(hole).W + overhang + 1);
}
