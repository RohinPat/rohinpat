import { DEFAULT_CONDS, freshCar, launchBand, shiftUp, stepDrag, type DragCar, type DragConds } from "@/components/offhours/dragModel";
import { SHIFT_AT } from "@/components/offhours/engineModel";

export type DragBot = {
  name: string;
  /** the revs it holds while the tree counts, by tapping the key (a number is read off the mark: the set's sweet spot, plus this much) */
  holdRpm: number | "hold";
  /** a bot that does not read the mark holds this absolute rev whatever the set */
  fixedRpm?: boolean;
  /** shift when the revs reach this */
  shiftRpm: number;
  /** its reaction to a shift light, s (random up to) */
  shiftLag?: number;
  /** let go at the green and press again this long after */
  lateS?: number;
  /** key tap latency, s */
  tapLag?: number;
  /** a person wanders around the rev they aim for */
  wobble?: number;
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

export type DragRun = { reaction: number | null; sixtyFt: number | null; shifts: string; bot: string; et: number; trap: number; s60: number; launch: string; launchRpm: number; perfect: number; calls: string[]; car: DragCar };

const DT = 1 / 120;
export function runDrag(bot: DragBot, seed: number, mk: () => DragCar = freshCar, pre?: (c: DragCar) => void, cond: DragConds = DEFAULT_CONDS): DragRun {
  const R = rng(seed * 104729 + 7);
  const c = mk();
  c.cond = cond;
  pre?.(c);
  const path: number[] = [];
  let t = 0;
  let greenAt = -1;
  let lateUntil = -1;
  const calls: string[] = [];
  let shiftDue = -1;
  // a bot that holds a number reads the mark: its aim is that, measured from the set's sweet spot (4900 on the default one)
  const aim = typeof bot.holdRpm === "number" ? bot.holdRpm + (bot.fixedRpm ? 0 : launchBand(cond).sweet - launchBand(DEFAULT_CONDS).sweet) + (R() - 0.5) * 2 * (bot.wobble ?? 0) : 0;
  const keyQ: boolean[] = [];
  const lag = Math.round((bot.tapLag ?? 0) / DT);
  let lastPhase = c.phase;
  for (let i = 0; i < 120 * 40 && c.phase !== "done"; i++) {
    let want = true;
    if (c.phase === "idle") want = true;
    else if (c.phase === "tree") want = bot.holdRpm === "hold" ? true : c.rpm < aim;
    else if (c.phase === "run") {
      want = true;
      if (bot.lateS && greenAt >= 0 && t < lateUntil) want = false;
    }
    if (c.phase === "run" && lastPhase !== "run") {
      greenAt = t;
      if (bot.lateS) lateUntil = t + bot.lateS;
      if (bot.lateS) want = false;
    }
    lastPhase = c.phase;
    keyQ.push(want);
    const d = keyQ.length > lag ? keyQ[keyQ.length - 1 - lag] : keyQ[0];
    c.throttle = d;
    c.pedal = d ? 1 : 0;
    if (c.phase === "run" && c.shiftT <= 0 && c.rpm >= bot.shiftRpm && shiftDue < 0) shiftDue = t + (bot.shiftLag ?? 0) * R();
    if (c.phase === "run" && shiftDue >= 0 && t >= shiftDue) {
      shiftDue = -1;
      if (shiftUp(c, t)) calls.push(c.call);
    }
    stepDrag(c, DT, t, path, {}, R);
    t += DT;
  }
  return { reaction: c.reaction, sixtyFt: c.sixtyFt, shifts: JSON.stringify(c.shifts), bot: bot.name, et: +c.t.toFixed(2), trap: Math.round(c.trap), s60: +(c.split60 ?? 0).toFixed(2), launch: c.launch, launchRpm: Math.round(c.launchRpm), perfect: c.perfect, calls, car: c };
}

export const DRAG_BOTS: DragBot[] = [
  { name: "perfect", holdRpm: 4900, shiftRpm: SHIFT_AT + 50 },
  { name: "good (human)", holdRpm: 4900, wobble: 700, tapLag: 0.04, shiftRpm: SHIFT_AT - 100, shiftLag: 0.12 },
  { name: "sloppy launch", holdRpm: 3700, wobble: 600, tapLag: 0.08, shiftRpm: SHIFT_AT - 100, shiftLag: 0.15 },
  { name: "hold throttle", holdRpm: "hold", shiftRpm: SHIFT_AT + 50 },
  { name: "bogged", holdRpm: 2800, shiftRpm: SHIFT_AT + 50 },
  { name: "early shifts", holdRpm: 4900, shiftRpm: 5800 },
  { name: "late shifts", holdRpm: 4900, shiftRpm: 7900, shiftLag: 0.3 },
  { name: "misses green .3", holdRpm: 4900, shiftRpm: SHIFT_AT + 50, lateS: 0.3 },
  { name: "misses green .6", holdRpm: 4900, shiftRpm: SHIFT_AT + 50, lateS: 0.6 },
];
