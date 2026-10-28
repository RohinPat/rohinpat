"use client";

// One shared AudioContext for the Off hours pieces. Every sound is
// synthesized here in the browser — no audio files, no requests. The
// context is created on the first sound (always after a click or key), and
// the stage's sound switch mutes the master bus. Nothing is remembered.
//
// A game opened from a linked phone can make a sound before the visitor has
// touched the laptop. The browser then keeps the context suspended; the stage
// watches `audioBlocked()` and asks for one click or key (SoundPrompt.tsx).

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let muted = false;
const subs = new Set<() => void>();
const stateSubs = new Set<() => void>();
const LEVEL = 0.8;

export type Audio = { ctx: AudioContext; out: GainNode };

export function getAudio(): Audio | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    bus = ctx.createGain();
    bus.gain.value = muted ? 0 : LEVEL;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    bus.connect(limiter).connect(ctx.destination);
    ctx.addEventListener("statechange", () => stateSubs.forEach((f) => f()));
    stateSubs.forEach((f) => f());
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, out: bus! };
}

export const isMuted = () => muted;

/** A game has asked for sound (so there is a context) and the browser is not letting it play yet. */
export const audioBlocked = () => !!ctx && ctx.state !== "running";

export function onAudioState(f: () => void) {
  stateSubs.add(f);
  return () => {
    stateSubs.delete(f);
  };
}

/** Call from a click or key: the one gesture the browser wants before it plays anything. */
export function resumeAudio() {
  if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
}

export function setMuted(m: boolean) {
  muted = m;
  if (ctx && bus) bus.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.02);
  subs.forEach((f) => f());
}

export function onMuteChange(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

const noiseCache = new WeakMap<AudioContext, AudioBuffer>();
/** Two seconds of white noise, made once per context. */
export function noise(c: AudioContext) {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}

/** A short filtered noise burst: ticks, clicks, thuds, swishes. */
export function burst(
  { ctx: c, out }: Audio,
  { freq = 3000, q = 1, type = "bandpass" as BiquadFilterType, dur = 0.03, gain = 0.4, at = 0 } = {},
) {
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}

/** A pitched blip with a quick decay (and optional pitch drop). */
export function tone(
  { ctx: c, out }: Audio,
  opts: { freq?: number; to?: number; type?: OscillatorType; dur?: number; gain?: number; at?: number } = {},
) {
  const { freq = 440, type = "sine", dur = 0.15, gain = 0.3, at = 0 } = opts;
  const to = opts.to ?? freq;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/**
 * Modal synthesis: a very short noise impulse rung through a bank of
 * resonant band-pass filters (each "mode" is a frequency, Q and level).
 * High Q rings longer. Good for anything struck: keys, cases, wood, metal.
 */
export function modal(
  { ctx: c, out }: Audio,
  modes: [freq: number, q: number, level: number][],
  { excite = 0.003, gain = 1, at = 0, lowpass = 6000 } = {},
) {
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const env = c.createGain();
  env.gain.setValueAtTime(1, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + excite);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = lowpass;
  const sum = c.createGain();
  sum.gain.value = gain;
  src.connect(env);
  for (const [f, q, level] of modes) {
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.value = level * Math.sqrt(q); // a narrow band passes less energy; make up for it
    env.connect(bp).connect(g).connect(sum);
  }
  sum.connect(lp).connect(out);
  src.start(t, Math.random());
  src.stop(t + excite + 0.25);
}
