import { burst, noise, tone, type Audio } from "../audio";

// Everything you hear is synthesized: a looping noise source run through
// filters whose levels follow the physics (wind with speed, snow swish and
// edge hiss with the carve, a harsher scrape in a skid), plus one-shots for
// gates, landings, crashes and the finish.

type Loop = { f: BiquadFilter; g: GainNode };
type BiquadFilter = BiquadFilterNode;

export type Mood = { v: number; edge: number; skid: number; grounded: boolean; crashed: boolean; tuck: number };

export class SkiSound {
  private src: AudioBufferSourceNode;
  private wind: Loop;
  private rumble: Loop;
  private swish: Loop;
  private hiss: Loop;
  private scrape: Loop;
  private dead = false;

  constructor(private au: Audio) {
    const { ctx, out } = au;
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
    this.wind = mk("bandpass", 700, 0.45);
    this.rumble = mk("lowpass", 220, 0.7);
    this.swish = mk("bandpass", 1500, 0.8);
    this.hiss = mk("bandpass", 4200, 1.4);
    this.scrape = mk("bandpass", 2100, 2.2);
    this.src.start(0, Math.random());
  }

  update(m: Mood) {
    if (this.dead) return;
    const now = this.au.ctx.currentTime;
    const sp = Math.min(1.3, m.v / 32);
    const on = m.grounded && !m.crashed ? 1 : 0;
    const set = (l: Loop, gain: number, freq?: number) => {
      l.g.gain.setTargetAtTime(gain, now, 0.06);
      if (freq !== undefined) l.f.frequency.setTargetAtTime(freq, now, 0.08);
    };
    set(this.wind, 0.05 + 0.5 * sp * sp * (1.05 - m.tuck * 0.15), 350 + sp * 1300);
    set(this.rumble, 0.1 * sp, 160 + sp * 120);
    set(this.swish, 0.09 * sp * on * (0.6 + 0.4 * (1 - m.tuck)), 900 + sp * 1300);
    set(this.hiss, 0.5 * Math.min(1, m.edge) * on * Math.min(1, sp * 1.3), 3200 + m.edge * 1800);
    set(this.scrape, 0.62 * m.skid * on, 1700 + sp * 900);
  }

  silence() {
    if (this.dead) return;
    const now = this.au.ctx.currentTime;
    for (const l of [this.wind, this.rumble, this.swish, this.hiss, this.scrape]) l.g.gain.setTargetAtTime(0, now, 0.03);
  }

  dispose() {
    if (this.dead) return;
    this.silence();
    this.dead = true;
    const s = this.src;
    window.setTimeout(() => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }, 200);
  }

  count(n: number) {
    tone(this.au, { freq: n > 0 ? 660 : 1040, dur: n > 0 ? 0.12 : 0.4, type: "square", gain: n > 0 ? 0.1 : 0.14 });
  }
  gate(ok: boolean, streak: number) {
    if (this.dead) return;
    if (ok) {
      const f = 1500 * 2 ** (Math.min(streak, 10) / 12);
      burst(this.au, { freq: f, q: 4, dur: 0.05, gain: 0.35 });
      tone(this.au, { freq: f * 0.5, dur: 0.07, type: "triangle", gain: 0.08 });
      burst(this.au, { freq: 700, type: "lowpass", dur: 0.09, gain: 0.25 });
    } else {
      tone(this.au, { freq: 150, to: 80, dur: 0.3, type: "sawtooth", gain: 0.13 });
      burst(this.au, { freq: 500, type: "lowpass", dur: 0.2, gain: 0.4 });
    }
  }
  launch() {
    burst(this.au, { freq: 1200, q: 0.6, dur: 0.18, gain: 0.18 });
  }
  land(impact: number, clean: boolean) {
    const k = Math.min(1, impact / 8 + 0.2);
    tone(this.au, { freq: 100, to: 42, dur: 0.22, gain: 0.55 * k });
    burst(this.au, { freq: 800, type: "lowpass", dur: 0.2, gain: 0.55 * k });
    burst(this.au, { freq: 3500, q: 0.7, dur: 0.14, gain: 0.25 * k });
    if (!clean) burst(this.au, { freq: 500, type: "lowpass", dur: 0.4, gain: 0.4 });
  }
  trick() {
    [660, 880, 1320].forEach((f, i) => tone(this.au, { freq: f, dur: 0.16, type: "triangle", gain: 0.1, at: i * 0.07 }));
  }
  crash() {
    burst(this.au, { freq: 600, type: "lowpass", dur: 0.7, gain: 0.8 });
    burst(this.au, { freq: 2800, q: 0.6, dur: 0.35, gain: 0.35 });
    tone(this.au, { freq: 90, to: 32, dur: 0.5, gain: 0.6 });
  }
  net() {
    burst(this.au, { freq: 400, type: "lowpass", dur: 0.28, gain: 0.55 });
    tone(this.au, { freq: 220, to: 120, dur: 0.2, type: "triangle", gain: 0.1 });
  }
  finish(medal: number) {
    const { ctx, out } = this.au;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(medal > 0 ? 0.3 : 0.12, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + 2.5);
    tone(this.au, { freq: 880, dur: 0.5, type: "triangle", gain: 0.12 });
    if (medal > 0) [523, 659, 784, 1047].forEach((f, i) => tone(this.au, { freq: f, dur: 0.4, type: "triangle", gain: 0.1, at: 0.15 + i * 0.1 }));
  }
}
