import { ALPHA0, GATE_HALF, HALF_W, L, PENALTY, RUNOUT, centerX, type Course } from "./course";

// The physics: a point skier on a sloped plane. Gravity pulls along the
// fall line, so a traverse is slow and a straight run is fast; air drag falls
// when you tuck; carving costs a little speed, and asking the skis for more
// grip than they have (a skid) costs a lot. Terrain that falls away faster
// than gravity launches you.

export const DT = 1 / 120;
const G = 9.81;
const GN = G * Math.cos(ALPHA0); // gravity pulling you into the snow
const GRIP = 16; // lateral acceleration the edges hold, m/s²
const MU = 0.04;

export type Input = { steer: number; tuck: boolean };

export type SimEvent =
  | { type: "gate"; i: number; ok: boolean; delta: number }
  | { type: "launch"; vy: number }
  | { type: "land"; impact: number; air: number; spins: number; clean: boolean; stumble: boolean }
  | { type: "crash"; cause: "tree" | "wipeout" }
  | { type: "net"; v: number }
  | { type: "getup" }
  | { type: "finish"; t: number };

export type Run = {
  x: number;
  z: number;
  y: number;
  vy: number;
  vyG: number;
  v: number;
  hd: number; // heading, radians off the fall line, + is toward +x
  steer: number;
  w: number; // turn rate
  aLat: number; // signed lateral acceleration
  skid: number;
  tuck: number;
  straightT: number;
  grounded: boolean;
  spin: number; // body yaw relative to travel while airborne (unwrapped)
  spinRate: number;
  airT: number;
  grab: number;
  crash: number;
  crashAge: number;
  tumble: number;
  invul: number;
  stumble: number;
  cool: number;
  pushT: number;
  t: number;
  next: number;
  pen: number;
  missed: number;
  gateT: number[];
  gateOk: boolean[];
  finished: boolean;
  finishT: number;
  top: number;
  bestAir: number;
  tricks: number;
  crashes: number;
  streak: number;
  dist: number;
};

export function newRun(): Run {
  return {
    x: 0, z: 0, y: 0, vy: 0, vyG: 0, v: 2.5, hd: 0, steer: 0, w: 0, aLat: 0, skid: 0, tuck: 0, straightT: 0,
    grounded: true, spin: 0, spinRate: 0, airT: 0, grab: 0, crash: 0, crashAge: 0, tumble: 0, invul: 0, stumble: 0, cool: 0,
    pushT: 0, t: 0, next: 0, pen: 0, missed: 0, gateT: [], gateOk: [], finished: false, finishT: 0, top: 0, bestAir: 0,
    tricks: 0, crashes: 0, streak: 0, dist: 0,
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const wrap = (a: number) => {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
};

export const omegaMax = (v: number) => 1.9 / (1 + v / 22);

export function step(s: Run, C: Course, dt: number, inp: Input, out: SimEvent[]) {
  const T = C.terrain;
  const pz = s.z;
  const px = s.x;
  s.t += s.finished ? 0 : dt;
  s.pushT += dt;
  s.invul = Math.max(0, s.invul - dt);
  s.cool = Math.max(0, s.cool - dt);
  s.stumble = Math.max(0, s.stumble - dt);
  const hp = T.slope(s.z);
  const cosH = Math.cos(s.hd);

  if (s.crash > 0) {
    // tumbling: slide to a stop
    s.crash -= dt;
    s.crashAge += dt;
    s.v = Math.max(0, s.v - 13 * dt);
    s.tumble += (s.v * 0.55 + 1.5) * dt * 3;
    s.steer = 0;
    s.w = 0;
    s.aLat = 0;
    s.skid = 0;
    s.tuck = 0;
    if (s.crash <= 0) {
      s.crash = 0;
      s.v = 2.2;
      s.hd *= 0.25;
      s.tumble = 0;
      s.invul = 1.4;
      s.straightT = 0;
      out.push({ type: "getup" });
    }
  } else if (s.finished) {
    // braking in the runout
    s.v = Math.max(0, s.v - (9 + (s.z > L + 55 ? 14 : 0)) * dt);
    s.hd += (0 - s.hd) * Math.min(1, dt * 0.8);
    s.steer = 0;
    s.w = 0;
    s.tuck += (0 - s.tuck) * Math.min(1, dt * 6);
    if (s.grounded) s.vyG = hp * s.v * Math.cos(s.hd);
  } else if (s.grounded) {
    // --- on the snow
    const want = inp.steer;
    const rate = Math.sign(want) === Math.sign(s.steer) && Math.abs(want) > Math.abs(s.steer) ? 4.5 : 9;
    s.steer += clamp(want - s.steer, -rate * dt, rate * dt);
    const manual = inp.tuck;
    if (Math.abs(inp.steer) < 0.1 && Math.abs(s.steer) < 0.15) s.straightT += dt;
    else s.straightT = 0;
    const tTarget = manual ? 1 : s.straightT > 0.35 ? 0.85 : 0;
    s.tuck += (tTarget - s.tuck) * Math.min(1, dt * 6);
    const auth = 1 - 0.35 * s.tuck;
    const wCmd = s.steer * omegaMax(s.v) * auth;
    const r = (s.v * Math.abs(wCmd)) / GRIP;
    const skidT = clamp(r - 1, 0, 1);
    s.skid += (skidT - s.skid) * Math.min(1, dt * 10);
    s.w = wCmd * (1 - 0.3 * s.skid);
    s.hd += s.w * dt;
    if (Math.abs(s.hd) > 1.3) {
      s.hd = Math.sign(s.hd) * 1.3;
      s.v *= 1 - dt * 1.5;
    }
    s.aLat = s.v * s.w;
    const aLatAbs = Math.abs(s.aLat);
    let a = G * Math.cos(s.hd) * (Math.sin(ALPHA0) - Math.cos(ALPHA0) * hp);
    a -= MU * G;
    a -= (0.0031 - 0.0013 * s.tuck) * s.v * s.v;
    a -= 0.55 * (aLatAbs / G) ** 2 + 13 * Math.max(0, r - 1);
    if (s.pushT < 1.4) a += 3 * (1 - s.pushT / 1.4);
    if (s.stumble > 0) a -= 3;
    s.v = Math.max(0, s.v + a * dt);
  } else {
    // --- airborne: body yaw is yours, travel direction is fixed
    s.w = 0;
    s.aLat = 0;
    s.skid = 0;
    const dead = Math.abs(inp.steer) > 0.45 ? Math.sign(inp.steer) * ((Math.abs(inp.steer) - 0.45) / 0.55) : 0;
    const target = dead * 8;
    s.spinRate += clamp(target - s.spinRate, -60 * dt, 60 * dt);
    s.spin += s.spinRate * dt;
    s.tuck += ((inp.tuck ? 1 : 0.35) - s.tuck) * Math.min(1, dt * 8);
    s.grab = inp.tuck ? s.grab + dt : 0;
    s.straightT = 0;
    let a = G * Math.cos(s.hd) * Math.sin(ALPHA0) - 0.0026 * s.v * s.v;
    a *= 0.8;
    s.v = Math.max(0, s.v + a * dt);
  }

  // --- move
  const dz = s.v * Math.cos(s.hd) * dt;
  s.z += dz;
  s.x += s.v * Math.sin(s.hd) * dt;
  s.dist += s.v * dt;
  s.top = Math.max(s.top, s.v);

  // --- vertical: follow the terrain, or fly when it falls away
  const h0 = T.h(s.z);
  const vg = T.slope(s.z) * dz / dt;
  if (s.grounded) {
    // the ground has dropped below the path a thrown object would take: you're flying
    const ballistic = s.y + s.vyG * dt - 0.5 * GN * dt * dt;
    if (h0 < ballistic - 0.004 && s.cool <= 0 && s.v > 6 && s.crash <= 0 && !s.finished) {
      s.grounded = false;
      s.vy = s.vyG * (inp.tuck ? 0.62 : 1);
      s.airT = 0;
      s.spin = 0;
      s.spinRate = 0;
      s.grab = 0;
      if (s.vy > 1.2) out.push({ type: "launch", vy: s.vy });
    } else {
      s.y = h0;
      s.vyG = vg;
    }
  }
  if (!s.grounded) {
    s.vy -= GN * dt;
    s.y += s.vy * dt;
    s.airT += dt;
    if (s.y <= h0) {
      const impact = Math.max(0, vg - s.vy);
      s.y = h0;
      s.grounded = true;
      s.vyG = vg;
      s.vy = 0;
      s.bestAir = Math.max(s.bestAir, s.airT);
      s.cool = 0.1;
      const d = wrap(s.spin);
      const ad = Math.abs(d);
      const spins = Math.floor((Math.abs(s.spin) + 1.0) / (Math.PI * 2));
      let clean = ad < 0.75;
      let stumble = false;
      if (s.airT < 0.25) {
        clean = true; // a hop: nothing to land
      } else if (ad >= 1.7) {
        s.crash = 1.9;
        s.crashAge = 0;
        s.crashes++;
        s.streak = 0;
        clean = false;
        out.push({ type: "crash", cause: "wipeout" });
      } else if (!clean) {
        stumble = true;
        s.stumble = 0.8;
        s.v *= 0.72;
      }
      if (clean && s.airT >= 0.25) {
        if (impact > 3) s.v *= 1 - Math.min(0.14, (impact - 3) * 0.03);
        if (spins > 0) {
          s.v += 1.6 + spins * 1.3;
          s.tricks++;
        } else if (s.grab > 0.4) s.v += 0.8;
      }
      if (s.airT >= 0.25) out.push({ type: "land", impact, air: s.airT, spins: clean ? spins : 0, clean, stumble });
      s.spin = 0;
      s.spinRate = 0;
    }
  }

  // --- the piste's edge: nets
  const off = s.x - centerX(s.z);
  if (Math.abs(off) > HALF_W - 0.6) {
    const sg = Math.sign(off);
    s.x = centerX(s.z) + sg * (HALF_W - 0.6);
    if (s.hd * sg > 0) {
      s.hd = -s.hd * 0.35 - sg * 0.06;
      if (s.v > 3) out.push({ type: "net", v: s.v });
      s.v *= 0.55;
    }
  }

  // --- trees
  if (s.invul <= 0 && s.crash <= 0 && s.y - T.h(s.z) < 1.4) {
    for (const o of C.obstacles) {
      if (o.z < s.z - 2) continue;
      if (o.z > s.z + 2) break;
      if (Math.hypot(o.x - s.x, o.z - s.z) < o.r + 0.3) {
        s.crash = 1.9;
        s.crashAge = 0;
        s.crashes++;
        s.streak = 0;
        s.v = Math.min(s.v, 12) * 0.6;
        out.push({ type: "crash", cause: "tree" });
        break;
      }
    }
  }

  // --- gates and the line
  while (s.next < C.gates.length && s.z >= C.gates[s.next].z) {
    const g = C.gates[s.next];
    const f = dz > 0 ? (g.z - pz) / (s.z - pz) : 1;
    const xAt = px + (s.x - px) * f;
    const tAt = s.t - dt * (1 - f);
    const ok = Math.abs(xAt - g.x) <= GATE_HALF + 0.15;
    s.gateOk[s.next] = ok;
    s.gateT[s.next] = tAt;
    if (ok) s.streak++;
    else {
      s.pen += PENALTY;
      s.missed++;
      s.streak = 0;
    }
    out.push({ type: "gate", i: s.next, ok, delta: 0 });
    s.next++;
  }
  if (!s.finished && s.z >= L) {
    const f = (L - pz) / Math.max(1e-6, s.z - pz);
    s.finished = true;
    s.finishT = s.t - dt * (1 - f);
    out.push({ type: "finish", t: s.finishT });
  }
  if (s.z > L + RUNOUT - 8) {
    s.z = L + RUNOUT - 8;
    s.v = 0;
  }
}

// ---- the autopilot: previews, and the medal calibration

export type Bot = { spinDir: number; wobble: number };
export const newBot = (): Bot => ({ spinDir: 0, wobble: 0 });

export function botInput(s: Run, C: Course, b: Bot, skill = 1): Input {
  if (!s.grounded) {
    if (b.spinDir === 0) b.spinDir = s.airT < 0.05 ? (Math.sin(s.z * 7.3) > 0 ? 1 : -1) * (s.vy > 2.6 ? 1 : 0) : 0;
    const done = Math.abs(s.spin) > Math.PI * 2 - 0.55;
    return { steer: b.spinDir && !done ? b.spinDir : 0, tuck: s.airT > 0.3 };
  }
  b.spinDir = 0;
  const g = C.gates[s.next];
  let aim: number;
  let dist: number;
  if (g) {
    const n2 = C.gates[s.next + 1];
    dist = g.z - s.z;
    aim = g.x;
    if (n2) aim += Math.sign(n2.x - g.x) * (GATE_HALF - 1.3);
    if (dist < 7 && n2) {
      aim = n2.x;
      dist = n2.z - s.z;
    }
  } else {
    aim = centerX(s.z);
    dist = 40;
  }
  const want = Math.atan2(aim - s.x, Math.max(9, dist));
  const err = want - s.hd;
  const wCmd = clamp(err * 2.2, -1, 1) * (0.9 * skill);
  const steer = clamp((wCmd * Math.max(0.55, skill)) / (omegaMax(s.v) * (1 - 0.35 * s.tuck)), -0.6, 0.6);
  return { steer: Math.abs(err) < 0.03 ? 0 : steer, tuck: false };
}

/** Run the whole course with the autopilot; returns the final time and per-gate times. */
export function simulate(C: Course, skill = 1): Run {
  const s = newRun();
  const bot = newBot();
  const out: SimEvent[] = [];
  let n = 0;
  while (!(s.finished && s.v < 0.2) && n++ < 120 * 400) {
    out.length = 0;
    step(s, C, DT, botInput(s, C, bot, skill), out);
  }
  return s;
}
