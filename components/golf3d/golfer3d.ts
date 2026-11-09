import * as THREE from "three";
import type { Club } from "@/components/offhours/golf/flight";
import { golferFrame, golferJoints, type Joints, type Pose } from "@/components/offhours/golf/golfer";

// The golfer in 3D: the same posed joints the 2D view draws (golfer.ts), made of
// capsules, a slab of a torso, a head and a cap, and the club. Rebuilt from the
// pose every frame: about twenty meshes moved, nothing allocated.

type V = [number, number, number];

const SKIN = "#d9a679";
const SHIRT = "#f2ead7";
const PANTS = "#2b3345";
const CAP = "#0d100e";
const SHOE = "#f4f1e8";

type Limb = { a: keyof Joints; b: keyof Joints; r: number; mat: THREE.Material; mesh: THREE.Mesh; ja: THREE.Mesh; jb: THREE.Mesh };

export type Golfer3D = { group: THREE.Group; update: (ball: V, yaw: number, club: Club, pose: Pose) => void; dispose: () => void };

export function buildGolfer3D(): Golfer3D {
  const group = new THREE.Group();
  const mats = {
    skin: new THREE.MeshLambertMaterial({ color: SKIN }),
    shirt: new THREE.MeshLambertMaterial({ color: SHIRT }),
    pants: new THREE.MeshLambertMaterial({ color: PANTS }),
    cap: new THREE.MeshLambertMaterial({ color: CAP }),
    shoe: new THREE.MeshLambertMaterial({ color: SHOE }),
    shaft: new THREE.MeshLambertMaterial({ color: "#1a1c1e" }),
    wood: new THREE.MeshLambertMaterial({ color: "#272b2e" }),
    iron: new THREE.MeshPhongMaterial({ color: "#c9ced1", shininess: 60 }),
  };
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const ball = new THREE.SphereGeometry(1, 12, 8);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const o = new THREE.Mesh(g, m);
    o.castShadow = true;
    group.add(o);
    return o;
  };
  const limbs: Limb[] = [];
  const limb = (a: keyof Joints, b: keyof Joints, r: number, mat: THREE.Material) =>
    limbs.push({ a, b, r, mat, mesh: mesh(cyl, mat), ja: mesh(ball, mat), jb: mesh(ball, mat) });
  limb("hipR", "kneeR", 0.075, mats.pants);
  limb("kneeR", "footR", 0.062, mats.pants);
  limb("footR", "toeR", 0.045, mats.shoe);
  limb("hipL", "kneeL", 0.078, mats.pants);
  limb("kneeL", "footL", 0.064, mats.pants);
  limb("footL", "toeL", 0.046, mats.shoe);
  limb("hipL", "hipR", 0.115, mats.pants);
  limb("shL", "shR", 0.075, mats.shirt);
  limb("shR", "elR", 0.058, mats.shirt);
  limb("elR", "handR", 0.044, mats.skin);
  limb("shL", "elL", 0.058, mats.shirt);
  limb("elL", "handL", 0.044, mats.skin);
  limb("neck", "headC", 0.05, mats.skin);
  const torso = mesh(box, mats.shirt);
  const head = mesh(ball, mats.skin);
  const cap = mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mats.cap);
  const brim = mesh(box, mats.cap);
  const shaft = mesh(cyl, mats.shaft);
  const clubHead = mesh(box, mats.iron);

  const W = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
  let frame = golferFrame([0, 0, 0], 0, { len: 1 } as Club);
  const world = (p: V, out: THREE.Vector3) => {
    const { origin: o, ex, ez } = frame;
    return out.set(o[0] + ex[0] * p[0] + ez[0] * p[2], o[1] + p[1], o[2] + ex[2] * p[0] + ez[2] * p[2]);
  };
  const dir = (p: V, out: THREE.Vector3) => {
    const { ex, ez } = frame;
    return out.set(ex[0] * p[0] + ez[0] * p[2], p[1], ex[2] * p[0] + ez[2] * p[2]).normalize();
  };
  /** a unit cylinder stretched from a to b with radius r */
  const span = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    D.subVectors(b, a);
    const len = D.length() || 1e-4;
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, D.multiplyScalar(1 / len));
    m.scale.set(r, len, r);
  };

  const update = (b: V, yaw: number, club: Club, pose: Pose) => {
    frame = golferFrame(b, yaw, club);
    const j = golferJoints(pose, club);
    for (const l of limbs) {
      world(j[l.a], A);
      world(j[l.b], B);
      span(l.mesh, A, B, l.r);
      l.ja.position.copy(A);
      l.ja.scale.setScalar(l.r);
      l.jb.position.copy(B);
      l.jb.scale.setScalar(l.r);
    }
    // the torso: a slab from the hips to the shoulders, as wide as the shoulders
    world(j.shL, A);
    world(j.shR, B);
    const sw = A.distanceTo(B);
    X.subVectors(A, B).normalize();
    const mid = W.addVectors(A, B).multiplyScalar(0.5);
    const hip = world([(j.hipL[0] + j.hipR[0]) / 2, (j.hipL[1] + j.hipR[1]) / 2, (j.hipL[2] + j.hipR[2]) / 2], D);
    Y.subVectors(mid, hip);
    const th = Y.length();
    Y.normalize();
    Z.crossVectors(X, Y).normalize();
    X.crossVectors(Y, Z);
    M.makeBasis(X, Y, Z);
    torso.quaternion.setFromRotationMatrix(M);
    torso.position.addVectors(mid, hip).multiplyScalar(0.5);
    torso.scale.set(sw * 1.02, th, 0.24);
    // head and cap, the brim where the head looks
    world(j.headC, A);
    head.position.copy(A);
    head.scale.setScalar(0.105);
    cap.position.copy(A).y += 0.012;
    cap.scale.setScalar(0.112);
    dir(j.headDir, D);
    D.y = 0;
    D.normalize();
    brim.position.copy(A).addScaledVector(D, 0.12);
    brim.position.y += 0.03;
    brim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), D);
    brim.scale.set(0.16, 0.012, 0.11);
    // the club: shaft from the lead hand to the head; a fat head for a wood, a blade for an iron
    world(j.handL, A);
    world(j.clubHead, B);
    span(shaft, A, B, 0.007);
    const wood = club.len > 1.04;
    clubHead.material = wood ? mats.wood : mats.iron;
    clubHead.position.copy(B);
    D.subVectors(B, A).normalize();
    clubHead.quaternion.setFromUnitVectors(UP, D);
    clubHead.scale.set(wood ? 0.11 : 0.075, wood ? 0.05 : 0.03, wood ? 0.1 : 0.022);
  };

  return {
    group,
    update,
    dispose: () => {
      cyl.dispose();
      ball.dispose();
      box.dispose();
      (cap.geometry as THREE.BufferGeometry).dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
  };
}
