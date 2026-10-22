import { seeded } from "../useCanvas";
import { display, mono } from "../font";
import { CLUBS, at, simulate, type Club, type Shot } from "./flight";
import { TARGETS, YD, drawWorld, newCam, prepare, project, surfaceAt, halfW, type Cam, type Drawable, type P2 } from "./scene";
import { ballLocal, blend, clubHeadWorld, golferDrawable, poseFor, type Pose } from "./golfer";
import { sfx } from "./sound";

// The driving range: a behind-the-golfer broadcast view, a swing you make with
// your hand (drag back, swing up through) or with three presses of Space, a
// real flight model, and a camera that follows the ball and dollies down the
// range to watch it land and roll. Practice, or a ten-shot target challenge.

const INK = "#0d100e";
const PAPER = "#f2ead7";
const MINT = "#8ad9a8";
const RED = "#e5484d";
const GOLD = "#edbb00";
const DIM = "#b5b6ab";
const PANEL = "rgba(13,16,14,0.74)";

type V = [number, number, number];
type Phase = "ready" | "back" | "down" | "fly" | "rest";
export type RangeMode = "practice" | "challenge";
export type RangeEnv = { play: boolean; say: (m: string) => void; club?: (i: number) => void };

type Particle = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; kind: "turf" | "dust" | "sand"; size: number; c: string };
type Card = { club: Club; shot: Shot; label: string; t: number };

type Swing = {
  src: "gesture" | "meter" | "auto";
  b: number;
  peak: number;
  t: number; // time in this phase
  tStart: number;
  x0: number;
  y0: number;
  peakY: number;
  xTop: number;
  xNow: number;
  yNow: number;
  moved: number;
  pts: [number, number][];
  revPose: Pose | null;
  dur: number; // downswing duration (meter/auto)
  autoPeak: number;
  autoFace: number;
  tRev: number;
  lastL: number;
};

export type Range = {
  phase: Phase;
  club: number;
  yaw: number;
  yawT: number;
  mode: RangeMode;
  cam: Cam;
  camReady: boolean;
  pose: Pose;
  trail: V[];
  sw: Swing;
  shot: Shot | null;
  shotT: number;
  followT: number;
  bounceIdx: number;
  label: string;
  contact: number;
  past: { shot: Shot; age: number }[];
  landings: { x: number; z: number }[];
  parts: Particle[];
  wind: { x: number; z: number };
  card: Card | null;
  restT: number;
  landedT: number;
  ch: { n: number; score: number; target: number; done: boolean; last: string; results: number[]; rng: () => number };
  tgt: number; // the target aimed at (challenge) or last tapped, -1 for none
  notified: number;
  auto: number;
  autoIdx: number;
  lastClubMsg: string;
};

export const SHOTS_PER_ROUND = 10;

const emptySwing = (): Swing => ({ src: "gesture", b: 0, peak: 0, t: 0, tStart: 0, x0: 0, y0: 0, peakY: 0, xTop: 0, xNow: 0, yNow: 0, moved: 0, pts: [], revPose: null, dur: 0.4, autoPeak: 1, autoFace: 0, tRev: 0, lastL: 0 });

export function newRange(): Range {
  const r: Range = {
    phase: "ready",
    club: 3,
    yaw: 0,
    yawT: 0,
    mode: "practice",
    cam: newCam(),
    camReady: false,
    pose: poseFor({ kind: "back", u: 0 }, CLUBS[3]),
    trail: [],
    sw: emptySwing(),
    shot: null,
    shotT: 0,
    followT: 0,
    bounceIdx: 0,
    label: "",
    contact: 1,
    past: [],
    landings: [],
    parts: [],
    wind: { x: 0, z: 0 },
    card: null,
    restT: 0,
    landedT: -9,
    ch: { n: 0, score: 0, target: 3, done: false, last: "", results: [], rng: seeded(31) },
    tgt: -1,
    notified: 3,
    auto: 1.2,
    autoIdx: 0,
    lastClubMsg: "",
  };
  rollWind(r, seeded(5));
  return r;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (u: number) => u * u * (3 - 2 * u);

function rollWind(r: Range, rnd: () => number) {
  const sp = rnd() * 4.2;
  const a = rnd() * Math.PI * 2;
  r.wind = { x: Math.sin(a) * sp, z: Math.cos(a) * sp };
}

// ------------------------------------------------------------ club table
const carryCache = new Map<string, number>();
const flatSurf = () => "fairway" as const;
function carryFor(club: number, sf: number): number {
  const key = `${club}:${sf.toFixed(3)}`;
  let v = carryCache.get(key);
  if (v === undefined) {
    v = simulate({ club: CLUBS[club], speed: sf, yaw: 0, face: 0, curve: 0, contact: 1, wind: [0, 0], surfaceAt: flatSurf }).carry;
    carryCache.set(key, v);
  }
  return v;
}
export const fullCarry = (club: number) => carryFor(club, 1);
/** the swing fraction (0..1 backswing) that carries `yd` with this club, or null if it can't */
export function powerFor(club: number, yd: number): number | null {
  if (yd > fullCarry(club) + 1) return null;
  let lo = 0.3, hi = 1;
  for (let i = 0; i < 9; i++) {
    const m = (lo + hi) / 2;
    if (carryFor(club, m) < yd) lo = m;
    else hi = m;
  }
  return (hi - 0.3) / 0.7;
}
export function suggest(yd: number): { club: number; power: number } {
  // the shortest club that gets there, with a little in hand
  for (let i = CLUBS.length - 1; i >= 0; i--) {
    const p = powerFor(i, yd);
    if (p !== null && p >= 0.62) return { club: i, power: p };
  }
  return { club: 0, power: Math.min(1, powerFor(0, yd) ?? 1) };
}
const sfOf = (b: number) => 0.3 + 0.7 * clamp(b, 0, 1);

// ------------------------------------------------------------ controls
export function rangeSetClub(r: Range, i: number) {
  r.club = clamp(i, 0, CLUBS.length - 1);
}
export function rangeAim(r: Range, d: number) {
  r.yawT = clamp(r.yawT + d, -0.42, 0.42);
}
export function rangeSetMode(r: Range, m: RangeMode) {
  r.mode = m;
  if (m === "challenge") startRound(r);
  else r.tgt = -1;
}
function startRound(r: Range) {
  r.ch = { n: 0, score: 0, target: 0, done: false, last: "", results: [], rng: seeded((Date.now() & 0xffff) + 3) };
  pickTarget(r);
}
function pickTarget(r: Range) {
  const prev = r.ch.target;
  let n = Math.floor(r.ch.rng() * TARGETS.length);
  if (n === prev) n = (n + 1 + Math.floor(r.ch.rng() * (TARGETS.length - 1))) % TARGETS.length;
  r.ch.target = n;
  r.tgt = n;
  const tg = TARGETS[n];
  r.yawT = Math.atan2(tg.gx, tg.gz);
}

function canSwing(r: Range) {
  if (r.mode === "challenge" && r.ch.done) return false;
  return r.phase === "ready" || (r.phase === "rest" && r.restT > 0.9);
}

function beginSwing(r: Range, src: Swing["src"], t: number, x = 0, y = 0) {
  r.phase = "back";
  r.card = null;
  r.trail = [];
  r.sw = { ...emptySwing(), src, tStart: t, x0: x, y0: y, peakY: y, xNow: x, yNow: y, xTop: x };
}

export function rangePointer(r: Range, kind: "down" | "move" | "up", x: number, y: number, w: number, h: number, t: number, env: RangeEnv) {
  const L = swingLen(h);
  if (kind === "down") {
    if (r.mode === "challenge" && r.ch.done && r.restT > 1) {
      startRound(r);
      r.phase = "ready";
      return;
    }
    if (!canSwing(r)) return;
    beginSwing(r, "gesture", t, x, y);
    return;
  }
  const s = r.sw;
  if (s.src !== "gesture") return;
  if (kind === "move") {
    if (r.phase !== "back" && r.phase !== "down") return;
    s.xNow = x;
    s.yNow = y;
    s.moved = Math.max(s.moved, Math.hypot(x - s.x0, y - s.y0));
    s.pts.push([x, y]);
    if (s.pts.length > 60) s.pts.shift();
    s.b = clamp((y - s.y0) / L, 0, 1.2);
    if (r.phase === "back") {
      if (y > s.peakY) {
        s.peakY = y;
        s.xTop = x;
        s.peak = s.b;
      }
      // reversal: coming back up off the top
      if (s.peak >= 0.12 && y < s.peakY - 0.06 * L) {
        r.phase = "down";
        s.revPose = r.pose;
        s.tRev = t;
        s.t = 0;
        sfx("swish", s.peak);
      }
    } else if (r.phase === "down") {
      if (y <= s.y0 + 0.02 * L) strike(r, t, env);
    }
    return;
  }
  // up
  if (r.phase === "back") {
    const tap = s.moved < 10 && t - s.tStart < 0.4;
    r.phase = "ready";
    if (tap) aimAtTap(r, s.x0, s.y0);
  } else if (r.phase === "down") {
    s.xNow = x;
    strike(r, t, env);
  }
}

export function swingLen(h: number) {
  return clamp(h * 0.3, 110, 230);
}

/** a tap on a target green aims at it */
function aimAtTap(r: Range, x: number, y: number) {
  const p = { x: 0, y: 0, d: 0, s: 0 } as P2;
  let best = -1, bd = 1e9;
  TARGETS.forEach((tg, i) => {
    if (!project(r.cam, tg.gx, 0, tg.gz, p)) return;
    const rr = Math.max(14, tg.gr * p.s * 1.4);
    const d = Math.hypot(x - p.x, (y - p.y) * 2.2);
    if (d < rr && d < bd) {
      bd = d;
      best = i;
    }
  });
  if (best >= 0 && r.mode !== "challenge") {
    r.tgt = best;
    r.yawT = Math.atan2(TARGETS[best].gx, TARGETS[best].gz);
  }
}

export function rangeKey(r: Range, e: KeyboardEvent, down: boolean, t: number, env: RangeEnv): boolean {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (down && r.phase !== "down") rangeAim(r, (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.05 : 0.015));
    return true;
  }
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    if (down && (r.phase === "ready" || r.phase === "rest")) rangeSetClub(r, r.club + (e.key === "ArrowUp" ? -1 : 1));
    return true;
  }
  if (e.key === " " || e.key === "Enter") {
    if (!down || e.repeat) return true;
    if (r.mode === "challenge" && r.ch.done && r.restT > 1) {
      startRound(r);
      r.phase = "ready";
      return true;
    }
    if (r.phase === "ready" || r.phase === "rest") {
      if (canSwing(r)) beginSwing(r, "meter", t);
    } else if (r.phase === "back" && r.sw.src === "meter") {
      r.sw.peak = clamp(r.sw.b, 0.05, 1.15);
      r.sw.dur = 0.46 + 0.1 * r.sw.peak;
      r.sw.revPose = r.pose;
      r.sw.t = 0;
      r.phase = "down";
      sfx("swish", r.sw.peak);
    } else if (r.phase === "down" && r.sw.src === "meter") {
      const tau = r.sw.dur - r.sw.t; // seconds until the ideal impact (negative = late)
      r.sw.autoFace = clamp(tau / 0.14, -1, 1);
      strike(r, t, env);
    }
    return true;
  }
  return false;
}

// ------------------------------------------------------------ the strike
function strike(r: Range, t: number, env: RangeEnv) {
  const s = r.sw;
  const club = CLUBS[r.club];
  let power = clamp(s.peak, 0.05, 1.15);
  let face = 0, curve = 0, contact = 1;
  if (s.src === "gesture") {
    const lenPx = s.lastL || 160;
    const ox = clamp((s.xNow - s.x0) / (0.34 * lenPx), -1, 1);
    const path = clamp(((s.xNow - s.xTop) / (0.34 * lenPx)) * 0.6, -1, 1);
    face = ox;
    curve = clamp((ox - path) * 0.8, -1, 1);
    const td = t - s.tRev;
    let q = 1;
    if (td > 0.6) q -= (td - 0.6) * 0.9;
    if (td < 0.1) q -= (0.1 - td) * 2.5;
    q -= Math.max(0, Math.abs(ox) - 0.55) * 0.5;
    contact = q;
  } else {
    const f = s.autoFace;
    face = f * 0.6;
    curve = f * 0.9;
    contact = 1 - Math.max(0, Math.abs(f) - 0.4) * 0.5;
  }
  if (power > 1.04) contact -= (power - 1.04) * 2.2;
  contact = clamp(contact, 0.35, 1);
  let lift = 1, label = "";
  if (contact > 0.93) label = "PURE";
  else if (contact > 0.8) label = "SOLID";
  else {
    if (Math.random() > 0.5) {
      label = "THIN";
      lift = 0.55;
    } else {
      label = "FAT";
      lift = 1.15;
      contact -= 0.06;
    }
  }
  const aimYaw = r.yaw;
  const sp = Math.abs(power) > 1 ? 1 : power;
  const shot = simulate({
    club,
    speed: sfOf(sp) * (1 + clamp(power - 1, 0, 0.15) * 0.15),
    yaw: aimYaw,
    face,
    curve,
    contact,
    lift,
    wind: [r.wind.x, r.wind.z],
    surfaceAt,
  });
  r.shot = shot;
  r.shotT = 0;
  r.bounceIdx = 0;
  r.label = label;
  r.contact = contact;
  r.phase = "fly";
  r.followT = 0;
  r.landedT = -9;
  r.restT = 0;
  // the follow-through starts from impact
  if (env.play) {
    sfx(club.len > 1.04 ? "strikeWood" : "strikeIron");
    sfx("land", 0.5);
  }
  divot(r, aimYaw, club, power);
  r.past.push({ shot, age: 0 });
  if (r.past.length > 6) r.past.shift();
}

function divot(r: Range, yaw: number, club: Club, power: number) {
  const a: V = [Math.sin(yaw), 0, Math.cos(yaw)];
  const n = 9 + Math.floor(power * 7);
  for (let i = 0; i < n; i++) {
    const sp = 1.5 + Math.random() * 4.5;
    r.parts.push({
      x: 0.1 * a[0], y: 0.02, z: 0.1 * a[2],
      vx: a[0] * sp * 0.8 + (Math.random() - 0.5) * 2, vy: 1.5 + Math.random() * 3.5, vz: a[2] * sp * 0.8 + (Math.random() - 0.5) * 2,
      life: 0, max: 0.9 + Math.random() * 0.5, kind: "turf", size: 0.025 + Math.random() * 0.03, c: Math.random() > 0.4 ? "#4a7a2e" : "#6b4c32",
    });
  }
  for (let i = 0; i < 6; i++)
    r.parts.push({ x: (Math.random() - 0.5) * 0.3, y: 0.05, z: (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 1.2 + a[0], vy: 0.4 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.2 + a[2], life: 0, max: 0.8 + Math.random() * 0.5, kind: "dust", size: 0.12 + Math.random() * 0.1, c: "230,236,200" });
  void club;
}

function landFx(r: Range, x: number, z: number, vin: number, surface: string) {
  const n = surface === "bunker" ? 16 : surface === "green" ? 3 : 6;
  for (let i = 0; i < n; i++) {
    const kind = surface === "bunker" ? "sand" : "turf";
    r.parts.push({
      x, y: 0.03, z,
      vx: (Math.random() - 0.5) * vin * 0.15, vy: 0.6 + Math.random() * vin * 0.12, vz: (Math.random() - 0.5) * vin * 0.15,
      life: 0, max: 0.6 + Math.random() * 0.4, kind, size: 0.02 + Math.random() * 0.025, c: kind === "sand" ? "#ead9a2" : surface === "green" ? "#8fd16b" : "#4a7a2e",
    });
  }
  for (let i = 0; i < 3; i++)
    r.parts.push({ x, y: 0.05, z, vx: (Math.random() - 0.5) * 0.8, vy: 0.3 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.8, life: 0, max: 0.7, kind: "dust", size: 0.1 + vin * 0.008, c: surface === "bunker" ? "236,220,170" : "225,235,205" });
}

// ------------------------------------------------------------ drawing
const pp = { x: 0, y: 0, d: 0, s: 0 } as P2;
const pq = { x: 0, y: 0, d: 0, s: 0 } as P2;

function frame(r: Range, dt: number, t: number, w: number, h: number, env: RangeEnv, play: boolean) {
  r.yaw += (r.yawT - r.yaw) * (1 - Math.exp(-7 * dt));
  const club = CLUBS[r.club];
  const s = r.sw;
  const L = swingLen(h);
  s.lastL = L;

  // preview: a self-playing golfer
  if (!play && (r.phase === "ready" || (r.phase === "rest" && r.restT > 2.2))) {
    r.auto -= dt;
    if (r.auto <= 0) autoSwing(r, t);
  }

  switch (r.phase) {
    case "back":
      if (s.src !== "gesture") {
        s.b += dt / (s.src === "auto" ? 0.95 : 1.1);
        if (s.src === "auto" && s.b >= s.autoPeak) {
          s.peak = s.autoPeak;
          s.dur = 0.4 + 0.08 * s.peak;
          s.revPose = r.pose;
          s.t = 0;
          r.phase = "down";
          if (play) sfx("swish", s.peak);
        } else if (s.b >= 1.15) {
          // held too long: it goes over the top
          s.peak = 1.15;
          s.dur = 0.5;
          s.revPose = r.pose;
          s.t = 0;
          r.phase = "down";
          if (play) sfx("swish", 1);
        }
      }
      r.pose = poseFor({ kind: "back", u: clamp(s.b, 0, 1.0) }, club);
      break;
    case "down": {
      if (s.src !== "gesture") {
        s.t += dt;
        const tau = s.dur - s.t;
        s.b = Math.max(0, (s.peak * tau) / s.dur);
        if (s.src === "auto" && tau <= 0) {
          s.autoFace = (Math.random() - 0.5) * 0.3;
          strike(r, t, env);
        } else if (s.src === "meter" && tau < -0.14) {
          s.autoFace = -1;
          strike(r, t, env);
        }
      } else s.t += dt;
      if (r.phase === "down") {
        const u = clamp(s.b, 0, 1);
        const target = poseFor({ kind: "down", u }, club);
        r.pose = s.revPose ? blend(s.revPose, target, smooth(clamp(s.t / 0.14, 0, 1))) : target;
        const go = golferOrigin(r, club);
        r.trail.push(clubHeadWorld(go.o, go.ex, go.ez, r.pose, club));
        if (r.trail.length > 8) r.trail.shift();
      }
      break;
    }
    case "fly": {
      r.shotT += dt;
      r.followT += dt;
      r.pose = poseFor({ kind: "follow", u: clamp(r.followT / 0.62, 0, 1) }, club);
      const go2 = golferOrigin(r, club);
      if (r.followT < 0.3) {
        r.trail.push(clubHeadWorld(go2.o, go2.ex, go2.ez, r.pose, club));
        if (r.trail.length > 8) r.trail.shift();
      } else if (r.trail.length) r.trail.shift();
      const sh = r.shot!;
      while (r.bounceIdx < sh.bounces.length && r.shotT >= sh.bounces[r.bounceIdx].t) {
        const b = sh.bounces[r.bounceIdx++];
        landFx(r, b.x, b.z, b.vy, b.surface);
        if (play) {
          const dist = Math.hypot(b.x - r.cam.x, b.z - r.cam.z);
          sfx(b.surface === "bunker" ? "land" : "thud", 1);
          void dist;
        }
        if (r.bounceIdx === 1) r.landedT = t;
      }
      if (r.shotT >= sh.restT) finishShot(r, t, env);
      break;
    }
    case "rest":
      r.restT += dt;
      if (r.restT > 1.1) r.pose = blend(r.pose, poseFor({ kind: "back", u: 0 }, club), 1 - Math.exp(-3.5 * dt));
      if (r.trail.length) r.trail.shift();
      break;
    default:
      r.pose = blend(r.pose, poseFor({ kind: "back", u: 0 }, club), 1 - Math.exp(-5 * dt));
  }
  // particles
  for (const p of r.parts) {
    p.life += dt;
    p.vy -= (p.kind === "dust" ? 0.3 : 9.8) * dt;
    p.x += p.vx * dt;
    p.y = Math.max(0, p.y + p.vy * dt);
    p.z += p.vz * dt;
    if (p.kind !== "dust" && p.y <= 0) {
      p.vy = 0;
      p.vx *= 0.5;
      p.vz *= 0.5;
    }
  }
  r.parts = r.parts.filter((p) => p.life < p.max);
  for (const q of r.past) q.age += dt;
  if (r.card) r.card.t += dt;
}

function golferOrigin(r: Range, club: Club) {
  const ex: V = [Math.cos(r.yaw), 0, -Math.sin(r.yaw)];
  const ez: V = [Math.sin(r.yaw), 0, Math.cos(r.yaw)];
  const bl = ballLocal(club);
  return { o: [-ex[0] * bl[0], 0, -ex[2] * bl[0]] as V, ex, ez };
}

function autoSwing(r: Range, t: number) {
  const idx = r.autoIdx++ % TARGETS.length;
  const order = [1, 3, 0, 4, 2, 5];
  const n = order[idx % order.length];
  const tg = TARGETS[n];
  r.tgt = n;
  r.yawT = Math.atan2(tg.gx, tg.gz);
  const sg = suggest(tg.yd);
  r.club = sg.club;
  rollWind(r, () => Math.random());
  beginSwing(r, "auto", t);
  r.sw.autoPeak = clamp(sg.power, 0.3, 1);
  r.card = null;
  r.auto = 1.4;
}

function finishShot(r: Range, t: number, env: RangeEnv) {
  const sh = r.shot!;
  const club = CLUBS[r.club];
  r.phase = "rest";
  r.restT = 0;
  r.card = { club, shot: sh, label: r.label, t: 0 };
  const end = at(sh, sh.restT);
  r.landings.push({ x: end[0], z: end[2] });
  if (r.landings.length > 12) r.landings.shift();
  let extra = "";
  if (r.mode === "challenge" && !r.ch.done && env.play) {
    const tg = TARGETS[r.ch.target];
    const d = Math.hypot(end[0] - tg.gx, end[2] - tg.gz);
    const dist = Math.hypot(tg.gx, tg.gz);
    const err = d / (0.15 * dist + 6);
    const onGreen = sh.surface === "green";
    const pts = Math.round(100 * Math.max(0, 1 - err)) + (onGreen ? 20 : 0);
    r.ch.score += pts;
    r.ch.n++;
    r.ch.results.push(pts);
    const ft = Math.round(d * 3.281);
    r.ch.last = `${onGreen ? "ON THE GREEN" : sh.surface === "bunker" ? "BUNKER" : "MISSED THE GREEN"} · ${ft} FT FROM THE PIN · +${pts}`;
    extra = ` ${onGreen ? "On the green" : "Missed the green"}, ${ft} feet from the pin. Plus ${pts}. Score ${r.ch.score}.`;
    if (r.ch.n >= SHOTS_PER_ROUND) {
      r.ch.done = true;
      extra += ` Round over: ${r.ch.score} points.`;
    } else pickTarget(r);
  }
  rollWind(r, () => Math.random());
  if (env.play) {
    const side = Math.round(Math.abs(sh.side));
    env.say(`${club.name}: ${Math.round(sh.carry)} yards carry, ${Math.round(sh.total)} total${side > 1 ? `, ${side} yards ${sh.side < 0 ? "left" : "right"} of the aim` : ""}.${extra}`);
  }
  void t;
}

// ------------------------------------------------------------ camera
function updateCamera(r: Range, dt: number, w: number, h: number) {
  const c = r.cam;
  const a: V = [Math.sin(r.yaw), 0, Math.cos(r.yaw)];
  const rt: V = [Math.cos(r.yaw), 0, -Math.sin(r.yaw)];
  const F0 = Math.max(w * 0.9, h * 1.1);
  const off = w / h > 1.2 ? 1.7 : 0.7;
  let dx = -a[0] * 8.4 + rt[0] * off, dy = 1.9, dz = -a[2] * 8.4 + rt[2] * off;
  let tx = a[0] * 70, ty = 0.9, tz = a[2] * 70;
  let F = F0;
  let posRate = 3, tgtRate = 3;
  const sh = r.shot;
  if (sh && (r.phase === "fly" || (r.phase === "rest" && r.restT < 2.6))) {
    const ball = at(sh, r.phase === "fly" ? r.shotT : sh.restT);
    const land = sh.bounces[0] ? ([sh.bounces[0].x, 0, sh.bounces[0].z] as V) : ([ball[0], 0, ball[2]] as V);
    const dist = Math.hypot(land[0], land[2]);
    const e = dist < 30 ? 0 : smooth(clamp((r.shotT - sh.apexT * 0.55) / Math.max(0.5, sh.landT - sh.apexT * 0.55), 0, 1));
    const back = Math.min(58, 12 + dist * 0.26);
    const side = Math.min(16, 4 + dist * 0.06);
    const c1: V = [land[0] - a[0] * back + rt[0] * side, 6, land[2] - a[2] * back + rt[2] * side];
    const c0: V = [dx, dy, dz];
    dx = c0[0] + (c1[0] - c0[0]) * e;
    dy = c0[1] + (c1[1] - c0[1]) * e;
    dz = c0[2] + (c1[2] - c0[2]) * e;
    tx = ball[0];
    ty = ball[1] * 0.9 + 0.5;
    tz = ball[2];
    // never tilt up more than about 22 degrees: keep some of the range in the picture
    const hd = Math.hypot(tx - dx, tz - dz);
    ty = Math.min(ty, dy + hd * 0.4);
    const d = Math.hypot(tx - dx, ty - dy, tz - dz);
    F = F0 * clamp(1 + (d - 40) / 90, 1, 1.9);
    posRate = 3.2;
    tgtRate = r.phase === "fly" && r.shotT < 0.5 ? 7 : 5;
  }
  if (!r.camReady) {
    c.x = dx; c.y = dy; c.z = dz; c.tx = tx; c.ty = ty; c.tz = tz; c.F = F;
    r.camReady = true;
  } else {
    const kp = 1 - Math.exp(-posRate * dt), kt = 1 - Math.exp(-tgtRate * dt), kf = 1 - Math.exp(-2.6 * dt);
    c.x += (dx - c.x) * kp; c.y += (dy - c.y) * kp; c.z += (dz - c.z) * kp;
    c.tx += (tx - c.tx) * kt; c.ty += (ty - c.ty) * kt; c.tz += (tz - c.tz) * kt;
    c.F += (F - c.F) * kf;
  }
}

export function rangeDraw(ctx: CanvasRenderingContext2D, r: Range, w: number, h: number, dt: number, t: number, env: RangeEnv) {
  const play = env.play;
  frame(r, dt, t, w, h, env, play);
  updateCamera(r, dt, w, h);
  if (r.notified !== r.club) {
    r.notified = r.club;
    env.club?.(r.club);
  }
  const cam = r.cam;
  prepare(cam, w, h, 0.4);
  const club = CLUBS[r.club];

  // things that stand on the range and move with the shot
  const extra: Drawable[] = [];
  const bp = { x: 0, y: 0, d: 0, s: 0 } as P2;
  if (r.phase !== "fly" && r.phase !== "rest" || r.restT < 0.01) {
    // the ball on its tee
    if (project(cam, 0, 0.03, 0, bp)) {
      const bd = bp.d + 0.6, k = bp.s;
      const bx = bp.x, by = bp.y;
      extra.push({
        d: bd,
        draw: () => {
          ctx.fillStyle = "rgba(10,40,20,0.35)";
          ctx.beginPath();
          ctx.ellipse(bx + 0.01 * k, by + 0.015 * k, 0.03 * k, 0.012 * k, 0, 0, 7);
          ctx.fill();
          ctx.fillStyle = "#fffdf5";
          ctx.beginPath();
          ctx.arc(bx, by - 0.012 * k, Math.max(1.6, 0.0215 * k), 0, 7);
          ctx.fill();
        },
      });
    }
  }
  const g = golferDrawable(ctx, cam, [0, 0.02, 0], r.yaw, club, r.pose, r.trail);
  if (g) extra.push(g);
  drawWorld(ctx, cam, w, h, t, r.wind, { highlight: r.mode === "challenge" ? r.ch.target : r.tgt, extra });

  const sh = r.shot;
  // ---- tracers
  const trace = (pts: Float32Array, n: number, upTo: number, glow: number, core: number, col: string) => {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const draw = (lw: number, style: string) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.beginPath();
      // camera-space polyline, clipped against the near plane so nothing behind
      // (or beside) the camera can wrap around the screen
      const NEARZ = 1.2;
      let prev: V | null = null;
      let pen = false;
      const emit = (c: V, first: boolean) => {
        const k = cam.F / c[2];
        const x = cam.cx + c[0] * k, y = cam.cy - c[1] * k;
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      };
      const toCam = (x: number, y: number, z: number): V => {
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
        return [dx * cam.rx + dy * cam.ry + dz * cam.rz, dx * cam.ux + dy * cam.uy + dz * cam.uz, dx * cam.fx + dy * cam.fy + dz * cam.fz];
      };
      const feed = (x: number, y: number, z: number) => {
        const c = toCam(x, Math.max(0, y), z);
        if (prev) {
          const a = prev, inA = a[2] >= NEARZ, inB = c[2] >= NEARZ;
          if (inA !== inB) {
            const u = (NEARZ - a[2]) / (c[2] - a[2]);
            const m: V = [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, NEARZ];
            if (inA) {
              if (!pen) emit(a, true);
              emit(m, false);
              pen = false;
            } else {
              emit(m, true);
              pen = true;
            }
          }
          if (inB) {
            if (!pen) {
              emit(c, true);
              pen = true;
            } else emit(c, false);
          } else pen = false;
        } else if (c[2] >= NEARZ) {
          emit(c, true);
          pen = true;
        }
        prev = c;
      };
      for (let i = 0; i < n; i++) {
        const i4 = i * 4;
        if (pts[i4] > upTo) break;
        feed(pts[i4 + 1], pts[i4 + 2], pts[i4 + 3]);
      }
      if (upTo < pts[(n - 1) * 4]) {
        const e = at(sh!, upTo);
        feed(e[0], e[1], e[2]);
      }
      ctx.stroke();
    };
    if (glow) draw(glow, "rgba(255,70,50,0.22)");
    draw(core, col);
  };
  for (const q of r.past) {
    if (q.shot === sh && (r.phase === "fly" || r.phase === "rest")) continue;
    const a = Math.max(0, 0.3 - q.age * 0.02);
    if (a > 0 && r.phase !== "fly") trace(q.shot.pts, q.shot.n, 99, 0, 1.4, `rgba(255,255,255,${a})`);
  }
  if (sh && (r.phase === "fly" || r.phase === "rest")) {
    const upTo = r.phase === "fly" ? r.shotT : sh.restT;
    const fadeA = r.phase === "rest" ? clamp(1 - (r.restT - 2.2) / 1.2, 0, 1) : 1;
    ctx.globalAlpha = fadeA;
    trace(sh.pts, sh.n, upTo, 7, 3, "#ff5a4a");
    trace(sh.pts, sh.n, upTo, 0, 1.3, "#fff1e6");
    ctx.globalAlpha = 1;
    // the ball itself
    const ball = at(sh, upTo);
    if (project(cam, ball[0], ball[1], ball[2], pp)) {
      const rad = Math.max(2.4, 0.0215 * pp.s * 1.15);
      // shadow on the ground
      if (project(cam, ball[0], 0.01, ball[2], pq)) {
        const sc = clamp(1 - ball[1] / 60, 0.3, 1);
        ctx.fillStyle = `rgba(10,40,20,${0.3 * sc})`;
        ctx.beginPath();
        ctx.ellipse(pq.x, pq.y, rad * 1.5 * sc + 1, rad * 0.55 * sc + 0.5, 0, 0, 7);
        ctx.fill();
      }
      if (r.phase === "fly" && ball[1] > 3) {
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
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.arc(pp.x + rad * 0.25, pp.y + rad * 0.3, rad * 0.75, 0, 0.9 * Math.PI);
      ctx.fill();
    }
  }
  // ---- particles
  for (const p of r.parts) {
    if (!project(cam, p.x, p.y, p.z, pp)) continue;
    const u = p.life / p.max;
    if (p.kind === "dust") {
      ctx.fillStyle = `rgba(${p.c},${0.22 * (1 - u) * (1 - u)})`;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, p.size * pp.s * (0.6 + u * 1.6), 0, 7);
      ctx.fill();
    } else {
      ctx.fillStyle = p.c;
      const sz = Math.max(1.2, p.size * pp.s);
      ctx.fillRect(pp.x - sz / 2, pp.y - sz / 2, sz, sz * 0.7);
    }
  }
  // ---- carry / total tags where the ball came down
  if (sh && (r.phase === "fly" || r.phase === "rest")) {
    const b0 = sh.bounces[0];
    if (b0 && (r.phase === "rest" || r.shotT >= b0.t)) {
      const age = r.phase === "rest" ? r.restT + (sh.restT - b0.t) : r.shotT - b0.t;
      const fade = clamp(1 - (age - 4.5) / 1.2, 0, 1) * clamp(age / 0.2, 0, 1);
      if (fade > 0 && project(cam, b0.x, 0, b0.z, pp)) {
        tag(ctx, pp.x, pp.y - Math.max(18, 4 * pp.s), `${Math.round(sh.carry)} YD CARRY`, fade, w, play);
      }
    }
    if (r.phase === "rest") {
      const end = at(sh, sh.restT);
      const fade = clamp(r.restT / 0.25, 0, 1) * clamp(1 - (r.restT - 4.5) / 1.2, 0, 1);
      if (fade > 0 && sh.total - sh.carry > 4 && project(cam, end[0], 0, end[2], pp)) tag(ctx, pp.x, pp.y - 14, `${Math.round(sh.total)} TOTAL`, fade, w, play, true);
    }
  }

  // ---- HUD
  if (play) hud(ctx, r, w, h, t);
  else previewHud(ctx, r, w, h, t);
}

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, a: number, w: number, play: boolean, small = false) {
  ctx.globalAlpha = a;
  mono(ctx, play ? (small ? 10 : 11) : 8);
  const tw = ctx.measureText(text).width + 14;
  const cx = clamp(x, tw / 2 + 6, w - tw / 2 - 6);
  const hgt = play ? 20 : 15;
  ctx.fillStyle = "rgba(13,16,14,0.82)";
  ctx.beginPath();
  ctx.roundRect(cx - tw / 2, y - hgt, tw, hgt, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 9);
  ctx.stroke();
  ctx.fillStyle = PAPER;
  ctx.textAlign = "center";
  ctx.fillText(text, cx, y - hgt / 2 + (play ? 4 : 3));
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

function previewHud(ctx: CanvasRenderingContext2D, r: Range, w: number, h: number, t: number) {
  void t;
  if (r.card && r.card.t < 4) {
    const a = clamp(1 - (r.card.t - 3) / 1, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = PANEL;
    ctx.fillRect(10, 10, 112, 34);
    display(ctx, 15, 800);
    ctx.fillStyle = PAPER;
    ctx.fillText(`${Math.round(r.card.shot.carry)} YD`, 18, 28);
    mono(ctx, 8);
    ctx.fillStyle = DIM;
    ctx.fillText(r.card.club.name.toUpperCase(), 18, 39);
    ctx.globalAlpha = 1;
  }
  void w;
  void h;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function hud(ctx: CanvasRenderingContext2D, r: Range, w: number, h: number, t: number) {
  const compact = w < 640;
  const club = CLUBS[r.club];
  const pad = compact ? 8 : 14;

  // ---- shot data card
  if (r.card) {
    const c = r.card;
    const a = clamp(c.t / 0.25, 0, 1);
    const cw = compact ? 158 : 220;
    const x = pad - (1 - a) * 30;
    ctx.globalAlpha = a;
    const all: [string, string][] = [
      ["TOTAL", `${Math.round(c.shot.total)} YD`],
      ["BALL SPEED", `${Math.round(c.shot.speed)} MPH`],
      ["LAUNCH", `${c.shot.launch.toFixed(1)}°`],
      ["SPIN", `${c.shot.spin} RPM`],
      ["APEX", `${Math.round((c.shot.apex / YD) * 3)} FT`],
      ["CURVE", curveLabel(c.shot)],
    ];
    const rows = compact ? [all[0], all[1], all[5]] : all;
    const rh = compact ? 15 : 17;
    const ch = (compact ? 74 : 92) + rows.length * rh;
    panel(ctx, x, pad, cw, ch);
    mono(ctx, compact ? 9 : 10);
    ctx.fillStyle = MINT;
    ctx.fillText(`${c.club.name.toUpperCase()} · ${c.label}`, x + 12, pad + 18);
    display(ctx, compact ? 38 : 46, 800);
    ctx.fillStyle = PAPER;
    const n = Math.round(c.shot.carry * clamp(c.t / 0.5, 0, 1));
    ctx.fillText(String(n), x + 12, pad + (compact ? 54 : 64));
    const nw = ctx.measureText(String(n)).width;
    mono(ctx, compact ? 9 : 10);
    ctx.fillStyle = DIM;
    ctx.fillText("YD CARRY", x + 18 + nw, pad + (compact ? 54 : 64));
    rows.forEach(([k, v], i) => {
      const yy = pad + (compact ? 76 : 90) + i * rh;
      mono(ctx, compact ? 8 : 9);
      ctx.fillStyle = DIM;
      ctx.fillText(k, x + 12, yy);
      ctx.fillStyle = PAPER;
      ctx.textAlign = "right";
      ctx.fillText(v, x + cw - 12, yy);
      ctx.textAlign = "left";
    });
    ctx.globalAlpha = 1;
  }

  // ---- top centre: challenge status
  if (r.mode === "challenge") {
    const tg = TARGETS[r.ch.target];
    const sg = suggest(tg.yd);
    const bw = compact ? Math.min(w - 2 * pad, 300) : 380;
    const x = w / 2 - bw / 2;
    panel(ctx, x, pad, bw, compact ? 44 : 52);
    mono(ctx, compact ? 9 : 10);
    ctx.fillStyle = MINT;
    ctx.fillText(r.ch.done ? "ROUND OVER" : `SHOT ${Math.min(SHOTS_PER_ROUND, r.ch.n + 1)} OF ${SHOTS_PER_ROUND}`, x + 12, pad + 17);
    ctx.fillStyle = PAPER;
    ctx.textAlign = "right";
    ctx.fillText(`SCORE ${r.ch.score}`, x + bw - 12, pad + 17);
    ctx.textAlign = "left";
    if (!r.ch.done) {
      display(ctx, compact ? 15 : 18, 800);
      ctx.fillStyle = PAPER;
      ctx.fillText(`TARGET ${tg.yd} YD`, x + 12, pad + (compact ? 36 : 42));
      mono(ctx, compact ? 8 : 9);
      ctx.fillStyle = DIM;
      ctx.textAlign = "right";
      ctx.fillText(`TRY ${CLUBS[sg.club].short} · ${Math.round(sg.power * 100)}% SWING`, x + bw - 12, pad + (compact ? 36 : 41));
      ctx.textAlign = "left";
    }
    if (r.ch.last && !r.ch.done && r.phase !== "back" && r.phase !== "down" && r.phase !== "fly") {
      mono(ctx, compact ? 9 : 10);
      const lw = ctx.measureText(r.ch.last).width + 20;
      const lx = w / 2 - lw / 2, ly = pad + (compact ? 52 : 60);
      ctx.fillStyle = "rgba(13,16,14,0.82)";
      ctx.beginPath();
      ctx.roundRect(lx, ly, lw, 22, 4);
      ctx.fill();
      ctx.fillStyle = PAPER;
      ctx.fillText(r.ch.last, lx + 10, ly + 15);
    }
  }

  // ---- top right: wind and the map
  const mw = compact ? 0 : 128, mh = compact ? 0 : 186;
  const wx = w - pad - 112;
  {
    const along = r.wind.x * Math.sin(r.yaw) + r.wind.z * Math.cos(r.yaw);
    const across = r.wind.x * Math.cos(r.yaw) - r.wind.z * Math.sin(r.yaw);
    const mph = Math.round(Math.hypot(r.wind.x, r.wind.z) * 2.237);
    panel(ctx, wx, pad, 112, 40);
    mono(ctx, 9);
    ctx.fillStyle = DIM;
    ctx.fillText("WIND", wx + 10, pad + 15);
    ctx.fillStyle = PAPER;
    ctx.fillText(`${mph} MPH`, wx + 10, pad + 31);
    // arrow: where the wind is blowing, relative to the aim (up = downrange)
    const ax = wx + 84, ay = pad + 20;
    const ang = Math.atan2(across, along); // 0 = tailwind (blows downrange = up on the screen)
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
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
  if (!compact) {
    const mx = w - pad - mw, my = pad + 48;
    panel(ctx, mx, my, mw, mh);
    const ox = mx + mw / 2, oy = my + mh - 14;
    const sy = (mh - 30) / 300, sx = (mw - 16) / 100;
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx, my, mw, mh);
    ctx.clip();
    ctx.fillStyle = "rgba(111,174,80,0.18)";
    ctx.fillRect(mx + 6, my + 6, mw - 12, mh - 12);
    TARGETS.forEach((tg, i) => {
      const gx = ox + (tg.gx / YD) * sx, gy = oy - tg.yd * sy;
      const act = (r.mode === "challenge" ? r.ch.target : r.tgt) === i;
      ctx.fillStyle = act ? "rgba(255,255,255,0.9)" : "rgba(143,209,107,0.8)";
      ctx.beginPath();
      ctx.ellipse(gx, gy, Math.max(2.5, tg.r * sx), Math.max(2.5, tg.r * sy), 0, 0, 7);
      ctx.fill();
      if (act) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
    mono(ctx, 8);
    ctx.fillStyle = DIM;
    for (const yd of [100, 200, 300]) ctx.fillText(String(yd), mx + 5, oy - yd * sy + 3);
    // aim line
    ctx.strokeStyle = "rgba(242,234,215,0.6)";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.sin(r.yaw) * 300 * sy, oy - Math.cos(r.yaw) * 300 * sy);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const l of r.landings) {
      ctx.fillStyle = MINT;
      ctx.beginPath();
      ctx.arc(ox + (l.x / YD) * sx, oy - (l.z / YD) * sy, 2.4, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- bottom: club, swing gauge, prompt
  const s = r.sw;
  const gw = Math.min(compact ? w - 2 * pad : 470, w - 2 * pad);
  const gx = w / 2 - gw / 2;
  const gh = 58;
  const gy = h - gh - (compact ? 8 : 14);
  panel(ctx, gx, gy, gw, gh);
  // left: club
  mono(ctx, compact ? 9 : 10);
  ctx.fillStyle = MINT;
  ctx.fillText(club.name.toUpperCase(), gx + 12, gy + 18);
  ctx.fillStyle = DIM;
  ctx.fillText(`${Math.round(fullCarry(r.club))} YD FULL`, gx + 12, gy + 34);
  // bar
  const bx = gx + (compact ? 118 : 150), bw2 = gw - (compact ? 130 : 164), by = gy + 26;
  const active = r.phase === "back" || r.phase === "down";
  const bcur = active ? s.b : 0;
  const maxB = 1.15;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(bx, by, bw2, 10);
  const full = bx + (1 / maxB) * bw2;
  ctx.fillStyle = "rgba(237,187,0,0.35)";
  ctx.fillRect(full, by, bx + bw2 - full, 10);
  ctx.fillStyle = bcur > 1.04 ? RED : MINT;
  ctx.fillRect(bx, by, clamp(bcur / maxB, 0, 1) * bw2, 10);
  if (r.phase === "down" || r.phase === "fly" || r.phase === "rest") {
    const pk = (s.peak || 0) / maxB;
    if (pk > 0) {
      ctx.fillStyle = GOLD;
      ctx.fillRect(bx + clamp(pk, 0, 1) * bw2 - 1, by - 4, 3, 18);
    }
  }
  ctx.fillStyle = PAPER;
  ctx.fillRect(full - 1, by - 3, 2, 16);
  mono(ctx, 8);
  ctx.fillStyle = DIM;
  ctx.fillText("POWER", bx, by - 6);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(Math.min(1.15, Math.max(bcur, r.phase === "fly" || r.phase === "rest" ? s.peak : 0)) * 100)}%`, bx + bw2, by - 6);
  ctx.textAlign = "left";

  // prompt above the gauge
  let msg = "";
  if (r.mode === "challenge" && r.ch.done) msg = `ROUND OVER · ${r.ch.score} POINTS · CLICK OR PRESS SPACE TO PLAY AGAIN`;
  else if (r.phase === "ready" || (r.phase === "rest" && r.restT > 0.9)) msg = compact ? "DRAG DOWN, THEN SWING UP" : "DRAG DOWN TO TAKE IT BACK, THEN SWING UP THROUGH THE BALL · OR PRESS SPACE THREE TIMES";
  else if (r.phase === "back") msg = s.src === "meter" ? "SPACE AGAIN TO SET THE POWER" : "NOW SWING UP";
  else if (r.phase === "down") msg = s.src === "meter" ? "SPACE ON THE LINE" : "KEEP IT STRAIGHT UP";
  if (msg) {
    mono(ctx, compact ? 8 : 10);
    const tw = ctx.measureText(msg).width + 20;
    const mx2 = w / 2 - Math.min(tw, w - 2 * pad) / 2;
    ctx.fillStyle = "rgba(13,16,14,0.7)";
    ctx.beginPath();
    ctx.roundRect(mx2, gy - 28, Math.min(tw, w - 2 * pad), 22, 4);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.textAlign = "center";
    ctx.fillText(msg, w / 2, gy - 13, w - 2 * pad - 16);
    ctx.textAlign = "left";
  }

  // gesture guide: the line to swing along, and the path so far
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
    ctx.strokeStyle = r.phase === "down" ? GOLD : MINT;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    // the face, as it will be if you let go now
    if (r.phase === "down") {
      const ox = clamp((s.xNow - s.x0) / (0.34 * L), -1, 1);
      const lab = Math.abs(ox) < 0.2 ? "SQUARE" : ox > 0 ? "OPEN" : "CLOSED";
      mono(ctx, 10);
      const lw = ctx.measureText(lab).width + 16;
      ctx.fillStyle = "rgba(13,16,14,0.8)";
      ctx.beginPath();
      ctx.roundRect(s.x0 - lw / 2, s.y0 - 46, lw, 20, 4);
      ctx.fill();
      ctx.fillStyle = Math.abs(ox) < 0.2 ? MINT : GOLD;
      ctx.textAlign = "center";
      ctx.fillText(lab, s.x0, s.y0 - 32);
      ctx.textAlign = "left";
    }
  }
  // the keyboard timing bar
  if (s.src === "meter" && r.phase === "down") {
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

  // aim hint, first moments
  if (r.phase === "ready" && t < 10 && r.mode === "practice") {
    mono(ctx, compact ? 8 : 9);
    ctx.fillStyle = "rgba(13,16,14,0.7)";
    const hint = compact ? "TAP A GREEN TO AIM" : "TAP A GREEN OR USE ← → TO AIM · ↑ ↓ TO CHANGE CLUB";
    const hw = ctx.measureText(hint).width + 20;
    ctx.beginPath();
    ctx.roundRect(w / 2 - hw / 2, h * 0.07, hw, 22, 4);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.textAlign = "center";
    ctx.fillText(hint, w / 2, h * 0.07 + 15);
    ctx.textAlign = "left";
  }

  // round over
  if (r.mode === "challenge" && r.ch.done) {
    const bw = Math.min(360, w - 2 * pad), bh = 180;
    const x = w / 2 - bw / 2, y = h * 0.3;
    panel(ctx, x, y, bw, bh);
    mono(ctx, 10);
    ctx.fillStyle = MINT;
    ctx.textAlign = "center";
    ctx.fillText("TARGET CHALLENGE", w / 2, y + 26);
    display(ctx, 58, 800);
    ctx.fillStyle = PAPER;
    ctx.fillText(String(r.ch.score), w / 2, y + 88);
    mono(ctx, 10);
    ctx.fillStyle = DIM;
    ctx.fillText(`OF ${SHOTS_PER_ROUND * 120} · ${rating(r.ch.score)}`, w / 2, y + 110);
    // the ten shots as bars
    const bwid = (bw - 48) / SHOTS_PER_ROUND;
    r.ch.results.forEach((p, i) => {
      const hh = (p / 120) * 40;
      ctx.fillStyle = p >= 100 ? GOLD : p >= 60 ? MINT : "rgba(255,255,255,0.3)";
      ctx.fillRect(x + 24 + i * bwid + 2, y + bh - 18 - hh, bwid - 4, hh);
    });
    ctx.textAlign = "left";
  }
}

function rating(score: number) {
  const f = score / (SHOTS_PER_ROUND * 120);
  return f > 0.8 ? "TOUR LEVEL" : f > 0.6 ? "LOW HANDICAP" : f > 0.4 ? "WEEKEND GOLFER" : f > 0.2 ? "KEEP PRACTISING" : "FIND THE FAIRWAY";
}

function curveLabel(s: Shot) {
  const c = s.curve;
  const a = Math.abs(c);
  if (a < 2) return "STRAIGHT";
  const kind = c > 0 ? (a > 22 ? "SLICE" : "FADE") : a > 22 ? "HOOK" : "DRAW";
  return `${kind} ${Math.round(a)} YD`;
}

void halfW;
