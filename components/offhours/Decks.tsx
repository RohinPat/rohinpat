"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvas, type PieceProps } from "./useCanvas";
import { getAudio } from "./audio";
import { display, mono } from "./font";

// A 16-step drum machine that plays through a turntable. Each change to the
// pattern re-renders one bar offline (OfflineAudioContext: kick, snare,
// hats, a bass riff, vinyl crackle — all synthesized), and an AudioWorklet
// plays that bar at whatever rate the platter is turning, forwards or
// backwards. So grabbing the record really scratches the beat you made.
// Stop brakes the platter like a real deck; the fader cuts the sound.

const ROWS = ["Kick", "Snare", "Hats", "Bass"] as const;
const START: number[][] = [
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
];
const RIFF = [55, 55, 65.41, 55, 73.42, 55, 82.41, 98, 55, 55, 65.41, 55, 110, 98, 82.41, 73.42];
const RPM = 33.333;
const OMEGA = (RPM / 60) * Math.PI * 2; // rad/s at normal speed

const WORKLET = `
class Scratch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: "rate", defaultValue: 0, minValue: -12, maxValue: 12, automationRate: "k-rate" }]; }
  constructor() {
    super();
    this.buf = null; this.pos = 0; this.n = 0;
    this.port.onmessage = (e) => {
      const b = e.data;
      const f = this.buf ? this.pos / this.buf.length : 0;
      this.buf = b; this.pos = f * b.length;
    };
  }
  process(_in, outputs, params) {
    const out = outputs[0][0];
    const b = this.buf;
    if (!b) return true;
    const rate = params.rate[0];
    const L = b.length;
    for (let i = 0; i < out.length; i++) {
      const p = this.pos, i0 = Math.floor(p), fr = p - i0;
      const a = b[((i0 % L) + L) % L], c = b[(((i0 + 1) % L) + L) % L];
      out[i] = a + (c - a) * fr;
      let q = p + rate; q %= L; if (q < 0) q += L; this.pos = q;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    this.n += out.length;
    if (this.n >= 512) { this.n = 0; this.port.postMessage(this.pos / L); }
    return true;
  }
}
registerProcessor("scratch-player", Scratch);
`;

async function renderBar(pattern: number[][], bpm: number, rate: number) {
  const step = 60 / bpm / 4;
  const len = Math.round(step * 16 * rate);
  const oc = new OfflineAudioContext(1, len, rate);
  const out = oc.createGain();
  out.gain.value = 0.7;
  out.connect(oc.destination);
  const noise = oc.createBuffer(1, rate, rate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const env = (g: GainNode, t: number, peak: number, dur: number) => {
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };
  const noiseHit = (t: number, type: BiquadFilterType, f: number, q: number, peak: number, dur: number) => {
    const s = oc.createBufferSource();
    s.buffer = noise;
    const fl = oc.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = oc.createGain();
    env(g, t, peak, dur);
    s.connect(fl).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.01);
  };
  for (let i = 0; i < 16; i++) {
    const t = i * step;
    if (pattern[0][i]) {
      const o = oc.createOscillator();
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      const g = oc.createGain();
      env(g, t, 1, 0.42);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.45);
      noiseHit(t, "lowpass", 3000, 0.7, 0.25, 0.012);
    }
    if (pattern[1][i]) {
      noiseHit(t, "bandpass", 1900, 0.8, 0.7, 0.2);
      const o = oc.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      const g = oc.createGain();
      env(g, t, 0.45, 0.11);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.13);
    }
    if (pattern[2][i]) noiseHit(t, "highpass", 7500, 0.6, i % 4 === 2 ? 0.28 : 0.16, i === 15 ? 0.14 : 0.045);
    if (pattern[3][i]) {
      const o = oc.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = RIFF[i];
      const lp = oc.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + step * 1.8);
      lp.Q.value = 6;
      const g = oc.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.45, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.9);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + step * 2);
    }
  }
  // vinyl: hiss and the odd crackle
  const hiss = oc.createBufferSource();
  hiss.buffer = noise;
  hiss.loop = true;
  const hp = oc.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 4000;
  const hg = oc.createGain();
  hg.gain.value = 0.012;
  hiss.connect(hp).connect(hg).connect(out);
  hiss.start(0);
  for (let k = 0; k < 14; k++) noiseHit(Math.random() * step * 16, "highpass", 2000, 0.5, 0.05 + Math.random() * 0.08, 0.004);
  const buf = await oc.startRendering();
  return buf.getChannelData(0).slice();
}

type Deck = { node: AudioWorkletNode; rate: AudioParam; fader: GainNode };

export default function Decks({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [pattern, setPattern] = useState(START);
  const [bpm, setBpm] = useState(92);
  const [running, setRunning] = useState(!play);
  const [step, setStep] = useState(-1);
  const deck = useRef<Deck | null>(null);
  const booting = useRef<Promise<void> | null>(null);
  const S = useRef({
    angle: 0,
    rate: play ? 0 : 1,
    pos: 0,
    grab: false,
    grabAngle: 0,
    lastGrab: 0,
    grabRate: 0,
    cut: false,
    running: !play,
    arm: play ? 0 : 1,
    lastPos: 0,
  });
  const box = useRef({ cx: 0, cy: 0, r: 0 });

  // build the audio graph on the first gesture
  const boot = () => {
    if (!play) return Promise.resolve();
    if (booting.current) return booting.current;
    const au = getAudio();
    if (!au || !("audioWorklet" in au.ctx)) return Promise.resolve();
    booting.current = (async () => {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await au.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(au.ctx, "scratch-player", { outputChannelCount: [1] });
      const hp = au.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 30;
      const fader = au.ctx.createGain();
      node.connect(hp).connect(fader).connect(au.out);
      node.port.onmessage = (e) => {
        S.current.pos = e.data as number;
      };
      deck.current = { node, rate: node.parameters.get("rate")!, fader };
      node.port.postMessage(await renderBar(pattern, bpm, au.ctx.sampleRate));
    })();
    return booting.current;
  };

  // re-render the bar when the beat changes
  useEffect(() => {
    if (!deck.current) return;
    const au = getAudio();
    if (!au) return;
    let live = true;
    renderBar(pattern, bpm, au.ctx.sampleRate).then((b) => live && deck.current?.node.port.postMessage(b));
    return () => {
      live = false;
    };
  }, [pattern, bpm]);

  useEffect(
    () => () => {
      deck.current?.node.disconnect();
    },
    [],
  );

  const toggleRun = async () => {
    await boot();
    const r = !S.current.running;
    S.current.running = r;
    setRunning(r);
  };
  const setCut = (c: boolean) => {
    S.current.cut = c;
    const au = getAudio();
    if (deck.current && au) deck.current.fader.gain.setTargetAtTime(c ? 0 : 1, au.ctx.currentTime, 0.004);
  };

  const ref = useCanvas(
    ({ ctx, w, h, dt, t }) => {
      const s = S.current;
      // motor: spin up quickly, brake slower; a grabbed record follows the hand
      if (s.grab) {
        s.rate += (s.grabRate - s.rate) * Math.min(1, dt * 30);
        s.grabRate *= Math.exp(-dt * 10); // holding still stops it
      } else {
        const target = s.running ? 1 : 0;
        s.rate += (target - s.rate) * Math.min(1, dt * (s.running ? 5 : 2.2));
      }
      const au = deck.current && getAudio();
      if (au && deck.current) deck.current.rate.setTargetAtTime(s.rate, au.ctx.currentTime, 0.008);
      s.angle += s.rate * OMEGA * dt;
      if (!deck.current) {
        // no audio (preview): keep a notional position for the playhead
        s.pos = (s.pos + (s.rate * dt) / ((60 / bpm / 4) * 16) + 1) % 1;
      }
      const st = Math.floor(s.pos * 16) % 16;
      if (st !== s.lastPos) {
        s.lastPos = st;
        setStep(s.rate > 0.05 || s.grab ? st : -1);
      }
      s.arm += ((s.running || s.rate > 0.1 ? 1 : 0) - s.arm) * Math.min(1, dt * 3);

      // draw: plinth + platter
      ctx.fillStyle = "#16181a";
      ctx.fillRect(0, 0, w, h);
      const r = Math.min(w * 0.42, h * 0.44);
      const cx = Math.min(w / 2, r + 24), cy = h / 2;
      box.current = { cx, cy, r };
      // strobe dots on the platter rim
      ctx.fillStyle = "#2a2d30";
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 90; i++) {
        const a = s.angle + (i / 90) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? "#5a5f63" : "#8b9095";
        ctx.fillRect(cx + Math.cos(a) * r * 1.03 - 1, cy + Math.sin(a) * r * 1.03 - 1, 2, 2);
      }
      // record + grooves
      ctx.fillStyle = "#0a0a0b";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      for (let g = r * 0.38; g < r * 0.97; g += 3.2) {
        ctx.beginPath();
        ctx.arc(cx, cy, g, 0, Math.PI * 2);
        ctx.stroke();
      }
      // fixed sheen (light doesn't turn with the record)
      const sheen = ctx.createConicGradient(-0.6, cx, cy);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.08, "rgba(255,255,255,0.09)");
      sheen.addColorStop(0.16, "rgba(255,255,255,0)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0)");
      sheen.addColorStop(0.58, "rgba(255,255,255,0.07)");
      sheen.addColorStop(0.66, "rgba(255,255,255,0)");
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
      ctx.fill();
      // label (turns)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.angle);
      ctx.fillStyle = "#1d5e3f";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.33, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f2ead7";
      display(ctx, Math.round(r * 0.13), 800);
      ctx.textAlign = "center";
      ctx.fillText("RP", 0, -r * 0.08);
      mono(ctx, Math.max(8, Math.round(r * 0.045)));
      ctx.fillText(`${bpm} BPM · SIDE A`, 0, r * 0.1);
      ctx.fillRect(-1, r * 0.17, 2, r * 0.12); // a cue mark so you can see it turn
      ctx.fillStyle = "#c9c4b8";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.025, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // a hand on the record
      if (s.grab) {
        ctx.strokeStyle = "rgba(138,217,168,0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.99, s.grabAngle - 0.25, s.grabAngle + 0.25);
        ctx.stroke();
      }
      // tonearm: rests off the record when stopped, swings in when playing
      const px = cx + r * 1.12, py = cy - r * 0.95;
      const restA = Math.PI * 0.52, playA = Math.PI * 0.68;
      const aa = restA + (playA - restA) * s.arm;
      const len = r * 1.25;
      ctx.strokeStyle = "#c9c4b8";
      ctx.lineWidth = Math.max(3, r * 0.03);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(px, py);
      const ex = px + Math.cos(aa) * len, ey = py + Math.sin(aa) * len;
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = "#8b9095";
      ctx.beginPath();
      ctx.arc(px, py, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f2ead7";
      ctx.fillRect(ex - r * 0.04, ey - r * 0.02, r * 0.1, r * 0.08);
      // speed readout
      ctx.fillStyle = "#b5b6ab";
      mono(ctx, play ? 11 : 9);
      ctx.textAlign = "left";
      const pct = Math.round(s.rate * 100);
      ctx.fillText(`${s.grab ? "SCRATCH" : s.running ? "PLAY" : s.rate > 0.02 ? "BRAKE" : "STOP"}  ${pct > 0 ? "+" : ""}${pct}%`, 12, h - 12);
      void t;
    },
    {
      interactive: play,
      paused,
      onDown: async (p) => {
        const { cx, cy, r } = box.current;
        if (Math.hypot(p.x - cx, p.y - cy) > r) return;
        await boot();
        const s = S.current;
        s.grab = true;
        s.grabAngle = Math.atan2(p.y - cy, p.x - cx);
        s.lastGrab = performance.now();
        s.grabRate = 0;
      },
      onMove: (p) => {
        const s = S.current;
        if (!s.grab) return;
        const { cx, cy } = box.current;
        const a = Math.atan2(p.y - cy, p.x - cx);
        let da = a - s.grabAngle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const now = performance.now();
        const dtt = Math.max(0.004, (now - s.lastGrab) / 1000);
        s.grabRate = Math.max(-10, Math.min(10, da / dtt / OMEGA));
        s.grabAngle = a;
        s.lastGrab = now;
      },
      onUp: () => {
        S.current.grab = false;
      },
      keys: (e, down) => {
        const s = S.current;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          // keyboard scratch: hold to drag the record back or forward
          if (down) void boot();
          s.grab = down;
          s.grabRate = down ? (e.key === "ArrowLeft" ? -2.5 : 2.5) : 0;
          return true;
        }
        if (e.key.toLowerCase() === "c") {
          setCut(down);
          return true;
        }
        return false;
      },
    },
  );

  const toggle = (r: number, c: number) => {
    void boot();
    setPattern((p) => p.map((row, i) => (i === r ? row.map((v, j) => (j === c ? (v ? 0 : 1) : v)) : row)));
  };

  const Cell = play ? "button" : "span";
  return (
    <div className="absolute inset-0 flex flex-col md:flex-row bg-[#16181a] text-[#f2ead7]">
      <div className="relative flex-1 min-h-[45%] md:min-h-0">
        <canvas
          ref={ref}
          role={play ? "img" : undefined}
          aria-label={play ? "A turntable playing your beat. Drag the record to scratch; left and right arrows scratch from the keyboard; hold C to cut." : undefined}
          className="absolute inset-0 w-full h-full outline-none touch-none"
        />
      </div>
      <div className={`flex flex-col justify-center gap-3 ${play ? "p-4 md:p-6 md:w-[52%]" : "p-3 w-[50%]"}`}>
        {play && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              data-autofocus
              onClick={toggleRun}
              className="h-10 px-5 rounded-full bg-[#f2ead7] text-[#0d100e] font-mono text-xs uppercase tracking-[0.18em]"
            >
              {running ? "Stop" : "Play"}
            </button>
            <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#b5b6ab]">
              Tempo
              <input type="range" min={70} max={140} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="accent-[#8ad9a8] w-28" />
              <span className="tabular-nums text-[#f2ead7] w-8">{bpm}</span>
            </label>
            <button
              type="button"
              onPointerDown={() => setCut(true)}
              onPointerUp={() => setCut(false)}
              onPointerLeave={() => setCut(false)}
              className="h-10 px-4 rounded-full border border-white/20 font-mono text-xs uppercase tracking-[0.18em] select-none touch-none active:bg-white/15"
            >
              Cut · hold
            </button>
          </div>
        )}
        <div role={play ? "group" : undefined} aria-label={play ? "Step sequencer" : undefined} className="flex flex-col gap-1.5">
          {ROWS.map((name, r) => (
            <div key={name} className="flex items-center gap-2">
              <span className={`font-mono uppercase tracking-[0.12em] text-[#b5b6ab] shrink-0 ${play ? "w-12 text-[10px]" : "w-8 text-[8px]"}`}>{name}</span>
              <div className="grid gap-[3px] flex-1" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
                {pattern[r].map((on, c) => (
                  <Cell
                    key={c}
                    {...(play
                      ? {
                          type: "button" as const,
                          onClick: () => toggle(r, c),
                          "aria-pressed": !!on,
                          "aria-label": `${name} step ${c + 1}`,
                        }
                      : {})}
                    className={`block aspect-square rounded-[4px] transition-colors ${
                      on ? (step === c ? "bg-[#f2ead7]" : r === 3 ? "bg-[#1d5e3f]" : "bg-[#8ad9a8]") : step === c ? "bg-white/25" : c % 4 === 0 ? "bg-white/[0.12]" : "bg-white/[0.06]"
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {play && (
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#b5b6ab]">
            Kick · snare · hats · bass, made in code. Grab the record while it plays.
          </p>
        )}
      </div>
    </div>
  );
}
