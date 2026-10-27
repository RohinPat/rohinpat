import { seeded } from "../useCanvas";

// The pictures that never change while the page is open, made once per canvas
// size and then only drawn: the sky with its stars and moon, three ridges of
// mountains, a city glowing in the valley, a few soft glow sprites, and the
// colour tables the road is painted from (the colours step with the distance,
// so the headlights fade out along the road without a string being built in a
// frame). The panoramas wrap all the way round, and slide with the camera's
// heading, each a little differently, so the far ranges swing slower than the
// near ridge.

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
  edge: string[];
  rail: string[];
  railHi: string[];
  post: string[];
  reflL: string[];
  reflR: string[];
  rock: string[];
  rockAlt: string[];
  tunnel: string[];
  ceiling: string[];
  lamp: string[];
  parapet: string[];
  board: string[];
};

export type Sprites = { red: HTMLCanvasElement; white: HTMLCanvasElement; orange: HTMLCanvasElement; mint: HTMLCanvasElement; smoke: HTMLCanvasElement; sodium: HTMLCanvasElement };

export type Assets = {
  w: number;
  h: number;
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

const FOG: RGB = [10, 14, 20];

function makePalette(): Palette {
  const pal: Palette = { road: [], edge: [], rail: [], railHi: [], post: [], reflL: [], reflR: [], rock: [], rockAlt: [], tunnel: [], ceiling: [], lamp: [], parapet: [], board: [] };
  for (let b = 0; b < BUCKETS; b++) {
    const z = bucketZ(b);
    const beam = Math.exp(-Math.max(0, z - 6) / 27);
    const refl = 0.1 + 0.9 * Math.exp(-Math.max(0, z - 6) / 190);
    const fog = smooth((z - 120) / 700) * 0.7;
    const tone = (dark: RGB, lit: RGB, k: number): RGB => mix(mix(dark, lit, k), FOG, fog);
    pal.road.push(css(tone([11, 14, 18], [64, 63, 56], beam)));
    pal.edge.push(css(mix(mix([46, 44, 40], [238, 232, 214], refl), FOG, fog * 0.6)));
    pal.rail.push(css(tone([18, 22, 27], [124, 132, 138], beam * 0.92)));
    pal.railHi.push(css(tone([30, 36, 42], [214, 222, 228], Math.min(1, beam * 1.1))));
    pal.post.push(css(tone([27, 31, 35], [150, 156, 160], beam)));
    pal.reflR.push(css([236, 246, 255], Math.min(1, 0.22 + 0.78 * refl)));
    pal.reflL.push(css([255, 176, 66], Math.min(1, 0.22 + 0.78 * refl)));
    const rockBeam = Math.exp(-Math.max(0, z - 6) / 22);
    pal.rock.push(css(tone([10, 13, 18], [46, 48, 52], rockBeam)));
    pal.rockAlt.push(css(tone([11, 14, 19], [49, 51, 54], rockBeam)));
    const lampLit = 0.3 + 0.7 * Math.exp(-z / 70);
    pal.tunnel.push(css(tone([20, 22, 25], [158, 146, 118], lampLit)));
    pal.ceiling.push(css(tone([12, 13, 16], [96, 90, 72], lampLit * 0.7)));
    pal.lamp.push(css(mix([255, 232, 170], FOG, fog * 0.4)));
    pal.parapet.push(css(tone([30, 33, 36], [172, 172, 162], beam)));
    pal.board.push(css(tone([14, 19, 26], [52, 62, 76], beam)));
  }
  return pal;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
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

function makeSprites(): Sprites {
  const smoke = canvas(64, 64);
  const x = smoke.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(214,218,224,0.85)");
  g.addColorStop(0.5, "rgba(190,196,204,0.35)");
  g.addColorStop(1, "rgba(170,176,186,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return {
    red: glow([255, 40, 30], 96, 0.08),
    white: glow([255, 246, 226], 96, 0.1),
    orange: glow([255, 150, 50], 64, 0.12),
    mint: glow([138, 217, 168], 96, 0.1),
    sodium: glow([255, 200, 110], 64, 0.12),
    smoke,
  };
}

/** a ridge line that wraps: a sum of sines whose periods divide the panorama */
function ridge(rng: () => number, W: number, terms: number, rough: number): (x: number) => number {
  const ph: number[] = [];
  const am: number[] = [];
  const ks: number[] = [];
  for (let i = 0; i < terms; i++) {
    const k = 2 + Math.floor(rng() * 5) + i * 3;
    ks.push(k);
    ph.push(rng() * Math.PI * 2);
    am.push(1 / Math.pow(k, rough));
  }
  const norm = am.reduce((a, b) => a + b, 0);
  return (x) => {
    let s = 0;
    for (let i = 0; i < terms; i++) s += am[i] * Math.sin((x / W) * Math.PI * 2 * ks[i] + ph[i]);
    return (s / norm) * 0.5 + 0.5;
  };
}

function mountains(rng: () => number, W: number, H: number, top: RGB, bottom: RGB, rim: number, floorFrac: number, rough: number): Pano {
  const c = canvas(W, H);
  const x = c.getContext("2d")!;
  const r = ridge(rng, W, 9, rough);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, css(top));
  g.addColorStop(1, css(bottom));
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(0, H);
  const heights: number[] = [];
  for (let px = 0; px <= W; px += 3) {
    const hgt = H * (floorFrac + (1 - floorFrac) * r(px) * 0.96);
    heights.push(hgt);
    x.lineTo(px, H - hgt);
  }
  x.lineTo(W, H);
  x.closePath();
  x.fill();
  if (rim > 0) {
    x.strokeStyle = `rgba(150,176,220,${rim})`;
    x.lineWidth = 1.4;
    x.beginPath();
    heights.forEach((hgt, i) => (i ? x.lineTo(i * 3, H - hgt + 0.7) : x.moveTo(0, H - hgt + 0.7)));
    x.stroke();
  }
  return { c, W, H };
}

function stars(rng: () => number, W: number, H: number, moonAt: number, moonR: number): Pano {
  const c = canvas(W, H);
  const x = c.getContext("2d")!;
  const n = Math.round((W * H) / 1900);
  for (let i = 0; i < n; i++) {
    const px = rng() * W;
    // thicker toward the top of the sky, thinner into the haze
    const py = Math.pow(rng(), 0.8) * H * 0.96;
    const mag = rng();
    const a = 0.25 + 0.7 * Math.pow(rng(), 2) * (1 - (py / H) * 0.65);
    const tint = rng();
    x.fillStyle = tint < 0.12 ? `rgba(255,214,170,${a})` : tint < 0.3 ? `rgba(190,214,255,${a})` : `rgba(255,255,255,${a})`;
    const s = mag > 0.985 ? 2.4 : mag > 0.9 ? 1.6 : 1.1;
    x.fillRect(px, py, s, s);
    if (mag > 0.985) {
      x.fillStyle = `rgba(255,255,255,${a * 0.2})`;
      x.fillRect(px - 2, py + s / 2 - 0.4, s + 4, 0.8);
      x.fillRect(px + s / 2 - 0.4, py - 2, 0.8, s + 4);
    }
  }
  // the moon: a soft halo, then a disc with a little shading
  const my = H * 0.4;
  const halo = x.createRadialGradient(moonAt, my, moonR * 0.8, moonAt, my, moonR * 7);
  halo.addColorStop(0, "rgba(190,210,245,0.28)");
  halo.addColorStop(0.35, "rgba(150,180,235,0.08)");
  halo.addColorStop(1, "rgba(120,150,220,0)");
  x.fillStyle = halo;
  x.fillRect(moonAt - moonR * 7, my - moonR * 7, moonR * 14, moonR * 14);
  const disc = x.createRadialGradient(moonAt - moonR * 0.3, my - moonR * 0.25, moonR * 0.1, moonAt, my, moonR);
  disc.addColorStop(0, "#fbf6e6");
  disc.addColorStop(0.8, "#e5e4dc");
  disc.addColorStop(1, "#c9cccb");
  x.fillStyle = disc;
  x.beginPath();
  x.arc(moonAt, my, moonR, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "rgba(120,130,140,0.22)";
  for (const [dx, dy, r] of [[-0.35, -0.2, 0.22], [0.25, 0.15, 0.3], [-0.05, 0.5, 0.16], [0.4, -0.4, 0.14]]) {
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

export function buildAssets(ctx: CanvasRenderingContext2D, w: number, h: number): Assets {
  const rng = seeded(90210);
  const hy0 = Math.round(h * 0.4);
  const fRef = Math.max(w * 0.74, h * 0.7);
  const W = Math.round(Math.min(7200, Math.max(w * 2.2, Math.PI * 2 * fRef)));
  const px = W / (Math.PI * 2);
  const s = Math.max(0.6, Math.min(1.6, h / 700));

  // the backdrop: taller than the screen, so a hill's tilt of the horizon only slides it
  const margin = Math.round(h * 0.42);
  const bd = canvas(w, h + margin * 2);
  const bx = bd.getContext("2d")!;
  const sky = bx.createLinearGradient(0, 0, 0, margin + hy0 + h * 0.1);
  sky.addColorStop(0, "#02040a");
  sky.addColorStop(0.5, "#07101c");
  sky.addColorStop(0.82, "#0f1d2d");
  sky.addColorStop(1, "#1d2a38");
  bx.fillStyle = sky;
  bx.fillRect(0, 0, w, margin + hy0 + h * 0.14);
  const haze = bx.createLinearGradient(0, margin + hy0 - h * 0.1, 0, margin + hy0 + h * 0.16);
  haze.addColorStop(0, "rgba(255,170,110,0)");
  haze.addColorStop(0.55, "rgba(255,160,100,0.1)");
  haze.addColorStop(1, "rgba(255,150,90,0)");
  bx.globalCompositeOperation = "lighter";
  bx.fillStyle = haze;
  bx.fillRect(0, margin + hy0 - h * 0.1, w, h * 0.26);
  bx.globalCompositeOperation = "source-over";
  const ground = bx.createLinearGradient(0, margin + hy0 + h * 0.08, 0, margin * 2 + h);
  ground.addColorStop(0, "#0a1016");
  ground.addColorStop(0.35, "#070b0f");
  ground.addColorStop(1, "#030507");
  bx.fillStyle = ground;
  bx.fillRect(0, margin + hy0 + h * 0.1, w, margin * 2 + h);

  const vw = 96;
  const vh = Math.max(24, Math.round((96 * h) / w));
  const vig = canvas(vw, vh);
  const vx = vig.getContext("2d")!;
  const vg = vx.createRadialGradient(vw / 2, vh * 0.56, Math.min(vw, vh) * 0.35, vw / 2, vh * 0.56, Math.hypot(vw, vh) * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.62)");
  vx.fillStyle = vg;
  vx.fillRect(0, 0, vw, vh);

  const starsH = Math.round(hy0 + h * 0.25);
  const starPano = stars(rng, W, starsH, W * 0.14, Math.max(14, 22 * s));
  const far = mountains(rng, W, Math.round(h * 0.2), [28, 40, 60], [14, 21, 32], 0.2, 0.18, 0.95);
  const cityPano = city(rng, W, Math.round(h * 0.17), s);
  const mid = mountains(rng, W, Math.round(h * 0.17), [15, 22, 33], [9, 14, 21], 0.1, 0.12, 0.8);
  const near = mountains(rng, W, Math.round(h * 0.12), [9, 14, 21], [6, 10, 15], 0.05, 0.1, 0.7);

  return { w, h, hy0, px, backdrop: bd, backdropTop: margin, vignette: vig, stars: starPano, far, city: cityPano, mid, near, sprites: makeSprites(), pal: makePalette() };
}
