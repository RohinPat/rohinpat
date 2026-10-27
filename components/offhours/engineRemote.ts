// The Cars piece's tunables and its phone wiring. Pure, so it is unit-tested;
// every constant that real hands (or a real laptop) will need tuning is in
// ENGINE_CAL, here and nowhere else.
//
// Drag strip. The phone runs the twist recogniser (lib/motion/twist.ts) and
// integrates its angular velocity into a throttle position: turn clockwise to
// open it, turn back to close it, like a motorbike grip. The position stops at
// the ends (it does not wind up past idle or full, so there is nothing to
// unwind), and the phone sends it as the `throttle` axis, 0..1.
//
// Night run. The phone is a steering wheel (lib/motion/wheel.ts, the same
// filter as the slalom's handlebars) with a gas pad under the right thumb and
// a brake pad under the left. It sends four axes, on change and 30 Hz at most:
//   steer -1..1   gas 0..1   brake 0..1   hand 0..1 (the handbrake button)
// plus gestures: night-handbrake {ms} (a flick), night-shift {dir}, night-auto
// {on}, night-again. The laptop answers with night-state (speed, gear, drift
// combo, checkpoint clock, and two counters the phone buzzes on) and
// engine-mode (which of the two modes is up, so the phone shows the right
// controller).

export const ENGINE_CAL = {
  // ---------------------------------------------------------------- drag strip
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

  // ------------------------------------------------- the engine (both modes)
  engine: {
    /** gear ratios, first to sixth, and the final drive */
    ratios: [3.4, 2.15, 1.55, 1.2, 0.97, 0.82],
    final: 3.55,
    /** driven wheel radius, m */
    wheelM: 0.33,
    idle: 900,
    /** the shift light, the red line and the rev limiter, rpm */
    shiftAt: 7300,
    redline: 7800,
    limit: 8000,
  },
  /** the automatic gearbox: shift points slide with how far down the pedal is (rpm), and it will not shift twice inside holdS */
  gearbox: {
    upRpmLight: 4700,
    upRpmFull: 7000,
    downRpmLight: 2300,
    downRpmFull: 3500,
    /** torque is cut this long during a shift, s, and the next shift waits this long */
    cutS: 0.11,
    holdS: 0.5,
    /** braking in a low-revving gear drops a gear when it is safe to (the engine brakes into the corner) */
    brakeDownRpm: 4300,
  },

  // ------------------------------------------------------------- night run: the car
  car: {
    massKg: 1300,
    wheelbaseM: 2.6,
    /** centre of gravity to the front axle, m (past halfway: a little more weight on the rear, so the tail is the light end) */
    cgFrontM: 1.34,
    yawInertia: 1900,
    cgHeightM: 0.5,
    /** tyre cornering stiffness per axle, N per radian of slip */
    tyreStiffness: 82000,
    /** peak grip, in g, and how much more there is at speed (downforce, per (m/s)^2) */
    gripG: 1.28,
    downforce: 0.00005,
    /** rear grip as a share of the front's: under 1 and the tail is the one that goes first */
    rearGrip: 0.97,
    /** how far grip falls off past the peak slip angle (0 = a flat plateau, easy; 0.3 = snappy) */
    fallOff: 0.05,
    /** engine power seen by the wheels (1 = the drag strip's 600 hp), and the air and the road holding it back */
    powerScale: 0.66,
    dragC: 0.5,
    rollingN: 190,
    /** how much of the drive force counts against the rear's sideways grip (1 = the full friction circle: power oversteer at any throttle; lower is more forgiving) */
    powerSlide: 0.6,
    /** brakes: total force, N, and the share the front takes */
    brakeN: 12500,
    brakeFront: 0.68,
    /** weight transfer under braking and lifting, scaled up from real so a lift tips the tail out */
    loadTransfer: 0.85,
    /** handbrake: the rear keeps this share of its grip, loses this much speed (N), and gets this kick of yaw (N m) toward the steer */
    handbrakeGrip: 0.5,
    handbrakeN: 3600,
    handbrakeKick: 9000,
    /** steering: full lock at a stand, rad; the speed at which it has halved, m/s; how fast the wheels turn, rad/s */
    steerLockRad: 0.52,
    steerHalfMs: 13,
    steerRate: 7,
    /** the road turns the wheel this share of the way round its own corner (0 = all on you), so the steering is for the line and the slide */
    roadAssist: 0.85,
    /** the stability help: it counter-steers this share of the way (0 = none) by the slip angle, to most this many rad, and damps yaw (N m s) */
    assist: 1.2,
    assistMaxRad: 0.6,
    /** it leaves the first few degrees of slide alone (rad), so the tail can come out before it catches it */
    assistDeadRad: 0.1,
    yawDamp: 1800,
    /** past this slide angle (rad) the nose is pulled back toward the direction of travel with this torque per radian over (N m): wide slides are caught, the usual ones are left alone */
    rescueRad: 0.5,
    rescueNm: 16000,
    /** the fastest the car may spin, rad/s */
    yawCap: 1.7,
    /** in a slide the lock opens up to this (rad), so there is room to counter-steer */
    steerSlideRad: 0.3,
    /** grinding along the guardrail slows the car this much, m/s^2 (and a hit costs speed on top) */
    scrapeDecel: 6,
    /** body size for the guardrail, m */
    halfWidthM: 0.92,
    halfLenM: 2.2,
    /** a car slower than this does not skid or spin, and below it the tyres blend into a plain rolling model, m/s */
    crawlMs: 3,
  },

  // ----------------------------------------------------------- night run: the road
  road: {
    seed: 7_241_990,
    /** one segment, m, and the paved half-width, m (a little over two lanes) */
    segM: 4,
    halfWidthM: 5.4,
    /** the guardrail stands this far outside the paved edge, m */
    railOffsetM: 0.9,
    /** a checkpoint every this many metres, how many there are (the last is the finish), and a run-out after it, m */
    checkEveryM: 720,
    checkpoints: 8,
    runOutM: 520,
    /** the first straight, m */
    startStraightM: 220,
  },

  // ------------------------------------------------------ night run: the run itself
  run: {
    /** the countdown before GO, s */
    countS: 2.7,
    /** time on the clock at the start and added at each checkpoint, as a share of what the target driver needs for the leg, plus a flat amount, s */
    startShare: 1.45,
    startFlatS: 7,
    legShare: 1.4,
    legFlatS: 5,
    /** the clock does not run in the first moments after GO (the launch), s */
    graceS: 0.6,
    /** after the clock hits zero (or the finish) the car coasts this long before the end screen, s */
    coastS: 2.2,
    /** points: a checkpoint, a second left over at the finish */
    checkpointPoints: 500,
    finishSecondPoints: 120,
    /** the target driver's pace as a share of the grip limit (under 1: it can be beaten) */
    targetPace: 0.9,
  },

  // ------------------------------------------------------------- night run: drifting
  drift: {
    /** sliding counts above this body angle (deg) and speed (m/s) */
    minAngleDeg: 10,
    minSpeedMs: 11,
    /** points a second = this x angle (deg) x speed (m/s), up to maxAngleDeg of angle counted */
    pointsPerDegMs: 0.3,
    maxAngleDeg: 55,
    /** a combo step every this many seconds of sliding, up to comboMax; a slide that starts before the points are banked chains (+1) */
    comboEveryS: 1.15,
    comboMax: 8,
    /** straight (under the angle, not sliding) this long banks the pending points, s: shorter than that between two slides and they chain */
    bankStraightS: 0.8,
    /** over this angle (deg) for this long (s) is a spin: it costs speed and the pending points */
    spinAngleDeg: 82,
    spinS: 0.28,
    /** after a spin the car is righted over this long (s) at this share of its speed */
    recoverS: 0.9,
    recoverSpeed: 0.45,
  },

  // ----------------------------------------------------------- night run: the camera
  cam: {
    /** the camera sits this far behind the car (m) and this high over the road (m) */
    backM: 8.4,
    heightM: 2.7,
    /** it looks this far ahead of the car, m, and swings to this share of the car's yaw (the car's flank shows in a drift) */
    lookM: 26,
    yawFollow: 0.55,
    yawSmoothS: 0.22,
    /** horizontal field of view, deg (wider at speed: it adds this much at top speed) */
    fovDeg: 68,
    fovSpeedDeg: 9,
    /** shake on a hit and at speed (px), off with reduced motion */
    shakeHitPx: 14,
    shakeSpeedPx: 1.1,
    /** the quality governor drops a step when the frames average over this many ms for a second and a half, and climbs back after ten seconds under the second number */
    slowFrameMs: 20.5,
    fastFrameMs: 17.2,
    /** how many segments are drawn at each quality step, and the most device pixels the canvas may have (it renders at less than the screen's pixel ratio on a big window) */
    drawSegs: [190, 140, 100],
    maxPixels: 2_400_000,
    /** the grid tile (attract mode) is a small card that runs while the visitor reads the page: it draws the shortest
     *  distance, at this many device pixels at most, this many times a second, so it never competes with the page */
    tileMaxPixels: 400_000,
    tileFps: 30,
  },

  // ------------------------------------------------------------ night run: the phone
  /** the wheel: degrees from the opening pose for full lock, the dead zone, smoothing (s), and the auto re-centre after the phone is turned (deg, s) */
  wheel: { rangeDeg: 42, deadDeg: 4, smoothingS: 0.05, autoRecentreDeg: 70, autoRecentreS: 1.2 },
  /** the touch halves ramp from 0 to full lock over this long (s) */
  touchRampS: 0.2,
  /** a flick or the Drift button holds the handbrake this long, ms (a held button holds it for as long as it is down) */
  handbrakeMs: 420,
  /** laptop side: ease toward what the phone last said (s), dead zone and response curve of the steer, and how fast the pedals follow */
  steerSmoothS: 0.045,
  steerDead: 0.02,
  steerCurve: 1.2,
  pedalSmoothS: 0.05,
  /** a keyboard steers by ramping: seconds from centre to full lock, back to centre, and across a flip of direction */
  keySteerS: 0.26,
  keyReturnS: 0.14,
  /** the phone is told the run this often at most, ms */
  nightStateEveryMs: 100,
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

// ------------------------------------------------------------------ the two modes

export type EngineMode = "night" | "drag";

/** Read an "engine-mode" gesture's data. */
export function parseEngineMode(data: Record<string, number | string | boolean> | undefined): EngineMode | null {
  const m = data?.mode;
  return m === "night" || m === "drag" ? m : null;
}

// ------------------------------------------------------------------ night run: phone -> laptop

/** What the laptop does with the phone's axes: the wheel, shaped; the pedals, clamped; the handbrake, held or not. */
export type NightInput = { steer: number; throttle: number; brake: number; hand: number };

export const NO_INPUT: NightInput = { steer: 0, throttle: 0, brake: 0, hand: 0 };

/** Read a pedal axis (gas, brake, hand): 0..1, or 0 for junk. */
export const parsePedal = parseThrottle;

/** Read the `steer` axis: -1..1, or 0 for junk. */
export function parseSteer(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, -1, 1) : 0;
}

/** A dead zone, then a power curve: fine control near the middle, full lock at the edge. */
export function shapeSteer(v: number, cal = ENGINE_CAL): number {
  const a = Math.min(1, Math.abs(v));
  if (a <= cal.steerDead) return 0;
  return Math.sign(v) * Math.pow((a - cal.steerDead) / (1 - cal.steerDead), cal.steerCurve);
}

/** The handbrake time a flick (or a tap on the Drift button) asks for, ms: clamped so a bad message cannot lock it on. */
export function parseHandbrakeMs(data: Record<string, number | string | boolean> | undefined, cal = ENGINE_CAL): number {
  const ms = Number(data?.ms);
  return Number.isFinite(ms) && ms > 0 ? clamp(ms, 80, 1500) : cal.handbrakeMs;
}

/** A change of gear asked for by the phone's paddles: +1 up, -1 down. */
export function parseShift(data: Record<string, number | string | boolean> | undefined): 1 | -1 | 0 {
  const d = Number(data?.dir);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

// ------------------------------------------------------------------ night run: laptop -> phone

export type NightPhase = "ready" | "count" | "run" | "done";

/** What the laptop tells the phone ("night-state"). `cpN` and `hitN` are counters: when one goes up, the phone buzzes. */
export type NightView = {
  phase: NightPhase;
  /** mph */
  speed: number;
  /** 0-based gear */
  gear: number;
  auto: boolean;
  /** the drift multiplier now, 0 when not drifting */
  combo: number;
  /** drift points not yet banked */
  pending: number;
  score: number;
  /** seconds on the clock */
  time: number;
  /** checkpoints passed, and how many there are */
  cp: number;
  cps: number;
  cpN: number;
  hitN: number;
  /** the countdown number while counting, 0 otherwise */
  count: number;
  /** the run over: miles, best banked drift */
  miles: number;
  best: number;
};

export const READY_VIEW: NightView = { phase: "ready", speed: 0, gear: 0, auto: true, combo: 0, pending: 0, score: 0, time: 0, cp: 0, cps: ENGINE_CAL.road.checkpoints, cpN: 0, hitN: 0, count: 0, miles: 0, best: 0 };

const r1 = (v: number) => Math.round(v * 10) / 10;

export function nightStateData(v: NightView): Record<string, number | string | boolean> {
  return {
    phase: v.phase,
    speed: Math.round(v.speed),
    gear: v.gear,
    auto: v.auto,
    combo: v.combo,
    pending: Math.round(v.pending / 10) * 10,
    score: Math.round(v.score / 10) * 10,
    time: r1(v.time),
    cp: v.cp,
    cps: v.cps,
    cpN: v.cpN,
    hitN: v.hitN,
    count: v.count,
    miles: Math.round(v.miles * 100) / 100,
    best: Math.round(v.best / 10) * 10,
  };
}

const NIGHT_PHASES: NightPhase[] = ["ready", "count", "run", "done"];

/** Read a "night-state" gesture's data, or null if it isn't one. */
export function parseNightState(data: Record<string, number | string | boolean> | undefined): NightView | null {
  if (!data) return null;
  const phase = String(data.phase) as NightPhase;
  const gear = Number(data.gear);
  if (!NIGHT_PHASES.includes(phase) || !Number.isInteger(gear) || gear < 0 || gear > 9) return null;
  const n = (k: string, lo: number, hi: number) => {
    const x = Number(data[k]);
    return Number.isFinite(x) ? clamp(x, lo, hi) : 0;
  };
  return {
    phase,
    speed: n("speed", 0, 400),
    gear,
    auto: data.auto !== false,
    combo: Math.round(n("combo", 0, 99)),
    pending: n("pending", 0, 1e7),
    score: n("score", 0, 1e8),
    time: n("time", 0, 9999),
    cp: Math.round(n("cp", 0, 99)),
    cps: Math.round(n("cps", 0, 99)) || ENGINE_CAL.road.checkpoints,
    cpN: Math.round(n("cpN", 0, 1e6)),
    hitN: Math.round(n("hitN", 0, 1e6)),
    count: Math.round(n("count", 0, 9)),
    miles: n("miles", 0, 1e4),
    best: n("best", 0, 1e8),
  };
}
