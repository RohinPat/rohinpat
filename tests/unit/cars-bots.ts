import { NO_INPUT, type NightInput } from "@/components/offhours/engineRemote";
import { NightGame, forgetBestRun } from "@/components/offhours/night/game";
import { getTarget } from "@/components/offhours/night/target";
import { drive, planSpeed } from "@/components/offhours/night/ai";
import { newKeyAxes, stepKeys } from "@/components/offhours/night/nightInput";

// Scripted keyboard drivers for the tests (and for the numbers in the PR). They drive the real NightGame through the real
// keyboard functions (night/nightInput.ts: the steering that firms up with speed, the gas and brake that ramp), at 60 Hz,
// with a seeded random hand: a slow wander in the steering, taps in proportion, a late foot on the pedals.

export type Bot = {
  name: string;
  /** share of the plan's speed it drives at (gas-only ignores) */
  pace: number;
  gasOnly?: boolean;
  /** does it steer (to the racing line) */
  steer?: boolean;
  /** brake when the corner warning is lit */
  cueBrake?: boolean;
  /** ignores the road: floors it and brakes only for the warning */
  cueOnly?: boolean;
  /** handbrake into corners tighter than this curvature (0 = never) */
  flickK?: number;
  flickS?: number;
  flickCool?: number;
  /** reaction delay (s), steering noise, pace jitter */
  react?: number;
  noise?: number;
  /** drive with centre line instead of racing line */
  centre?: boolean;
  /** the tapping period, s */
  pwm?: number;
  /** change gear by hand: up at this many rpm, down at 3,300 */
  manualUp?: number;
  /** and down at this many rpm (default 3,300) */
  manualDown?: number;
  /** by hand, with the handbrake flick: downshift as well (the clutch kick with the handbrake held) */
  kickWithHand?: boolean;
  /** by hand, no handbrake: downshift into corners tighter than this curvature at this speed or more, steering into them (a clutch kick) */
  kickK?: number;
  kickS?: number;
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RunStat = {
  bot: string;
  finished: boolean;
  time: number;
  score: number;
  medals: number;
  hits: number;
  cp: number;
  metres: number;
  crashes: number[];
  gateLeft: number[];
  drift: number;
  rails: number;
  clean: number;
  spins: number;
  cueFrac: number;
  unwarned: number;
  cues: number;
  bestDrift: number;
  timeLeftEnd: number;
  firstHitS: number | null;
};

const DT = 1 / 60;

export function playRun(bot: Bot, seed = 1, setup?: (g: NightGame) => void): RunStat {
  forgetBestRun();
  const R = rng(seed * 7919 + 13);
  const g = new NightGame(true);
  setup?.(g);
  const plan = getTarget().plan;
  const ai: NightInput = { ...NO_INPUT };
  const inp: NightInput = { steer: 0, throttle: 1, brake: 0, hand: 0 };
  const axes = newKeyAxes();
  let handUntil = -1;
  let kickUntil = -1;
  let kickedFlick = false;
  let cool = 0;
  const lag = Math.round((bot.react ?? 0) / DT);
  const q: { dir: number; gas: boolean; brake: boolean; hand: boolean }[] = [];
  const crashes: number[] = [];
  let lastHit = 0;
  const gateLeft: number[] = [];
  let cueFrames = 0, runFrames = 0, lastCue = -99, unwarned = 0, lastRails = 0, cues = 0, wasCue = false;
  let lastCp = 0;
  const paceJ = 1 + (R() - 0.5) * 0.12;
  let phase = R();
  let steerBias = 0;
  let bias = 0;
  if (bot.manualUp) g.setAuto(false);
  g.start();
  for (let i = 0; i < 60 * 300 && g.phase !== "done"; i++) {
    if (g.phase === "run") {
      const c = g.car;
      const v = Math.max(1, Math.hypot(c.u, c.w));
      if (bot.manualUp) {
        if (c.rpm > bot.manualUp && c.gear < 5) g.shift(1);
        // down at 3,300 (but not into a handbrake slide, which is a kick: only a driver who means it does that)
        else if (c.rpm < (bot.manualDown ?? 3300) && c.gear > 0 && (bot.kickWithHand || (g.clock >= handUntil && c.hand < 0.5))) g.shift(-1);
      }
      let dir = 0;
      let gas = true;
      let brake = false;
      let hand = false;
      if (bot.steer) {
        drive(c, g.road, plan, 1, ai);
        // wander: a slow random walk added to what the steering wants
        if (bot.noise) {
          bias += (R() - 0.5) * bot.noise * 0.2;
          bias *= 0.985;
          steerBias = bias;
        }
        let want = ai.steer + steerBias;
        if (bot.centre) want = -c.lat * 0.08 - c.psi * 1.5;
        // a person taps in proportion: the key is down for a share of each tenth of a second
        phase += DT / (bot.pwm ?? 0.14);
        if (phase >= 1) phase -= 1;
        const a = Math.min(1, Math.abs(want));
        dir = a > 0.06 && phase < Math.min(1, a * 1.3 + 0.12) ? Math.sign(want) : 0;
      }
      if (bot.cueOnly) {
        gas = true;
        brake = false;
        if (g.cue.on) {
          gas = false;
          brake = v > 12;
        }
      } else if (!bot.gasOnly) {
        const target = planSpeed(plan, g.road, c.s + 0.25 * v) * bot.pace * paceJ;
        const e = target - v;
        gas = e > -0.5;
        brake = e < -2;
        if (bot.cueBrake && g.cue.on) {
          gas = false;
          brake = v > 12;
        }
      }
      if (bot.flickK) {
        cool -= DT;
        const k = g.road.kappa[Math.round((c.s + 40) / g.road.segM)] || 0;
        if (cool <= 0 && Math.abs(k) > bot.flickK && v > (bot.flickS ?? 24)) {
          handUntil = g.clock + 0.32;
          cool = bot.flickCool ?? 3;
        }
        if (g.clock < handUntil) {
          hand = true;
          gas = true;
          brake = false;
          dir = Math.sign(k || 1);
          // the handbrake is on (the car sees it from the next step): downshift into the slide
          if (bot.kickWithHand && bot.manualUp && !kickedFlick && c.hand > 0.5 && c.gear > 0) {
            g.shift(-1);
            kickedFlick = true;
          }
        } else kickedFlick = false;
      }
      if (bot.kickK && bot.manualUp) {
        cool -= DT;
        const k = g.road.kappa[Math.round((c.s + 40) / g.road.segM)] || 0;
        if (cool <= 0 && Math.abs(k) > bot.kickK && v > (bot.kickS ?? 30) && c.gear > 0 && !bot.flickK) {
          kickUntil = g.clock + 0.4;
          cool = 1.5;
          g.shift(-1);
        }
        if (g.clock < kickUntil) {
          gas = true;
          brake = false;
          dir = Math.sign(k || 1);
        }
      }
      q.push({ dir, gas, brake, hand });
      const d = q.length > lag ? q[q.length - 1 - lag] : q[0];
      // only the pedals lag (a person anticipates the steering, but decides to brake late)
      stepKeys(axes, { dir, gas: d.gas, brake: d.brake }, v, DT);
      inp.steer = axes.steer;
      inp.throttle = axes.gas;
      inp.brake = axes.brake;
      inp.hand = d.hand ? 1 : 0;
      runFrames++;
      if (g.cue.on) {
        cueFrames++;
        lastCue = g.clock;
        if (!wasCue) cues++;
      }
      wasCue = g.cue.on;
      if (g.rails > lastRails) {
        if (g.clock - lastCue > 3) unwarned++;
        lastRails = g.rails;
      }
      if (g.cp > lastCp) {
        gateLeft.push(+g.timeLeft.toFixed(0));
        lastCp = g.cp;
      }
      if (g.hitN > lastHit) {
        crashes.push(Math.round(c.s));
        lastHit = g.hitN;
      }
    } else {
      inp.throttle = 1;
      inp.steer = 0;
      inp.brake = 0;
      inp.hand = 0;
      axes.gas = 1;
    }
    g.update(DT, inp);
  }
  const r = g.result;
  const out: RunStat = {
    bot: bot.name,
    finished: r?.finished ?? false,
    time: +(r?.time ?? g.clock).toFixed(1),
    score: g.score,
    medals: r?.medals ?? 0,
    hits: g.hitN,
    cp: g.cp,
    metres: Math.round(r?.metres ?? 0),
    crashes,
    gateLeft,
    drift: Math.round(g.drift.total),
    rails: g.rails,
    clean: g.cleanLegs,
    spins: g.spins,
    cueFrac: +(cueFrames / Math.max(1, runFrames)).toFixed(3),
    unwarned,
    cues,
    bestDrift: r?.bestDrift ?? 0,
    timeLeftEnd: +g.timeLeft.toFixed(1),
    firstHitS: crashes[0] ?? null,
  };
  forgetBestRun();
  return out;
}

export const BOTS: Bot[] = [
  { name: "gas-only", pace: 9, gasOnly: true },
  { name: "gas+steer", pace: 9, gasOnly: true, steer: true, react: 0.15, noise: 0.2 },
  { name: "cue-only", pace: 9, steer: true, cueOnly: true, react: 0.25, noise: 0.2 },
  { name: "cautious", pace: 0.78, steer: true, cueBrake: true, react: 0.2, noise: 0.2 },
  { name: "decent", pace: 0.88, steer: true, flickK: 1 / 150, flickCool: 2.5, react: 0.15, noise: 0.2 },
  { name: "precise", pace: 0.95, steer: true, flickK: 1 / 330, flickCool: 0.8, flickS: 18, react: 0, noise: 0, pwm: 0.07 },
  { name: "drifter", pace: 1.0, steer: true, flickK: 1 / 300, flickCool: 1.2, flickS: 20, react: 0.1, noise: 0.2 },
  // the same drivers by hand: up in the green window (7,300 to the limiter), a good shift; early and late are not
  { name: "decent-manual", pace: 0.88, steer: true, flickK: 1 / 150, flickCool: 2.5, react: 0.15, noise: 0.2, manualUp: 7350 },
  { name: "decent-early", pace: 0.88, steer: true, flickK: 1 / 150, flickCool: 2.5, react: 0.15, noise: 0.2, manualUp: 6400 },
  { name: "decent-late", pace: 0.88, steer: true, flickK: 1 / 150, flickCool: 2.5, react: 0.15, noise: 0.2, manualUp: 7990 },
  { name: "drifter-manual", pace: 1.0, steer: true, flickK: 1 / 300, flickCool: 1.2, flickS: 20, react: 0.1, noise: 0.2, manualUp: 7350 },
  { name: "drifter-kick", pace: 1.0, steer: true, flickK: 1 / 300, flickCool: 1.2, flickS: 20, react: 0.1, noise: 0.2, manualUp: 7350, kickWithHand: true },
  // the automatic box with the same corners and the handbrake: what the clutch kick is measured against
  { name: "flicker", pace: 1.0, steer: true, flickK: 1 / 300, flickS: 28, flickCool: 1.5, react: 0.1, noise: 0.2 },
  { name: "kicker", pace: 1.0, steer: true, kickK: 1 / 300, kickS: 28, react: 0.1, noise: 0.2, manualUp: 7350 },
];

export function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { avg: Math.round(avg), min: s[0], p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}
