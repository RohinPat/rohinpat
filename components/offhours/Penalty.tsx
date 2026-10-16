"use client";

import { useRef } from "react";
import { seeded, useCanvas, type PieceProps } from "./useCanvas";
import { burst, getAudio, tone } from "./audio";
import { display, mono } from "./font";

// A penalty from behind the ball, in real units (goal 7.32 × 2.44 m, spot
// 11 m out) through a perspective camera. Aim with the pointer, hold to
// power up — harder is faster but wilder, and too hard goes over. The keeper
// guesses a side the moment you strike and dives; reach shrinks for the top
// corners. Goals hit a net simulated as a spring grid that ripples out from
// the impact. Best of five.

const GW = 3.66; // half goal width
const GH = 2.44;
const SPOT_Z = 0;
const GOAL_Z = 11;
const NET_Z = 12.2;
const CAM = { y: 1.45, z: -4.6 };
const COLS = 17, ROWS = 7;

type Ball = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number };
type Kick = "goal" | "save" | "miss" | "post";

export default function Penalty({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const S = useRef({
    phase: "aim" as "aim" | "fly" | "after" | "over",
    aim: { x: 1.8, y: 1.6 },
    power: 0,
    charging: false,
    ball: { x: 0, y: 0.11, z: SPOT_Z, vx: 0, vy: 0, vz: 0, spin: 0 } as Ball,
    target: { x: 0, y: 0 },
    keeper: { x: 0, dive: 0, dir: 0, h: 0, t: 0, start: 0.22 },
    net: { z: new Float32Array(COLS * ROWS), v: new Float32Array(COLS * ROWS) },
    kicks: [] as Kick[],
    result: "" as "" | Kick,
    resultT: 0,
    flash: 0,
    timer: 0,
    auto: 1,
  });
  const crowd = useRef(
    (() => {
      const r = seeded(10);
      return Array.from({ length: 900 }, () => ({ x: r(), y: r(), c: r() }));
    })(),
  );
  const cam = useRef({ f: 1, cx: 0, cy: 0 });

  const proj = (x: number, y: number, z: number) => {
    const { f, cx, cy } = cam.current;
    const d = Math.max(0.3, z - CAM.z);
    return { x: cx + (f * x) / d, y: cy - (f * (y - CAM.y)) / d, s: f / d };
  };
  // screen → point on the goal plane
  const unproj = (sx: number, sy: number) => {
    const { f, cx, cy } = cam.current;
    const d = GOAL_Z - CAM.z;
    return { x: ((sx - cx) * d) / f, y: CAM.y - ((sy - cy) * d) / f };
  };

  const sfx = (k: "kick" | "net" | "roar" | "save" | "post" | "ooh") => {
    if (!play) return;
    const au = getAudio();
    if (!au) return;
    if (k === "kick") {
      tone(au, { freq: 140, to: 60, dur: 0.12, gain: 0.5 });
      burst(au, { freq: 900, type: "lowpass", dur: 0.04, gain: 0.3 });
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
    else if (k === "post") {
      tone(au, { freq: 880, dur: 0.6, gain: 0.15, type: "triangle" });
      tone(au, { freq: 2210, dur: 0.3, gain: 0.06 });
    } else tone(au, { freq: 330, to: 180, dur: 0.7, gain: 0.08, type: "triangle" });
  };

  const strike = (power: number) => {
    const s = S.current;
    if (s.phase !== "aim") return;
    // harder: faster, wider spread, and it climbs
    const spread = 0.15 + power * power * 0.9;
    const tx = s.aim.x + (Math.random() - 0.5) * spread;
    const ty = Math.max(0.15, s.aim.y + (Math.random() - 0.5) * spread * 0.6 + Math.max(0, power - 0.8) * 2.6);
    s.target = { x: tx, y: ty };
    const T = 0.95 - power * 0.5; // flight time to the goal line
    const b = s.ball;
    b.vx = tx / T;
    b.vz = (GOAL_Z - SPOT_Z) / T;
    b.vy = (ty - 0.11 + 0.5 * 9.8 * T * T) / T;
    b.spin = (Math.random() - 0.5) * 2;
    s.phase = "fly";
    s.timer = 0;
    // the keeper guesses: reads your side a bit more often than not
    const side = tx < -1.1 ? -1 : tx > 1.1 ? 1 : 0;
    const read = Math.random() < 0.5;
    const dir = read ? side : ([-1, 0, 1].filter((d) => d !== side)[Math.floor(Math.random() * 2)] as number);
    s.keeper = { x: 0, dive: 0, dir, h: dir === 0 ? (ty > 1.4 ? 1 : 0) : ty > 1.3 ? 1 : 0, t: 0, start: 0.16 + Math.random() * 0.1 };
    sfx("kick");
  };

  const ref = useCanvas(
    ({ ctx, w, h, t, dt, p }) => {
      const s = S.current;
      const f = Math.min(w * 1.12, h * 1.7);
      cam.current = { f, cx: w / 2, cy: h * 0.86 - (f * (CAM.y - 0.11)) / (SPOT_Z - CAM.z) };

      // --- update
      if (play && p.inside && s.phase === "aim") {
        const g = unproj(p.x, p.y);
        s.aim = { x: Math.max(-GW - 1, Math.min(GW + 1, g.x)), y: Math.max(0.1, Math.min(GH + 1, g.y)) };
      }
      if (s.charging) s.power = Math.min(1, s.power + dt * 0.9);
      if (!play && s.phase === "aim") {
        s.auto -= dt;
        if (s.auto < 0.9) s.aim = { x: (s.aim.x + (s.auto < 0.5 ? 0 : 0)) * 1, y: s.aim.y };
        if (s.auto <= 0) {
          s.aim = { x: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 1.9), y: 0.3 + Math.random() * 1.9 };
          strike(0.45 + Math.random() * 0.4);
          s.auto = 2.4;
        }
      }
      sim(s, dt, t);
      // net springs
      const { z, v } = s.net;
      for (let j = 0; j < ROWS; j++)
        for (let i = 0; i < COLS; i++) {
          const k = j * COLS + i;
          if (i === 0 || i === COLS - 1 || j === ROWS - 1) continue;
          const lap = z[k - 1] + z[k + 1] + (j > 0 ? z[k - COLS] : 0) + z[k + COLS] - 4 * z[k];
          v[k] += (lap * 60 - z[k] * 18) * dt;
          v[k] *= 1 - 2.2 * dt;
        }
      for (let k = 0; k < z.length; k++) z[k] += v[k] * dt;

      // --- draw: sky + stands
      ctx.fillStyle = "#081226";
      ctx.fillRect(0, 0, w, h);
      const top = proj(0, GH + 6, GOAL_Z + 14).y;
      const standBot = proj(0, 0, GOAL_Z + 9).y;
      for (const c of crowd.current) {
        const x = c.x * w, y = top + c.y * (standBot - top);
        const flash = s.flash > 0 && c.c > 0.985;
        ctx.fillStyle = flash ? "#ffffff" : c.c < 0.45 ? "#a50044" : c.c < 0.9 ? "#004d98" : "#edbb00";
        ctx.globalAlpha = 0.35 + c.y * 0.4;
        ctx.fillRect(x, y + Math.sin(t * 6 + c.x * 40) * (s.flash > 0 ? 1.5 : 0.3), 2, 2);
      }
      ctx.globalAlpha = 1;
      // pitch
      const pitchTop = standBot;
      const grad = ctx.createLinearGradient(0, pitchTop, 0, h);
      grad.addColorStop(0, "#1f6b33");
      grad.addColorStop(1, "#2f8a43");
      ctx.fillStyle = grad;
      ctx.fillRect(0, pitchTop, w, h - pitchTop);
      // mowing stripes
      for (let zz = -4; zz < GOAL_Z + 9; zz += 2) {
        const a = proj(0, 0, zz).y, b2 = proj(0, 0, zz + 1).y;
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        ctx.fillRect(0, b2, w, a - b2);
      }
      // lines: goal line, 6-yard box, penalty spot
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

      // LED boards behind the goal
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
      let bx0 = -((t * 50) % (tw * 2));
      for (let i = 0; bx0 < w; i++, bx0 += tw) {
        ctx.fillStyle = s.flash > 0 ? (Math.floor(t * 8) % 2 ? "#edbb00" : "#f2ead7") : i % 2 ? "#0b4a8c" : "#8c0b45";
        ctx.fillText(msg, bx0, bb.y - (bb.y - bt.y) * 0.2);
      }
      ctx.restore();

      // net: back panel with the ripple, then side and top panels
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      const node = (i: number, j: number) => {
        const x = -GW + (i / (COLS - 1)) * GW * 2;
        const y = GH - (j / (ROWS - 1)) * GH;
        return proj(x, y, NET_Z + z[j * COLS + i]);
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
      for (let i = 0; i < COLS; i += 2) line([[-GW + (i / (COLS - 1)) * GW * 2, GH, GOAL_Z], [-GW + (i / (COLS - 1)) * GW * 2, GH, NET_Z]]);
      for (let j = 0; j < ROWS; j += 2) {
        const y = GH - (j / (ROWS - 1)) * GH;
        line([[-GW, y, GOAL_Z], [-GW, y, NET_Z]]);
        line([[GW, y, GOAL_Z], [GW, y, NET_Z]]);
      }
      ctx.stroke();

      // keeper (behind the goal line, in front of the net)
      drawKeeper(ctx, s.keeper);

      // ball (behind the frame once it's past the line)
      const drawBall = () => {
        const b = s.ball;
        const q = proj(b.x, b.y, b.z);
        const sh = proj(b.x, 0, b.z);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.ellipse(sh.x, sh.y, q.s * 0.13, q.s * 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
        const r = Math.max(2, q.s * 0.11);
        ctx.fillStyle = "#f7f7f2";
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1a1a1a";
        for (let k = 0; k < 3; k++) {
          const a = t * b.spin * 4 + k * 2.1;
          ctx.beginPath();
          ctx.arc(q.x + Math.cos(a) * r * 0.5, q.y + Math.sin(a) * r * 0.5, r * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      if (s.ball.z > GOAL_Z) drawBall();
      // frame
      const lp = proj(-GW, 0, GOAL_Z), lt = proj(-GW, GH, GOAL_Z), rt = proj(GW, GH, GOAL_Z), rp = proj(GW, 0, GOAL_Z);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(3, lp.s * 0.12);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(lp.x, lp.y);
      ctx.lineTo(lt.x, lt.y);
      ctx.lineTo(rt.x, rt.y);
      ctx.lineTo(rp.x, rp.y);
      ctx.stroke();
      if (s.ball.z <= GOAL_Z) drawBall();

      // aim reticle + power
      if (play && s.phase === "aim") {
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
        const bw = Math.min(220, w * 0.4), bx = w / 2 - bw / 2, by = h - 22;
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(bx, by, bw, 8);
        ctx.fillStyle = s.power > 0.82 ? "#ff6b4a" : "#edbb00";
        ctx.fillRect(bx, by, bw * s.power, 8);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillRect(bx + bw * 0.82, by - 3, 2, 14);
      }

      // scoreboard
      const goals = s.kicks.filter((k) => k === "goal").length;
      ctx.fillStyle = "rgba(8,18,38,0.75)";
      const sw = play ? 220 : 150;
      ctx.fillRect(12, 12, sw, play ? 54 : 38);
      ctx.fillStyle = "#a50044";
      ctx.fillRect(12, 12, 5, play ? 54 : 38);
      ctx.fillStyle = "#004d98";
      ctx.fillRect(17, 12, 5, play ? 54 : 38);
      ctx.fillStyle = "#f2ead7";
      display(ctx, play ? 22 : 15, 800);
      ctx.fillText(`BARÇA ${goals}`, 32, play ? 38 : 30);
      for (let i = 0; i < 5; i++) {
        const k = s.kicks[i];
        ctx.beginPath();
        ctx.arc(32 + i * (play ? 16 : 11) + 4, play ? 54 : 42, play ? 5 : 3.5, 0, Math.PI * 2);
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
      // result call
      if (s.result && t - s.resultT < 1.6) {
        const a = Math.min(1, (1.6 - (t - s.resultT)) * 2);
        ctx.globalAlpha = a;
        ctx.fillStyle = s.result === "goal" ? "#edbb00" : "#f2ead7";
        display(ctx, Math.round(Math.min(w, h) * (play ? 0.16 : 0.2)), 800);
        ctx.textAlign = "center";
        const word = { goal: "GOOOL", save: "SAVED", miss: s.target.y > GH ? "OVER" : "WIDE", post: "POST" }[s.result];
        ctx.fillText(word, w / 2, h * 0.45);
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
      }
      if (s.phase === "over") {
        ctx.fillStyle = "rgba(8,18,38,0.7)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#f2ead7";
        ctx.textAlign = "center";
        display(ctx, Math.round(Math.min(w, h) * 0.13), 800);
        ctx.fillText(goals >= 4 ? "CAMPIONS" : goals >= 3 ? "WON IT" : "NEXT TIME", w / 2, h * 0.45);
        mono(ctx, 12);
        ctx.fillText(`${goals} OF 5 · CLICK TO GO AGAIN`, w / 2, h * 0.45 + 30);
        ctx.textAlign = "left";
      }
      s.flash = Math.max(0, s.flash - dt);
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      onDown: () => {
        const s = S.current;
        if (s.phase === "over") {
          s.kicks = [];
          s.phase = "aim";
          return;
        }
        if (s.phase === "aim") {
          s.charging = true;
          s.power = 0;
        }
      },
      onUp: () => {
        const s = S.current;
        if (!s.charging) return;
        s.charging = false;
        strike(s.power);
        s.power = 0;
      },
    },
  );

  function sim(s: typeof S.current, dt: number, t: number) {
    const k = s.keeper;
    if (s.phase === "fly" || s.phase === "after") {
      k.t += dt;
      if (k.t > k.start) k.dive = Math.min(1, k.dive + dt * 3.2);
    } else {
      k.dive = Math.max(0, k.dive - dt * 2);
      k.x = Math.sin(t * 1.7) * 0.25; // shuffle on the line
    }
    if (s.phase === "fly") {
      s.timer += dt;
      const b = s.ball;
      const pz = b.z;
      b.vy -= 9.8 * dt;
      b.vx += b.spin * 0.6 * dt; // a little bend
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < 0.11) {
        b.y = 0.11;
        b.vy = Math.abs(b.vy) * 0.5;
      }
      // crossing the goal line: decide
      if (pz < GOAL_Z && b.z >= GOAL_Z) {
        const hx = keeperReach(k);
        const near = (px: number, py: number) => Math.hypot(b.x - px, b.y - py);
        const onFrame = (Math.abs(Math.abs(b.x) - GW) < 0.16 && b.y < GH + 0.1) || (Math.abs(b.y - GH) < 0.14 && Math.abs(b.x) < GW + 0.1);
        if (onFrame) end(s, "post", t);
        else if (Math.abs(b.x) > GW || b.y > GH) end(s, "miss", t, false);
        else if (near(hx.x, hx.y) < hx.r) end(s, "save", t);
        else end(s, "goal", t, false);
      }
    } else if (s.phase === "after") {
      s.timer += dt;
      const b = s.ball;
      b.vy -= 9.8 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < 0.11) {
        b.y = 0.11;
        b.vy = Math.abs(b.vy) * 0.4;
        b.vx *= 0.8;
        b.vz *= 0.8;
      }
      if (s.result === "goal" && b.z > NET_Z - 0.15) {
        // into the net: give it the energy, stop the ball
        const i = Math.round(((b.x + GW) / (GW * 2)) * (COLS - 1));
        const j = Math.round(((GH - b.y) / GH) * (ROWS - 1));
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii > 0 && ii < COLS - 1 && jj >= 0 && jj < ROWS - 1) s.net.v[jj * COLS + ii] += (di || dj ? 1.2 : 2.6) * (b.vz / 10);
          }
        b.z = NET_Z - 0.15;
        b.vz = -0.6;
        b.vx *= 0.2;
      }
      if (s.timer > 2.2) {
        if (s.kicks.length >= 5) {
          s.phase = "over";
          if (!play) {
            s.kicks = [];
            s.phase = "aim";
          }
        } else s.phase = "aim";
        s.ball = { x: 0, y: 0.11, z: SPOT_Z, vx: 0, vy: 0, vz: 0, spin: 0 };
      }
    }
  }

  function keeperReach(k: typeof S.current.keeper) {
    // hands: centre of the goal, out to ~2.9 m at full stretch, low or high
    const reachX = k.x + k.dir * k.dive * 2.6;
    const reachY = 1.0 + (k.h ? 0.9 : -0.35) * k.dive * (k.dir ? 1 : 0.6) + (k.dir === 0 ? 0.4 : 0);
    return { x: reachX, y: reachY, r: k.dir === 0 ? 1.0 : 0.8 };
  }

  function end(s: typeof S.current, r: Kick, t: number, bounce = true) {
    s.result = r;
    s.resultT = t;
    s.kicks.push(r);
    s.phase = "after";
    s.timer = 0;
    const b = s.ball;
    if (r === "goal") {
      s.flash = 1.4;
      sfx("net");
      sfx("roar");
    } else if (r === "save") {
      sfx("save");
      sfx("ooh");
    } else if (r === "post") {
      sfx("post");
      sfx("ooh");
    } else sfx("ooh");
    if (bounce && r !== "goal") {
      b.vz = -b.vz * 0.35;
      b.vx = (Math.random() - 0.5) * 6;
      b.vy = Math.abs(b.vy) * 0.4 + 1.5;
    }
  }

  function drawKeeper(ctx: CanvasRenderingContext2D, k: typeof S.current.keeper) {
    const reach = keeperReach(k);
    const base = proj(k.x + k.dir * k.dive * 1.3, 0, GOAL_Z - 0.3);
    const sc = base.s;
    ctx.save();
    ctx.translate(base.x, base.y);
    const lean = k.dir * k.dive * (k.h ? 1.05 : 1.35);
    ctx.rotate(lean);
    const lift = k.dive * sc * (k.h ? 0.9 : 0.25);
    ctx.translate(0, -lift);
    // legs, body, arms, head (kit: electric lime)
    ctx.strokeStyle = "#141414";
    ctx.lineCap = "round";
    ctx.lineWidth = sc * 0.16;
    ctx.beginPath();
    ctx.moveTo(-sc * 0.12, 0);
    ctx.lineTo(-sc * 0.1, -sc * 0.85);
    ctx.moveTo(sc * 0.12, 0);
    ctx.lineTo(sc * 0.1, -sc * 0.85);
    ctx.stroke();
    ctx.fillStyle = "#c6f24e";
    ctx.fillRect(-sc * 0.24, -sc * 1.55, sc * 0.48, sc * 0.75);
    ctx.strokeStyle = "#c6f24e";
    ctx.lineWidth = sc * 0.13;
    const armUp = k.dive > 0.2 ? -1 : 0.25;
    ctx.beginPath();
    ctx.moveTo(-sc * 0.22, -sc * 1.45);
    ctx.lineTo(-sc * 0.55, -sc * (1.45 + 0.55 * -armUp * -1));
    ctx.moveTo(sc * 0.22, -sc * 1.45);
    ctx.lineTo(sc * 0.55, -sc * (1.45 + 0.55 * -armUp * -1));
    ctx.stroke();
    ctx.fillStyle = "#f2ead7";
    for (const sx of [-0.58, 0.58]) {
      ctx.beginPath();
      ctx.arc(sx * sc, -sc * (1.45 + 0.55 * armUp), sc * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#6b4a33";
    ctx.beginPath();
    ctx.arc(0, -sc * 1.75, sc * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    void reach;
  }

  return (
    <canvas
      ref={ref}
      data-autofocus={play || undefined}
      role={play ? "img" : undefined}
      aria-label={play ? "A penalty kick. Aim with the pointer or arrow keys, hold to power up, release to shoot." : undefined}
      className="absolute inset-0 w-full h-full outline-none touch-none"
    />
  );
}
