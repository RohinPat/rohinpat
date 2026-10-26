// A phone's twist, turned into the throttle the race dash takes. Pure, so it is
// unit-tested; every constant that real hands will need tuning is in ENGINE_CAL,
// here and nowhere else.
//
// The phone runs the twist recogniser (lib/motion/twist.ts) and integrates its
// angular velocity into a throttle position: turn clockwise to open it, turn
// back to close it, like a motorbike grip. The position stops at the ends (it
// does not wind up past idle or full, so there is nothing to unwind), and the
// phone sends it as the `throttle` axis, 0..1. The dash then treats it as a
// pedal that can be part way down.

export const ENGINE_CAL = {
  /** clockwise wrist turn that is full throttle, degrees (a comfortable one-handed wrist roll) */
  fullTwistDeg: 60,
  /** below this much turn it is still idle, so a resting hand does not rev, degrees */
  idleDeadDeg: 5,
  /** the dash smooths the phone's throttle with this time constant, seconds */
  smoothS: 0.05,
  /** at most this many axis messages a second, and only when the value moved this much (0..1) */
  sendHz: 30,
  minStep: 0.01,
  /** a pedal above this counts as "the throttle is held" (stages the car, loads the engine note) */
  throttleOn: 0.04,
  /** the dash tells the phone its rpm, gear and shift light this often at most, ms */
  stateEveryMs: 100,
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Read the `throttle` axis value: 0..1, or 0 for junk. */
export function parseThrottle(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0;
}

/** A throttle position from a twist's angular velocity (rad/s, clockwise positive). */
export function createThrottleTrack(cal = ENGINE_CAL) {
  let deg = 0;
  const value = () => clamp((deg - cal.idleDeadDeg) / (cal.fullTwistDeg - cal.idleDeadDeg), 0, 1);
  return {
    /** add `dt` seconds of turning at `omega`; returns the throttle, 0..1 */
    push(omega: number, dt: number): number {
      deg = clamp(deg + (omega * dt * 180) / Math.PI, 0, cal.fullTwistDeg);
      return value();
    },
    /** put the throttle at idle (a button, or a fresh start) */
    zero() {
      deg = 0;
    },
    /** put the throttle somewhere, 0..1 */
    set(v: number) {
      deg = cal.idleDeadDeg + clamp(v, 0, 1) * (cal.fullTwistDeg - cal.idleDeadDeg);
      if (v <= 0) deg = 0;
    },
    value,
    deg: () => deg,
  };
}

/** Move `current` toward `target` over `dt` seconds with time constant `tau` (the dash's pedal smoothing). */
export function pedalStep(current: number, target: number, dt: number, tau = ENGINE_CAL.smoothS): number {
  if (tau <= 0) return target;
  const next = current + (target - current) * (1 - Math.exp(-dt / tau));
  return Math.abs(next - target) < 0.002 ? target : next;
}

/** How fast the revs climb (rpm/s) with the pedal `p` part way down: `fall` closed, `rise` flat out, straight between. */
export function rpmRate(p: number, rise: number, fall: number): number {
  return -fall + (rise + fall) * clamp(p, 0, 1);
}

/**
 * Rate-limits a stream of throttle values for the wire: sends on change (at
 * least `minStep`, or any move onto exactly idle or full), at most `sendHz`.
 * Call `push` on every new value and `flush` when the input lets go.
 */
export function createAxisSender(emit: (v: number) => void, cal = ENGINE_CAL, now: () => number = () => performance.now()) {
  let sent = 0;
  let lastAt = -Infinity;
  const go = (v: number) => {
    sent = v;
    lastAt = now();
    emit(v);
  };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    push(v: number) {
      const x = r2(clamp(v, 0, 1));
      if (x === sent) return;
      const ends = x === 0 || x === 1;
      if (Math.abs(x - sent) < cal.minStep && !ends) return;
      if (now() - lastAt < 1000 / cal.sendHz) return;
      go(x);
    },
    flush(v: number) {
      const x = r2(clamp(v, 0, 1));
      if (x !== sent) go(x);
    },
    /** the last value sent */
    last: () => sent,
    /** forget what was sent (a new connection starts from idle) */
    reset() {
      sent = 0;
      lastAt = -Infinity;
    },
  };
}

export type EnginePhase = "idle" | "tree" | "run" | "done";

/** What the dash tells the phone ("engine-state"): enough for its gear, rpm and shift light. */
export type EngineView = { rpm: number; gear: number; phase: EnginePhase; shift: boolean; call: string; time: number };

export const IDLE_VIEW: EngineView = { rpm: 900, gear: 0, phase: "idle", shift: false, call: "", time: 0 };

export function engineStateData(v: EngineView): Record<string, number | string | boolean> {
  return { rpm: Math.round(v.rpm / 50) * 50, gear: v.gear, phase: v.phase, shift: v.shift, call: v.call, time: Math.round(v.time * 100) / 100 };
}

const PHASES: EnginePhase[] = ["idle", "tree", "run", "done"];

/** Read an "engine-state" gesture's data, or null if it isn't one. */
export function parseEngineState(data: Record<string, number | string | boolean> | undefined): EngineView | null {
  if (!data) return null;
  const rpm = Number(data.rpm);
  const gear = Number(data.gear);
  const phase = String(data.phase) as EnginePhase;
  if (!Number.isFinite(rpm) || !Number.isInteger(gear) || gear < 0 || gear > 9 || !PHASES.includes(phase)) return null;
  const time = Number(data.time);
  return { rpm: clamp(rpm, 0, 12000), gear, phase, shift: data.shift === true, call: typeof data.call === "string" ? data.call.slice(0, 24) : "", time: Number.isFinite(time) ? time : 0 };
}
