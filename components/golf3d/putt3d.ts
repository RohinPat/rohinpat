import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { GH, GW, TAP_HIT, greenHeight, puttAim, puttPowerFor, puttRoll, zone, type Hole, type Putt } from "@/components/offhours/golf/green";
import { reliefOf } from "./relief";

// Putting on the 3D green. The putt itself is green.ts's (its ball, its physics,
// its controls); this is what you see of it: a camera low behind the ball looking
// down the line, a putter that addresses the ball and swings through, a dotted line
// along the ball's own predicted roll (its first half, so the break shows without
// solving the putt), the path the last putt took, and when reading, water that runs
// downhill and arrows down the slope.
//
// Everything here is in the course's frame (metres, x right, z downrange); the
// green's own coordinates map to it with hole.fromGreen (x the same way, y the
// opposite way to z), so a direction (dx, dy) on the green is (dx, -dy) here.

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// ---------------------------------------------------------------- the scene

/** marks lying on the green draw over it: they sit a few millimetres up, and this settles the rest */
const ON_GROUND = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 } as const;

const DOTS = 240;
const DOT_GAP = 0.15;
const TRAIL = 600;
const DROP_SEG = 59;
const DROPS = 420;
const ARROWS = 260;

export type Putt3D = {
  group: THREE.Group;
  /** place everything for this frame; `ball` is where the ball is drawn (course frame) */
  update: (hole: BuiltHole, p: Putt, t: number, reduce: boolean, eye?: { x: number; y: number; z: number }, mapArrows?: number, lowView?: boolean) => void;
  hide: () => void;
  dispose: () => void;
};

export function createPutt3D(): Putt3D {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(o: T) => (disposables.push(o), o);

  // ---- the putter: a blade with a sight line, and a shaft up to where the hands would be
  const putter = new THREE.Group();
  // always blended, so the putter can fade out after the stroke without a material rebuild
  const steel = keep(new THREE.MeshPhongMaterial({ color: "#c9ced1", shininess: 70, transparent: true }));
  const black = keep(new THREE.MeshLambertMaterial({ color: "#1b1f1d", transparent: true }));
  const cream = keep(new THREE.MeshBasicMaterial({ color: "#f2ead7", transparent: true }));
  const head = new THREE.Mesh(keep(new THREE.BoxGeometry(0.11, 0.024, 0.026)), black);
  head.position.y = 0.013;
  head.castShadow = true;
  const face = new THREE.Mesh(keep(new THREE.BoxGeometry(0.112, 0.022, 0.004)), steel);
  face.position.set(0, 0.013, 0.013);
  const sight = new THREE.Mesh(keep(new THREE.BoxGeometry(0.004, 0.001, 0.02)), cream);
  sight.position.set(0, 0.0255, 0);
  const shaftG = keep(new THREE.CylinderGeometry(0.0055, 0.0055, 1, 6));
  shaftG.translate(0, 0.5, 0);
  const shaft = new THREE.Mesh(shaftG, steel);
  shaft.castShadow = true;
  const grip = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.012, 0.01, 0.26, 8)), black);
  putter.add(head, face, sight, shaft, grip);
  group.add(putter);

  // ---- the line: dots along the ball's roll (its first half), and a tick across the line where that part ends
  const dotG = keep(new THREE.CircleGeometry(0.02, 10));
  dotG.rotateX(-Math.PI / 2);
  const dotM = keep(new THREE.MeshBasicMaterial({ color: "#f2ead7", transparent: true, opacity: 0.9, depthWrite: false, ...ON_GROUND }));
  const dots = new THREE.InstancedMesh(dotG, dotM, DOTS);
  dots.frustumCulled = false;
  group.add(dots);
  const tickG = keep(new THREE.BoxGeometry(0.16, 0.004, 0.02));
  const tickM = keep(new THREE.MeshBasicMaterial({ color: "#f2ead7", transparent: true, opacity: 0.9, depthWrite: false, ...ON_GROUND }));
  const tick = new THREE.Mesh(tickG, tickM);
  group.add(tick);
  // the roll is a few hundred steps: it is worked out again only when the aim or the power changes
  let rollKey = "";
  let rollG: Hole | null = null;
  let roll: { pts: { x: number; y: number; s: number }[]; len: number } = { pts: [], len: 0 };
  const noRot = new THREE.Quaternion();

  // ---- where the last putt went
  const trailPos = new Float32Array(TRAIL * 3);
  const trailG = keep(new THREE.BufferGeometry());
  trailG.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  const trailM = keep(new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.6, depthWrite: false, ...ON_GROUND }));
  const trail = new THREE.Line(trailG, trailM);
  trail.frustumCulled = false;
  group.add(trail);

  // ---- reading: water trails and slope arrows
  const dropPos = new Float32Array(DROPS * DROP_SEG * 2 * 3);
  const dropCol = new Float32Array(DROPS * DROP_SEG * 2 * 4);
  const dropG = keep(new THREE.BufferGeometry());
  dropG.setAttribute("position", new THREE.BufferAttribute(dropPos, 3));
  dropG.setAttribute("color", new THREE.BufferAttribute(dropCol, 4));
  const dropM = keep(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, ...ON_GROUND }));
  const drops = new THREE.LineSegments(dropG, dropM);
  drops.frustumCulled = false;
  group.add(drops);
  const arrowG = keep(new THREE.BufferGeometry());
  // a flat arrow one unit long pointing down +z: a tail and a head
  arrowG.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-0.05, 0, -0.5, 0.05, 0, -0.5, 0.05, 0, 0.15, -0.05, 0, -0.5, 0.05, 0, 0.15, -0.05, 0, 0.15, -0.2, 0, 0.15, 0.2, 0, 0.15, 0, 0, 0.5], 3),
  );
  // the arrows take their colour per instance (dark on the grass; the ones by the line are bright), so the material is white
  const arrowM = keep(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.72, depthWrite: false, ...ON_GROUND, side: THREE.DoubleSide }));
  const arrows = new THREE.InstancedMesh(arrowG, arrowM, ARROWS);
  arrows.frustumCulled = false;
  group.add(arrows);
  let arrowsFor: BuiltHole | null = null;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), at = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();

  const hide = () => {
    putter.visible = dots.visible = tick.visible = trail.visible = drops.visible = arrows.visible = false;
  };

  /** the aim the line shows: the putt's own while it is being lined up (live), else the suggested pace at the cup (faint) */
  const lineAim = (p: Putt, t: number) => {
    const aim = puttAim(p, t);
    if (aim && aim.pow > 0.02) return { dx: aim.dx, dy: aim.dy, pow: aim.pow, live: true };
    const dist = Math.hypot(p.hole.cup[0] - p.ball.x, p.hole.cup[1] - p.ball.y);
    return { dx: Math.cos(p.kAngle), dy: Math.sin(p.kAngle), pow: puttPowerFor(dist), live: !!aim };
  };

  /** the ball's roll for this green, ball, aim and power; cached until one of them changes */
  const rollFor = (H: Hole, x: number, y: number, dx: number, dy: number, pow: number) => {
    const key = [x, y, dx, dy, pow].map((v) => v.toFixed(4)).join(",");
    if (key !== rollKey || H !== rollG) {
      rollKey = key;
      rollG = H;
      roll = puttRoll(H, x, y, dx, dy, pow);
    }
    return roll;
  };

  /** the green's point `s` metres along a roll */
  const along = (pts: { x: number; y: number; s: number }[], s: number): [number, number] => {
    let j = 0;
    while (j < pts.length - 2 && pts[j + 1].s < s) j++;
    const a = pts[j], c = pts[j + 1] ?? a;
    const u = c.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (c.s - a.s))) : 0;
    return [a.x + (c.x - a.x) * u, a.y + (c.y - a.y) * u];
  };

  /** the slope arrows for a hole's green, once: every 1.15 m on the putting surface, downhill, longer where it is steeper */
  const arrowSet: { gx: number; gy: number; x: number; y: number; z: number; yaw: number; len: number }[] = [];
  const nearC = new THREE.Color("#fff6cf"), farC = new THREE.Color("#0e3a24");
  let arrowKey = "";
  const buildArrows = (hole: BuiltHole) => {
    arrowsFor = hole;
    arrowKey = "";
    arrowSet.length = 0;
    const rel = reliefOf(hole);
    const H = hole.green;
    const step = 1.15, e = 0.05;
    for (let gy = step / 2; gy < GH && arrowSet.length < ARROWS; gy += step)
      for (let gx = step / 2; gx < GW && arrowSet.length < ARROWS; gx += step) {
        if (zone(H, gx, gy) !== 0) continue;
        const sx = (greenHeight(H, gx + e, gy) - greenHeight(H, gx - e, gy)) / (2 * e);
        const sy = (greenHeight(H, gx, gy + e) - greenHeight(H, gx, gy - e)) / (2 * e);
        const m = Math.hypot(sx, sy);
        if (m < 0.004) continue;
        const [x, z] = hole.fromGreen(gx, gy);
        // downhill on the green is (-sx, -sy); in the course's frame (-sx, +sy)
        arrowSet.push({ gx, gy, x, y: rel.y(x, z) + 0.01, z, yaw: Math.atan2(-sx, sy), len: Math.min(0.5, 6 * m + 0.08) });
      }
    placeArrows(hole, null);
  };
  /**
   * Places the arrows, and when a ball is given, those within 0.5 m of its line to the cup are larger and bright, the
   * rest dark (they were cream on the pale green and lost). Redone only when the ball moves.
   */
  const placeArrows = (hole: BuiltHole, ball: { x: number; y: number } | null) => {
    const [cx, cy] = hole.green.cup;
    const bx = ball ? ball.x : cx, by = ball ? ball.y : cy;
    const vx = cx - bx, vy = cy - by, vv = Math.max(1e-6, vx * vx + vy * vy);
    arrowSet.forEach((a, i) => {
      const t = Math.max(0, Math.min(1, ((a.gx - bx) * vx + (a.gy - by) * vy) / vv));
      const d = Math.hypot(bx + vx * t - a.gx, by + vy * t - a.gy);
      const near = !!ball && d < 0.5;
      const s = near ? 1.4 : 1;
      q.setFromAxisAngle(yAxis, a.yaw);
      m4.compose(at.set(a.x, a.y, a.z), q, sc.set(a.len * 0.9 * s, 1, a.len * s));
      arrows.setMatrixAt(i, m4);
      arrows.setColorAt(i, near ? nearC : farC);
    });
    arrows.count = arrowSet.length;
    arrows.instanceMatrix.needsUpdate = true;
    if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
  };

  /** `mapArrows` is how far in the map view is (0 when it is not up): its slope arrows show without the water */
  /** `lowView`: the low view looks along the line from behind the ball, so the putter is left out of the way */
  const update = (hole: BuiltHole, p: Putt, t: number, reduce: boolean, eye?: { x: number; y: number; z: number }, mapArrows = 0, lowView = false) => {
    const rel = reliefOf(hole);
    const ground = (gx: number, gy: number, lift: number): [number, number, number] => {
      const [x, z] = hole.fromGreen(gx, gy);
      return [x, rel.yG(gx, gy) + lift, z];
    };
    const b = p.ball;

    // ---- the putter
    let pv: { dx: number; dy: number; back: number; alpha: number; x?: number; y?: number } | null = null;
    const aim = puttAim(p, t);
    if (p.putter) {
      const pt = p.putter;
      const arrive = 0.11 + (1 - pt.pull) * 0.04;
      const startBack = 0.05 + pt.pull * 0.42;
      let back: number;
      if (pt.t < 0) back = startBack;
      else if (pt.t < arrive) back = startBack * (1 - smooth(pt.t / arrive) ** 1.4);
      else back = -Math.min(0.24, (pt.t - arrive) * 1.6) * (0.4 + pt.pull);
      pv = { dx: pt.dx, dy: pt.dy, back, alpha: pt.t > 0.32 ? Math.max(0, 1 - (pt.t - 0.32) / 0.18) : 1 };
    } else if (p.tap) {
      // a tap-in: the putter steps up behind where the ball stopped, draws back a little and taps it at the cup
      const tp = p.tap;
      const [cx, cy] = p.hole.cup;
      const l = Math.hypot(cx - tp.x, cy - tp.y) || 1;
      const k = smooth((tp.t - 0.3) / (TAP_HIT - 0.3 - 0.12));
      const back = tp.t < TAP_HIT - 0.12 ? 0.04 + 0.1 * k : tp.t < TAP_HIT ? 0.14 * (1 - smooth((tp.t - TAP_HIT + 0.12) / 0.12)) : -Math.min(0.1, (tp.t - TAP_HIT) * 0.8);
      pv = { dx: (cx - tp.x) / l, dy: (cy - tp.y) / l, back, alpha: Math.min(1, tp.t / 0.2) * (tp.t > TAP_HIT + 0.15 ? Math.max(0, 1 - (tp.t - TAP_HIT - 0.15) / 0.2) : 1), x: tp.x, y: tp.y };
    } else if (!b.moving && !b.sunk && !p.reading && !p.done) {
      const d = aim ?? { dx: Math.cos(p.kAngle), dy: Math.sin(p.kAngle), pow: 0 };
      pv = { dx: d.dx, dy: d.dy, back: 0.05 + d.pow * 0.42, alpha: 1 };
    }
    putter.visible = !!pv && pv.alpha > 0.02 && !lowView;
    if (pv && putter.visible) {
      // the face 2 cm behind the ball at address, square to the line; the shaft leans up to the golfer on its left
      const hx = (pv.x ?? b.x) - pv.dx * (pv.back + 0.035), hy = (pv.y ?? b.y) - pv.dy * (pv.back + 0.035);
      const [x, y, z] = ground(hx, hy, 0);
      const ux = pv.dx, uz = -pv.dy;
      putter.position.set(x, y, z);
      putter.rotation.set(0, Math.atan2(ux, uz), 0);
      // in the putter's own frame: z toward the target, x to its left (the frame is the course's, mirrored on screen)
      const hands = new THREE.Vector3(-0.3, 0.8, -0.04);
      const heel = new THREE.Vector3(-0.045, 0.02, 0);
      dir.copy(hands).sub(heel);
      const len = dir.length();
      shaft.position.copy(heel);
      shaft.quaternion.setFromUnitVectors(yAxis, dir.normalize());
      shaft.scale.set(1, len, 1);
      grip.position.copy(hands).addScaledVector(dir, -0.12);
      grip.quaternion.copy(shaft.quaternion);
      for (const mat of [steel, black, cream]) mat.opacity = pv.alpha;
    }

    // ---- the line: the ball's own roll as far as its first half, fading over the last part of that, and a tick where it
    // ends. Faint at address; full while it is being lined up or the power is pulled back.
    const L = !b.moving && !b.sunk && !p.reading && !p.done && !p.putter && !p.tap ? lineAim(p, t) : null;
    dots.visible = tick.visible = !!L && !p.putter;
    if (L && !p.putter) {
      dotM.opacity = tickM.opacity = L.live ? 0.9 : 0.6;
      const r = rollFor(p.hole, b.x, b.y, L.dx, L.dy, L.pow);
      const half = r.len / 2;
      const fadeFrom = half * 0.6;
      // the dots keep a roughly constant size on screen: they grow with distance from the eye, up to 4x
      const grow = (x: number, y: number, z: number) => (eye ? Math.min(4, Math.max(1, Math.hypot(x - eye.x, y - eye.y, z - eye.z) / 3)) : 1);
      let n = 0;
      for (let s = DOT_GAP; s <= half && n < DOTS; s += DOT_GAP) {
        const [gx, gy] = along(r.pts, s);
        const f = s > fadeFrom ? 1 - 0.8 * smooth((s - fadeFrom) / Math.max(1e-3, half - fadeFrom)) : 1;
        const [x, y, z] = ground(gx, gy, 0.004);
        const k = f * grow(x, y, z);
        m4.compose(at.set(x, y, z), noRot, sc.set(k, 1, k));
        dots.setMatrixAt(n++, m4);
      }
      dots.count = n;
      dots.instanceMatrix.needsUpdate = true;
      // the tick: across the line where the shown part ends, square to the roll there (a green direction (dx, dy) is
      // (dx, -dy) on the ground, and a box's long side along x turns to (cos, -sin) under a yaw)
      const [ex, ey] = along(r.pts, half);
      const [px0, py0] = along(r.pts, Math.max(0, half - 0.05)), [px1, py1] = along(r.pts, half + 0.05);
      const tx = px1 - px0, ty = py1 - py0, tl = Math.hypot(tx, ty) || 1;
      const ux = tx / tl, uz = -ty / tl;
      const [tkx, tky, tkz] = ground(ex, ey, 0.005);
      tick.position.set(tkx, tky, tkz);
      tick.scale.setScalar(grow(tkx, tky, tkz));
      tick.quaternion.setFromAxisAngle(yAxis, Math.atan2(-ux, -uz));
    }

    // ---- the last putt's path, fading once the ball stops
    const fadeA = b.moving ? 0.6 : Math.max(0, 0.6 - p.trailAge * 0.12);
    trail.visible = p.trail.length > 1 && !p.reading && fadeA > 0;
    if (trail.visible) {
      const n = Math.min(TRAIL, p.trail.length);
      const off = p.trail.length - n;
      for (let i = 0; i < n; i++) {
        const [gx, gy] = p.trail[off + i];
        const [x, y, z] = ground(gx, gy, 0.006);
        trailPos[i * 3] = x;
        trailPos[i * 3 + 1] = y;
        trailPos[i * 3 + 2] = z;
      }
      trailG.setDrawRange(0, n);
      trailG.attributes.position.needsUpdate = true;
      trailM.opacity = fadeA;
    }

    // ---- reading the green: the arrows (and the water) of the old read mode; the map view shows the arrows alone
    drops.visible = p.reading;
    arrows.visible = p.reading || mapArrows > 0;
    if (arrows.visible) {
      if (arrowsFor !== hole) buildArrows(hole);
      const key = `${b.x.toFixed(2)},${b.y.toFixed(2)}`;
      if (key !== arrowKey) {
        arrowKey = key;
        placeArrows(hole, b);
      }
      arrowM.opacity = 0.72 * (p.reading ? Math.min(1, p.readT * 2.5) : mapArrows);
    }
    if (p.reading) {
      let k = 0;
      for (const d of p.drops.slice(-DROPS)) {
        const al = Math.min(1, d.life) * 0.85;
        const tr = d.trail;
        for (let i = 1; i < tr.length && i <= DROP_SEG; i++) {
          for (const [j, pt] of [
            [0, tr[i - 1]],
            [1, tr[i]],
          ] as const) {
            const [x, y, z] = ground(pt[0], pt[1], 0.008);
            const o = (k * 2 + j) * 3, oc = (k * 2 + j) * 4;
            dropPos[o] = x;
            dropPos[o + 1] = y;
            dropPos[o + 2] = z;
            dropCol[oc] = 0.63;
            dropCol[oc + 1] = 0.86;
            dropCol[oc + 2] = 1;
            dropCol[oc + 3] = al * (0.35 + (0.65 * i) / tr.length);
          }
          k++;
        }
      }
      dropG.setDrawRange(0, k * 2);
      dropG.attributes.position.needsUpdate = true;
      dropG.attributes.color.needsUpdate = true;
    }
    void reduce;
  };

  return {
    group,
    update,
    hide,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
