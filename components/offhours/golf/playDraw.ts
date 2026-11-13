import { display, mono } from "../font";
import { CLUBS, at, type Shot } from "./flight";
import { golferDrawable } from "./golfer";
import { puttLayout, puttPaint } from "./green";
import { CourseGame, PROP_WORDS, swingLen, type HoleStat } from "./play";
import { YD, drawWorld, prepare, project, type Cam, type Drawable, type P2 } from "./scene";
import { MAP_WIDE, mapDraw, mapPlayed } from "./map";
import { carryAtChip, carryAtPower, chipCarry, fullCarry } from "./swing";
import { bestRound, overUnder, toPar } from "./score";
import { trace } from "./tracer";
import { eyeFor } from "./sightline";

// What the course looks like: the shot view (the range's golfer, flight line and
// world, from behind the ball and turned to the aim), the HUD, the tee card, the
// hole card and the scorecard. The putt is golf/green.ts's own view, cut to when
// the ball is on the green. All copy is short and set in capitals on the canvas.

const PAPER = "#f2ead7";
const MINT = "#8ad9a8";
const RED = "#e5484d";
const GOLD = "#edbb00";
const DIM = "#b5b6ab";
const PANEL = "rgba(13,16,14,0.74)";

type V = [number, number, number];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (u: number) => u * u * (3 - 2 * u);
const pp = { x: 0, y: 0, d: 0, s: 0 } as P2;
const pq = { x: 0, y: 0, d: 0, s: 0 } as P2;

export type PlayPointer = { x: number; y: number; inside: boolean };
/** world: false leaves the ground, the scenery, the golfer and the ball to another renderer (the 3D course); the rest is drawn over it on a clear canvas */
export type PaintOpts = {
  /** draw the world (the 3D page draws it in WebGL and leaves the overlay to this, the putting green too) */
  world?: boolean;
  /** draw the round's scorecard (the 3D page has its own) */
  roundCard?: boolean;
  /** draw the HUD and the map under the tee card (the 3D page flies over the hole there instead) */
  teeHud?: boolean;
};

/** step the game by `dt` and draw it */
export function playDraw(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number, dt: number, pointer: PlayPointer) {
  g.w = w;
  g.h = h;
  g.advance(dt);
  paint(ctx, g, w, h, dt, pointer);
}

/** draw the game as it stands */
export function paint(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number, dt: number, pointer: PlayPointer, opts: PaintOpts = {}) {
  const world = opts.world !== false;
  const reduce = !!g.opts.reduce;
  if (g.phase === "putt" || (g.phase === "hole-card" && g.putt.course && g.putt.ball.sunk)) {
    g.mapView = null;
    puttLayout(g.putt, w, h, true);
    // on the 3D page the green, the ball and the putter are in the 3D scene; this draws the HUD over them
    puttPaint(ctx, g.putt, w, h, g.t, { play: true, say: () => {}, reduce, touch: g.touch, hudOnly: !world }, pointer);
    if (g.phase === "putt") puttPrompt(ctx, g, w, h);
  } else {
    shotView(ctx, g, w, h, dt, reduce, world);
    // the hole and round cards say it all: the shot's HUD under them would show through on a short canvas
    const quiet = g.phase === "tee-card" && opts.teeHud === false;
    if (g.phase !== "hole-card" && g.phase !== "round-card" && !quiet) hud(ctx, g, w, h);
    if (!g.mapSet) g.setMap(w >= MAP_WIDE);
    if (!quiet) mapDraw(ctx, g, w, h, carryRing(g));
  }
  if (g.phase === "tee-card") teeCard(ctx, g, w, h, opts.teeHud === false);
  else if (g.phase === "hole-card") holeCard(ctx, g, w, h);
  else if (g.phase === "round-card" && opts.roundCard !== false) roundCard(ctx, g, w, h);
}

// ------------------------------------------------------------ camera
type Rig = { dx: number; dy: number; dz: number; tx: number; ty: number; tz: number; F: number };

/** how much the camera rises for a shot to a target this far away (yd): none from 205 yd or more, all of it inside 180 */
export const liftFor = (yd: number) => smooth(clamp((205 - yd) / 25, 0, 1));
/** the height of the raised camera, m, and how far behind the ball it stands */
const HIGH = 44, HIGH_BACK = 16;
/** the raised camera is zoomed until the green is this tall on screen, px, as far as the width allows (about 52 m across) */
const GREEN_PX = 72, SPAN_M = 52, GREEN_DEPTH_M = 12.5;

/**
 * 0..1: how big the drop is from the ball to the shot's target: none under 10 m, all of it from 16 m (hole 2's ledge is 30 m over
 * its green). A shot over such a drop is not taken from the raised camera, which stands straight over the ledge and looks at the
 * green as a map: it is taken from the golfer's eye, so the brink, the cliff's lip and the whole drop to the green are in the picture.
 */
const dropOf = (g: CourseGame, G: Ground, bx: number, bz: number) => {
  const [tx, tz] = g.target();
  return smooth(clamp((G(bx, bz) - G(tx, tz) - 10) / 6, 0, 1));
};

/** the far bank (m from the ball) of the first water the aim line crosses within 140 yd, or null */
function waterAhead(g: CourseGame, bx: number, bz: number, yaw: number, dm: number): number | null {
  const sf = g.hole.surfaceAt;
  const sx = Math.sin(yaw), sz = Math.cos(yaw);
  const reach = Math.min(dm, 140 * YD);
  let far: number | null = null;
  for (let d = 4; d <= reach; d += 3) {
    const wet = sf(bx + sx * d, bz + sz * d) === "water";
    if (wet) far = d;
    else if (far !== null) break;
  }
  return far;
}

/** the first run of water the aim crosses within 140 yd: its near and far ends (m from the ball) and the lowest bed in it */
function waterRun(g: CourseGame, G: Ground, bx: number, bz: number, yaw: number, dm: number): { near: number; far: number; low: number } | null {
  const sf = g.hole.surfaceAt;
  const sx = Math.sin(yaw), sz = Math.cos(yaw);
  const reach = Math.min(dm, 140 * YD);
  let near = -1, far = -1, low = Infinity;
  for (let d = 4; d <= reach; d += 3) {
    const x = bx + sx * d, z = bz + sz * d;
    if (sf(x, z) === "water") {
      if (near < 0) near = d;
      far = d;
      low = Math.min(low, G(x, z));
    } else if (near >= 0) break;
  }
  return near < 0 ? null : { near, far, low };
}

/** the most the eye rises to see the aim over a crest, m, and the least drop to the aim, m, that the camera looks down to */
const PEEK_CAP = 12, DROP_MIN = 6;
/** the point the eye must see over the ground at the aim: this high over it, m (the flag, the top of a post, a ball flying in) */
const AIM_UP = 2;

/**
 * A crest between the eye and the aim hides it: the eye rises until it clears the crest and looks at the aim (the marker
 * post, the landing, the flag). A long way down to the aim does the same, rising a little so the landing area is in the
 * picture and not the slope under the tee. The change is blended in, so it does not jump as the ball or the aim moves.
 */
function aimSight(lo: LoRig, G: Ground, bx: number, bz: number, gb: number, dm: number, a: V, back: number): LoRig {
  if (dm < 45) return lo;
  const ax = bx + a[0] * dm, az = bz + a[2] * dm;
  const gA = G(ax, az);
  const ex = bx + lo.ex, ez = bz + lo.ez;
  const floor = gb + lo.ey;
  const rise = clamp(eyeFor(G, ex, ez, ax, gA + AIM_UP, az, floor) - floor, 0, PEEK_CAP);
  const drop = gb - gA;
  // (a drop does not raise the eye: it looks down the slope from where the golfer stands; only a crest does)
  const lift = rise;
  const wt = Math.max(smooth(clamp(rise / 1.5, 0, 1)), smooth(clamp((drop - DROP_MIN + 2) / 4, 0, 1)));
  if (wt <= 0) return lo;
  const m = (p: number, q: number) => p + (q - p) * wt;
  // looking at the aim, the golfer stays in the picture while the eye is low enough for both (their feet no more than
  // 15 degrees under the middle, the aim no more than 13 over it); higher than that the aim is what the picture is of
  const eyeY = floor + lift * wt, Dh = Math.hypot(ax - ex, az - ez);
  let p = Math.atan2(eyeY - (gA + AIM_UP), Dh);
  const feet = Math.atan2(eyeY - gb, back) - (15 * Math.PI) / 180;
  if (feet > p && feet - p < (13 * Math.PI) / 180) p = feet;
  const ty = eyeY - Math.tan(p) * Dh - gA;
  return { ...lo, ey: lo.ey + lift * wt, tx: m(lo.tx, a[0] * dm), tz: m(lo.tz, a[2] * dm), ty: m(lo.ty, ty) };
}
type LoRig = { ex: number; ey: number; ez: number; tx: number; ty: number; tz: number; F: number };

/**
 * Where the camera stands to take a shot from (bx, bz) at `yd` yards to the target. A long shot: behind the golfer at eye
 * height, looking far down the hole. A short one: it rises and pitches down onto the target, zoomed, so the green and what
 * guards it sit well above the horizon.
 */
function addressRig(g: CourseGame, bx: number, bz: number, yd: number, w: number, h: number, G: Ground): Rig {
  const yaw = g.yaw;
  // heights are over the ground at the ball; where it looks, over the ground there
  const gb = G(bx, bz);
  const a: V = [Math.sin(yaw), 0, Math.cos(yaw)];
  const rt: V = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const F0 = Math.max(w * 0.9, h * 1.1);
  const off = w / h > 1.2 ? 1.7 : 0.7;
  const dm = yd * YD;
  // the long-shot camera (the range's)
  const back = yd < 60 ? 5 : 8.4;
  const ahead = clamp(dm + 12, 30, 70);
  let lo = { ex: -a[0] * back + rt[0] * off, ey: 1.9, ez: -a[2] * back + rt[2] * off, tx: a[0] * ahead, ty: 0.9, tz: a[2] * ahead, F: F0 };
  // water across the line within reach: the eye rises so that it can be seen, and looks at it
  const hz = waterAhead(g, bx, bz, yaw, dm);
  // (the ledge's own eye, below, is for a carry over water from high above it; a dry drop looks out at the landing. The water's
  // bed counts too: a cove 40 m under the tee is a ledge even when the landing lies level with the tee)
  const wet = hz === null ? null : waterRun(g, G, bx, bz, yaw, dm);
  const dd = hz === null ? 0 : dropOf(g, G, bx, bz);
  // (how far the bed of that water lies under the ball, as dropOf: none under 10 m, all of it from 16 m)
  const wd = wet === null ? 0 : smooth(clamp((gb - wet.low - 10) / 6, 0, 1));
  const drop = Math.max(dd, wd);
  if (hz !== null && drop < 1) {
    const look = clamp(hz + 35, 45, Math.max(45, dm));
    lo = { ex: -a[0] * 12 + rt[0] * off, ey: 14, ez: -a[2] * 12 + rt[2] * off, tx: a[0] * look, ty: 0, tz: a[2] * look, F: F0 * 1.1 };
  }
  // a crest in the way or a long drop to the aim: the eye rises to see it (not under water's raised eye)
  if (hz === null) lo = aimSight(lo, G, bx, bz, gb, dm, a, back);
  // over a big drop: the golfer's eye, a little behind, looking at the target itself
  if (drop > 0) {
    // (the eye is 8 m behind the golfer and rises until the line to the target clears the ground in between: the ledge's lip)
    const ex = -a[0] * 8 + rt[0] * off, ez = -a[2] * 8 + rt[2] * off, tx = a[0] * dm, tz = a[2] * dm;
    const tyAbs = G(bx + tx, bz + tz) - gb + 1;
    let ey = 3.5;
    for (; ey < 18; ey += 0.5) {
      let clear = true;
      for (let d = 3; d < dm - 6 && clear; d += 2) {
        const u = d / Math.hypot(tx - ex, tz - ez), x = bx + ex + (tx - ex) * u, z = bz + ez + (tz - ez) * u;
        if (G(x, z) - gb + 0.8 > ey + (tyAbs - ey) * u) clear = false;
      }
      if (clear) break;
    }
    // looking 20 degrees down, at the tarn half way over: the golfer, the lip, the tarn and the green (above the middle) in one picture.
    // Over water that lies deep under the ball the look is 10 degrees down, at the landing, and not held to the ground: the golfer
    // below, the cliff's rim across the middle and the far shelf and the landing above it. (The water itself is behind the rim:
    // from a tee back from the lip it is out of sight, and the cove is seen from above.)
    const overWater = wet !== null && wd > dd;
    const at = overWater ? dm : dm * 0.5;
    const hx = a[0] * at, hz2 = a[2] * at;
    const aim = ey - Math.hypot(hx - ex, hz2 - ez) * (overWater ? 0.176 : 0.364) - (G(bx + hx, bz + hz2) - gb);
    const ledge = { ex, ey, ez, tx: hx, ty: overWater ? aim : Math.max(1, aim), tz: hz2, F: F0 * 0.95 };
    lo = { ex: lo.ex + (ledge.ex - lo.ex) * drop, ey: lo.ey + (ledge.ey - lo.ey) * drop, ez: lo.ez + (ledge.ez - lo.ez) * drop, tx: lo.tx + (ledge.tx - lo.tx) * drop, ty: lo.ty + (ledge.ty - lo.ty) * drop, tz: lo.tz + (ledge.tz - lo.tz) * drop, F: lo.F + (ledge.F - lo.F) * drop };
  }
  // a tee shot to a landing zone is not a shot at a green: it keeps the long view, down the hole
  // (a shot down a long drop is played from a golfer's eye looking down the slope, not from above it; water ahead still lifts,
  // except over a ledge, where the ledge's own eye takes over)
  const down = hz === null ? smooth(clamp((gb - G(bx + a[0] * dm, bz + a[2] * dm) - 5) / 7, 0, 1)) : 0;
  const k = g.strokes === 0 && g.hole.def.par > 3 ? 0 : liftFor(yd) * (1 - Math.max(drop, down));
  if (k <= 0) return { dx: bx + lo.ex, dy: gb + lo.ey, dz: bz + lo.ez, tx: bx + lo.tx, ty: lookY(G, gb, bx + lo.tx, bz + lo.tz, lo.ty), tz: bz + lo.tz, F: lo.F };
  // the raised one
  const D = dm + HIGH_BACK;
  // (no higher than the shot is long: a short pitch is looked at from low, a long approach from up high)
  const HH = Math.min(HIGH, 8 + 0.4 * dm);
  const rng = Math.hypot(HH, D);
  const F1 = clamp(Math.min((GREEN_PX * rng) / (GREEN_DEPTH_M * (HH / rng)), (w * D) / SPAN_M), F0, 4400);
  const hi = { ex: -a[0] * HIGH_BACK + rt[0] * 0.7, ey: HH, ez: -a[2] * HIGH_BACK + rt[2] * 0.7, tx: a[0] * dm, ty: 0, tz: a[2] * dm, F: F1 };
  const m = (p: number, q: number) => p + (q - p) * k;
  const tx = bx + m(lo.tx, hi.tx), tz = bz + m(lo.tz, hi.tz);
  return { dx: bx + m(lo.ex, hi.ex), dy: gb + m(lo.ey, hi.ey), dz: bz + m(lo.ez, hi.ez), tx, ty: lookY(G, gb, tx, tz, m(lo.ty, hi.ty)), tz, F: m(lo.F, hi.F) };
}

/** the ground's height for the picture: the hole's hills when another renderer draws them, else flat (the 2D course is drawn flat) */
type Ground = (x: number, z: number) => number;
/** a point the camera looks at, `up` over the ground there */
const lookY = (G: Ground, _gb: number, x: number, z: number, up: number) => G(x, z) + up;

function updateCamera(g: CourseGame, dt: number, w: number, h: number, G: Ground) {
  const c = g.cam;
  const yaw = g.yaw;
  const a: V = [Math.sin(yaw), 0, Math.cos(yaw)];
  const rt: V = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const F0 = Math.max(w * 0.9, h * 1.1);
  const sh = g.shot;
  let rig = addressRig(g, g.ball[0], g.ball[1], g.yardsToTarget(), w, h, G);
  let posRate = 3, tgtRate = 3;
  if (g.phase === "fly" && sh) {
    const [tx0, tz0] = g.target();
    const yd0 = Math.hypot(tx0 - sh.ox, tz0 - sh.oz) / YD;
    if (liftFor(yd0) * (1 - dropOf(g, G, sh.ox, sh.oz)) > 0.5) {
      // a short shot is watched from the raised camera, which stays where it was
      rig = addressRig(g, sh.ox, sh.oz, yd0, w, h, G);
    } else {
      // a long one is followed: the camera dollies down the hole to where it lands
      const ball = at(sh, g.shotT);
      const bw: V = [sh.ox + ball[0], drawnY(g, sh, G, sh.ox + ball[0], ball[1], sh.oz + ball[2]), sh.oz + ball[2]];
      const land: V = sh.bounces[0] ? [sh.ox + sh.bounces[0].x, 0, sh.oz + sh.bounces[0].z] : [bw[0], 0, bw[2]];
      land[1] = G(land[0], land[2]);
      const dist = Math.hypot(land[0] - sh.ox, land[2] - sh.oz);
      const e = dist < 30 ? 0 : smooth(clamp((g.shotT - sh.apexT * 0.55) / Math.max(0.5, sh.landT - sh.apexT * 0.55), 0, 1));
      const bk = Math.min(58, 12 + dist * 0.26);
      const sd = Math.min(16, 4 + dist * 0.06);
      const c1: V = [land[0] - a[0] * bk + rt[0] * sd, 0, land[2] - a[2] * bk + rt[2] * sd];
      // 6 m over the landing, or over the ground under the camera if that is higher
      c1[1] = Math.max(land[1], G(c1[0], c1[2])) + 6;
      // and high enough to see where it lands over a crest in between
      c1[1] = Math.min(Math.max(c1[1], eyeFor(G, c1[0], c1[2], land[0], land[1] + 0.8, land[2], c1[1])), G(c1[0], c1[2]) + 16);
      const c0: V = [rig.dx, rig.dy, rig.dz];
      const dx = c0[0] + (c1[0] - c0[0]) * e, dy = c0[1] + (c1[1] - c0[1]) * e, dz = c0[2] + (c1[2] - c0[2]) * e;
      const tx = bw[0], tz = bw[2];
      const gUnder = G(tx, tz);
      let ty = gUnder + (bw[1] - gUnder) * 0.9 + 0.5;
      // never tilt up more than about 22 degrees
      ty = Math.min(ty, dy + Math.hypot(tx - dx, tz - dz) * 0.4);
      const d = Math.hypot(tx - dx, ty - dy, tz - dz);
      rig = { dx, dy, dz, tx, ty, tz, F: F0 * clamp(1 + (d - 40) / 90, 1, 1.9) };
      posRate = 3.2;
      tgtRate = g.shotT < 0.5 ? 7 : 5;
      if (g.fast) {
        posRate *= 2.5;
        tgtRate *= 2.5;
      }
    }
  }
  if (!g.camReady) {
    c.x = rig.dx; c.y = rig.dy; c.z = rig.dz; c.tx = rig.tx; c.ty = rig.ty; c.tz = rig.tz; c.F = rig.F;
    g.camReady = true;
  } else {
    const kp = 1 - Math.exp(-posRate * dt), kt = 1 - Math.exp(-tgtRate * dt), kf = 1 - Math.exp(-2.6 * dt);
    c.x += (rig.dx - c.x) * kp; c.y += (rig.dy - c.y) * kp; c.z += (rig.dz - c.z) * kp;
    c.tx += (rig.tx - c.tx) * kt; c.ty += (rig.ty - c.ty) * kt; c.tz += (rig.tz - c.tz) * kt;
    c.F += (rig.F - c.F) * kf;
  }
  // never into a hill
  const floor = G(c.x, c.z) + 1.2;
  if (c.y < floor) c.y = floor;
}

/** the height a point of a shot is drawn at: over the ground it was struck from, plus that ground's height in a world with hills; drawn flat, its height over the ground under it */
function drawnY(g: CourseGame, sh: Shot, G: Ground, x: number, y: number, z: number) {
  const abs = sh.oy + y;
  return G === flatGround ? Math.max(0, abs - g.terrain.y(x, z)) : abs;
}
const flatGround: Ground = () => 0;

// ------------------------------------------------------------ the shot view
function shotView(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number, dt: number, reduce: boolean, world = true) {
  // the 2D course draws the ground flat; under the 3D one it has its hills
  const G: Ground = world ? flatGround : (x, z) => g.terrain.y(x, z);
  updateCamera(g, dt, w, h, G);
  const cam: Cam = g.cam;
  prepare(cam, w, h, 0.4);
  const club = CLUBS[g.club];
  const sh = g.shot;
  const [bx, bz] = g.ball;
  const extra: Drawable[] = [];
  // the ball where it lies (in flight it is drawn from the shot)
  if (world && g.phase !== "fly" && !(g.phase === "rest" && !g.dropped) && project(cam, bx, 0.03, bz, pp)) {
    const k = pp.s, x = pp.x, y = pp.y;
    extra.push({
      d: pp.d + 0.6,
      draw: () => {
        ctx.fillStyle = "rgba(10,40,20,0.35)";
        ctx.beginPath();
        ctx.ellipse(x + 0.01 * k, y + 0.015 * k, 0.03 * k, 0.012 * k, 0, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#fffdf5";
        ctx.beginPath();
        ctx.arc(x, y - 0.012 * k, Math.max(1.6, 0.0215 * k), 0, 7);
        ctx.fill();
      },
    });
  }
  if (world) {
    const gd = golferDrawable(ctx, cam, [bx, 0.02, bz], g.yaw, club, g.pose, g.trail);
    if (gd) extra.push(gd);
    // trees between the camera and the golfer only hide the shot
    const near = project(cam, bx, 0, bz, pp) ? pp.d + 1.5 : 0;
    drawWorld(ctx, cam, w, h, g.t, { x: g.wind[0], z: g.wind[1] }, { world: g.hole.world, extra, still: reduce, clearNear: near });
  }
  if (g.phase === "ready" || g.phase === "swing") aimGuide(ctx, g, cam, w, G);
  if (g.phase === "ready" || g.phase === "swing" || (g.phase === "rest" && !g.replay)) ballMarker(ctx, g, cam, w, h, G);

  // ---- the flight (a replay is another camera's: its line would not sit on the picture)
  if (sh && (g.phase === "fly" || g.phase === "rest") && !g.replay) {
    const upTo = g.phase === "fly" ? g.shotT : sh.restT;
    const fadeA = g.phase === "rest" ? clamp(1 - (g.restT - 0.7) / 0.8, 0, 1) : 1;
    ctx.globalAlpha = fadeA;
    const yOf = (x: number, y: number, z: number) => drawnY(g, sh, G, x, y, z);
    trace(ctx, cam, sh, upTo, 7, 3, "#ff5a4a", sh.ox, sh.oz, yOf);
    trace(ctx, cam, sh, upTo, 0, 1.3, "#fff1e6", sh.ox, sh.oz, yOf);
    ctx.globalAlpha = 1;
    const ball = at(sh, upTo);
    const wx = sh.ox + ball[0], wz = sh.oz + ball[2];
    // a splash: rings on the water
    if (g.splash) {
      const age = g.t - g.splash.t;
      if (age < 1.4 && project(cam, g.splash.x, G(g.splash.x, g.splash.z) + 0.02, g.splash.z, pp)) {
        for (let i = 0; i < 2; i++) {
          const u = clamp(age / 1.2 - i * 0.25, 0, 1);
          if (u <= 0) continue;
          ctx.strokeStyle = `rgba(235,246,250,${0.8 * (1 - u)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(pp.x, pp.y, (0.3 + u * 2.2) * pp.s, (0.3 + u * 2.2) * pp.s * 0.35, 0, 0, 7);
          ctx.stroke();
        }
      }
    }
    const inWater = g.splash !== null && g.phase !== "fly";
    const by = drawnY(g, sh, G, wx, ball[1], wz);
    if (world && !inWater && project(cam, wx, by, wz, pp)) {
      const rad = Math.max(2.4, 0.0215 * pp.s * 1.15);
      if (project(cam, wx, 0.01, wz, pq)) {
        const sc = clamp(1 - by / 60, 0.3, 1);
        ctx.fillStyle = `rgba(10,40,20,${0.3 * sc})`;
        ctx.beginPath();
        ctx.ellipse(pq.x, pq.y, rad * 1.5 * sc + 1, rad * 0.55 * sc + 0.5, 0, 0, 7);
        ctx.fill();
      }
      if (g.phase === "fly" && by > 3) {
        const gl = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, rad * 4.5);
        gl.addColorStop(0, "rgba(255,255,255,0.7)");
        gl.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, rad * 4.5, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, rad, 0, 7);
      ctx.fill();
    }
    // what it hit: a wall, a boulder or a post, called where it struck
    const hit = sh.prop;
    if (hit) {
      const ht = hitTime(sh, hit.x, hit.z);
      const age = g.phase === "rest" ? g.restT + (sh.restT - ht) : g.shotT - ht;
      const fade = clamp(1 - (age - 1.6) / 0.8, 0, 1) * clamp(age / 0.12, 0, 1);
      const hx = sh.ox + hit.x, hz = sh.oz + hit.z;
      if (fade > 0 && project(cam, hx, G(hx, hz) + 0.8, hz, pp)) tag(ctx, pp.x, pp.y - 12, `HIT ${PROP_WORDS[hit.kind].toUpperCase()}`, fade, w);
    }
    // where it came down
    const b0 = sh.bounces[0];
    if (b0 && (g.phase === "rest" || g.shotT >= b0.t)) {
      const age = g.phase === "rest" ? g.restT + (sh.restT - b0.t) : g.shotT - b0.t;
      const fade = clamp(1 - (age - 3.5) / 1.2, 0, 1) * clamp(age / 0.2, 0, 1);
      if (fade > 0 && project(cam, sh.ox + b0.x, G(sh.ox + b0.x, sh.oz + b0.z), sh.oz + b0.z, pp)) tag(ctx, pp.x, pp.y - Math.max(18, 4 * pp.s), `${Math.round(sh.carry)} YD CARRY`, fade, w);
    }
  }
}

/** the time a shot struck the thing it hit, s: when it passed nearest the point (relative to the origin) */
function hitTime(sh: Shot, x: number, z: number) {
  let best = Infinity, t = 0;
  for (let i = 0; i < sh.n; i++) {
    const d = Math.hypot(sh.pts[i * 4 + 1] - x, sh.pts[i * 4 + 3] - z);
    if (d < best) [best, t] = [d, sh.pts[i * 4]];
  }
  return t;
}

/**
 * Where the selected club's carry lands with no wind, along the aim (metres, in the hole's frame). Full swing when the
 * ball is waiting; while a swing is being drawn back, the power so far.
 */
export function carryRing(g: CourseGame): { x: number; z: number; yd: number } {
  const s = g.sw;
  const power = g.phase === "swing" ? clamp(s.sub === "back" ? s.b : s.peak, 0.05, 1) : 1;
  const chip = g.chipping();
  const yd = (power >= 1 ? (chip ? chipCarry(g.club) : fullCarry(g.club)) : chip ? carryAtChip(g.club, power) : carryAtPower(g.club, power)) * g.carryK();
  return { x: g.ball[0] + Math.sin(g.yaw) * yd * YD, z: g.ball[1] + Math.cos(g.yaw) * yd * YD, yd };
}

/** a thin dashed line along the aim from the ball, and a ring where the club's carry comes down (the look of the range's flight line and the putt's pace ring) */
function aimGuide(ctx: CanvasRenderingContext2D, g: CourseGame, cam: Cam, w: number, G: Ground) {
  const ring = carryRing(g);
  const [bx, bz] = g.ball;
  const len = Math.hypot(ring.x - bx, ring.z - bz);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(242,234,215,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  let pen = false;
  for (let d = 0; d <= len; d += 1.5) {
    const u = d / len;
    const px = bx + (ring.x - bx) * u, pz = bz + (ring.z - bz) * u;
    if (!project(cam, px, G(px, pz) + 0.03, pz, pp)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(pp.x, pp.y);
    else ctx.moveTo(pp.x, pp.y);
    pen = true;
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // the ring, flat on the ground
  ctx.strokeStyle = MINT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let ok = true;
  for (let i = 0; i <= 28 && ok; i++) {
    const a = (i / 28) * Math.PI * 2;
    const px = ring.x + Math.cos(a) * 2.2, pz = ring.z + Math.sin(a) * 2.2;
    if (!project(cam, px, G(px, pz) + 0.03, pz, pp)) ok = false;
    else if (i) ctx.lineTo(pp.x, pp.y);
    else ctx.moveTo(pp.x, pp.y);
  }
  if (ok) ctx.stroke();
  if (project(cam, ring.x, G(ring.x, ring.z) + 0.03, ring.z, pp) && pp.y > 40) tag(ctx, pp.x, pp.y - Math.max(10, 3 * pp.s), `${Math.round(ring.yd)} YD`, 1, w);
}

/** when the ball is below the bottom of the picture (the raised camera), a marker pointing down to it */
function ballMarker(ctx: CanvasRenderingContext2D, g: CourseGame, cam: Cam, w: number, h: number, G: Ground) {
  const seen = project(cam, g.ball[0], G(g.ball[0], g.ball[1]) + 0.03, g.ball[1], pp);
  if (seen && pp.y < h - 96 && pp.y > 0 && pp.x > 0 && pp.x < w) return;
  const x = clamp(seen ? pp.x : w / 2, 110, w - 110);
  const y = h - 150;
  const text = "BALL";
  mono(ctx, 10);
  const tw = ctx.measureText(text).width + 34;
  ctx.fillStyle = "rgba(13,16,14,0.82)";
  ctx.beginPath();
  ctx.roundRect(x - tw / 2, y - 12, tw, 24, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // a ball and a pointer down at it
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x - tw / 2 + 13, y, 4, 0, 7);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.textAlign = "left";
  ctx.fillText(text, x - tw / 2 + 24, y + 4);
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 12);
  ctx.lineTo(x + 6, y + 12);
  ctx.lineTo(x, y + 20);
  ctx.closePath();
  ctx.fillStyle = "rgba(13,16,14,0.82)";
  ctx.fill();
  ctx.stroke();
}

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, a: number, w: number) {
  ctx.globalAlpha = a;
  mono(ctx, 11);
  const tw = ctx.measureText(text).width + 14;
  const cx = clamp(x, tw / 2 + 6, w - tw / 2 - 6);
  ctx.fillStyle = "rgba(13,16,14,0.82)";
  ctx.beginPath();
  ctx.roundRect(cx - tw / 2, y - 20, tw, 20, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 9);
  ctx.stroke();
  ctx.fillStyle = PAPER;
  ctx.textAlign = "center";
  ctx.fillText(text, cx, y - 6);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------ HUD
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
const fit = (ctx: CanvasRenderingContext2D, opts: string[], max: number) => opts.find((o) => ctx.measureText(o).width <= max) ?? opts[opts.length - 1];

function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color = PAPER) {
  mono(ctx, 10);
  const tw = ctx.measureText(text).width + 20;
  ctx.fillStyle = "rgba(13,16,14,0.78)";
  ctx.beginPath();
  ctx.roundRect(cx - tw / 2, y, tw, 22, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, cx, y + 15);
  ctx.textAlign = "left";
}

function hud(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number) {
  const compact = w < 640;
  const pad = compact ? 8 : 14;
  const def = g.hole.def;
  const club = CLUBS[g.club];

  // ---- top left: the hole
  const cw = compact ? 150 : 190;
  panel(ctx, pad, pad, cw, 76);
  display(ctx, 18, 800);
  ctx.fillStyle = PAPER;
  const aiming = g.phase === "ready" || g.phase === "swing";
  if (g.opts.practice === "range") {
    // the range: the flag aimed at, how it plays, and the balls hit
    const ch = g.challenge;
    ctx.fillText(ch ? (ch.kind === "targets" ? "TARGETS" : "CLOSEST") : "RANGE", pad + 10, pad + 26);
    mono(ctx, 10);
    ctx.fillStyle = DIM;
    const yd = Math.round(g.yardsToTarget());
    const plays = aiming ? g.playsLike() : null;
    ctx.fillText(plays !== null ? `${yd} YD FLAG · PLAYS ${plays}` : `${yd} YD FLAG`, pad + 10, pad + 46);
    const n = ch ? Math.min(ch.shots, ch.results.length + (g.phase === "ready" || g.phase === "swing" ? 1 : 0)) : 0;
    ctx.fillText(
      !ch ? `BALLS ${g.balls}` : ch.kind === "targets" ? `BALL ${n} OF ${ch.shots} · ${ch.score} PTS` : `BALL ${n} OF ${ch.shots}${ch.best !== null ? ` · BEST ${ch.best} FT` : ""}`,
      pad + 10,
      pad + 62,
    );
  } else {
    ctx.fillText(`HOLE ${def.n} · PAR ${def.par}`, pad + 10, pad + 26);
    mono(ctx, 10);
    ctx.fillStyle = DIM;
    const toPin = g.yardsToPin();
    const onGreen = g.lie === "green" || g.lie === "fringe";
    const plays = onGreen || !aiming ? null : g.playsLike();
    ctx.fillText(onGreen ? `${Math.round(toPin * 3)} FT TO THE PIN` : plays !== null ? `${Math.round(toPin)} YD · PLAYS ${plays}` : `${Math.round(toPin)} YD TO THE PIN`, pad + 10, pad + 46);
    ctx.fillText(`STROKES ${g.strokes}`, pad + 10, pad + 62);
  }

  // ---- top right: the wind, arrow relative to the aim (up = downrange)
  const wx = w - pad - 112;
  {
    const along = g.wind[0] * Math.sin(g.yaw) + g.wind[1] * Math.cos(g.yaw);
    const across = g.wind[0] * Math.cos(g.yaw) - g.wind[1] * Math.sin(g.yaw);
    const mph = Math.round(Math.hypot(g.wind[0], g.wind[1]) * 2.237);
    panel(ctx, wx, pad, 112, 40);
    mono(ctx, 10);
    ctx.fillStyle = DIM;
    ctx.fillText("WIND", wx + 10, pad + 15);
    ctx.fillStyle = PAPER;
    ctx.fillText(`${mph} MPH`, wx + 10, pad + 31);
    ctx.save();
    ctx.translate(wx + 88, pad + 20);
    ctx.rotate(Math.atan2(across, along));
    ctx.strokeStyle = mph ? GOLD : DIM;
    ctx.fillStyle = mph ? GOLD : DIM;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, -8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(-5, -6);
    ctx.lineTo(5, -6);
    ctx.fill();
    ctx.restore();
  }

  // ---- bottom: the club and the swing gauge
  const gw = Math.min(compact ? w - 2 * pad : 470, w - 2 * pad);
  const gh = 58;
  const gx = w / 2 - gw / 2;
  const gy = h - gh - (compact ? 8 : 14);
  panel(ctx, gx, gy, gw, gh);
  mono(ctx, 10);
  ctx.fillStyle = MINT;
  const clubName = club.name.toUpperCase();
  const carryTxt = `${Math.round((g.chipping() ? chipCarry(g.club) : fullCarry(g.club)) * g.carryK())} YD CARRY`;
  ctx.fillText(clubName, gx + 12, gy + 18);
  ctx.fillStyle = DIM;
  ctx.fillText(carryTxt, gx + 12, gy + 34);
  const labelW = Math.max(ctx.measureText(clubName).width, ctx.measureText(carryTxt).width);
  const bOff = Math.max(compact ? 118 : 150, 12 + labelW + 16);
  const bx = gx + bOff, bw = gw - bOff - 12, by = gy + 26;
  const s = g.sw;
  const active = g.phase === "swing";
  const bcur = active ? s.b : 0;
  const maxB = 1.15;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(bx, by, bw, 10);
  const full = bx + (1 / maxB) * bw;
  ctx.fillStyle = "rgba(237,187,0,0.35)";
  ctx.fillRect(full, by, bx + bw - full, 10);
  ctx.fillStyle = bcur > 1.04 ? RED : MINT;
  ctx.fillRect(bx, by, clamp(bcur / maxB, 0, 1) * bw, 10);
  // the swing that carries the distance with this club
  const sg = g.meterSuggest();
  if (g.club === sg.club && (g.phase === "ready" || active)) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(bx + clamp(sg.power / maxB, 0, 1) * bw - 1, by - 3, 2, 16);
  }
  if ((g.phase === "fly" || g.phase === "rest" || (active && s.sub === "down")) && s.peak > 0) {
    ctx.fillStyle = GOLD;
    ctx.fillRect(bx + clamp(s.peak / maxB, 0, 1) * bw - 1, by - 4, 3, 18);
  }
  mono(ctx, 10);
  ctx.fillStyle = DIM;
  ctx.fillText("POWER", bx, by - 6);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(Math.min(1.15, Math.max(bcur, g.phase === "fly" || g.phase === "rest" ? s.peak : 0)) * 100)}%`, bx + bw, by - 6);
  ctx.textAlign = "left";

  // ---- the prompt above the gauge
  const slot0 = gy - 28;
  const room = w - 2 * pad - 20;
  let msgs: string[] = [];
  if (g.phase === "fly") msgs = g.fast ? ["4X"] : g.taken < 3 ? ["PRESS TO SPEED UP", "PRESS TO SKIP"] : [];
  else if (g.phase === "ready") msgs = g.taken < 3 && !g.linked ? ["DRAG DOWN, THEN SWING UP · OR SPACE THREE TIMES", "DRAG DOWN, THEN SWING UP", "DRAG DOWN, SWING UP"].slice(g.touch ? 1 : 0) : [];
  else if (g.phase === "swing" && s.src !== "remote") msgs = s.sub === "back" ? [s.src === "meter" ? "SPACE AGAIN TO SET THE POWER" : "NOW SWING UP"] : [s.src === "meter" ? "SPACE ON THE LINE" : "KEEP IT STRAIGHT UP"];
  if (msgs.length) {
    mono(ctx, 10);
    pill(ctx, fit(ctx, msgs, room), w / 2, slot0);
  }
  // a short canvas (a phone on its side) has the aim's yardage where the cue would go: the cue stands off to the right
  if (g.phase === "ready" && g.taken === 0 && !g.linked) swingCue(ctx, h < 380 ? w / 2 + Math.min(160, w * 0.24) : w / 2, h < 380 ? slot0 - 64 : slot0 - 84, g.t, !!g.opts.reduce);
  // the slope under the ball, while the shot is lined up
  const slope = g.phase === "ready" || (g.phase === "swing" && s.sub === "back") ? g.slopeSay() : null;
  if (slope) {
    mono(ctx, 10);
    pill(ctx, slope, w / 2, slot0 - 28, GOLD);
  }
  // a great shot, again
  if (g.replay) {
    mono(ctx, 10);
    pill(ctx, "REPLAY", w / 2, pad + 4, GOLD);
  }
  // what the last shot did
  if (g.phase === "rest" && g.result) {
    mono(ctx, 10);
    pill(ctx, fit(ctx, [g.result, g.result.split(" · ")[0]], room), w / 2, slot0 - 28, /^(WATER|TREES|IN THE GORSE|OUT OF BOUNDS)/.test(g.result) ? "#ff9a8f" : PAPER);
  }

  // ---- the shot card, while the ball is down
  if (g.card && g.phase === "rest") {
    const c = g.card;
    const a = clamp(c.t / 0.25, 0, 1);
    const cwid = compact ? 150 : 190;
    const x = pad - (1 - a) * 30;
    ctx.globalAlpha = a;
    panel(ctx, x, pad + 84, cwid, 70);
    mono(ctx, 10);
    ctx.fillStyle = MINT;
    ctx.fillText(`${c.club.short.toUpperCase()} · ${c.label}`, x + 10, pad + 102);
    display(ctx, 34, 800);
    ctx.fillStyle = PAPER;
    const n = Math.round(c.shot.carry * clamp(c.t / 0.5, 0, 1));
    ctx.fillText(String(n), x + 10, pad + 138);
    const nw = ctx.measureText(String(n)).width;
    mono(ctx, 10);
    ctx.fillStyle = DIM;
    ctx.fillText("YD CARRY", x + 16 + nw, pad + 138);
    ctx.globalAlpha = 1;
  }

  // ---- the keyboard's timing bar
  if (s.src === "meter" && active && s.sub === "down") {
    const tw = Math.min(360, w - 2 * pad);
    const tx = w / 2 - tw / 2, ty = gy - 66;
    ctx.fillStyle = PANEL;
    ctx.fillRect(tx - 6, ty - 6, tw + 12, 26);
    ctx.fillStyle = "rgba(138,217,168,0.25)";
    const half = tw / 2;
    ctx.fillRect(tx + half - 14, ty, 28, 14);
    ctx.fillStyle = PAPER;
    ctx.fillRect(tx + half - 1, ty - 4, 2, 22);
    const tau = s.dur - s.t;
    const mxp = tx + half - clamp(tau / s.dur, -0.4, 1) * (half - 8);
    ctx.fillStyle = tau > 0 ? "#fff" : RED;
    ctx.fillRect(mxp - 2, ty - 4, 4, 22);
  }

  // ---- the gesture's guide line and the path so far
  if (s.src === "gesture" && active) {
    const L = swingLen(h);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0 - 40);
    ctx.lineTo(s.x0, s.y0 + L * 1.1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.arc(s.x0, s.y0, 5, 0, 7);
    ctx.fill();
    ctx.strokeStyle = s.sub === "down" ? GOLD : MINT;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
}

/** the first shot of a visit: a dot that drags down slowly and swings up fast; a plain double arrow under reduced motion */
function swingCue(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, reduce: boolean) {
  const len = 44;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(13,16,14,.78)";
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + len);
  ctx.stroke();
  ctx.strokeStyle = "rgba(242,234,215,.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + len);
  if (reduce) {
    for (const [ty, d] of [[y, 1], [y + len, -1]]) {
      ctx.moveTo(x - 5, ty + d * 6);
      ctx.lineTo(x, ty);
      ctx.lineTo(x + 5, ty + d * 6);
    }
  }
  ctx.stroke();
  if (!reduce) {
    const u = (t % 2) / 2;
    const down = 0.55, up = 0.7;
    const at = u < down ? u / down : u < up ? 1 - (u - down) / (up - down) : 0;
    ctx.globalAlpha = u < up ? 1 : 1 - (u - up) / (1 - up);
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(x, y + at * len, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** the first putt of a visit: how to hit it */
function puttPrompt(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number) {
  const pb = g.putt.ball;
  if (g.scores.length > 0 || g.phaseT > 12 || g.putt.strokes > g.strokes || g.putt.tap || pb.moving || pb.sunk) return;
  mono(ctx, 10);
  const msg = fit(ctx, ["PULL BACK AND LET GO · OR ← → AND HOLD SPACE", "PULL BACK AND LET GO", "PULL BACK, LET GO"].slice(g.touch ? 1 : 0), w - 40);
  pill(ctx, msg, w / 2, h - 36);
}

// ------------------------------------------------------------ cards
function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number, a: number) {
  ctx.fillStyle = `rgba(13,16,14,${a})`;
  ctx.fillRect(0, 0, w, h);
}

/** the hole's name and numbers; `low` puts it near the bottom, out of the flyover's way */
function teeCard(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number, low = false) {
  const d = g.hole.def;
  const calls = g.callouts();
  const bw = Math.min(420, w - 24), bh = calls.length ? 138 : 120;
  const x = w / 2 - bw / 2, y = low ? Math.max(8, h - bh - Math.min(48, h * 0.08)) : Math.max(h * 0.22, 80);
  panel(ctx, x, y, bw, bh);
  ctx.textAlign = "center";
  mono(ctx, 10);
  ctx.fillStyle = MINT;
  ctx.fillText(d.name.toUpperCase(), w / 2, y + 28);
  display(ctx, Math.min(24, Math.floor((bw - 20) / 15)), 800);
  ctx.fillStyle = PAPER;
  ctx.fillText(`HOLE ${d.n} · PAR ${d.par} · ${d.yards} YD`, w / 2, y + 68);
  mono(ctx, 10);
  if (calls.length) {
    ctx.fillStyle = GOLD;
    ctx.fillText(calls.join(" · ").toUpperCase(), w / 2, y + 92);
  }
  ctx.fillStyle = DIM;
  ctx.fillText(g.phaseT < 0.6 ? "" : g.touch || w < 560 ? "TAP TO START" : "ANY KEY TO START", w / 2, y + (calls.length ? 120 : 98));
  ctx.textAlign = "left";
}

/** the shots of a hole in a line, longest form that fits first: "DRIVER 262 · 7 IRON 151 · 2 PUTTS" */
export function shotLine(st: HoleStat): string[] {
  const putts = st.putts > 0 ? `${st.putts} ${st.putts === 1 ? "PUTT" : "PUTTS"}` : "";
  const pen = (s: HoleStat["shots"][number]) => (s.pen ? ` +${s.pen}` : "");
  const short = (name: string) => CLUBS.find((c) => c.name === name)?.short ?? name;
  const join = (parts: string[]) => [...parts, putts].filter(Boolean).join(" · ");
  const n = st.shots.length;
  return [
    join(st.shots.map((s) => `${s.club.toUpperCase()} ${s.yd}${pen(s)}`)),
    join(st.shots.map((s) => `${short(s.club)} ${s.yd}${pen(s)}`)),
    join(st.shots.map((s) => `${s.yd}${pen(s)}`)),
    join([`${n} ${n === 1 ? "SHOT" : "SHOTS"}`]),
  ];
}

/** what went in, when it is worth saying: "CHIPPED IN FROM 18 YD", "HOLED FROM 24 FT" (a hole in one says itself) */
export function holedLine(st: HoleStat, strokes: number): string {
  const hd = st.holed;
  if (!hd || strokes === 1) return "";
  if (hd.by === "shot") return hd.yd <= 40 ? `CHIPPED IN FROM ${hd.yd} YD` : `HOLED OUT FROM ${hd.yd} YD`;
  return hd.ft >= 15 ? `HOLED FROM ${hd.ft} FT` : "";
}

function holeCard(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number) {
  const hs = g.scores[g.scores.length - 1];
  if (!hs) return;
  const d = g.hole.def;
  const st = g.stats[g.stats.length - 1];
  const holed = st ? holedLine(st, hs.strokes) : "";
  backdrop(ctx, w, h, 0.35);
  // room enough: the hole as it was played, down the left
  const mw = w >= 480 && h >= 300 && st ? 104 : 0;
  const bw = Math.min(380 + mw, w - 24), bh = (st ? 222 : 196) + (holed ? 20 : 0);
  // a short canvas (a phone on its side): the card is centred so it all fits
  const x = w / 2 - bw / 2, y = Math.min(Math.max(h * 0.2, 70), Math.max(8, (h - bh) / 2));
  panel(ctx, x, y, bw, bh);
  if (mw) mapPlayed(ctx, g, { x: x + 10, y: y + 10, w: mw - 10, h: bh - 20 }, st.putts > 0);
  const cx = x + mw + (bw - mw) / 2, tw = bw - mw - 28;
  ctx.textAlign = "center";
  mono(ctx, 10);
  ctx.fillStyle = MINT;
  ctx.fillText(fit(ctx, [`HOLE ${d.n} · ${d.name.toUpperCase()}`, `HOLE ${d.n}`], tw), cx, y + 28);
  display(ctx, Math.min(46, Math.floor(tw / (hs.call.length * 0.62))), 800);
  ctx.fillStyle = hs.strokes < d.par ? GOLD : hs.strokes === d.par ? PAPER : "#ff9a8f";
  ctx.fillText(hs.call, cx, y + 86);
  mono(ctx, 11);
  ctx.fillStyle = DIM;
  ctx.fillText(`${hs.strokes} ${hs.strokes === 1 ? "STROKE" : "STROKES"} · PAR ${d.par}`, cx, y + 114);
  let yy = y + 114;
  if (st) {
    mono(ctx, 10);
    ctx.fillStyle = PAPER;
    ctx.fillText(fit(ctx, shotLine(st), tw), cx, (yy += 26));
  }
  if (holed) {
    mono(ctx, 10);
    ctx.fillStyle = GOLD;
    ctx.fillText(holed, cx, (yy += 20));
  }
  mono(ctx, 11);
  ctx.fillStyle = DIM;
  const total = g.scores.reduce((a, b) => a + b.strokes, 0);
  const par = g.defs.slice(0, g.scores.length).reduce((a, b) => a + b.par, 0);
  ctx.fillText(`ROUND ${total} · ${toPar(total, par)}`, cx, (yy += st ? 24 : 20));
  ctx.fillStyle = PAPER;
  const last = g.idx + 1 >= g.defs.length;
  const go = g.touch || w < 560 ? "TAP" : "ANY KEY";
  ctx.fillText(g.phaseT < 0.5 ? "" : last ? `${go} FOR THE SCORECARD` : `${go} FOR HOLE ${g.defs[g.idx + 1].n}`, cx, yy + 36);
  ctx.textAlign = "left";
}

function roundCard(ctx: CanvasRenderingContext2D, g: CourseGame, w: number, h: number) {
  const r = g.round;
  if (!r) return;
  backdrop(ctx, w, h, 0.45);
  const n = g.defs.length;
  const cell = 44, lab = w < 420 ? 0 : 46;
  const bw = Math.min(w - 24, Math.max(340, lab + n * cell + 90)), bh = 264;
  const x = w / 2 - bw / 2, y = Math.min(Math.max(h * 0.14, 50), Math.max(8, (h - bh) / 2));
  panel(ctx, x, y, bw, bh);
  ctx.textAlign = "center";
  mono(ctx, 10);
  ctx.fillStyle = MINT;
  ctx.fillText("SCORECARD", w / 2, y + 26);
  display(ctx, 56, 800);
  ctx.fillStyle = PAPER;
  ctx.fillText(String(r.total), w / 2, y + 82);
  mono(ctx, 11);
  ctx.fillStyle = r.total <= r.par ? GOLD : DIM;
  ctx.fillText(overUnder(r.total, r.par), w / 2, y + 104);
  // the holes
  const tw = lab + n * cell;
  const x0 = w / 2 - tw / 2, y0 = y + 128;
  mono(ctx, 10);
  ctx.textAlign = "left";
  if (lab) {
    ctx.fillStyle = DIM;
    ctx.fillText("HOLE", x0, y0);
    ctx.fillText("PAR", x0, y0 + 18);
    ctx.fillText("YOU", x0, y0 + 36);
  }
  ctx.textAlign = "center";
  g.defs.forEach((d, i) => {
    const cx = x0 + lab + i * cell + cell / 2;
    const sc = g.scores[i];
    ctx.fillStyle = DIM;
    ctx.fillText(String(d.n), cx, y0);
    ctx.fillText(String(d.par), cx, y0 + 18);
    if (!sc) return;
    mono(ctx, 12);
    ctx.fillStyle = sc.strokes < d.par ? GOLD : sc.strokes === d.par ? PAPER : "#ff9a8f";
    ctx.fillText(String(sc.strokes), cx, y0 + 36);
    if (sc.strokes < d.par) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, y0 + 32.5, 9, 0, 7);
      ctx.stroke();
    } else if (sc.strokes > d.par) {
      ctx.strokeStyle = "#ff9a8f";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 8, y0 + 24.5, 16, 16);
    }
    mono(ctx, 10);
  });
  const best = bestRound(n);
  mono(ctx, 10);
  ctx.fillStyle = DIM;
  ctx.fillText(best === null ? "" : r.isBest ? (r.previous === null ? `BEST THIS VISIT ${best}` : `NEW BEST THIS VISIT ${best}`) : `BEST THIS VISIT ${best}`, w / 2, y + 204);
  ctx.fillStyle = PAPER;
  ctx.fillText(g.phaseT < 0.8 ? "" : g.touch || w < 560 ? "TAP TO PLAY AGAIN" : "ANY KEY TO PLAY AGAIN", w / 2, y + 238);
  ctx.textAlign = "left";
}
