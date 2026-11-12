import { YD } from "./scene";

// Landforms on top of a hole's ground (terrain.ts): the shapes the line's smooth
// rise cannot make. A hole lists them in `HoleDef.features`, in the hole's own
// units (yards for places and widths, metres for heights and depths), and
// terrain.ts adds them to the ground before it levels the tee and the green, so
// the ball (flight.ts, lie.ts) and the 3D course (hole3d.ts) both see them.
//
//   ridge    a long mound along a path (a crest, a dune ring's rim when `closed`)
//   mound    a round or oval bump (h > 0)
//   hollow   a round or oval dip (d deep)
//   bowl     a dip with a flat floor and, if wanted, a raised rim: a punchbowl
//   pot      a pot bunker: a sod face round a flat floor and a lip, on one of the hole's bunkers
//   channel  a ravine, barranca or burn bed along a path, with banks
//   shelf    a flat raised oval with a steep face: an elevated green's plateau
//   face     a steep bank along a path: the ground steps up (or down) across it
//   terrace  a run of faces and flat treads, one above the next
//
// Heights are metres above (below) the ground the line makes there. Everything
// is a pure function of x and z (metres, the hole's frame), so a feature costs
// nothing to ask for at run time except a bounding-box test.

type Pt = [number, number];

export type Feature =
  | {
      k: "ridge";
      path: Pt[];
      /** half width of the ridge, yd (it falls to nothing this far from the path) */
      w: number;
      /** height, m; `h2` the height at the path's far end, if it changes along it */
      h: number;
      h2?: number;
      /** 0..1: the share of the width that is a flat top (default 0, a rounded crest) */
      flat?: number;
      /** the path ends where it started: a ring */
      closed?: boolean;
    }
  | { k: "mound"; x: number; z: number; r: number; rz?: number; rot?: number; h: number }
  | { k: "hollow"; x: number; z: number; r: number; rz?: number; rot?: number; d: number }
  | {
      k: "bowl";
      x: number;
      z: number;
      r: number;
      rz?: number;
      rot?: number;
      /** depth of the floor, m */
      d: number;
      /** the share of the radius that is flat floor (default 0.5) */
      flat?: number;
      /** a raised rim round the edge, m, and its half width, yd (default r / 3) */
      rim?: number;
      rimW?: number;
    }
  | {
      k: "pot";
      /** index into the hole's `bunkers`: the pot's outline, and the sand painted in it */
      b: number;
      /** depth of the floor below the lip, m */
      d: number;
      /** the lip's height on the green side, m (default 0.5) */
      lip?: number;
      /** the face's share of the bunker's radius (default 0.3; smaller is steeper) */
      face?: number;
    }
  | {
      k: "channel";
      path: Pt[];
      /** width of the floor, yd */
      w: number;
      /** width of each bank, yd (`bankR` the right-hand one if it differs: a rock face on one side) */
      bank: number;
      bankR?: number;
      /** depth, m; `d2` the depth at the far end of the path */
      d: number;
      d2?: number;
    }
  | { k: "shelf"; x: number; z: number; r: number; rz?: number; rot?: number; h: number; /** run of the face, yd */ edge: number }
  | {
      k: "face";
      path: Pt[];
      /** the step: the ground on the LEFT of the path (looking along it) is this much higher, m (negative: lower) */
      h: number;
      /** the run of the face, yd */
      w: number;
      /** how far the raised ground reaches past the face before it falls back, yd (default 40) */
      reach?: number;
      /** the face fades out this far (yd) past either end of the path (default 12) */
      fade?: number;
    }
  | {
      k: "terrace";
      path: Pt[];
      /** total rise over all the steps, m */
      h: number;
      n: number;
      /** flat ground between faces, yd */
      tread: number;
      /** run of each face, yd */
      riser: number;
      reach?: number;
      fade?: number;
    };

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** 1 at 0, falling to 0 at 1 along a cosine */
export const bell = (u: number) => (u <= 0 ? 1 : u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u));
/** a bell with a flat top: 1 up to `flat`, then falling to 0 at 1 */
const flatBell = (u: number, flat: number) => (u <= flat ? 1 : bell((u - flat) / (1 - flat)));

/** how a point sits against a polyline: its distance, the side (+ on the left looking along it), where along it (0..1), and how far past an end */
export function pathInfo(path: Pt[], x: number, z: number, closed = false) {
  const pts = closed ? [...path, path[0]] : path;
  let total = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push((total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])));
  let best = { d: Infinity, s: 0, t: 0, over: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    const raw = ((x - ax) * dx + (z - az) * dz) / (len * len);
    const u = Math.max(0, Math.min(1, raw));
    const d = Math.hypot(x - (ax + dx * u), z - (az + dz * u));
    if (d < best.d) {
      const lastEnd = !closed && i === pts.length - 2 && raw > 1, firstEnd = !closed && i === 0 && raw < 0;
      best = {
        d,
        s: ((x - ax) * -dz + (z - az) * dx) / len,
        t: total > 0 ? (cum[i] + u * len) / total : 0,
        over: lastEnd ? (raw - 1) * len : firstEnd ? -raw * len : 0,
      };
    }
  }
  return best;
}

type Ell = { x: number; z: number; rx: number; rz: number; c: number; s: number };
/** the ellipse's radius at a point (1 on its edge) and the distance to its edge, m (+ outside): good to first order */
function ellipse(e: Ell, x: number, z: number) {
  const dx = x - e.x, dz = z - e.z;
  const u = dx * e.c + dz * e.s, v = -dx * e.s + dz * e.c;
  const r = Math.hypot(u / e.rx, v / e.rz);
  const gu = u / (e.rx * e.rx), gv = v / (e.rz * e.rz);
  const g = Math.hypot(gu, gv) / (r || 1);
  return { r, sd: r < 1e-6 ? -Math.min(e.rx, e.rz) : (r - 1) / (g || 1e-6) };
}

type Bunker = { x: number; z: number; rx: number; rz: number; rot?: number };

export type Compiled = {
  /** the features' height at a point, m (pots excepted) */
  y: (x: number, z: number) => number;
  /** how much a pot digs a bunker at a point (negative on its lip), m; null where the bunker is not a pot */
  pot: (bunker: number, x: number, z: number) => number | null;
  /** how finely the 3D mesh should be cut here: 2 within `m` metres of a pot or a bowl, 1 of a face, channel or shelf, else 0 */
  fine: (x: number, z: number, m: number) => 0 | 1 | 2;
  /** the rectangle each feature reaches over, m (x0, z0, x1, z1) */
  bounds: { k: Feature["k"]; box: [number, number, number, number] }[];
  /** how near a feature's influence a point is: true inside any bounding box grown by `m` */
  near: (x: number, z: number, m: number) => boolean;
};

const none: Compiled = { y: () => 0, pot: () => null, fine: () => 0, bounds: [], near: () => false };

export function compileFeatures(features: Feature[] | undefined, bunkers: Bunker[]): Compiled {
  if (!features?.length) return none;
  const m = (v: number) => v * YD;
  const ell = (f: { x: number; z: number; r: number; rz?: number; rot?: number }): Ell => ({ x: m(f.x), z: m(f.z), rx: m(f.r), rz: m(f.rz ?? f.r), c: Math.cos(f.rot ?? 0), s: Math.sin(f.rot ?? 0) });
  const mp = (p: Pt[]) => p.map(([x, z]) => [m(x), m(z)] as Pt);
  const boxOf = (pts: Pt[], pad: number): [number, number, number, number] => [
    Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad,
    Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad,
  ];
  const boxEll = (e: Ell, grow: number): [number, number, number, number] => {
    const R = Math.max(e.rx, e.rz) + grow;
    return [e.x - R, e.z - R, e.x + R, e.z + R];
  };

  type Term = { k: Feature["k"]; box: [number, number, number, number]; fineBox?: [number, number, number, number]; y: (x: number, z: number) => number; zone?: (x: number, z: number, margin: number) => boolean };
  const terms: Term[] = [];
  const pots = new Map<number, (x: number, z: number) => number>();
  const potTerms: Term[] = [];

  for (const f of features) {
    switch (f.k) {
      case "ridge": {
        const path = mp(f.path), w = m(f.w), flat = f.flat ?? 0, closed = !!f.closed;
        terms.push({
          k: f.k,
          box: boxOf(path, w),
          y: (x, z) => {
            const i = pathInfo(path, x, z, closed);
            if (i.d >= w) return 0;
            const h = f.h2 === undefined ? f.h : f.h + (f.h2 - f.h) * i.t;
            return h * flatBell(i.d / w, flat);
          },
        });
        break;
      }
      case "mound":
      case "hollow": {
        const e = ell(f), h = f.k === "mound" ? f.h : -f.d;
        terms.push({
          k: f.k,
          box: boxEll(e, 0),
          y: (x, z) => {
            const { r } = ellipse(e, x, z);
            return r >= 1 ? 0 : h * bell(r);
          },
        });
        break;
      }
      case "bowl": {
        const e = ell(f), flat = f.flat ?? 0.5, rim = f.rim ?? 0, rimW = m(f.rimW ?? f.r / 3);
        terms.push({
          k: f.k,
          box: boxEll(e, rim ? rimW : 0),
          fineBox: boxEll(e, rim ? rimW : 0),
          y: (x, z) => {
            const { r, sd } = ellipse(e, x, z);
            let y = 0;
            // the floor: flat inside `flat` of the radius, rising to the edge along a cosine
            if (r < 1) y = -f.d * flatBell(r, flat);
            if (rim && Math.abs(sd) < rimW) y += rim * bell(Math.abs(sd) / rimW);
            return y;
          },
          zone: (x, z, margin) => Math.abs(ellipse(e, x, z).sd) < Math.max(rimW, m(f.r) * 0.5) + margin,
        });
        break;
      }
      case "pot": {
        const b = bunkers[f.b];
        if (!b) break;
        const e: Ell = { x: m(b.x), z: m(b.z), rx: m(b.rx), rz: m(b.rz), c: Math.cos(b.rot ?? 0), s: Math.sin(b.rot ?? 0) };
        const face = f.face ?? 0.3, lip = f.lip ?? 0.5, r0 = 1 - face;
        const dig = (x: number, z: number) => {
          const { r } = ellipse(e, x, z);
          if (r > 1.4) return 0;
          // the floor, a face between r0 and 1 (steepest in the middle of it), and a lip, highest toward the green (+z)
          let d = f.d * (1 - smooth((r - r0) / face));
          const front = 0.35 + 0.65 * Math.max(0, Math.min(1, ((z - e.z) / e.rz + 0.2) / 1.2));
          d -= lip * front * Math.exp(-(((r - 1.1) / 0.12) ** 2));
          return d;
        };
        pots.set(f.b, dig);
        potTerms.push({ k: f.k, box: boxEll(e, 0), fineBox: boxEll(e, 0), y: () => 0, zone: (x, z, margin) => ellipse(e, x, z).sd < Math.min(e.rx, e.rz) * 0.5 + margin });
        break;
      }
      case "channel": {
        const path = mp(f.path), hw = m(f.w) / 2, bl = m(f.bank), br = m(f.bankR ?? f.bank);
        const reach = hw + Math.max(bl, br);
        terms.push({
          k: f.k,
          box: boxOf(path, reach),
          fineBox: boxOf(path, reach),
          y: (x, z) => {
            const i = pathInfo(path, x, z);
            if (i.d >= reach) return 0;
            const bank = i.s >= 0 ? bl : br;
            const d = f.d2 === undefined ? f.d : f.d + (f.d2 - f.d) * i.t;
            return -d * (1 - smooth((i.d - hw) / bank));
          },
          zone: (x, z, margin) => pathInfo(path, x, z).d < reach + margin,
        });
        break;
      }
      case "shelf": {
        const e = ell(f), edge = m(f.edge);
        terms.push({
          k: f.k,
          box: boxEll(e, edge),
          fineBox: boxEll(e, edge),
          y: (x, z) => f.h * (1 - smooth(ellipse(e, x, z).sd / edge)),
          zone: (x, z, margin) => {
            const sd = ellipse(e, x, z).sd;
            return sd > -edge * 0.6 - margin && sd < edge + margin;
          },
        });
        break;
      }
      case "face":
      case "terrace": {
        const path = mp(f.path);
        const n = f.k === "face" ? 1 : Math.max(1, Math.round(f.n));
        const riser = m(f.k === "face" ? f.w : f.riser), tread = f.k === "face" ? 0 : m(f.tread);
        const step = f.h / n, reach = m(f.reach ?? 40), fade = m(f.fade ?? 12);
        const top = (n - 1) * tread + riser;
        terms.push({
          k: f.k,
          // the whole raised ground is gentle; the mesh is refined only along the faces
          box: boxOf(path, top + 2 * reach + fade),
          fineBox: boxOf(path, top + fade),
          y: (x, z) => {
            const i = pathInfo(path, x, z);
            const along = 1 - smooth(i.over / fade);
            if (along <= 0) return 0;
            let up = 0;
            for (let k = 0; k < n; k++) up += step * smooth((i.s - (k * tread - riser / 2)) / riser);
            const back = 1 - smooth((i.s - top - reach) / reach);
            return up * back * along;
          },
          zone: (x, z, margin) => {
            const i = pathInfo(path, x, z);
            return i.over < fade + margin && i.s > -riser - margin && i.s < top + margin;
          },
        });
        break;
      }
    }
  }
  const all = [...terms, ...potTerms];
  const inBox = (b: [number, number, number, number], x: number, z: number, g = 0) => x >= b[0] - g && x <= b[2] + g && z >= b[1] - g && z <= b[3] + g;
  return {
    y: (x, z) => {
      let y = 0;
      for (const t of terms) if (inBox(t.box, x, z)) y += t.y(x, z);
      return y;
    },
    pot: (bi, x, z) => pots.get(bi)?.(x, z) ?? null,
    fine: (x, z, margin) => {
      let lvl: 0 | 1 | 2 = 0;
      for (const t of all)
        if (t.fineBox && inBox(t.fineBox, x, z, margin) && (!t.zone || t.zone(x, z, margin))) {
          if (t.k === "pot" || t.k === "bowl") return 2;
          lvl = 1;
        }
      return lvl;
    },
    bounds: all.map((t) => ({ k: t.k, box: t.box })),
    near: (x, z, g) => all.some((t) => inBox(t.box, x, z, g)),
  };
}
