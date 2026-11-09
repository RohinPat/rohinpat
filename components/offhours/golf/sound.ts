"use client";

import { burst, getAudio, modal, noise, tone, type Audio } from "../audio";

// Golf sounds, all synthesized: a putter tick, the ball rattling into the
// cup, a club whooshing through the air and cracking the ball, turf thuds.

export type Sfx = "putt" | "cup" | "lip" | "tick" | "good" | "swish" | "strikeWood" | "strikeIron" | "thud" | "land" | "pickup" | "fanfare" | "splash" | "sand" | "applause";

/** a small crowd round the green: claps scattered over a second and a half that swell and fade, more of them for more (v up to 2) */
function applause(au: Audio, v: number) {
  const n = Math.round(70 * Math.min(2, v));
  for (let i = 0; i < n; i++) {
    const u = Math.random();
    const at = 0.05 + u * 1.6;
    const env = Math.sin(Math.min(1, u * 1.4) * Math.PI) * 0.9 + 0.1;
    burst(au, { freq: 1400 + Math.random() * 2200, q: 0.9, dur: 0.018 + Math.random() * 0.02, gain: 0.05 * env, at });
  }
}

function swish(au: Audio, power: number, dur: number) {
  const { ctx: c, out } = au;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.6;
  f.frequency.setValueAtTime(500, t);
  f.frequency.exponentialRampToValueAtTime(1500 + power * 2500, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18 + power * 0.25, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.1);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + dur * 1.2 + 0.05);
}

export function sfx(kind: Sfx, v = 1) {
  const au = getAudio();
  if (!au) return;
  switch (kind) {
    case "putt":
      // the ball on a putter face: a soft, dry tick with a short low body
      modal(au, [[2100, 30, 0.5], [3300, 40, 0.3], [900, 14, 0.4]], { excite: 0.002, gain: 0.5 + v * 0.5 });
      break;
    case "tick":
      burst(au, { freq: 3800, q: 1.2, dur: 0.02, gain: 0.12 });
      break;
    case "cup":
      // a rattle down the plastic cup, then the drop
      modal(au, [[1500, 18, 0.5], [2400, 22, 0.3]], { excite: 0.002, gain: 0.55 });
      modal(au, [[1100, 16, 0.5], [1900, 20, 0.3]], { excite: 0.002, gain: 0.45, at: 0.07 });
      modal(au, [[420, 10, 0.9], [760, 14, 0.4]], { excite: 0.004, gain: 0.9, at: 0.14 });
      tone(au, { freq: 190, to: 110, dur: 0.22, gain: 0.2, at: 0.13 });
      break;
    case "lip":
      modal(au, [[1800, 20, 0.4], [2600, 26, 0.25]], { excite: 0.002, gain: 0.5 });
      burst(au, { freq: 5000, type: "highpass", dur: 0.07, gain: 0.05 });
      break;
    case "good":
      tone(au, { freq: 660, dur: 0.12, gain: 0.1, type: "triangle" });
      tone(au, { freq: 990, dur: 0.2, gain: 0.1, type: "triangle", at: 0.08 });
      break;
    case "fanfare":
      // under par: a rising chime, brighter for an eagle or better (v > 1)
      [523, 659, 784, 1047, ...(v > 1 ? [1319] : [])].forEach((f, i) => tone(au, { freq: f, dur: 0.32, gain: 0.09, type: "triangle", at: i * 0.09 }));
      tone(au, { freq: 1568, dur: 0.6, gain: 0.04, type: "sine", at: 0.4 });
      break;
    case "pickup":
      tone(au, { freq: 300, to: 200, dur: 0.18, gain: 0.12, type: "triangle" });
      break;
    case "swish":
      swish(au, v, 0.28);
      break;
    case "strikeWood":
      // a driver: a hollow, high crack plus a body knock
      modal(au, [[1700, 12, 0.5], [2900, 18, 0.5], [4300, 22, 0.35], [700, 8, 0.7]], { excite: 0.0025, gain: 1.0 });
      burst(au, { freq: 9000, type: "highpass", dur: 0.09, gain: 0.12 });
      break;
    case "strikeIron":
      // an iron: a thin, bright click
      modal(au, [[3400, 24, 0.6], [5200, 30, 0.4], [1400, 10, 0.45]], { excite: 0.0018, gain: 0.9 });
      burst(au, { freq: 7000, type: "highpass", dur: 0.06, gain: 0.1 });
      break;
    case "thud":
      burst(au, { freq: 160, type: "lowpass", dur: 0.14, gain: 0.5 });
      burst(au, { freq: 900, q: 0.8, dur: 0.05, gain: 0.12 });
      break;
    case "land":
      burst(au, { freq: 220, type: "lowpass", dur: 0.1, gain: 0.22 * v });
      break;
    case "splash":
      // a plop, then the spray falling back
      tone(au, { freq: 420, to: 140, dur: 0.12, gain: 0.25 * v });
      burst(au, { freq: 2600, q: 0.6, dur: 0.45, gain: 0.12 * v, at: 0.03 });
      burst(au, { freq: 5200, type: "highpass", dur: 0.3, gain: 0.05 * v, at: 0.1 });
      break;
    case "sand":
      // a soft, gritty thump
      burst(au, { freq: 180, type: "lowpass", dur: 0.12, gain: 0.25 * v });
      burst(au, { freq: 3200, q: 0.5, dur: 0.22, gain: 0.07 * v, at: 0.01 });
      break;
    case "applause":
      applause(au, v);
      break;
  }
}

// ---------------------------------------------------------------- the wind in the trees
let bed: { c: AudioContext; src: AudioBufferSourceNode; gain: GainNode; f: BiquadFilterNode; level: number } | null = null;

/** a soft bed of wind under the round, louder and brighter as the wind is stronger (m/s), with slow gusts; 0 fades it out */
export function windBed(speed: number) {
  const level = Math.round(Math.max(0, Math.min(8, speed)) * 4) / 4;
  if (bed && bed.level === level) return;
  if (!bed) {
    if (level === 0) return;
    const au = getAudio();
    if (!au) return;
    const c = au.ctx;
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.7;
    const gain = c.createGain();
    gain.gain.value = 0;
    // gusts: a slow wobble on the level
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.11;
    const depth = c.createGain();
    depth.gain.value = 0.35;
    const swell = c.createGain();
    swell.gain.value = 1;
    lfo.connect(depth).connect(swell.gain);
    src.connect(f).connect(swell).connect(gain).connect(au.out);
    src.start();
    lfo.start();
    bed = { c, src, gain, f, level: -1 };
  }
  const t = bed.c.currentTime;
  bed.gain.gain.setTargetAtTime(level === 0 ? 0 : 0.012 + level * 0.007, t, 0.6);
  bed.f.frequency.setTargetAtTime(280 + level * 140, t, 0.6);
  bed.level = level;
}
