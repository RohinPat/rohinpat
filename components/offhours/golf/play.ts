import { seeded } from "../useCanvas";
import { CLUBS, at, simulate, type Club, type Shot, type Surface } from "./flight";
import { HOLE_DEFS, buildHole, type BuiltHole, type HoleDef } from "./course";
import { blend, poseFor, type Pose } from "./golfer";
import { newPutt, puttBegin, puttKey, puttPointer, puttShoot, puttStep, type Putt, type PuttEnv } from "./green";
import { dropFor, lieFor } from "./lie";
import type { RemoteShot } from "./remoteSwing";
import { YD, newCam, type Cam } from "./scene";
import { PICK_UP_OVER, holeScore, overUnder, recordRound, shouldPickUp, type HoleScore } from "./score";
import { sfx } from "./sound";
import { fullCarry, meterFace, strikeNumbers, suggestCourse, type SwingSrc } from "./swing";

// The course as a game, with no screen: a hole at a time, a shot at a time.
// Phases: tee-card, ready, swing (back, then down), fly, rest, putt (the
// putting view, golf/green.ts), hole-card, round-card. Fixed step (1/60 s),
// every random thing from one seeded hand, so a round repeats and the bots in
// the tests can play it. Drawing is golf/playDraw.ts; the page is Golf.tsx.
//
// A swing is the same as the range's: drag down then up, Space three times, or a
// phone's golf-swing; all of them end in swing.ts's strike numbers.

export type Phase = "tee-card" | "ready" | "swing" | "fly" | "rest" | "putt" | "hole-card" | "round-card";

export type CourseOpts = {
  seed?: number;
  holes?: HoleDef[];
  /** play sounds (the page turns this on; the tests leave it off) */
  sound?: boolean;
  /** prefers-reduced-motion: no dissolve into the putt */
  reduce?: boolean;
  /** the live region */
  say?: (m: string) => void;
  /** the club changed (a chip should follow) */
  onClub?: (i: number) => void;
  /** the phase changed (the phone is told whether it can swing) */
  onPhase?: (p: Phase) => void;
};

export const STEP = 1 / 60;
const TEE_CARD_S = 2;
/** how long the camera stays on a shot that has come to rest, s */
export const REST_HOLD = 1.2;
const FAST_PLAY = 4;
/** a press on a card is ignored this long, so the key that ended the last thing does not skip it */
const CARD_GUARD_S = 0.5;
const SWING_BACK_S = 1.1;

type Swing = {
  src: SwingSrc;
  sub: "back" | "down";
  b: number;
  peak: number;
  t: number;
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
  dur: number;
  autoPeak: number;
  autoFace: number;
  remote: RemoteShot | null;
  over: boolean;
  tRev: number;
  lastL: number;
};
const emptySwing = (): Swing => ({ src: "meter", sub: "back", b: 0, peak: 0, t: 0, tStart: 0, x0: 0, y0: 0, peakY: 0, xTop: 0, xNow: 0, yNow: 0, moved: 0, pts: [], revPose: null, dur: 0.4, autoPeak: 1, autoFace: 0, remote: null, over: false, tRev: 0, lastL: 0 });

export type Card = { club: Club; shot: Shot; label: string; t: number; /** a meter swing: seconds off the line, + late */ timing: number | null };

type V3 = [number, number, number];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (u: number) => u * u * (3 - 2 * u);
export const swingLen = (h: number) => clamp(h * 0.3, 110, 230);

const LIE_WORDS: Partial<Record<Surface, string>> = { fairway: "in the fairway", rough: "in the rough", bunker: "in the bunker", fringe: "on the fringe", green: "on the green" };
const LIE_CAPS: Partial<Record<Surface, string>> = { fairway: "FAIRWAY", rough: "ROUGH", bunker: "BUNKER", fringe: "FRINGE", green: "GREEN" };

export class CourseGame {
  readonly defs: HoleDef[];
  phase: Phase = "tee-card";
  phaseT = 0;
  /** the game's clock, s (the putt is stepped with it) */
  t = 0;
  idx = 0;
  hole!: BuiltHole;
  /** the ball, metres in the hole's frame, and what it lies on */
  ball: [number, number] = [0, 0];
  lie: Surface = "fairway";
  /** strokes on this hole, penalties included */
  strokes = 0;
  scores: HoleScore[] = [];
  club = 3;
  /** the club the page or the player chose for this shot (the suggestion is not applied over it) */
  clubChosen = false;
  yaw = 0;
  yawT = 0;
  wind: [number, number] = [0, 0];
  sw: Swing = emptySwing();
  pose: Pose = poseFor({ kind: "back", u: 0 }, CLUBS[3]);
  trail: V3[] = [];
  shot: Shot | null = null;
  shotT = 0;
  bounceIdx = 0;
  followT = 0;
  fast = false;
  restT = 0;
  card: Card | null = null;
  /** where a ball went into the water, and when (game time) */
  splash: { x: number; z: number; t: number } | null = null;
  /** the one-line result of the last shot, for the HUD */
  result = "";
  /** the last shot ended in water or the trees: the ball is where it was dropped, not where it stopped */
  dropped = false;
  timing: number | null = null;
  /** the shots struck this visit (hints go after a few) */
  taken = 0;
  putt: Putt;
  /** the camera is the draw layer's; it lives here so it survives frames */
  cam: Cam = newCam();
  camReady = false;
  /** the end of the round */
  round: { total: number; par: number; isBest: boolean; previous: number | null; best: number } | null = null;
  said: string[] = [];
  /** the canvas, for the swing's pixel scale */
  w = 1440;
  h = 900;

  private puttRolling = false;
  private rng: () => number;
  private seed: number;
  private acc = 0;
  private penv: PuttEnv;
  readonly opts: CourseOpts;

  constructor(opts: CourseOpts = {}) {
    this.opts = opts;
    this.defs = opts.holes ?? HOLE_DEFS;
    this.seed = opts.seed ?? 1;
    this.rng = seeded(this.seed);
    this.putt = newPutt();
    this.penv = { play: true, say: (m) => this.say(m), reduce: opts.reduce };
    this.startHole(0);
  }

  // ------------------------------------------------------------ the round
  say(m: string) {
    this.said.push(m);
    if (this.said.length > 40) this.said.shift();
    this.opts.say?.(m);
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    this.opts.onPhase?.(p);
  }

  /** a new round from the first tee; the next seed so the wind is not the same */
  restart() {
    this.seed += 1;
    this.rng = seeded(this.seed);
    this.scores = [];
    this.round = null;
    this.startHole(0);
  }

  private startHole(i: number) {
    this.idx = i;
    this.hole = buildHole(this.defs[i]);
    this.ball = [0, 0];
    this.lie = "fairway";
    this.strokes = 0;
    this.card = null;
    this.shot = null;
    this.splash = null;
    this.result = "";
    this.trail = [];
    this.camReady = false;
    this.putt.course = null;
    this.setPhase("tee-card");
    this.prepareShot(true);
    const d = this.hole.def;
    const sp = Math.hypot(this.wind[0], this.wind[1]);
    this.say(`Hole ${d.n}, ${d.yards} yards, par ${d.par}. ${windSay(this.wind, this.yaw, sp)}`);
  }

  /** the aim, the club and the wind for the next shot from the ball */
  private prepareShot(tee: boolean) {
    const def = this.hole.def;
    const target = tee && def.par > 3 ? this.hole.landing : this.hole.pin;
    this.yawT = Math.atan2(target[0] - this.ball[0], target[1] - this.ball[1]);
    if (tee) this.yaw = this.yawT;
    const drift = 1 + (this.rng() * 2 - 1) * 0.2;
    this.wind = [this.hole.wind[0] * drift, this.hole.wind[1] * drift];
    this.clubChosen = false;
    this.setClub(this.suggested().club, false);
    this.pose = poseFor({ kind: "back", u: 0 }, CLUBS[this.club]);
    this.sw = emptySwing();
  }

  /** where the aim points: the landing zone for a tee shot on a par 4 or 5, else the pin (metres) */
  target(): [number, number] {
    const def = this.hole.def;
    return this.strokes === 0 && def.par > 3 ? this.hole.landing : this.hole.pin;
  }
  /** distance to the target, yards */
  yardsToTarget() {
    const [tx, tz] = this.target();
    return Math.hypot(tx - this.ball[0], tz - this.ball[1]) / YD;
  }
  yardsToPin() {
    return this.hole.toPin(this.ball[0], this.ball[1]) / YD;
  }
  /** the club and swing that carry the distance to the target from this lie */
  suggested(): { club: number; power: number } {
    if (this.lie === "bunker") return { club: CLUBS.length - 1, power: Math.min(1, this.yardsToTarget() / fullCarry(CLUBS.length - 1)) };
    // the rough takes some of the ball's speed: ask for a little more
    const yd = this.yardsToTarget() / (this.lie === "rough" ? 0.88 : 1);
    return suggestCourse(yd);
  }

  setClub(i: number, byPlayer = true) {
    const c = clamp(Math.round(i), 0, CLUBS.length - 1);
    if (byPlayer) this.clubChosen = true;
    if (c === this.club) return;
    this.club = c;
    this.opts.onClub?.(c);
  }
  /** nudge the aim, radians */
  aim(d: number) {
    this.yawT = clamp(this.yawT + d, this.baseYaw() - 0.42, this.baseYaw() + 0.42);
  }
  /** point the aim at once (a bot, a test) */
  setAim(yaw: number) {
    this.yawT = yaw;
    this.yaw = yaw;
  }
  private baseYaw() {
    const [tx, tz] = this.hole.pin;
    return Math.atan2(tx - this.ball[0], tz - this.ball[1]);
  }

  private canSwing() {
    return this.phase === "ready";
  }

  // ------------------------------------------------------------ input
  /** the same keys as the range: Space (three presses, or one to speed the ball up), arrows to aim and change club */
  key(e: { key: string; shiftKey?: boolean; altKey?: boolean; repeat?: boolean }, down: boolean): boolean {
    if (this.phase === "putt") return puttKey(this.putt, e as KeyboardEvent, down, this.t, this.penv);
    const space = e.key === " " || e.key === "Enter";
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (down && this.phase !== "round-card" && !(this.phase === "swing" && this.sw.sub === "down")) this.aim((e.key === "ArrowLeft" ? -1 : 1) * (e.altKey ? 0.005 : e.shiftKey ? 0.05 : 0.015));
      return true;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (down && (this.phase === "ready" || this.phase === "rest")) this.setClub(this.club + (e.key === "ArrowUp" ? -1 : 1));
      return true;
    }
    if (!space) return false;
    if (!down || e.repeat) return true;
    this.press("meter");
    return true;
  }

  /** a press of the swing key or the pointer: what it does depends on where the hole is */
  private press(src: "meter" | "gesture", x = 0, y = 0) {
    switch (this.phase) {
      case "tee-card":
        // any press: the card has been read (and it is not a swing)
        this.setPhase("ready");
        return;
      case "ready":
        this.beginSwing(src, x, y);
        return;
      case "swing":
        if (src === "meter" && this.sw.src === "meter") this.meterPress();
        return;
      case "fly":
        this.fast = true;
        return;
      case "rest":
        this.restT = Math.max(this.restT, REST_HOLD);
        return;
      case "hole-card":
        if (this.phaseT > CARD_GUARD_S) this.nextHole();
        return;
      case "round-card":
        if (this.phaseT > CARD_GUARD_S + 0.3) this.restart();
        return;
    }
  }

  pointer(kind: "down" | "move" | "up", x: number, y: number): void {
    if (this.phase === "putt") {
      puttPointer(this.putt, kind, x, y, this.t, this.penv);
      return;
    }
    const s = this.sw;
    const L = swingLen(this.h);
    if (kind === "down") {
      this.press("gesture", x, y);
      return;
    }
    if (this.phase !== "swing" || s.src !== "gesture") return;
    if (kind === "move") {
      s.xNow = x;
      s.yNow = y;
      s.moved = Math.max(s.moved, Math.hypot(x - s.x0, y - s.y0));
      s.pts.push([x, y]);
      if (s.pts.length > 60) s.pts.shift();
      s.b = clamp((y - s.y0) / L, 0, 1.2);
      if (s.sub === "back") {
        if (y > s.peakY) {
          s.peakY = y;
          s.xTop = x;
          s.peak = s.b;
        }
        // reversal: coming back up off the top
        if (s.peak >= 0.12 && y < s.peakY - 0.06 * L) {
          s.sub = "down";
          s.revPose = this.pose;
          s.tRev = this.t;
          s.t = 0;
          if (this.opts.sound) sfx("swish", s.peak);
        }
      } else if (y <= s.y0 + 0.02 * L) this.strike();
      return;
    }
    // up
    if (s.sub === "back") {
      // a tap is not a swing
      this.phase = "ready";
      this.opts.onPhase?.("ready");
    } else {
      s.xNow = x;
      this.strike();
    }
  }

  /** a swing from a linked phone: the golfer takes a quick swing and the ball is struck with exactly `shot` */
  remoteSwing(shot: RemoteShot): boolean {
    if (!this.canSwing()) return false;
    this.beginSwing("remote", 0, 0);
    this.sw.autoPeak = clamp(shot.power, 0.05, 1.15);
    this.sw.remote = shot;
    return true;
  }

  private beginSwing(src: SwingSrc, x: number, y: number) {
    this.timing = null;
    this.card = null;
    this.trail = [];
    this.fast = false;
    this.sw = { ...emptySwing(), src, sub: "back", tStart: this.t, x0: x, y0: y, peakY: y, xNow: x, yNow: y, xTop: x, lastL: swingLen(this.h) };
    this.phase = "swing";
    this.phaseT = 0;
    this.opts.onPhase?.("swing");
  }

  private meterPress() {
    const s = this.sw;
    if (s.sub === "back") {
      s.peak = clamp(s.b, 0.05, 1.15);
      s.dur = 0.46 + 0.1 * s.peak;
      s.revPose = this.pose;
      s.t = 0;
      s.sub = "down";
      if (this.opts.sound) sfx("swish", s.peak);
    } else {
      const tau = s.dur - s.t; // seconds until the ideal impact (negative: late)
      s.autoFace = meterFace(tau);
      this.timing = -tau;
      this.strike();
    }
  }

  // ------------------------------------------------------------ the strike
  private strike() {
    const s = this.sw;
    const club = CLUBS[this.club];
    const k = strikeNumbers({ src: s.src, peak: s.peak, x0: s.x0, xTop: s.xTop, xNow: s.xNow, lastL: s.lastL, td: this.t - s.tRev, autoFace: s.autoFace, remote: s.remote, over: s.over }, this.club, this.rng);
    if (k.overTop) this.timing = null;
    const shot = simulate({
      club,
      speed: k.speed,
      yaw: this.yaw,
      face: k.face,
      curve: k.curve,
      contact: k.contact,
      lift: k.lift,
      wind: this.wind,
      surfaceAt: this.hole.surfaceAt,
      origin: this.ball,
      lie: lieFor(this.lie, this.club),
      rng: this.rng,
    });
    this.shot = shot;
    this.shotT = 0;
    this.bounceIdx = 0;
    this.followT = 0;
    this.fast = false;
    this.strokes++;
    this.taken++;
    this.splash = null;
    this.card = { club, shot, label: k.label, t: 0, timing: this.timing };
    this.phase = "fly";
    this.phaseT = 0;
    this.opts.onPhase?.("fly");
    if (this.opts.sound) {
      sfx(club.len > 1.04 ? "strikeWood" : "strikeIron");
      sfx("land", 0.5);
    }
  }

  // ------------------------------------------------------------ time
  /** advance by `dt` seconds in fixed steps */
  advance(dt: number) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  step(dt: number) {
    this.t += dt;
    this.phaseT += dt;
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-7 * dt));
    const club = CLUBS[this.club];
    const s = this.sw;
    if (this.card) this.card.t += dt;
    switch (this.phase) {
      case "tee-card":
        this.pose = blend(this.pose, poseFor({ kind: "back", u: 0 }, club), 1 - Math.exp(-5 * dt));
        if (this.phaseT >= TEE_CARD_S) this.setPhase("ready");
        break;
      case "ready":
        this.pose = blend(this.pose, poseFor({ kind: "back", u: 0 }, club), 1 - Math.exp(-5 * dt));
        break;
      case "swing":
        this.stepSwing(dt, club, s);
        break;
      case "fly":
        this.stepFly(dt, club);
        break;
      case "rest":
        this.restT += dt;
        if (this.restT > 1.1) this.pose = blend(this.pose, poseFor({ kind: "back", u: 0 }, club), 1 - Math.exp(-3.5 * dt));
        if (this.trail.length) this.trail.shift();
        if (this.restT >= REST_HOLD) this.afterRest();
        break;
      case "putt": {
        puttStep(this.putt, dt, this.t, this.penv);
        // a putt that has stopped short of the cup says how far is left
        const ps = this.puttState();
        if (this.puttRolling && !ps.rolling && this.putt.strokes > this.strokes) {
          this.strokes = this.putt.strokes;
          this.say(`${Math.round(ps.dist * 3.281)} feet to the pin.`);
        }
        this.puttRolling = ps.rolling;
        break;
      }
      default:
        break;
    }
  }

  private stepSwing(dt: number, club: Club, s: Swing) {
    if (s.src !== "gesture") {
      if (s.sub === "back") {
        s.b += dt / (s.src === "remote" ? 0.42 : SWING_BACK_S);
        if (s.src === "remote" && s.b >= s.autoPeak) {
          s.peak = s.autoPeak;
          s.dur = 0.3;
          s.revPose = this.pose;
          s.t = 0;
          s.sub = "down";
          if (this.opts.sound) sfx("swish", s.peak);
        } else if (s.b >= 1.15) {
          // held too long: it goes over the top
          s.over = true;
          s.peak = 1.15;
          s.dur = 0.5;
          s.revPose = this.pose;
          s.t = 0;
          s.sub = "down";
          if (this.opts.sound) sfx("swish", 1);
        }
        this.pose = poseFor({ kind: "back", u: clamp(s.b, 0, 1) }, club);
        return;
      }
      s.t += dt;
      const tau = s.dur - s.t;
      s.b = Math.max(0, (s.peak * tau) / s.dur);
      if (s.src === "remote" && tau <= 0) return this.strike();
      if (s.src === "meter" && tau < -0.14) {
        s.autoFace = -1;
        this.timing = -tau;
        return this.strike();
      }
    } else {
      if (s.sub === "back") {
        this.pose = poseFor({ kind: "back", u: clamp(s.b, 0, 1) }, club);
        return;
      }
      s.t += dt;
    }
    const u = clamp(s.b, 0, 1);
    const target = poseFor({ kind: "down", u }, club);
    this.pose = s.revPose ? blend(s.revPose, target, smooth(clamp(s.t / 0.14, 0, 1))) : target;
  }

  private stepFly(dt: number, club: Club) {
    const sh = this.shot!;
    this.shotT += dt * (this.fast ? FAST_PLAY : 1);
    this.followT += dt;
    this.pose = poseFor({ kind: "follow", u: clamp(this.followT / 0.62, 0, 1) }, club);
    while (this.bounceIdx < sh.bounces.length && this.shotT >= sh.bounces[this.bounceIdx].t) {
      const b = sh.bounces[this.bounceIdx++];
      if (b.surface === "water") this.splash = { x: sh.ox + b.x, z: sh.oz + b.z, t: this.t };
      if (this.opts.sound) sfx(b.surface === "bunker" || b.surface === "water" ? "land" : "thud", 1);
    }
    if (this.shotT >= sh.restT) this.finishShot();
  }

  private finishShot() {
    const sh = this.shot!;
    const club = CLUBS[this.club];
    const e = at(sh, sh.restT);
    const end: [number, number] = [sh.ox + e[0], sh.oz + e[2]];
    const drop = dropFor(sh, sh.surface, this.hole.edgeDrop, this.hole.surfaceAt);
    const def = this.hole.def;
    let msg = `${club.name}: ${Math.round(sh.carry)} yards carry, ${Math.round(sh.total)} total`;
    this.dropped = !!drop;
    if (drop) {
      this.ball = [drop.x, drop.z];
      this.strokes += drop.penalty;
      this.lie = this.hole.surfaceAt(drop.x, drop.z);
      this.result = drop.why === "water" ? "WATER · +1" : "TREES · +1";
      msg = `${club.name}: ${Math.round(sh.carry)} yards carry. ${drop.say}`;
    } else {
      this.ball = end;
      this.lie = sh.surface;
      const toPin = this.yardsToPin();
      const ft = Math.round(toPin * 3);
      this.result = `${LIE_CAPS[sh.surface] ?? ""} · ${sh.surface === "green" || sh.surface === "fringe" ? `${ft} FT` : `${Math.round(toPin)} YD`} TO GO`;
      msg += `, ${LIE_WORDS[sh.surface] ?? ""}. ${sh.surface === "green" || sh.surface === "fringe" ? `${ft} feet` : `${Math.round(toPin)} yards`} to the pin.`;
    }
    this.say(msg);
    this.setPhase("rest");
    this.restT = 0;
    this.fast = false;
    // five over: the ball is picked up
    if (shouldPickUp(this.strokes, def.par)) {
      this.restT = REST_HOLD - 0.4;
    }
  }

  private afterRest() {
    const def = this.hole.def;
    if (shouldPickUp(this.strokes, def.par)) return this.holeDone(this.strokes, true);
    if (this.lie === "green" || this.lie === "fringe") {
      const [gx, gy] = this.hole.toGreen(this.ball[0], this.ball[1]);
      this.puttRolling = false;
      puttBegin(this.putt, this.hole.green, [gx, gy], this.strokes, { pickUp: def.par + PICK_UP_OVER, onDone: (s, up) => this.holeDone(s, up) }, this.t, this.opts.reduce);
      this.setPhase("putt");
      return;
    }
    this.prepareShot(false);
    this.setPhase("ready");
  }

  private holeDone(played: number, pickedUp: boolean) {
    const def = this.hole.def;
    const hs = holeScore(played, def.par, pickedUp);
    this.scores.push(hs);
    this.strokes = hs.strokes;
    this.setPhase("hole-card");
    this.say(`Hole ${def.n}: ${hs.strokes} ${hs.strokes === 1 ? "stroke" : "strokes"}, ${hs.call.toLowerCase()}.`);
  }

  nextHole() {
    if (this.idx + 1 < this.defs.length) {
      this.startHole(this.idx + 1);
      return;
    }
    const total = this.scores.reduce((a, b) => a + b.strokes, 0);
    const par = this.defs.reduce((a, b) => a + b.par, 0);
    const rec = recordRound(total, this.defs.length);
    this.round = { total, par, isBest: rec.isBest, previous: rec.previous, best: rec.best };
    this.setPhase("round-card");
    this.say(`Round: ${total} strokes, ${overUnder(total, par).toLowerCase()}.${rec.isBest && rec.previous !== null ? " Best of this visit." : ""}`);
  }

  // ------------------------------------------------------------ for the putting view and the bots
  /** the ball and the cup in the green's coordinates, and the distance (m), when putting */
  puttState() {
    const b = this.putt.ball, c = this.putt.hole.cup;
    return { ball: [b.x, b.y] as [number, number], cup: [c[0], c[1]] as [number, number], dist: Math.hypot(c[0] - b.x, c[1] - b.y), rolling: b.moving || !!this.putt.putter || !!this.putt.tap || b.sunk };
  }
  /** a putt struck the way Space's release does it (aim in the green's coordinates, power 0..1) */
  puttShoot(angle: number, power: number) {
    return this.phase === "putt" && puttShoot(this.putt, angle, power, this.t, this.penv);
  }
  get finished() {
    return this.phase === "round-card";
  }
  get par() {
    return this.hole.def.par;
  }
}

/** "Wind 4 mph from the left." relative to the aim */
function windSay(w: [number, number], yaw: number, sp: number) {
  const mph = Math.round(sp * 2.237);
  if (mph < 1) return "No wind.";
  const along = w[0] * Math.sin(yaw) + w[1] * Math.cos(yaw);
  const across = w[0] * Math.cos(yaw) - w[1] * Math.sin(yaw);
  const from = Math.abs(across) > Math.abs(along) ? (across > 0 ? "the left" : "the right") : along > 0 ? "behind" : "ahead";
  return `Wind ${mph} mph from ${from}.`;
}
export { windSay };
