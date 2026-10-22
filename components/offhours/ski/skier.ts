import type { Game } from "./game";
import { wrap } from "./sim";

// The skier is a small 3D rig (boots, knees, hips, a torso that folds into a
// tuck, arms, poles, skis that roll onto their edges) projected through the
// same camera as the snow, so a carve, a traverse, a spin and a tumble all
// look right from behind without any sprites.

type V = [number, number, number];
export type Proj = (x: number, y: number, z: number) => { x: number; y: number; s: number };

const SUIT = "#1d5e3f";
const SUIT_LIT = "#2f8a5c";
const PANTS = "#10161a";
const MINT = "#8ad9a8";
const CREAM = "#f2ead7";

export function drawSkier(ctx: CanvasRenderingContext2D, g: Game, proj: Proj, fog: number) {
  const s = g.run;
  const T = g.C.terrain;
  const crashed = s.crash > 0;
  const edge = Math.min(1.3, Math.abs(s.aLat) / 16);
  const air = !s.grounded;
  const ground = T.h(s.z);

  // body angles
  let yaw = s.hd;
  let pitch = 0;
  let roll = 0;
  if (air) {
    yaw += s.spin;
    pitch = Math.max(-0.5, Math.min(0.5, Math.atan2(s.vy, Math.max(8, s.v)) * 0.8));
    roll = -s.spinRate * 0.015;
  } else if (crashed) {
    const rest = Math.PI * 2 * Math.round(s.tumble / (Math.PI * 2)) + 1.45;
    const k = 1 - Math.min(1, s.v / 4);
    pitch = s.tumble + (rest - s.tumble) * k;
    roll = Math.sin(s.tumble * 0.7) * 1.1 * (1 - k);
    yaw += Math.sin(s.tumble * 0.5) * 0.9 * (1 - k);
  } else {
    roll = Math.max(-0.8, Math.min(0.8, Math.atan2(s.aLat, 9.8) * 0.68));
    if (s.stumble > 0) roll += Math.sin(g.time * 22) * 0.12 * (s.stumble / 0.8);
  }
  const sr = air || crashed ? 0 : 1;

  // basis: right, up, forward
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const R0: V = [cy, 0, -sy];
  const F0: V = [sy, 0, cy];
  const Y0: V = [0, 1, 0];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const F1: V = [F0[0] * cp, sp, F0[2] * cp];
  const U1: V = [-F0[0] * sp, cp, -F0[2] * sp];
  void Y0;
  const lift = crashed ? 0.12 : 0;
  const ox = s.x;
  const oy = s.y + lift;
  const oz = s.z;
  // angulation: skis roll the most, knees less, the upper body least
  const basis = (rl: number) => {
    const cr = Math.cos(rl);
    const sr2 = Math.sin(rl);
    return {
      U: [U1[0] * cr + R0[0] * sr2, U1[1] * cr + R0[1] * sr2, U1[2] * cr + R0[2] * sr2] as V,
      R: [R0[0] * cr - U1[0] * sr2, R0[1] * cr - U1[1] * sr2, R0[2] * cr - U1[2] * sr2] as V,
    };
  };
  const bSki = basis(roll);
  const bKnee = basis(roll * (air || crashed ? 1 : 0.78));
  const bUp = basis(roll * (air || crashed ? 1 : 0.55));
  const mk = (b: { U: V; R: V }) => (r: number, u: number, f: number): V => [
    ox + b.R[0] * r + b.U[0] * u + F1[0] * f,
    oy + b.R[1] * r + b.U[1] * u + F1[1] * f,
    oz + b.R[2] * r + b.U[2] * u + F1[2] * f,
  ];
  const P = mk(bSki);
  const PK = mk(bKnee);
  const PU = mk(bUp);

  // pose
  const carve = 0.12 + 0.22 * Math.min(1, edge);
  let c = Math.max(s.tuck * 0.95, carve * sr);
  if (air) c = 0.4 + 0.45 * s.tuck;
  if (crashed) c = 0.7;
  const flail = crashed ? Math.sin(s.tumble * 1.7) : 0;
  const hipU = 0.95 - 0.42 * c;
  const hipF = -0.04 - 0.3 * c;
  const beta = 0.12 + 1.05 * c;
  const hip: V = [0, hipU, hipF];
  const sh: V = [0, hipU + 0.58 * Math.cos(beta), hipF + 0.58 * Math.sin(beta)];
  const headC: V = [0, sh[1] + 0.2 * Math.cos(beta * 0.4) + 0.05, sh[2] + 0.2 * Math.sin(beta * 0.4) + 0.04];
  const lean = Math.max(-1, Math.min(1, s.aLat / 14)) * sr;

  type Prim = { z: number; draw: () => void };
  const prims: Prim[] = [];
  const S = (v: V) => proj(v[0], v[1], v[2]);
  const limb = (a: V, b: V, wm: number, col: string, rim?: string) => {
    prims.push({
      z: (a[2] + b[2]) / 2,
      draw() {
        const A = S(a);
        const B = S(b);
        const w = (wm * (A.s + B.s)) / 2;
        ctx.lineCap = "round";
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, w);
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
        if (rim) {
          ctx.strokeStyle = rim;
          ctx.lineWidth = Math.max(0.8, w * 0.28);
          ctx.beginPath();
          ctx.moveTo(A.x + w * 0.24, A.y - w * 0.1);
          ctx.lineTo(B.x + w * 0.24, B.y - w * 0.1);
          ctx.stroke();
        }
      },
    });
  };

  for (const side of [-1, 1]) {
    // skis, rolled with the body onto their edges
    const sr0 = side * 0.13;
    const corners = [P(sr0 - 0.05, 0.05, 0.86), P(sr0 + 0.05, 0.05, 0.86), P(sr0 + 0.05, 0.0, -0.8), P(sr0 - 0.05, 0.0, -0.8)];
    const mid0 = P(sr0, 0.012, -0.55);
    const mid1 = P(sr0, 0.04, 0.6);
    prims.push({
      z: (corners[0][2] + corners[3][2]) / 2,
      draw() {
        const q = corners.map(S);
        ctx.fillStyle = "#151a1e";
        ctx.beginPath();
        ctx.moveTo(q[0].x, q[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
        ctx.closePath();
        ctx.fill();
        const a = S(mid0);
        const b = S(mid1);
        ctx.strokeStyle = MINT;
        ctx.lineWidth = Math.max(0.7, 0.026 * (a.s + b.s) * 0.5);
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      },
    });
    const ankle = P(side * 0.13, 0.13, 0.02);
    limb(P(side * 0.13, 0.04, 0.04), ankle, 0.13, "#0c0f11");
    const knee = PK(side * (0.16 + 0.03 * c), 0.54 - 0.1 * c, 0.18 + 0.24 * c + (crashed ? 0.2 * flail * side : 0));
    const hp = PU(side * 0.1, hipU, hipF);
    limb(ankle, knee, 0.145, PANTS, "rgba(255,214,160,0.25)");
    limb(knee, hp, 0.17, PANTS, "rgba(255,214,160,0.3)");

    // arms and poles
    const shoulder = PU(side * 0.2, sh[1], sh[2]);
    const spread = air ? 0.55 : crashed ? 0.5 + 0.4 * flail * side : 0.34 - 0.2 * c;
    const outer = side * lean > 0 ? 0.12 : 0; // the outside arm opens up in a carve
    const handU = air ? sh[1] + 0.02 : sh[1] - 0.44 + 0.38 * c + (crashed ? 0.4 * Math.abs(flail) : 0);
    const handF = sh[2] + 0.36 + 0.14 * c - (air ? 0.1 : 0) - outer * 0.4;
    const hand = PU(side * (spread + outer * 0.5), handU, handF);
    const elbow = P(side * (spread + 0.16), (shoulder[1] + handU) / 2 - 0.0, (sh[2] + handF) / 2 - 0.05);
    void elbow;
    const elb = PU(side * (spread * 0.8 + 0.2), (sh[1] + handU) / 2 - 0.06, (sh[2] + handF) / 2 - 0.1);
    limb(shoulder, elb, 0.1, SUIT, "rgba(160,255,200,0.25)");
    limb(elb, hand, 0.09, SUIT);
    const tip = PU(side * (spread + 0.1 + 0.1 * (1 - c)), handU - 0.95 + 0.6 * c - (air ? 0.2 : 0), handF - 0.5 - 0.65 * c - 0.2 * (air ? 1 : 0));
    limb(hand, tip, 0.02, "#d9d3c4");
    prims.push({
      z: hand[2] + 0.001,
      draw() {
        const H = S(hand);
        ctx.fillStyle = "#101214";
        ctx.beginPath();
        ctx.arc(H.x, H.y, Math.max(1.2, 0.065 * H.s), 0, Math.PI * 2);
        ctx.fill();
      },
    });
  }

  // torso: hips to shoulders, a shoulder yoke, a mint stripe down the back
  const hipC = PU(hip[0], hip[1], hip[2]);
  const shC = PU(sh[0], sh[1], sh[2]);
  const midC: V = [(hipC[0] * 0.55 + shC[0] * 0.45), (hipC[1] * 0.55 + shC[1] * 0.45), (hipC[2] * 0.55 + shC[2] * 0.45)];
  limb(hipC, midC, 0.29, SUIT, SUIT_LIT);
  limb(midC, shC, 0.37, SUIT, SUIT_LIT);
  limb(PU(-0.19, sh[1] - 0.02, sh[2]), PU(0.19, sh[1] - 0.02, sh[2]), 0.17, SUIT, "rgba(160,255,200,0.3)");
  const back = PU(0, hipU + 0.3 * Math.cos(beta), hipF + 0.3 * Math.sin(beta) - 0.17);
  const backTop = PU(0, sh[1] - 0.06, sh[2] - 0.14);
  limb(PU(0, hipU + 0.06, hipF - 0.14), back, 0.07, MINT);
  limb(back, backTop, 0.07, MINT);
  // bib number, readable when you're facing away
  const facing = -F1[2];
  if (facing < -0.15) {
    const bc = PU(0, hipU + 0.34 * Math.cos(beta) + 0.02, hipF + 0.34 * Math.sin(beta) - 0.2);
    prims.push({
      z: bc[2] - 0.05,
      draw() {
        const B = S(bc);
        const sz = 0.17 * B.s;
        ctx.save();
        ctx.translate(B.x, B.y);
        ctx.scale(Math.max(0.25, -facing), 1);
        ctx.fillStyle = CREAM;
        ctx.fillRect(-sz * 0.6, -sz * 0.55, sz * 1.2, sz * 1.1);
        ctx.fillStyle = "#0d100e";
        ctx.font = `800 ${Math.max(5, sz * 0.95)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("24", 0, sz * 0.04);
        ctx.restore();
      },
    });
  }

  // helmet and goggles
  const hc = PU(headC[0], headC[1], headC[2]);
  prims.push({
    z: hc[2],
    draw() {
      const H = S(hc);
      const r = 0.135 * H.s;
      ctx.fillStyle = CREAM;
      ctx.beginPath();
      ctx.arc(H.x, H.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,214,160,0.55)";
      ctx.beginPath();
      ctx.arc(H.x + r * 0.3, H.y - r * 0.25, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      if (facing > 0.2) {
        // facing you: lens and strap
        const lc = PU(headC[0], headC[1] - 0.01, headC[2] + 0.1);
        const L2 = S(lc);
        ctx.fillStyle = "#16191c";
        ctx.beginPath();
        ctx.ellipse(L2.x, L2.y, r * 0.78 * Math.min(1, facing + 0.2), r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(240,160,90,0.7)";
        ctx.beginPath();
        ctx.ellipse(L2.x - r * 0.1, L2.y - r * 0.08, r * 0.45 * facing, r * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = MINT;
        ctx.lineWidth = Math.max(1, r * 0.2);
        ctx.beginPath();
        ctx.arc(H.x, H.y, r * 0.78, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.fillStyle = "#16191c";
        ctx.fillRect(H.x - r * 0.95, H.y - r * 0.12, r * 1.9, r * 0.24);
      }
    },
  });

  // ground shadow, thrown toward the camera and left (the sun is low, ahead and right)
  const sx = s.x;
  const sz = s.z;
  const b0 = proj(sx, ground, sz);
  const b1 = proj(sx - 0.9, ground, Math.max(g.cam.z + 0.9, sz - 2.2));
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(60,70,125,${0.26 * (1 - fog)})`;
  ctx.lineWidth = Math.max(2, 0.42 * b0.s);
  ctx.beginPath();
  ctx.moveTo(b0.x, b0.y);
  ctx.lineTo(b1.x, b1.y);
  ctx.stroke();
  ctx.restore();

  prims.sort((a, b) => b.z - a.z);
  for (const p of prims) p.draw();
  void wrap;
}
