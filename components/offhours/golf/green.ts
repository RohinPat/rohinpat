import { seeded } from "../useCanvas";
import { display, mono } from "../font";
import { sfx } from "./sound";

// Putting: nine greens, each a height field (a tilt plus Gaussian hills, in
// metres). Drawn top-down as a lit relief (the way a hillshade shows terrain)
// with faint contours, so the slope is something you see rather than a lot of
// lines. Pull back from the ball and let go: the putter swings through, the
// ball rolls under slope and rolling friction, and either drops or lips out.
// "Read" pours water that runs the way the putt will break. The aim line shows
// direction and pace on a flat green only; the break is yours to read.

export const GW = 20;
export const GH = 12.5;
const CUP_R = 0.054;
const MU = 0.065 * 9.81;
const ROLL = (5 / 7) * 9.81;
export const HOLES = 9;
const PICK_UP = 7;

type Hill = { x: number; y: number; a: number; s: number };
type Hole = {
  n: number;
  hills: Hill[];
  tilt: [number, number];
  cup: [number, number];
  tee: [number, number];
  par: number;
  shape: [number, number, number, number, number, number]; // radial wobble: amp/phase x3
};

const DIST = [4.5, 6.2, 7.6, 9.4, 6.9, 11.2, 8.6, 12.4, 10.2];

function shapeR(H: Hole, th: number) {
  const s = H.shape;
  return 1 + s[0] * Math.sin(2 * th + s[1]) + s[2] * Math.sin(3 * th + s[3]) + s[4] * Math.sin(5 * th + s[5]);
}
/** 0 inside the green, 1 on the fringe, 2 in the rough */
function zone(H: Hole, x: number, y: number) {
  const u = (x - GW / 2) / (GW / 2), v = (y - GH / 2) / (GH / 2);
  const rho = Math.hypot(u, v);
  const r = shapeR(H, Math.atan2(v, u));
  if (rho < r) return 0;
  if (rho < r + 0.085) return 1;
  return 2;
}

export function makeHole(n: number): Hole {
  const r = seeded(300 + n * 37);
  const k = 0.55 + n * 0.075; // the greens get more severe
  const hills = Array.from({ length: 4 + Math.floor(r() * 3) }, () => ({ x: r() * GW, y: r() * GH, a: (r() - 0.45) * 0.55 * k, s: 1.9 + r() * 2.8 }));
  const H: Hole = {
    n,
    hills,
    tilt: [(r() - 0.5) * 0.05 * k, (r() - 0.5) * 0.05 * k],
    cup: [0, 0],
    tee: [0, 0],
    par: 2,
    shape: [0.05 + r() * 0.04, r() * 6, 0.04 + r() * 0.03, r() * 6, 0.02 + r() * 0.02, r() * 6],
  };
  const want = DIST[(n - 1) % DIST.length];
  for (let tries = 0; tries < 400; tries++) {
    const tx = GW * (0.12 + r() * 0.76), ty = GH * (0.15 + r() * 0.7);
    const a = r() * Math.PI * 2;
    const cx = tx + Math.cos(a) * want, cy = ty + Math.sin(a) * want;
    const inside = (x: number, y: number) => Math.hypot((x - GW / 2) / (GW / 2), (y - GH / 2) / (GH / 2)) < 0.8 * shapeR(H, Math.atan2((y - GH / 2) / (GH / 2), (x - GW / 2) / (GW / 2)));
    if (inside(tx, ty) && inside(cx, cy)) {
      H.tee = [tx, ty];
      H.cup = [cx, cy];
      break;
    }
  }
  if (!H.cup[0]) {
    H.tee = [GW * 0.25, GH * 0.5];
    H.cup = [GW * 0.25 + want, GH * 0.5];
  }
  H.par = want > 10.5 ? 3 : 2;
  return H;
}

/** height and its slope at a point (analytic) */
function hg(H: Hole, x: number, y: number, out: [number, number, number]) {
  let z = H.tilt[0] * x + H.tilt[1] * y;
  let gx = H.tilt[0], gy = H.tilt[1];
  for (const h of H.hills) {
    const dx = x - h.x, dy = y - h.y;
    const e = h.a * Math.exp(-(dx * dx + dy * dy) / (2 * h.s * h.s));
    z += e;
    gx += (-e * dx) / (h.s * h.s);
    gy += (-e * dy) / (h.s * h.s);
  }
  // the cup sits in a tiny bowl
  const dx = x - H.cup[0], dy = y - H.cup[1];
  const e = -0.008 * Math.exp(-(dx * dx + dy * dy) / 0.08);
  z += e;
  gx += (-e * dx) / 0.04;
  gy += (-e * dy) / 0.04;
  out[0] = z;
  out[1] = gx;
  out[2] = gy;
}

type Ball = { x: number; y: number; vx: number; vy: number; moving: boolean; sunk: boolean };
type Drop = { x: number; y: number; vx: number; vy: number; trail: [number, number][]; life: number };

const tmp: [number, number, number] = [0, 0, 0];

/** advance the ball one step; returns "sunk" / "lip" when something happens at the cup */
function stepBall(H: Hole, b: Ball, dt: number): "sunk" | "lip" | null {
  hg(H, b.x, b.y, tmp);
  const mul = (z: number) => (z === 0 ? 1 : z === 1 ? 2.8 : 7.5);
  const zn = zone(H, b.x, b.y);
  b.vx -= ROLL * tmp[1] * dt;
  b.vy -= ROLL * tmp[2] * dt;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > 0) {
    const dec = Math.min(sp, MU * mul(zn) * dt);
    b.vx -= (b.vx / sp) * dec;
    b.vy -= (b.vy / sp) * dec;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  // the world's edge
  const X0 = -3.5, X1 = GW + 3.5, Y0 = -3, Y1 = GH + 3;
  if (b.x < X0 || b.x > X1) {
    b.x = Math.max(X0, Math.min(X1, b.x));
    b.vx *= -0.2;
  }
  if (b.y < Y0 || b.y > Y1) {
    b.y = Math.max(Y0, Math.min(Y1, b.y));
    b.vy *= -0.2;
  }
  const ddx = b.x - H.cup[0], ddy = b.y - H.cup[1];
  const dc = Math.hypot(ddx, ddy);
  const v = Math.hypot(b.vx, b.vy);
  if (dc < CUP_R) {
    // fast and off-centre lips out; slow, or dead centre, drops
    if (v < 1.55 * (1 - 0.6 * (dc / CUP_R))) {
      b.sunk = true;
      b.moving = false;
      return "sunk";
    }
    const nx = ddx / (dc || 1), ny = ddy / (dc || 1);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx = (b.vx - 1.7 * vn * nx) * 0.72;
      b.vy = (b.vy - 1.7 * vn * ny) * 0.72;
      return "lip";
    }
  }
  if (v < 0.025) {
    const slope = Math.hypot(tmp[1], tmp[2]) * ROLL;
    if (slope < MU * mul(zn) * 1.15) {
      b.moving = false;
      b.vx = 0;
      b.vy = 0;
    }
  }
  return null;
}

const pace = (pow: number) => 0.12 + 4.7 * Math.pow(pow, 1.6);
const powFor = (speed: number) => Math.pow(Math.max(0, speed - 0.12) / 4.7, 1 / 1.6);

/** try a putt on a copy of the green: where does it end up */
function trial(H: Hole, x: number, y: number, ang: number, speed: number) {
  const b: Ball = { x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, moving: true, sunk: false };
  let best = Math.hypot(x - H.cup[0], y - H.cup[1]);
  for (let i = 0; i < 6000 && b.moving; i++) {
    const e = stepBall(H, b, 1 / 240);
    best = Math.min(best, Math.hypot(b.x - H.cup[0], b.y - H.cup[1]));
    if (e === "sunk") return { sunk: true, d: 0 };
  }
  return { sunk: false, d: Math.hypot(b.x - H.cup[0], b.y - H.cup[1]) };
}

// ---------------------------------------------------------------- state

export type PuttEnv = { play: boolean; say: (m: string) => void };

export type Putt = {
  hole: Hole;
  ball: Ball;
  strokes: number;
  scores: (number | null)[];
  pars: number[];
  aiming: boolean;
  aimFrom: { x: number; y: number };
  aimTo: { x: number; y: number };
  kAngle: number;
  kPower: number;
  kCharging: boolean;
  kTouched: number;
  drops: Drop[];
  reading: boolean;
  readT: number;
  sunkT: number;
  dropT: number;
  call: string;
  callT: number;
  fade: number;
  nextT: number;
  done: boolean;
  doneT: number;
  trail: [number, number][];
  trailAge: number;
  putter: { t: number; dx: number; dy: number; pull: number; speed: number; hit: boolean } | null;
  auto: number;
  lipT: number;
  startT: number;
  view: { sc: number; cx: number; cy: number; rot: boolean; w: number; h: number };
  cache: { key: string; c: HTMLCanvasElement } | null;
  arrows: { key: string; pts: [number, number, number, number][] } | null;
  held: number;
};

export function newPutt(): Putt {
  const p: Putt = {
    hole: makeHole(1),
    ball: { x: 0, y: 0, vx: 0, vy: 0, moving: false, sunk: false },
    strokes: 0,
    scores: Array(HOLES).fill(null),
    pars: Array.from({ length: HOLES }, (_, i) => makeHole(i + 1).par),
    aiming: false,
    aimFrom: { x: 0, y: 0 },
    aimTo: { x: 0, y: 0 },
    kAngle: 0,
    kPower: 0,
    kCharging: false,
    kTouched: -9,
    drops: [],
    reading: false,
    readT: 0,
    sunkT: 0,
    dropT: 0,
    call: "",
    callT: -9,
    fade: 1,
    nextT: -1,
    done: false,
    doneT: 0,
    trail: [],
    trailAge: 0,
    putter: null,
    auto: 1.6,
    lipT: -9,
    startT: 0,
    view: { sc: 30, cx: 0, cy: 0, rot: false, w: 0, h: 0 },
    cache: null,
    arrows: null,
    held: 0,
  };
  setupHole(p, 1);
  return p;
}

function setupHole(p: Putt, n: number) {
  p.hole = makeHole(n);
  p.ball = { x: p.hole.tee[0], y: p.hole.tee[1], vx: 0, vy: 0, moving: false, sunk: false };
  p.strokes = 0;
  p.drops = [];
  p.trail = [];
  p.putter = null;
  p.sunkT = 0;
  p.dropT = 0;
  p.nextT = -1;
  p.kAngle = Math.atan2(p.hole.cup[1] - p.ball.y, p.hole.cup[0] - p.ball.x);
  p.kPower = 0;
  p.kCharging = false;
  p.aiming = false;
  p.readT = 0;
  p.auto = 1.5;
}

export function puttRestart(p: Putt) {
  p.scores = Array(HOLES).fill(null);
  p.done = false;
  p.fade = 0;
  setupHole(p, 1);
}

export function puttRead(p: Putt, on: boolean) {
  p.reading = on;
  p.aiming = false;
  p.kCharging = false;
  p.drops = [];
  if (on) {
    // one pour along the line from the ball to the cup
    const H = p.hole;
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      p.drops.push({
        x: p.ball.x + (H.cup[0] - p.ball.x) * u + (Math.random() - 0.5) * 0.4,
        y: p.ball.y + (H.cup[1] - p.ball.y) * u + (Math.random() - 0.5) * 0.4,
        vx: 0,
        vy: 0,
        trail: [],
        life: 4.2,
      });
    }
    p.readT = 0;
  }
}

// ---------------------------------------------------------------- mapping

function layout(p: Putt, w: number, h: number, play: boolean) {
  const bottom = play ? (w < 560 ? 62 : 66) : 0;
  const rot = h > w * 1.1;
  const uh = h - bottom;
  const sc = rot ? Math.min((w - 16) / (GH + 1.6), (uh - 16) / (GW + 1.6)) : Math.min((w - 16) / (GW + 1.6), (uh - 16) / (GH + 1.6));
  p.view = { sc, cx: w / 2, cy: uh / 2 + (play ? 4 : 0), rot, w, h };
}
const sx = (v: Putt["view"], x: number, y: number) => (v.rot ? v.cx - (y - GH / 2) * v.sc : v.cx + (x - GW / 2) * v.sc);
const sy = (v: Putt["view"], x: number, y: number) => (v.rot ? v.cy + (x - GW / 2) * v.sc : v.cy + (y - GH / 2) * v.sc);
function toWorld(v: Putt["view"], px: number, py: number) {
  return v.rot ? { x: GW / 2 + (py - v.cy) / v.sc, y: GH / 2 - (px - v.cx) / v.sc } : { x: GW / 2 + (px - v.cx) / v.sc, y: GH / 2 + (py - v.cy) / v.sc };
}

// ---------------------------------------------------------------- input

const dragMax = (v: Putt["view"]) => Math.max(110, Math.min(260, Math.min(v.w, v.h) * 0.34));

export function puttPointer(p: Putt, kind: "down" | "move" | "up", x: number, y: number, t: number, env: PuttEnv) {
  const v = p.view;
  if (p.done) {
    if (kind === "down" && t - p.doneT > 0.8) puttRestart(p);
    return;
  }
  if (p.reading) {
    if (kind === "down" || (kind === "move" && p.held > 0)) {
      const wp = toWorld(v, x, y);
      for (let i = 0; i < (kind === "down" ? 90 : 14); i++)
        p.drops.push({ x: wp.x + (Math.random() - 0.5) * 0.9, y: wp.y + (Math.random() - 0.5) * 0.9, vx: 0, vy: 0, trail: [], life: 3.6 });
    }
    p.held = kind === "up" ? 0 : 1;
    return;
  }
  if (kind === "down") {
    if (p.ball.moving || p.ball.sunk || p.putter) return;
    p.aiming = true;
    p.aimFrom = { x, y };
    p.aimTo = { x, y };
    p.aimFrom = { x: sx(v, p.ball.x, p.ball.y), y: sy(v, p.ball.x, p.ball.y) };
  } else if (kind === "move") {
    if (p.aiming) p.aimTo = { x, y };
  } else {
    if (!p.aiming) return;
    p.aiming = false;
    const dx = p.aimFrom.x - p.aimTo.x, dy = p.aimFrom.y - p.aimTo.y;
    const pow = Math.min(1, Math.hypot(dx, dy) / dragMax(v));
    if (pow < 0.03) return;
    // screen drag back -> world direction
    const w0 = toWorld(v, p.aimFrom.x, p.aimFrom.y);
    const w1 = toWorld(v, p.aimFrom.x + dx, p.aimFrom.y + dy);
    strike(p, w1.x - w0.x, w1.y - w0.y, pow, t, env);
  }
}

function strike(p: Putt, dx: number, dy: number, pow: number, t: number, env: PuttEnv, delay = 0) {
  const d = Math.hypot(dx, dy) || 1;
  p.putter = { t: -delay, dx: dx / d, dy: dy / d, pull: pow, speed: pace(pow), hit: false };
  p.kAngle = Math.atan2(dy, dx);
  void t;
  void env;
}

export function puttKey(p: Putt, e: KeyboardEvent, down: boolean, t: number, env: PuttEnv): boolean {
  if (e.key === "r" || e.key === "R") {
    if (down && !e.repeat) {
      puttRead(p, !p.reading);
      env.say(p.reading ? "Reading the green: press Space to pour water where the pointer is." : "Back to putting.");
    }
    return true;
  }
  if (p.reading) return false; // arrows move the pointer, Space pours
  if (p.done) {
    if ((e.key === " " || e.key === "Enter") && down && !e.repeat && t - p.doneT > 0.8) puttRestart(p);
    return e.key === " " || e.key === "Enter";
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (down) {
      p.kAngle += (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.1 : 0.03);
      p.kTouched = t;
    }
    return true;
  }
  if (e.key === " " || e.key === "Enter") {
    if (down && !e.repeat && !p.ball.moving && !p.ball.sunk && !p.putter) {
      p.kCharging = true;
      p.kPower = 0;
      p.kTouched = t;
    } else if (!down && p.kCharging) {
      p.kCharging = false;
      if (p.kPower > 0.03) strike(p, Math.cos(p.kAngle), Math.sin(p.kAngle), p.kPower, t, env);
      p.kPower = 0;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- sim

function callFor(strokes: number, par: number) {
  const d = strokes - par;
  return strokes === 1 ? "HOLE IN ONE" : d <= -2 ? "EAGLE" : d === -1 ? "BIRDIE" : d === 0 ? "PAR" : d === 1 ? "BOGEY" : d === 2 ? "DOUBLE BOGEY" : `+${d}`;
}

function finishHole(p: Putt, t: number, env: PuttEnv, pickedUp = false) {
  const H = p.hole;
  p.scores[H.n - 1] = p.strokes;
  p.call = pickedUp ? "PICK UP" : callFor(p.strokes, H.par);
  p.callT = t;
  p.nextT = t + 2.1;
  if (env.play) env.say(`Hole ${H.n}: ${p.strokes} ${p.strokes === 1 ? "stroke" : "strokes"}, ${p.call.toLowerCase()}.`);
}

function advance(p: Putt, t: number, env: PuttEnv) {
  const H = p.hole;
  if (H.n >= HOLES) {
    p.done = true;
    p.doneT = t;
    const tot = p.scores.reduce<number>((a, b) => a + (b ?? 0), 0);
    const par = p.pars.reduce((a, b) => a + b, 0);
    if (env.play) env.say(`Round complete: ${tot} strokes, ${tot - par === 0 ? "even par" : tot - par > 0 ? `${tot - par} over par` : `${par - tot} under par`}.`);
    return;
  }
  p.fade = 0;
  setupHole(p, H.n + 1);
  p.startT = t;
}

function update(p: Putt, dt: number, t: number, env: PuttEnv) {
  const H = p.hole;
  p.fade = Math.min(1, p.fade + dt * 4);
  if (p.done) {
    if (!env.play && t - p.doneT > 3.2) puttRestart(p);
    return;
  }
  // the putter swings through, and the ball leaves when it arrives
  if (p.putter) {
    const pt = p.putter;
    pt.t += dt;
    if (!pt.hit && pt.t >= 0.11 + (1 - pt.pull) * 0.04) {
      pt.hit = true;
      p.ball.vx = pt.dx * pt.speed;
      p.ball.vy = pt.dy * pt.speed;
      p.ball.moving = true;
      p.strokes++;
      p.trail = [[p.ball.x, p.ball.y]];
      p.trailAge = 0;
      if (env.play) sfx("putt", pt.pull);
    }
    if (pt.t > 0.5) p.putter = null;
  }
  if (p.kCharging) p.kPower = Math.min(1, p.kPower + dt * 0.62);
  if (p.ball.moving && !p.ball.sunk) {
    let ev: "sunk" | "lip" | null = null;
    for (let i = 0; i < 4 && !ev && p.ball.moving; i++) ev = stepBall(H, p.ball, dt / 4);
    const last = p.trail[p.trail.length - 1];
    if (!last || Math.hypot(last[0] - p.ball.x, last[1] - p.ball.y) > 0.05) {
      p.trail.push([p.ball.x, p.ball.y]);
      if (p.trail.length > 600) p.trail.shift();
    }
    if (ev === "sunk") {
      p.sunkT = t;
      p.dropT = 0;
      if (env.play) sfx("cup");
      finishHole(p, t, env);
    } else if (ev === "lip" && t - p.lipT > 0.6) {
      p.lipT = t;
      p.call = "LIP OUT";
      p.callT = t;
      if (env.play) sfx("lip");
    }
    if (!p.ball.moving && !p.ball.sunk) {
      p.trailAge = 0;
      if (p.strokes >= PICK_UP) finishHole(p, t, env, true);
      else p.kAngle = Math.atan2(H.cup[1] - p.ball.y, H.cup[0] - p.ball.x);
    }
  } else if (!p.ball.moving) p.trailAge += dt;
  if (p.ball.sunk) {
    p.dropT += dt;
    if (p.nextT > 0 && t > p.nextT) {
      p.nextT = -1;
      advance(p, t, env);
    }
  } else if (p.nextT > 0 && t > p.nextT) {
    p.nextT = -1;
    advance(p, t, env);
  }
  // water
  for (const d of p.drops) {
    hg(H, d.x, d.y, tmp);
    d.vx = d.vx * (1 - dt * 1.2) - tmp[1] * 9.81 * dt * 6;
    d.vy = d.vy * (1 - dt * 1.2) - tmp[2] * 9.81 * dt * 6;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.trail.push([d.x, d.y]);
    if (d.trail.length > 60) d.trail.shift();
    d.life -= dt;
  }
  p.drops = p.drops.filter((d) => d.life > 0 && d.x > -3 && d.x < GW + 3 && d.y > -3 && d.y < GH + 3);
  if (p.reading) p.readT += dt;

  // the self-playing demo: it reads the green by trying putts
  if (!env.play && !p.ball.moving && !p.ball.sunk && !p.putter && p.nextT < 0 && !p.done) {
    p.auto -= dt;
    if (p.auto <= 0) {
      const base = Math.atan2(H.cup[1] - p.ball.y, H.cup[0] - p.ball.x);
      const dist = Math.hypot(H.cup[0] - p.ball.x, H.cup[1] - p.ball.y);
      let best = { s: 0, a: base, score: 1e9 };
      for (let da = -0.32; da <= 0.32; da += 0.04)
        for (const f of [0.82, 0.95, 1.05, 1.18]) {
          const spd = Math.sqrt(2 * MU * dist) * f + 0.2;
          const r = trial(H, p.ball.x, p.ball.y, base + da, spd);
          const sc = r.sunk ? -1 : r.d;
          if (sc < best.score) best = { s: spd, a: base + da, score: sc };
        }
      const err = Math.random() < 0.35 ? (Math.random() - 0.5) * 0.12 : 0;
      p.kAngle = best.a + err;
      const pw = Math.min(1, Math.max(0.02, powFor(best.s * (1 + (Math.random() - 0.5) * 0.06))));
      // show the pull-back before the strike
      strike(p, Math.cos(best.a + err), Math.sin(best.a + err), pw, t, env, 0.55);
      p.auto = 1.6;
    }
  }
}

// ---------------------------------------------------------------- drawing

export function puttDraw(ctx: CanvasRenderingContext2D, p: Putt, w: number, h: number, dt: number, t: number, env: PuttEnv, pointer: { x: number; y: number; inside: boolean }) {
  const play = env.play;
  layout(p, w, h, play);
  update(p, dt, t, env);
  const v = p.view;
  const H = p.hole;
  const X = (x: number, y: number) => sx(v, x, y);
  const Y = (x: number, y: number) => sy(v, x, y);

  const key = `${H.n}-${Math.round(w)}-${Math.round(h)}-${play ? 1 : 0}`;
  if (p.cache?.key !== key) p.cache = { key, c: renderGreen(H, w, h, p) };
  ctx.drawImage(p.cache.c, 0, 0, w, h);

  const sc = v.sc;
  const bx = X(p.ball.x, p.ball.y), by = Y(p.ball.x, p.ball.y);
  const cxp = X(H.cup[0], H.cup[1]), cyp = Y(H.cup[0], H.cup[1]);

  // reading aids: slope arrows, then the water
  if (p.reading) {
    const a = Math.min(1, p.readT * 2.5);
    ctx.globalAlpha = 0.55 * a;
    ctx.strokeStyle = "#f2ead7";
    ctx.fillStyle = "#f2ead7";
    ctx.lineWidth = 1.2;
    const step = 1.15;
    for (let gy = step / 2; gy < GH; gy += step)
      for (let gx = step / 2; gx < GW; gx += step) {
        if (zone(H, gx, gy) !== 0) continue;
        hg(H, gx, gy, tmp);
        const m = Math.hypot(tmp[1], tmp[2]);
        if (m < 0.004) continue;
        const dx = -tmp[1] / m, dy = -tmp[2] / m; // downhill, in the world
        const len = Math.min(0.5, 6 * m + 0.08) * sc;
        const ax = X(gx, gy), ay = Y(gx, gy);
        // downhill in screen space
        const ex = X(gx + dx, gy + dy) - ax, ey = Y(gx + dx, gy + dy) - ay;
        const el = Math.hypot(ex, ey) || 1;
        const ux = ex / el, uy = ey / el;
        ctx.beginPath();
        ctx.moveTo(ax - (ux * len) / 2, ay - (uy * len) / 2);
        ctx.lineTo(ax + (ux * len) / 2, ay + (uy * len) / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax + (ux * len) / 2, ay + (uy * len) / 2);
        ctx.lineTo(ax + (ux * len) / 2 - ux * 5 + uy * 3, ay + (uy * len) / 2 - uy * 5 - ux * 3);
        ctx.lineTo(ax + (ux * len) / 2 - ux * 5 - uy * 3, ay + (uy * len) / 2 - uy * 5 + ux * 3);
        ctx.fill();
      }
    ctx.globalAlpha = 1;
    for (const d of p.drops) {
      const al = Math.min(1, d.life) * 0.8;
      ctx.strokeStyle = `rgba(160,220,255,${al * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      d.trail.forEach(([x, y], i) => (i ? ctx.lineTo(X(x, y), Y(x, y)) : ctx.moveTo(X(x, y), Y(x, y))));
      ctx.stroke();
      ctx.fillStyle = `rgba(225,245,255,${al})`;
      ctx.beginPath();
      ctx.arc(X(d.x, d.y), Y(d.x, d.y), 1.8, 0, 7);
      ctx.fill();
    }
  }

  // where the last putt actually went
  if (p.trail.length > 1 && !p.reading) {
    const fadeA = p.ball.moving ? 0.55 : Math.max(0, 0.55 - p.trailAge * 0.12);
    if (fadeA > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${fadeA})`;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      p.trail.forEach(([x, y], i) => (i ? ctx.lineTo(X(x, y), Y(x, y)) : ctx.moveTo(X(x, y), Y(x, y))));
      ctx.stroke();
    }
  }

  // ---- the cup
  const cr = Math.max(4.2, CUP_R * sc * 1.55);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(cxp + 0.5, cyp + 1, cr * 1.18, cr * 1.1, 0, 0, 7);
  ctx.fill();
  const cg = ctx.createRadialGradient(cxp, cyp - cr * 0.3, cr * 0.1, cxp, cyp, cr);
  cg.addColorStop(0, "#050806");
  cg.addColorStop(0.75, "#0b120d");
  cg.addColorStop(1, "#27382b");
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(cxp, cyp, cr, 0, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(233,246,220,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cxp, cyp, cr, Math.PI * 0.85, Math.PI * 1.75);
  ctx.stroke();

  // ---- the ball (and the drop into the cup)
  const br = Math.max(3.4, sc * 0.082);
  const nearBall = Math.hypot(p.ball.x - H.cup[0], p.ball.y - H.cup[1]) < 2.4;
  if (p.ball.sunk) {
    const u = Math.min(1, p.dropT / 0.3);
    if (u < 1) {
      const k = 1 - u * u;
      const rr = br * k;
      ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * k})`;
      ctx.beginPath();
      ctx.arc(cxp, cyp + u * cr * 0.25, Math.max(0.5, rr), 0, 7);
      ctx.fill();
    }
    // a ring for the plop
    const ru = Math.min(1, p.dropT / 0.8);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - ru)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cxp, cyp, cr + ru * sc * 0.9, 0, 7);
    ctx.stroke();
  } else {
    // the putter
    if (p.putter) drawPutter(ctx, p, X, Y, sc);
    else if (p.aiming && play) {
      const dx = p.aimFrom.x - p.aimTo.x, dy = p.aimFrom.y - p.aimTo.y;
      const pow = Math.min(1, Math.hypot(dx, dy) / dragMax(v));
      const w0 = toWorld(v, p.aimFrom.x, p.aimFrom.y), w1 = toWorld(v, p.aimFrom.x + dx, p.aimFrom.y + dy);
      drawPutterAt(ctx, p, X, Y, sc, w1.x - w0.x, w1.y - w0.y, pow, 0);
    } else if (play && !p.ball.moving && (p.kCharging || t - p.kTouched < 3)) {
      drawPutterAt(ctx, p, X, Y, sc, Math.cos(p.kAngle), Math.sin(p.kAngle), p.kPower, 0);
    }
    // ball shadow and ball
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(bx + br * 0.3, by + br * 0.4, br * 1.05, br * 0.95, 0, 0, 7);
    ctx.fill();
    const bg = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
    bg.addColorStop(0, "#ffffff");
    bg.addColorStop(0.7, "#f1f1ea");
    bg.addColorStop(1, "#c4c7bd");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, 7);
    ctx.fill();
  }

  // ---- the flagstick, drawn in screen space; it ghosts when the ball is near
  {
    const fa = nearBall && !p.ball.sunk ? 0.3 : 1;
    ctx.globalAlpha = fa;
    const hgt = Math.min(sc * 1.7, 90);
    // shadow on the green
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.moveTo(cxp, cyp);
    ctx.lineTo(cxp + hgt * 0.55, cyp + hgt * 0.35);
    ctx.lineTo(cxp + hgt * 0.55 + 3, cyp + hgt * 0.35 + 2);
    ctx.lineTo(cxp + 2, cyp + 1);
    ctx.fill();
    ctx.strokeStyle = "#f2ead7";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cxp, cyp);
    ctx.lineTo(cxp, cyp - hgt);
    ctx.stroke();
    const wave = Math.sin(t * 5 + 1) * 3 + (p.ball.sunk && p.dropT < 0.6 ? Math.sin(p.dropT * 40) * 4 * (1 - p.dropT / 0.6) : 0);
    ctx.fillStyle = "#e5484d";
    const fw = hgt * 0.5, fh = hgt * 0.3;
    ctx.beginPath();
    ctx.moveTo(cxp, cyp - hgt);
    ctx.quadraticCurveTo(cxp + fw * 0.55, cyp - hgt + 1 + wave * 0.5, cxp + fw, cyp - hgt + fh * 0.5 + wave);
    ctx.quadraticCurveTo(cxp + fw * 0.5, cyp - hgt + fh * 0.7 + wave * 0.3, cxp, cyp - hgt + fh);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---- aim line and pace: flat ground, no break
  if (play && !p.ball.moving && !p.ball.sunk && !p.reading && !p.done) {
    let dx = 0, dy = 0, pow = 0, show = false;
    if (p.aiming) {
      const sdx = p.aimFrom.x - p.aimTo.x, sdy = p.aimFrom.y - p.aimTo.y;
      pow = Math.min(1, Math.hypot(sdx, sdy) / dragMax(v));
      const w0 = toWorld(v, p.aimFrom.x, p.aimFrom.y), w1 = toWorld(v, p.aimFrom.x + sdx, p.aimFrom.y + sdy);
      dx = w1.x - w0.x;
      dy = w1.y - w0.y;
      show = pow > 0.02;
    } else if (p.kCharging || t - p.kTouched < 3) {
      dx = Math.cos(p.kAngle);
      dy = Math.sin(p.kAngle);
      pow = p.kPower;
      show = true;
    }
    if (show && !p.putter) {
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const flat = (pace(pow) * pace(pow)) / (2 * MU); // metres, on a flat green
      const L = p.kCharging && pow === 0 ? 3 : flat;
      const ex = p.ball.x + ux * L, ey = p.ball.y + uy * L;
      ctx.strokeStyle = "rgba(242,234,215,0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 7]);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(X(ex, ey), Y(ex, ey));
      ctx.stroke();
      ctx.setLineDash([]);
      // the pace marker where a flat putt would stop
      const mx = X(ex, ey), my = Y(ex, ey);
      ctx.strokeStyle = pow > 0.9 ? "#e5484d" : "#8ad9a8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, 7);
      ctx.stroke();
      const ft = Math.round(flat * 3.281);
      mono(ctx, 10);
      const txt = `${ft} FT`;
      const tw = ctx.measureText(txt).width + 12;
      const tx = Math.max(6, Math.min(w - tw - 6, mx + 10)), ty = Math.max(16, my - 8);
      ctx.fillStyle = "rgba(13,16,14,0.78)";
      ctx.beginPath();
      ctx.roundRect(tx, ty - 13, tw, 18, 4);
      ctx.fill();
      ctx.fillStyle = "#f2ead7";
      ctx.fillText(txt, tx + 6, ty);
    }
  }

  // ---- HUD
  hud(ctx, p, w, h, t, play, pointer);

  // hole transition
  if (p.fade < 1) {
    ctx.fillStyle = `rgba(13,16,14,${1 - p.fade})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawPutterAt(ctx: CanvasRenderingContext2D, p: Putt, X: (x: number, y: number) => number, Y: (x: number, y: number) => number, sc: number, dx: number, dy: number, pow: number, fwd: number) {
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const back = 0.2 + pow * 0.95 - fwd;
  const hx = p.ball.x - ux * back, hy = p.ball.y - uy * back;
  paintPutter(ctx, X(hx, hy), Y(hx, hy), X(hx + ux, hy + uy) - X(hx, hy), Y(hx + ux, hy + uy) - Y(hx, hy), sc, 0.95);
}

function drawPutter(ctx: CanvasRenderingContext2D, p: Putt, X: (x: number, y: number) => number, Y: (x: number, y: number) => number, sc: number) {
  const pt = p.putter!;
  const arrive = 0.11 + (1 - pt.pull) * 0.04;
  const startBack = 0.2 + pt.pull * 0.95;
  // pull back first (a short pause), then accelerate through
  let back: number;
  if (pt.t < 0) back = startBack * (1 + pt.t * 0.06);
  else if (pt.t < arrive) {
    const u = pt.t / arrive;
    back = startBack * (1 - u * u);
  } else back = -Math.min(0.5, (pt.t - arrive) * 3.2) * (0.4 + pt.pull);
  const hx = p.ball.x - pt.dx * (back + 0.045), hy = p.ball.y - pt.dy * (back + 0.045);
  const al = pt.t > 0.32 ? Math.max(0, 1 - (pt.t - 0.32) / 0.18) : 0.95;
  paintPutter(ctx, X(hx, hy), Y(hx, hy), X(hx + pt.dx, hy + pt.dy) - X(hx, hy), Y(hx + pt.dx, hy + pt.dy) - Y(hx, hy), sc, al);
}

/** a putter head seen from above, face toward (ux, uy), with the shaft running up and back */
function paintPutter(ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, sc: number, alpha: number) {
  const l = Math.hypot(ux, uy) || 1;
  ux /= l;
  uy /= l;
  const nx = -uy, ny = ux;
  const hw = Math.max(9, sc * 0.2), hd = Math.max(3.5, sc * 0.075);
  ctx.save();
  ctx.globalAlpha = alpha;
  // shaft
  ctx.strokeStyle = "rgba(210,214,206,0.9)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - ux * hd * 0.5, y - uy * hd * 0.5);
  ctx.lineTo(x - ux * hd - 14, y - uy * hd - sc * 2.2);
  ctx.stroke();
  // head
  ctx.fillStyle = "#1b1f1d";
  ctx.strokeStyle = "#b8bdb3";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + nx * hw - ux * hd, y + ny * hw - uy * hd);
  ctx.lineTo(x + nx * hw + ux * hd * 0.3, y + ny * hw + uy * hd * 0.3);
  ctx.lineTo(x - nx * hw + ux * hd * 0.3, y - ny * hw + uy * hd * 0.3);
  ctx.lineTo(x - nx * hw - ux * hd, y - ny * hw - uy * hd);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // the alignment line
  ctx.strokeStyle = "#f2ead7";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x - ux * hd * 0.2, y - uy * hd * 0.2);
  ctx.lineTo(x - ux * hd * 0.2 - ux * 0.01, y - uy * hd * 0.2 - uy * 0.01);
  ctx.moveTo(x + nx * hw * 0.5 - ux * hd * 0.4, y + ny * hw * 0.5 - uy * hd * 0.4);
  ctx.lineTo(x - nx * hw * 0.5 - ux * hd * 0.4, y - ny * hw * 0.5 - uy * hd * 0.4);
  ctx.stroke();
  ctx.restore();
}

function hud(ctx: CanvasRenderingContext2D, p: Putt, w: number, h: number, t: number, play: boolean, pointer: { x: number; y: number; inside: boolean }) {
  const H = p.hole;
  void pointer;
  const compact = w < 560;
  const dist = Math.hypot(H.cup[0] - p.ball.x, H.cup[1] - p.ball.y);
  const panel = (x: number, y: number, pw: number, ph: number) => {
    ctx.fillStyle = "rgba(13,16,14,0.72)";
    ctx.beginPath();
    ctx.roundRect(x, y, pw, ph, 6);
    ctx.fill();
  };
  // hole card
  const cw = play ? (compact ? 150 : 190) : 124;
  const ch = play ? 62 : 36;
  panel(10, 10, cw, ch);
  ctx.fillStyle = "#f2ead7";
  display(ctx, play ? 20 : 14, 800);
  ctx.fillText(`HOLE ${H.n} · PAR ${H.par}`, 20, play ? 34 : 28);
  if (play) {
    mono(ctx, 10);
    ctx.fillStyle = "#b5b6ab";
    ctx.fillText(`${Math.round(dist * 3.281)} FT TO THE CUP`, 20, 52);
    ctx.fillText(`STROKES ${p.strokes}`, 20, 66);
  }
  if (!play) return;

  // The hint / reading chip and the key power meter sit top centre only while
  // that clears the hole card. On a narrow canvas they go to the bottom, just
  // above the scorecard, so they never cover the HUD box at any width.
  const topFree = (width: number) => w / 2 - width / 2 >= 10 + cw + 8;
  const chipBottom = h - 64 - 8 - 24;
  const chip = (msgs: string[], color: string) => {
    mono(ctx, 10);
    const room = w - 20 - 20;
    const msg = msgs.find((m) => ctx.measureText(m).width <= room) ?? msgs[msgs.length - 1];
    const tw = ctx.measureText(msg).width + 20;
    const y = topFree(tw) ? 12 : chipBottom;
    ctx.fillStyle = "rgba(13,16,14,0.78)";
    ctx.beginPath();
    ctx.roundRect(w / 2 - tw / 2, y, tw, 24, 5);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(msg, w / 2, y + 16);
    ctx.textAlign = "left";
  };
  if (p.reading) {
    chip(["READING · CLICK OR DRAG TO POUR WATER · IT RUNS DOWNHILL", "READING · DRAG TO POUR WATER", "READING · DRAG"], "#a0dcff");
  } else if (H.n === 1 && p.strokes === 0 && !p.aiming && !p.kCharging && t - p.startT < 12) {
    chip(["PULL BACK FROM THE BALL AND LET GO · OR ← → AND HOLD SPACE", "PULL BACK FROM THE BALL, LET GO", "PULL BACK, LET GO"], "#f2ead7");
  }

  // power meter while charging by key
  if (p.kCharging) {
    const my = topFree(140) ? 46 : chipBottom + 8;
    ctx.fillStyle = "rgba(13,16,14,0.7)";
    ctx.fillRect(w / 2 - 70, my, 140, 8);
    ctx.fillStyle = p.kPower > 0.9 ? "#e5484d" : "#8ad9a8";
    ctx.fillRect(w / 2 - 70, my, 140 * p.kPower, 8);
  }

  // scorecard
  const cells = HOLES;
  const cwid = compact ? 28 : 40;
  const lab = compact ? 0 : 46;
  const tw = lab + cells * cwid + (compact ? 44 : 52);
  const x0 = w / 2 - tw / 2, y0 = h - 58;
  panel(x0 - 8, y0 - 6, tw + 16, 54);
  mono(ctx, 10);
  const rows = ["HOLE", "PAR", "YOU"];
  rows.forEach((r, i) => {
    if (lab) {
      ctx.fillStyle = "#b5b6ab";
      ctx.fillText(r, x0, y0 + 9 + i * 16);
    }
  });
  let tot = 0, par = 0;
  for (let i = 0; i < cells; i++) {
    const cx = x0 + lab + i * cwid + cwid / 2;
    const cur = H.n === i + 1 && !p.done;
    if (cur) {
      ctx.fillStyle = "rgba(242,234,215,0.12)";
      ctx.fillRect(cx - cwid / 2 + 1, y0 - 3, cwid - 2, 50);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = cur ? "#f2ead7" : "#b5b6ab";
    ctx.fillText(String(i + 1), cx, y0 + 9);
    ctx.fillStyle = "#b5b6ab";
    ctx.fillText(String(p.pars[i]), cx, y0 + 25);
    const sc = p.scores[i];
    if (sc !== null) {
      tot += sc;
      par += p.pars[i];
      const d = sc - p.pars[i];
      mono(ctx, 12);
      ctx.fillStyle = d < 0 ? "#edbb00" : d === 0 ? "#f2ead7" : "#e5484d";
      ctx.fillText(String(sc), cx, y0 + 42);
      if (d < 0) {
        ctx.strokeStyle = "#edbb00";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, y0 + 38.5, 8, 0, 7);
        ctx.stroke();
      } else if (d > 0) {
        ctx.strokeStyle = "#e5484d";
        ctx.strokeRect(cx - 7.5, y0 + 31, 15, 15);
      }
      mono(ctx, 10);
    } else if (cur) {
      mono(ctx, 12);
      ctx.fillStyle = "#f2ead7";
      ctx.fillText(String(p.strokes || "·"), cx, y0 + 42);
      mono(ctx, 10);
    }
    ctx.textAlign = "left";
  }
  const dv = tot - par;
  const txr = x0 + lab + cells * cwid + 6;
  ctx.fillStyle = "#b5b6ab";
  ctx.fillText("TOT", txr, y0 + 9);
  mono(ctx, 12);
  ctx.fillStyle = "#f2ead7";
  ctx.fillText(tot ? `${tot}` : "·", txr, y0 + 42);
  ctx.fillStyle = dv < 0 ? "#edbb00" : dv > 0 ? "#e5484d" : "#8ad9a8";
  if (tot) ctx.fillText(dv === 0 ? "E" : dv > 0 ? `+${dv}` : `${dv}`, txr + (compact ? 20 : 26), y0 + 42);

  // the call
  if (p.call && t - p.callT < 1.7) {
    const a = Math.min(1, (1.7 - (t - p.callT)) * 2.2);
    ctx.globalAlpha = a;
    const size = Math.round(Math.min(w, h) * 0.1);
    display(ctx, size, 800);
    ctx.textAlign = "center";
    const ty = h * 0.34 - (1 - Math.min(1, (t - p.callT) * 5)) * -10;
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(13,16,14,0.55)";
    ctx.lineJoin = "round";
    ctx.strokeText(p.call, w / 2, ty);
    ctx.fillStyle = "#f2ead7";
    ctx.fillText(p.call, w / 2, ty);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  // round over
  if (p.done) {
    const tot2 = p.scores.reduce<number>((a, b) => a + (b ?? 0), 0);
    const par2 = p.pars.reduce((a, b) => a + b, 0);
    const bw = Math.min(380, w - 24), bh = 190;
    const x = w / 2 - bw / 2, y = h * 0.2;
    panel(x, y, bw, bh);
    ctx.textAlign = "center";
    mono(ctx, 10);
    ctx.fillStyle = "#8ad9a8";
    ctx.fillText("ROUND COMPLETE", w / 2, y + 28);
    display(ctx, 64, 800);
    ctx.fillStyle = "#f2ead7";
    ctx.fillText(String(tot2), w / 2, y + 92);
    mono(ctx, 11);
    ctx.fillStyle = tot2 - par2 <= 0 ? "#edbb00" : "#b5b6ab";
    ctx.fillText(tot2 === par2 ? "EVEN PAR" : tot2 > par2 ? `${tot2 - par2} OVER PAR` : `${par2 - tot2} UNDER PAR`, w / 2, y + 118);
    ctx.fillStyle = "#b5b6ab";
    ctx.fillText("CLICK OR PRESS SPACE TO PLAY AGAIN", w / 2, y + 156);
    ctx.textAlign = "left";
  }
}

// ---------------------------------------------------------------- the green, lit

function renderGreen(H: Hole, w: number, h: number, p: Putt) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const v = p.view;
  const X = (x: number, y: number) => sx(v, x, y);
  const Y = (x: number, y: number) => sy(v, x, y);

  // relief: shade every 2px cell by its slope, tint by zone, mow stripes and grain
  const cell = 2;
  const cw = Math.ceil(w / cell), chh = Math.ceil(h / cell);
  const img = new ImageData(cw, chh);
  const d = img.data;
  const L = [-0.52, -0.62, 0.59];
  const ln = Math.hypot(L[0], L[1], L[2]);
  L[0] /= ln; L[1] /= ln; L[2] /= ln;
  const flat = L[2];
  const k = 13;
  const out: [number, number, number] = [0, 0, 0];
  // height range for the gentle tint
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= 16; j++) for (let i = 0; i <= 26; i++) {
    hg(H, (i / 26) * GW, (j / 16) * GH, out);
    lo = Math.min(lo, out[0]);
    hi = Math.max(hi, out[0]);
  }
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const GREEN: [number, number, number] = [92, 170, 84], FRINGE: [number, number, number] = [64, 134, 68], ROUGH: [number, number, number] = [38, 90, 48];
  for (let j = 0; j < chh; j++)
    for (let i = 0; i < cw; i++) {
      const wp = toWorld(v, i * cell + cell / 2, j * cell + cell / 2);
      hg(H, wp.x, wp.y, out);
      const nx = -k * out[1], ny = -k * out[2];
      const nl = Math.hypot(nx, ny, 1);
      const shade = (nx * L[0] + ny * L[1] + L[2]) / nl;
      let f = 1 + 0.95 * (shade - flat);
      f = Math.max(0.8, Math.min(1.24, f));
      // zone, blended over about a pixel so the edges are smooth
      const u = (wp.x - GW / 2) / (GW / 2), vv = (wp.y - GH / 2) / (GH / 2);
      const rho = Math.hypot(u, vv);
      const rr = shapeR(H, Math.atan2(vv, u));
      const mPerRho = Math.min(GW, GH) / 2;
      const d1 = ((rho - rr) * mPerRho * v.sc) / 1.2, d2 = ((rho - rr - 0.085) * mPerRho * v.sc) / 1.2;
      const a1 = Math.max(0, Math.min(1, d1 + 0.5)), a2 = Math.max(0, Math.min(1, d2 + 0.5));
      f = 1 + (f - 1) * (1 - 0.92 * a1); // the relief is the green's, not the rough's
      const zn = a1 < 0.5 ? 0 : a2 < 0.5 ? 1 : 2;
      const base: [number, number, number] = [
        GREEN[0] + (FRINGE[0] - GREEN[0]) * a1 + (ROUGH[0] - FRINGE[0]) * a2,
        GREEN[1] + (FRINGE[1] - GREEN[1]) * a1 + (ROUGH[1] - FRINGE[1]) * a2,
        GREEN[2] + (FRINGE[2] - GREEN[2]) * a1 + (ROUGH[2] - FRINGE[2]) * a2,
      ];
      // mow stripes along a slightly rotated axis
      const sd = (wp.x * Math.cos(0.18) + wp.y * Math.sin(0.18)) / 0.95;
      const stripe = Math.floor(sd) % 2 === 0 ? 1.035 : 0.97;
      const tint = zn === 0 ? 0.96 + 0.08 * ((out[0] - lo) / (hi - lo || 1)) : 1;
      const g = 1 + (hash(i, j) - 0.5) * 0.05;
      const m = f * (zn === 2 ? 1 : stripe) * tint * g * (zn === 2 ? 0.85 + 0.3 * (f - 0.62) : 1);
      const o = (j * cw + i) * 4;
      d[o] = Math.min(255, base[0] * m);
      d[o + 1] = Math.min(255, base[1] * m + (f - 1) * 14);
      d[o + 2] = Math.min(255, base[2] * m);
      d[o + 3] = 255;
    }
  const tc = document.createElement("canvas");
  tc.width = cw;
  tc.height = chh;
  tc.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tc, 0, 0, cw * cell, chh * cell);

  // outline of the green: a crisp collar
  const outline = (grow: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const th = (i / 120) * Math.PI * 2;
      const r = shapeR(H, th) + grow;
      const wx = GW / 2 + Math.cos(th) * r * (GW / 2), wy = GH / 2 + Math.sin(th) * r * (GH / 2);
      const px = X(wx, wy), py = Y(wx, wy);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
  };
  outline(0);
  ctx.strokeStyle = "rgba(10,30,16,0.55)";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  outline(-0.012);
  ctx.strokeStyle = "rgba(210,240,190,0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // faint contours, inside the green only
  ctx.save();
  outline(0);
  ctx.clip();
  const N = 110, M = Math.round((N * GH) / GW);
  const z: number[] = [];
  let zlo = Infinity, zhi = -Infinity;
  for (let j = 0; j <= M; j++)
    for (let i = 0; i <= N; i++) {
      hg(H, (i / N) * GW, (j / M) * GH, out);
      z.push(out[0]);
      zlo = Math.min(zlo, out[0]);
      zhi = Math.max(zhi, out[0]);
    }
  const at = (i: number, j: number) => z[j * (N + 1) + i];
  const levels = 22;
  ctx.lineWidth = 0.8;
  for (let l = 1; l < levels; l++) {
    const iso = zlo + ((zhi - zlo) * l) / levels;
    ctx.strokeStyle = l % 4 === 0 ? "rgba(240,255,225,0.26)" : "rgba(240,255,225,0.11)";
    ctx.beginPath();
    for (let j = 0; j < M; j++)
      for (let i = 0; i < N; i++) {
        const a = at(i, j), b = at(i + 1, j), cc = at(i + 1, j + 1), dd = at(i, j + 1);
        const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (cc > iso ? 2 : 0) | (dd > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = (i / N) * GW, y0 = (j / M) * GH, dw = GW / N, dh = GH / M;
        const lerp = (pp: number, q: number) => (iso - pp) / (q - pp);
        const P = (wx: number, wy: number): [number, number] => [X(wx, wy), Y(wx, wy)];
        const top = P(x0 + dw * lerp(a, b), y0);
        const right = P(x0 + dw, y0 + dh * lerp(b, cc));
        const bottom = P(x0 + dw * lerp(dd, cc), y0 + dh);
        const left = P(x0, y0 + dh * lerp(a, dd));
        const seg = (s: [number, number], e: [number, number]) => {
          ctx.moveTo(s[0], s[1]);
          ctx.lineTo(e[0], e[1]);
        };
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(left, bottom); seg(top, right); break;
        }
      }
    ctx.stroke();
  }
  ctx.restore();
  return c;
}
