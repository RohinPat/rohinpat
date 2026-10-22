import { seeded } from "../useCanvas";
import { display } from "../font";
import type { Surface } from "./flight";

// The range as a place: a small software 3D camera (perspective projection
// with near-plane clipping, so the camera can sit behind the golfer, pan
// with the ball and dolly down the range), and everything that stands on the
// ground in it: mown stripes, target greens with flags, bunkers, yardage
// boards, a tree line, hills, sky. Drawn far to near, with distance haze.

export const YD = 0.9144;

export type Cam = {
  x: number; y: number; z: number;
  tx: number; ty: number; tz: number;
  F: number;
  // set by prepare()
  cx: number; cy: number;
  rx: number; ry: number; rz: number;
  ux: number; uy: number; uz: number;
  fx: number; fy: number; fz: number;
  /** horizon row, in px */
  horizon: number;
};

export function newCam(): Cam {
  return { x: 0, y: 2, z: -6, tx: 0, ty: 1, tz: 60, F: 800, cx: 0, cy: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1, horizon: 0 };
}

export function prepare(c: Cam, w: number, h: number, cyFrac = 0.42) {
  let fx = c.tx - c.x, fy = c.ty - c.y, fz = c.tz - c.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // right = up × f (horizontal)
  let rx = fz, rz = -fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  // up = f × right
  const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
  c.rx = rx; c.ry = 0; c.rz = rz;
  c.ux = ux; c.uy = uy; c.uz = uz;
  c.fx = fx; c.fy = fy; c.fz = fz;
  c.cx = w / 2;
  c.cy = h * cyFrac;
  // horizon: the direction (f horizontal)
  const hl = Math.hypot(fx, fz) || 1;
  const hx = fx / hl, hz = fz / hl;
  const zc = hx * fx + hz * fz;
  const yc = hx * ux + hz * uz;
  c.horizon = c.cy - (c.F * yc) / Math.max(1e-4, zc);
}

export type P2 = { x: number; y: number; d: number; s: number };

export function project(c: Cam, x: number, y: number, z: number, out: P2): boolean {
  const px = x - c.x, py = y - c.y, pz = z - c.z;
  const zc = px * c.fx + py * c.fy + pz * c.fz;
  if (zc < 0.3) return false;
  const xc = px * c.rx + py * c.ry + pz * c.rz;
  const yc = px * c.ux + py * c.uy + pz * c.uz;
  const k = c.F / zc;
  out.x = c.cx + xc * k;
  out.y = c.cy - yc * k;
  out.d = zc;
  out.s = k;
  return true;
}

/** a direction at infinity (sky things) */
export function projectDir(c: Cam, dx: number, dy: number, dz: number, out: P2): boolean {
  const zc = dx * c.fx + dy * c.fy + dz * c.fz;
  if (zc < 0.05) return false;
  const xc = dx * c.rx + dy * c.ry + dz * c.rz;
  const yc = dx * c.ux + dy * c.uy + dz * c.uz;
  const k = c.F / zc;
  out.x = c.cx + xc * k;
  out.y = c.cy - yc * k;
  out.d = 1e6;
  out.s = k;
  return true;
}

const NEAR = 0.35;
type V3 = [number, number, number];

/** fill a flat or 3D polygon given in world coordinates, clipped to the near plane */
export function poly(ctx: CanvasRenderingContext2D, c: Cam, pts: V3[], fill: string | CanvasGradient, stroke?: string, lw = 1) {
  const cam: V3[] = [];
  for (const [x, y, z] of pts) {
    const px = x - c.x, py = y - c.y, pz = z - c.z;
    cam.push([px * c.rx + py * c.ry + pz * c.rz, px * c.ux + py * c.uy + pz * c.uz, px * c.fx + py * c.fy + pz * c.fz]);
  }
  const out: V3[] = [];
  for (let i = 0; i < cam.length; i++) {
    const a = cam[i], b = cam[(i + 1) % cam.length];
    const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const u = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, NEAR]);
    }
  }
  if (out.length < 3) return;
  ctx.beginPath();
  for (let i = 0; i < out.length; i++) {
    const [xc, yc, zc] = out[i];
    const k = c.F / zc;
    const sx = c.cx + xc * k, sy = c.cy - yc * k;
    if (i) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- colour

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const HAZE = hex("#cfe3e4");
export function mixc(a: RGB, b: RGB, t: number) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
const fogAt = (d: number) => Math.min(0.72, 1 - Math.exp(-d / 520));

const C = {
  fairA: hex("#79b957"),
  fairB: hex("#6aab4d"),
  rough: hex("#4a8a42"),
  deep: hex("#3a7339"),
  green: hex("#8fd16b"),
  greenB: hex("#82c562"),
  fringe: hex("#6db553"),
  sand: hex("#ead9a2"),
};

// ---------------------------------------------------------------- the range

export type Target = { yd: number; x: number; r: number; name: string; gx: number; gz: number; gr: number };

const TARGET_DEF: [number, number, number][] = [
  [60, -9, 8],
  [100, 15, 9.5],
  [140, -20, 10.5],
  [175, 7, 11],
  [210, -24, 12],
  [250, 22, 13],
];
export const TARGETS: Target[] = TARGET_DEF.map(([yd, x, r]) => ({
  yd, x, r, name: `${yd}`, gx: x * YD, gz: yd * YD, gr: r * YD,
}));

const BUNKERS: [number, number, number][] = TARGETS.flatMap((t, i): [number, number, number][] => {
  const side = i % 2 ? -1 : 1;
  return [
    [t.gx + side * (t.gr + 2.5), t.gz - t.gr * 0.4, 3.2 + (i % 3) * 0.6],
    [t.gx - side * (t.gr * 0.3), t.gz - t.gr - 2.2, 2.6],
  ];
});

export const halfW = (z: number) => 27 + Math.max(0, z) * 0.085;
const END = 338;

export function surfaceAt(x: number, z: number): Surface {
  if (z > END) return "out";
  for (const [bx, bz, br] of BUNKERS) if ((x - bx) ** 2 + (z - bz) ** 2 < br * br) return "bunker";
  for (const t of TARGETS) {
    const d = Math.hypot(x - t.gx, z - t.gz);
    if (d < t.gr) return "green";
    if (d < t.gr + 2.8) return "fringe";
  }
  const hw = halfW(z);
  if (Math.abs(x) < hw && z > -10) return "fairway";
  if (Math.abs(x) < hw + 20) return "rough";
  return "out";
}

type Tree = { x: number; z: number; h: number; kind: number; flip: boolean };
const TREES: Tree[] = (() => {
  const r = seeded(77);
  const out: Tree[] = [];
  for (const side of [-1, 1]) {
    for (let z = -25; z < 350; z += 4 + r() * 4) {
      const row = r();
      out.push({ x: side * (halfW(z) + 24 + r() * 8), z, h: 11 + r() * 9, kind: Math.floor(r() * 4), flip: r() > 0.5 });
      if (row > 0.45) out.push({ x: side * (halfW(z) + 34 + r() * 16), z: z + r() * 4, h: 15 + r() * 10, kind: Math.floor(r() * 4), flip: r() > 0.5 });
    }
  }
  for (let row = 0; row < 3; row++)
    for (let x = -230; x < 230; x += 6 + r() * 4) out.push({ x, z: END + 14 + row * 14 + r() * 6, h: 15 + r() * 12 + row * 3, kind: Math.floor(r() * 4), flip: r() > 0.5 });
  return out;
})();

// tree sprites, drawn once per kind and haze level
const SW = 120, SH = 190;
const sprites: HTMLCanvasElement[][] = [];
function sprite(kind: number, fog: number) {
  const key = Math.round(fog * 3);
  const row = (sprites[kind] ??= []);
  if (row[key]) return row[key];
  const cv = document.createElement("canvas");
  cv.width = SW;
  cv.height = SH;
  const g = cv.getContext("2d")!;
  const f = key / 3;
  const m = (col: string) => mixc(hex(col), HAZE, f * 0.8);
  const r = seeded(kind * 31 + 5);
  // trunk
  g.fillStyle = m("#4a3a2c");
  g.fillRect(SW / 2 - 4, SH - 46, 8, 46);
  if (kind === 2 || kind === 3) {
    // conifer / poplar: stacked tiers, lit from the upper left
    const tiers = kind === 2 ? 6 : 8;
    const base = kind === 2 ? 50 : 28;
    for (let i = 0; i < tiers; i++) {
      const u = i / tiers;
      const y = SH - 34 - u * (SH - 44);
      const wv = (base - u * (base - 6)) * (0.9 + r() * 0.2);
      const grad = g.createLinearGradient(SW / 2 - wv, 0, SW / 2 + wv, 0);
      grad.addColorStop(0, m(kind === 2 ? "#3e8a54" : "#4a9a50"));
      grad.addColorStop(0.5, m(kind === 2 ? "#2c6b40" : "#37803f"));
      grad.addColorStop(1, m(kind === 2 ? "#1d4d2f" : "#27602f"));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(SW / 2, y - 34);
      g.quadraticCurveTo(SW / 2 + wv * 0.6, y - 8, SW / 2 + wv, y);
      g.quadraticCurveTo(SW / 2, y + 7, SW / 2 - wv, y);
      g.quadraticCurveTo(SW / 2 - wv * 0.6, y - 8, SW / 2, y - 34);
      g.fill();
    }
  } else {
    // broadleaf: a cluster of lobes, shaded dark under and light on top-left
    const lobes: [number, number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.55;
      lobes.push([SW / 2 + Math.cos(a) * d * 44, 76 + Math.sin(a) * d * 52 - 6, 24 + r() * 14]);
    }
    const dark = kind === 0 ? "#1f5a30" : "#2a6c32";
    const mid = kind === 0 ? "#2f7a3d" : "#3e8d3f";
    const lite = kind === 0 ? "#4c9c4c" : "#69b050";
    for (const [lx, ly, lr] of lobes) {
      g.fillStyle = m(dark);
      g.beginPath();
      g.arc(lx + 2, ly + 5, lr, 0, 7);
      g.fill();
    }
    for (const [lx, ly, lr] of lobes) {
      g.fillStyle = m(mid);
      g.beginPath();
      g.arc(lx, ly, lr * 0.92, 0, 7);
      g.fill();
    }
    for (const [lx, ly, lr] of lobes) {
      g.fillStyle = m(lite);
      g.beginPath();
      g.arc(lx - lr * 0.28, ly - lr * 0.32, lr * 0.5, 0, 7);
      g.fill();
    }
  }
  row[key] = cv;
  return cv;
}

// clouds: soft clusters at fixed directions
const CLOUDS = (() => {
  const r = seeded(9);
  return Array.from({ length: 11 }, () => ({ az: (r() - 0.5) * 2.6, el: 0.12 + r() * 0.5, w: 0.07 + r() * 0.1, puffs: Array.from({ length: 6 }, () => [(r() - 0.5) * 1.6, (r() - 0.5) * 0.35, 0.35 + r() * 0.4] as [number, number, number]) }));
})();

function ridge(az: number, layer: number) {
  const k = layer * 7.3;
  return 0.012 + layer * 0.006 + (Math.sin(az * 2.3 + k) * 0.5 + 0.5) * 0.028 + Math.sin(az * 7.1 + k * 2) * 0.006 + Math.sin(az * 17 + k) * 0.002;
}

const p2: P2 = { x: 0, y: 0, d: 0, s: 0 };
const p3: P2 = { x: 0, y: 0, d: 0, s: 0 };

export type Wind = { x: number; z: number };

export type Drawable = { d: number; draw: () => void };

/** the whole static world, far to near. `extra` is drawn in depth order with the scenery (golfer, flags...). */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  w: number,
  h: number,
  t: number,
  wind: Wind,
  opts: { highlight?: number; extra?: Drawable[] } = {},
) {
  const hor = Math.max(-50, Math.min(h * 0.95, cam.horizon));
  // ---- sky
  const sky = ctx.createLinearGradient(0, 0, 0, Math.max(40, hor));
  sky.addColorStop(0, "#5b9bd5");
  sky.addColorStop(0.55, "#9cc8e8");
  sky.addColorStop(1, "#d9ebea");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, Math.max(0, hor) + 2);
  // sun glow
  const sun = 0.5;
  if (projectDir(cam, Math.sin(0.5) * Math.cos(sun), Math.sin(sun), Math.cos(0.5) * Math.cos(sun), p2)) {
    const rr = cam.F * 0.55;
    const gr = ctx.createRadialGradient(p2.x, p2.y, 0, p2.x, p2.y, rr);
    gr.addColorStop(0, "rgba(255,248,220,0.9)");
    gr.addColorStop(0.08, "rgba(255,244,205,0.55)");
    gr.addColorStop(1, "rgba(255,244,205,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(p2.x - rr, p2.y - rr, rr * 2, rr * 2);
  }
  // clouds
  for (const cl of CLOUDS) {
    const az = cl.az + t * 0.0025;
    if (!projectDir(cam, Math.sin(az) * Math.cos(cl.el), Math.sin(cl.el), Math.cos(az) * Math.cos(cl.el), p2)) continue;
    const sz = cam.F * cl.w;
    if (p2.x < -sz * 2 || p2.x > w + sz * 2) continue;
    for (const [dx, dy, s] of cl.puffs) {
      const gr = ctx.createRadialGradient(p2.x + dx * sz, p2.y + dy * sz - sz * 0.05 * s, 0, p2.x + dx * sz, p2.y + dy * sz, sz * s);
      gr.addColorStop(0, "rgba(255,255,255,0.92)");
      gr.addColorStop(0.6, "rgba(255,255,255,0.55)");
      gr.addColorStop(1, "rgba(235,243,250,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.ellipse(p2.x + dx * sz, p2.y + dy * sz, sz * s * 1.35, sz * s * 0.62, 0, 0, 7);
      ctx.fill();
    }
  }
  // far hills, three hazy layers by direction
  for (let layer = 2; layer >= 0; layer--) {
    ctx.fillStyle = mixc(hex(layer === 2 ? "#7ea6c0" : layer === 1 ? "#6f9aa3" : "#5f8f6e"), HAZE, 0.2 + layer * 0.22);
    ctx.beginPath();
    ctx.moveTo(-10, hor + 2);
    for (let x = -10; x <= w + 10; x += 8) {
      const dx = cam.fx + (cam.rx * (x - cam.cx)) / cam.F, dz = cam.fz + (cam.rz * (x - cam.cx)) / cam.F;
      const az = Math.atan2(dx, dz);
      const e = ridge(az, 2 - layer + 0.5);
      const ok = projectDir(cam, Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e), p2);
      ctx.lineTo(x, ok ? Math.min(p2.y, hor + 2) : hor);
    }
    ctx.lineTo(w + 10, hor + 2);
    ctx.fill();
  }
  // haze above the horizon
  const hz = ctx.createLinearGradient(0, hor - 90, 0, hor + 2);
  hz.addColorStop(0, "rgba(207,227,228,0)");
  hz.addColorStop(1, "rgba(207,227,228,0.75)");
  ctx.fillStyle = hz;
  ctx.fillRect(0, hor - 90, w, 92);

  // ---- ground
  ctx.fillStyle = mixc(C.deep, HAZE, 0.55);
  ctx.fillRect(0, Math.max(0, hor), w, h);
  const z0 = -40;
  // mown stripes: alternating bands, every 10 yd, with a checker of two lanes
  const band = 10 * YD;
  const nb = Math.ceil((END - z0) / band);
  const Z = (i: number) => z0 + i * band;
  for (let i = nb - 1; i >= 0; i--) {
    const za = Z(i), zb = Z(i + 1);
    const hwa = halfW(za), hwb = halfW(zb);
    const d = Math.max(1, (za + zb) / 2 - cam.z);
    const fg = fogAt(d);
    // rough on both sides, wide
    ctx.save();
    const rc = mixc(C.rough, HAZE, fg);
    for (const s of [-1, 1])
      poly(ctx, cam, [[s * hwa, 0, za], [s * (hwa + 24), 0, za], [s * (hwb + 24), 0, zb], [s * hwb, 0, zb]], rc);
    ctx.restore();
    // fairway: one mown band
    poly(ctx, cam, [[-hwa, 0, za], [hwa, 0, za], [hwb, 0, zb], [-hwb, 0, zb]], mixc(i % 2 ? C.fairB : C.fairA, HAZE, fg));
  }
  // the tee: a mown pad, a mat, and a line
  const tdf = fogAt(8);
  poly(ctx, cam, [[-0.9, 0.01, -0.6], [0.9, 0.01, -0.6], [0.9, 0.01, 0.8], [-0.9, 0.01, 0.8]], "#2c6a3b");
  poly(ctx, cam, [[-0.9, 0.012, -0.6], [0.9, 0.012, -0.6], [0.9, 0.012, -0.5], [-0.9, 0.012, -0.5]], "#e6dfc8");
  // bunkers
  for (const [bx, bz, br] of BUNKERS) {
    const ring: V3[] = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const k = 1 + 0.18 * Math.sin(a * 3 + bx);
      ring.push([bx + Math.cos(a) * br * 1.25 * k, 0.012, bz + Math.sin(a) * br * 0.9 * k]);
    }
    const fg = fogAt(bz - cam.z);
    poly(ctx, cam, ring, mixc(C.sand, HAZE, fg), mixc(hex("#b8a56d"), HAZE, fg), 1);
  }
  // target greens
  TARGETS.forEach((tg, idx) => {
    const fg = fogAt(tg.gz - cam.z);
    const ring = (rad: number): V3[] => {
      const o: V3[] = [];
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        o.push([tg.gx + Math.cos(a) * rad, 0.015, tg.gz + Math.sin(a) * rad]);
      }
      return o;
    };
    poly(ctx, cam, ring(tg.gr + 2.8), mixc(C.fringe, HAZE, fg));
    poly(ctx, cam, ring(tg.gr), mixc(idx % 2 ? C.green : C.greenB, HAZE, fg));
    const hl = opts.highlight === idx;
    poly(ctx, cam, ring(tg.gr * 0.55), "rgba(0,0,0,0)", hl ? "rgba(255,255,255,0.9)" : mixc(hex("#e9f6dc"), HAZE, fg + 0.2), hl ? 2.2 : 1.1);
    poly(ctx, cam, ring(tg.gr), "rgba(0,0,0,0)", hl ? "#ffffff" : mixc(hex("#e9f6dc"), HAZE, fg + 0.1), hl ? 2.6 : 1.2);
  });
  // haze on the ground, thickening to the horizon
  const gh = ctx.createLinearGradient(0, hor, 0, hor + Math.max(60, h * 0.2));
  gh.addColorStop(0, "rgba(207,227,228,0.7)");
  gh.addColorStop(1, "rgba(207,227,228,0)");
  ctx.fillStyle = gh;
  ctx.fillRect(0, Math.max(0, hor), w, Math.max(60, h * 0.2));

  // ---- things that stand up, far to near
  const items: Drawable[] = [];
  for (const tr of TREES) {
    if (!project(cam, tr.x, 0, tr.z, p3)) continue;
    const d = p3.d;
    if (d > 760) continue;
    const sx = p3.x, sy = p3.y, k = p3.s;
    const ph = tr.h * k;
    if (sx < -ph || sx > w + ph || sy < -20) continue;
    items.push({
      d,
      draw: () => {
        const fg = fogAt(d);
        const sp = sprite(tr.kind, fg);
        const hh = ph * 1.03, ww = hh * (SW / SH) * (tr.kind === 3 ? 0.8 : 1.15);
        if (tr.flip) {
          ctx.save();
          ctx.translate(sx, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(sp, -ww / 2, sy - hh, ww, hh);
          ctx.restore();
        } else ctx.drawImage(sp, sx - ww / 2, sy - hh, ww, hh);
      },
    });
  }
  // yardage boards on both sides
  for (const yd of [50, 100, 150, 200, 250, 300]) {
    for (const side of [-1, 1]) {
      const bx = side * (halfW(yd * YD) + 3.5), bz = yd * YD;
      if (!project(cam, bx, 0, bz, p3)) continue;
      const d = p3.d, k = p3.s, sx = p3.x, sy = p3.y;
      items.push({
        d,
        draw: () => {
          const bw = 1.7 * k, bh = 1.15 * k;
          const fg = fogAt(d);
          ctx.fillStyle = mixc(hex("#6d6a60"), HAZE, fg);
          ctx.fillRect(sx - 0.05 * k, sy - 1.9 * k, 0.1 * k, 1.9 * k);
          ctx.fillStyle = mixc(hex("#f2ead7"), HAZE, fg * 0.8);
          ctx.fillRect(sx - bw / 2, sy - 1.9 * k - bh * 0.1, bw, bh);
          ctx.fillStyle = mixc(hex("#1d5e3f"), HAZE, fg * 0.8);
          ctx.fillRect(sx - bw / 2, sy - 1.9 * k - bh * 0.1, bw, bh * 0.12);
          ctx.textAlign = "center";
          display(ctx, Math.max(6, bh * 0.62), 800);
          ctx.fillText(String(yd), sx, sy - 1.9 * k + bh * 0.72);
          ctx.textAlign = "left";
        },
      });
    }
  }
  // flags
  TARGETS.forEach((tg, idx) => {
    const fx = tg.gx, fz = tg.gz;
    if (!project(cam, fx, 0, fz, p3)) return;
    const d = p3.d;
    const sx = p3.x, sy = p3.y, k = p3.s;
    items.push({
      d: d - 0.1,
      draw: () => {
        const fg = fogAt(d);
        const H = 2.4;
        ctx.strokeStyle = mixc(hex("#f4efe0"), HAZE, fg * 0.7);
        ctx.lineWidth = Math.max(1, 0.05 * k);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, sy - H * k);
        ctx.stroke();
        // cloth streams with the wind (projected: wind along the screen's right)
        const wr = wind.x * cam.rx + wind.z * cam.rz;
        const lean = Math.max(-1, Math.min(1, wr / 5));
        const len = 1.1 * k * (0.35 + Math.abs(lean) * 0.65);
        const dir = lean >= 0 ? 1 : -1;
        const flutter = Math.sin(t * 7 + idx) * 0.12 * k * (0.4 + Math.abs(lean));
        const top = sy - H * k, bot = sy - (H - 0.55) * k;
        ctx.fillStyle = mixc(hex(idx % 2 ? "#e5484d" : "#edbb00"), HAZE, fg * 0.8);
        ctx.beginPath();
        ctx.moveTo(sx, top);
        ctx.quadraticCurveTo(sx + dir * len * 0.5, top + flutter, sx + dir * len, top + 0.2 * k + flutter * 1.5);
        ctx.quadraticCurveTo(sx + dir * len * 0.5, bot + flutter * 0.4, sx, bot);
        ctx.fill();
        // distance sign beside the green
        const bx = tg.gx + (idx % 2 ? 1 : -1) * (tg.gr + 5.2);
        if (project(cam, bx, 0, fz, p2)) {
          const kk = p2.s;
          ctx.fillStyle = mixc(hex("#f2ead7"), HAZE, fg * 0.8);
          ctx.fillRect(p2.x - 0.95 * kk, p2.y - 1.7 * kk, 1.9 * kk, 1.0 * kk);
          ctx.fillStyle = mixc(hex("#6d6a60"), HAZE, fg);
          ctx.fillRect(p2.x - 0.04 * kk, p2.y - 0.7 * kk, 0.08 * kk, 0.7 * kk);
          ctx.fillStyle = mixc(hex("#0d100e"), HAZE, fg);
          ctx.textAlign = "center";
          display(ctx, Math.max(6, 0.62 * kk), 800);
          ctx.fillText(tg.name, p2.x, p2.y - 0.9 * kk);
          ctx.textAlign = "left";
        }
      },
    });
  });
  for (const e of opts.extra ?? []) items.push(e);
  items.sort((a, b) => b.d - a.d);
  for (const it of items) it.draw();
}
