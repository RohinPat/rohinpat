// Hole 9's sea cliff, in yards (the hole's frame: the tee at the origin, +z downrange, +x right). One line is the brink of
// the whole coast along the left of the hole: the in-play `cliff` feature walks it (course.ts), the backdrop's coast line
// is the same line in metres (components/golf3d/scenery/hole9.ts), so the cliff you play over and the sea cliffs beyond
// it are one coast. The sea, the low side, is on its left. Pure data, so the scenery can read it without the course.

type Pt = [number, number];

/**
 * The brink, walked with the sea on the left. North up the cliff beside the tee, then east along the south shore of the cove
 * to its head, across the neck (a channel 35 yd wide, 140 yd out, that cuts the whole fairway), back west along the north
 * bank, north along the west bank of the shelf the neck leads to, west along the north wall of the bay (where a drive that
 * carries 230 yd lands), then north again past the green and round the headland the lighthouse stands on.
 */
export const BRINK_9: Pt[] = [
  [-118, -140], [-118, -60], [-118, 0], [-117, 38],
  // the south shore of the cove, falling in toward its head
  [-108, 62], [-84, 82], [-52, 94], [-14, 100], [22, 102], [44, 104],
  // the neck's east end, a rock slot
  [56, 110], [60, 120], [54, 130],
  // the north bank, then the west bank of the shelf
  [42, 135], [22, 137], [0, 139], [-18, 147], [-29, 165], [-31, 190], [-30, 212], [-36, 223],
  // the north wall of the bay, and the cliff up to the green
  [-58, 225], [-86, 226], [-112, 230], [-130, 248], [-137, 280], [-138, 330], [-140, 380], [-136, 420],
  // the headland the lighthouse stands on, with the sea round it
  [-128, 450], [-112, 478], [-88, 498], [-52, 512], [-5, 520],
];

/** the brink points of the cove proper: where the water in play lies */
const COVE_FROM = 4, COVE_TO = 23;

/** the brink, moved `d` yd to the sea side (a mitred offset) */
function offset(path: Pt[], d: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[i], c = path[Math.min(path.length - 1, i + 1)];
    const n = (p: Pt, q: Pt): Pt => {
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      return [-(q[1] - p[1]) / l, (q[0] - p[0]) / l];
    };
    const n0 = i > 0 ? n(a, b) : n(b, c), n1 = i < path.length - 1 ? n(b, c) : n0;
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const stretch = Math.min(1.5, 1 / Math.max(0.05, mx * n0[0] + mz * n0[1]));
    out.push([b[0] + mx * d * stretch, b[1] + mz * d * stretch]);
  }
  return out;
}

/** a path with a point added every `gap` yd or so (so a smoothed ring through it keeps its shape) */
function dense(path: Pt[], gap: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / gap));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(path[path.length - 1]);
  return out;
}

/**
 * The water in play: the cove, as a closed shore (a `Lake`). It runs along the foot of the walls, 6 yd out from the brink
 * (the face and its scree are `cliff`, rock, not water) and closes out in the open sea, where the out of bounds takes over.
 */
export const COVE_9: Pt[] = (() => {
  const wall = offset(BRINK_9.slice(COVE_FROM, COVE_TO + 1), 6);
  const first = wall[0], last = wall[wall.length - 1];
  const mouth: Pt[] = [[last[0] - 10, last[1] + 2], [-150, 232], [-160, 190], [-160, 120], [-150, 62], [first[0] - 12, first[1] - 6]];
  return dense([...wall, ...mouth], 9);
})();
