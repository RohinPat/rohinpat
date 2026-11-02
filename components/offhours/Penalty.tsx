"use client";

import { useEffect, useRef, useState } from "react";
import { seeded, useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio, tone } from "./audio";
import { display, mono } from "./font";
import { useRemote } from "@/lib/link/remote";
import { isPhoneShot, kickFromSwipe, parseKick, type PhoneShot } from "./penaltyRemote";
import {
  BALL_R, GH, GOAL_Z, GW, KEEPER_Z, NET_Z, RUNUP, SHOTS, SPOT_Z,
  atLineResult, clamp, contact, favourite, glovePos, keeperIdle, keeperRun, keeperStartPlan, launch, makeStrike, newBall, newKeeper,
  missesFrame, remember, resolveContact, saveNote, shotById, spinBall, stepBall, tellOf, think,
  type Ball, type Brain, type Contact, type Joints, type ShotId, type Strike,
} from "./penaltyModel";

// A penalty from behind the ball, in real units (goal 7.32 x 2.44 m, spot
// 11 m out) through a perspective camera. Pick how to hit it: placed, driven,
// a curler either way, a dipper, a knuckleball or a Panenka. Aim with the
// pointer, hold to power up, let go. The keeper is a small mind of his own
// (see penaltyModel.ts): he watches, reads what he can of the ball, commits,
// and dives with a real body you can beat, or that can get a glove to it.
// Goals ripple a spring-grid net. Five kicks; five from five and it goes on
// until you miss.
// A linked phone kicks too (penaltyRemote.ts): swipe its screen, and the swipe's
// heading, length, speed and bend become the aim, power and curl of the same
// strike(). It is told how each kick went.

const CAM = { y: 1.45, z: -4.6 };
const COLS = 17, ROWS = 7;
/** a touch aims with the reticle this far above the finger, and charges only once the finger has rested a moment */
const TOUCH_LIFT = 70;
const TOUCH_HOLD = 0.2;
/** the over screen takes no input at first; after a result, a click skips to the next aim once it has been seen */
const OVER_GUARD = 0.8;
const SKIP_AFTER = 0.8;

// the most goals in the first five kicks of a shootout, this visit (kept across closing and reopening the piece; no storage)
let bestFive = 0;

type Kick = "goal" | "save" | "miss" | "post";
type Phase = "aim" | "run" | "fly" | "after" | "over" | "replay";
type P3 = { x: number; y: number; z: number };
type Rec = { ball: P3; rot: number[]; j: Joints; net: Float32Array; dolly: number; held: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number; kind: "fleck" | "confetti" };
type Scene = { ball: P3; rot: number[]; j: Joints; net: Float32Array; trail: P3[]; held: boolean };

// the twelve panels of a ball (icosahedron vertices, unit length)
const PANELS = (() => {
  const p = (1 + Math.sqrt(5)) / 2;
  const v = [[0, 1, p], [0, -1, p], [0, 1, -p], [0, -1, -p], [1, p, 0], [-1, p, 0], [1, -p, 0], [-1, -p, 0], [p, 0, 1], [-p, 0, 1], [p, 0, -1], [-p, 0, -1]];
  return v.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
})();

export default function Penalty({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [shot, setShotState] = useState<ShotId>("placed");
  const [status, setStatus] = useState("");
  const [hasKick, setHasKick] = useState(false);
  const pills = useRef<HTMLDivElement>(null);
  const S = useRef({
    phase: "aim" as Phase,
    shot: "placed" as ShotId,
    aim: { x: 1.8, y: 1.6 },
    anchor: { x: 1.8, y: 1.6 },
    dwell: 0,
    power: 0,
    charging: false,
    strike: null as Strike | null,
    ball: newBall(),
    keeper: newKeeper(),
    brain: { hist: [] } as Brain,
    net: { z: new Float32Array(COLS * ROWS), v: new Float32Array(COLS * ROWS) },
    kicks: [] as Kick[],
    result: "" as "" | Kick,
    detail: "",
    resultT: 0,
    lastTarget: { x: 0, y: 0 },
    flash: 0,
    shake: 0,
    ts: 1,
    slowT: 0,
    dolly: 0,
    timer: 0,
    acc: 0,
    auto: 1,
    graze: false,
    contactDone: false,
    held: null as null | 0 | 1,
    trail: [] as P3[],
    parts: [] as Particle[],
    rec: [] as Rec[],
    ridx: 0,
    backTo: "aim" as Phase,
    replayReq: false,
    wrong: false,
    now: 0,
    overT: 0,
    told: "",
    touch: false,
    pending: false,
    downAt: 0,
    look: 0,
    squashT: -9,
    reduce: false,
  });
  const choice = useRef<PhoneShot>("auto"); // the phone's shot picker
  const crowd = useRef(
    (() => {
      const r = seeded(10);
      return Array.from({ length: 900 }, () => ({ x: r(), y: r(), c: r() }));
    })(),
  );
  const cam = useRef({ f: 1, cx: 0, cy: 0, cz: CAM.z });

  const proj = (x: number, y: number, z: number) => {
    const { f, cx, cy, cz } = cam.current;
    const d = Math.max(0.3, z - cz);
    return { x: cx + (f * x) / d, y: cy - (f * (y - CAM.y)) / d, s: f / d };
  };
  // screen -> point on the goal plane
  const unproj = (sx: number, sy: number) => {
    const { f, cx, cy, cz } = cam.current;
    const d = GOAL_Z - cz;
    return { x: ((sx - cx) * d) / f, y: CAM.y - ((sy - cy) * d) / f };
  };

  const sfx = (k: "kick" | "thud" | "swish" | "net" | "roar" | "save" | "glove" | "post" | "ooh" | "groan") => {
    if (!play) return;
    const au = getAudio();
    if (!au) return;
    if (k === "kick") {
      tone(au, { freq: 140, to: 60, dur: 0.12, gain: 0.5 });
      burst(au, { freq: 900, type: "lowpass", dur: 0.04, gain: 0.3 });
    } else if (k === "thud") tone(au, { freq: 95, to: 42, dur: 0.1, gain: 0.45 });
    else if (k === "swish") {
      burst(au, { freq: 4200, q: 0.8, type: "highpass", dur: 0.5, gain: 0.07, at: 0.04 });
    } else if (k === "net") burst(au, { freq: 2500, q: 0.7, type: "bandpass", dur: 0.25, gain: 0.25 });
    else if (k === "roar") {
      const { ctx, out } = au;
      const src = ctx.createBufferSource();
      const len = ctx.sampleRate * 2.2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900;
      bp.Q.value = 0.5;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
      src.connect(bp).connect(g).connect(out);
      src.start();
    } else if (k === "save") burst(au, { freq: 300, type: "lowpass", dur: 0.14, gain: 0.6 });
    else if (k === "glove") {
      burst(au, { freq: 1700, q: 1.2, type: "bandpass", dur: 0.06, gain: 0.5 });
      tone(au, { freq: 200, to: 90, dur: 0.1, gain: 0.3 });
    } else if (k === "post") {
      tone(au, { freq: 880, dur: 0.6, gain: 0.15, type: "triangle" });
      tone(au, { freq: 2210, dur: 0.3, gain: 0.06 });
    } else if (k === "groan") tone(au, { freq: 260, to: 120, dur: 0.9, gain: 0.07, type: "sawtooth" });
    else tone(au, { freq: 330, to: 180, dur: 0.7, gain: 0.08, type: "triangle" });
  };

  // a shot picked while a kick is still playing is the next kick's: the kick in flight keeps its own strike
  const pickShot = (id: ShotId) => {
    const s = S.current;
    s.shot = id;
    setShotState(id);
  };

  const difficulty = (s: typeof S.current) => {
    if (!play) return 0.45;
    const i = s.kicks.length;
    const goals = s.kicks.filter((k) => k === "goal").length;
    // gets sharper as the shootout goes on, and when you're ahead of the game
    return clamp(0.26 + 0.06 * Math.min(i, 4) + 0.05 * Math.max(0, goals - (i - goals) - 1) + 0.09 * Math.max(0, i - 5), 0.2, 0.92);
  };

  const strike = (power: number) => {
    const s = S.current;
    if (s.phase !== "aim") return;
    const st = makeStrike(shotById(s.shot), s.aim, power, Math.random);
    s.strike = st;
    s.lastTarget = st.end;
    s.rec = [];
    s.trail = [];
    s.graze = false;
    s.contactDone = false;
    s.held = null;
    s.wrong = false;
    s.ball = newBall();
    const k = s.keeper;
    // how long the reticle sat still (charging counts: a still hand is a settled aim) is all he knows of where you meant it
    keeperStartPlan(k, think(s.brain, difficulty(s), st, play ? tellOf(s.dwell) : 0, k.x, Math.random, { bait: k.bait }));
    s.phase = "run";
    s.timer = 0;
    s.acc = 0;
    // the kick starts at release: the thud, the squash and the sound, then the run-up
    s.squashT = s.now;
    sfx("thud");
    sfx("kick");
  };

  const record = (s: typeof S.current, sc: Scene) => {
    if (!play || s.rec.length > 360) return;
    s.rec.push({ ball: { ...sc.ball }, rot: sc.rot, j: sc.j, net: s.net.z.slice(), dolly: s.dolly, held: sc.held });
  };

  const puff = (s: typeof S.current, x: number, y: number, n: number, base: string[]) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI;
      const sp = 40 + Math.random() * 160;
      s.parts.push({ x, y, vx: Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1), vy: -Math.sin(a) * sp, life: 0.6 + Math.random() * 0.4, max: 1, c: base[i % base.length], s: 1.5 + Math.random() * 2, kind: "fleck" });
    }
  };

  const confetti = (s: typeof S.current, w: number) => {
    const cols = ["#a50044", "#004d98", "#edbb00", "#f2ead7"];
    for (let i = 0; i < 90; i++)
      s.parts.push({ x: Math.random() * w, y: -10 - Math.random() * 80, vx: (Math.random() - 0.5) * 60, vy: 90 + Math.random() * 160, life: 2.4 + Math.random() * 1.2, max: 1, c: cols[i % 4], s: 3 + Math.random() * 3, kind: "confetti" });
  };

  const word = (s: typeof S.current) => {
    const r = s.result;
    if (r === "goal") return "GOOOL";
    if (r === "save") return "SAVED";
    if (r === "post") return s.lastTarget.y > GH - 0.3 ? "BAR" : "POST";
    return s.lastTarget.y > GH ? "OVER" : "WIDE";
  };

  function end(s: typeof S.current, r: Kick, t: number, detail: string, bounce = true) {
    s.result = r;
    s.resultT = t;
    // a save he planned (a read, a bet that came off, a bait) says so; a body in the way does not
    if (r === "save") detail = saveNote(s.keeper.plan, { x: s.ball.x, y: s.ball.y }, detail);
    s.detail = detail;
    s.kicks.push(r);
    s.phase = "after";
    s.timer = 0;
    const b = s.ball;
    const st = s.strike!;
    remember(s.brain, r, st, b.x, b.y);
    if (r === "goal") {
      s.flash = 1.4;
      s.shake = 1;
      s.slowT = 0.7;
      s.ts = Math.min(s.ts, 0.4);
      sfx("net");
      sfx("roar");
      if (play) confetti(s, 1000);
    } else if (r === "save") {
      s.shake = 0.55;
      s.slowT = 0.45;
      sfx("glove");
      sfx("save");
      sfx("groan");
    } else if (r === "post") {
      s.shake = 0.8;
      sfx("post");
      sfx("ooh");
    } else sfx("ooh");
    if (bounce && r !== "goal" && r !== "save") {
      b.vz = -b.vz * 0.35;
      b.vx = (Math.random() - 0.5) * 6;
      b.vy = Math.abs(b.vy) * 0.4 + 1.5;
    }
    if (play) {
      const n = s.kicks.length;
      const goals = s.kicks.filter((k) => k === "goal").length;
      const w = word(s);
      setStatus(`${st.shot.name.replace(/[^\w ]/g, "").trim()}: ${r === "goal" ? "goal" : w.toLowerCase()}${detail ? `, ${detail.toLowerCase()}` : ""}. ${goals} from ${n}.`);
      setHasKick(true);
      tellRef.current(r);
    }
  }

  // the ball meets some part of the keeper
  const resolve = (s: typeof S.current, c: Contact, t: number) => {
    const r = resolveContact(s.ball, s.strike!, s.keeper.joints, c, s.graze, Math.random);
    if (r.kind === "graze") {
      // fingertips: slowed and bent, but still going
      s.graze = true;
      sfx("glove");
      s.shake = 0.3;
      return;
    }
    if (r.how === "held") s.held = r.hand;
    end(s, "save", t, r.detail, false);
  };

  // what happened at the line
  const atLine = (s: typeof S.current, t: number) => {
    const r = atLineResult(s.ball, s.strike!, s.keeper.plan, s.graze);
    end(s, r.result, t, r.detail, r.result === "post");
  };

  // A linked phone: penalty-kick is a swipe to kick with, penalty-shot its shot
  // picker, penalty-sync "tell me where we are". Without a phone this is idle.
  const { linked, send } = useRemote(play ? "penalty" : null, {
    gesture: (name, data) => {
      const s = S.current;
      if (name === "penalty-kick") {
        const sw = parseKick(data);
        if (!sw) return;
        if (s.phase === "replay") s.phase = s.backTo;
        else if (s.phase === "over") {
          // a swipe still in flight when the last kick landed shouldn't skip the result
          if (s.now - s.overT > 1.2) {
            s.kicks = [];
            s.brain = { hist: [] };
            s.phase = "aim";
            setStatus("New shootout.");
          }
        } else if (s.phase === "aim") {
          const k = kickFromSwipe(sw, choice.current);
          s.shot = k.shot;
          setShotState(k.shot);
          s.aim = k.aim;
          s.dwell = 0; // no pointer hovering on the goal, so the keeper gets no tell
          strike(k.power);
        }
      } else if (name === "penalty-shot") {
        if (isPhoneShot(data.id)) choice.current = data.id;
      }
      tell();
    },
  });
  const tell = (result: "" | Kick = "") => {
    if (!play) return; // the tile's autopilot isn't the visitor's shootout
    const s = S.current;
    send({
      type: "gesture",
      name: "penalty-state",
      data: {
        phase: s.phase === "aim" ? "aim" : s.phase === "over" ? "over" : "busy",
        kicks: s.kicks.map((k) => (k === "goal" ? "G" : k === "save" ? "S" : k === "post" ? "P" : "M")).join(""),
        result,
        word: result ? word(s) : "",
        detail: result ? s.detail : "",
        shot: result && s.strike ? s.strike.shot.name : "",
        choice: choice.current,
      },
    });
  };
  const tellRef = useRef(tell);
  tellRef.current = tell;
  useEffect(() => {
    if (linked) tellRef.current();
  }, [linked]);

  const ref = useCanvas(
    ({ ctx, w, h, t, dt, p, reduce }) => {
      const s = S.current;
      s.now = t;
      s.reduce = reduce;
      // the phone is told when the kick is over and it can swipe again
      const ph = s.phase === "aim" ? "aim" : s.phase === "over" ? "over" : "busy";
      if (ph !== s.told) {
        s.told = ph;
        if (ph === "over") s.overT = t;
        tellRef.current();
      }
      // a phone is narrow and tall: fit the goal to the width, so it is big and sits mid-screen
      const f = play && w < 520 ? Math.min(w * 1.9, h * 1.7) : Math.min(w * 1.12, h * 1.7);
      const cz = CAM.z + s.dolly;
      cam.current = { f, cx: w / 2, cy: h * 0.86 - (f * (CAM.y - BALL_R)) / (SPOT_Z - cz), cz };

      // --- time: the last stretch of a kick and the moments after a goal run slow
      const b = s.ball;
      const stretch = s.phase === "fly" && b.z > KEEPER_Z - 2.3 && b.z < GOAL_Z + 0.4;
      const tsGoal = stretch && play ? 0.5 : s.slowT > 0 ? 0.38 : 1;
      s.ts += (tsGoal - s.ts) * Math.min(1, dt * 10);
      s.slowT = Math.max(0, s.slowT - dt);
      const sdt = s.phase === "replay" ? dt : dt * s.ts;

      const k0 = s.keeper;
      // --- input and the keeper's gaze
      if (play && p.inside && s.phase === "aim") {
        const g = unproj(p.x, p.y - (s.touch ? TOUCH_LIFT : 0));
        s.aim = { x: Math.max(-GW - 1, Math.min(GW + 1, g.x)), y: Math.max(0.1, Math.min(GH + 1, g.y)) };
      }
      // a touch: the finger places the reticle first, and charging starts once it has rested
      if (s.pending && t - s.downAt >= TOUCH_HOLD && s.phase === "aim") {
        s.pending = false;
        s.charging = true;
        s.power = 0;
      }
      if (s.charging) s.power = Math.min(1, s.power + dt * 0.9);
      // the keeper's head follows the cursor while you aim, then the ball
      const lookAt = s.phase === "aim" && play ? clamp((s.aim.x - k0.x) / 2.5, -1, 1) : clamp((b.x - k0.x) / 2.5, -1, 1);
      s.look += (lookAt - s.look) * Math.min(1, dt * 6);
      if (!play && s.phase === "aim") {
        s.auto -= dt;
        if (s.auto <= 0) {
          const sh = SHOTS[Math.floor(Math.random() * SHOTS.length)];
          s.shot = sh.id;
          const sd = Math.random() < 0.5 ? -1 : 1;
          s.aim = sh.id === "panenka" ? { x: (Math.random() - 0.5) * 0.8, y: 1.1 + Math.random() * 0.5 } : { x: sd * (1.5 + Math.random() * 1.9), y: 0.3 + Math.random() * 1.9 };
          strike(clamp(sh.sweet + (Math.random() - 0.5) * 0.12, 0.1, 1));
          s.auto = 2.4;
        }
      }
      if (s.phase === "aim") {
        const moved = Math.hypot(s.aim.x - s.anchor.x, s.aim.y - s.anchor.y);
        // a reticle that stays put is a tell, charging or not: he sees what you settled on
        if (moved > 0.4) {
          s.anchor = { ...s.aim };
          s.dwell = 0;
        } else s.dwell += dt;
      }
      if (s.replayReq) {
        s.replayReq = false;
        if ((s.phase === "aim" || s.phase === "over") && s.rec.length > 20) {
          s.backTo = s.phase;
          s.phase = "replay";
          s.ridx = 0;
        }
      }

      // --- the kick
      const k = s.keeper;
      if (s.phase === "aim" || s.phase === "over") {
        const tell = play ? tellOf(s.dwell) : 0;
        // in play he leans toward where you have been shooting this shootout, and now and then shows a bait lean
        keeperIdle(k, sdt, s.aim.x, tell, play && s.phase === "aim", play ? { bias: favourite(s.brain, difficulty(s)), rnd: Math.random } : {});
        s.dolly = Math.max(0, s.dolly - dt * 1.4);
        // the ball waits on the spot
        if (s.phase === "aim") s.ball = Object.assign(s.ball, { x: 0, y: BALL_R, z: SPOT_Z, vx: 0, vy: 0, vz: 0 });
      } else if (s.phase === "run") {
        keeperRun(k, sdt);
        s.dolly = 0.95 * Math.min(1, k.tk / RUNUP) ** 2;
        if (k.tk >= RUNUP) {
          const st = s.strike!;
          launch(s.ball, st);
          s.acc = k.tk - RUNUP;
          s.phase = "fly";
          if (st.shot.id === "curlL" || st.shot.id === "curlR" || st.shot.id === "dipper") sfx("swish");
          const q = proj(0, 0, SPOT_Z);
          puff(s, q.x, q.y, 16, ["#2f8a43", "#1f6b33", "#f2ead7"]);
        }
      } else if (s.phase === "fly") {
        const st = s.strike!;
        s.acc += sdt;
        while (s.acc >= st.h && s.phase === "fly") {
          s.acc -= st.h;
          keeperRun(k, st.h);
          const pz = b.z;
          stepBall(b, st, st.h);
          spinBall(b, st.h);
          if (!s.contactDone && pz < KEEPER_Z && b.z >= KEEPER_Z) {
            s.contactDone = true;
            const c = missesFrame(st) ? null : contact(k.joints, b.x, b.y);
            if (c) resolve(s, c, t);
          }
          if (s.phase === "fly" && pz < GOAL_Z && b.z >= GOAL_Z) atLine(s, t);
        }
        s.dolly = Math.min(1.1, s.dolly + dt * 0.1);
      } else if (s.phase === "after") {
        s.timer += sdt;
        const st = s.strike!;
        spinBall(b, sdt);
        if (s.held !== null) {
          const g = glovePos(k.joints, s.held);
          b.x = g[0];
          b.y = g[1] - 0.02;
          b.z = KEEPER_Z - 0.12;
          if (s.timer > 0.95) {
            s.held = null;
            b.vy = -0.5;
            b.vz = -0.6;
            b.vx = 0.4;
          }
        } else {
          b.vy -= 9.8 * sdt;
          b.x += b.vx * sdt;
          b.y += b.vy * sdt;
          b.z += b.vz * sdt;
          if (b.y < BALL_R) {
            b.y = BALL_R;
            b.vy = Math.abs(b.vy) * 0.4;
            b.vx *= 0.8;
            b.vz *= 0.8;
          }
        }
        if (s.result === "goal" && b.z > NET_Z - 0.15) {
          // into the net: give it the energy, stop the ball
          const i = Math.round(((b.x + GW) / (GW * 2)) * (COLS - 1));
          const j = Math.round(((GH - b.y) / GH) * (ROWS - 1));
          const sp = Math.max(0.6, Math.min(1.6, b.vz / 18));
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii > 0 && ii < COLS - 1 && jj >= 0 && jj < ROWS - 1) s.net.v[jj * COLS + ii] += (di || dj ? 1.4 : 3.2) * (b.vz / 10) * sp;
            }
          b.z = NET_Z - 0.15;
          b.vz = -0.6;
          b.vx *= 0.2;
          s.shake = Math.max(s.shake, 0.9);
        }
        if (s.timer > 1.15) keeperIdle(k, sdt, 0, 0, false);
        else keeperRun(k, sdt);
        if (s.timer > (play ? 2.3 : 2.1)) {
          const g = s.kicks.filter((x) => x === "goal").length;
          const n = s.kicks.length;
          const done = !play ? n >= 5 : n >= 5 && (n === 5 ? g < 5 : s.result !== "goal");
          if (done) {
            if (play) {
              s.phase = "over";
              s.pending = false;
              bestFive = Math.max(bestFive, s.kicks.slice(0, 5).filter((x) => x === "goal").length);
            } else {
              s.kicks = [];
              s.brain = { hist: [] };
              s.phase = "aim";
            }
          } else s.phase = "aim";
          s.ball = newBall();
          s.dwell = 0;
          void st;
        }
      } else if (s.phase === "replay") {
        s.ridx += dt * 30;
        if (s.ridx >= s.rec.length - 1) s.phase = s.backTo;
      }
      // trail
      if (s.phase === "fly") {
        s.trail.push({ x: b.x, y: b.y, z: b.z });
        if (s.trail.length > 18) s.trail.shift();
      } else if (s.trail.length && s.phase !== "replay") s.trail.shift();

      // net springs
      const { z, v } = s.net;
      for (let j = 0; j < ROWS; j++)
        for (let i = 0; i < COLS; i++) {
          const kk = j * COLS + i;
          if (i === 0 || i === COLS - 1 || j === ROWS - 1) continue;
          const lap = z[kk - 1] + z[kk + 1] + (j > 0 ? z[kk - COLS] : 0) + z[kk + COLS] - 4 * z[kk];
          v[kk] += (lap * 60 - z[kk] * 18) * sdt;
          v[kk] *= 1 - 2.2 * sdt;
        }
      for (let kk = 0; kk < z.length; kk++) z[kk] += v[kk] * sdt;
      // particles
      for (let i = s.parts.length - 1; i >= 0; i--) {
        const q = s.parts[i];
        q.life -= dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.kind === "fleck") q.vy += 420 * dt;
        else q.vx += Math.sin(t * 3 + i) * 40 * dt;
        if (q.life <= 0 || q.y > h + 20) s.parts.splice(i, 1);
      }
      s.shake = Math.max(0, s.shake - dt * 2.4);

      // --- the scene to draw: live, or a recorded frame
      let sc: Scene;
      if (s.phase === "replay") {
        const r = s.rec[Math.min(s.rec.length - 1, Math.floor(s.ridx))];
        const tr: P3[] = [];
        for (let i = Math.max(0, Math.floor(s.ridx) - 16); i < Math.floor(s.ridx); i++) if (s.rec[i].ball.z > SPOT_Z + 0.2) tr.push(s.rec[i].ball);
        cam.current.cz = CAM.z + r.dolly;
        cam.current.cy = h * 0.86 - (f * (CAM.y - BALL_R)) / (SPOT_Z - cam.current.cz);
        sc = { ball: r.ball, rot: r.rot, j: r.j, net: r.net, trail: tr, held: r.held };
      } else {
        sc = { ball: b, rot: b.rot, j: k.joints, net: s.net.z, trail: s.trail, held: s.held !== null };
        if (s.phase === "run" || s.phase === "fly" || s.phase === "after") record(s, sc);
      }
      draw(ctx, w, h, t, sc);
      s.flash = Math.max(0, s.flash - dt);
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      keys: (e, down) => {
        S.current.touch = false;
        if (!down || !play || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
        const i = "1234567".indexOf(e.key);
        if (i >= 0) {
          pickShot(SHOTS[i].id);
          return true;
        }
        if (e.key === "z" || e.key === "x" || e.key === "Z" || e.key === "X") {
          const cur = SHOTS.findIndex((x) => x.id === S.current.shot);
          pickShot(SHOTS[(cur + (e.key.toLowerCase() === "x" ? 1 : SHOTS.length - 1)) % SHOTS.length].id);
          return true;
        }
        if (e.key === "r" || e.key === "R") {
          S.current.replayReq = true;
          return true;
        }
        return false;
      },
      onDown: () => {
        const s = S.current;
        if (s.phase === "replay") {
          s.phase = s.backTo;
          return;
        }
        if (s.phase === "over") {
          // the screen has to have been seen: a late tap from the last kick doesn't skip it
          if (s.now - s.overT <= OVER_GUARD) return;
          s.kicks = [];
          s.brain = { hist: [] };
          s.phase = "aim";
          setStatus("New shootout.");
          return;
        }
        if (s.phase === "after") {
          // seen the result: on to the next aim, and a press still held there charges the next kick
          if (s.now - s.resultT > SKIP_AFTER) {
            s.timer = 99;
            s.slowT = 0;
            s.ts = 1;
            s.shake = 0;
            s.pending = true;
            s.downAt = s.touch ? s.now : s.now - TOUCH_HOLD;
          }
          return;
        }
        if (s.phase === "aim") {
          if (s.touch) {
            s.pending = true;
            s.downAt = s.now;
          } else {
            s.charging = true;
            s.power = 0;
          }
        }
      },
      onUp: () => {
        const s = S.current;
        s.pending = false;
        if (!s.charging) return;
        s.charging = false;
        strike(s.power);
        s.power = 0;
      },
    },
  );

  // ───────────────────────────── drawing ─────────────────────────────

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, sc: Scene) {
    const s = S.current;
    const replay = s.phase === "replay";
    ctx.save();
    if (s.shake > 0 && !replay && !s.reduce) ctx.translate((Math.random() - 0.5) * s.shake * 9, (Math.random() - 0.5) * s.shake * 7);

    // sky + stands
    ctx.fillStyle = "#081226";
    ctx.fillRect(-20, -20, w + 40, h + 40);
    const top = proj(0, GH + 6, GOAL_Z + 14).y;
    const standBot = proj(0, 0, GOAL_Z + 9).y;
    // floodlight glow behind the far stand
    const glow = ctx.createRadialGradient(w / 2, standBot, 0, w / 2, standBot, w * 0.7);
    glow.addColorStop(0, "rgba(120,150,220,0.22)");
    glow.addColorStop(1, "rgba(120,150,220,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, top - 40, w, standBot - top + 80);
    const gasp = s.result && s.result !== "goal" && s.phase === "after" ? 0.2 : 1;
    for (const c of crowd.current) {
      const x = c.x * w, y = top + c.y * (standBot - top);
      const flash = s.flash > 0 && c.c > 0.985 && !s.reduce;
      ctx.fillStyle = flash ? "#ffffff" : c.c < 0.45 ? "#a50044" : c.c < 0.9 ? "#004d98" : "#edbb00";
      ctx.globalAlpha = 0.35 + c.y * 0.4;
      ctx.fillRect(x, y + (s.reduce ? 0 : Math.sin(t * 6 + c.x * 40) * (s.flash > 0 ? 2.2 : 0.3 * gasp)), 2, 2);
    }
    ctx.globalAlpha = 1;
    // pitch
    const pitchTop = standBot;
    const grad = ctx.createLinearGradient(0, pitchTop, 0, h);
    grad.addColorStop(0, "#1f6b33");
    grad.addColorStop(1, "#2f8a43");
    ctx.fillStyle = grad;
    ctx.fillRect(-20, pitchTop, w + 40, h - pitchTop + 20);
    for (let zz = -6; zz < GOAL_Z + 9; zz += 2) {
      const a = proj(0, 0, zz).y, b2 = proj(0, 0, zz + 1).y;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(-20, b2, w + 40, a - b2);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2;
    const line = (pts: [number, number, number][]) => {
      ctx.beginPath();
      pts.forEach(([x, y, zz], i) => {
        const q = proj(x, y, zz);
        (i ? ctx.lineTo : ctx.moveTo).call(ctx, q.x, q.y);
      });
      ctx.stroke();
    };
    line([[-30, 0, GOAL_Z], [30, 0, GOAL_Z]]);
    line([[-9.16, 0, GOAL_Z], [-9.16, 0, GOAL_Z - 5.5], [9.16, 0, GOAL_Z - 5.5], [9.16, 0, GOAL_Z]]);
    const sp = proj(0, 0, SPOT_Z);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y, sp.s * 0.12, sp.s * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();

    // LED boards
    const bt = proj(-40, 0.9, GOAL_Z + 3.4), bb = proj(40, 0, GOAL_Z + 3.4);
    ctx.fillStyle = "#0b1630";
    ctx.fillRect(0, bt.y, w, bb.y - bt.y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bt.y, w, bb.y - bt.y);
    ctx.clip();
    display(ctx, (bb.y - bt.y) * 0.58);
    const msg = "MÉS QUE UN CLUB  ·  ";
    const tw = ctx.measureText(msg).width;
    let bx0 = -(((s.reduce ? 0 : t) * 50) % (tw * 2));
    for (let i = 0; bx0 < w; i++, bx0 += tw) {
      ctx.fillStyle = s.flash > 0 && !s.reduce ? (Math.floor(t * 8) % 2 ? "#edbb00" : "#f2ead7") : i % 2 ? "#0b4a8c" : "#8c0b45";
      ctx.fillText(msg, bx0, bb.y - (bb.y - bt.y) * 0.2);
    }
    ctx.restore();

    // net: back panel with the ripple, then side and top panels
    const nz = sc.net;
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    const node = (i: number, j: number) => {
      const x = -GW + (i / (COLS - 1)) * GW * 2;
      const y = GH - (j / (ROWS - 1)) * GH;
      return proj(x, y, NET_Z + nz[j * COLS + i]);
    };
    ctx.beginPath();
    for (let j = 0; j < ROWS; j++)
      for (let i = 0; i < COLS; i++) {
        const a = node(i, j);
        if (i < COLS - 1) {
          const b2 = node(i + 1, j);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b2.x, b2.y);
        }
        if (j < ROWS - 1) {
          const b2 = node(i, j + 1);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b2.x, b2.y);
        }
      }
    ctx.stroke();
    for (let i = 0; i < COLS; i += 2) line([[-GW + (i / (COLS - 1)) * GW * 2, GH, GOAL_Z], [-GW + (i / (COLS - 1)) * GW * 2, GH, NET_Z]]);
    for (let j = 0; j < ROWS; j += 2) {
      const y = GH - (j / (ROWS - 1)) * GH;
      line([[-GW, y, GOAL_Z], [-GW, y, NET_Z]]);
      line([[GW, y, GOAL_Z], [GW, y, NET_Z]]);
    }

    // order, back to front: ball in the net, the frame, ball on the line, the keeper, ball in front of him
    const bz = sc.ball.z;
    if (bz > GOAL_Z) drawBall(ctx, sc, t);
    const lp = proj(-GW, 0, GOAL_Z), lt = proj(-GW, GH, GOAL_Z), rt = proj(GW, GH, GOAL_Z), rp = proj(GW, 0, GOAL_Z);
    const post = (dx: number, dy: number, col: string, lw: number) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lp.x + dx, lp.y + dy);
      ctx.lineTo(lt.x + dx, lt.y + dy);
      ctx.lineTo(rt.x + dx, rt.y + dy);
      ctx.lineTo(rp.x + dx, rp.y + dy);
      ctx.stroke();
    };
    const pw = Math.max(3, lp.s * 0.12);
    post(pw * 0.22, pw * 0.12, "rgba(120,135,160,0.9)", pw);
    post(0, 0, "#ffffff", pw * 0.82);
    if (bz > KEEPER_Z && bz <= GOAL_Z) drawBall(ctx, sc, t);
    drawKeeper(ctx, sc.j, s.look);
    if (bz <= KEEPER_Z || sc.held) drawBall(ctx, sc, t);

    // particles
    for (const q of s.parts) {
      ctx.globalAlpha = Math.min(1, q.life * 1.5);
      ctx.fillStyle = q.c;
      if (q.kind === "fleck") ctx.fillRect(q.x, q.y, q.s, q.s);
      else {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.x * 0.05 + q.y * 0.03);
        ctx.fillRect(-q.s, -q.s * 0.5, q.s * 2, q.s);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // aim reticle, the line the ball will take, and power
    if (play && s.phase === "aim") {
      const def = shotById(s.shot);
      // the planned flight, drawn as dots (a knuckleball's wobble is anyone's guess)
      const pw2 = s.charging ? Math.max(0.05, s.power) : def.sweet;
      const ghost = makeStrike(def, s.aim, pw2, () => 0.5);
      const gb = newBall();
      launch(gb, { ...ghost, wob: null });
      const every = Math.max(1, Math.floor(ghost.T / ghost.h / 26));
      for (let i = 0, n = Math.round(ghost.T / ghost.h); i < n; i++) {
        stepBall(gb, { ...ghost, wob: null }, ghost.h);
        if (i % every === 0 && i > 3) {
          const q = proj(gb.x, gb.y, gb.z);
          ctx.fillStyle = `rgba(237,187,0,${0.18 + 0.4 * (i / n)})`;
          ctx.beginPath();
          ctx.arc(q.x, q.y, Math.max(1.2, q.s * 0.025), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const a = proj(s.aim.x, s.aim.y, GOAL_Z);
      ctx.strokeStyle = "#edbb00";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 10 + s.power * 10, 0, Math.PI * 2);
      ctx.moveTo(a.x - 18, a.y);
      ctx.lineTo(a.x - 6, a.y);
      ctx.moveTo(a.x + 6, a.y);
      ctx.lineTo(a.x + 18, a.y);
      ctx.stroke();
      // power as a dial round the reticle: the kick's sweet spot in green, the charge filling from the top
      const R = 30, a0 = -Math.PI / 2, ang = (v: number) => a0 + Math.min(1, Math.max(0, v)) * Math.PI * 2;
      const inRing = Math.abs(s.power - def.sweet) <= def.width;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.arc(a.x, a.y, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = s.charging ? "rgba(138,217,168,0.85)" : "rgba(138,217,168,0.45)";
      ctx.beginPath();
      ctx.arc(a.x, a.y, R, ang(def.sweet - def.width), ang(def.sweet + def.width));
      ctx.stroke();
      if (s.power > 0.01) {
        ctx.strokeStyle = inRing ? "#ffffff" : s.power > 0.9 ? "#ff6b4a" : "#edbb00";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(a.x, a.y, R, a0, ang(s.power));
        ctx.stroke();
      }
      ctx.lineWidth = 2;
      const bw = Math.min(240, w * 0.5), bx = w / 2 - bw / 2, by = h - 24;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = "rgba(138,217,168,0.4)";
      ctx.fillRect(bx + bw * (def.sweet - def.width), by, bw * def.width * 2, 8);
      const inBand = Math.abs(s.power - def.sweet) <= def.width;
      ctx.fillStyle = inBand ? "#8ad9a8" : s.power > 0.9 ? "#ff6b4a" : "#edbb00";
      ctx.fillRect(bx, by + 2, bw * s.power, 4);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(bx + bw * def.sweet - 1, by - 3, 2, 14);
      mono(ctx, 10);
      ctx.fillStyle = "rgba(242,234,215,0.75)";
      ctx.textAlign = "center";
      ctx.fillText(def.name.toUpperCase(), w / 2, by - 8);
      ctx.textAlign = "left";
    }

    // scoreboard
    const goals = s.kicks.filter((k) => k === "goal").length;
    // a narrow canvas gets a smaller board (it was over half a phone's width),
    // with "sudden death" on a line of its own
    const cp = play && w < 520;
    const sudden = s.kicks.length > 5 || (s.kicks.length === 5 && goals === 5);
    const sw = play ? (cp ? 128 : 220) : 150;
    const sh = play ? (cp ? (sudden ? 62 : 46) : 54) : 38;
    ctx.fillStyle = "rgba(8,18,38,0.75)";
    ctx.fillRect(12, 12, sw, sh);
    ctx.fillStyle = "#a50044";
    ctx.fillRect(12, 12, 5, sh);
    ctx.fillStyle = "#004d98";
    ctx.fillRect(17, 12, 5, sh);
    ctx.fillStyle = "#f2ead7";
    display(ctx, play ? (cp ? 18 : 22) : 15, 800);
    ctx.fillText(`BARÇA ${goals}`, 32, play ? (cp ? 33 : 38) : 30);
    const shown = Math.max(5, s.kicks.length);
    const step = play ? Math.min(16, (sw - 44) / shown) : 11;
    const dotY = play ? (cp ? 46 : 54) : 42;
    for (let i = 0; i < shown; i++) {
      const k = s.kicks[i];
      ctx.beginPath();
      ctx.arc(32 + i * step + 4, dotY, play ? (cp ? 4 : 5) : 3.5, 0, Math.PI * 2);
      if (k === "goal") {
        ctx.fillStyle = "#8ad9a8";
        ctx.fill();
      } else if (k) {
        ctx.fillStyle = "#e5484d";
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(242,234,215,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (play && sudden) {
      mono(ctx, 10);
      ctx.fillStyle = "#edbb00";
      ctx.fillText("SUDDEN DEATH", cp ? 32 : 130, cp ? 66 : 38);
    }

    // result call
    if (s.result && !replay && s.phase !== "aim" && s.phase !== "run" && s.phase !== "fly" && t - s.resultT < 1.7) {
      const a = Math.min(1, (1.7 - (t - s.resultT)) * 2);
      ctx.globalAlpha = a;
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = s.result === "goal" ? "#edbb00" : "#f2ead7";
      display(ctx, Math.round(Math.min(w, h) * (play ? 0.16 : 0.2)), 800);
      ctx.textAlign = "center";
      // low on the pitch, under the goal and clear of the keeper
      const wy = h * (play ? 0.7 : 0.56);
      ctx.fillText(word(s), w / 2, wy);
      if (play && s.detail) {
        mono(ctx, Math.max(11, Math.min(w, h) * 0.022));
        ctx.fillStyle = "#f2ead7";
        ctx.fillText(s.detail, w / 2 + 1, wy + Math.min(w, h) * 0.06);
      }
      ctx.textAlign = "left";
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    if (replay) {
      mono(ctx, 12);
      ctx.fillStyle = Math.floor(t * 2) % 2 ? "#e5484d" : "#f2ead7";
      ctx.fillText("● REPLAY · CLICK TO SKIP", 12, h - 14);
    }
    if (s.phase === "over") {
      ctx.fillStyle = "rgba(8,18,38,0.7)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#f2ead7";
      ctx.textAlign = "center";
      display(ctx, Math.round(Math.min(w, h) * 0.13), 800);
      ctx.fillText(`${goals} FROM ${s.kicks.length}`, w / 2, h * 0.45);
      mono(ctx, 12);
      ctx.fillText(`BEST ${bestFive} FROM 5`, w / 2, h * 0.45 + 30);
      // the prompt waits out the input guard, so it never invites a click that would be ignored
      if (t - s.overT > OVER_GUARD) ctx.fillText(w < 520 ? "TAP TO GO AGAIN" : "CLICK TO GO AGAIN", w / 2, h * 0.45 + 52);
      ctx.textAlign = "left";
    }
  }

  function drawBall(ctx: CanvasRenderingContext2D, sc: Scene, t: number) {
    const b = sc.ball;
    const q = proj(b.x, b.y, b.z);
    const r = Math.max(2, q.s * BALL_R);
    // squashed for a moment at release, flattened onto the grass
    const s0 = S.current;
    const sq = s0.phase === "run" && !s0.reduce ? Math.max(0, 1 - (t - s0.squashT) / 0.2) : 0;
    ctx.save();
    if (sq > 0) {
      ctx.translate(q.x, q.y + r);
      ctx.scale(1 + 0.24 * sq, 1 - 0.3 * sq);
      ctx.translate(-q.x, -(q.y + r));
    }
    // streak behind a ball in flight
    const tr = sc.trail;
    if (tr.length > 2 && !sc.held) {
      for (let i = 1; i < tr.length; i++) {
        const a = proj(tr[i - 1].x, tr[i - 1].y, tr[i - 1].z), c = proj(tr[i].x, tr[i].y, tr[i].z);
        const u = i / tr.length;
        ctx.strokeStyle = `rgba(242,234,215,${0.34 * u * u})`;
        ctx.lineWidth = Math.max(1, r * 1.4 * u);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    }
    const sh = proj(b.x, 0, b.z);
    const lift = Math.min(1, b.y / 3);
    ctx.fillStyle = `rgba(0,0,0,${0.3 - lift * 0.15})`;
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, q.s * BALL_R * (1.2 + lift), q.s * BALL_R * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(q.x - r * 0.35, q.y - r * 0.4, r * 0.1, q.x, q.y, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.65, "#ecece5");
    g.addColorStop(1, "#b4b7b2");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 4) {
      ctx.fillStyle = "#1b1d1f";
      const m = sc.rot;
      for (const [vx, vy, vz] of PANELS) {
        const wx = m[0] * vx + m[1] * vy + m[2] * vz;
        const wy = m[3] * vx + m[4] * vy + m[5] * vz;
        const wz = m[6] * vx + m[7] * vy + m[8] * vz;
        if (wz > -0.1) continue; // facing away from us
        const fore = -wz;
        ctx.beginPath();
        ctx.ellipse(q.x + wx * r * 0.92, q.y - wy * r * 0.92, r * 0.3 * Math.pow(fore, 0.8) + 0.3, r * 0.3, Math.atan2(-wy, wx), 0, Math.PI * 2);
        ctx.fill();
      }
      const e = ctx.createRadialGradient(q.x, q.y, r * 0.6, q.x, q.y, r);
      e.addColorStop(0, "rgba(0,0,0,0)");
      e.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.fillStyle = e;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawKeeper(ctx: CanvasRenderingContext2D, j: Joints, look: number) {
    const P = (a: [number, number]) => proj(a[0], a[1], KEEPER_Z);
    const sc = proj(0, 0, KEEPER_Z).s;
    const limb = (a: [number, number], b: [number, number], wd: number, col: string) => {
      const A = P(a), B = P(b);
      ctx.strokeStyle = col;
      ctx.lineWidth = wd * sc;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    };
    // shadow
    const lo = Math.min(j.hip[0], j.ftA[0], j.ftB[0], j.hA[0], j.hB[0]);
    const hi = Math.max(j.hip[0], j.ftA[0], j.ftB[0], j.hA[0], j.hB[0]);
    const sh = proj((lo + hi) / 2, 0, KEEPER_Z);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, Math.max(0.35, (hi - lo) / 2 + 0.25) * sc, sc * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    const LIME = "#c6f24e", LIME_D = "#8fb82a", SHORTS = "#14181b", SOCK = "#aee03a";
    // legs: boots, socks, shorts
    for (const [hp, kn, ft] of [[j.hpB, j.knB, j.ftB], [j.hpA, j.knA, j.ftA]] as [number, number][][]) {
      limb(kn as [number, number], ft as [number, number], 0.1, SOCK);
      limb(hp as [number, number], kn as [number, number], 0.16, SHORTS);
      const F = P(ft as [number, number]);
      ctx.fillStyle = "#f2ead7";
      ctx.beginPath();
      ctx.ellipse(F.x + (ft[0] > j.hip[0] ? 1 : -1) * sc * 0.05, F.y + sc * 0.01, sc * 0.11, sc * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // torso
    const hA = P(j.hpA), hB = P(j.hpB), sA = P(j.shA), sB = P(j.shB);
    ctx.fillStyle = LIME;
    ctx.strokeStyle = LIME;
    ctx.lineWidth = sc * 0.06;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(hA.x, hA.y);
    ctx.lineTo(sA.x, sA.y);
    ctx.lineTo(sB.x, sB.y);
    ctx.lineTo(hB.x, hB.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    limb(j.hip, j.sh, 0.05, LIME_D);
    // shorts waistband over the shirt hem
    limb(j.hpA, j.hpB, 0.14, SHORTS);
    // arms (sleeves, then gloves)
    for (const [s0, el, hd] of [[j.shB, j.elB, j.hB], [j.shA, j.elA, j.hA]] as [number, number][][]) {
      limb(s0 as [number, number], el as [number, number], 0.13, LIME);
      limb(el as [number, number], hd as [number, number], 0.1, LIME_D);
      const G = P(hd as [number, number]);
      ctx.fillStyle = "#f2ead7";
      ctx.beginPath();
      ctx.arc(G.x, G.y, sc * 0.125, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ff6b4a";
      ctx.lineWidth = Math.max(1, sc * 0.025);
      ctx.beginPath();
      ctx.arc(G.x, G.y, sc * 0.125, 0, Math.PI * 2);
      ctx.stroke();
    }
    // head
    const Hd = P(j.head), Nk = P(j.sh);
    ctx.strokeStyle = "#5a3e2b";
    ctx.lineWidth = sc * 0.09;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(Nk.x, Nk.y);
    ctx.lineTo(Hd.x, Hd.y);
    ctx.stroke();
    ctx.fillStyle = "#6b4a33";
    ctx.beginPath();
    ctx.arc(Hd.x, Hd.y, sc * 0.125, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c1612";
    ctx.beginPath();
    ctx.arc(Hd.x, Hd.y - sc * 0.03, sc * 0.125, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    // eyes: he turns his head toward the cursor, so you can see what he is looking at
    ctx.fillStyle = "#f2ead7";
    for (const e of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(Hd.x + look * sc * 0.07 + e * sc * 0.04 * (1 - Math.abs(look) * 0.35), Hd.y + sc * 0.015, Math.max(1, sc * 0.016), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // a finger or a mouse: useCanvas hands the piece a position only, so the pointer type is read here
  useEffect(() => {
    const c = ref.current;
    if (!c || !play) return;
    const kind = (e: PointerEvent) => {
      S.current.touch = e.pointerType === "touch";
    };
    c.addEventListener("pointerdown", kind, true);
    c.addEventListener("pointermove", kind, true);
    return () => {
      c.removeEventListener("pointerdown", kind, true);
      c.removeEventListener("pointermove", kind, true);
    };
  }, [ref, play]);

  // keep the picked shot in view when the row scrolls (keys 1-7, or X / Z)
  useEffect(() => {
    pills.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [shot]);

  const def = shotById(shot);
  const body = (
    <>
    <canvas
      ref={ref}
      data-autofocus={play || undefined}
      role={play ? "img" : undefined}
      aria-label={
        play
          ? "A penalty kick. Pick a shot with the buttons or keys 1 to 7. Aim with the pointer or arrow keys, hold to power up, release to shoot. R replays the last kick."
          : undefined
      }
      className="absolute inset-0 w-full h-full outline-none touch-none"
    />
    {linked && (
      <p
        data-testid="penalty-phone-hint"
        className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-[#0d100e]/80 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f2ead7]"
      >
        <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-[#8ad9a8] align-middle" />
        Swipe on your phone
      </p>
    )}
    </>
  );
  if (!play) return body;
  return (
    <div className="absolute inset-0 flex flex-col bg-[#081226]">
      {/* Phones: the shots are one swipeable row (Replay stays put beside it) and the
          blurb one line, so the pitch keeps the height. Touch screens have no keys 1-7 or R,
          so those hints go. */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 bg-[#0d100e]">
        <div
          ref={pills}
          className="flex flex-1 min-w-0 gap-1.5 overflow-x-auto snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible"
        >
          {SHOTS.map((sh, i) => (
            <button
              key={sh.id}
              type="button"
              aria-pressed={shot === sh.id}
              onClick={() => pickShot(sh.id)}
              className={`h-8 shrink-0 snap-start px-3 rounded-full font-mono text-[11px] uppercase tracking-[0.12em] border ${
                shot === sh.id ? "bg-[#f2ead7] text-[#0d100e] border-transparent" : "border-white/15 text-[#f2ead7] hover:bg-white/10"
              }`}
            >
              <span className="opacity-50 mr-1.5 [@media(hover:none)]:hidden [@media(pointer:coarse)]:hidden">{i + 1}</span>
              {sh.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!hasKick}
          onClick={() => {
            S.current.replayReq = true;
          }}
          className="h-8 shrink-0 px-3 rounded-full font-mono text-[11px] uppercase tracking-[0.12em] border border-white/15 text-[#b5b6ab] hover:text-[#f2ead7] disabled:opacity-35 disabled:hover:text-[#b5b6ab]"
        >
          Replay <span className="opacity-50 [@media(hover:none)]:hidden [@media(pointer:coarse)]:hidden">R</span>
        </button>
      </div>
      <p className="px-3 pb-2 bg-[#0d100e] font-mono text-[11px] leading-snug text-[#b5b6ab] truncate sm:whitespace-normal sm:overflow-visible sm:min-h-[1.4em]">{def.blurb}</p>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      <div className="relative flex-1 min-h-0">{body}</div>
    </div>
  );
}
