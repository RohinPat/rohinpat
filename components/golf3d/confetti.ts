// Paper falling over the hole card after a birdie or better: drawn on the
// overlay canvas, a few hundred flakes at most, gone in a few seconds.

type Flake = { x: number; y: number; vx: number; vy: number; r: number; spin: number; a: number; w: number; h: number; color: string };

const COLORS = ["#f2c14e", "#f2ead7", "#7fd1a8", "#ff8a7a", "#8ec5ff"];

export type Confetti = { pop: (w: number, h: number, big: boolean) => void; draw: (ctx: CanvasRenderingContext2D, dt: number) => void; clear: () => void };

export function createConfetti(): Confetti {
  let flakes: Flake[] = [];
  return {
    pop(w, h, big) {
      const n = big ? 260 : 150;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const x = side > 0 ? w * 0.08 : w * 0.92;
        const a = -Math.PI / 2 + side * (0.25 + Math.random() * 0.5);
        const v = (0.55 + Math.random() * 0.6) * Math.max(h, 500) * 1.25;
        flakes.push({
          x,
          y: h * 0.9,
          vx: Math.cos(a) * v * 0.6,
          vy: Math.sin(a) * v,
          r: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 14,
          a: 1,
          w: 5 + Math.random() * 5,
          h: 3 + Math.random() * 4,
          color: COLORS[i % COLORS.length],
        });
      }
    },
    draw(ctx, dt) {
      if (!flakes.length) return;
      for (const f of flakes) {
        f.vy += 900 * dt;
        f.vx *= Math.exp(-1.6 * dt);
        f.vy *= Math.exp(-1.2 * dt);
        f.x += f.vx * dt + Math.sin(f.r * 2) * 0.6;
        f.y += f.vy * dt;
        f.r += f.spin * dt;
        if (f.vy > 0) f.a -= dt * 0.35;
        ctx.save();
        ctx.globalAlpha = Math.max(0, f.a);
        ctx.translate(f.x, f.y);
        ctx.rotate(f.r);
        ctx.scale(1, Math.cos(f.r * 1.7));
        ctx.fillStyle = f.color;
        ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
        ctx.restore();
      }
      flakes = flakes.filter((f) => f.a > 0 && f.y < ctx.canvas.height * 2);
    },
    clear() {
      flakes = [];
    },
  };
}
