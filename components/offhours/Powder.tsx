"use client";

import { useEffect, useRef } from "react";
import { seeded, useCanvas, type PieceProps } from "./useCanvas";
import { getAudio, noise, type Audio } from "./audio";
import { display, mono } from "./font";

// First tracks. A perspective camera follows a skier down an untouched
// slope at golden hour. Move to steer: the skis leave two grooves in the
// snow that stream away behind you, sharper turns throw more powder (3D
// particles), trees rush past, the ridgelines drift with parallax. Hold to
// tuck. The sound is filtered noise: wind with speed, a hiss with the carve.

const COLORS = ["#e9d9c8", "#c9b4a6", "#8f7f7c"];

type P3 = { x: number; y: number; z: number };
type Spray = P3 & { vx: number; vy: number; vz: number; life: number };

function ridge(seed: number, n: number) {
  const r = seeded(seed);
  let pts = [r(), r()];
  let rough = 0.5;
  while (pts.length < n) {
    const next: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) next.push(pts[i], (pts[i] + pts[i + 1]) / 2 + (r() - 0.5) * rough);
    next.push(pts[pts.length - 1]);
    pts = next;
    rough *= 0.55;
  }
  const lo = Math.min(...pts), hi = Math.max(...pts);
  return pts.map((v) => (v - lo) / (hi - lo || 1));
}

type Wind = { src: AudioBufferSourceNode; wind: GainNode; windF: BiquadFilterNode; hiss: GainNode };
function startWind({ ctx, out }: Audio): Wind {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const windF = ctx.createBiquadFilter();
  windF.type = "lowpass";
  windF.frequency.value = 400;
  const wind = ctx.createGain();
  wind.gain.value = 0;
  const hissF = ctx.createBiquadFilter();
  hissF.type = "bandpass";
  hissF.frequency.value = 3500;
  hissF.Q.value = 0.7;
  const hiss = ctx.createGain();
  hiss.gain.value = 0;
  src.connect(windF).connect(wind).connect(out);
  src.connect(hissF).connect(hiss).connect(out);
  src.start();
  return { src, wind, windF, hiss };
}

export default function Powder({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const ridges = useRef(COLORS.map((_, i) => ridge(31 + i * 9, 129)));
  const S = useRef({
    x: 0,
    z: 0,
    vx: 0,
    speed: 9,
    heading: 0,
    lean: 0,
    tuck: false,
    target: 0,
    tracks: [] as { l: P3; r: P3 }[],
    spray: [] as Spray[],
    trees: [] as { x: number; z: number; s: number }[],
    flakes: [] as { x: number; y: number; r: number }[],
    dist: 0,
    carve: 0,
    keyMode: false,
  });
  const audio = useRef<Wind | null>(null);
  const cam = useRef({ x: 0, z: -10, f: 1, hz: 0 });

  useEffect(
    () => () => {
      audio.current?.src.stop();
    },
    [],
  );

  if (!S.current.trees.length) {
    const r = seeded(4);
    S.current.trees = Array.from({ length: 70 }, (_, i) => ({ x: (r() < 0.5 ? -1 : 1) * (6 + r() * 26), z: i * 4 + r() * 4, s: 0.7 + r() * 0.8 }));
    S.current.flakes = Array.from({ length: 140 }, () => ({ x: r(), y: r(), r: 0.6 + r() * 1.6 }));
  }

  const ensureAudio = () => {
    if (!play || audio.current) return;
    const au = getAudio();
    if (au) audio.current = startWind(au);
  };

  const ref = useCanvas(
    ({ ctx, w, h, dt, t, p }) => {
      const s = S.current;
      const f = Math.min(w * 0.75, h * 1.6);
      const hz = h * 0.38;
      const c = cam.current;
      c.f = f;
      c.hz = hz;

      // steer toward the pointer (preview: a lazy slalom)
      if (play && p.inside && !s.keyMode) {
        const d = 10; // pointer is read at the skier's depth
        s.target = c.x + ((p.x - w / 2) * d) / f;
      } else if (!play || (!p.inside && !s.keyMode)) {
        s.target = Math.sin(t * 0.7) * 4.5 + Math.sin(t * 1.9) * 1.2;
      }
      const prevHeading = s.heading;
      const want = Math.max(-1.1, Math.min(1.1, (s.target - s.x) * 0.55));
      s.heading += (want - s.heading) * Math.min(1, dt * 3.2);
      const turn = (s.heading - prevHeading) / Math.max(dt, 1e-3);
      s.carve += (Math.min(1, Math.abs(turn) * 0.9) - s.carve) * Math.min(1, dt * 6);
      s.lean += (-turn * 0.18 - s.lean) * Math.min(1, dt * 8);
      // speed: fall line is fastest, traversing bleeds speed; tuck adds
      const top = s.tuck ? 22 : 15;
      s.speed += ((top * Math.cos(s.heading) ** 2 - s.speed) * 0.4 + (s.tuck ? 1.5 : 0)) * dt;
      s.speed = Math.max(4, s.speed);
      const vz = s.speed * Math.cos(s.heading);
      s.vx = s.speed * Math.sin(s.heading);
      s.x += s.vx * dt;
      s.z += vz * dt;
      s.dist += vz * dt;
      c.x += (s.x - c.x) * Math.min(1, dt * 2.5);
      c.z = s.z - 10;

      // tracks: two grooves
      const nx = Math.cos(s.heading), nz = -Math.sin(s.heading);
      s.tracks.push({ l: { x: s.x - nx * 0.16, y: 0, z: s.z - nz * 0.16 }, r: { x: s.x + nx * 0.16, y: 0, z: s.z + nz * 0.16 } });
      while (s.tracks.length && s.tracks[0].l.z < c.z + 0.6) s.tracks.shift();
      if (s.tracks.length > 900) s.tracks.shift();
      // powder spray, thrown to the outside of the turn
      const n = Math.round(s.carve * 18 + (s.speed > 14 ? 2 : 0));
      for (let i = 0; i < n; i++) {
        const side = Math.sign(turn) || 1;
        s.spray.push({
          x: s.x + side * 0.3,
          y: 0.05,
          z: s.z,
          vx: side * (1.5 + Math.random() * 3) + s.vx * 0.3,
          vy: 1 + Math.random() * 2.8 * s.carve,
          vz: vz * (0.4 + Math.random() * 0.4),
          life: 1,
        });
      }
      for (const q of s.spray) {
        q.vy -= 9.8 * dt;
        q.x += q.vx * dt;
        q.y = Math.max(0, q.y + q.vy * dt);
        q.z += q.vz * dt;
        q.vx *= 1 - dt * 2;
        q.life -= dt * 1.4;
      }
      s.spray = s.spray.filter((q) => q.life > 0);
      for (const tr of s.trees) if (tr.z < c.z) {
        tr.z += 280;
        tr.x = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 26) + c.x;
      }

      // sound
      const a = audio.current;
      const au = a && getAudio();
      if (a && au) {
        const now = au.ctx.currentTime;
        a.wind.gain.setTargetAtTime(Math.min(0.5, s.speed / 40), now, 0.1);
        a.windF.frequency.setTargetAtTime(200 + s.speed * 40, now, 0.1);
        a.hiss.gain.setTargetAtTime(s.carve * 0.35, now, 0.05);
      }

      // --- draw
      const P = (x: number, y: number, z: number) => {
        const d = Math.max(0.2, z - c.z);
        return { x: w / 2 + (f * (x - c.x)) / d, y: hz + (f * (2.4 - y)) / d * 0.5, s: f / d };
      };
      const sky = ctx.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, "#f6e7d3");
      sky.addColorStop(0.8, "#f1c9a5");
      sky.addColorStop(1, "#ee9f78");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, hz + 2);
      ctx.fillStyle = "#f0a35c";
      ctx.beginPath();
      ctx.arc(w * 0.7 - c.x * 2, hz * 0.62, Math.min(w, h) * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ridges.current.forEach((pts, i) => {
        const depth = (i + 1) / 3;
        const shift = -c.x * 6 * depth;
        const amp = hz * (0.55 - depth * 0.18);
        ctx.fillStyle = COLORS[i];
        ctx.beginPath();
        ctx.moveTo(-80, hz + 2);
        pts.forEach((v, k) => ctx.lineTo(-80 + (k / (pts.length - 1)) * (w + 160) + ((shift % 80) + 0), hz + 2 - v * amp));
        ctx.lineTo(w + 80, hz + 2);
        ctx.fill();
      });
      // the slope: lit snow, bluer toward you
      const snow = ctx.createLinearGradient(0, hz, 0, h);
      snow.addColorStop(0, "#f7efe6");
      snow.addColorStop(1, "#dfe7ef");
      ctx.fillStyle = snow;
      ctx.fillRect(0, hz, w, h - hz);
      // subtle wind ripples in the snow
      ctx.strokeStyle = "rgba(160,180,205,0.18)";
      ctx.lineWidth = 1;
      for (let zz = Math.ceil(c.z / 3) * 3; zz < c.z + 120; zz += 3) {
        const q = P(c.x, 0, zz);
        if (q.y > h) continue;
        ctx.beginPath();
        ctx.moveTo(0, q.y);
        ctx.quadraticCurveTo(w / 2, q.y + Math.sin(zz) * q.s * 0.05, w, q.y);
        ctx.stroke();
      }
      // trees (far to near)
      const trees = s.trees.filter((tr) => tr.z > c.z + 1 && tr.z < c.z + 200).sort((a2, b2) => b2.z - a2.z);
      const drawTree = (tr: { x: number; z: number; s: number }) => {
        const base = P(tr.x, 0, tr.z);
        const hgt = base.s * 5 * tr.s * 0.5, wid = base.s * 1.6 * tr.s * 0.5;
        ctx.fillStyle = "#24302a";
        ctx.beginPath();
        ctx.moveTo(base.x, base.y - hgt);
        ctx.lineTo(base.x - wid, base.y);
        ctx.lineTo(base.x + wid, base.y);
        ctx.fill();
        ctx.fillStyle = "rgba(247,239,230,0.85)";
        ctx.beginPath();
        ctx.moveTo(base.x, base.y - hgt);
        ctx.lineTo(base.x - wid * 0.35, base.y - hgt * 0.62);
        ctx.lineTo(base.x + wid * 0.2, base.y - hgt * 0.68);
        ctx.fill();
      };
      for (const tr of trees) if (tr.z > s.z) drawTree(tr);
      // grooves
      for (const side of ["l", "r"] as const) {
        ctx.strokeStyle = "rgba(120,140,170,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (const tk of s.tracks) {
          const q = P(tk[side].x, 0, tk[side].z);
          ctx.lineWidth = Math.max(1, q.s * 0.06);
          if (!started) {
            ctx.moveTo(q.x, q.y);
            started = true;
          } else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
      }
      // skier
      const sk = P(s.x, 0, s.z);
      const sc = sk.s;
      ctx.save();
      ctx.translate(sk.x, sk.y);
      // skis
      ctx.strokeStyle = "#0d100e";
      ctx.lineWidth = Math.max(2, sc * 0.05);
      ctx.lineCap = "round";
      for (const o of [-0.16, 0.16]) {
        ctx.beginPath();
        ctx.moveTo(o * sc - Math.sin(s.heading) * sc * 0.2, sc * 0.03);
        ctx.lineTo(o * sc + Math.sin(s.heading) * sc * 0.9, -sc * 0.35);
        ctx.stroke();
      }
      ctx.rotate(s.lean);
      const crouch = s.tuck ? 0.75 : 1;
      // legs, jacket, head, poles
      ctx.strokeStyle = "#20262b";
      ctx.lineWidth = sc * 0.1;
      ctx.beginPath();
      ctx.moveTo(-sc * 0.12, 0);
      ctx.lineTo(-sc * 0.08, -sc * 0.5 * crouch);
      ctx.moveTo(sc * 0.12, 0);
      ctx.lineTo(sc * 0.08, -sc * 0.5 * crouch);
      ctx.stroke();
      ctx.fillStyle = "#1d5e3f";
      ctx.beginPath();
      ctx.ellipse(0, -sc * 0.78 * crouch, sc * 0.2, sc * 0.3 * crouch, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e9d9c8";
      ctx.beginPath();
      ctx.arc(0, -sc * 1.12 * crouch, sc * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0d100e";
      ctx.fillRect(-sc * 0.1, -sc * 1.15 * crouch, sc * 0.2, sc * 0.05); // goggles strap
      ctx.strokeStyle = "#c9c4b8";
      ctx.lineWidth = Math.max(1, sc * 0.02);
      ctx.beginPath();
      ctx.moveTo(-sc * 0.22, -sc * 0.75 * crouch);
      ctx.lineTo(-sc * 0.42, sc * 0.02);
      ctx.moveTo(sc * 0.22, -sc * 0.75 * crouch);
      ctx.lineTo(sc * 0.42, sc * 0.02);
      ctx.stroke();
      ctx.restore();
      // spray (in front of the skier when near)
      for (const q of s.spray) {
        const pp = P(q.x, q.y, q.z);
        ctx.fillStyle = `rgba(255,255,255,${q.life * 0.9})`;
        const r = Math.max(0.8, pp.s * 0.035);
        ctx.fillRect(pp.x - r, pp.y - r, r * 2, r * 2);
      }
      for (const tr of trees) if (tr.z <= s.z) drawTree(tr);
      // falling snow, streaking with speed
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const fl of s.flakes) {
        fl.y += (0.05 + s.speed * 0.012) * dt * (fl.r);
        fl.x -= (s.vx * 0.004) * dt * 10;
        if (fl.y > 1) fl.y -= 1;
        if (fl.x < 0) fl.x += 1;
        if (fl.x > 1) fl.x -= 1;
        ctx.fillRect(fl.x * w, fl.y * h, fl.r, fl.r * (1 + s.speed * 0.08));
      }
      // HUD
      ctx.fillStyle = "rgba(13,16,14,0.7)";
      mono(ctx, play ? 11 : 9);
      ctx.fillText(`${Math.round(s.speed * 3.6)} KM/H · ${Math.round(s.dist)} M${s.tuck ? " · TUCK" : ""}`, 14, h - 14);
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      onMove: () => {
        ensureAudio();
        S.current.keyMode = false;
      },
      onDown: () => {
        ensureAudio();
        S.current.tuck = true;
      },
      onUp: () => {
        S.current.tuck = false;
      },
      keys: (e, down) => {
        const s = S.current;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          ensureAudio();
          s.keyMode = true;
          if (down) s.target = s.x + (e.key === "ArrowLeft" ? -4 : 4);
          return true;
        }
        if (e.key === " " || e.key === "ArrowDown") {
          ensureAudio();
          s.tuck = down;
          return true;
        }
        return false;
      },
    },
  );

  return (
    <canvas
      ref={ref}
      data-autofocus={play || undefined}
      role={play ? "img" : undefined}
      aria-label={play ? "Skiing fresh powder. Move the pointer or use the arrow keys to carve; hold the button or Space to tuck." : undefined}
      className="absolute inset-0 w-full h-full outline-none touch-none"
    />
  );
}
