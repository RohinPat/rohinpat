import { burst, noise, tone, type Audio } from "../audio";
import { EngineVoice } from "../engineVoice";

// Night run's sound. The V8 is the shared one (engineVoice.ts). Around it, all
// of it synthesized: one looping noise source run through filters whose levels
// follow the car (wind with speed, a road rumble, tyre squeal as filtered noise
// that rises with how hard the tyres are working, a scrape on the rail), and
// one-shots for the countdown, a checkpoint chime, a hit, a spin, a bank and a
// shift. No audio files and no network. The page's sound switch is the master.

export type Mood = {
  rpm: number;
  pedal: number;
  throttle: boolean;
  cut: boolean;
  /** m/s over the ground */
  speed: number;
  /** 0..1: how hard the tyres work */
  skid: number;
  /** grinding along the rail */
  scrape: boolean;
  /** an overall level (0 mutes the loops: paused) */
  level: number;
};

type Loop = { f: BiquadFilterNode; g: GainNode };

export class NightSound {
  readonly voice: EngineVoice;
  private src: AudioBufferSourceNode;
  private wind: Loop;
  private rumble: Loop;
  private squeal: Loop;
  private squeal2: Loop;
  private scrape: Loop;
  private dead = false;

  constructor(private au: Audio) {
    const { ctx, out } = au;
    this.voice = new EngineVoice(au);
    this.src = ctx.createBufferSource();
    this.src.buffer = noise(ctx);
    this.src.loop = true;
    const mk = (type: BiquadFilterType, freq: number, q: number): Loop => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      this.src.connect(f).connect(g).connect(out);
      return { f, g };
    };
    this.wind = mk("bandpass", 500, 0.5);
    this.rumble = mk("lowpass", 160, 0.8);
    this.squeal = mk("bandpass", 2100, 10);
    this.squeal2 = mk("bandpass", 3300, 14);
    this.scrape = mk("bandpass", 2600, 1.6);
    this.src.start(0, Math.random());
  }

  update(m: Mood) {
    if (this.dead) return;
    const now = this.au.ctx.currentTime;
    const sp = Math.min(1.2, m.speed / 62);
    const set = (l: Loop, gain: number, freq?: number) => {
      l.g.gain.setTargetAtTime(gain * m.level, now, 0.05);
      if (freq !== undefined) l.f.frequency.setTargetAtTime(freq, now, 0.06);
    };
    this.voice.update({ rpm: m.rpm, pedal: m.pedal, throttle: m.throttle, cut: m.cut, level: m.level });
    set(this.wind, 0.03 + 0.34 * sp * sp, 380 + sp * 1500);
    set(this.rumble, 0.05 + 0.1 * sp, 130 + sp * 110);
    // the squeal: off until the tyres work, then louder and a little higher
    const s = Math.max(0, m.skid - 0.38) / 0.62;
    const wob = 1 + 0.03 * Math.sin(now * 37);
    set(this.squeal, 0.34 * s * Math.min(1, m.speed / 14), (1750 + 900 * s + m.speed * 8) * wob);
    set(this.squeal2, 0.2 * s * s * Math.min(1, m.speed / 14), (2900 + 1100 * s) * wob);
    set(this.scrape, m.scrape ? 0.5 * Math.min(1, m.speed / 25) : 0, 2300 + Math.random() * 900);
  }

  silence() {
    if (this.dead) return;
    const now = this.au.ctx.currentTime;
    this.voice.silence();
    for (const l of [this.wind, this.rumble, this.squeal, this.squeal2, this.scrape]) l.g.gain.setTargetAtTime(0, now, 0.03);
  }

  /** the countdown: three short beeps and a long one on GO */
  count(go: boolean) {
    if (this.dead) return;
    tone(this.au, { freq: go ? 880 : 520, type: "sine", dur: go ? 0.55 : 0.16, gain: go ? 0.26 : 0.2 });
    if (go) tone(this.au, { freq: 1320, type: "triangle", dur: 0.4, gain: 0.1 });
  }

  /** a gate: a rising two-note chime */
  chime(last: boolean) {
    if (this.dead) return;
    tone(this.au, { freq: 784, type: "sine", dur: 0.5, gain: 0.22 });
    tone(this.au, { freq: 1175, type: "sine", dur: 0.7, gain: 0.2, at: 0.1 });
    tone(this.au, { freq: 1568, type: "triangle", dur: 0.6, gain: 0.08, at: 0.1 });
    if (last) {
      tone(this.au, { freq: 1568, type: "sine", dur: 0.9, gain: 0.2, at: 0.24 });
      tone(this.au, { freq: 2093, type: "sine", dur: 1.1, gain: 0.16, at: 0.34 });
    }
  }

  /** the rail */
  hit(speed: number) {
    if (this.dead) return;
    const k = Math.min(1, speed / 12);
    burst(this.au, { freq: 150, type: "lowpass", dur: 0.22, gain: 0.8 * k + 0.2 });
    burst(this.au, { freq: 2400, q: 1.2, dur: 0.18, gain: 0.34 * k });
    tone(this.au, { freq: 90, to: 48, type: "sine", dur: 0.25, gain: 0.5 * k });
  }

  spin() {
    if (this.dead) return;
    tone(this.au, { freq: 1500, to: 620, type: "sawtooth", dur: 0.55, gain: 0.05 });
    burst(this.au, { freq: 1900, q: 3, dur: 0.5, gain: 0.3 });
  }

  /** points banked: a soft tick, higher for a bigger combo */
  bank(combo: number) {
    if (this.dead) return;
    const f = 660 * Math.pow(2, Math.min(7, combo) / 12);
    tone(this.au, { freq: f, type: "triangle", dur: 0.22, gain: 0.14 });
    tone(this.au, { freq: f * 1.5, type: "sine", dur: 0.3, gain: 0.1, at: 0.06 });
  }

  /** a combo step */
  chain(combo: number) {
    if (this.dead) return;
    tone(this.au, { freq: 420 * Math.pow(2, Math.min(7, combo) / 12), type: "square", dur: 0.07, gain: 0.04 });
  }

  /** an upshift: the exhaust pops */
  pop() {
    if (this.dead) return;
    burst(this.au, { freq: 180, type: "lowpass", dur: 0.08, gain: 0.5 });
    burst(this.au, { freq: 120, type: "lowpass", dur: 0.06, gain: 0.4, at: 0.07 });
  }

  dispose() {
    if (this.dead) return;
    this.silence();
    this.dead = true;
    this.voice.stop();
    const s = this.src;
    window.setTimeout(() => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }, 200);
  }
}
