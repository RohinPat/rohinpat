import { project, type Cam, type Drawable, type P2 } from "./scene";
import type { Club } from "./flight";

// A right-handed golfer drawn from a handful of posed joints, seen from behind
// down the line. The swing is three tracks of key poses (backswing, downswing,
// follow-through) blended by how far through each the swing is; hands, shoulders
// and hips are placed by the keys and the arms are solved with a simple
// two-bone bend. Local axes: X toward the ball, Y up, Z toward the target.

type V = [number, number, number];
type Key = { at: number; chest: number; hips: number; hands: V; shaft: V | null; sway: number; head: number };

const rad = (d: number) => (d * Math.PI) / 180;
// shaft: null means "from the hands to the ball"
const BACK: Key[] = [
  { at: 0, chest: 0, hips: 0, hands: [0.4, 0.84, 0.02], shaft: null, sway: 0, head: 0 },
  { at: 0.3, chest: rad(30), hips: rad(12), hands: [0.42, 0.94, -0.22], shaft: [0.1, -0.15, -1], sway: -0.01, head: rad(6) },
  { at: 0.6, chest: rad(62), hips: rad(28), hands: [0.28, 1.2, -0.42], shaft: [0.15, 0.8, -0.6], sway: -0.03, head: rad(14) },
  { at: 0.85, chest: rad(90), hips: rad(40), hands: [0.1, 1.52, -0.4], shaft: [0.15, 0.25, 0.95], sway: -0.05, head: rad(22) },
  { at: 1.0, chest: rad(100), hips: rad(46), hands: [0.04, 1.6, -0.36], shaft: [0.1, -0.1, 1], sway: -0.06, head: rad(26) },
];
const DOWN: Key[] = [
  { at: 0, chest: rad(-22), hips: rad(-36), hands: [0.46, 0.83, 0.12], shaft: null, sway: 0.1, head: rad(4) },
  { at: 0.2, chest: rad(-5), hips: rad(-22), hands: [0.44, 0.9, 0.14], shaft: [0.34, -0.7, -0.45], sway: 0.08, head: rad(8) },
  { at: 0.45, chest: rad(32), hips: rad(0), hands: [0.36, 1.0, 0.1], shaft: [0.35, -0.2, -0.85], sway: 0.04, head: rad(14) },
  { at: 0.75, chest: rad(76), hips: rad(28), hands: [0.2, 1.3, -0.15], shaft: [0.25, 0.6, 0.75], sway: -0.02, head: rad(22) },
  { at: 1.0, chest: rad(100), hips: rad(46), hands: [0.04, 1.6, -0.36], shaft: [0.1, -0.1, 1], sway: -0.06, head: rad(26) },
];
const FOLLOW: Key[] = [
  { at: 0, chest: rad(-22), hips: rad(-36), hands: [0.46, 0.83, 0.12], shaft: null, sway: 0.1, head: rad(4) },
  { at: 0.3, chest: rad(-62), hips: rad(-55), hands: [0.38, 1.0, 0.5], shaft: [0.15, 0.55, 0.85], sway: 0.14, head: rad(-4) },
  { at: 0.65, chest: rad(-98), hips: rad(-70), hands: [0.12, 1.45, 0.42], shaft: [-0.3, 0.2, 0.5], sway: 0.16, head: rad(-50) },
  { at: 1.0, chest: rad(-112), hips: rad(-78), hands: [-0.02, 1.58, 0.3], shaft: [-0.85, -0.3, -0.35], sway: 0.17, head: rad(-70) },
];

export type Pose = { chest: number; hips: number; hands: V; shaft: V; sway: number; head: number };

const smooth = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const norm = (v: V): V => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function sample(keys: Key[], u: number, ball: V): Pose {
  u = Math.max(0, Math.min(keys[keys.length - 1].at, u));
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1].at) i++;
  const a = keys[i], b = keys[i + 1];
  const f = smooth(Math.max(0, Math.min(1, (u - a.at) / (b.at - a.at))));
  const sh = (k: Key): V => k.shaft ?? norm([ball[0] - k.hands[0], ball[1] - k.hands[1], ball[2] - k.hands[2]]);
  const sa = sh(a), sb = sh(b);
  return {
    chest: lerp(a.chest, b.chest, f),
    hips: lerp(a.hips, b.hips, f),
    hands: [lerp(a.hands[0], b.hands[0], f), lerp(a.hands[1], b.hands[1], f), lerp(a.hands[2], b.hands[2], f)],
    shaft: norm([lerp(sa[0], sb[0], f), lerp(sa[1], sb[1], f), lerp(sa[2], sb[2], f)]),
    sway: lerp(a.sway, b.sway, f),
    head: lerp(a.head, b.head, f),
  };
}

export const ballLocal = (club: Club): V => [0.4 + Math.sqrt(Math.max(0.05, club.len * club.len - 0.82 * 0.82)), 0.02, 0];

export type SwingPhase = { kind: "back" | "down" | "follow"; u: number };
export function poseFor(sw: SwingPhase, club: Club): Pose {
  const ball = ballLocal(club);
  if (sw.kind === "back") return sample(BACK, sw.u, ball);
  if (sw.kind === "down") return sample(DOWN, sw.u, ball);
  return sample(FOLLOW, sw.u, ball);
}
export function blend(a: Pose, b: Pose, u: number): Pose {
  return {
    chest: lerp(a.chest, b.chest, u),
    hips: lerp(a.hips, b.hips, u),
    hands: [lerp(a.hands[0], b.hands[0], u), lerp(a.hands[1], b.hands[1], u), lerp(a.hands[2], b.hands[2], u)],
    shaft: norm([lerp(a.shaft[0], b.shaft[0], u), lerp(a.shaft[1], b.shaft[1], u), lerp(a.shaft[2], b.shaft[2], u)]),
    sway: lerp(a.sway, b.sway, u),
    head: lerp(a.head, b.head, u),
  };
}

const SKIN = "#d9a679";
const SHIRT = "#f2ead7";
const SHIRT_D = "#cfc6ad";
const PANTS = "#2b3345";
const PANTS_D = "#1c2230";
const CAP = "#0d100e";
const SHOE = "#f4f1e8";

type Seg = { a: V; b: V; r: number; col: string; edge: string; z: number };

/** where the club head is, in world space (for trails and the strike) */
export function clubHeadWorld(origin: V, ex: V, ez: V, pose: Pose, club: Club): V {
  const h = pose.hands;
  const hd: V = [h[0] + pose.shaft[0] * club.len, h[1] + pose.shaft[1] * club.len, h[2] + pose.shaft[2] * club.len];
  return [origin[0] + ex[0] * hd[0] + ez[0] * hd[2], origin[1] + hd[1], origin[2] + ex[2] * hd[0] + ez[2] * hd[2]];
}

export function golferDrawable(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  /** the ball's world position and the aim yaw */
  ball: V,
  yaw: number,
  club: Club,
  pose: Pose,
  trail: V[],
): Drawable | null {
  const ex: V = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const ez: V = [Math.sin(yaw), 0, Math.cos(yaw)];
  const bl = ballLocal(club);
  const origin: V = [ball[0] - ex[0] * bl[0], 0, ball[2] - ex[2] * bl[0]];
  const W = (p: V): V => [origin[0] + ex[0] * p[0] + ez[0] * p[2], origin[1] + p[1], origin[2] + ex[2] * p[0] + ez[2] * p[2]];
  const q = { x: 0, y: 0, d: 0, s: 0 } as P2;
  if (!project(cam, origin[0], 0, origin[2], q)) return null;
  const depth = q.d;

  // ---- joints
  const th = pose.chest, thh = pose.hips;
  const tau = rad(30);
  const sp: V = [Math.sin(tau), Math.cos(tau), 0];
  const pel: V = [pose.sway, 0.98, 0];
  const lc: V = [Math.sin(th), 0, Math.cos(th)]; // chest's left
  const lh: V = [Math.sin(thh), 0, Math.cos(thh)];
  const neck: V = [pel[0] + sp[0] * 0.56, pel[1] + sp[1] * 0.56, 0];
  const drop = 0.19 * Math.sin(tau) * Math.sin(th);
  const shL: V = [neck[0] + lc[0] * 0.19, neck[1] - 0.04 - drop, lc[2] * 0.19];
  const shR: V = [neck[0] - lc[0] * 0.19, neck[1] - 0.04 + drop, -lc[2] * 0.19];
  const hipL: V = [pel[0] + lh[0] * 0.1, pel[1], lh[2] * 0.1];
  const hipR: V = [pel[0] - lh[0] * 0.1, pel[1], -lh[2] * 0.1];
  const footL: V = [0.02, 0.05, 0.22], footR: V = [0.0, 0.05, -0.2];
  const kneeOf = (hp: V, ft: V, bend: number): V => [(hp[0] + ft[0]) / 2 + bend, (hp[1] + ft[1]) / 2 + 0.01, (hp[2] + ft[2]) / 2];
  // weight moves: the front knee straightens and the back heel lifts late in the swing
  const fwd = Math.max(0, pose.sway - 0.06) * 3;
  const kneeL = kneeOf(hipL, footL, 0.13 - 0.08 * fwd);
  const kneeR = kneeOf(hipR, footR, 0.14 + 0.05 * fwd);
  const toeR: V = [footR[0] + 0.18, footR[1] + (fwd > 0.3 ? 0.04 : 0), footR[2] - 0.05];
  const toeL: V = [footL[0] + 0.18, footL[1], footL[2] + 0.07];
  const heelR: V = [footR[0] - 0.05, footR[1] + (fwd > 0.3 ? 0.12 : 0), footR[2]];
  const heelL: V = [footL[0] - 0.05, footL[1], footL[2]];

  const hands = pose.hands;
  const handL: V = [hands[0], hands[1], hands[2]];
  const grip = norm(pose.shaft);
  const handR: V = [hands[0] - grip[0] * 0.09, hands[1] - grip[1] * 0.09, hands[2] - grip[2] * 0.09];
  const elbow = (s: V, h: V, side: number): V => {
    const dx = h[0] - s[0], dy = h[1] - s[1], dz = h[2] - s[2];
    const D = Math.min(0.58, Math.hypot(dx, dy, dz) || 0.1);
    const bend = Math.sqrt(Math.max(0, 0.3 * 0.3 - (D / 2) * (D / 2)));
    const u = norm([dx, dy, dz]);
    // bend direction: down and a little out, made perpendicular to the arm
    let n: V = [0 - side * lc[0] * 0.25, -1, 0 - side * lc[2] * 0.25];
    const dot = n[0] * u[0] + n[1] * u[1] + n[2] * u[2];
    n = norm([n[0] - u[0] * dot, n[1] - u[1] * dot, n[2] - u[2] * dot]);
    return [s[0] + dx / 2 + n[0] * bend, s[1] + dy / 2 + n[1] * bend, s[2] + dz / 2 + n[2] * bend];
  };
  const elL = elbow(shL, handL, 1), elR = elbow(shR, handR, -1);
  const headC: V = [neck[0] + sp[0] * 0.2 + Math.cos(pose.head) * 0.02, neck[1] + sp[1] * 0.2, 0];
  const headDir: V = [Math.cos(pose.head), -0.35, -Math.sin(pose.head)];
  const clubHead: V = [hands[0] + pose.shaft[0] * club.len, hands[1] + pose.shaft[1] * club.len, hands[2] + pose.shaft[2] * club.len];

  const segs: Seg[] = [];
  const add = (a: V, b: V, r: number, col: string, edge: string) => {
    const wa = W(a), wb = W(b);
    const mx = (wa[0] + wb[0]) / 2 - cam.x, my = (wa[1] + wb[1]) / 2 - cam.y, mz = (wa[2] + wb[2]) / 2 - cam.z;
    segs.push({ a, b, r, col, edge, z: mx * cam.fx + my * cam.fy + mz * cam.fz });
  };
  add(hipR, kneeR, 0.075, PANTS, PANTS_D);
  add(kneeR, footR, 0.062, PANTS, PANTS_D);
  add(footR, toeR, 0.045, SHOE, "#a39f92");
  add(footR, heelR, 0.04, SHOE, "#a39f92");
  add(hipL, kneeL, 0.078, PANTS, PANTS_D);
  add(kneeL, footL, 0.064, PANTS, PANTS_D);
  add(footL, toeL, 0.046, SHOE, "#a39f92");
  add(footL, heelL, 0.04, SHOE, "#a39f92");
  add(hipL, hipR, 0.115, PANTS, PANTS_D);
  add(pel, neck, 0.15, SHIRT, SHIRT_D);
  add(shL, shR, 0.075, SHIRT, SHIRT_D);
  add(shR, elR, 0.058, SHIRT, SHIRT_D);
  add(elR, handR, 0.044, SKIN, "#a87b55");
  add(shL, elL, 0.058, SHIRT, SHIRT_D);
  add(elL, handL, 0.044, SKIN, "#a87b55");
  add(neck, headC, 0.055, SKIN, "#a87b55");

  const pt = { x: 0, y: 0, d: 0, s: 0 } as P2;
  const pt2 = { x: 0, y: 0, d: 0, s: 0 } as P2;
  // the torso is a wide slab from hips to shoulders, drawn under the arms
  const torso = [shL, shR, hipR, hipL].map(W);

  return {
    d: depth,
    draw: () => {
      // soft shadow on the grass, cast away from the sun (to the left/behind)
      const sh: [number, number][] = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const wx = origin[0] + ex[0] * (0.2 + Math.cos(a) * 0.5) + ez[0] * (0.05 + Math.sin(a) * 0.32) - 0.3;
        const wz = origin[2] + ex[2] * (0.2 + Math.cos(a) * 0.5) + ez[2] * (0.05 + Math.sin(a) * 0.32) - 0.05;
        if (project(cam, wx, 0.02, wz, pt)) sh.push([pt.x, pt.y]);
      }
      if (sh.length > 5) {
        ctx.fillStyle = "rgba(10,40,20,0.28)";
        ctx.beginPath();
        sh.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.fill();
      }
      const proj = (p: V, o: P2) => project(cam, p[0], p[1], p[2], o);
      // club trail
      if (trail.length > 1) {
        for (let i = 1; i < trail.length; i++) {
          if (!proj(trail[i - 1], pt) || !proj(trail[i], pt2)) continue;
          ctx.strokeStyle = `rgba(255,255,255,${(i / trail.length) * 0.35})`;
          ctx.lineWidth = Math.max(1.5, 0.05 * pt2.s * (i / trail.length) * 2);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.stroke();
        }
      }
      // order: back-to-front by segment depth; the torso sits just behind the trail-side arm
      const order = segs.slice().sort((a, b) => b.z - a.z);
      let torsoDone = false;
      const drawTorso = () => {
        torsoDone = true;
        const pp = torso.map((p) => (project(cam, p[0], p[1], p[2], pt) ? ([pt.x, pt.y] as [number, number]) : null));
        if (pp.some((p) => !p)) return;
        ctx.fillStyle = SHIRT;
        ctx.strokeStyle = SHIRT_D;
        ctx.lineWidth = 1;
        ctx.beginPath();
        pp.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      const torsoZ = segs.find((s) => s.a === pel)?.z ?? 0;
      for (const s of order) {
        if (!torsoDone && s.z < torsoZ) drawTorso();
        const wa = W(s.a), wb = W(s.b);
        if (!project(cam, wa[0], wa[1], wa[2], pt) || !project(cam, wb[0], wb[1], wb[2], pt2)) continue;
        const wpx = Math.max(1.5, s.r * 2 * ((pt.s + pt2.s) / 2));
        ctx.lineCap = "round";
        ctx.strokeStyle = s.edge;
        ctx.lineWidth = wpx + 1.6;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.stroke();
        ctx.strokeStyle = s.col;
        ctx.lineWidth = wpx;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.stroke();
      }
      if (!torsoDone) drawTorso();
      // cap
      const hw = W(headC);
      if (project(cam, hw[0], hw[1], hw[2], pt)) {
        const k = pt.s;
        ctx.fillStyle = SKIN;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 0.105 * k, 0, 7);
        ctx.fill();
        ctx.fillStyle = CAP;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y - 0.012 * k, 0.112 * k, Math.PI * 0.92, Math.PI * 2.08);
        ctx.closePath();
        ctx.fill();
        // the brim points where the head looks
        const bw = W([headC[0] + headDir[0] * 0.14, headC[1] + headDir[1] * 0.06, headC[2] + headDir[2] * 0.14]);
        if (project(cam, bw[0], bw[1], bw[2], pt2)) {
          ctx.strokeStyle = CAP;
          ctx.lineWidth = 0.05 * k;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y - 0.03 * k);
          ctx.lineTo(pt2.x, pt2.y - 0.01 * k);
          ctx.stroke();
        }
      }
      // hands, shaft, head
      const hw1 = W(handL), cw = W(clubHead);
      if (project(cam, hw1[0], hw1[1], hw1[2], pt) && project(cam, cw[0], cw[1], cw[2], pt2)) {
        ctx.strokeStyle = "#16181a";
        ctx.lineWidth = Math.max(1.4, 0.016 * pt.s);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.stroke();
        ctx.fillStyle = SKIN;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 0.05 * pt.s, 0, 7);
        ctx.fill();
        // club head: a fat oval for woods, a slim blade for irons
        const wood = club.len > 1.04;
        ctx.save();
        ctx.translate(pt2.x, pt2.y);
        ctx.rotate(Math.atan2(pt2.y - pt.y, pt2.x - pt.x));
        ctx.fillStyle = wood ? "#272b2e" : "#c9ced1";
        const hs = pt2.s;
        ctx.beginPath();
        ctx.ellipse(0.02 * hs, 0, (wood ? 0.07 : 0.045) * hs, (wood ? 0.055 : 0.035) * hs, 0, 0, 7);
        ctx.fill();
        ctx.restore();
      }
    },
  };
}
