// Webcam simulation for QR robustness tests: renders a QR code into a low
// resolution RGBA frame with area-averaged sampling, rotation, blur, noise and
// reduced contrast. Pure TS so it runs under vitest/node. Test-only helper.

import type { QrMatrix } from "./qr";

export interface SimOptions {
  width: number;
  height: number;
  /** QR (including its 4-module quiet zone) height as a fraction of min(width,height) */
  fill: number;
  angleDeg?: number;
  /** box-blur radius in output pixels (defocus / motion) */
  blur?: number;
  /** gaussian-ish noise amplitude (0-255 scale, sigma) */
  noise?: number;
  /** 1 = full contrast; screens seen by webcams are more like 0.5-0.7 */
  contrast?: number;
  offsetX?: number; // fraction of width
  offsetY?: number;
  seed?: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function renderFrame(q: QrMatrix, o: SimOptions) {
  const { width: W, height: H } = o;
  const total = q.size + 8;
  const px = (o.fill * Math.min(W, H)) / total; // pixels per module
  const ang = ((o.angleDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const cx = W / 2 + (o.offsetX ?? 0) * W;
  const cy = H / 2 + (o.offsetY ?? 0) * H;
  const SS = 3;
  const gray = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS - cx;
          const fy = y + (sy + 0.5) / SS - cy;
          // inverse rotate into QR space
          const u = (fx * cos + fy * sin) / px + total / 2;
          const v = (-fx * sin + fy * cos) / px + total / 2;
          let val = 70; // room/bezel
          if (u >= 0 && u < total && v >= 0 && v < total) {
            const c = Math.floor(u) - 4;
            const r = Math.floor(v) - 4;
            val = c >= 0 && r >= 0 && c < q.size && r < q.size && q.dark(r, c) ? 25 : 235;
          }
          acc += val;
        }
      }
      gray[y * W + x] = acc / (SS * SS);
    }
  }
  let g = gray;
  const br = Math.round(o.blur ?? 0);
  if (br > 0) {
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let k = -br; k <= br; k++) {
          const xx = Math.min(W - 1, Math.max(0, x + k));
          s += g[y * W + xx];
          n++;
        }
        tmp[y * W + x] = s / n;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let k = -br; k <= br; k++) {
          const yy = Math.min(H - 1, Math.max(0, y + k));
          s += tmp[yy * W + x];
          n++;
        }
        out[y * W + x] = s / n;
      }
    g = out;
  }
  const rand = rng(o.seed ?? 1);
  const contrast = o.contrast ?? 1;
  const noise = o.noise ?? 0;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const n = noise ? (rand() + rand() + rand() - 1.5) * 2 * noise : 0;
    const v = 128 + (g[i] - 128) * contrast + n;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H, pxPerModule: px };
}

/** 2x box downscale of a grayscale-in-RGBA frame (same thing drawImage does, roughly). */
export function downscale2(f: { data: Uint8ClampedArray; width: number; height: number }) {
  const w = f.width >> 1;
  const h = f.height >> 1;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) s += f.data[((2 * y + dy) * f.width + 2 * x + dx) * 4];
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = s / 4;
      d[i + 3] = 255;
    }
  return { data: d, width: w, height: h };
}
