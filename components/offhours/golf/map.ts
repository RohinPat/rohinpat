import { mono } from "../font";
import type { BuiltHole } from "./course";
import type { CourseGame, MapView } from "./play";

// The hole map: the hole drawn flat from the course's own data (the rough and the
// fairway as outlines, sand, water, the green, the trees that stop a ball), tee at
// the bottom and the pin up. The ground is drawn once into a canvas of its own and
// kept; each frame only adds the shots so far, the aim, the pin and the ball. A tap
// or a drag on it sets the aim (play.ts reads `mapView`). On a wide screen it is a
// small inset in the bottom right, clear of the HUD; on a narrow one it opens
// across the screen. Nothing in it moves, so reduced motion needs no change.

const PAPER = "#f2ead7";
const MINT = "#8ad9a8";
const PANEL = "rgba(13,16,14,0.86)";
const WOODS = "#21472a";
const ROUGH = "#3f7a3b";
const FAIRWAY = "#a2d870";
const SAND = "#ead9a2";
const SAND_EDGE = "#b8a56d";
const WATER = "#4f9bb0";
const WATER_EDGE = "#2c6f86";
const GREEN = "#c4f092";
const FRINGE = "#8ccb64";

/** below this width the map is a chip that opens it across the screen */
export const MAP_WIDE = 800;
const INSET_W = 150;
const PAD = 8;

type Rect = { x: number; y: number; w: number; h: number };

/** where the map is drawn, for a canvas of w by h */
export function mapRect(w: number, h: number): Rect {
  if (w >= MAP_WIDE) {
    const hh = Math.max(120, Math.min(260, h - 78));
    return { x: w - PAD - INSET_W, y: h - PAD - hh, w: INSET_W, h: hh };
  }
  // across the screen, under the HUD's top row and clear of the ball marker and the swing gauge
  const y = 92;
  return { x: PAD, y, w: w - 2 * PAD, h: Math.max(120, Math.min(460, h - y - 184)) };
}

/** the hole fitted into a rect: metres to pixels, z up */
export function fit(hole: BuiltHole, r: Rect) {
  const b = hole.shape.box;
  const m = 7;
  const scale = Math.min((r.w - 2 * m) / (b.x1 - b.x0), (r.h - 2 * m) / (b.z1 - b.z0));
  const ox = r.x + r.w / 2 - ((b.x0 + b.x1) / 2) * scale;
  const oz = r.y + r.h / 2 + ((b.z0 + b.z1) / 2) * scale;
  return {
    scale,
    px: (x: number) => ox + x * scale,
    py: (z: number) => oz - z * scale,
    at: (px: number, py: number): [number, number] => [(px - ox) / scale, (oz - py) / scale],
  };
}

const ring = (ctx: CanvasRenderingContext2D, pts: [number, number][], px: (x: number) => number, py: (z: number) => number) => {
  ctx.beginPath();
  pts.forEach(([x, z], i) => (i ? ctx.lineTo(px(x), py(z)) : ctx.moveTo(px(x), py(z))));
  ctx.closePath();
};

/** the ground, with the rect's own corner at (r.x, r.y) */
function ground(ctx: CanvasRenderingContext2D, hole: BuiltHole, r: Rect) {
  const f = fit(hole, r);
  const w = hole.world;
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 6);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 5);
  ctx.clip();
  ctx.fillStyle = WOODS;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = ROUGH;
  ring(ctx, hole.shape.rough, f.px, f.py);
  ctx.fill();
  ctx.fillStyle = FAIRWAY;
  ring(ctx, hole.shape.fairway, f.px, f.py);
  ctx.fill();
  ctx.lineWidth = 1;
  for (const o of w.sand ?? []) {
    ctx.fillStyle = SAND;
    ctx.strokeStyle = SAND_EDGE;
    ring(ctx, o, f.px, f.py);
    ctx.fill();
    ctx.stroke();
  }
  for (const o of w.water) {
    ctx.fillStyle = WATER;
    ctx.strokeStyle = WATER_EDGE;
    ring(ctx, o, f.px, f.py);
    ctx.fill();
    ctx.stroke();
  }
  // the green, with its fringe
  const g = w.greens[0];
  for (const [rad, col] of [[g.r + g.fringe, FRINGE], [g.r, GREEN]] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    g.ring(rad).forEach(([x, , z], i) => (i ? ctx.lineTo(f.px(x), f.py(z)) : ctx.moveTo(f.px(x), f.py(z))));
    ctx.closePath();
    ctx.fill();
  }
  // the trees that stop a ball
  ctx.fillStyle = "#12301b";
  for (const t of hole.blockers) {
    ctx.beginPath();
    ctx.arc(f.px(t.x), f.py(t.z), Math.max(2.2, t.r * f.scale), 0, 7);
    ctx.fill();
  }
  // the tee
  ctx.fillStyle = PAPER;
  ctx.fillRect(f.px(0) - 2.5, f.py(0) - 2.5, 5, 5);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 6);
  ctx.stroke();
}

// the ground is kept, one canvas per hole and size
type Kept = { key: string; c: HTMLCanvasElement | null };
const kept = new WeakMap<BuiltHole, Kept>();

function drawGround(ctx: CanvasRenderingContext2D, hole: BuiltHole, r: Rect) {
  const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const key = `${Math.round(r.w)}x${Math.round(r.h)}@${dpr}`;
  let k = kept.get(hole);
  if (!k || k.key !== key) {
    let c: HTMLCanvasElement | null = null;
    try {
      c = document.createElement("canvas");
      c.width = Math.ceil(r.w * dpr);
      c.height = Math.ceil(r.h * dpr);
      const cx = c.getContext("2d");
      if (cx) {
        cx.scale(dpr, dpr);
        ground(cx, hole, { x: 0, y: 0, w: r.w, h: r.h });
      } else c = null;
    } catch {
      c = null;
    }
    k = { key, c };
    kept.set(hole, k);
  }
  if (k.c) ctx.drawImage(k.c, r.x, r.y, r.w, r.h);
  else ground(ctx, hole, r);
}

/** the hole as it was played, for the hole card: the ground, each shot, and the putts as a dotted line to the cup */
export function mapPlayed(ctx: CanvasRenderingContext2D, g: CourseGame, r: Rect, putted: boolean) {
  const hole = g.hole;
  const f = fit(hole, r);
  drawGround(ctx, hole, r);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 5);
  ctx.clip();
  ctx.lineCap = "round";
  const [pxm, pzm] = hole.pin;
  const last = g.legs[g.legs.length - 1];
  if (putted && last) {
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([1, 3]);
    ctx.beginPath();
    ctx.moveTo(f.px(last[2]), f.py(last[3]));
    ctx.lineTo(f.px(pxm), f.py(pzm));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 1.6;
  for (const [x0, z0, x1, z1] of g.legs) {
    ctx.beginPath();
    ctx.moveTo(f.px(x0), f.py(z0));
    ctx.lineTo(f.px(x1), f.py(z1));
    ctx.stroke();
  }
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = "rgba(13,16,14,0.9)";
  ctx.lineWidth = 1;
  for (const [, , x1, z1] of g.legs) {
    ctx.beginPath();
    ctx.arc(f.px(x1), f.py(z1), 2.4, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
  // the cup
  ctx.fillStyle = "#e5484d";
  ctx.beginPath();
  ctx.arc(f.px(pxm), f.py(pzm), 2.6, 0, 7);
  ctx.fill();
  ctx.restore();
}

/** should the map be drawn now */
export const mapShown = (g: CourseGame, w: number) => g.mapOpen && (g.phase === "ready" || g.phase === "swing" || g.phase === "fly" || g.phase === "rest" || (g.phase === "tee-card" && w >= MAP_WIDE));

/**
 * Draw the map over the shot view, and tell the game where it is (for taps and drags). `carry` is where the selected
 * club's carry comes down, with no wind (metres).
 */
export function mapDraw(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number, carry: { x: number; z: number }) {
  if (!mapShown(g, w)) {
    g.mapView = null;
    return;
  }
  const r = mapRect(w, h);
  const hole = g.hole;
  const f = fit(hole, r);
  const view: MapView = { x: r.x, y: r.y, w: r.w, h: r.h, at: f.at };
  g.mapView = view;
  drawGround(ctx, hole, r);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 5);
  ctx.clip();
  // the shots so far
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(242,234,215,0.75)";
  ctx.lineWidth = 1.5;
  for (const [x0, z0, x1, z1] of g.legs) {
    ctx.beginPath();
    ctx.moveTo(f.px(x0), f.py(z0));
    ctx.lineTo(f.px(x1), f.py(z1));
    ctx.stroke();
  }
  // the pin
  const [pxm, pzm] = hole.pin;
  const fx = f.px(pxm), fy = f.py(pzm);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx, fy - 9);
  ctx.stroke();
  ctx.fillStyle = "#e5484d";
  ctx.beginPath();
  ctx.moveTo(fx, fy - 9);
  ctx.lineTo(fx + 6, fy - 6.5);
  ctx.lineTo(fx, fy - 4);
  ctx.fill();
  // the aim, and where the club's carry comes down
  const bx = f.px(g.ball[0]), by = f.py(g.ball[1]);
  if (g.phase === "ready" || g.phase === "swing") {
    const cx = f.px(carry.x), cy = f.py(carry.z);
    ctx.strokeStyle = MINT;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(4, 2.2 * f.scale), 0, 7);
    ctx.stroke();
  }
  // the ball
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(13,16,14,0.9)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(bx, by, 3.2, 0, 7);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // on a narrow screen it says what a tap does
  if (w < MAP_WIDE && g.phase === "ready") {
    mono(ctx, 10);
    const text = "TAP OR DRAG TO AIM";
    const tw = ctx.measureText(text).width + 20;
    ctx.fillStyle = "rgba(13,16,14,0.82)";
    ctx.beginPath();
    ctx.roundRect(r.x + r.w / 2 - tw / 2, r.y + r.h - 30, tw, 22, 4);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.textAlign = "center";
    ctx.fillText(text, r.x + r.w / 2, r.y + r.h - 15);
    ctx.textAlign = "left";
  }
}
