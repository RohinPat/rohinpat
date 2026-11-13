import { seeded } from "../useCanvas";
import { CLUBS, at, simulate, type Club, type Shot, type Surface } from "./flight";
import { HOLE_DEFS, buildHole, type BuiltHole, type HoleDef } from "./course";
import { blend, poseFor, type Pose } from "./golfer";
import { newPutt, puttBegin, puttKey, puttPointer, puttShoot, puttStep, zone, type Putt, type PuttEnv } from "./green";
import { bothLies, dropFor, lieFor, slopeLie, slopeWords } from "./lie";
import { FLAT, terrainOf, type Terrain } from "./terrain";
import { solidsOf, withDecks, type Solid } from "./solids";
import { calloutsOf } from "./sightline";
import type { RemoteShot } from "./remoteSwing";
import { TARGETS, YD, newCam, type Cam } from "./scene";
import { PICK_UP_OVER, holeScore, overUnder, recordRound, shouldPickUp, type HoleScore } from "./score";
import { sfx } from "./sound";
import { CHIP_YD, METER_SQUARE, carryIn, chipPowerFor, fullCarry, greenRoll, lieCarry, meterFace, sfOf, sfOfChip, strikeNumbers, suggestCourse, type SwingSrc } from "./swing";

// The course as a game, with no screen: a hole at a time, a shot at a time.
// Phases: tee-card, ready, swing (back, then down), fly, rest, putt (the
// putting view, golf/green.ts), hole-card, round-card. Fixed step (1/60 s),
// every random thing from one seeded hand, so a round repeats and the bots in
// the tests can play it. Drawing is golf/playDraw.ts; the page is Golf.tsx.
//
// A swing is the same as the range's: drag down then up, Space three times, or a
// phone's golf-swing; all of them end in swing.ts's strike numbers. Inside 40 yd of
// the pin a drag or the meter is a chip meter (swing.ts), and a ball within 2 yd
// of the green is putted. The hole map (golf/map.ts) is drawn by playDraw; the
// game keeps whether it is open and where it is, so a tap on it can set the aim.

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
  /** the map was opened or closed (the chip follows) */
  onMap?: (open: boolean) => void;
  /** how long the tee card stays up before play, s (the 3D page flies over the hole under it) */
  teeCardS?: number | ((def: HoleDef) => number);
  /** the ground has its hills (terrain.ts); without, every hole is flat */
  hills?: boolean;
  /** a great shot is played again before the next one (the 3D page, which has a camera for it) */
  replays?: boolean;
  /**
   * practice, not a round: "range" hits balls from the tee of RANGE_DEF at its target flags (the club picks the flag),
   * "green" putts balls from around the cups of the holes' greens. No cards, no score.
   */
  practice?: "range" | "green";
  /**
   * a challenge on the range: "targets" is ten balls, each at a flag picked by the seed, scored by how close (as the
   * Off hours range scores it); "closest" is five balls at one flag, the best of them counts
   */
  challenge?: "targets" | "closest";
};

export const TARGET_SHOTS = 10;
export const CLOSEST_BALLS = 5;
/** a ball in the targets challenge: up to 100 for how close it finished (the miss allowed grows with the flag's distance), 20 more on the green */
export function targetPoints(missM: number, flagM: number, onGreen: boolean) {
  return Math.round(100 * Math.max(0, 1 - missM / (0.15 * flagM + 6))) + (onGreen ? 20 : 0);
}
export type Challenge = {
  kind: "targets" | "closest";
  /** balls in all */
  shots: number;
  /** each ball played: the flag, how far from it (ft), on its green, and its points (targets) */
  results: { flag: number; ft: number; on: boolean; pts: number }[];
  score: number;
  /** closest: the nearest ball so far, ft */
  best: number | null;
  done: boolean;
};

/** a practice green gives this many balls before it moves on to the next hole's */
export const GREEN_BALLS = 3;

/** a shot played again: the flight from `t` to `end` (its own clock, s), and why it earned it */
export type Replay = { shot: Shot; t: number; end: number; why: "holed" | "close" | "long" };
/** a tee shot this long (yd, total) is replayed; so is an approach from 30 yd or more that finishes within CLOSE_YD of the pin */
const LONG_YD = 275, CLOSE_YD = 2, CLOSE_FROM_YD = 30;
/** the longest a replay runs, s */
export const REPLAY_MAX_S = 4.5;

/** how a hole was played, for the end of the round: the tee shot, the green, the putts */
export type HoleStat = {
  /** a par 4 or 5: the tee shot finished in the fairway (null on a par 3) */
  fairway: boolean | null;
  /** on the green with two putts left for par */
  gir: boolean;
  putts: number;
  /** a par 4 or 5: the tee shot's total, yd, unless it was dropped */
  drive: number | null;
  penalties: number;
  /** each full shot: the club, how far it went (yd, total), and the penalty strokes it cost */
  shots: { club: string; yd: number; pen: number }[];
  /** how it went in: from off the green (yd), or a putt (ft); null when picked up */
  holed: { by: "shot"; yd: number } | { by: "putt"; ft: number } | null;
};

/** a ball this close to the green (m), on rough or fairway, is putted */
export const NEAR_GREEN = 2 * YD;
/** how far the aim can be turned from the line to the pin, radians */
const AIM_RANGE = 0.42;
/** water is played over when the longest club carries its far bank by this much (yd), else the ball is laid up */
const LAY_OVER = 10;
/** a lay-up carries this far short of the water (yd), so its roll stops on dry ground */
const LAY_SHORT = 18;
/** a pin this much (yd) past the longest carry is still aimed at: the roll gets there */
const REACH_ROLL = 15;
/** a shot played to run up to the pin still lands at least this far (yd) onto the green */
const GREEN_IN = 3;
export type MapView = { x: number; y: number; w: number; h: number; /** the point on the hole (metres) under a point on the canvas */ at: (px: number, py: number) => [number, number] };

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
  /** a chip meter (set when the swing began) */
  chip: boolean;
  /** the meter's mark, the power that carries the distance (0: this club has none); it ticks once on the way up */
  mark: number;
  marked: boolean;
};
const emptySwing = (): Swing => ({ src: "meter", sub: "back", b: 0, peak: 0, t: 0, tStart: 0, x0: 0, y0: 0, peakY: 0, xTop: 0, xNow: 0, yNow: 0, moved: 0, pts: [], revPose: null, dur: 0.4, autoPeak: 1, autoFace: 0, remote: null, over: false, tRev: 0, lastL: 0, chip: false, mark: 0, marked: false });

export type Card = { club: Club; shot: Shot; label: string; t: number; /** a meter swing: seconds off the line, + late */ timing: number | null };

type V3 = [number, number, number];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** a keyboard swing, said: the power, the timing and the strike (" Power 92, late, thin.") */
export function meterWords(peak: number, over: boolean, timing: number | null, label: string) {
  const when = over ? "over the top" : timing === null ? "" : Math.abs(timing) <= METER_SQUARE ? "on time" : timing > 0 ? "late" : "early";
  return ` Power ${Math.round(Math.min(1.15, peak) * 100)}${when ? `, ${when}` : ""}, ${label.toLowerCase()}.`;
}
/** how long the aim has to rest before it is said, s */
const AIM_SAY_S = 0.6;
const feet = (n: number) => `${n} ${n === 1 ? "foot" : "feet"}`;
const yards = (n: number) => `${n} ${n === 1 ? "yard" : "yards"}`;
const smooth = (u: number) => u * u * (3 - 2 * u);
export const swingLen = (h: number) => clamp(h * 0.3, 110, 230);

const LIE_WORDS: Partial<Record<Surface, string>> = { fairway: "in the fairway", rough: "in the rough", bunker: "in the bunker", fringe: "on the fringe", green: "on the green", fescue: "in the long fescue", waste: "in the waste area" };
const LIE_CAPS: Partial<Record<Surface, string>> = { fairway: "FAIRWAY", rough: "ROUGH", bunker: "BUNKER", fringe: "FRINGE", green: "GREEN", fescue: "FESCUE", waste: "WASTE AREA" };
/** the HUD's line for a penalty drop */
/** what a ball is told it hit when it struck a wall, a boulder or a post */
export const PROP_WORDS: Record<Solid["kind"], string> = { wall: "the wall", boulder: "a boulder", post: "the post", gatepost: "the gatepost", rail: "the rail" };
const DROP_CAPS: Record<"water" | "out" | "gorse" | "oob" | "steep", string> = { water: "WATER · +1", out: "TREES · +1", gorse: "IN THE GORSE · +1", oob: "OUT OF BOUNDS · +1", steep: "UNPLAYABLE · +1" };
/** a lie the driver cannot be played from (it is too thick round the club) */
const NO_DRIVER = new Set<Surface>(["rough", "fescue"]);

export class CourseGame {
  readonly defs: HoleDef[];
  phase: Phase = "tee-card";
  phaseT = 0;
  /** the game's clock, s (the putt is stepped with it) */
  t = 0;
  idx = 0;
  hole!: BuiltHole;
  /** the ground the ball flies over and rolls on: the hole's hills, or flat */
  terrain: Pick<Terrain, "y" | "slope"> = FLAT;
  /** the ball, metres in the hole's frame, and what it lies on */
  ball: [number, number] = [0, 0];
  lie: Surface = "fairway";
  /** strokes on this hole, penalties included */
  strokes = 0;
  scores: HoleScore[] = [];
  club = 3;
  /** the club the page or the player chose for this shot (the suggestion is not applied over it) */
  clubChosen = false;
  /** when to say the aim (a game time, s), or -1 */
  private aimSayT = -1;
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
  /** the replay being played, and the one waiting for the shot's rest to end */
  replay: Replay | null = null;
  private replayNext: Replay | null = null;
  /** the last shot went in */
  holedOut = false;
  /** the last shot ended in water or the trees: the ball is where it was dropped, not where it stopped */
  dropped = false;
  timing: number | null = null;
  /** what a meter swing was, said after where the ball went (the card shows it) */
  private strikeSay = "";
  /** the shots struck this visit (hints go after a few) */
  taken = 0;
  /** a phone is paired, so the swing hints for a mouse or the keys stay away */
  linked = false;
  /** a touch screen: the prompts leave the keyboard out */
  touch = false;
  putt: Putt;
  /** the camera is the draw layer's; it lives here so it survives frames */
  cam: Cam = newCam();
  camReady = false;
  /** the hole map: open or not, where it was drawn last, and a drag on it in progress */
  mapOpen = false;
  mapSet = false;
  mapView: MapView | null = null;
  private mapDrag = false;
  /** where each shot of this hole went, metres: from, to */
  legs: [number, number, number, number][] = [];
  /** how each finished hole was played, and the one in progress */
  stats: HoleStat[] = [];
  stat: HoleStat = newStat();
  /** the strokes played when the ball reached the green (the rest are putts) */
  private puttFrom = -1;
  /** the end of the round */
  round: { total: number; par: number; isBest: boolean; previous: number | null; best: number } | null = null;
  said: string[] = [];
  /** the range: the target flag aimed at (scene.ts TARGETS) */
  rangeTarget = 2;
  /** practice: balls hit on the range, or putted out on the green */
  balls = 0;
  /** a challenge on the range, while one is on */
  challenge: Challenge | null = null;
  private chRng: () => number = Math.random;
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
    this.challenge = null;
    this.balls = 0;
    this.seed += 1;
    this.rng = seeded(this.seed);
    this.scores = [];
    this.stats = [];
    this.round = null;
    this.startHole(0);
  }

  private startHole(i: number) {
    this.idx = i;
    this.hole = buildHole(this.defs[i]);
    this.terrain = this.opts.hills ? withDecks(terrainOf(this.hole), this.hole.def.props) : FLAT;
    this.ball = [0, 0];
    this.lie = "fairway";
    this.strokes = 0;
    this.card = null;
    this.shot = null;
    this.splash = null;
    this.result = "";
    this.trail = [];
    this.legs = [];
    this.camReady = false;
    this.putt.course = null;
    this.stat = newStat();
    this.puttFrom = -1;
    if (this.opts.practice === "green") return this.practicePutt();
    if (this.opts.practice === "range" && this.opts.challenge) this.startChallenge(this.opts.challenge);
    this.setPhase(this.opts.practice ? "ready" : "tee-card");
    this.prepareShot(true);
    const d = this.hole.def;
    const sp = Math.hypot(this.wind[0], this.wind[1]);
    const ch = this.challenge;
    if (ch) this.say(`${ch.kind === "targets" ? `Targets: ${ch.shots} balls, a new flag for each.` : `Closest to the pin: ${ch.shots} balls at one flag.`} ${windSay(this.wind, this.yaw, sp)} ${this.flagWords()}`);
    else if (this.opts.practice === "range") this.say(`Range. ${windSay(this.wind, this.yaw, sp)} ${this.flagWords()}`);
    else {
      // (what the tee card says of the drop and the carry, said too)
      const calls = this.callouts().map((c) => `${c[0].toUpperCase()}${c.slice(1)}.`).join(" ");
      this.say(`Hole ${d.n}, ${d.yards} yards, par ${d.par}. ${calls ? `${calls} ` : ""}${windSay(this.wind, this.yaw, sp)} ${CLUBS[this.club].name}.`);
    }
  }

  // ------------------------------------------------------------ practice
  /** "7 Iron, the 140 yard flag." */
  private flagWords() {
    return `${CLUBS[this.club].name}, the ${TARGETS[this.rangeTarget].yd} yard flag.`;
  }
  /** the range: the flag the club in hand carries nearest to */
  private flagFor(club: number) {
    const carry = fullCarry(club) * this.carryK(club);
    let best = 0;
    TARGETS.forEach((t, i) => {
      if (Math.abs(t.yd - carry) < Math.abs(TARGETS[best].yd - carry)) best = i;
    });
    return best;
  }
  private startChallenge(kind: "targets" | "closest") {
    this.chRng = seeded(this.seed * 7 + 1);
    this.challenge = { kind, shots: kind === "targets" ? TARGET_SHOTS : CLOSEST_BALLS, results: [], score: 0, best: null, done: false };
    this.rangeTarget = this.pickFlag(-1);
  }
  /** a flag for the challenge, never the one just played */
  private pickFlag(prev: number) {
    let n = Math.floor(this.chRng() * TARGETS.length);
    if (n === prev) n = (n + 1 + Math.floor(this.chRng() * (TARGETS.length - 1))) % TARGETS.length;
    return n;
  }
  /** the range: aim at a target flag */
  setTarget(i: number) {
    this.rangeTarget = clamp(Math.round(i), 0, TARGETS.length - 1);
    this.yawT = this.baseYaw();
  }
  /** the range: the next ball, back on the tee, the club and the flag as they were */
  private nextBall() {
    this.ball = [0, 0];
    this.lie = "fairway";
    this.strokes = 0;
    this.shot = null;
    this.trail = [];
    this.legs = [];
    this.holedOut = false;
    this.dropped = false;
    this.camReady = false;
    const drift = 1 + (this.rng() * 2 - 1) * 0.2;
    this.wind = [this.hole.wind[0] * drift, this.hole.wind[1] * drift];
    this.yawT = this.yaw = this.baseYaw();
    // a new flag in the targets challenge: the club for it from the tee, as the first ball had
    if (this.challenge?.kind === "targets") {
      this.clubChosen = false;
      this.setClub(this.suggested().club, false);
    }
    this.pose = poseFor({ kind: "back", u: 0 }, CLUBS[this.club]);
    this.sw = emptySwing();
    this.setPhase("ready");
    this.say(this.flagWords());
  }
  /**
   * the practice green: a ball somewhere on this hole's green, 4 to 30 ft from the cup; after GREEN_BALLS are holed,
   * the next hole's green
   */
  private practicePutt() {
    if (this.balls > 0 && this.balls % GREEN_BALLS === 0) {
      this.idx = (this.idx + 1) % this.defs.length;
      this.hole = buildHole(this.defs[this.idx]);
      this.terrain = this.opts.hills ? withDecks(terrainOf(this.hole), this.hole.def.props) : FLAT;
      this.camReady = false;
    }
    const H = this.hole.green;
    let spot: [number, number] = [H.cup[0], H.cup[1] + 2];
    for (let k = 0; k < 60; k++) {
      const r = 1.2 + this.rng() * 7.8, a = this.rng() * Math.PI * 2;
      const gx = H.cup[0] + Math.cos(a) * r, gy = H.cup[1] + Math.sin(a) * r;
      if (zone(H, gx, gy) === 0) {
        spot = [gx, gy];
        break;
      }
    }
    this.ball = this.hole.fromGreen(spot[0], spot[1]);
    this.lie = "green";
    this.strokes = 0;
    this.puttRolling = false;
    puttBegin(
      this.putt,
      H,
      spot,
      0,
      {
        pickUp: 99,
        practice: true,
        onDone: (s) => {
          this.balls++;
          this.say(`In, ${s === 1 ? "one putt" : `${s} putts`}.`);
          this.practicePutt();
        },
      },
      this.t,
      this.opts.reduce,
    );
    this.setPhase("putt");
    const ft = Math.round(Math.hypot(H.cup[0] - spot[0], H.cup[1] - spot[1]) * 3.281);
    this.say(`Green ${this.hole.def.n}. ${feet(ft)} to the cup.`);
  }

  /** the aim, the club and the wind for the next shot from the ball */
  private prepareShot(tee: boolean) {
    const target = this.target();
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
    if (this.opts.practice === "range") {
      const t = TARGETS[this.rangeTarget];
      return [t.gx, t.gz];
    }
    const def = this.hole.def;
    if (this.strokes === 0 && def.par > 3) return this.hole.landing;
    return this.downTheFairway() ?? this.hole.pin;
  }
  /** a pin out of reach: the furthest point down the middle of the fairway that the longest club carries, or null */
  private downTheFairway(): [number, number] | null {
    let reach = 0;
    for (let c = NO_DRIVER.has(this.lie) ? 1 : 0; c < CLUBS.length; c++) reach = Math.max(reach, fullCarry(c) * this.carryK(c));
    const [bx, bz] = this.ball;
    const R = (reach + REACH_ROLL) * YD;
    if (this.hole.toPin(bx, bz) <= R) return null;
    const line = this.hole.line;
    const near = (x: number, z: number) => {
      let bi = 0, bd = Infinity;
      line.forEach(([lx, lz], i) => {
        const d = Math.hypot(lx - x, lz - z);
        if (d < bd) [bd, bi] = [d, i];
      });
      return bi;
    };
    const from = near(bx, bz), to = near(...this.hole.pin);
    let best: [number, number] | null = null;
    for (let i = from + 1; i <= to; i++) if (Math.hypot(line[i][0] - bx, line[i][1] - bz) <= reach * YD) best = line[i];
    return best;
  }
  /** distance to the target, yards */
  yardsToTarget() {
    const [tx, tz] = this.target();
    return Math.hypot(tx - this.ball[0], tz - this.ball[1]) / YD;
  }
  /** what the tee card says of the hole's drop and carry (sightline.ts): nothing on a flat course, which has no hills to read */
  callouts(): string[] {
    if (!this.opts.hills || this.terrain === FLAT) return [];
    return calloutsOf(this.hole);
  }
  yardsToPin() {
    return this.hole.toPin(this.ball[0], this.ball[1]) / YD;
  }
  /** the share of a pure swing's carry the ball's lie leaves with this club */
  carryK(club = this.club) {
    return lieCarry(this.lie, club);
  }
  /** the club and swing for the target from this lie, short of water it cannot carry; played at the pin, it lands short and runs up to it */
  suggested(): { club: number; power: number } {
    const lay = this.layUp();
    const yd = lay ?? this.yardsToTarget();
    const sw = CLUBS.length - 1;
    // the carry it plays like: up or down hill to where it comes down, with the wind or into it
    if (this.lie === "bunker") return { club: sw, power: Math.min(1, (yd * this.conditions(yd).ratio(sw, 1)) / (fullCarry(sw) * this.carryK(sw))) };
    const k = (c: number) => this.carryK(c);
    const pick = (carry: number) => {
      const plays = this.conditions(carry);
      let sg = suggestCourse(carry, k);
      for (let i = 0; i < 2; i++) sg = suggestCourse(carry * plays.ratio(sg.club, sfOf(sg.power)), k);
      // no driver out of the rough
      if (sg.club === 0 && NO_DRIVER.has(this.lie)) sg = { club: 1, power: 1 };
      return sg;
    };
    let sg = pick(yd);
    if (lay !== null || this.target() !== this.hole.pin) return sg;
    // the run on the green depends on the club and swing, which depend on the carry: a few rounds settle it
    for (let i = 0; i < 3; i++) sg = pick(this.runUpCarry(yd, greenRoll(sg.club, sfOf(sg.power), this.lie)));
    return sg;
  }
  /**
   * What a shot toward the target that comes down `carry` yd away (the target itself without) plays like: the ground's
   * rise to where it comes down (m), the wind along it (m/s, + behind), and how much a carry has to grow (or shrink) for them.
   */
  private conditions(carry: number | null = null) {
    const [bx, bz] = this.ball;
    const [tx, tz] = this.target();
    const d = Math.hypot(tx - bx, tz - bz) || 1;
    const ux = (tx - bx) / d, uz = (tz - bz) / d;
    const reach = carry !== null ? Math.min(d, carry * YD) : d;
    const dh = this.terrain.y(bx + ux * reach, bz + uz * reach) - this.terrain.y(bx, bz);
    const wind = this.wind[0] * ux + this.wind[1] * uz;
    // a slope under the ball changes the launch, and so the carry
    const [sx, sz] = this.terrain.slope(bx, bz);
    const yaw = Math.atan2(ux, uz);
    const launch = (club: number) => slopeLie(sx, sz, yaw, club)?.launch ?? 1;
    return { dh, wind, ratio: (club: number, sf: number) => carryIn(club, sf, 0, 0) / Math.max(1, carryIn(club, sf, dh, wind, launch(club))) };
  }
  /** the distance to the pin as it plays with the suggested club (yd), or null when that is within a couple of yards of the real one */
  playsLike(): number | null {
    if (this.lie === "green" || this.lie === "fringe" || this.target() !== this.hole.pin) return null;
    const sg = this.suggested();
    const yd = this.yardsToPin();
    const sf = this.chipping() ? sfOfChip(sg.club, this.meterSuggest().power) : sfOf(sg.power);
    const plays = Math.round(yd * this.conditions().ratio(sg.club, sf));
    return Math.abs(plays - yd) >= 2.5 ? plays : null;
  }
  /** the slope under the ball, in a few words, when it is enough to matter */
  slopeSay(): string | null {
    if (this.lie === "green" || this.lie === "fringe") return null;
    const [sx, sz] = this.terrain.slope(this.ball[0], this.ball[1]);
    return slopeWords(sx, sz, this.yaw);
  }
  /** the carry (yd) that runs `run` yd on to finish at `yd`, but lands on the green (GREEN_IN past its front) */
  private runUpCarry(yd: number, run: number) {
    const front = this.greenFront();
    if (front === null) return yd;
    return Math.min(yd, Math.max(front + GREEN_IN, yd - run));
  }
  /** how far (yd) along the line to the pin the green starts, or null if it is not on the line */
  private greenFront(): number | null {
    const [px, pz] = this.hole.pin;
    const [bx, bz] = this.ball;
    const dm = Math.hypot(px - bx, pz - bz);
    for (let d = 0; d <= dm; d += YD) if (this.hole.surfaceAt(bx + ((px - bx) * d) / dm, bz + ((pz - bz) * d) / dm) === "green") return d / YD;
    return null;
  }
  /** water across the line to the target that no club carries from here: how far to lay up short of it (yd), or null */
  layUp(): number | null {
    const [tx, tz] = this.target();
    const [bx, bz] = this.ball;
    const dm = Math.hypot(tx - bx, tz - bz);
    if (dm < 1) return null;
    const sx = (tx - bx) / dm, sz = (tz - bz) / dm;
    // short of the pin, look on past the target as far as the ball rolls
    const past = this.target() === this.hole.pin ? 0 : LAY_SHORT * YD;
    let near = -1, far = -1;
    for (let d = 2; d < dm + past; d += 2) {
      const wet = this.hole.surfaceAt(bx + sx * d, bz + sz * d) === "water";
      if (wet) {
        if (near < 0) near = d;
        far = d;
      } else if (near >= 0) break;
    }
    if (near < 0) return null;
    let reach = 0;
    for (let c = NO_DRIVER.has(this.lie) ? 1 : 0; c < CLUBS.length; c++) reach = Math.max(reach, fullCarry(c) * this.carryK(c));
    if (reach >= far / YD + LAY_OVER) return null;
    return Math.max(10, near / YD - LAY_SHORT);
  }

  setClub(i: number, byPlayer = true) {
    const c = clamp(Math.round(i), 0, CLUBS.length - 1);
    if (byPlayer) this.clubChosen = true;
    if (c === this.club) return;
    this.club = c;
    this.opts.onClub?.(c);
    if (this.opts.practice === "range" && !this.challenge && byPlayer && this.phase !== "swing" && this.phase !== "fly") {
      this.setTarget(this.flagFor(c));
      this.say(`${CLUBS[c].name}, ${Math.round(fullCarry(c) * this.carryK(c))} yards. The ${TARGETS[this.rangeTarget].yd} yard flag.`);
      return;
    }
    if (byPlayer) this.say(`${CLUBS[c].name}, ${Math.round(fullCarry(c) * this.carryK(c))} yards.`);
  }
  /** nudge the aim, radians; where it points is said once the nudging stops */
  aim(d: number) {
    this.yawT = clamp(this.yawT + d, this.baseYaw() - AIM_RANGE, this.baseYaw() + AIM_RANGE);
    this.aimSayT = this.t + AIM_SAY_S;
  }
  /** the aim in words: how far left or right of the target it points, at the target's distance */
  aimWords() {
    const off = Math.round(Math.tan(this.yawT - this.baseYaw()) * this.yardsToTarget());
    return off === 0 ? "Aim straight." : `Aim ${yards(Math.abs(off))} ${off < 0 ? "left" : "right"}.`;
  }
  /** aim at a point of the hole (a tap or a drag on the map), metres */
  aimAt(x: number, z: number) {
    if (this.phase !== "ready") return;
    const dx = x - this.ball[0], dz = z - this.ball[1];
    if (Math.hypot(dx, dz) < 1) return;
    this.yawT = clamp(Math.atan2(dx, dz), this.baseYaw() - AIM_RANGE, this.baseYaw() + AIM_RANGE);
  }
  setMap(open: boolean) {
    this.mapSet = true;
    if (open === this.mapOpen) return;
    this.mapOpen = open;
    this.opts.onMap?.(open);
  }
  toggleMap() {
    this.setMap(!this.mapOpen);
    this.say(this.mapOpen ? "Map open." : "Map closed.");
  }
  /** the short game: inside CHIP_YD of the pin a drag or the meter is scaled to the distance */
  chipping() {
    return this.phase === "swing" ? this.sw.chip : this.yardsToPin() <= CHIP_YD;
  }
  /** the club and meter fraction that carry the distance to the target with the drag or the meter (suggested(), but in the chip meter's units inside 40 yd) */
  meterSuggest(): { club: number; power: number } {
    const sg = this.suggested();
    if (!this.chipping()) return sg;
    const lay = this.layUp();
    const yd0 = lay ?? this.yardsToTarget();
    const yd = yd0 * this.conditions(yd0).ratio(sg.club, sfOfChip(sg.club, 0.7));
    const k = this.carryK(sg.club);
    let power = chipPowerFor(sg.club, yd / k);
    if (lay === null && this.lie !== "bunker" && this.target() === this.hole.pin)
      for (let i = 0; i < 3; i++) power = chipPowerFor(sg.club, this.runUpCarry(yd, greenRoll(sg.club, sfOfChip(sg.club, power), this.lie)) / k);
    return { club: sg.club, power };
  }
  /** a ball on the rough or the fairway close enough to the green to putt it (not out of sand) */
  nearGreen() {
    if (this.lie !== "rough" && this.lie !== "fairway") return false;
    const sf = this.hole.surfaceAt;
    for (let r = 0.5; r <= NEAR_GREEN + 1e-9; r += 0.5) for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (sf(this.ball[0] + Math.cos(a) * r, this.ball[1] + Math.sin(a) * r) === "green") return true;
    }
    return false;
  }
  /** point the aim at once (a bot, a test) */
  setAim(yaw: number) {
    this.yawT = yaw;
    this.yaw = yaw;
  }
  private baseYaw() {
    const [tx, tz] = this.target();
    return Math.atan2(tx - this.ball[0], tz - this.ball[1]);
  }

  /** how long this hole's tee card stays up, s */
  teeCardS() {
    const k = this.opts.teeCardS;
    return typeof k === "function" ? k(this.hole.def) : (k ?? TEE_CARD_S);
  }

  private canSwing() {
    return this.phase === "ready";
  }

  // ------------------------------------------------------------ input
  /** the same keys as the range: Space (three presses, or one to speed the ball up), arrows to aim and change club */
  key(e: { key: string; shiftKey?: boolean; altKey?: boolean; repeat?: boolean }, down: boolean): boolean {
    if (this.phase === "putt") return puttKey(this.putt, e as KeyboardEvent, down, this.t, this.penv);
    const space = e.key === " " || e.key === "Enter";
    if ((e.key === "m" || e.key === "M") && !e.repeat) {
      if (down) this.toggleMap();
      return true;
    }
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
        if (this.replay) this.replay.t = this.replay.end;
        else this.restT = Math.max(this.restT, REST_HOLD);
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
    // the map: a tap or a drag on it sets the aim, and is not a swing
    const mv = this.mapView;
    if (kind === "down" && this.mapOpen && mv && this.phase === "ready" && x >= mv.x && x <= mv.x + mv.w && y >= mv.y && y <= mv.y + mv.h) {
      this.mapDrag = true;
      this.aimAt(...mv.at(x, y));
      return;
    }
    if (this.mapDrag) {
      if (kind === "up") this.mapDrag = false;
      else if (mv) this.aimAt(...mv.at(x, y));
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

  /** the aim buttons on a linked phone: the same step as the laptop's, while the next shot is being set up */
  remoteAim(dir: number) {
    if (this.phase === "ready" && dir) this.aim(Math.sign(dir) * 0.03);
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
    this.sw = { ...emptySwing(), src, sub: "back", chip: this.yardsToPin() <= CHIP_YD, tStart: this.t, x0: x, y0: y, peakY: y, xNow: x, yNow: y, xTop: x, lastL: swingLen(this.h) };
    if (src === "meter") {
      // the same mark the meter draws: only when the club in hand is the one that carries it
      const sg = this.meterSuggest();
      if (sg.club === this.club) this.sw.mark = sg.power;
    }
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
    const k = strikeNumbers({ src: s.src, peak: s.peak, x0: s.x0, xTop: s.xTop, xNow: s.xNow, lastL: s.lastL, td: this.t - s.tRev, autoFace: s.autoFace, remote: s.remote, over: s.over }, this.club, this.rng, s.chip);
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
      lie: bothLies(lieFor(this.lie, this.club), slopeLie(...this.terrain.slope(this.ball[0], this.ball[1]), this.yaw, this.club)),
      ground: this.opts.hills ? this.terrain : undefined,
      rng: this.rng,
      trees: this.hole.blockers.length ? this.hole.blockers : undefined,
      solids: solidsOf(this.hole.def.props, this.terrain),
      cup: this.hole.pin,
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
    this.strikeSay = s.src === "meter" ? meterWords(s.peak, s.over, this.timing, k.label) : "";
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
    if (this.aimSayT >= 0 && this.t >= this.aimSayT) {
      this.aimSayT = -1;
      if (this.phase === "ready") this.say(this.aimWords());
    }
    const club = CLUBS[this.club];
    const s = this.sw;
    if (this.card) this.card.t += dt;
    switch (this.phase) {
      case "tee-card":
        this.pose = blend(this.pose, poseFor({ kind: "back", u: 0 }, club), 1 - Math.exp(-5 * dt));
        if (this.phaseT >= this.teeCardS()) this.setPhase("ready");
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
        if (this.replay) {
          this.replay.t += dt;
          if (this.replay.t >= this.replay.end) {
            this.replay = null;
            this.afterRest();
          }
          break;
        }
        this.restT += dt;
        if (this.restT > 1.1) this.pose = blend(this.pose, poseFor({ kind: "back", u: 0 }, club), 1 - Math.exp(-3.5 * dt));
        if (this.trail.length) this.trail.shift();
        if (this.restT >= REST_HOLD) {
          if (this.replayNext) {
            this.replay = this.replayNext;
            this.replayNext = null;
            this.say("Replay.");
          } else this.afterRest();
        }
        break;
      case "putt": {
        puttStep(this.putt, dt, this.t, this.penv);
        // a putt that has stopped short of the cup says how far is left
        const ps = this.puttState();
        if (this.puttRolling && !ps.rolling && this.putt.strokes > this.strokes) {
          this.strokes = this.putt.strokes;
          const ft = Math.round(ps.dist * 3.281);
          this.say(ft < 1 ? "Inches from the cup." : `${feet(ft)} to the pin.`);
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
        // the meter's mark, to the ear: a tick as the backswing passes the power the shot needs
        if (s.mark && !s.marked && s.b >= s.mark) {
          s.marked = true;
          if (this.opts.sound) sfx("tick");
        }
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
      if (this.opts.sound) sfx(b.surface === "water" ? "splash" : b.surface === "bunker" || b.surface === "waste" ? "sand" : b.surface === "green" || b.surface === "fringe" ? "land" : "thud", Math.min(1, b.vy / 12 + 0.3));
    }
    if (this.shotT >= sh.restT) this.finishShot();
  }

  private finishShot() {
    const sh = this.shot!;
    const club = CLUBS[this.club];
    const e = at(sh, sh.restT);
    const end: [number, number] = [sh.ox + e[0], sh.oz + e[2]];
    const drop = dropFor(sh, sh.surface, this.hole.edgeDrop, this.hole.surfaceAt, this.hole.pin, this.hole.drops, (x, z) => Math.hypot(...this.terrain.slope(x, z)) < 0.3);
    const def = this.hole.def;
    const fromYd = this.hole.toPin(sh.ox, sh.oz) / YD;
    this.legs.push([sh.ox, sh.oz, end[0], end[1]]);
    let msg = `${club.name}: ${Math.round(sh.carry)} yards carry, ${Math.round(sh.total)} total`;
    this.dropped = !!drop;
    const tee = this.strokes === 1 && def.par > 3;
    if (tee) {
      this.stat.fairway = !drop && sh.surface === "fairway";
      this.stat.drive = drop ? null : Math.round(sh.total);
    }
    if (drop) this.stat.penalties += drop.penalty;
    this.stat.shots.push({ club: club.name, yd: Math.round(drop ? sh.carry : sh.total), pen: drop?.penalty ?? 0 });
    if (sh.holed && !drop) this.stat.holed = { by: "shot", yd: Math.round(fromYd) };
    if (drop) {
      this.ball = [drop.x, drop.z];
      this.strokes += drop.penalty;
      this.lie = this.hole.surfaceAt(drop.x, drop.z);
      this.result = DROP_CAPS[drop.why];
      msg = `${club.name}: ${Math.round(sh.carry)} yards carry. ${drop.say}`;
    } else if (sh.holed) {
      this.ball = [...this.hole.pin];
      this.lie = "green";
      this.holedOut = true;
      this.result = "IN THE HOLE";
      msg += ". In the hole.";
      if (this.opts.sound) {
        sfx("cup");
        sfx("applause", 1);
      }
    } else if (this.challenge && !this.challenge.done) {
      // the challenge's flag, however near another one it finished
      this.ball = end;
      this.lie = sh.surface;
      const ch = this.challenge;
      const tg = TARGETS[this.rangeTarget];
      const d = Math.hypot(end[0] - tg.gx, end[1] - tg.gz);
      const on = d <= tg.gr && sh.surface === "green";
      const ft = Math.round(d * 3.281);
      const pts = ch.kind === "targets" ? targetPoints(d, Math.hypot(tg.gx, tg.gz), on) : 0;
      ch.results.push({ flag: this.rangeTarget, ft, on, pts });
      ch.score += pts;
      ch.best = ch.best === null ? ft : Math.min(ch.best, ft);
      const where = ft < 300 ? feet(ft) : yards(Math.round(d / YD));
      this.result = ch.kind === "targets" ? `${on ? "ON THE GREEN · " : ""}${ft < 300 ? `${ft} FT` : `${Math.round(d / YD)} YD`} · +${pts}` : `${ft < 300 ? `${ft} FT` : `${Math.round(d / YD)} YD`} FROM THE PIN`;
      msg += `${on ? ", on the green" : ""}. ${where} from the pin.`;
      msg += ch.kind === "targets" ? ` Plus ${pts}. Score ${ch.score}.` : ft === ch.best && ch.results.length > 1 ? " Your closest yet." : "";
    } else if (this.opts.practice === "range") {
      this.ball = end;
      this.lie = sh.surface;
      const near = nearestTarget(end);
      const t = TARGETS[near.i];
      const on = sh.surface === "green" || sh.surface === "fringe";
      const ft = Math.round((near.d / YD) * 3);
      this.result = on ? `${t.yd} GREEN · ${ft} FT` : `${Math.round(near.d / YD)} YD FROM THE ${t.yd}`;
      msg += on ? `, on the ${t.yd} yard green, ${feet(ft)} from the flag.` : `. ${yards(Math.round(near.d / YD))} from the ${t.yd} yard flag.`;
    } else {
      this.ball = end;
      this.lie = sh.surface;
      const toPin = this.yardsToPin();
      const ft = Math.round(toPin * 3);
      this.result = `${LIE_CAPS[sh.surface] ?? ""} · ${sh.surface === "green" || sh.surface === "fringe" ? `${ft} FT` : `${Math.round(toPin)} YD`} TO GO`;
      msg += `, ${LIE_WORDS[sh.surface] ?? ""}. ${sh.surface === "green" || sh.surface === "fringe" ? feet(ft) : yards(Math.round(toPin))} to the pin.`;
    }
    this.say(`${sh.tree ? `${msg} Hit a tree.` : sh.prop ? `${msg} Hit ${PROP_WORDS[sh.prop.kind]}.` : msg}${this.strikeSay}`);
    // a great one is played again
    this.replay = this.replayNext = null;
    if (this.opts.replays && !this.opts.practice && !drop) {
      const why: Replay["why"] | null = sh.holed ? "holed" : this.yardsToPin() <= CLOSE_YD && fromYd >= CLOSE_FROM_YD ? "close" : tee && sh.total >= LONG_YD ? "long" : null;
      if (why) {
        const end = sh.restT + (why === "holed" ? 1.2 : 0.7);
        // the end of the flight and what it did on the ground, never more than REPLAY_MAX_S
        this.replayNext = { shot: sh, t: Math.max(why === "long" ? sh.apexT * 0.5 : sh.landT - 1.5, end - REPLAY_MAX_S, 0), end, why };
      }
    }
    this.setPhase("rest");
    this.restT = 0;
    this.fast = false;
    // five over: the ball is picked up
    if (shouldPickUp(this.strokes, def.par)) {
      this.restT = REST_HOLD - 0.4;
    }
  }

  private afterRest() {
    if (this.opts.practice === "range") {
      this.balls++;
      const ch = this.challenge;
      if (ch && ch.results.length >= ch.shots) {
        ch.done = true;
        this.setPhase("round-card");
        this.say(ch.kind === "targets" ? `Targets over: ${ch.score} points.` : `Closest to the pin over: your best was ${feet(ch.best ?? 0)}.`);
        return;
      }
      if (ch?.kind === "targets") this.rangeTarget = this.pickFlag(this.rangeTarget);
      return this.nextBall();
    }
    const def = this.hole.def;
    if (this.holedOut) {
      this.holedOut = false;
      return this.holeDone(this.strokes, false);
    }
    if (shouldPickUp(this.strokes, def.par)) return this.holeDone(this.strokes, true);
    if (this.lie === "green" || this.lie === "fringe" || this.nearGreen()) {
      const [gx, gy] = this.hole.toGreen(this.ball[0], this.ball[1]);
      this.puttRolling = false;
      this.puttFrom = this.strokes;
      this.stat.gir = this.strokes <= def.par - 2 && (this.lie === "green" || this.lie === "fringe");
      puttBegin(this.putt, this.hole.green, [gx, gy], this.strokes, { pickUp: def.par + PICK_UP_OVER, onDone: (s, up) => this.holeDone(s, up) }, this.t, this.opts.reduce);
      this.setPhase("putt");
      return;
    }
    this.prepareShot(false);
    this.setPhase("ready");
    this.say(`${CLUBS[this.club].name}.`);
  }

  private holeDone(played: number, pickedUp: boolean) {
    const def = this.hole.def;
    const hs = holeScore(played, def.par, pickedUp);
    this.scores.push(hs);
    this.stat.putts = this.puttFrom >= 0 ? Math.max(0, played - this.puttFrom) : 0;
    if (pickedUp) this.stat.holed = null;
    else if (this.stat.putts > 0) this.stat.holed = { by: "putt", ft: Math.max(1, Math.round(this.putt.from / 0.3048)) };
    this.stats.push(this.stat);
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

function newStat(): HoleStat {
  return { fairway: null, gir: false, putts: 0, drive: null, penalties: 0, shots: [], holed: null };
}

/** the range's target nearest a point (metres): its index and how far, m */
function nearestTarget([x, z]: [number, number]) {
  let i = 0, d = Infinity;
  TARGETS.forEach((t, k) => {
    const e = Math.hypot(t.gx - x, t.gz - z);
    if (e < d) [i, d] = [k, e];
  });
  return { i, d };
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
