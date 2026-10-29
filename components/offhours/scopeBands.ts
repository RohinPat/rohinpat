// The scope's arithmetic, kept pure so it can be tested without an AudioContext.
// An analyser hands back `fftSize / 2` bins, each `sampleRate / fftSize` Hz wide.
// Hearing is logarithmic, so the bars are spread evenly over log frequency
// (an octave gets the same width at 100 Hz as at 5 kHz), not over bins.

export const F_MIN = 30;
export const F_MAX = 12_000;

/** The width of one analyser bin in Hz. */
export const binHz = (sampleRate: number, fftSize: number) => sampleRate / fftSize;

/** Where `hz` falls across the scope, 0 (F_MIN) to 1 (F_MAX). */
export function logX(hz: number, fMin = F_MIN, fMax = F_MAX): number {
  return Math.log(hz / fMin) / Math.log(fMax / fMin);
}

/**
 * `bars` bars across F_MIN..F_MAX on a log scale, each as the half-open range
 * of bins [from, to) it covers. A bar narrower than one bin (the low end) still
 * gets that one bin, so neighbouring low bars can repeat a bin.
 */
export function logBands(bars: number, sampleRate: number, fftSize: number, fMin = F_MIN, fMax = F_MAX): [number, number][] {
  const w = binHz(sampleRate, fftSize);
  const last = fftSize / 2;
  const out: [number, number][] = [];
  for (let i = 0; i < bars; i++) {
    const lo = fMin * Math.pow(fMax / fMin, i / bars);
    const hi = fMin * Math.pow(fMax / fMin, (i + 1) / bars);
    const from = Math.min(last - 1, Math.floor(lo / w));
    const to = Math.min(last, Math.max(from + 1, Math.ceil(hi / w)));
    out.push([from, to]);
  }
  return out;
}

/** Each band's loudest bin, 0..1 (the analyser's bytes run 0..255 across its dB range). */
export function bandLevels(data: ArrayLike<number>, bands: [number, number][]): number[] {
  return bands.map(([from, to]) => {
    let m = 0;
    for (let i = from; i < to; i++) if (data[i] > m) m = data[i];
    return m / 255;
  });
}

/**
 * The frequency of the loudest bin between fMin and fMax, or null when nothing
 * clears `floor` (0..255). The peak is refined between its neighbours with a
 * parabola, so it isn't stuck on a ~12 Hz grid.
 */
export function loudest(data: ArrayLike<number>, sampleRate: number, fftSize: number, fMin = F_MIN, fMax = 5_000, floor = 40): number | null {
  const w = binHz(sampleRate, fftSize);
  const from = Math.max(1, Math.floor(fMin / w));
  const to = Math.min(data.length - 1, Math.ceil(fMax / w));
  let best = -1;
  for (let i = from; i < to; i++) if (best < 0 || data[i] > data[best]) best = i;
  if (best < 0 || data[best] < floor) return null;
  const a = data[best - 1], b = data[best], c = data[best + 1];
  const d = a - 2 * b + c;
  const off = d === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d));
  return (best + off) * w;
}

/** "142 Hz", "1.2 kHz". */
export function formatHz(hz: number): string {
  return hz < 1000 ? `${Math.round(hz)} Hz` : `${(hz / 1000).toFixed(1)} kHz`;
}
