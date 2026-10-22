// Colour naming, ported from Closet Organizer's backend
// (backend/models/clothing_classifier.py: _closest_color and extract_colors)
// so the home screen's camera names colours exactly the way the app does:
// every pixel votes for a name, named by hue first with separate rules for
// dark, pale and near-grey pixels, and a second colour only counts if it
// holds at least 8% of the vote. Pure functions, no DOM.

export type Name =
  | "Black"
  | "White"
  | "Gray"
  | "Red"
  | "Blue"
  | "Green"
  | "Yellow"
  | "Orange"
  | "Purple"
  | "Pink"
  | "Brown"
  | "Beige"
  | "Navy"
  | "Teal";

/** colorsys.rgb_to_hsv, on 0–255 channels; h in degrees, s and v 0–1 */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  if (min === max) return [0, 0, v];
  const s = (max - min) / max;
  const rc = (max - r) / (max - min);
  const gc = (max - g) / (max - min);
  const bc = (max - b) / (max - min);
  let h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc;
  // Python's float %: only negatives wrap, so positive hues keep every bit
  h = (h / 6) % 1;
  if (h < 0) h += 1;
  return [h * 360, s, v];
}

/** One pixel's name. Same thresholds as the backend, in the same order. */
export function nameOf(r: number, g: number, b: number): Name {
  const [h, s, v] = hsv(r, g, b);
  if (v < 0.18) return "Black";
  if (s < 0.07) {
    if (v > 0.85) return "White";
    if (v < 0.45) return "Black";
    return "Gray";
  }
  if (s < 0.22 && v > 0.75 && h >= 25 && h <= 65) return "Beige";

  if (h < 15 || h >= 345) return "Red";
  if (h < 35) {
    if (v < 0.55 && s < 0.85) return "Brown";
    return "Orange";
  }
  if (h < 50) {
    if (v < 0.55 && s < 0.45) return "Brown";
    if (v < 0.55) return "Green";
    if (s < 0.35 && v > 0.7) return "Beige";
    return "Orange";
  }
  if (h < 70) {
    if (v < 0.55 && s < 0.55) return "Brown";
    if (v < 0.55) return "Green";
    return "Yellow";
  }
  if (h < 170) return "Green";
  if (h < 200) return "Teal";
  if (h < 255) {
    if (v < 0.35) return "Navy";
    return "Blue";
  }
  if (h < 295) return "Purple";
  return "Pink";
}

/** a small seeded generator, so the same frame always gets the same answer */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Vote = {
  name: Name;
  share: number;
  /** the average of the pixels that voted for this name: the shade you see */
  rgb: [number, number, number];
};

export const SAMPLE = 4000;
export const SECOND_COLOUR = 0.08;

/**
 * Vote over RGBA pixel data. Transparent pixels (alpha ≤ 200) don't vote,
 * like the backend's cutout mask. Returns every name that got a vote, most
 * first, and `picked`: the colours the app would tag the garment with.
 */
export function vote(data: Uint8ClampedArray | number[], numColours = 2): { all: Vote[]; picked: Vote[] } {
  const idx: number[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) if (data[i + 3] > 200) idx.push(i);
  if (idx.length > SAMPLE) {
    // a partial Fisher–Yates: SAMPLE picks without replacement
    const rnd = mulberry32(0);
    for (let k = 0; k < SAMPLE; k++) {
      const j = k + Math.floor(rnd() * (idx.length - k));
      [idx[k], idx[j]] = [idx[j], idx[k]];
    }
    idx.length = SAMPLE;
  }
  const tally = new Map<Name, { n: number; r: number; g: number; b: number }>();
  for (const i of idx) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const name = nameOf(r, g, b);
    const t = tally.get(name) ?? { n: 0, r: 0, g: 0, b: 0 };
    t.n++;
    t.r += r;
    t.g += g;
    t.b += b;
    tally.set(name, t);
  }
  const total = idx.length;
  const all: Vote[] = Array.from(tally.entries())
    .sort((a, b) => b[1].n - a[1].n)
    .map(([name, t]) => ({ name, share: t.n / total, rgb: [Math.round(t.r / t.n), Math.round(t.g / t.n), Math.round(t.b / t.n)] }));
  const picked: Vote[] = [];
  for (const v of all) {
    if (v.share < SECOND_COLOUR && picked.length) break;
    picked.push(v);
    if (picked.length >= numColours) break;
  }
  return { all, picked };
}
