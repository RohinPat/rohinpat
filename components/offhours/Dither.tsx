"use client";

import { useRef } from "react";
import { useCanvas } from "./useCanvas";

// 1-bit ordered dithering, like an old handheld. A light source follows the
// pointer (or drifts on its own) over a slow plasma; each pixel is either
// ink or signal, decided by an 8×8 Bayer matrix.

const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

const PX = 4; // size of one "pixel" in CSS px

export default function Dither() {
  const buf = useRef<{ c: HTMLCanvasElement; img: ImageData } | null>(null);
  const light = useRef({ x: 0.5, y: 0.5 });

  const ref = useCanvas(({ ctx, w, h, t, p }) => {
    const cols = Math.ceil(w / PX);
    const rows = Math.ceil(h / PX);
    if (!buf.current || buf.current.img.width !== cols || buf.current.img.height !== rows) {
      const c = document.createElement("canvas");
      c.width = cols;
      c.height = rows;
      buf.current = { c, img: new ImageData(cols, rows) };
    }
    const { c, img } = buf.current;

    // light eases toward the pointer, or wanders when the pointer is away
    const tx = p.inside ? p.x / w : 0.5 + Math.cos(t * 0.45) * 0.3;
    const ty = p.inside ? p.y / h : 0.5 + Math.sin(t * 0.7) * 0.28;
    light.current.x += (tx - light.current.x) * 0.12;
    light.current.y += (ty - light.current.y) * 0.12;
    const lx = light.current.x * cols;
    const ly = light.current.y * rows;
    const reach = Math.max(cols, rows) * 0.42;

    const d = img.data;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dist = Math.hypot(x - lx, (y - ly) * 1.1) / reach;
        const plasma =
          Math.sin(x * 0.09 + t * 0.8) * 0.5 + Math.sin(y * 0.12 - t * 0.6) * 0.5 + Math.sin((x + y) * 0.05 + t);
        const lum = Math.max(0, 1 - dist) ** 1.6 + plasma * 0.07;
        const on = lum > BAYER[(y & 7) * 8 + (x & 7)];
        const i = (y * cols + x) * 4;
        d[i] = on ? 255 : 12;
        d[i + 1] = on ? 74 : 12;
        d[i + 2] = on ? 28 : 11;
        d[i + 3] = 255;
      }
    }
    c.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0, cols * PX, rows * PX);
  });

  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 w-full h-full touch-pan-y [image-rendering:pixelated]" />;
}
