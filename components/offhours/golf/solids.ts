import { seeded } from "../useCanvas";

// Props on a hole, as data, and the ones a ball can hit.
//
// A hole lists its props in `HoleDef.props`, placed in course yards like the rest of the hole (sizes are metres: a
// boulder's radius, a wall's height). Two readers: components/golf3d/props3d.ts draws them (one merged mesh for all the
// solid ones, one for the plants), and this file turns the solid ones into capsules for the ball (`solidsOf`), which
// flight.ts asks about through `collide`. The pieces that both need (where a wall's stones run once its gaps are
// taken out, where a rock cluster's rocks lie, the deck of a bridge) are here so they cannot disagree.
//
// The ball is a point of radius R against a vertical capsule: an axis from (ax, az) to (bx, bz), a radius, and a
// height above the ground there (or, for a bridge's rail, absolute heights, since the deck is not on the ground).

const YD = 0.9144;
type P = [number, number];

export type StakeColor = "red" | "yellow" | "white";

export type Prop =
  | {
      kind: "boulder";
      at: P;
      /** radius, m */
      size: number;
      seed?: number;
    }
  | {
      /** a spread of small rocks (not solid) */
      kind: "rocks";
      at: P;
      /** spread, yd */
      r: number;
      n: number;
      seed?: number;
    }
  | {
      /** a dry-stone wall along a polyline (yd); `gaps` are [from, to] in yd along the path, left open */
      kind: "wall";
      path: P[];
      /** m, default 1.2 */
      h?: number;
      gaps?: [number, number][];
      seed?: number;
    }
  | {
      /** an aiming or marker post: bands of two colours, a ball on top */
      kind: "post";
      at: P;
      /** m, default 2.4 */
      h?: number;
      /** radius, m, default 0.12 */
      r?: number;
      /** default ["#e5484d", "#f4efe4"] (red, white) */
      colors?: [string, string];
    }
  | { kind: "stake"; at: P; color: StakeColor }
  | {
      /** a footbridge from a to b (yd): the deck sits above the ground at both ends and above the water between */
      kind: "bridge";
      a: P;
      b: P;
      /** deck width, m, default 2.6 */
      w?: number;
    }
  | {
      /** a pair of stone gateposts with the gap between them (m) along `yaw` (0 runs down the course, positive to the right) */
      kind: "gatepost";
      at: P;
      yaw: number;
      gap: number;
    }
  | { kind: "reeds"; at: P; r: number; n: number; seed?: number }
  | { kind: "tuft"; at: P; r: number; n: number; seed?: number }
  | { kind: "bench"; at: P; yaw: number }
  | { kind: "sign"; at: P; yaw: number };

export type PropKind = Prop["kind"];

/** what a ball can hit */
export type Solid = {
  kind: "wall" | "boulder" | "post" | "gatepost" | "rail";
  /** the axis, world metres (a point when a and b are one) */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** radius, m */
  r: number;
  /** height above the ground at the ball, m (ignored when y1 is set) */
  h: number;
  /** restitution off the face (0 dead, 1 perfect) */
  e: number;
  /** absolute underside and top, m, for a solid that is not on the ground (a bridge's rail) */
  y0?: number;
  y1?: number;
};

/** the ground a prop stands on: the height, and the water's surface where there is any */
export type PropGround = { y: (x: number, z: number) => number; waterY?: (x: number, z: number) => number };

// ------------------------------------------------------------------ shared geometry

/** a wall's runs in metres once the gaps are cut out: each run a polyline */
export function wallRuns(p: Extract<Prop, { kind: "wall" }>): P[][] {
  const pts = p.path.map(([x, z]) => [x * YD, z * YD] as P);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  // the stretches of the path that are wall: what the gaps leave
  const gaps = (p.gaps ?? []).map(([a, b]) => [Math.max(0, a * YD), Math.min(total, b * YD)] as P).sort((u, v) => u[0] - v[0]);
  const spans: P[] = [];
  let from = 0;
  for (const [a, b] of gaps) {
    if (a > from) spans.push([from, a]);
    from = Math.max(from, b);
  }
  if (from < total) spans.push([from, total]);
  const at = (s: number): P => {
    let i = 0;
    while (i < pts.length - 2 && s > cum[i + 1]) i++;
    const k = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
  };
  return spans.map(([a, b]) => {
    const run: P[] = [at(a)];
    for (let i = 1; i < pts.length - 1; i++) if (cum[i] > a && cum[i] < b) run.push(pts[i]);
    run.push(at(b));
    return run;
  });
}

/** the rocks of a cluster, metres: position, radius, and the turn */
export function rockCluster(p: Extract<Prop, { kind: "rocks" }>) {
  const r = seeded((p.seed ?? 1) * 977 + 13);
  const out: { x: number; z: number; s: number; rot: number }[] = [];
  for (let i = 0; i < p.n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * p.r * YD;
    out.push({ x: p.at[0] * YD + Math.cos(a) * d, z: p.at[1] * YD + Math.sin(a) * d, s: 0.18 + r() * r() * 0.5, rot: r() * 6.28 });
  }
  return out;
}

/** stakes along an arc of a pond (a `Blob`-like ellipse, yd), from one angle to another, a little outside the edge */
export function stakesAround(b: { x: number; z: number; rx: number; rz: number; rot?: number }, from: number, to: number, n: number, color: StakeColor, out = 1.2): Prop[] {
  const c = Math.cos(b.rot ?? 0), s = Math.sin(b.rot ?? 0);
  const res: Prop[] = [];
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * i) / Math.max(1, n - 1);
    const u = Math.cos(a) * (b.rx + out), v = Math.sin(a) * (b.rz + out);
    res.push({ kind: "stake", at: [b.x + u * c - v * s, b.z + u * s + v * c], color });
  }
  return res;
}

export type BridgeShape = {
  /** the ends, metres */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** unit along the bridge and across it */
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  len: number;
  w: number;
  /** the deck's top, m: above both banks and above the water between them, however deep the channel is carved */
  deckY: number;
};
export const DECK_THICK = 0.18;
export const RAIL_H = 1.0;

/** where a bridge's deck lies on a ground: clear of the higher bank by half a metre and of the water's surface by a metre */
export function bridgeShape(p: Extract<Prop, { kind: "bridge" }>, g: PropGround): BridgeShape {
  const ax = p.a[0] * YD, az = p.a[1] * YD, bx = p.b[0] * YD, bz = p.b[1] * YD;
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  let deckY = Math.max(g.y(ax, az), g.y(bx, bz)) + 0.5;
  if (g.waterY) for (const k of [0.25, 0.4, 0.5, 0.6, 0.75]) deckY = Math.max(deckY, g.waterY(ax + (bx - ax) * k, az + (bz - az) * k) + 1);
  return { ax, az, bx, bz, ux, uz, nx: uz, nz: -ux, len, w: p.w ?? 2.6, deckY };
}

// ------------------------------------------------------------------ what the ball can hit

const memo = new WeakMap<object, WeakMap<object, Solid[]>>();

/**
 * The solids of a hole's props, in world metres. The same array comes back for the same props and ground, so the
 * game can ask every shot. A hole with none gives an empty array.
 */
export function solidsOf(props: Prop[] | undefined, ground: PropGround): Solid[] {
  if (!props || !props.length) return NONE;
  let byGround = memo.get(props);
  if (!byGround) memo.set(props, (byGround = new WeakMap()));
  const got = byGround.get(ground);
  if (got) return got;
  const out: Solid[] = [];
  for (const p of props) {
    if (p.kind === "boulder") {
      out.push({ kind: "boulder", ax: p.at[0] * YD, az: p.at[1] * YD, bx: p.at[0] * YD, bz: p.at[1] * YD, r: p.size * 0.85, h: p.size * 0.9, e: 0.4 });
    } else if (p.kind === "wall") {
      const h = p.h ?? 1.2;
      for (const run of wallRuns(p)) for (let i = 0; i < run.length - 1; i++) out.push({ kind: "wall", ax: run[i][0], az: run[i][1], bx: run[i + 1][0], bz: run[i + 1][1], r: 0.3, h, e: 0.3 });
    } else if (p.kind === "post") {
      out.push({ kind: "post", ax: p.at[0] * YD, az: p.at[1] * YD, bx: p.at[0] * YD, bz: p.at[1] * YD, r: (p.r ?? 0.12) + 0.03, h: p.h ?? 2.4, e: 0.5 });
    } else if (p.kind === "gatepost") {
      const sx = Math.sin(p.yaw) * p.gap / 2, sz = Math.cos(p.yaw) * p.gap / 2;
      for (const s of [-1, 1]) {
        const x = p.at[0] * YD + s * sx, z = p.at[1] * YD + s * sz;
        out.push({ kind: "gatepost", ax: x, az: z, bx: x, bz: z, r: 0.3, h: 1.6, e: 0.3 });
      }
    } else if (p.kind === "bridge") {
      const b = bridgeShape(p, ground);
      for (const s of [-1, 1])
        out.push({
          kind: "rail",
          ax: b.ax + s * b.nx * (b.w / 2),
          az: b.az + s * b.nz * (b.w / 2),
          bx: b.bx + s * b.nx * (b.w / 2),
          bz: b.bz + s * b.nz * (b.w / 2),
          r: 0.14,
          h: RAIL_H,
          e: 0.35,
          y0: b.deckY,
          y1: b.deckY + RAIL_H,
        });
    }
  }
  byGround.set(ground, out);
  return out;
}
const NONE: Solid[] = [];

export type Contact = {
  solid: Solid;
  /** the way out of it: unit, horizontal, from the solid toward the ball */
  nx: number;
  nz: number;
  /** how far inside the skin the ball's middle is, m */
  depth: number;
  /** the ball came down on the top of it */
  top: boolean;
  /** the top's height, m (absolute) */
  topY: number;
};

/**
 * The deepest contact of a ball (middle at x, z, y; absolute metres; radius R) with the solids, or null. `ground` is the
 * ground's height under the ball: a solid on the ground stands from there. The ball clears one it is above.
 */
export function collide(solids: Solid[], x: number, z: number, y: number, R: number, ground: number, vx = 0, vz = 0): Contact | null {
  let best: Contact | null = null;
  for (const s of solids) {
    const reach = s.r + R;
    // quick out
    if (x < Math.min(s.ax, s.bx) - reach || x > Math.max(s.ax, s.bx) + reach || z < Math.min(s.az, s.bz) - reach || z > Math.max(s.az, s.bz) + reach) continue;
    const top = s.y1 !== undefined ? s.y1 : ground + s.h;
    const bot = s.y0 !== undefined ? s.y0 : ground - 0.5;
    if (y >= top || y < bot - R) continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const l2 = dx * dx + dz * dz;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0;
    const cx = s.ax + dx * u, cz = s.az + dz * u;
    let ex = x - cx, ez = z - cz;
    const d = Math.hypot(ex, ez);
    if (d >= reach) continue;
    if (d > 1e-6) {
      ex /= d;
      ez /= d;
    } else {
      // dead on the axis: out the way the ball came from, else across the wall
      const vl = Math.hypot(vx, vz);
      if (vl > 1e-6) {
        ex = -vx / vl;
        ez = -vz / vl;
      } else {
        const l = Math.sqrt(l2) || 1;
        ex = dz / l;
        ez = -dx / l;
      }
    }
    const depth = reach - d;
    if (!best || depth > best.depth) best = { solid: s, nx: ex, nz: ez, depth, top: y > top - 0.12, topY: top };
  }
  return best;
}
