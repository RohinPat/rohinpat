import { seeded } from "../useCanvas";

// Colours and pre-drawn scenery: the golden-hour palette, mountain ridges
// and baked pine-tree sprites (a few variants, a few levels of haze).

export type RGB = [number, number, number];
export const rgb = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);

export const PAL = {
  skyTop: rgb("#4f6fa3"),
  skyMid: rgb("#e3aa9b"),
  skyLow: rgb("#ffd7a0"),
  haze: rgb("#f8d4ae"),
  snowLit: rgb("#fff0da"),
  snowShade: rgb("#a2a3cf"),
  piste: rgb("#fffaf0"),
  net: rgb("#f0802c"),
  ink: rgb("#0d100e"),
  cream: rgb("#f2ead7"),
  green: rgb("#1d5e3f"),
  mint: rgb("#8ad9a8"),
  red: rgb("#e0392b"),
  blue: rgb("#2a62c9"),
};

// ---- ridges

function lattice(seed: number) {
  const r = seeded(seed);
  const t = new Float32Array(512);
  for (let i = 0; i < 512; i++) t[i] = r();
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = t[((i % 512) + 512) % 512];
    const b = t[(((i + 1) % 512) + 512) % 512];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}

export type Ridge = { n: (x: number) => number; scale: number; amp: number; lit: RGB; shade: RGB; par: number };
export const ridges: Ridge[] = [
  { n: lattice(5), scale: 2.4, amp: 0.3, lit: rgb("#f3cdb4"), shade: rgb("#b199b5"), par: 1 },
  { n: lattice(19), scale: 3.2, amp: 0.22, lit: rgb("#e4b9a2"), shade: rgb("#8484a6"), par: 2 },
  { n: lattice(41), scale: 4.4, amp: 0.15, lit: rgb("#cfa48e"), shade: rgb("#5f6a8c"), par: 3.5 },
];

export function ridgeAt(r: Ridge, u: number) {
  let v = 0;
  let amp = 1;
  let sum = 0;
  let fr = 1;
  for (let o = 0; o < 4; o++) {
    v += amp * (1 - Math.abs(2 * r.n(u * fr + o * 17.3) - 1));
    sum += amp;
    amp *= 0.5;
    fr *= 2.15;
  }
  return Math.pow(v / sum, 1.5);
}

// ---- trees

export type Sprite = { c: HTMLCanvasElement; ratio: number };
const FOG_LEVELS = [0, 0.3, 0.6, 0.85];
let trees: Sprite[][] | null = null;

function drawPine(v: number, fog: number): Sprite {
  const W = 110;
  const H = 230;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const r = seeded(100 + v);
  const tiers = 5 + v;
  const cx = W / 2;
  const base = H - 8;
  // trunk
  x.fillStyle = "#2b211c";
  x.fillRect(cx - 4, base - 22, 8, 22);
  const dark = rgb("#142d27");
  const mid = rgb("#1f4a3b");
  const lit = rgb("#3b7656");
  const cap = rgb("#fff1db");
  const capShade = rgb("#b9c4e0");
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const ty = 8 + t * (H - 70) * 0.82 + (r() - 0.5) * 3;
    const th = 56 + t * 18;
    const hw = (14 + t * 38) * (0.92 + r() * 0.16);
    const by = ty + th;
    // left (shade) and right (lit) halves
    x.fillStyle = css(mix(dark, mid, t * 0.5));
    x.beginPath();
    x.moveTo(cx, ty);
    x.lineTo(cx - hw, by);
    x.lineTo(cx + 2, by - 4);
    x.fill();
    x.fillStyle = css(mix(mid, lit, 0.35 + t * 0.4));
    x.beginPath();
    x.moveTo(cx, ty);
    x.lineTo(cx + 2, by - 4);
    x.lineTo(cx + hw, by);
    x.fill();
    // underside shadow
    x.fillStyle = "rgba(8,18,16,0.55)";
    x.beginPath();
    x.moveTo(cx - hw, by);
    x.lineTo(cx + hw, by);
    x.lineTo(cx + hw * 0.8, by - 6);
    x.lineTo(cx - hw * 0.8, by - 6);
    x.fill();
    // snow resting on the branches
    x.fillStyle = css(capShade);
    x.beginPath();
    x.moveTo(cx, ty);
    x.lineTo(cx - hw * 0.62, ty + th * 0.62);
    x.lineTo(cx - hw * 0.2, ty + th * 0.5);
    x.lineTo(cx, ty + th * 0.7);
    x.fill();
    x.fillStyle = css(cap);
    x.beginPath();
    x.moveTo(cx, ty);
    x.lineTo(cx + hw * 0.64, ty + th * 0.64);
    x.lineTo(cx + hw * 0.22, ty + th * 0.5);
    x.lineTo(cx, ty + th * 0.72);
    x.fill();
  }
  if (fog > 0) {
    x.globalCompositeOperation = "source-atop";
    x.fillStyle = css(PAL.haze, fog);
    x.fillRect(0, 0, W, H);
  }
  return { c, ratio: W / H };
}

export function treeSprite(v: number, fog: number) {
  if (!trees) trees = FOG_LEVELS.map((f) => [0, 1, 2].map((v2) => drawPine(v2, f)));
  let k = 0;
  for (let i = 0; i < FOG_LEVELS.length; i++) if (fog >= FOG_LEVELS[i] - 0.05) k = i;
  return trees[k][v % 3];
}
