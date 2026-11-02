import { ENGINE_CAL, type NightInput } from "../engineRemote";
import { lockOf, roadSteer, type Car } from "./car";
import type { Road } from "./road";

// The plan: built once from the road, a speed for every point (the fastest the tyres
// allow through the bend there, braked back from the next one) and a line (inside
// through a corner, back to the middle on the straights). The corner warning, the
// steering assist and the scripted test drivers read it. The driver that is
// recorded as the ghost and the tile's attract mode is the pilot, further down: the
// same car and the same physics the player has, driven on a racing line.

export type Plan = {
  /** the speed the tyres allow at each node (m/s), at pace 1 */
  vmax: Float32Array;
  /** the line, m right of the centre, at each node */
  line: Float32Array;
};

const G = 9.81;
const V_TOP = 68;
/** sideways acceleration the planner trusts the tyres with, m/s^2, and the braking it plans on */
const A_LAT = ENGINE_CAL.car.gripG * G * 0.86;
const A_BRAKE = 8.2;

export function buildPlan(road: Road): Plan {
  const n = road.n;
  const seg = road.segM;
  // how bent the road is around each node: the worst curvature a little ahead and behind
  const bend = new Float32Array(n + 1);
  const back = Math.round(6 / seg);
  const fwd = Math.round(30 / seg);
  for (let i = 0; i <= n; i++) {
    let m = 0;
    for (let j = Math.max(0, i - back); j <= Math.min(n, i + fwd); j++) m = Math.max(m, Math.abs(road.kappa[j]));
    bend[i] = m;
  }
  const vmax = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) vmax[i] = Math.min(V_TOP, Math.sqrt(A_LAT / Math.max(bend[i], 1e-5)));
  // braking: it can only come down so fast
  for (let i = n - 1; i >= 0; i--) {
    const v1 = vmax[i + 1];
    vmax[i] = Math.min(vmax[i], Math.sqrt(v1 * v1 + 2 * A_BRAKE * seg));
  }

  // the line: toward the inside of the corner, with the curvature smoothed over a short stretch
  const line = new Float32Array(n + 1);
  const w = Math.round(36 / seg);
  const reach = road.half - 1.9;
  for (let i = 0; i <= n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n, i + w); j++) {
      sum += road.kappa[j];
      cnt++;
    }
    line[i] = Math.max(-reach, Math.min(reach, (sum / cnt) * 380));
  }
  return { vmax, line };
}

const at = (a: Float32Array, s: number, seg: number) => {
  const u = Math.min(Math.max(s / seg, 0), a.length - 1.001);
  const i = Math.floor(u);
  return a[i] + (a[i + 1] - a[i]) * (u - i);
};

/** The speed the plan allows at `s`, m/s. */
export const planSpeed = (plan: Plan, road: Road, s: number) => at(plan.vmax, s, road.segM);

/**
 * The wheel (-1..1) that steers the car toward a line a little ahead: by pointing the direction of
 * travel (not the nose) at it. `line` is metres right of the centre at each node (the plan's racing
 * line), or null for the middle of the road. The driver steers with it, and so does the steering assist.
 */
export function steerToLine(c: Car, road: Road, line: Float32Array | null): number {
  const v = Math.max(1, Math.hypot(c.u, c.w));
  const seg = road.segM;
  const look = Math.max(5, Math.min(26, 0.4 * v));
  const lineAhead = line ? at(line, c.s + look, seg) : 0;
  const eLat = lineAhead - c.lat;
  const want = Math.max(-0.3, Math.min(0.3, Math.atan2(eLat, look * 1.6)));
  const travel = c.psi + c.slip;
  const wheel = 0.55 * (want - travel);
  const kap = at(road.kappa, c.s, seg);
  return Math.max(-1, Math.min(1, (wheel - roadSteer(kap, c.u)) / lockOf(c)));
}

/**
 * What a plan follower does this instant: written into `out`. `pace` is the share of
 * the plan's speed it will use (1 = at the limit of the tyres). The scripted test
 * drivers steer with it; the recorded target is the pilot's.
 */
export function drive(c: Car, road: Road, plan: Plan, pace: number, out: NightInput): NightInput {
  const v = Math.max(1, Math.hypot(c.u, c.w));
  const seg = road.segM;
  // steer to the line a little ahead
  out.steer = steerToLine(c, road, plan.line);
  // speed: the plan a little ahead, since the brakes take time
  const target = at(plan.vmax, c.s + 0.25 * v, seg) * pace;
  const e = target - v;
  if (e >= 0) {
    out.throttle = Math.max(0.25, Math.min(1, e / 3));
    out.brake = 0;
  } else {
    out.throttle = 0;
    out.brake = Math.min(1, -e / 4);
  }
  out.hand = 0;
  return out;
}

// ------------------------------------------------------------------ the pilot
// The target's own driving. The plan above (the tyres' limit at each node, and a line drawn from the road's curvature) is what the
// corner warning and the steering assist read, and what the scripted test drivers follow; the pilot is the driver that is
// recorded. Its line is the one that bends least inside the paved width: out toward the edge before a corner, in to the apex, out
// again. Its speed comes from that line's curvature, at a share of the tyres' limit, with braking planned back from each corner.
// It steers with the wheel the line needs plus a correction, through a low-pass filter, so the hands are smooth. In the
// medium and tight corners it slides: a short handbrake flick at the turn-in, then the throttle holds the slide, with the same
// car, inputs and stability help the player has.

export type PilotStyle = typeof ENGINE_CAL.pilot;

export type Pilot = {
  /** the line, m right of the centre at each node, and its curvature (rad/m, + right) */
  line: Float32Array;
  kappa: Float32Array;
  /** the speed to drive at each node, m/s */
  speed: Float32Array;
  /** the corners it slides: where the turn-in is, where it is done, which way it turns */
  slides: { s0: number; s1: number; dir: 1 | -1 }[];
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * The line that bends least inside +-`w` metres of the centre: minimise the squared curvature of the path (the road's plus the
 * offset's second difference) with the offset held to the width. It is solved as a banded least squares, with the nodes that hit the
 * edge held there and let go again when the line wants back in (an active set), so it comes out as the racing line: wide in, the
 * apex where the corner wants it, wide out, and a straight chord between two corners.
 */
export function racingLine(road: Road, w: number): Float32Array {
  const N = road.n + 1;
  const h = road.segM;
  const h2 = h * h;
  const lo2 = new Float64Array(N);
  const lo1 = new Float64Array(N);
  const di = new Float64Array(N);
  const up1 = new Float64Array(N);
  const up2 = new Float64Array(N);
  const rhs = new Float64Array(N);
  // the normal equations of sum over i of (h^2 kappa_i + n[i-1] - 2 n[i] + n[i+1])^2
  const add = (a: number, b: number, v: number) => {
    if (b === a) di[a] += v;
    else if (b === a + 1) up1[a] += v;
    else if (b === a + 2) up2[a] += v;
    else if (b === a - 1) lo1[a] += v;
    else lo2[a] += v;
  };
  const co = [1, -2, 1];
  for (let i = 1; i < N - 1; i++) {
    for (let p = 0; p < 3; p++) {
      const a = i - 1 + p;
      rhs[a] -= co[p] * h2 * road.kappa[i];
      for (let q = 0; q < 3; q++) add(a, i - 1 + q, co[p] * co[q]);
    }
  }
  for (let i = 0; i < N; i++) di[i] += 1e-4;
  const FIX = 1e7;
  const fixed = new Int8Array(N);
  const val = new Float64Array(N);
  // the car starts in the middle
  for (let i = 0; i < 4; i++) {
    fixed[i] = 1;
    val[i] = 0;
  }
  const n = new Float64Array(N);
  for (let it = 0; it < 80; it++) {
    const d = Float64Array.from(di);
    const l1 = Float64Array.from(lo1);
    const l2 = Float64Array.from(lo2);
    const u1 = Float64Array.from(up1);
    const u2 = Float64Array.from(up2);
    const b = Float64Array.from(rhs);
    for (let i = 0; i < N; i++) {
      if (fixed[i]) {
        d[i] += FIX;
        b[i] += FIX * val[i];
      }
    }
    for (let i = 0; i < N - 1; i++) {
      for (let r = i + 1; r <= i + 2 && r < N; r++) {
        const m = (r === i + 1 ? l1[r] : l2[r]) / d[i];
        if (r === i + 1) {
          d[r] -= m * u1[i];
          u1[r] -= m * u2[i];
        } else {
          l1[r] -= m * u1[i];
          d[r] -= m * u2[i];
        }
        b[r] -= m * b[i];
      }
    }
    for (let i = N - 1; i >= 0; i--) {
      let s = b[i];
      if (i + 1 < N) s -= u1[i] * n[i + 1];
      if (i + 2 < N) s -= u2[i] * n[i + 2];
      n[i] = s / d[i];
    }
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (fixed[i]) {
        // the pull on a held node: let it go if the line wants back in
        if (i < 4) continue;
        let g = di[i] * n[i] - rhs[i];
        if (i >= 1) g += lo1[i] * n[i - 1];
        if (i >= 2) g += lo2[i] * n[i - 2];
        if (i + 1 < N) g += up1[i] * n[i + 1];
        if (i + 2 < N) g += up2[i] * n[i + 2];
        if ((val[i] > 0 && g > 1e-9) || (val[i] < 0 && g < -1e-9)) {
          fixed[i] = 0;
          changed = true;
        }
      } else if (Math.abs(n[i]) > w + 1e-6) {
        fixed[i] = 1;
        val[i] = Math.sign(n[i]) * w;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = clamp(n[i], -w, w);
  return out;
}

/** The curvature of a line offset from the road (rad/m, + right). */
export function lineCurvature(road: Road, line: Float32Array): Float32Array {
  const N = road.n + 1;
  const h = road.segM;
  const th = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const dn = (line[Math.min(N - 1, i + 1)] - line[Math.max(0, i - 1)]) / ((Math.min(N - 1, i + 1) - Math.max(0, i - 1)) * h);
    th[i] = Math.atan2(dn, 1 - road.kappa[i] * line[i]);
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(N - 1, i + 1);
    const dth = (th[b] - th[a]) / ((b - a) * h);
    out[i] = ((road.kappa[i] + dth) * Math.cos(th[i])) / (1 - road.kappa[i] * line[i]);
  }
  return out;
}

/** the wheel's look-ahead: this many metres plus this many metres per m/s, the gain of its correction (1/s), and how far ahead of the car (s) it reads the line's slope and curvature */
const LOOK_M = 3;
const LOOK_PER_MS = 1.2;
const CORRECT_PER_S = 2.5;
const AHEAD_S = 0.1;
const AHEAD_KAPPA_S = 0.12;
/** the apex of a slide is read off the line's curvature: a corner is where it is over 1/220 m^-1, until it is down to half that */
const SLIDE_K = 1 / 220;
/** while the handbrake is on, the wheel is at least this far toward the corner (the flick swings the tail the way the wheel is turned) */
const FLICK_STEER = 0.03;

export function buildPilot(road: Road, style: PilotStyle, pace: number): Pilot {
  const n = road.n;
  const seg = road.segM;
  const line = racingLine(road, road.half - style.marginM);
  const kappa = lineCurvature(road, line);
  // the corners it slides: not the gentle ones, nor the tightest, which it takes slowly and on the line
  const slides: Pilot["slides"] = [];
  const zone = new Uint8Array(n + 1);
  for (let i = 0; i < n && style.slides; ) {
    if (Math.abs(kappa[i]) > SLIDE_K) {
      const sg = Math.sign(kappa[i]);
      let j = i;
      let peak = 0;
      while (j < n && Math.sign(kappa[j]) === sg && Math.abs(kappa[j]) > SLIDE_K / 2) {
        peak = Math.max(peak, Math.abs(kappa[j]));
        j++;
      }
      if (peak >= 1 / style.slideMaxR && peak <= 1 / style.slideMinR && (j - i) * seg >= style.slideMinLenM) {
        slides.push({ s0: i * seg, s1: j * seg, dir: sg as 1 | -1 });
        for (let q = i; q < j; q++) zone[q] = 1;
      }
      i = j;
    } else i++;
  }
  // the speed: a share of what the line's tightest curvature a little either side allows, braked back from each corner
  const speed = new Float32Array(n + 1);
  const w = Math.round(8 / seg);
  for (let i = 0; i <= n; i++) {
    let k = 0;
    let z = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n, i + w); j++) {
      k = Math.max(k, Math.abs(kappa[j]));
      z = Math.max(z, zone[j]);
    }
    // the driver paces a leg (the stretch between two gates) a little up or down
    let leg = 0;
    while (leg < road.checks.length - 1 && i * seg > road.checks[leg]) leg++;
    const trim = style.legTrim[leg] ?? 1;
    speed[i] = Math.min(style.topMs, (z ? style.slidePace : pace * trim) * Math.sqrt(A_LAT / Math.max(k, 1e-5)));
  }
  for (let i = n - 1; i >= 0; i--) speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] ** 2 + 2 * style.brakeMs2 * seg));
  return { line, kappa, speed, slides };
}

/** What the pilot's hands and feet are doing: the filters carry from one step to the next. `slide` is the next corner it slides, `hand` the handbrake time left. */
export type PilotState = { steer: number; throttle: number; brake: number; slide: number; fired: boolean; hand: number };
export const newPilotState = (): PilotState => ({ steer: 0, throttle: 0, brake: 0, slide: 0, fired: false, hand: 0 });

/** One step of the pilot (`dt` s), written into `out`. */
export function pilotDrive(st: PilotState, c: Car, road: Road, pl: Pilot, style: PilotStyle, dt: number, out: NightInput): NightInput {
  const v = Math.max(1, Math.hypot(c.u, c.w));
  const seg = road.segM;
  // a corner it slides: the handbrake at the turn-in, then the throttle holds it
  let ev = pl.slides[st.slide];
  while (ev && c.s > ev.s1) {
    ev = pl.slides[++st.slide];
    st.fired = false;
  }
  if (ev && !st.fired && c.s >= ev.s0 - style.leadS * v) {
    st.fired = true;
    st.hand = style.handS;
  }
  const sliding = !!ev && st.fired;
  // the wheel: what the line's curvature needs, plus a correction toward the line (by the direction the car is travelling)
  const sp = c.s + AHEAD_S * v;
  const slope = (at(pl.line, sp + 2, seg) - at(pl.line, sp - 2, seg)) / 4;
  const des = Math.atan(slope + (at(pl.line, sp, seg) - c.lat) / (LOOK_M + LOOK_PER_MS * v));
  const ahead = at(pl.kappa, c.s + AHEAD_KAPPA_S * v, seg);
  const wheel = 2.6 * ahead + ((2.6 * CORRECT_PER_S * (sliding ? style.slideGain : 1)) / v) * clamp(des - (c.psi + c.slip), -0.5, 0.5);
  let want = clamp((wheel - roadSteer(at(road.kappa, c.s, seg), c.u)) / lockOf(c), -1, 1);
  if (st.hand > 0 && ev) want = ev.dir * Math.max(FLICK_STEER, want * ev.dir);
  // hands: a low-pass, not a twitch
  st.steer += (want - st.steer) * (1 - Math.exp(-dt / (st.hand > 0 ? style.slideSteerS : style.steerS)));
  out.steer = st.steer;
  // feet: the speed the plan wants a little ahead, the pedals eased on and off
  const e = at(pl.speed, c.s + 0.15 * v, seg) - v;
  st.throttle += clamp(clamp(0.35 + e / 1.8, 0, 1) - st.throttle, -9 * dt, 3 * dt);
  st.brake += clamp((e < -0.4 ? clamp((-e - 0.4) / 3, 0, 1) : 0) - st.brake, -3 * dt, 7 * dt);
  out.throttle = st.brake > 0.02 ? 0 : st.throttle;
  out.brake = st.brake;
  out.hand = 0;
  if (st.hand > 0) {
    st.hand -= dt;
    out.hand = 1;
    out.throttle = 1;
    out.brake = 0;
    st.brake = 0;
  } else if (sliding && Math.abs(c.slip) > style.slideHoldRad) {
    // the throttle holds the slide
    out.throttle = Math.max(out.throttle, style.slideThrottle);
    if (out.throttle > 0) out.brake = 0;
  }
  return out;
}
