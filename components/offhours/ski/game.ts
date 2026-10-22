import { L, PENALTY, RUNOUT, getCourse, type Course } from "./course";
import { DT, botInput, newBot, newRun, simulate, step, type Bot, type Run, type SimEvent } from "./sim";
import { SkiSound } from "./sound";

// The game around the physics: phases (ready, countdown, run, finish,
// result), the camera, snow particles, tracks that stay on the piste between
// runs, toasts, sound, and the medal targets.

export type Phase = "ready" | "count" | "run" | "finish" | "result";
export type Part = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; kind: 0 | 1 };
export type Toast = { text: string; sub?: string; tone: "good" | "bad" | "info" | "trick"; age: number; life: number };
export type Result = {
  total: number;
  raw: number;
  pen: number;
  missed: number;
  gates: number;
  crashes: number;
  top: number;
  air: number;
  tricks: number;
  medal: 0 | 1 | 2 | 3;
  newBest: boolean;
  best: number;
};

export const TD = 0.6; // track cell length
export const MEDALS = ["", "Gold", "Silver", "Bronze"];

type Par = { gold: number; silver: number; bronze: number; ref: number[] };
let par: Par | null = null;
export function getPar(): Par {
  if (!par) {
    const s = simulate(getCourse(), 1);
    const r = (v: number) => Math.round(v * 10) / 10;
    par = { gold: r(s.finishT * 1.1), silver: r(s.finishT * 1.25), bronze: r(s.finishT * 1.5), ref: s.gateT.map((t) => t * 1.1) };
  }
  return par;
}

export function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

export class Game {
  C: Course = getCourse();
  par = getPar();
  run: Run = newRun();
  phase: Phase = "ready";
  phaseT = 0;
  time = 0;
  acc = 0;
  parts: Part[] = [];
  toasts: Toast[] = [];
  shake = 0;
  flash = 0;
  flashTone: "good" | "bad" = "good";
  pace: number | null = null;
  paceAge = 9;
  cheer = 0;
  result: Result | null = null;
  best = Infinity;
  runs = 0;
  hintAge = 0;
  skierSX = 0;
  /** where the start banner's top edge landed on screen this frame (the ready card sits above it) */
  startTop = Infinity;
  mpp = 0.01; // metres across the screen per pixel, at the skier's depth
  // tracks: x of each ski, how hard it was edged, and whether a ski was there
  tl: Float32Array;
  tr: Float32Array;
  te: Float32Array;
  tv: Uint8Array;
  lastCell = 0;
  // input
  steerIn = 0;
  tuckIn = false;
  // camera
  cam = { x: 0, y: 0, z: -9, ps: 0, dist: 9 };
  bot: Bot | null = null;
  skill = 1;
  sound: SkiSound | null = null;
  say: (m: string) => void = () => {};
  private pend = 0;
  private countN = 4;
  private ev: SimEvent[] = [];

  constructor(public autoplay: boolean) {
    const n = Math.ceil((L + RUNOUT + 30) / TD);
    this.tl = new Float32Array(n);
    this.tr = new Float32Array(n);
    this.te = new Float32Array(n);
    this.tv = new Uint8Array(n);
    if (autoplay) this.begin();
    else this.run.v = 0;
    this.snapCamera();
  }

  /** from the start screen */
  begin() {
    this.run = newRun();
    this.parts.length = 0;
    this.toasts.length = 0;
    this.pace = null;
    this.result = null;
    this.acc = 0;
    this.hintAge = 0;
    if (this.autoplay) {
      this.bot = newBot();
      this.skill = 0.92 + Math.random() * 0.08;
      this.phase = "run";
    } else {
      this.phase = "count";
      this.countN = 4;
      this.run.v = 0;
    }
    this.phaseT = 0;
    this.lastCell = 0;
    this.snapCamera();
    this.say(`Race starting. ${this.C.gates.length} gates down the hill.`);
  }

  snapCamera() {
    const s = this.run;
    this.cam.x = s.x;
    this.cam.y = this.C.terrain.h(s.z);
    this.cam.z = s.z - 9;
    this.cam.ps = this.C.terrain.slope(s.z);
  }

  silence() {
    this.sound?.silence();
  }

  private toast(text: string, tone: Toast["tone"], sub?: string, life = 1.7) {
    this.toasts = this.toasts.filter((t) => t.text !== text);
    this.toasts.push({ text, sub, tone, age: 0, life });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  private burst(n: number, x: number, y: number, z: number, speed: number, up: number, vx: number, vz: number, size = 0.1) {
    for (let i = 0; i < n && this.parts.length < 900; i++) {
      const a = Math.random() * Math.PI * 2;
      const k = Math.random();
      this.parts.push({
        x, y: y + 0.1, z,
        vx: Math.cos(a) * speed * k + vx * 0.5,
        vy: up * (0.4 + Math.random()),
        vz: Math.sin(a) * speed * k * 0.7 + vz * 0.5,
        life: 1, max: 0.7 + Math.random() * 0.9, size: size * (0.7 + Math.random() * 0.9), kind: 1,
      });
    }
  }

  private handle(e: SimEvent) {
    const s = this.run;
    const snd = this.sound;
    switch (e.type) {
      case "gate": {
        snd?.gate(e.ok, s.streak);
        const ref = this.par.ref[e.i];
        if (ref !== undefined) {
          this.pace = s.t + s.pen - ref;
          this.paceAge = 0;
        }
        this.flash = 0.35;
        this.flashTone = e.ok ? "good" : "bad";
        if (!e.ok) {
          this.toast("MISSED GATE", "bad", `+${PENALTY.toFixed(1)} s`);
          this.say(`Missed gate ${e.i + 1}. Plus ${PENALTY.toFixed(1)} seconds.`);
        }
        break;
      }
      case "launch":
        snd?.launch();
        break;
      case "land": {
        snd?.land(e.impact, e.clean);
        this.shake = Math.min(1, e.impact / 9);
        this.burst(18 + Math.round(e.impact * 7), s.x, s.y, s.z, 2 + e.impact * 0.5, 2 + e.impact * 0.3, 0, s.v * Math.cos(s.hd) * 0.5, 0.14);
        if (e.spins > 0) {
          this.toast(`${e.spins * 360}`, "trick", "clean landing, speed boost");
          snd?.trick();
          this.say(`${e.spins * 360} degree spin, clean landing. Speed boost.`);
        } else if (e.stumble) this.toast("SLOPPY LANDING", "bad");
        else if (e.air >= 0.55) this.toast(`AIR ${e.air.toFixed(1)} s`, "info");
        break;
      }
      case "crash":
        snd?.crash();
        this.shake = 1;
        this.burst(110, s.x, s.y, s.z, 5, 5, Math.sin(s.hd) * s.v, Math.cos(s.hd) * s.v, 0.18);
        this.toast(e.cause === "tree" ? "TREE" : "WIPEOUT", "bad", "back on your feet in a moment");
        this.say(e.cause === "tree" ? "Hit a tree. Wipeout." : "Wipeout on the landing.");
        break;
      case "net":
        snd?.net();
        this.shake = Math.max(this.shake, 0.6);
        this.burst(26, s.x, s.y, s.z, 3, 2, 0, 0, 0.12);
        break;
      case "finish": {
        const total = e.t + s.pen;
        const p = this.par;
        const medal = (total <= p.gold ? 1 : total <= p.silver ? 2 : total <= p.bronze ? 3 : 0) as Result["medal"];
        const newBest = total < this.best;
        const prev = this.best;
        if (newBest) this.best = total;
        this.result = {
          total, raw: e.t, pen: s.pen, missed: s.missed, gates: this.C.gates.length, crashes: s.crashes,
          top: s.top, air: s.bestAir, tricks: s.tricks, medal, newBest, best: newBest ? total : prev,
        };
        this.runs++;
        this.phase = "finish";
        this.phaseT = 0;
        this.cheer = 1;
        snd?.finish(medal);
        if (!this.autoplay)
          this.say(
            `Finished in ${fmt(total)}${s.pen ? `, including ${s.missed} missed gate${s.missed === 1 ? "" : "s"}` : ", clean run"}. ${medal ? MEDALS[medal] + " medal." : "No medal."} Press Enter to run again.`,
          );
        break;
      }
      default:
        break;
    }
  }

  update(dt: number) {
    this.time += dt;
    this.phaseT += dt;
    this.paceAge += dt;
    this.hintAge += dt;
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.flash = Math.max(0, this.flash - dt);
    this.cheer = Math.max(0, this.cheer - dt * 0.35);
    for (const t of this.toasts) t.age += dt;
    this.toasts = this.toasts.filter((t) => t.age < t.life);
    const s = this.run;
    const C = this.C;

    if (this.phase === "count") {
      const n = 3 - Math.floor(this.phaseT / 0.85);
      if (n !== this.countN && n >= 1) {
        this.countN = n;
        this.sound?.count(n);
      }
      if (this.phaseT >= 3 * 0.85) {
        this.sound?.count(0);
        this.phase = "run";
        this.phaseT = 0;
        s.pushT = 0;
        s.v = 2.5;
      }
    } else if (this.phase === "run" || this.phase === "finish" || this.phase === "result") {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n++ < 12) {
        this.acc -= DT;
        this.ev.length = 0;
        const inp = this.bot && this.phase === "run" ? botInput(s, C, this.bot, this.skill) : { steer: this.steerIn, tuck: this.tuckIn };
        step(s, C, DT, inp, this.ev);
        for (const e of this.ev) this.handle(e);
        this.record();
      }
      if (this.acc > DT * 12) this.acc = 0;
      if (this.phase === "finish" && this.phaseT > 1.7 && s.v < 1) {
        this.phase = "result";
        this.phaseT = 0;
      }
      if (this.phase === "result" && this.autoplay && this.phaseT > 2.6) this.begin();
    }

    this.spawn(dt);
    this.moveParts(dt);
    this.moveCamera(dt);
    this.sound?.update({
      v: this.phase === "ready" || this.phase === "count" ? 0 : s.v,
      edge: Math.abs(s.aLat) / 16,
      skid: s.skid,
      grounded: s.grounded,
      crashed: s.crash > 0,
      tuck: s.tuck,
    });
  }

  private record() {
    const s = this.run;
    const cell = Math.floor(s.z / TD);
    if (cell < 0 || cell >= this.tl.length) return;
    if (!s.grounded || s.v < 1) {
      this.lastCell = cell;
      return;
    }
    const half = 0.14;
    const ox = Math.cos(s.hd) * half;
    for (let c = Math.min(this.lastCell + 1, cell); c <= cell; c++) {
      if (c < 0 || c >= this.tl.length) continue;
      this.tl[c] = s.x - ox;
      this.tr[c] = s.x + ox;
      this.te[c] = Math.min(1, Math.max(Math.abs(s.aLat) / 16, s.skid * 1.5));
      this.tv[c] = 1;
    }
    this.lastCell = cell;
  }

  private spawn(dt: number) {
    const s = this.run;
    if (this.phase === "ready" || this.phase === "count" || s.v < 1) return;
    if (this.parts.length > 850) return;
    const vxs = s.v * Math.sin(s.hd);
    const vzs = s.v * Math.cos(s.hd);
    const rnd = (rate: number) => {
      const n = rate * dt + this.pend;
      const k = Math.floor(n);
      this.pend = n - k;
      return k;
    };
    const f = [Math.sin(s.hd), Math.cos(s.hd)];
    if (s.crash > 0) {
      const k = rnd(60);
      this.burst(k, s.x, s.y, s.z, 3, 2.5, vxs, vzs, 0.16);
      return;
    }
    if (s.finished) {
      // hockey stop
      const k = rnd(s.v * 9);
      const sd = s.hd >= 0 ? -1 : 1;
      for (let i = 0; i < k; i++)
        this.parts.push({ x: s.x, y: s.y + 0.1, z: s.z, vx: sd * (3 + Math.random() * 5), vy: 1 + Math.random() * 3.5, vz: vzs * 0.5, life: 1, max: 0.6 + Math.random() * 0.8, size: 0.12 + Math.random() * 0.1, kind: 1 });
      return;
    }
    if (!s.grounded) return;
    const edge = Math.min(1.4, Math.abs(s.aLat) / 16);
    const sd = s.aLat > 0 ? -1 : 1;
    // the rooster tail on the outside of a carve; skids throw a wall of it
    const k = rnd(Math.max(0, edge - 0.3) * 70 + s.skid * 180 + s.v * 0.5);
    for (let i = 0; i < k; i++) {
      const sk = s.skid;
      this.parts.push({
        x: s.x - f[0] * 0.5 + sd * 0.25,
        y: s.y + 0.08,
        z: s.z - f[1] * 0.5,
        vx: sd * (0.8 + Math.random() * (2 + edge * 3.5 + sk * 3)) + vxs * 0.45,
        vy: 0.5 + Math.random() * (1.2 + edge * 2.4 + sk * 2.4),
        vz: vzs * (0.4 + Math.random() * 0.25),
        life: 1,
        max: 0.5 + Math.random() * 0.8,
        size: 0.07 + Math.random() * 0.08 + sk * 0.05,
        kind: 1,
      });
    }
  }

  private moveParts(dt: number) {
    const T = this.C.terrain;
    for (const q of this.parts) {
      q.vy -= 7 * dt;
      q.vx *= 1 - dt * 1.6;
      q.vz *= 1 - dt * 1.2;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      const g = T.h(q.z);
      if (q.y < g) {
        q.y = g;
        q.vy *= -0.2;
        q.vx *= 0.7;
      }
      q.life -= dt / q.max;
    }
    this.parts = this.parts.filter((q) => q.life > 0);
  }

  private moveCamera(dt: number) {
    const s = this.run;
    const T = this.C.terrain;
    const c = this.cam;
    const k = Math.min(1, dt * 3.4);
    c.x += (s.x + Math.sin(s.hd) * 3.2 - c.x) * k;
    c.dist += (8.8 + s.v * 0.07 - c.dist) * Math.min(1, dt * 1.5);
    c.z = s.z - c.dist;
    const g = T.h(s.z);
    c.y += (g + (s.y - g) * 0.5 - c.y) * Math.min(1, dt * 5);
    c.ps += (T.slope(s.z) - c.ps) * Math.min(1, dt * 4);
  }
}
