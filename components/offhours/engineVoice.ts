import { noise, type Audio } from "./audio";
import { LIMIT } from "./engineModel";

// The V8's voice, shared by both Cars modes. One oscillator runs at the
// engine-cycle rate (rpm / 120: a four-stroke cycle is two turns) with a
// custom waveform. A V8 fires 8 times a cycle, so the 8th harmonic is the
// firing note; the cross-plane crank fires unevenly, which puts energy into
// the lower orders too, and that lumpy low end is the burble. A second voice
// an octave down adds weight, noise adds intake, and a waveshaper plus a
// load-dependent low-pass shape it. Synthesized: no audio files, no requests.

function v8Wave(ctx: BaseAudioContext) {
  const N = 48;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let h = 1; h < N; h++) {
    const w = h % 8 === 0 ? 1 : h % 4 === 0 ? 0.75 : h % 2 === 0 ? 0.45 : 0.32;
    // fixed, uneven phases: the cross-plane lope
    const ph = (Math.sin(h * 12.9898) * 43758.5453) % (Math.PI * 2);
    const a = w / Math.pow(h, 0.62);
    re[h] = a * Math.cos(ph);
    im[h] = a * Math.sin(ph);
  }
  return ctx.createPeriodicWave(re, im);
}

export type VoiceState = {
  rpm: number;
  /** how far down the pedal is, 0..1 */
  pedal: number;
  /** the pedal is held (loads the note and opens the intake) */
  throttle: boolean;
  /** torque is cut for a shift: the note drops away for a moment */
  cut: boolean;
  /** an overall level, 0..1 (the preview and a paused game turn it down) */
  level?: number;
};

export class EngineVoice {
  private osc: OscillatorNode;
  private low: OscillatorNode;
  private lp: BiquadFilterNode;
  private amp: GainNode;
  private intake: GainNode;
  private src: AudioBufferSourceNode;
  private dead = false;

  constructor(private au: Audio) {
    const { ctx, out } = au;
    const wave = v8Wave(ctx);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    const low = ctx.createOscillator();
    low.setPeriodicWave(wave);
    const lowG = ctx.createGain();
    lowG.gain.value = 0.55;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 1.8);
    shaper.curve = curve;
    const mix = ctx.createGain();
    mix.gain.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1.4;
    const body = ctx.createBiquadFilter(); // exhaust resonance
    body.type = "peaking";
    body.frequency.value = 140;
    body.Q.value = 1.2;
    body.gain.value = 7;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    osc.connect(mix);
    low.connect(lowG).connect(mix);
    mix.connect(shaper).connect(body).connect(lp).connect(amp).connect(out);
    // intake roar
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 0.8;
    const intake = ctx.createGain();
    intake.gain.value = 0;
    src.connect(bp).connect(intake).connect(out);
    osc.start();
    low.start();
    src.start();
    this.osc = osc;
    this.low = low;
    this.lp = lp;
    this.amp = amp;
    this.intake = intake;
    this.src = src;
  }

  update(s: VoiceState) {
    if (this.dead) return;
    const now = this.au.ctx.currentTime;
    const level = s.level ?? 1;
    const cycle = s.rpm / 120;
    this.osc.frequency.setTargetAtTime(cycle, now, 0.02);
    this.low.frequency.setTargetAtTime(cycle / 2, now, 0.02);
    const load = 0.3 + 0.7 * s.pedal;
    // off throttle it goes dull and boomy; on throttle it opens up, but stays low
    this.lp.frequency.setTargetAtTime(180 + s.rpm * (0.09 + 0.1 * load), now, 0.04);
    const limiterGate = s.rpm >= LIMIT - 40 && s.throttle ? (Math.random() < 0.5 ? 0.15 : 1) : 1;
    this.amp.gain.setTargetAtTime((s.cut ? 0.1 : 0.22 + load * 0.28) * limiterGate * level, now, 0.02);
    this.intake.gain.setTargetAtTime((s.throttle ? 0.02 + (s.rpm / LIMIT) * 0.05 : 0.008) * level, now, 0.05);
  }

  /** the note goes quiet (a pause, a hidden tab, the end of a run) but the voice stays built */
  silence() {
    if (this.dead) return;
    const now = this.au.ctx.currentTime;
    this.amp.gain.setTargetAtTime(0, now, 0.03);
    this.intake.gain.setTargetAtTime(0, now, 0.03);
  }

  stop() {
    if (this.dead) return;
    this.dead = true;
    this.amp.gain.value = 0;
    this.intake.gain.value = 0;
    for (const o of [this.osc, this.low, this.src]) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
  }
}
