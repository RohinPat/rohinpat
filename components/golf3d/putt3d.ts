import * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { GH, GW, greenHeight, puttAim, zone, type Putt } from "@/components/offhours/golf/green";
import { reliefOf } from "./relief";

// Putting on the 3D green. The putt itself is green.ts's (its ball, its physics,
// its controls); this is what you see of it: a camera low behind the ball looking
// down the line, a putter that addresses the ball and swings through, a dotted line
// as far as the putt would roll on a flat green, the path the last putt took, and
// when reading, water that runs downhill and arrows down the slope.
//
// Everything here is in the course's frame (metres, x right, z downrange); the
// green's own coordinates map to it with hole.fromGreen (x the same way, y the
// opposite way to z), so a direction (dx, dy) on the green is (dx, -dy) here.

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// ---------------------------------------------------------------- the scene

/** marks lying on the green draw over it: they sit a few millimetres up, and this settles the rest */
const ON_GROUND = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 } as const;

const DOTS = 140;
const DOT_GAP = 0.15;
const TRAIL = 600;
const DROP_SEG = 59;
const DROPS = 420;
const ARROWS = 260;

export type Putt3D = {
  group: THREE.Group;
  /** place everything for this frame; `ball` is where the ball is drawn (course frame) */
  update: (hole: BuiltHole, p: Putt, t: number, reduce: boolean) => void;
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

  // ---- the line: dots on the ground and a ring where a flat putt would stop
  const dotG = keep(new THREE.CircleGeometry(0.02, 10));
  dotG.rotateX(-Math.PI / 2);
  const dotM = keep(new THREE.MeshBasicMaterial({ color: "#f2ead7", transparent: true, opacity: 0.9, depthWrite: false, ...ON_GROUND }));
  const dots = new THREE.InstancedMesh(dotG, dotM, DOTS);
  dots.frustumCulled = false;
  group.add(dots);
  const ringG = keep(new THREE.RingGeometry(0.07, 0.092, 28));
  ringG.rotateX(-Math.PI / 2);
  const ringM = keep(new THREE.MeshBasicMaterial({ color: "#8ad9a8", transparent: true, opacity: 0.95, depthWrite: false, ...ON_GROUND, side: THREE.DoubleSide }));
  const ring = new THREE.Mesh(ringG, ringM);
  group.add(ring);

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
  const arrowM = keep(new THREE.MeshBasicMaterial({ color: "#f2ead7", transparent: true, opacity: 0.55, depthWrite: false, ...ON_GROUND, side: THREE.DoubleSide }));
  const arrows = new THREE.InstancedMesh(arrowG, arrowM, ARROWS);
  arrows.frustumCulled = false;
  group.add(arrows);
  let arrowsFor: BuiltHole | null = null;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), at = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();

  const hide = () => {
    putter.visible = dots.visible = ring.visible = trail.visible = drops.visible = arrows.visible = false;
  };

  /** the slope arrows for a hole's green, once: every 1.15 m on the putting surface, downhill, longer where it is steeper */
  const buildArrows = (hole: BuiltHole) => {
    arrowsFor = hole;
    const rel = reliefOf(hole);
    const H = hole.green;
    let n = 0;
    const step = 1.15, e = 0.05;
    for (let gy = step / 2; gy < GH && n < ARROWS; gy += step)
      for (let gx = step / 2; gx < GW && n < ARROWS; gx += step) {
        if (zone(H, gx, gy) !== 0) continue;
        const sx = (greenHeight(H, gx + e, gy) - greenHeight(H, gx - e, gy)) / (2 * e);
        const sy = (greenHeight(H, gx, gy + e) - greenHeight(H, gx, gy - e)) / (2 * e);
        const m = Math.hypot(sx, sy);
        if (m < 0.004) continue;
        const [x, z] = hole.fromGreen(gx, gy);
        // downhill on the green is (-sx, -sy); in the course's frame (-sx, +sy)
        const yaw = Math.atan2(-sx, sy);
        const len = Math.min(0.5, 6 * m + 0.08);
        q.setFromAxisAngle(yAxis, yaw);
        m4.compose(at.set(x, rel.y(x, z) + 0.01, z), q, sc.set(len * 0.9, 1, len));
        arrows.setMatrixAt(n++, m4);
      }
    arrows.count = n;
    arrows.instanceMatrix.needsUpdate = true;
  };

  const update = (hole: BuiltHole, p: Putt, t: number, reduce: boolean) => {
    const rel = reliefOf(hole);
    const ground = (gx: number, gy: number, lift: number): [number, number, number] => {
      const [x, z] = hole.fromGreen(gx, gy);
      return [x, rel.yG(gx, gy) + lift, z];
    };
    const b = p.ball;

    // ---- the putter
    let pv: { dx: number; dy: number; back: number; alpha: number } | null = null;
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
    } else if (!b.moving && !b.sunk && !p.tap && !p.reading && !p.done) {
      const d = aim ?? { dx: Math.cos(p.kAngle), dy: Math.sin(p.kAngle), pow: 0 };
      pv = { dx: d.dx, dy: d.dy, back: 0.05 + d.pow * 0.42, alpha: 1 };
    }
    putter.visible = !!pv && pv.alpha > 0.02;
    if (pv && putter.visible) {
      // the face 2 cm behind the ball at address, square to the line; the shaft leans up to the golfer on its left
      const hx = b.x - pv.dx * (pv.back + 0.035), hy = b.y - pv.dy * (pv.back + 0.035);
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

    // ---- the line, as far as a flat putt would roll
    dots.visible = ring.visible = !!aim && !p.putter;
    if (aim && !p.putter) {
      const L = aim.flat;
      const n = Math.min(DOTS, Math.floor(L / DOT_GAP));
      for (let i = 0; i < n; i++) {
        const s = (i + 1) * DOT_GAP;
        const [x, y, z] = ground(b.x + aim.dx * s, b.y + aim.dy * s, 0.004);
        m4.makeTranslation(x, y, z);
        dots.setMatrixAt(i, m4);
      }
      dots.count = n;
      dots.instanceMatrix.needsUpdate = true;
      const [x, y, z] = ground(b.x + aim.dx * L, b.y + aim.dy * L, 0.005);
      ring.position.set(x, y, z);
      ringM.color.set(aim.pow > 0.9 ? "#e5484d" : "#8ad9a8");
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

    // ---- reading the green
    drops.visible = arrows.visible = p.reading;
    if (p.reading) {
      if (arrowsFor !== hole) buildArrows(hole);
      arrowM.opacity = 0.55 * Math.min(1, p.readT * 2.5);
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
