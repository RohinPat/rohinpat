import { GATE_HALF, HALF_W, L, PENALTY, centerX } from "./course";
import { MEDALS, TD, fmt, type Game } from "./game";
import { drawSkier } from "./skier";
import { PAL, css, mix, ridgeAt, ridges, rgb, treeSprite, type RGB } from "./scenery";
import { display, mono } from "../font";
import { seeded } from "../useCanvas";

const FAR = 300;
const START_Z = 14;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** a touch screen: no keyboard to press Enter on, so the copy says "tap" */
let coarseMq: MediaQueryList | null = null;
export function coarse() {
  if (!coarseMq && typeof window !== "undefined") coarseMq = window.matchMedia("(pointer: coarse), (hover: none)");
  return !!coarseMq?.matches;
}

type Obj = { z: number; k: number; i: number };
const K_TREE = 0, K_GATE = 1, K_ARCH = 2, K_FAN = 3, K_SIGN = 4, K_SKIER = 5;

let puffC: HTMLCanvasElement | null = null;
function puff() {
  if (!puffC) {
    puffC = document.createElement("canvas");
    puffC.width = puffC.height = 48;
    const x = puffC.getContext("2d")!;
    const gr = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, "rgba(255,253,248,1)");
    gr.addColorStop(0.45, "rgba(255,250,242,0.7)");
    gr.addColorStop(1, "rgba(255,246,236,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 48, 48);
  }
  return puffC;
}

const fans = (() => {
  const r = seeded(12);
  const cols = ["#d9402f", "#2a62c9", "#f2ead7", "#e8a93a", "#1d5e3f", "#c46aa0"];
  return Array.from({ length: 70 }, (_, i) => ({
    z: L - 14 + i * 1.15 + r() * 0.8,
    side: i % 2 ? -1 : 1,
    off: HALF_W - 2.2 - r() * 3.2,
    col: cols[Math.floor(r() * cols.length)],
    h: 1.55 + r() * 0.25,
    ph: r() * 6,
  }));
})();

export function render(ctx: CanvasRenderingContext2D, w: number, h: number, g: Game, play: boolean) {
  const C = g.C;
  const T = C.terrain;
  const s = g.run;
  const cam = g.cam;
  g.startTop = Infinity;

  // ---- camera: the skier sits low on the screen, the camera behind and above
  let f = Math.max(Math.min(1.2 * h, 0.95 * w), w * 0.5);
  if (h > w * 1.2) f = w * 1.35; // portrait: a tighter lens so the skier isn't a speck
  f *= 1 + 0.08 * clamp01(s.v / 36);
  const dS = cam.dist;
  g.mpp = dS / f;
  const camH = Math.max(2.2, Math.min(6.5, ((0.8 - 0.37) * h * dS) / f));
  const hz = 0.8 * h - (f * camH) / dS + f * cam.ps * 0.3;
  const camY = cam.y + camH;
  const Zc = cam.z;
  const cx = w / 2;
  const proj = (x: number, y: number, z: number) => {
    const d = Math.max(0.3, z - Zc);
    const sc = f / d;
    return { x: cx + (x - cam.x) * sc, y: hz + (camY - y) * sc, s: sc };
  };
  const fogOf = (d: number) => Math.pow(clamp01((d - 45) / 250), 0.85);
  const t = g.time;

  ctx.save();
  if (g.shake > 0) ctx.translate((Math.random() - 0.5) * g.shake * 9, (Math.random() - 0.5) * g.shake * 9);

  // ---- sky
  const sky = ctx.createLinearGradient(0, 0, 0, hz + 4);
  sky.addColorStop(0, css(PAL.skyTop));
  sky.addColorStop(0.55, css(PAL.skyMid));
  sky.addColorStop(1, css(PAL.skyLow));
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, w + 40, hz + 24);
  const sunX = w * 0.66 - cam.x * 1.2 - (s.z % 4000) * 0.01;
  const sunY = hz - h * 0.12;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.75);
  glow.addColorStop(0, "rgba(255,226,170,0.85)");
  glow.addColorStop(0.18, "rgba(255,196,130,0.45)");
  glow.addColorStop(1, "rgba(255,170,110,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-20, -20, w + 40, hz + 24);
  ctx.fillStyle = "#fff4d6";
  ctx.beginPath();
  ctx.arc(sunX, sunY, Math.min(w, h) * 0.045, 0, Math.PI * 2);
  ctx.fill();
  // thin streaks of cloud
  ctx.fillStyle = "rgba(255,224,200,0.4)";
  for (let i = 0; i < 4; i++) {
    const cxp = ((i * 0.31 + 0.1 + t * 0.002 - cam.x * 0.0015) % 1.3) * w * 1.3 - w * 0.15;
    const cyp = hz * (0.2 + 0.16 * i);
    ctx.beginPath();
    ctx.ellipse(cxp, cyp, w * (0.16 + 0.04 * i), 4 + i * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- ridges: sun-facing slopes lit, the others in blue shade
  ridges.forEach((rd, li) => {
    const span = rd.scale;
    const off = cam.x * 0.004 * rd.par + s.z * 0.00045 * rd.par + li * 31;
    const base = hz + 10;
    const pts: number[] = [];
    for (let x = -12; x <= w + 12; x += 6) pts.push(x, base - rd.amp * h * ridgeAt(rd, (x / w) * span + off));
    const haze = li === 0 ? 0.32 : li === 1 ? 0.2 : 0.1;
    const path = (dx: number) => {
      ctx.beginPath();
      ctx.moveTo(-12 + dx, base + 4);
      for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i] + dx, pts[i + 1]);
      ctx.lineTo(w + 12 + dx, base + 4);
      ctx.closePath();
    };
    ctx.fillStyle = css(mix(rd.shade, PAL.haze, haze));
    path(0);
    ctx.fill();
    ctx.save();
    path(0);
    ctx.clip();
    ctx.fillStyle = css(mix(rd.lit, PAL.haze, haze));
    path(w * 0.011 + li * 2);
    ctx.fill();
    ctx.restore();
  });
  // haze where the mountains meet the valley
  const hazeG = ctx.createLinearGradient(0, hz - h * 0.09, 0, hz + 12);
  hazeG.addColorStop(0, "rgba(248,212,174,0)");
  hazeG.addColorStop(1, "rgba(248,212,174,0.92)");
  ctx.fillStyle = hazeG;
  ctx.fillRect(-20, hz - h * 0.09, w + 40, h * 0.09 + 14);
  // fill below the horizon with haze, the ground draws over it
  ctx.fillStyle = css(PAL.haze);
  ctx.fillRect(-20, hz + 6, w + 40, h);

  // ---- ground strips, near to far for the table, then painted far to near
  const zs: number[] = [Zc + 0.7];
  while (zs[zs.length - 1] < Zc + FAR) {
    const d = zs[zs.length - 1] - Zc;
    zs.push(zs[zs.length - 1] + (d < 30 ? 1.2 : d < 80 ? 2.5 : d < 160 ? 5 : 10));
  }
  const n = zs.length;
  const gy: number[] = [];
  const gh: number[] = [];
  const gc: number[] = [];
  for (let k = 0; k < n; k++) {
    const hh = T.h(zs[k]);
    gh.push(hh);
    gy.push(hz + (camY - hh) * (f / (zs[k] - Zc)));
    gc.push(centerX(zs[k]));
  }

  // objects, painted far to near with the strips
  const objs: Obj[] = [];
  {
    // trees are sorted by z; find the first one in range
    let lo = 0;
    let hi = C.trees.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (C.trees[mid].z < Zc + 1) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < C.trees.length && C.trees[i].z < Zc + FAR; i++) objs.push({ z: C.trees[i].z, k: K_TREE, i });
    C.gates.forEach((gt, i) => {
      if (gt.z > Zc - 2 && gt.z < Zc + FAR) objs.push({ z: gt.z, k: K_GATE, i });
    });
    for (const az of [START_Z, L]) if (az > Zc - 2 && az < Zc + FAR) objs.push({ z: az, k: K_ARCH, i: az === L ? 1 : 0 });
    fans.forEach((fn, i) => {
      if (fn.z > Zc + 1 && fn.z < Zc + 140) objs.push({ z: fn.z, k: K_FAN, i });
    });
    C.kickers.forEach((kk, i) => {
      const z = kk.z - 34;
      if (z > Zc + 1 && z < Zc + FAR) objs.push({ z, k: K_SIGN, i });
    });
    objs.sort((a, b) => b.z - a.z);
  }
  let op = 0;
  while (op < objs.length && objs[op].z >= zs[n - 1]) op++;

  const litC = PAL.snowLit;
  const shadeC = PAL.snowShade;
  const haze = PAL.haze;
  const netCol = PAL.net;
  const next = C.gates[s.next];

  const drawObj = (o: Obj) => {
    if (o.k === K_TREE) {
      const tr = C.trees[o.i];
      const d = tr.z - Zc;
      const b = proj(tr.x, T.h(tr.z), tr.z);
      const fg = fogOf(d);
      const hp = tr.h * b.s;
      if (hp < 2) return;
      if (b.x < -hp || b.x > w + hp) return;
      // long shadow, away from the sun
      const len = tr.h * 1.9;
      const tz = Math.max(Zc + 0.8, tr.z - len);
      const tip = proj(tr.x - len * 0.42, T.h(tr.z), tz);
      const bw = tr.h * 0.12 * b.s;
      ctx.fillStyle = `rgba(66,76,128,${0.3 * (1 - fg)})`;
      ctx.beginPath();
      ctx.moveTo(b.x - bw, b.y);
      ctx.lineTo(b.x + bw, b.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.closePath();
      ctx.fill();
      const sp = treeSprite(tr.v, fg);
      const wd = hp * sp.ratio * 1.05;
      ctx.drawImage(sp.c, b.x - wd / 2, b.y - hp * 0.985, wd, hp);
      return;
    }
    if (o.k === K_GATE) {
      const gt = C.gates[o.i];
      const d = gt.z - Zc;
      const ga = clamp01((d - 4.2) / 2.8); // fades out as it passes between you and the camera
      if (ga <= 0.02) return;
      ctx.globalAlpha = ga;
      const fg = fogOf(d);
      const isNext = gt === next && !s.finished;
      const pass = o.i < s.next;
      const ok = s.gateOk[o.i];
      const col = gt.color ? PAL.blue : PAL.red;
      const poleC = css(mix([240, 240, 235], haze, fg));
      const panel = css(mix(col, haze, fg * 0.9));
      const gz = gt.z;
      const b0 = proj(gt.x - GATE_HALF, T.h(gz), gz);
      const b1 = proj(gt.x + GATE_HALF, T.h(gz), gz);
      const hp = 2.1 * b0.s;
      if (isNext) {
        // a faint curtain of light between the poles marks the gate you're after
        const grad = ctx.createLinearGradient(0, b0.y - 2.8 * b0.s, 0, b0.y);
        const pulse = 0.5 + 0.5 * Math.sin(t * 5);
        grad.addColorStop(0, "rgba(138,217,168,0)");
        grad.addColorStop(1, `rgba(138,217,168,${0.24 + 0.1 * pulse})`);
        ctx.fillStyle = grad;
        ctx.fillRect(b0.x, b0.y - 2.8 * b0.s, b1.x - b0.x, 2.8 * b0.s);
      }
      if (pass && ok === false) {
        ctx.fillStyle = "rgba(224,57,43,0.22)";
        ctx.fillRect(b0.x, b0.y - 2.2 * b0.s, b1.x - b0.x, 2.2 * b0.s);
      }
      for (const [bb, side] of [[b0, -1], [b1, 1]] as const) {
        // shadow on the snow
        const tip = proj(gt.x + side * GATE_HALF - 1.1, T.h(gz), Math.max(Zc + 0.8, gz - 3.4));
        ctx.strokeStyle = `rgba(66,76,128,${0.26 * (1 - fg)})`;
        ctx.lineWidth = Math.max(1, 0.12 * bb.s);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(bb.x, bb.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        ctx.strokeStyle = poleC;
        ctx.lineWidth = Math.max(1.2, 0.09 * bb.s);
        ctx.beginPath();
        ctx.moveTo(bb.x, bb.y);
        ctx.lineTo(bb.x, bb.y - hp);
        ctx.stroke();
        // the panel, which flutters a little
        const fl = Math.sin(t * 7 + o.i * 1.3 + side) * 0.05 * bb.s;
        const pw = 0.85 * bb.s;
        const ph = 0.62 * bb.s;
        ctx.fillStyle = panel;
        ctx.beginPath();
        ctx.moveTo(bb.x, bb.y - hp);
        ctx.lineTo(bb.x - side * pw, bb.y - hp + fl);
        ctx.lineTo(bb.x - side * pw, bb.y - hp + ph + fl);
        ctx.lineTo(bb.x, bb.y - hp + ph);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(255,244,214,0.35)";
        ctx.fillRect(Math.min(bb.x, bb.x - side * pw), bb.y - hp + ph * 0.18, pw, Math.max(1, ph * 0.12));
        // snow at the foot
        ctx.fillStyle = css(mix(litC, haze, fg));
        ctx.beginPath();
        ctx.ellipse(bb.x, bb.y, 0.28 * bb.s, 0.1 * bb.s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (o.k === K_ARCH) {
      const z = o.i ? L : START_Z;
      const half = o.i ? 8 : 5.5;
      const b0 = proj(centerX(z) - half, T.h(z), z);
      const b1 = proj(centerX(z) + half, T.h(z), z);
      const sc = b0.s;
      const topY = b0.y - (o.i ? 4.6 : 3.4) * sc;
      const botY = b0.y - (o.i ? 3.3 : 2.4) * sc;
      ctx.strokeStyle = o.i ? "#e9e3d3" : "#1d5e3f";
      ctx.lineWidth = Math.max(2, 0.22 * sc);
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(b0.x, b0.y);
      ctx.lineTo(b0.x, topY);
      ctx.moveTo(b1.x, b1.y);
      ctx.lineTo(b1.x, topY);
      ctx.stroke();
      if (o.i) {
        // chequered banner
        const cols = 28;
        const cw = (b1.x - b0.x) / cols;
        const rh = (botY - topY) / 3;
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 ? "#f2ead7" : "#0d100e";
            ctx.fillRect(b0.x + c * cw, topY + r * rh, cw + 0.5, rh + 0.5);
          }
        ctx.fillStyle = "rgba(13,16,14,0.88)";
        ctx.fillRect(b0.x + (b1.x - b0.x) * 0.3, topY + rh * 0.4, (b1.x - b0.x) * 0.4, rh * 2.2);
        ctx.fillStyle = "#f2ead7";
        display(ctx, Math.max(8, rh * 1.9), 800);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("FINISH", (b0.x + b1.x) / 2, topY + rh * 1.5);
      } else {
        ctx.fillStyle = "#1d5e3f";
        ctx.fillRect(b0.x, topY, b1.x - b0.x, botY - topY);
        ctx.fillStyle = "#8ad9a8";
        ctx.fillRect(b0.x, botY - 0.1 * sc, b1.x - b0.x, 0.1 * sc);
        g.startTop = topY;
        ctx.fillStyle = "#f2ead7";
        display(ctx, Math.max(8, (botY - topY) * 0.7), 800);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("START", (b0.x + b1.x) / 2, (topY + botY) / 2);
      }
      return;
    }
    if (o.k === K_FAN) {
      const fn = fans[o.i];
      const x = centerX(fn.z) + fn.side * fn.off;
      const b = proj(x, T.h(fn.z), fn.z);
      const bob = Math.abs(Math.sin(t * 9 + fn.ph)) * 0.22 * g.cheer;
      const hy = b.y - (fn.h + bob) * b.s;
      ctx.fillStyle = fn.col;
      ctx.fillRect(b.x - 0.26 * b.s, hy + 0.3 * b.s, 0.52 * b.s, (fn.h - 0.5) * b.s);
      ctx.fillStyle = "#e4b890";
      ctx.beginPath();
      ctx.arc(b.x, hy + 0.14 * b.s, 0.16 * b.s, 0, Math.PI * 2);
      ctx.fill();
      if (g.cheer > 0.05) {
        ctx.strokeStyle = fn.col;
        ctx.lineWidth = Math.max(1, 0.1 * b.s);
        ctx.beginPath();
        ctx.moveTo(b.x - 0.25 * b.s, hy + 0.45 * b.s);
        ctx.lineTo(b.x - 0.45 * b.s, hy - 0.2 * b.s);
        ctx.moveTo(b.x + 0.25 * b.s, hy + 0.45 * b.s);
        ctx.lineTo(b.x + 0.45 * b.s, hy - 0.2 * b.s);
        ctx.stroke();
      }
      return;
    }
    if (o.k === K_SIGN) {
      const z = C.kickers[o.i].z - 34;
      for (const side of [-1, 1]) {
        const b = proj(centerX(z) + side * (HALF_W - 2.2), T.h(z), z);
        ctx.strokeStyle = "#2a2f33";
        ctx.lineWidth = Math.max(1, 0.1 * b.s);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x, b.y - 2.1 * b.s);
        ctx.stroke();
        const cy = b.y - 2.5 * b.s;
        const r = 0.8 * b.s;
        ctx.fillStyle = "#f4c02e";
        ctx.beginPath();
        ctx.moveTo(b.x, cy - r);
        ctx.lineTo(b.x + r, cy);
        ctx.lineTo(b.x, cy + r);
        ctx.lineTo(b.x - r, cy);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#16191c";
        ctx.lineWidth = Math.max(1, 0.13 * b.s);
        ctx.beginPath();
        ctx.moveTo(b.x - r * 0.5, cy + r * 0.25);
        ctx.lineTo(b.x, cy - r * 0.35);
        ctx.lineTo(b.x + r * 0.5, cy + r * 0.25);
        ctx.stroke();
      }
      return;
    }
    // the skier
    drawSkier(ctx, g, proj, fogOf(s.z - Zc));
    const sp = proj(s.x, s.y, s.z);
    g.skierSX = sp.x;
  };

  for (let k = n - 2; k >= 0; k--) {
    const zN = zs[k];
    const zF = zs[k + 1];
    const yN = gy[k];
    const yF = gy[k + 1];
    if (yN > yF - 0.0001 && yF < h + 40 && yN - yF > -0.0001) {
      const dN = zN - Zc;
      const dF = zF - Zc;
      const dM = (dN + dF) / 2;
      const fg = fogOf(dM);
      const slope = (gh[k + 1] - gh[k]) / (zF - zN);
      const I = clamp01(0.68 - 3.4 * slope + 0.05 * Math.sin((zN + zF) * 0.17));
      const snow = mix(shadeC, litC, I);
      const off = css(mix(mix(snow, rgb("#b9c6e4"), 0.14), haze, fg));
      const pis = mix(mix(snow, PAL.piste, 0.22), haze, fg);
      ctx.fillStyle = off;
      ctx.fillRect(0, yF - 0.6, w, yN - yF + 1.4);
      const xN0 = cx + (gc[k] - HALF_W - cam.x) * (f / dN);
      const xN1 = cx + (gc[k] + HALF_W - cam.x) * (f / dN);
      const xF0 = cx + (gc[k + 1] - HALF_W - cam.x) * (f / dF);
      const xF1 = cx + (gc[k + 1] + HALF_W - cam.x) * (f / dF);
      ctx.fillStyle = css(pis);
      ctx.beginPath();
      ctx.moveTo(xF0, yF - 0.6);
      ctx.lineTo(xF1, yF - 0.6);
      ctx.lineTo(xN1, yN + 0.8);
      ctx.lineTo(xN0, yN + 0.8);
      ctx.closePath();
      ctx.fill();
      // corduroy: the groomer's stripes
      if (dN < 130) {
        ctx.fillStyle = `rgba(110,130,190,${0.07 * (1 - fg)})`;
        ctx.beginPath();
        for (let j = -8; j < 8; j += 2) {
          const a = j / 8;
          const b2 = (j + 1) / 8;
          ctx.moveTo(xF0 + (xF1 - xF0) * (a * 0.5 + 0.5), yF);
          ctx.lineTo(xF0 + (xF1 - xF0) * (b2 * 0.5 + 0.5), yF);
          ctx.lineTo(xN0 + (xN1 - xN0) * (b2 * 0.5 + 0.5), yN + 0.5);
          ctx.lineTo(xN0 + (xN1 - xN0) * (a * 0.5 + 0.5), yN + 0.5);
          ctx.closePath();
        }
        ctx.fill();
      }
      // tracks left on the piste, this run and the ones before
      const c0 = Math.max(0, Math.floor(zN / TD));
      const c1 = Math.min(g.tl.length - 2, Math.floor(zF / TD));
      if (c1 >= c0 && dN < 200) {
        const sc = f / dM;
        for (const arr of [g.tl, g.tr]) {
          ctx.beginPath();
          let any = false;
          for (let c = c0; c <= c1; c++) {
            if (!g.tv[c] || !g.tv[c + 1]) continue;
            const za = c * TD;
            const zb = (c + 1) * TD;
            if (za - Zc < 0.5) continue;
            const a = proj(arr[c], T.h(za), za);
            const b = proj(arr[c + 1], T.h(zb), zb);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            any = true;
          }
          if (any) {
            ctx.strokeStyle = `rgba(104,122,176,${0.5 * (1 - fg)})`;
            ctx.lineWidth = Math.max(0.8, 0.1 * sc);
            ctx.lineCap = "round";
            ctx.stroke();
            if (dN < 60) {
              ctx.strokeStyle = `rgba(255,248,232,${0.35 * (1 - fg)})`;
              ctx.lineWidth = Math.max(0.6, 0.05 * sc);
              ctx.save();
              ctx.translate(0.6 + sc * 0.012, -sc * 0.01);
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }
      // the nets down both sides of the piste
      for (const side of [-1, 1]) {
        const eN = side < 0 ? xN0 : xN1;
        const eF = side < 0 ? xF0 : xF1;
        const hN = 1.3 * (f / dN);
        const hF = 1.3 * (f / dF);
        ctx.fillStyle = css(mix(netCol, haze, fg * 0.9), 0.92);
        ctx.beginPath();
        ctx.moveTo(eF, yF);
        ctx.lineTo(eF, yF - hF);
        ctx.lineTo(eN, yN - hN);
        ctx.lineTo(eN, yN);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = css(mix(rgb("#2a2118"), haze, fg), 0.8);
        ctx.lineWidth = Math.max(0.6, 0.06 * (f / dM));
        ctx.beginPath();
        ctx.moveTo(eF, yF - hF);
        ctx.lineTo(eN, yN - hN);
        ctx.stroke();
        const pz = Math.ceil(zN / 6) * 6;
        if (pz < zF) {
          const pc = (pz - zN) / (zF - zN);
          const px2 = eN + (eF - eN) * pc;
          const py = yN + (yF - yN) * pc;
          const ph = 1.5 * (f / (dN + (dF - dN) * pc));
          ctx.strokeStyle = css(mix(rgb("#2a2118"), haze, fg));
          ctx.lineWidth = Math.max(1, 0.1 * (f / dM));
          ctx.beginPath();
          ctx.moveTo(px2, py);
          ctx.lineTo(px2, py - ph);
          ctx.stroke();
        }
      }
    }
    while (op < objs.length && objs[op].z >= zN) drawObj(objs[op++]);
  }
  while (op < objs.length) drawObj(objs[op++]);
  // the skier last, so the snow nearer the camera never cuts its skis off
  drawObj({ z: s.z, k: K_SKIER, i: 0 });

  // warm light raking across the snow from the sun's side
  const warm = ctx.createLinearGradient(0, 0, w, 0);
  warm.addColorStop(0, "rgba(255,196,140,0)");
  warm.addColorStop(1, "rgba(255,190,130,0.2)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, hz + 4, w, h);

  // ---- snow sparkle, anchored in the world
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 70; i++) {
    const z = Zc + 3 + ((((i * 11.37 - Zc) % 48) + 48) % 48);
    const x = centerX(z) + (((i * 0.7548776) % 1) - 0.5) * 50;
    const p = proj(x, T.h(z) + 0.02, z);
    const tw = Math.pow(Math.max(0, Math.sin(t * 2.4 + i * 1.9)), 8);
    if (tw < 0.05 || p.y < hz + 4 || p.y > h) continue;
    const r = Math.max(0.7, 0.045 * p.s) * (0.6 + tw);
    ctx.fillStyle = `rgba(255,236,200,${tw * 0.9})`;
    ctx.fillRect(p.x - r, p.y - r * 0.3, r * 2, r * 0.6);
    ctx.fillRect(p.x - r * 0.3, p.y - r, r * 0.6, r * 2);
  }
  ctx.globalCompositeOperation = "source-over";

  // ---- snow thrown up
  for (const q of g.parts) {
    const p = proj(q.x, q.y, q.z);
    if (p.s > 400) continue;
    const r = Math.max(0.8, q.size * p.s * (1.2 - q.life * 0.4));
    ctx.globalAlpha = Math.min(1, q.life * 1.4) * 0.8;
    const rr2 = r * 1.6;
    ctx.drawImage(puff(), p.x - rr2, p.y - rr2, rr2 * 2, rr2 * 2);
  }

  ctx.globalAlpha = 1;
  // ---- speed streaks, sun glare, vignette
  const sp = clamp01((s.v - 14) / 24);
  if (sp > 0.02) {
    ctx.strokeStyle = `rgba(255,248,236,${0.34 * sp})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const r = seeded(Math.floor(t * 30) % 17);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const rr0 = (0.55 + r() * 0.35) * Math.max(w, h) * 0.6;
      const len = (0.05 + r() * 0.1) * Math.max(w, h) * sp;
      ctx.moveTo(cx + Math.cos(a) * rr0, hz + Math.sin(a) * rr0 * 0.7);
      ctx.lineTo(cx + Math.cos(a) * (rr0 + len), hz + Math.sin(a) * (rr0 + len) * 0.7);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "lighter";
  const gl = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.7);
  gl.addColorStop(0, "rgba(255,190,120,0.2)");
  gl.addColorStop(1, "rgba(255,190,120,0)");
  ctx.fillStyle = gl;
  ctx.fillRect(-20, -20, w + 40, h + 40);
  ctx.globalCompositeOperation = "source-over";
  const vg = ctx.createRadialGradient(cx, h * 0.55, h * 0.35, cx, h * 0.55, Math.max(w, h) * 0.78);
  vg.addColorStop(0, "rgba(13,16,14,0)");
  vg.addColorStop(1, "rgba(13,16,14,0.34)");
  ctx.fillStyle = vg;
  ctx.fillRect(-20, -20, w + 40, h + 40);
  if (g.flash > 0) {
    ctx.fillStyle = g.flashTone === "good" ? `rgba(138,217,168,${g.flash * 0.16})` : `rgba(224,57,43,${g.flash * 0.32})`;
    ctx.fillRect(-20, -20, w + 40, h + 40);
  }
  ctx.restore();

  hud(ctx, w, h, g, play, hz);
}

// ---------------------------------------------------------------- HUD

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const TONE = { good: "#8ad9a8", bad: "#ff8a78", info: "#f2ead7", trick: "#ffd36a" };

type HudBox = { cardL: number; cardR: number; labelBottom: number; boxBottom: number };

/** `short` when `text` won't fit `max` px in the current font */
function fit(ctx: CanvasRenderingContext2D, text: string, short: string, max: number) {
  return ctx.measureText(text).width <= max ? text : short;
}

function hud(ctx: CanvasRenderingContext2D, w: number, h: number, g: Game, play: boolean, hz: number) {
  const s = g.run;
  const u = Math.max(0.62, Math.min(1.15, Math.min(w / 980, h / 640)));
  const gates = g.C.gates;
  const total = s.finished ? s.finishT + s.pen : s.t + s.pen;
  const pad = 16 * u;
  ctx.textBaseline = "alphabetic";

  if (!play) {
    // the tile preview: just the clock and the gate count
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(13,16,14,0.55)";
    rr(ctx, pad * 0.7, pad * 0.7, 150 * u, 40 * u, 10 * u);
    ctx.fill();
    ctx.fillStyle = "#f2ead7";
    display(ctx, 26 * u, 800);
    ctx.fillText(fmt(total), pad * 1.3, pad * 0.7 + 29 * u);
    mono(ctx, 9 * u);
    ctx.fillStyle = "#8ad9a8";
    ctx.fillText(`GATE ${Math.min(s.next + 1, gates.length)}/${gates.length}`, pad * 1.3 + 78 * u, pad * 0.7 + 27 * u);
    return;
  }

  // Phones: the layout scales with u, but small text never drops under 10 px
  // and box widths follow their text instead of a fixed multiple of u.
  const compact = w < 520;
  const sm = (px: number) => Math.max(10, px * u);
  const ip = Math.max(9, 14 * u);
  const live = g.phase === "run" || g.phase === "finish" || g.phase === "result";
  const ready = g.phase === "ready";
  const resultUp = g.phase === "result" || (g.phase === "finish" && g.phaseT > 0.6);
  // on a phone the start and result cards need the room the clock and speedo
  // take (it reads 0:00.0 on one and repeats itself on the other)
  const hudA = compact ? (ready || g.phase === "result" ? 0 : g.phase === "finish" ? 1 - clamp01((g.phaseT - 0.6) / 0.4) : 1) : 1;

  // widths that follow the text
  display(ctx, 46 * u, 800);
  const timeW = ctx.measureText("0:00.0").width;
  const kmhNumW = ctx.measureText("888").width;
  mono(ctx, sm(10));
  const penW = ctx.measureText("+0.0 S PENALTY").width;
  const kmhW = ctx.measureText("KM/H").width;
  const cbw = Math.max(190 * u, 2 * ip + Math.max(timeW, penW));
  const sbw = Math.max(150 * u, 2 * ip + kmhNumW + 6 + kmhW);
  const sbx = w - pad - sbw;
  const boxBottom = pad + 82 * u;
  const pipY = pad + 8 * u;
  const labelY = pipY + Math.max(30 * u, 12 * u + 13);
  const labelBottom = labelY + 4;
  let paceBottom = boxBottom;

  if (hudA > 0) {
    ctx.globalAlpha = hudA;
    // clock
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(13,16,14,0.5)";
    rr(ctx, pad, pad, cbw, 82 * u, 12 * u);
    ctx.fill();
    ctx.fillStyle = "#f2ead7";
    display(ctx, 46 * u, 800);
    ctx.fillText(fmt(live ? total : 0), pad + ip, pad + 47 * u);
    mono(ctx, sm(10));
    if (s.pen > 0) {
      ctx.fillStyle = "#ff8a78";
      ctx.fillText(`+${s.pen.toFixed(1)} S PENALTY`, pad + ip, pad + 68 * u);
    } else {
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText(s.finished ? "CLEAN RUN" : "CLEAN SO FAR", pad + ip, pad + 68 * u);
    }
    if (g.pace !== null && live) {
      const good = g.pace <= 0;
      const py = pad + 90 * u;
      const ph = Math.max(34 * u, 26);
      const pn = `${good ? "−" : "+"}${Math.abs(g.pace).toFixed(2)}`;
      display(ctx, 24 * u, 800);
      const pnw = ctx.measureText(pn).width;
      mono(ctx, sm(9));
      const label = compact ? "VS GOLD" : "VS GOLD PACE";
      const plw = ctx.measureText(label).width;
      const pw2 = Math.max(cbw, 2 * ip + pnw + 8 + plw);
      ctx.fillStyle = "rgba(13,16,14,0.5)";
      rr(ctx, pad, py, pw2, ph, 10 * u);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillStyle = good ? "#8ad9a8" : "#ff8a78";
      display(ctx, 24 * u, 800);
      ctx.globalAlpha = hudA * (0.6 + 0.4 * clamp01(1.5 - g.paceAge));
      ctx.fillText(pn, pad + ip, py + ph * 0.72);
      ctx.globalAlpha = hudA;
      mono(ctx, sm(9));
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText(label, pad + ip + pnw + 8, py + ph * 0.66);
      paceBottom = py + ph;
    }

    // gate pips along the top, in the gap between the clock and the speedo
    {
      const gapL = pad + cbw + 8;
      const gapR = sbx - 8;
      const mid = compact ? (gapL + gapR) / 2 : w / 2;
      const pw = Math.min(2 * Math.min(mid - gapL, gapR - mid), gates.length * 11 * u);
      const gap = pw / gates.length;
      const x0 = mid - pw / 2;
      gates.forEach((_, i) => {
        const done = i < s.next;
        ctx.fillStyle = done ? (s.gateOk[i] ? "#8ad9a8" : "#ff6a58") : i === s.next ? "#f2ead7" : "rgba(242,234,215,0.28)";
        const hh = i === s.next ? 12 * u : 8 * u;
        ctx.fillRect(x0 + i * gap, pipY + (12 * u - hh), Math.max(2, gap - 3 * u), hh);
      });
      ctx.textAlign = "center";
      mono(ctx, sm(9));
      ctx.fillStyle = "#cfd0c6";
      ctx.fillText(`GATE ${Math.min(s.next + 1, gates.length)} OF ${gates.length}`, mid, labelY);
    }

    // speed
    {
      const kmh = Math.round(s.v * 3.6);
      const barH = Math.max(4, 6 * u);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(13,16,14,0.5)";
      rr(ctx, sbx, pad, sbw, 82 * u, 12 * u);
      ctx.fill();
      ctx.fillStyle = "#f2ead7";
      display(ctx, 46 * u, 800);
      ctx.fillText(`${kmh}`, sbx + sbw - ip - kmhW - 6, pad + 47 * u);
      mono(ctx, sm(10));
      ctx.fillStyle = "#b5b6ab";
      ctx.textAlign = "left";
      ctx.fillText("KM/H", sbx + sbw - ip - kmhW, pad + 47 * u);
      // a bar: fills with speed; the tip shows how hard the edges are working
      const bx = sbx + ip;
      const bw = sbw - 2 * ip;
      ctx.fillStyle = "rgba(242,234,215,0.16)";
      ctx.fillRect(bx, pad + 62 * u, bw, barH);
      ctx.fillStyle = "#8ad9a8";
      ctx.fillRect(bx, pad + 62 * u, bw * clamp01(s.v / 38), barH);
      const grip = clamp01(Math.abs(s.aLat) / 16);
      ctx.fillStyle = s.skid > 0.15 ? "#ff6a58" : "rgba(242,234,215,0.9)";
      ctx.fillRect(bx, pad + 62 * u + barH + 2, bw * grip, 2);
    }
    ctx.globalAlpha = 1;
  }

  // toasts, centre: below the clock, the pace chip and the speedo
  const tsz = (tone: string) => (tone === "trick" ? 66 : 44) * u;
  let ty = Math.max(h * 0.2, (compact ? paceBottom : boxBottom) + (g.toasts.length ? 0.85 * tsz(g.toasts[0].tone) : 0) + 8);
  for (const tt of g.toasts) {
    const a = clamp01(Math.min(tt.age / 0.12, (tt.life - tt.age) / 0.35));
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.fillStyle = TONE[tt.tone];
    display(ctx, tsz(tt.tone), 800);
    ctx.fillText(tt.text, w / 2, ty - (1 - a) * 10);
    if (tt.sub) {
      mono(ctx, sm(11));
      ctx.fillStyle = "#f2ead7";
      const sub = tt.sub.toUpperCase();
      // the sky behind the toasts is bright: a soft shadow keeps the small line readable
      ctx.shadowColor = "rgba(13,16,14,0.7)";
      ctx.shadowBlur = 5;
      ctx.fillText(fit(ctx, sub, sub.slice(0, 22), w - 16), w / 2, ty + Math.max(20 * u, 16));
      ctx.shadowBlur = 0;
      ty += 24 * u;
    }
    ty += 52 * u;
    ctx.globalAlpha = 1;
  }

  // arrow pointing at the next gate when it's off screen
  const nx = g.C.gates[s.next];
  if (nx && live && !s.finished && s.crash <= 0) {
    const d = nx.z - g.cam.z;
    const f = h > w * 1.2 ? w * 1.35 : Math.max(Math.min(1.2 * h, 0.95 * w), w * 0.5);
    const sx = w / 2 + ((nx.x - g.cam.x) * f) / Math.max(1, d);
    if (sx < 40 || sx > w - 40) {
      const side = sx < 40 ? -1 : 1;
      const ax = side < 0 ? 30 * u : w - 30 * u;
      const ay = hz + (h - hz) * 0.4;
      ctx.fillStyle = "rgba(138,217,168,0.85)";
      ctx.beginPath();
      ctx.moveTo(ax + side * 14 * u, ay);
      ctx.lineTo(ax - side * 8 * u, ay - 16 * u);
      ctx.lineTo(ax - side * 8 * u, ay + 16 * u);
      ctx.closePath();
      ctx.fill();
    }
  }

  // hint line
  if (live && g.hintAge < 9 && !s.finished) {
    ctx.globalAlpha = clamp01((9 - g.hintAge) / 1.5);
    ctx.textAlign = "center";
    mono(ctx, sm(10.5));
    ctx.fillStyle = "rgba(13,16,14,0.55)";
    const msg = w > 640 && !coarse() ? "← → CARVE THROUGH THE GATES   ·   ↓ OR HOLD TO TUCK   ·   ← → IN THE AIR SPINS" : "DRAG TO CARVE  ·  GO BETWEEN THE POLES";
    const mw = Math.min(w - 24, ctx.measureText(msg).width + 28 * u);
    const hh = Math.max(26 * u, 24);
    rr(ctx, w / 2 - mw / 2, h - 16 * u - hh, mw, hh, hh / 2);
    ctx.fill();
    ctx.fillStyle = "#f2ead7";
    ctx.fillText(msg, w / 2, h - 16 * u - hh / 2 + 4);
    ctx.globalAlpha = 1;
  }

  if (g.phase === "run" && g.phaseT < 0.8 && s.t < 1.2) {
    ctx.textAlign = "center";
    ctx.globalAlpha = clamp01(1 - g.phaseT / 0.8);
    ctx.fillStyle = "#8ad9a8";
    display(ctx, 150 * u * (1 + g.phaseT * 0.2), 800);
    ctx.fillText("GO", w / 2, h * 0.36);
    ctx.globalAlpha = 1;
  }
  const hb: HudBox = { cardL: pad + cbw + 6, cardR: sbx - 6, labelBottom, boxBottom };
  if (ready) readyCard(ctx, w, h, g, u, compact, hb);
  else if (g.phase === "count") {
    const n = 3 - Math.floor(g.phaseT / 0.85);
    const frac = (g.phaseT % 0.85) / 0.85;
    ctx.textAlign = "center";
    ctx.globalAlpha = 1 - frac * 0.6;
    ctx.fillStyle = "#f2ead7";
    display(ctx, 170 * u * (1.15 - frac * 0.15), 800);
    ctx.fillText(String(Math.max(1, n)), w / 2, h * 0.36);
    ctx.globalAlpha = 1;
  } else if (resultUp) resultCard(ctx, w, h, g, u, compact, hb);
}

function readyCard(ctx: CanvasRenderingContext2D, w: number, h: number, g: Game, u: number, compact: boolean, hb: HudBox) {
  const sm = Math.max(10.5, 10.5 * u);
  const cw = Math.min(w - 24, compact ? 360 : 560 * Math.max(u, 0.9));
  const x = w / 2 - cw / 2;
  // sit between the clock row and the start banner, never over either
  const hudClear = x < hb.cardL || x + cw > hb.cardR ? hb.boxBottom : hb.labelBottom;
  const top = compact ? 8 : hudClear + 8;
  const bottom = Math.min(h - 8, (Number.isFinite(g.startTop) ? g.startTop : h * 0.5) - 10);
  const T = compact ? 36 : Math.min(46, Math.max(30, 46 * u));
  const rulesWide = `MISS A GATE: +${PENALTY.toFixed(1)} S   ·   TUCK ON THE STRAIGHTS   ·   DON'T SKID`;
  mono(ctx, sm);
  const oneLine = ctx.measureText(rulesWide).width <= cw - 32;
  const rules = oneLine ? [rulesWide] : [`MISS A GATE: +${PENALTY.toFixed(1)} S`, "TUCK ON THE STRAIGHTS  ·  DON'T SKID"];
  // drop the header line, then the rules, if the room above the banner is short
  const dropHead = [false, true, true];
  const dropRules = [false, false, true];
  const heightFor = (k: number) => 14 + (dropHead[k] ? 0 : 20) + T * 0.95 + (dropRules[k] ? 0 : rules.length * 16 + 3) + 40 + 26;
  let v = 0;
  while (v < 2 && top + heightFor(v) > bottom) v++;
  const ch = heightFor(v);
  const y = Math.max(top, top + (bottom - top - ch) / 2);
  ctx.fillStyle = "rgba(13,16,14,0.74)";
  rr(ctx, x, y, cw, ch, 16);
  ctx.fill();
  ctx.textAlign = "center";
  let cur = y + 14;
  if (!dropHead[v]) {
    ctx.fillStyle = "#8ad9a8";
    mono(ctx, sm);
    ctx.fillText(`GIANT SLALOM  ·  ${g.C.gates.length} GATES  ·  1.4 KM`, w / 2, cur + 11);
    cur += 20;
  }
  ctx.fillStyle = "#f2ead7";
  display(ctx, T, 800);
  ctx.fillText("Go gate to gate.", w / 2, cur + T * 0.78);
  cur += T * 0.95;
  if (!dropRules[v]) {
    mono(ctx, sm);
    ctx.fillStyle = "#cfd0c6";
    rules.forEach((line, i) => ctx.fillText(line, w / 2, cur + 11 + i * 16));
    cur += rules.length * 16 + 3;
  }
  // medal targets
  const p = g.par;
  const cols = [
    ["GOLD", p.gold, "#e8b93f"],
    ["SILVER", p.silver, "#c9ccd1"],
    ["BRONZE", p.bronze, "#c98a5a"],
  ] as const;
  cols.forEach(([name, tm, col], i) => {
    const cx = x + (cw / 3) * (i + 0.5);
    display(ctx, 22, 800);
    const tw = ctx.measureText(fmt(tm)).width;
    mono(ctx, sm);
    const gw = 14 + 8 + Math.max(tw, ctx.measureText(name).width);
    const gx = cx - gw / 2;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(gx + 6, cur + 13, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = "#f2ead7";
    display(ctx, 22, 800);
    ctx.fillText(fmt(tm), gx + 20, cur + 20);
    ctx.fillStyle = "#b5b6ab";
    mono(ctx, sm);
    ctx.fillText(name, gx + 20, cur + 33);
  });
  cur += 40;
  ctx.textAlign = "center";
  ctx.fillStyle = "#f2ead7";
  mono(ctx, Math.max(11, sm));
  const pulse = 0.65 + 0.35 * Math.sin(g.time * 4);
  ctx.globalAlpha = pulse;
  ctx.fillText(coarse() ? "TAP TO DROP IN" : "PRESS ENTER, SPACE OR TAP TO DROP IN", w / 2, cur + 13);
  ctx.globalAlpha = 1;
}

function resultCard(ctx: CanvasRenderingContext2D, w: number, h: number, g: Game, u0: number, compact: boolean, hb: HudBox) {
  const r = g.result;
  if (!r) return;
  const u = compact ? 0.9 : u0;
  const sm = Math.max(10.5, 10 * u);
  const a = clamp01((g.phase === "finish" ? g.phaseT - 0.6 : 1) / 0.4);
  const cw = Math.min(w - 24, 540 * u);
  const ch = 292 * u;
  const x = w / 2 - cw / 2;
  const clear = compact ? 8 : (x < hb.cardL || x + cw > hb.cardR ? hb.boxBottom : hb.labelBottom) + 8;
  const y = Math.max(clear, Math.min(h * 0.1, h - ch - 8));
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(13,16,14,0.8)";
  rr(ctx, x, y, cw, ch, 16 * u);
  ctx.fill();
  const medalCol = ["#6b6e68", "#e8b93f", "#c9ccd1", "#c98a5a"][r.medal];
  // medal
  ctx.fillStyle = medalCol;
  ctx.beginPath();
  ctx.arc(x + 62 * u, y + 66 * u, 34 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(13,16,14,0.25)";
  ctx.beginPath();
  ctx.arc(x + 62 * u, y + 66 * u, 26 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = r.medal ? "#0d100e" : "#d9d9d0";
  ctx.textAlign = "center";
  display(ctx, 34 * u, 800);
  ctx.fillText(r.medal ? String(r.medal) : "–", x + 62 * u, y + 78 * u);
  ctx.textAlign = "left";
  const tx = x + 112 * u;
  const room = cw - 112 * u - 12;
  mono(ctx, sm);
  ctx.fillStyle = "#8ad9a8";
  const best = r.newBest ? "  ·  NEW BEST" : "";
  const head = r.medal ? `${MEDALS[r.medal].toUpperCase()} MEDAL${best}` : `NO MEDAL YET${best}`;
  ctx.fillText(fit(ctx, head, head.replace("  ·  NEW BEST", " · NEW BEST"), room), tx, y + 34 * u);
  ctx.fillStyle = "#f2ead7";
  display(ctx, 62 * u, 800);
  ctx.fillText(fmt(r.total), tx, y + 88 * u);
  mono(ctx, sm);
  ctx.fillStyle = "#b5b6ab";
  const clock = `${fmt(r.raw)} ON THE CLOCK${r.pen ? `  +  ${r.pen.toFixed(1)} PENALTY` : ""}`;
  ctx.fillText(fit(ctx, clock, `${fmt(r.raw)} + ${r.pen.toFixed(1)} PENALTY`, room), tx, y + 110 * u);
  // stats grid
  const stats: [string, string][] = [
    ["GATES", `${r.gates - r.missed}/${r.gates}`],
    ["TOP SPEED", `${Math.round(r.top * 3.6)} km/h`],
    ["BEST AIR", r.air > 0.05 ? `${r.air.toFixed(1)} s` : "–"],
    ["SPINS", String(r.tricks)],
    ["WIPEOUTS", String(r.crashes)],
    ["BEST", fmt(r.best)],
  ];
  const cols = 3;
  const gw = (cw - 40 * u) / cols;
  stats.forEach(([k, v], i) => {
    const sx = x + 20 * u + (i % cols) * gw;
    const sy = y + 138 * u + Math.floor(i / cols) * 46 * u;
    ctx.fillStyle = "#f2ead7";
    display(ctx, 22 * u, 800);
    ctx.fillText(v, sx, sy + 18 * u);
    ctx.fillStyle = "#b5b6ab";
    mono(ctx, sm);
    ctx.fillText(k, sx, sy + 32 * u);
  });
  // next target
  const p = g.par;
  const nextT = r.medal === 0 ? ["bronze", p.bronze] : r.medal === 3 ? ["silver", p.silver] : r.medal === 2 ? ["gold", p.gold] : null;
  ctx.textAlign = "center";
  mono(ctx, sm);
  ctx.fillStyle = "#cfd0c6";
  const nextMsg = nextT ? `${(nextT[0] as string).toUpperCase()} IS ${fmt(nextT[1] as number)}` : r.tricks ? "GOLD. CAN YOU SHAVE ANOTHER SECOND?" : "GOLD. NOW TRY A 360 OFF THE JUMP.";
  ctx.fillText(fit(ctx, nextMsg, nextMsg.replace("CAN YOU ", "").replace("NOW ", ""), cw - 24), w / 2, y + ch - 36 * u);
  ctx.fillStyle = "#f2ead7";
  ctx.globalAlpha = a * (0.65 + 0.35 * Math.sin(g.time * 4));
  mono(ctx, Math.max(11, sm));
  ctx.fillText(coarse() ? "TAP TO RUN IT AGAIN" : "PRESS ENTER OR TAP TO RUN IT AGAIN", w / 2, y + ch - 14 * u);
  ctx.globalAlpha = 1;
}
