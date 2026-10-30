import { seeded } from "../useCanvas";
import type { TrackId } from "./tracks";

// The pictures that never change while the page is open, made once per canvas
// size and then only drawn: the sky with its stars, wisps and moon, four ridges
// of mountains (jagged far ones, pines on the near one, a radio mast and a line
// of pylons on the way), a town glowing in the valley, the sprites the roadside
// is made of (pines, houses, a petrol canopy, a grandstand, boulders, glows,
// shadows) and the colour tables the road is painted from (the colours step with
// the distance, so the headlights fade out along the road without a string being
// built in a frame). The panoramas wrap all the way round, and slide with the
// camera's heading, each a little differently, so the far ranges swing slower
// than the near ridge. The palette is the site's: ink-green blacks, a mint glow
// on the horizon, cream paint, the warm of sodium lamps for contrast.
//
// A track config (THEMES) changes the place without a second renderer: the climb is higher
// and colder, with a taller sky, a cold green haze and snow-white ridges, a sea of cloud
// below the horizon where the canyon has a town, and cool asphalt and rock. The canyon's
// own numbers are the ones it always had.

export type Pano = { c: HTMLCanvasElement; W: number; H: number };

/** how many steps of distance the colour tables have */
export const BUCKETS = 24;
const bucketZ = (b: number) => 4 * (Math.pow(2, (b + 0.5) / 2.6) - 1);
/** which colour step a point `z` metres from the camera is in */
export const bucketOf = (z: number) => {
  const b = Math.floor(Math.log2(1 + z / 4) * 2.6);
  return b < 0 ? 0 : b >= BUCKETS ? BUCKETS - 1 : b;
};

export type Palette = {
  road: string[];
  /** the asphalt's other tone: the road is laid in bands of the two, which is what the eye reads as speed */
  roadAlt: string[];
  edge: string[];
  rail: string[];
  railHi: string[];
  post: string[];
  reflL: string[];
  reflR: string[];
  /** the cliff's lower face: four shades for each distance step (index step * 4 + shade) */
  rock: string[];
  /** the cliff's upper face (darker) and its ledges (lit) */
  rockLo: string[];
  rockHi: string[];
  /** the polished lanes the wheels run in */
  wear: string[];
  tunnel: string[];
  ceiling: string[];
  lamp: string[];
  parapet: string[];
  board: string[];
};

export type Sprites = {
  red: HTMLCanvasElement;
  white: HTMLCanvasElement;
  orange: HTMLCanvasElement;
  mint: HTMLCanvasElement;
  smoke: HTMLCanvasElement;
  sodium: HTMLCanvasElement;
  /** a lamp's reflection in wet asphalt: a tall thin streak, bright at its top */
  streak: HTMLCanvasElement;
  /** a trapezoid of light, wide at the top and narrow at the bottom, for the beams in the air */
  cone: HTMLCanvasElement;
  /** a soft dark pool: the car's shadow */
  shadow: HTMLCanvasElement;
  /** the roadside: pines (three), houses (two), a petrol canopy, a grandstand and a boulder, each with its base at the bottom centre */
  pine: HTMLCanvasElement[];
  house: HTMLCanvasElement[];
  canopy: HTMLCanvasElement;
  stand: HTMLCanvasElement;
  rock: HTMLCanvasElement;
};

export type Assets = {
  /** which track's light these were made for */
  theme: TrackId;
  w: number;
  h: number;
  /** device pixels per CSS pixel when these were made: the backdrop and the vignette are built at device size and drawn 1:1 */
  dpr: number;
  /** CSS px the backdrop is wider than the screen, each side (so a shake does not show its edge) */
  backdropPad: number;
  /** the horizon with the camera level, px */
  hy0: number;
  /** px of panorama per radian of heading */
  px: number;
  /** the sky, its glow on the horizon and the dark ground below, baked once and slid up and down with the horizon */
  backdrop: HTMLCanvasElement;
  /** how far above the screen's top the backdrop starts, px */
  backdropTop: number;
  /** a soft dark edge, small, stretched over the screen */
  vignette: HTMLCanvasElement;
  stars: Pano;
  far: Pano;
  city: Pano;
  mid: Pano;
  near: Pano;
  sprites: Sprites;
  pal: Palette;
};

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` : `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a.toFixed(2)})`);
const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

type Theme = {
  seed: number;
  /** the far end of the road melts into this: the colour of the haze on the horizon */
  fog: RGB;
  /** the glow a ridge's edge catches from the moon (an rgba prefix) */
  rim: string;
  /** the horizon with the camera level, as a share of the screen's height (more sky is a bigger share) */
  hy: number;
  /** the sky from the top down: stops of the gradient, the wash of light above the horizon, the haze at it, and the ground below */
  sky: [number, string][];
  wash: string;
  haze: [string, string, string];
  ground: [number, string][];
  /** 0 the canyon's warm greys, 1 the climb's cold ones: how far the asphalt and the rock are tinted */
  cool: number;
  /** the stars' density against the canyon's, and the size of the moon against it */
  stars: number;
  moon: number;
  /** the three ridges: top and bottom colour, how tall (share of the screen), and the edge's glow */
  far: { top: RGB; bottom: RGB; rim: number; h: number; floor: number; peaky: number; haze: number };
  mid: { top: RGB; bottom: RGB; rim: number };
  near: { top: RGB; bottom: RGB; rim: number; teeth: boolean };
  /** a sea of cloud below the horizon instead of the town */
  clouds: boolean;
};

const THEMES: Record<TrackId, Theme> = {
  canyon: {
    seed: 90210,
    fog: [16, 36, 31],
    rim: "rgba(170,226,196,",
    hy: 0.4,
    sky: [[0, "#020504"], [0.42, "#06110e"], [0.74, "#0c241c"], [0.92, "#163a2f"], [1, "#1f4a3b"]],
    wash: "rgba(138,217,168,",
    haze: ["rgba(255,170,110,0)", "rgba(255,160,100,0.11)", "rgba(255,150,90,0)"],
    ground: [[0, "#0a1411"], [0.35, "#060d0b"], [1, "#030605"]],
    cool: 0,
    stars: 1,
    moon: 1,
    far: { top: [26, 52, 48], bottom: [16, 34, 31], rim: 0.34, h: 0.22, floor: 0.16, peaky: 0.7, haze: 0.55 },
    mid: { top: [14, 28, 25], bottom: [9, 18, 16], rim: 0.16 },
    near: { top: [8, 15, 13], bottom: [5, 10, 9], rim: 0.07, teeth: true },
    clouds: false,
  },
  climb: {
    seed: 31_337,
    fog: [22, 44, 46],
    rim: "rgba(214,240,232,",
    hy: 0.5,
    sky: [[0, "#010406"], [0.42, "#04100f"], [0.74, "#0a2124"], [0.92, "#153a3c"], [1, "#22504f"]],
    wash: "rgba(160,224,206,",
    haze: ["rgba(200,236,224,0)", "rgba(200,236,224,0.1)", "rgba(200,236,224,0)"],
    ground: [[0, "#08120f"], [0.35, "#050c0b"], [1, "#030606"]],
    cool: 1,
    stars: 1.6,
    moon: 0.8,
    far: { top: [86, 120, 118], bottom: [30, 54, 56], rim: 0.62, h: 0.27, floor: 0.2, peaky: 0.88, haze: 0.5 },
    mid: { top: [30, 52, 52], bottom: [14, 28, 29], rim: 0.3 },
    near: { top: [10, 18, 18], bottom: [6, 11, 11], rim: 0.12, teeth: false },
    clouds: true,
  },
};

function makePalette(th: Theme): Palette {
  const FOG = th.fog;
  // the climb's colder tone for a colour: the canyon's (a) at 0, the climb's (b) at 1
  const cool = (a: RGB, b: RGB): RGB => mix(a, b, th.cool);
  const pal: Palette = { road: [], roadAlt: [], edge: [], rail: [], railHi: [], post: [], reflL: [], reflR: [], rock: [], rockHi: [], rockLo: [], tunnel: [], ceiling: [], lamp: [], parapet: [], board: [], wear: [] };
  for (let b = 0; b < BUCKETS; b++) {
    const z = bucketZ(b);
    const beam = Math.exp(-Math.max(0, z - 6) / 27);
    const refl = 0.1 + 0.9 * Math.exp(-Math.max(0, z - 6) / 190);
    const fog = smooth((z - 90) / 620) * 0.78;
    const tone = (dark: RGB, lit: RGB, k: number): RGB => mix(mix(dark, lit, k), FOG, fog);
    pal.road.push(css(tone(cool([10, 14, 13], [10, 13, 17]), cool([66, 64, 54], [60, 64, 74]), beam)));
    pal.roadAlt.push(css(tone(cool([12, 16, 15], [12, 15, 20]), cool([77, 74, 62], [70, 75, 87]), beam)));
    pal.wear.push(css(tone(cool([6, 9, 8], [6, 8, 12]), cool([38, 37, 32], [34, 38, 46]), beam)));
    pal.edge.push(css(mix(mix([46, 46, 40], [242, 234, 215], refl), FOG, fog * 0.6)));
    pal.rail.push(css(tone(cool([17, 23, 22], [17, 22, 27]), cool([122, 132, 132], [120, 132, 146]), beam * 0.92)));
    pal.railHi.push(css(tone([30, 38, 37], [214, 224, 222], Math.min(1, beam * 1.1))));
    pal.post.push(css(tone([26, 31, 30], [150, 156, 154], beam)));
    pal.reflR.push(css([236, 246, 255], Math.min(1, 0.22 + 0.78 * refl)));
    pal.reflL.push(css([255, 176, 66], Math.min(1, 0.22 + 0.78 * refl)));
    const rockBeam = Math.exp(-Math.max(0, z - 6) / 22);
    // four shades a distance, so neighbouring segments of the cliff are not the same grey
    for (let q = 0; q < 4; q++) pal.rock.push(css(tone(cool([7 + q * 1.3, 11 + q * 1.4, 10 + q * 1.3], [7 + q * 1.3, 10 + q * 1.4, 14 + q * 1.5]), cool([44 + q * 5, 48 + q * 5, 44 + q * 4], [46 + q * 5, 52 + q * 5, 64 + q * 5]), rockBeam)));
    // the upper face of the cliff is further from the lamps and leans away: darker; a ledge catches more (the climb's ledges carry snow)
    pal.rockLo.push(css(tone(cool([6, 9, 8], [6, 8, 12]), cool([30, 34, 31], [30, 35, 46]), rockBeam * 0.8)));
    pal.rockHi.push(css(tone(cool([14, 20, 18], [16, 22, 30]), cool([92, 98, 88], [170, 192, 220]), rockBeam * 0.9)));
    const lampLit = 0.3 + 0.7 * Math.exp(-z / 70);
    // cool concrete tile under warm lamps: the lamps' glow supplies the warmth
    pal.tunnel.push(css(tone([14, 21, 20], [92, 106, 98], lampLit)));
    pal.ceiling.push(css(tone([9, 14, 14], [56, 68, 64], lampLit * 0.7)));
    pal.lamp.push(css(mix([255, 232, 170], FOG, fog * 0.4)));
    pal.parapet.push(css(tone([28, 34, 33], [172, 172, 160], beam)));
    pal.board.push(css(tone([12, 20, 19], [48, 64, 62], beam)));
  }
  return pal;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** sprites are painted at this many times the size they are drawn at, so a tree beside the road does not turn to blocks as the car comes up to it */
const K = 2;
/** a canvas of w by h in the sprite's own units, painted at K times that */
function sprite(w: number, h: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = canvas(w * K, h * K);
  const x = c.getContext("2d")!;
  x.scale(K, K);
  return { c, x };
}

function glow(rgb: RGB, size = 64, hard = 0.0): HTMLCanvasElement {
  const c = canvas(size, size);
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, css(rgb, 1));
  g.addColorStop(hard, css(rgb, 0.75));
  g.addColorStop(0.45, css(rgb, 0.22));
  g.addColorStop(1, css(rgb, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

function treeSprite(rng: () => number, w: number, h: number, tiers: number, lean: number): HTMLCanvasElement {
  // a pine seen from the side: stacked, ragged tiers, a trunk, dark at the top and a little lit low down (the headlights), with one edge catching the moon
  const { c, x } = sprite(w, h);
  const cx = w / 2;
  const trunk = h * 0.1;
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#050b0a");
  g.addColorStop(0.55, "#0a1814");
  g.addColorStop(1, "#16281f");
  x.fillStyle = g;
  x.fillRect(cx - w * 0.03, h - trunk, w * 0.06, trunk);
  const left: number[] = [];
  const right: number[] = [];
  for (let t = 0; t < tiers; t++) {
    const y0 = 1 + (h - trunk - 4) * (t / tiers) * 0.92;
    const y1 = 1 + (h - trunk - 2) * ((t + 1.35) / tiers);
    const hw = w * (0.2 + 0.3 * ((t + 1) / tiers)) * (0.9 + rng() * 0.2);
    left.push(cx - hw - rng() * 2, Math.min(h - trunk, y1), cx - hw * 0.45, y0 + (y1 - y0) * 0.38);
    right.push(cx + hw + rng() * 2, Math.min(h - trunk, y1), cx + hw * 0.45, y0 + (y1 - y0) * 0.38);
  }
  x.beginPath();
  x.moveTo(cx, 1);
  for (let t = 0; t < tiers; t++) {
    x.lineTo(right[t * 4 + 2] + lean, right[t * 4 + 3]);
    x.lineTo(right[t * 4] + lean * 0.5, right[t * 4 + 1]);
    x.lineTo(cx + w * 0.04, right[t * 4 + 1] - 1);
  }
  x.lineTo(cx - w * 0.04, left[(tiers - 1) * 4 + 1] - 1);
  for (let t = tiers - 1; t >= 0; t--) {
    x.lineTo(left[t * 4], left[t * 4 + 1]);
    x.lineTo(left[t * 4 + 2], left[t * 4 + 3]);
    x.lineTo(cx - w * 0.04 * (t ? 0.4 : 0), left[t * 4 + 3] - (t ? 1 : 0));
  }
  x.closePath();
  x.fillStyle = g;
  x.fill();
  // the moon-lit side
  x.save();
  x.clip();
  x.fillStyle = "rgba(150,210,180,0.13)";
  x.fillRect(0, 0, cx - w * 0.12, h);
  x.restore();
  return c;
}

function houseSprite(rng: () => number, w: number, h: number, kind: number): HTMLCanvasElement {
  // a small house at night: dark walls, a roof with its edge in cream, a few lit windows with their glow
  const { c, x } = sprite(w, h);
  const bodyH = h * (kind ? 0.5 : 0.56);
  const bx = w * 0.12;
  const bw = w * 0.76;
  x.fillStyle = "#0e1715";
  x.fillRect(bx, h - bodyH, bw, bodyH);
  x.fillStyle = "#16221f";
  x.fillRect(bx, h - bodyH, bw * 0.16, bodyH);
  const roof = () => {
    x.beginPath();
    if (kind) {
      x.moveTo(bx - 3, h - bodyH + 1);
      x.lineTo(bx + bw * 0.5, h * 0.06);
      x.lineTo(bx + bw + 3, h - bodyH + 1);
    } else {
      x.moveTo(bx - 3, h - bodyH + 1);
      x.lineTo(bx + 4, h * 0.2);
      x.lineTo(bx + bw - 4, h * 0.2);
      x.lineTo(bx + bw + 3, h - bodyH + 1);
    }
  };
  x.fillStyle = "#070d0c";
  roof();
  x.closePath();
  x.fill();
  x.strokeStyle = "rgba(242,234,215,0.34)";
  x.lineWidth = 1.2;
  roof();
  x.stroke();
  // windows: one or two, small, a low warm glow (the brightest thing here should not be somebody's kitchen)
  const cols = kind ? 2 : 3;
  x.globalCompositeOperation = "lighter";
  let lit = 0;
  for (let i = 0; i < cols; i++) {
    if (rng() < 0.45 && !(i === cols - 1 && lit === 0)) continue;
    lit++;
    const ww = (bw * 0.3) / cols;
    const wx = bx + bw * (0.16 + (0.7 * i) / cols) + (bw * 0.5) / cols / 2 - ww / 2;
    const wy = h - bodyH * 0.74;
    const wh = bodyH * 0.24;
    const hg = x.createRadialGradient(wx + ww / 2, wy + wh / 2, 0, wx + ww / 2, wy + wh / 2, ww * 1.8);
    hg.addColorStop(0, "rgba(255,170,96,0.2)");
    hg.addColorStop(1, "rgba(255,170,96,0)");
    x.fillStyle = hg;
    x.fillRect(wx - ww * 1.8, wy - ww * 1.6, ww * 4.6, wh + ww * 3.2);
    x.fillStyle = "rgba(255,186,110,0.5)";
    x.fillRect(wx, wy, ww, wh);
  }
  x.globalCompositeOperation = "source-over";
  return c;
}

function canopySprite(w: number, h: number): HTMLCanvasElement {
  // a roadside fuel stop, unbranded: a flat roof on four posts, lit from underneath, a kiosk behind it
  const { c, x } = sprite(w, h);
  const gy = h - 3;
  // light on the ground under the roof
  const pool = x.createRadialGradient(w * 0.46, gy, 0, w * 0.46, gy, w * 0.5);
  pool.addColorStop(0, "rgba(230,255,235,0.5)");
  pool.addColorStop(1, "rgba(230,255,235,0)");
  x.save();
  x.translate(0, gy);
  x.scale(1, 0.14);
  x.translate(0, -gy);
  x.fillStyle = pool;
  x.fillRect(0, gy - w * 0.5, w, w);
  x.restore();
  // the kiosk
  x.fillStyle = "#0f1a18";
  x.fillRect(w * 0.64, h * 0.42, w * 0.3, h * 0.55);
  x.globalCompositeOperation = "lighter";
  x.fillStyle = "rgba(200,240,215,0.55)";
  x.fillRect(w * 0.7, h * 0.54, w * 0.15, h * 0.12);
  x.globalCompositeOperation = "source-over";
  // posts and the roof
  x.fillStyle = "#17211f";
  for (const px of [0.12, 0.3, 0.46, 0.58]) x.fillRect(w * px, h * 0.3, w * 0.018, gy - h * 0.3);
  x.fillStyle = "#0b1311";
  x.fillRect(w * 0.04, h * 0.18, w * 0.64, h * 0.13);
  x.globalCompositeOperation = "lighter";
  const roof = x.createLinearGradient(0, h * 0.28, 0, h * 0.42);
  roof.addColorStop(0, "rgba(220,255,236,0.95)");
  roof.addColorStop(1, "rgba(220,255,236,0)");
  x.fillStyle = roof;
  x.fillRect(w * 0.05, h * 0.3, w * 0.62, h * 0.12);
  // a stripe of mint along the roof edge
  x.fillStyle = "rgba(138,217,168,0.9)";
  x.fillRect(w * 0.04, h * 0.285, w * 0.64, h * 0.025);
  x.globalCompositeOperation = "source-over";
  return c;
}

function standSprite(rng: () => number, w: number, h: number): HTMLCanvasElement {
  // a grandstand seen side-on at night: a dark stepped bank with a scatter of people (clustered, uneven, dim), a roof whose underside glows a little; its ends fade out
  const c = canvas(w, h);
  const x = c.getContext("2d")!;
  const rows = 5;
  const baseY = h - 2;
  const sh = h * 0.48;
  const bank = x.createLinearGradient(0, baseY - sh, 0, baseY);
  bank.addColorStop(0, "#0a1411");
  bank.addColorStop(1, "#101c18");
  x.fillStyle = bank;
  x.fillRect(w * 0.06, baseY - sh, w * 0.88, sh);
  // a few phases make the crowd clump and thin instead of falling in rows
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  for (let r = 0; r < rows; r++) {
    const y1 = baseY - (sh * r) / rows;
    const y0 = baseY - (sh * (r + 1)) / rows;
    // the step's edge, barely there
    x.fillStyle = "rgba(242,234,215,0.05)";
    x.fillRect(w * 0.06, y0, w * 0.88, 0.8);
    const n = Math.round(w / 9);
    for (let i = 0; i < n; i++) {
      const px = w * 0.07 + rng() * w * 0.86;
      const u = px / w;
      const density = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(u * 17 + ph[0] + r)) * (0.6 + 0.4 * Math.sin(u * 41 + ph[1]));
      if (rng() > density * 0.8) continue;
      const py = y0 + (y1 - y0) * (0.35 + rng() * 0.55);
      const rad = 0.8 + rng() * 0.9;
      const tone = rng();
      x.fillStyle = tone < 0.06 ? "rgba(242,234,215,0.3)" : tone < 0.12 ? "rgba(138,217,168,0.26)" : tone < 0.2 ? "rgba(255,196,120,0.22)" : `rgba(${50 + Math.floor(rng() * 24)},${66 + Math.floor(rng() * 24)},${64 + Math.floor(rng() * 20)},0.7)`;
      x.beginPath();
      x.arc(px, py, rad, 0, Math.PI * 2);
      x.fill();
    }
  }
  // roof, on a few posts
  x.fillStyle = "#08100e";
  x.fillRect(w * 0.04, h * 0.1, w * 0.92, h * 0.09);
  x.fillStyle = "rgba(26,38,35,0.8)";
  for (let i = 0; i <= 5; i++) x.fillRect(w * (0.07 + i * 0.172), h * 0.19, 1.6, baseY - sh - h * 0.19 + 2);
  x.globalCompositeOperation = "lighter";
  const under = x.createLinearGradient(0, h * 0.18, 0, h * 0.34);
  under.addColorStop(0, "rgba(255,226,170,0.26)");
  under.addColorStop(1, "rgba(255,226,170,0)");
  x.fillStyle = under;
  x.fillRect(w * 0.05, h * 0.19, w * 0.9, h * 0.15);
  x.globalCompositeOperation = "destination-in";
  const fade = x.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.1, "rgba(0,0,0,1)");
  fade.addColorStop(0.9, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = fade;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = "source-over";
  return c;
}

function rockSprite(rng: () => number, w: number, h: number): HTMLCanvasElement {
  const { c, x } = sprite(w, h);
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#1c2724");
  g.addColorStop(1, "#0b1210");
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(1, h);
  const pts = 7;
  for (let i = 0; i < pts; i++) x.lineTo(1 + ((w - 2) * (i + 1)) / (pts + 1), h * (0.18 + rng() * 0.5));
  x.lineTo(w - 1, h);
  x.closePath();
  x.fill();
  x.strokeStyle = "rgba(150,210,180,0.18)";
  x.lineWidth = 1;
  x.stroke();
  return c;
}

function makeSprites(rng: () => number): Sprites {
  const smoke = canvas(64, 64);
  const x = smoke.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(214,218,224,0.85)");
  g.addColorStop(0.5, "rgba(190,196,204,0.35)");
  g.addColorStop(1, "rgba(170,176,186,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  // a lamp's reflection: bright at the top, gone by the bottom
  const streak = canvas(16, 128);
  const sx = streak.getContext("2d")!;
  const sg = sx.createLinearGradient(0, 0, 0, 128);
  sg.addColorStop(0, "rgba(255,206,130,0.9)");
  sg.addColorStop(0.25, "rgba(255,196,110,0.4)");
  sg.addColorStop(1, "rgba(255,190,100,0)");
  sx.fillStyle = sg;
  sx.beginPath();
  sx.ellipse(8, 40, 6, 120, 0, 0, Math.PI * 2);
  sx.fill();
  // the beams in the air: a wedge, strongest at the car
  const cone = canvas(128, 128);
  const cx = cone.getContext("2d")!;
  const cg = cx.createLinearGradient(0, 0, 0, 128);
  cg.addColorStop(0, "rgba(255,244,214,0)");
  cg.addColorStop(1, "rgba(255,244,214,0.5)");
  cx.fillStyle = cg;
  cx.beginPath();
  cx.moveTo(0, 0);
  cx.lineTo(128, 0);
  cx.lineTo(80, 128);
  cx.lineTo(48, 128);
  cx.closePath();
  cx.fill();
  cx.globalCompositeOperation = "destination-in";
  const edge = cx.createLinearGradient(0, 0, 128, 0);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(0.28, "rgba(0,0,0,1)");
  edge.addColorStop(0.72, "rgba(0,0,0,1)");
  edge.addColorStop(1, "rgba(0,0,0,0)");
  cx.fillStyle = edge;
  cx.fillRect(0, 0, 128, 128);
  // the car's shadow
  const shadow = canvas(96, 48);
  const dx = shadow.getContext("2d")!;
  dx.translate(48, 24);
  dx.scale(1, 0.5);
  const dg = dx.createRadialGradient(0, 0, 0, 0, 0, 48);
  dg.addColorStop(0, "rgba(0,0,0,0.95)");
  dg.addColorStop(0.55, "rgba(0,0,0,0.7)");
  dg.addColorStop(1, "rgba(0,0,0,0)");
  dx.fillStyle = dg;
  dx.fillRect(-48, -48, 96, 96);
  return {
    red: glow([255, 40, 30], 96, 0.08),
    white: glow([255, 246, 226], 96, 0.1),
    orange: glow([255, 150, 50], 64, 0.12),
    mint: glow([138, 217, 168], 96, 0.1),
    sodium: glow([255, 200, 110], 64, 0.12),
    smoke,
    streak,
    cone,
    shadow,
    pine: [treeSprite(rng, 56, 128, 5, 0), treeSprite(rng, 48, 112, 4, 1.5), treeSprite(rng, 64, 120, 6, -1)],
    house: [houseSprite(rng, 96, 60, 0), houseSprite(rng, 80, 64, 1)],
    canopy: canopySprite(176, 72),
    stand: standSprite(rng, 400, 108),
    rock: rockSprite(rng, 64, 40),
  };
}

/** a looped value noise: `n` lattice points around the panorama, smooth between them, in 0..1 */
function loopNoise(rng: () => number, n: number): (u: number) => number {
  const v: number[] = [];
  for (let i = 0; i < n; i++) v.push(rng());
  return (u) => {
    const f = (((u % 1) + 1) % 1) * n;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    return v[i % n] + (v[(i + 1) % n] - v[i % n]) * s;
  };
}

/** a ridge that wraps: broad swells, then octaves of pointed noise; `peaky` is how sharp the summits are (0 is a rolling hill) */
function ridge(rng: () => number, W: number, base: number, octaves: number, peaky: number): (x: number) => number {
  const layers: { fn: (u: number) => number; amp: number }[] = [];
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ fn: loopNoise(rng, base * Math.pow(2, o)), amp });
    total += amp;
    amp *= 0.5;
  }
  return (px) => {
    const u = px / W;
    let s = 0;
    for (const l of layers) {
      const n = l.fn(u);
      // 1 - |2n - 1| makes a point where the noise turns over; mixed with the plain noise by `peaky`
      s += l.amp * (n * (1 - peaky) + (1 - Math.abs(2 * n - 1)) * peaky);
    }
    return s / total;
  };
}

type Skyline = Pano & { heights: number[] };

function mountains(th: Theme, rng: () => number, W: number, H: number, top: RGB, bottom: RGB, rim: number, floorFrac: number, o: { base: number; octaves: number; peaky: number; haze: number; teeth?: boolean }): Skyline {
  const c = canvas(W, H);
  const x = c.getContext("2d")!;
  const r = ridge(rng, W, o.base, o.octaves, o.peaky);
  const heights: number[] = [];
  const step = 2;
  for (let px = 0; px <= W; px += step) {
    let hgt = H * (floorFrac + (1 - floorFrac) * Math.pow(r(px), 1.25) * 0.98);
    // a serrated edge of pines on the near ridge
    if (o.teeth) hgt += (Math.sin(px * 0.9) * 0.5 + 0.5) * (px % 7 < 3 ? 5 : 2.2) * (H / 80) * (0.5 + 0.5 * Math.sin(px * 0.013));
    heights.push(Math.min(H - 1, hgt));
  }
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, css(top));
  g.addColorStop(1, css(bottom));
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(0, H);
  heights.forEach((hgt, i) => x.lineTo(i * step, H - hgt));
  x.lineTo(W, H);
  x.closePath();
  x.fill();
  // haze lies in the valleys: the foot of the range takes the colour of the horizon
  if (o.haze > 0) {
    x.globalCompositeOperation = "source-atop";
    const hz = x.createLinearGradient(0, H * 0.35, 0, H);
    hz.addColorStop(0, css(th.fog, 0));
    hz.addColorStop(1, css(th.fog, o.haze));
    x.fillStyle = hz;
    x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = "source-over";
  }
  if (rim > 0) {
    // the edge the moon catches
    x.strokeStyle = `${th.rim}${rim})`;
    x.lineWidth = 1.3;
    x.beginPath();
    heights.forEach((hgt, i) => (i ? x.lineTo(i * step, H - hgt + 0.7) : x.moveTo(0, H - hgt + 0.7)));
    x.stroke();
  }
  return { c, W, H, heights };
}

function stars(rng: () => number, W: number, H: number, moonAt: number, moonR: number, density = 1): Pano {
  const c = canvas(W, H);
  const x = c.getContext("2d")!;
  const n = Math.round(((W * H) / 1700) * density);
  for (let i = 0; i < n; i++) {
    const px = rng() * W;
    // thicker toward the top of the sky, thinner into the haze
    const py = Math.pow(rng(), 0.8) * H * 0.96;
    const mag = rng();
    const a = 0.25 + 0.7 * Math.pow(rng(), 2) * (1 - (py / H) * 0.7);
    const tint = rng();
    x.fillStyle = tint < 0.12 ? `rgba(255,214,170,${a})` : tint < 0.3 ? `rgba(190,226,255,${a})` : `rgba(255,255,255,${a})`;
    const s = mag > 0.985 ? 2.4 : mag > 0.9 ? 1.6 : 1.1;
    x.fillRect(px, py, s, s);
    if (mag > 0.985) {
      x.fillStyle = `rgba(255,255,255,${a * 0.2})`;
      x.fillRect(px - 2, py + s / 2 - 0.4, s + 4, 0.8);
      x.fillRect(px + s / 2 - 0.4, py - 2, 0.8, s + 4);
    }
  }
  const my = H * 0.6;
  // thin cloud, lit from the moon's side: a few long soft wisps low in the sky, a little above the ridge
  x.globalCompositeOperation = "lighter";
  for (let i = 0; i < 9; i++) {
    const cx = moonAt + (rng() - 0.5) * moonR * 26;
    const cy = my + moonR * (1.2 + rng() * 5);
    const rx = moonR * (3 + rng() * 6);
    const ry = moonR * (0.18 + rng() * 0.3);
    const near = Math.max(0, 1 - Math.hypot(cx - moonAt, cy - my) / (moonR * 14));
    x.save();
    x.translate(cx, cy);
    x.scale(1, ry / rx);
    const cg = x.createRadialGradient(0, 0, 0, 0, 0, rx);
    cg.addColorStop(0, `rgba(150,196,184,${(0.05 + 0.1 * near).toFixed(3)})`);
    cg.addColorStop(1, "rgba(150,196,184,0)");
    x.fillStyle = cg;
    x.fillRect(-rx, -rx, rx * 2, rx * 2);
    x.restore();
  }
  x.globalCompositeOperation = "source-over";
  // the moon: a wide soft halo, then a disc with a little shading
  const halo = x.createRadialGradient(moonAt, my, moonR * 0.8, moonAt, my, moonR * 9);
  halo.addColorStop(0, "rgba(190,226,215,0.3)");
  halo.addColorStop(0.3, "rgba(150,204,186,0.1)");
  halo.addColorStop(1, "rgba(120,190,170,0)");
  x.fillStyle = halo;
  x.fillRect(moonAt - moonR * 9, my - moonR * 9, moonR * 18, moonR * 18);
  const disc = x.createRadialGradient(moonAt - moonR * 0.3, my - moonR * 0.25, moonR * 0.1, moonAt, my, moonR);
  disc.addColorStop(0, "#fbf6e6");
  disc.addColorStop(0.8, "#e7e6da");
  disc.addColorStop(1, "#cdd2cb");
  x.fillStyle = disc;
  x.beginPath();
  x.arc(moonAt, my, moonR, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "rgba(120,134,138,0.22)";
  for (const [dx, dy, r] of [[-0.35, -0.2, 0.22], [0.25, 0.15, 0.3], [-0.05, 0.5, 0.16], [0.4, -0.4, 0.14], [-0.5, 0.25, 0.1]]) {
    x.beginPath();
    x.arc(moonAt + dx * moonR, my + dy * moonR, r * moonR, 0, Math.PI * 2);
    x.fill();
  }
  return { c, W, H };
}

function city(rng: () => number, W: number, H: number, scale: number): Pano {
  const c = canvas(W, H);
  const x = c.getContext("2d")!;
  // a handful of districts, each a cloud of lights, and a few long streets
  const clusters = 26;
  const cols: RGB[] = [[255, 232, 186], [255, 198, 120], [255, 170, 96], [196, 224, 255], [255, 244, 224], [138, 217, 168]];
  x.globalCompositeOperation = "lighter";
  for (let k = 0; k < clusters; k++) {
    const cx = rng() * W;
    const cy = H * (0.25 + 0.6 * rng());
    const spread = (60 + rng() * 240) * scale;
    const n = Math.round((90 + rng() * 260) * scale);
    const halo = x.createRadialGradient(cx, cy, 0, cx, cy, spread * 0.9);
    halo.addColorStop(0, "rgba(255,190,120,0.1)");
    halo.addColorStop(1, "rgba(255,190,120,0)");
    x.fillStyle = halo;
    x.fillRect(cx - spread, cy - spread, spread * 2, spread * 2);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.pow(rng(), 0.7) * spread;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r * 0.32;
      if (py < 0 || py > H) continue;
      const col = cols[Math.floor(rng() * rng() * cols.length)];
      const al = 0.35 + rng() * 0.65;
      x.fillStyle = css(col, al);
      const s = rng() > 0.93 ? 2.2 : 1.3;
      x.fillRect(px, py, s * scale + 0.4, s * scale + 0.4);
    }
  }
  // streets of lights
  for (let k = 0; k < 18; k++) {
    let px = rng() * W;
    let py = H * (0.3 + 0.55 * rng());
    const dx = (rng() - 0.5) * 6;
    const len = Math.round(30 + rng() * 80);
    x.fillStyle = "rgba(255,206,140,0.55)";
    for (let i = 0; i < len; i++) {
      x.fillRect(px, py, 1.2 * scale + 0.3, 1.1 * scale + 0.3);
      px += dx * scale * 0.6;
      py += (rng() - 0.5) * 0.9;
    }
  }
  x.globalCompositeOperation = "destination-in";
  const fade = x.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, "rgba(0,0,0,0.55)");
  fade.addColorStop(0.25, "rgba(0,0,0,1)");
  fade.addColorStop(0.85, "rgba(0,0,0,0.9)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = fade;
  x.fillRect(0, 0, W, H);
  return { c, W, H };
}

/** a sea of cloud below the horizon, lit from above by the moon: soft long banks, a few brighter, thinning to nothing at the top and the foot */
function cloudSea(rng: () => number, W: number, H: number, scale: number, fog: RGB): Pano {
  const c = canvas(W, H);
  const x = c.getContext("2d")!;
  for (let layer = 0; layer < 3; layer++) {
    const n = Math.round(W / (90 * scale)) + 6;
    for (let i = 0; i < n; i++) {
      const cx = rng() * W;
      const cy = H * (0.32 + 0.5 * rng() + layer * 0.06);
      const rx = (110 + rng() * 300) * scale;
      const ry = rx * (0.07 + rng() * 0.08);
      const lit = 0.25 + 0.75 * rng() * (1 - layer * 0.25);
      x.save();
      x.translate(cx, cy);
      x.scale(1, ry / rx);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, css(mix(fog, [150, 180, 214], lit), 0.5 - layer * 0.08));
      g.addColorStop(1, css(mix(fog, [150, 180, 214], lit), 0));
      x.fillStyle = g;
      for (const wrap of [-W, 0, W]) {
        if (cx + wrap + rx < 0 || cx + wrap - rx > W) continue;
        x.save();
        x.translate(wrap, 0);
        x.fillRect(-rx, -rx, rx * 2, rx * 2);
        x.restore();
      }
      x.restore();
    }
  }
  x.globalCompositeOperation = "destination-in";
  const fade = x.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.3, "rgba(0,0,0,1)");
  fade.addColorStop(0.85, "rgba(0,0,0,0.95)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = fade;
  x.fillRect(0, 0, W, H);
  return { c, W, H };
}

/** landmarks drawn into a ridge's panorama: radio masts with their red lamps, and lines of pylons with their cables */
function landmarks(rng: () => number, p: Skyline, s: number, o: { mast: number; pylons: number }) {
  const x = p.c.getContext("2d")!;
  const at = (px: number) => p.H - p.heights[Math.max(0, Math.min(p.heights.length - 1, Math.round(px / 2)))];
  for (let m = 0; m < o.mast; m++) {
    const px = rng() * p.W;
    // the highest point near px
    let bx = px;
    let by = at(px);
    for (let d = -60; d <= 60; d += 2) {
      const y = at(px + d);
      if (y < by) {
        by = y;
        bx = px + d;
      }
    }
    const h = 34 * s;
    x.strokeStyle = "rgba(6,12,10,0.95)";
    x.lineWidth = 1.6;
    x.beginPath();
    x.moveTo(bx, by + 2);
    x.lineTo(bx, by - h);
    x.stroke();
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(bx - 4 * s, by - h * 0.35);
    x.lineTo(bx + 4 * s, by - h * 0.35);
    x.moveTo(bx - 3 * s, by - h * 0.7);
    x.lineTo(bx + 3 * s, by - h * 0.7);
    x.stroke();
    x.globalCompositeOperation = "lighter";
    for (const hh of [1, 0.7, 0.35]) {
      const gy = by - h * hh;
      const g = x.createRadialGradient(bx, gy, 0, bx, gy, 7 * s);
      g.addColorStop(0, "rgba(255,70,50,0.95)");
      g.addColorStop(0.25, "rgba(255,60,40,0.4)");
      g.addColorStop(1, "rgba(255,60,40,0)");
      x.fillStyle = g;
      x.fillRect(bx - 7 * s, gy - 7 * s, 14 * s, 14 * s);
    }
    x.globalCompositeOperation = "source-over";
  }
  for (let l = 0; l < o.pylons; l++) {
    const start = rng() * p.W;
    const gap = (50 + rng() * 30) * s;
    let prev: [number, number] | null = null;
    for (let i = 0; i < 6; i++) {
      const px = (start + i * gap) % p.W;
      const py = at(px) + 1;
      const h = 17 * s;
      x.strokeStyle = "rgba(5,10,9,0.96)";
      x.lineWidth = 1.4;
      x.beginPath();
      x.moveTo(px - 3 * s, py);
      x.lineTo(px, py - h);
      x.lineTo(px + 3 * s, py);
      x.moveTo(px - 4.5 * s, py - h * 0.78);
      x.lineTo(px + 4.5 * s, py - h * 0.78);
      x.moveTo(px - 3.5 * s, py - h * 0.52);
      x.lineTo(px + 3.5 * s, py - h * 0.52);
      x.stroke();
      const top: [number, number] = [px, py - h * 0.78];
      if (prev && Math.abs(top[0] - prev[0]) < gap * 1.4) {
        x.lineWidth = 0.8;
        x.beginPath();
        x.moveTo(prev[0], prev[1]);
        x.quadraticCurveTo((prev[0] + top[0]) / 2, Math.max(prev[1], top[1]) + 5 * s, top[0], top[1]);
        x.stroke();
      }
      prev = top;
    }
  }
}

export function buildAssets(ctx: CanvasRenderingContext2D, w: number, h: number, theme: TrackId = "canyon"): Assets {
  const th = THEMES[theme];
  const rng = seeded(th.seed);
  const hy0 = Math.round(h * th.hy);
  const fRef = Math.max(w * 0.74, h * 0.7);
  const W = Math.round(Math.min(7200, Math.max(w * 2.2, Math.PI * 2 * fRef)));
  const px = W / (Math.PI * 2);
  const s = Math.max(0.6, Math.min(1.6, h / 700));

  // the backdrop: taller than the screen, so a hill's tilt of the horizon only slides it
  const dpr = Math.max(1, ctx.getTransform ? ctx.getTransform().a : 1);
  const pad = 8;
  const margin = Math.round(h * 0.42);
  const bd = canvas((w + pad * 2) * dpr, (h + margin * 2) * dpr);
  const bx = bd.getContext("2d")!;
  bx.scale(dpr, dpr);
  const bw = w + pad * 2;
  const sky = bx.createLinearGradient(0, 0, 0, margin + hy0 + h * 0.1);
  for (const [at, col] of th.sky) sky.addColorStop(at, col);
  bx.fillStyle = sky;
  bx.fillRect(0, 0, bw, margin + hy0 + h * 0.14);
  // the glow of a town below the horizon: warm at the foot, a wash above it (the climb has no town: the haze is the moon on the snow and the cloud)
  bx.globalCompositeOperation = "lighter";
  const wash = bx.createLinearGradient(0, margin + hy0 - h * 0.22, 0, margin + hy0 + h * 0.1);
  wash.addColorStop(0, `${th.wash}0)`);
  wash.addColorStop(0.7, `${th.wash}0.07)`);
  wash.addColorStop(1, `${th.wash}0)`);
  bx.fillStyle = wash;
  bx.fillRect(0, margin + hy0 - h * 0.22, bw, h * 0.32);
  const haze = bx.createLinearGradient(0, margin + hy0 - h * 0.1, 0, margin + hy0 + h * 0.16);
  haze.addColorStop(0, th.haze[0]);
  haze.addColorStop(0.55, th.haze[1]);
  haze.addColorStop(1, th.haze[2]);
  bx.fillStyle = haze;
  bx.fillRect(0, margin + hy0 - h * 0.1, bw, h * 0.26);
  bx.globalCompositeOperation = "source-over";
  const ground = bx.createLinearGradient(0, margin + hy0 + h * 0.08, 0, margin * 2 + h);
  for (const [at, col] of th.ground) ground.addColorStop(at, col);
  bx.fillStyle = ground;
  bx.fillRect(0, margin + hy0 + h * 0.1, bw, margin * 2 + h);

  // the vignette at device size: a stretched small one costs a scaled blend of the whole screen every frame
  const vw = 96;
  const vh = Math.max(24, Math.round((96 * h) / w));
  const vig = canvas(w * dpr, h * dpr);
  const vx = vig.getContext("2d")!;
  vx.scale((w * dpr) / vw, (h * dpr) / vh);
  const vg = vx.createRadialGradient(vw / 2, vh * 0.56, Math.min(vw, vh) * 0.35, vw / 2, vh * 0.56, Math.hypot(vw, vh) * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,4,3,0.62)");
  vx.fillStyle = vg;
  vx.fillRect(0, 0, vw, vh);

  const starsH = Math.round(hy0 + h * 0.25);
  // the moon sits ahead and to the right of the start, where the opening picture has room for it
  const starPano = stars(rng, W, starsH, w * 0.7, Math.max(14, 20 * s * th.moon), th.stars);
  const f = th.far;
  const far = mountains(th, rng, W, Math.round(h * f.h), f.top, f.bottom, f.rim, f.floor, { base: 5, octaves: 6, peaky: f.peaky, haze: f.haze });
  landmarks(rng, far, s, { mast: theme === "climb" ? 2 : 3, pylons: 0 });
  const cityPano = th.clouds ? cloudSea(rng, W, Math.round(h * 0.17), s, th.fog) : city(rng, W, Math.round(h * 0.17), s);
  const mid = mountains(th, rng, W, Math.round(h * 0.18), th.mid.top, th.mid.bottom, th.mid.rim, 0.12, { base: 6, octaves: 5, peaky: 0.5, haze: 0.3 });
  landmarks(rng, mid, s, { mast: 0, pylons: theme === "climb" ? 0 : 2 });
  const near = mountains(th, rng, W, Math.round(h * 0.12), th.near.top, th.near.bottom, th.near.rim, 0.1, { base: 7, octaves: 4, peaky: 0.3, haze: 0, teeth: th.near.teeth });

  return { theme, w, h, dpr, backdropPad: pad, hy0, px, backdrop: bd, backdropTop: margin, vignette: vig, stars: starPano, far, city: cityPano, mid, near, sprites: makeSprites(rng), pal: makePalette(th) };
}
