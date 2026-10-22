"use client";

import { burst, getAudio, modal, noise, tone, type Audio } from "../audio";

// Golf sounds, all synthesized: a putter tick, the ball rattling into the
// cup, a club whooshing through the air and cracking the ball, turf thuds.

export type Sfx = "putt" | "cup" | "lip" | "tick" | "good" | "swish" | "strikeWood" | "strikeIron" | "thud" | "land" | "pickup";

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
  }
}
