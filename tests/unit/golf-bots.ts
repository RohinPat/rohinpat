import { CourseGame, STEP } from "@/components/offhours/golf/play";
import { puttPowerFor } from "@/components/offhours/golf/green";
import { forgetBest } from "@/components/offhours/golf/score";

// Scripted players for the course (and the numbers in the PR). They drive the real CourseGame at 60 Hz through the
// same entry points a visitor uses (Space, a phone's swing, the putt's release), with a seeded hand: the aim and the
// power wander by a set amount, and nothing looks at the hole but what a player would see.

export type Bot = {
  name: string;
  /** aim noise, radians (1 sigma) */
  aim: number;
  /** power noise, share of the swing (1 sigma) */
  power: number;
  /** takes the suggested club and the suggested swing (false: one button, Space and wait) */
  skilled: boolean;
  /** never does anything */
  idle?: boolean;
  /** plays the three presses of Space: the power by watching the meter, the line by a press that is off by this many seconds (1 sigma) */
  keys?: number;
};

export const BOTS: Record<string, Bot> = {
  skilled: { name: "skilled", aim: 0.03, power: 0.08, skilled: true },
  oneButton: { name: "one-button", aim: 0, power: 0, skilled: false },
  idle: { name: "idle", aim: 0, power: 0, skilled: false, idle: true },
  /** the keyboard's own swing, played well: Space, Space at the suggested power, Space on the line (40 ms off) */
  keyboard: { name: "keyboard", aim: 0.03, power: 0.05, skilled: false, keys: 0.04 },
};

function hand(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

export type RoundStat = {
  bot: string;
  seed: number;
  /** strokes per hole, as scored */
  holes: number[];
  pars: number[];
  total: number;
  par: number;
  finished: boolean;
  /** game seconds */
  seconds: number;
  shots: number;
  pickedUp: number;
};

/** play a round (or give up after `maxSeconds` of game time) */
export function playRound(bot: Bot, seed: number, opts: { maxSeconds?: number } = {}): RoundStat {
  forgetBest();
  const g = new CourseGame({ seed });
  const rnd = hand(seed * 7919 + bot.name.length);
  const max = opts.maxSeconds ?? 900;
  let shots = 0;
  let holding = 0;
  let wasPutt = false;
  const key = (k: string, down = true) => g.key({ key: k }, down);
  let kb = 0;
  let kbPower = 0;
  let kbLate = 0;
  while (g.t < max && !g.finished) {
    if (bot.idle) {
      g.step(STEP);
      continue;
    }
    switch (g.phase) {
      case "tee-card":
        key(" ");
        break;
      case "swing": {
        if (!bot.keys) break;
        const sw = g.sw;
        if (kb === 1 && sw.sub === "back" && sw.b >= kbPower) {
          key(" ");
          kb = 2;
        } else if (kb === 2 && sw.sub === "down" && sw.dur - sw.t <= -kbLate) {
          key(" ");
          kb = 0;
        }
        break;
      }
      case "ready": {
        shots++;
        if (bot.keys) {
          g.setAim(g.yawT + gauss(rnd) * bot.aim);
          kbPower = Math.max(0.1, Math.min(1.1, g.suggested().power * (1 + gauss(rnd) * bot.power)));
          kbLate = gauss(rnd) * bot.keys;
          key(" ");
          kb = 1;
          break;
        }
        const sg = g.suggested();
        if (bot.skilled) {
          g.setAim(g.yawT + gauss(rnd) * bot.aim);
          const power = Math.max(0.05, Math.min(1.1, sg.power * (1 + gauss(rnd) * bot.power)));
          g.remoteSwing({ power, face: 0, curve: 0, contact: 1 });
        } else {
          // one button: Space, then wait (the club goes over the top on its own)
          key(" ");
        }
        break;
      }
      case "putt": {
        const ps = g.puttState();
        if (!wasPutt) holding = 0;
        wasPutt = true;
        if (ps.rolling) break;
        const a = Math.atan2(ps.cup[1] - ps.ball[1], ps.cup[0] - ps.ball[0]);
        // roll it a little past the cup, as a putter does
        const want = puttPowerFor(ps.dist + 0.3);
        if (bot.skilled || bot.keys) {
          g.puttShoot(a + gauss(rnd) * bot.aim, Math.max(0.03, want * (1 + gauss(rnd) * bot.power)));
        } else {
          // Space held until the meter reads the power it wants (the aim is already at the cup)
          if (holding === 0) {
            key(" ");
            holding = 1;
          } else if (g.putt.kPower >= want) {
            key(" ", false);
            holding = 0;
          }
        }
        break;
      }
      case "hole-card":
        wasPutt = false;
        key(" ");
        break;
      default:
        break;
    }
    // the card guard: a press too soon is ignored, so keep stepping
    g.step(STEP);
  }
  return {
    bot: bot.name,
    seed,
    holes: g.scores.map((s) => s.strokes),
    pars: g.defs.map((d) => d.par),
    total: g.scores.reduce((a, b) => a + b.strokes, 0),
    par: g.defs.reduce((a, b) => a + b.par, 0),
    finished: g.finished,
    seconds: g.t,
    shots,
    pickedUp: g.scores.filter((s) => s.pickedUp).length,
  };
}

export function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}
