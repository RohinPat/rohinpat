"use client";

import { useEffect, useRef } from "react";
import { getBostonHourFraction } from "@/lib/clock";

// Koi pond hero. Click anywhere → ripple + food (fish chase it); one accent koi
// follows the cursor; the rest school via boids. Petals drift on the surface.
// Pond gradient tints with the Boston hour. Canvas 2D, no deps. Pauses
// off-screen / tab-hidden. Honors prefers-reduced-motion.

type Fish = {
  x: number;
  y: number;
  angle: number;          // heading, radians
  speed: number;          // px/s
  maxSpeed: number;
  length: number;
  width: number;
  color: string;
  phase: number;          // wiggle phase offset
  wanderAngle: number;
  isFollower: boolean;
  flee: { x: number; y: number; t: number } | null;
};

type Ripple = {
  x: number;
  y: number;
  born: number;           // performance.now() ms
  maxAge: number;         // ms
  speed: number;          // px/s expansion
};

type Food = {
  x: number;
  y: number;
  born: number;
  maxAge: number;         // ms
};

type Pad = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
  jitter: number;         // small offset accumulator for ripple bobbing
};

type Petal = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotV: number;
  size: number;
  hue: number;            // small per-petal pink hue jitter
  bob: number;            // current displacement from ripple wavefronts
};

const ACCENT = "#A50044";

export default function HeroPond() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    let width = 0;
    let height = 0;

    const applySize = (w: number, h: number) => {
      width = w;
      height = h;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // ---- Seed ----
    const rng = mulberry32(0xC0FFEE);

    const fish: Fish[] = [];
    const palette = [
      { color: ACCENT,    length: 70, width: 13, isFollower: true,  maxSpeed: 120 },
      { color: "#E8E1D6", length: 64, width: 12, isFollower: false, maxSpeed: 65  },
      { color: "#3a3a3a", length: 58, width: 11, isFollower: false, maxSpeed: 55  },
      { color: "#D8CFC0", length: 60, width: 11, isFollower: false, maxSpeed: 70  },
      { color: "#1f1f1f", length: 54, width: 10, isFollower: false, maxSpeed: 60  },
    ];
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      // Radially fan around the impact center so they burst outward symmetrically.
      const a = (i / palette.length) * Math.PI * 2 + Math.PI / 7;
      fish.push({
        x: 0,
        y: 0,
        angle: a,
        speed: 0,
        maxSpeed: p.maxSpeed,
        length: p.length,
        width: p.width,
        color: p.color,
        phase: rng() * Math.PI * 2,
        wanderAngle: a,
        isFollower: p.isFollower,
        flee: null,
      });
    }

    const pads: Pad[] = [];
    for (let i = 0; i < 3; i++) {
      pads.push({
        x: 0, y: 0, rx: 38 + rng() * 16, ry: 28 + rng() * 12,
        rot: rng() * Math.PI * 2, jitter: 0,
      });
    }

    const petals: Petal[] = [];
    const PETAL_COUNT = 14;
    for (let i = 0; i < PETAL_COUNT; i++) {
      petals.push({
        x: rng(), y: rng(),               // 0..1 initially; rescaled in seedFromRect
        vx: 0, vy: 0,
        rot: rng() * Math.PI * 2,
        rotV: (rng() - 0.5) * 0.6,        // rad/s
        size: 5 + rng() * 4,
        hue: rng() * 8 - 4,               // ±4° hue shift around sakura pink
        bob: 0,
      });
    }
    const seedPetals = () => {
      for (const p of petals) {
        // If x/y are still normalized (0..1), scale to viewport; otherwise leave
        // them where the simulation has them.
        if (p.x <= 1.0 && p.y <= 1.0) {
          p.x = p.x * width;
          p.y = p.y * height;
        }
      }
    };

    // Food the user dropped by clicking. Fish steer toward the nearest piece;
    // a piece is consumed when a fish touches it or after its lifetime.
    const food: Food[] = [];
    const layoutPads = () => {
      pads[0].x = width * 0.18; pads[0].y = height * 0.74;
      pads[1].x = width * 0.82; pads[1].y = height * 0.28;
      pads[2].x = width * 0.62; pads[2].y = height * 0.82;
    };

    // ---- Day/night tint ----
    // Recomputed periodically; used by draw() each frame. Two color stops for
    // the pond gradient (center, edge) — all in the same dark family, just a
    // gentle hue shift so repeat visits feel different.
    let tintInner = "rgba(20, 26, 30, 1)";
    let tintOuter = "rgba(10, 10, 10, 1)";
    const computeTint = () => {
      const h = getBostonHourFraction();
      // Inner/outer pairs at key hours (h in 0..24). Lerp between them.
      // Each entry: [hour, innerR,innerG,innerB, outerR,outerG,outerB].
      const keys: number[][] = [
        [0,   12, 16, 26,  6,  6, 12],   // deep night
        [5,   16, 18, 26,  8,  8, 12],   // late night
        [7,   30, 22, 24, 14, 10, 10],   // dawn warm
        [10,  22, 30, 32, 10, 12, 12],   // day cool
        [16,  24, 28, 30, 12, 12, 12],   // late day
        [19,  32, 22, 18, 14, 10,  8],   // dusk amber
        [22,  16, 16, 24,  8,  8, 14],   // evening
        [24,  12, 16, 26,  6,  6, 12],   // wraps to night
      ];
      let a = keys[0];
      let b = keys[keys.length - 1];
      for (let i = 0; i < keys.length - 1; i++) {
        if (h >= keys[i][0] && h <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
      }
      const t = (h - a[0]) / Math.max(0.0001, b[0] - a[0]);
      const lerp = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
      tintInner = `rgba(${lerp(1)}, ${lerp(2)}, ${lerp(3)}, 1)`;
      tintOuter = `rgba(${lerp(4)}, ${lerp(5)}, ${lerp(6)}, 1)`;
    };
    computeTint();
    const tintInterval = window.setInterval(computeTint, 60 * 1000);

    // Initial size from getBoundingClientRect, then keep up to date via
    // ResizeObserver — clientWidth/Height can read 0 here in some layouts.
    const seedFromRect = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width || canvas.parentElement?.clientWidth || window.innerWidth;
      const h = rect.height || canvas.parentElement?.clientHeight || window.innerHeight * 0.82;
      applySize(w, h);
      layoutPads();
      // Cluster fish at the impact point so the intro splash spawns them.
      const cx = width * 0.5;
      const cy = height * 0.55;
      for (const f of fish) {
        f.x = cx;
        f.y = cy;
      }
      seedPetals();
    };
    seedFromRect();

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: w, height: h } = entry.contentRect;
      if (w <= 0 || h <= 0) return;
      applySize(w, h);
      layoutPads();
      if (reduced) draw(performance.now(), T_INTRO_END + 1000);
    });
    ro.observe(canvas);

    const ripples: Ripple[] = [];

    // ---- Input ----
    let cursorX = width * 0.5;
    let cursorY = height * 0.5;
    let cursorActive = false;

    const localCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const isInside = (x: number, y: number) =>
      x >= 0 && x <= width && y >= 0 && y <= height;

    const onMove = (e: MouseEvent) => {
      const { x, y } = localCoords(e.clientX, e.clientY);
      if (!isInside(x, y)) { cursorActive = false; return; }
      cursorActive = true;
      cursorX = x;
      cursorY = y;
    };

    const pushRipple = (x: number, y: number, maxAge = 1800, speed = 220) => {
      ripples.push({ x, y, born: performance.now(), maxAge, speed });
    };

    // Random surface disturbance — scares the fish.
    const spawnAutoRipple = (x: number, y: number) => {
      pushRipple(x, y);
      for (const f of fish) {
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy);
        if (d < 180) f.flee = { x, y, t: 0.9 };
      }
    };

    // Intentional user click — drops food and makes a ripple. Fish pursue.
    const spawnUserClick = (x: number, y: number) => {
      pushRipple(x, y);
      food.push({ x, y, born: performance.now(), maxAge: 2200 });
    };

    const onPointerDown = (e: PointerEvent) => {
      const { x, y } = localCoords(e.clientX, e.clientY);
      if (!isInside(x, y)) return;
      spawnUserClick(x, y);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });

    // Auto-ripple every so often so the page isn't dead before any interaction.
    let autoRippleAt = performance.now() + 5000;

    // ---- Intro choreography ----
    // Drop falls from top, hits center, splash bursts fish outward. Times are
    // ms since the first frame. Hero text staggers to match (see Hero.tsx).
    const introStart = performance.now();
    const T_DROP_START = 300;
    const T_DROP_HIT = 1100;
    const T_FISH_FADE = 400;          // fish fade-in duration after hit
    const T_FLASH = 380;              // accent flash duration after hit
    const T_INTRO_END = T_DROP_HIT + T_FISH_FADE + 200;
    let impactDone = false;

    // ---- Visibility ----
    let visible = true;
    let docVisible = !document.hidden;
    const running = () => visible && docVisible && !reduced;

    const io = new IntersectionObserver(
      ([entry]) => {
        const was = visible;
        visible = entry.isIntersecting;
        if (!was && running()) {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const onVisChange = () => {
      docVisible = !document.hidden;
      if (running()) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisChange);

    // ---- Loop ----
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const elapsed = now - introStart;
      const introActive = elapsed < T_INTRO_END;

      // Trigger the splash impact exactly once.
      if (!impactDone && elapsed >= T_DROP_HIT) {
        impactDone = true;
        const cx = width * 0.5;
        const cy = height * 0.55;
        // Three concentric ripples, staggered, larger and longer than normal.
        ripples.push({ x: cx, y: cy, born: now,       maxAge: 2800, speed: 320 });
        ripples.push({ x: cx, y: cy, born: now + 70,  maxAge: 2300, speed: 270 });
        ripples.push({ x: cx, y: cy, born: now + 160, maxAge: 1900, speed: 220 });
        // All fish flee outward from impact — they emerge from the splash.
        for (const f of fish) {
          f.flee = { x: cx, y: cy, t: 1.6 };
          f.speed = f.maxSpeed * 0.7;
        }
      }

      // Auto-ripple cadence (gentle, far apart) — suppressed during intro.
      if (!introActive && now > autoRippleAt) {
        spawnAutoRipple(
          width * (0.2 + rng() * 0.6),
          height * (0.25 + rng() * 0.55),
        );
        autoRippleAt = now + 6000 + rng() * 5000;
      }

      // Expire old ripples.
      for (let i = ripples.length - 1; i >= 0; i--) {
        if (now - ripples[i].born > ripples[i].maxAge) ripples.splice(i, 1);
      }

      // Skip fish physics until impact (they sit clustered at center, hidden).
      if (elapsed < T_DROP_HIT) {
        draw(now, elapsed);
        if (running()) raf = requestAnimationFrame(frame);
        return;
      }

      // Expire food.
      for (let i = food.length - 1; i >= 0; i--) {
        if (now - food[i].born > food[i].maxAge) food.splice(i, 1);
      }

      // Update fish.
      for (const f of fish) {
        let targetX: number;
        let targetY: number;

        // 1. Find nearest food, if any. Food beats every other behavior except
        // the cursor-follower's loyalty to the cursor.
        let nearestFood: Food | null = null;
        let nearestFoodD = Infinity;
        for (const m of food) {
          const d = Math.hypot(m.x - f.x, m.y - f.y);
          if (d < nearestFoodD) { nearestFoodD = d; nearestFood = m; }
        }

        if (f.isFollower && cursorActive) {
          targetX = cursorX;
          targetY = cursorY;
        } else if (nearestFood) {
          targetX = nearestFood.x;
          targetY = nearestFood.y;
        } else {
          // Wander: angle drifts, target a bit ahead in that direction.
          f.wanderAngle += (rng() - 0.5) * 0.9 * dt;
          targetX = f.x + Math.cos(f.wanderAngle) * 220;
          targetY = f.y + Math.sin(f.wanderAngle) * 220;
        }

        // 2. Boids (only on non-follower wanderers, and only when not chasing
        // food). Alignment + cohesion + separation among the other non-follower
        // fish within a perception radius.
        if (!f.isFollower && !nearestFood) {
          let neighbors = 0;
          let aliX = 0, aliY = 0;
          let cohX = 0, cohY = 0;
          let sepX = 0, sepY = 0;
          for (const o of fish) {
            if (o === f || o.isFollower) continue;
            const dx = o.x - f.x;
            const dy = o.y - f.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 120 * 120 && d2 > 0.01) {
              neighbors++;
              aliX += Math.cos(o.angle);
              aliY += Math.sin(o.angle);
              cohX += o.x;
              cohY += o.y;
              if (d2 < 55 * 55) {
                const d = Math.sqrt(d2);
                sepX -= dx / d;
                sepY -= dy / d;
              }
            }
          }
          if (neighbors > 0) {
            aliX /= neighbors; aliY /= neighbors;
            cohX = cohX / neighbors - f.x;
            cohY = cohY / neighbors - f.y;
            // Add weighted boid forces to the target offset.
            targetX += aliX * 140 + cohX * 0.4 + sepX * 80;
            targetY += aliY * 140 + cohY * 0.4 + sepY * 80;
          }
        }

        // Edge avoidance.
        const margin = 80;
        if (f.x < margin)             targetX = Math.max(targetX, f.x + 220);
        if (f.x > width - margin)     targetX = Math.min(targetX, f.x - 220);
        if (f.y < margin)             targetY = Math.max(targetY, f.y + 220);
        if (f.y > height - margin)    targetY = Math.min(targetY, f.y - 220);

        // Flee from a scaring ripple (auto-ripples / intro impact only).
        if (f.flee) {
          f.flee.t -= dt;
          if (f.flee.t <= 0) {
            f.flee = null;
          } else {
            const dx = f.x - f.flee.x;
            const dy = f.y - f.flee.y;
            const d = Math.hypot(dx, dy) || 1;
            targetX += (dx / d) * 400 * f.flee.t;
            targetY += (dy / d) * 400 * f.flee.t;
          }
        }

        // Turn toward target with a rate cap.
        const desired = Math.atan2(targetY - f.y, targetX - f.x);
        let diff = desired - f.angle;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = (f.isFollower ? 3.2 : nearestFood ? 3.0 : 2.0) * dt;
        f.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

        // Speed control.
        let desiredSpeed: number;
        if (f.isFollower && cursorActive) {
          const dist = Math.hypot(cursorX - f.x, cursorY - f.y);
          desiredSpeed = Math.min(f.maxSpeed, 30 + dist * 1.2);
          if (dist < 60) desiredSpeed = 20;
        } else if (nearestFood) {
          desiredSpeed = Math.min(f.maxSpeed * 1.2, 60 + nearestFoodD * 1.5);
        } else if (f.flee) {
          desiredSpeed = f.maxSpeed * 1.4;
        } else {
          desiredSpeed = f.maxSpeed * 0.55;
        }
        f.speed += (desiredSpeed - f.speed) * 2.5 * dt;
        f.x += Math.cos(f.angle) * f.speed * dt;
        f.y += Math.sin(f.angle) * f.speed * dt;

        // Consume food on contact.
        if (nearestFood && nearestFoodD < 22) {
          const i = food.indexOf(nearestFood);
          if (i >= 0) food.splice(i, 1);
        }

        // Hard clamp inside pond.
        f.x = Math.max(20, Math.min(width - 20, f.x));
        f.y = Math.max(20, Math.min(height - 20, f.y));

        f.phase += dt * (4 + f.speed * 0.02);
      }

      // Update petals — drift on a gentle wind, rotate, bob over ripple fronts.
      const windX = 14 + Math.sin(now / 4000) * 6;
      const windY = 4 + Math.cos(now / 5200) * 3;
      for (const p of petals) {
        p.vx += (windX - p.vx) * 0.6 * dt;
        p.vy += (windY - p.vy) * 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.rotV * dt;

        // Bob from ripple fronts.
        let bob = 0;
        for (const r of ripples) {
          const rr = ((now - r.born) / 1000) * r.speed;
          const d = Math.hypot(p.x - r.x, p.y - r.y);
          const front = Math.abs(d - rr);
          if (front < 28) {
            const fade = 1 - (now - r.born) / r.maxAge;
            bob += Math.cos((front / 28) * Math.PI) * 4 * fade;
          }
        }
        p.bob += (bob - p.bob) * 6 * dt;

        // Wrap horizontally; wrap vertically with a fresh start at top.
        if (p.x > width + 20) { p.x = -20; p.y = rng() * height; }
        if (p.x < -30)        { p.x = width + 20; p.y = rng() * height; }
        if (p.y > height + 20){ p.y = -10; p.x = rng() * width; }
        if (p.y < -30)        { p.y = height + 10; p.x = rng() * width; }
      }

      // Update pads.
      for (const p of pads) {
        let bob = 0;
        for (const r of ripples) {
          const rr = ((now - r.born) / 1000) * r.speed;
          const d = Math.hypot(p.x - r.x, p.y - r.y);
          const front = Math.abs(d - rr);
          if (front < 30) {
            const fade = 1 - (now - r.born) / r.maxAge;
            bob += Math.cos((front / 30) * Math.PI) * 3 * fade;
          }
        }
        p.jitter += (bob - p.jitter) * 4 * dt;
      }

      draw(now, elapsed);

      if (running()) raf = requestAnimationFrame(frame);
    };

    const draw = (now: number, elapsed: number) => {
      ctx.clearRect(0, 0, width, height);

      // Background tint — gradient stops shift with the Boston hour.
      const g = ctx.createRadialGradient(
        width * 0.5, height * 0.55, 0,
        width * 0.5, height * 0.55, Math.max(width, height) * 0.65,
      );
      g.addColorStop(0, tintInner);
      g.addColorStop(1, tintOuter);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      // Lily pads (below fish).
      for (const p of pads) drawPad(ctx, p);

      // Food markers — subtle dots, fade out as they age.
      for (const m of food) {
        const age = (now - m.born) / m.maxAge;
        if (age >= 1) continue;
        const alpha = (1 - age) * 0.55;
        ctx.fillStyle = `rgba(220, 180, 140, ${alpha})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Impact flash — quick accent radial glow at the drop site.
      if (impactDone && elapsed < T_DROP_HIT + T_FLASH) {
        const ft = (elapsed - T_DROP_HIT) / T_FLASH;
        const a = (1 - ft) * 0.55;
        const cx = width * 0.5;
        const cy = height * 0.55;
        const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 220);
        fg.addColorStop(0, `rgba(165, 0, 68, ${a})`);
        fg.addColorStop(1, `rgba(165, 0, 68, 0)`);
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, width, height);
      }

      // Fish (only after impact, with a quick fade-in).
      if (elapsed >= T_DROP_HIT) {
        const fishAlpha = Math.min(1, (elapsed - T_DROP_HIT) / T_FISH_FADE);
        ctx.save();
        ctx.globalAlpha = fishAlpha;
        for (const f of fish) drawFish(ctx, f);
        ctx.restore();
      }

      // Falling droplet (before impact).
      if (elapsed >= T_DROP_START && elapsed < T_DROP_HIT) {
        drawDroplet(ctx, width, height, elapsed);
      }

      // Ripples (above fish — surface effect).
      for (const r of ripples) drawRipple(ctx, r, now);

      // Petals ride on top of everything (they're on the water surface).
      for (const p of petals) drawPetal(ctx, p);
    };

    if (reduced) {
      // For reduced motion: skip the intro, fish at rest in pleasant positions.
      const cx = width * 0.5;
      const cy = height * 0.55;
      for (let i = 0; i < fish.length; i++) {
        const a = (i / fish.length) * Math.PI * 2 + Math.PI / 7;
        fish[i].x = cx + Math.cos(a) * Math.min(width, height) * 0.22;
        fish[i].y = cy + Math.sin(a) * Math.min(width, height) * 0.18;
      }
      impactDone = true;
      draw(performance.now(), T_INTRO_END + 1000);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisChange);
      io.disconnect();
      ro.disconnect();
      window.clearInterval(tintInterval);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

// ---------- Draw helpers ----------

function drawFish(ctx: CanvasRenderingContext2D, f: Fish) {
  const SEG = 7;
  const spine: { x: number; y: number }[] = [];

  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;                            // 0 at head, 1 at tail
    const along = (0.5 - t) * f.length;
    const wiggleAmp = t * t * 9;                  // bigger sway near tail
    const offY = Math.sin(f.phase - t * 3.4) * wiggleAmp;

    const cosA = Math.cos(f.angle);
    const sinA = Math.sin(f.angle);
    spine.push({
      x: f.x + along * cosA - offY * sinA,
      y: f.y + along * sinA + offY * cosA,
    });
  }

  // Body outline as parallel curves perpendicular to spine.
  const top: { x: number; y: number }[] = [];
  const bot: { x: number; y: number }[] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    let w: number;
    if (t < 0.18) w = Math.sin((t / 0.18) * (Math.PI / 2)) * f.width;
    else          w = Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.18) / 0.82, 2))) * f.width;

    let px: number, py: number;
    if (i === 0)             { px = -Math.sin(f.angle); py = Math.cos(f.angle); }
    else if (i === SEG)      {
      const dx = spine[i].x - spine[i - 1].x;
      const dy = spine[i].y - spine[i - 1].y;
      const len = Math.hypot(dx, dy) || 1;
      px = -dy / len; py = dx / len;
    } else {
      const dx = spine[i + 1].x - spine[i - 1].x;
      const dy = spine[i + 1].y - spine[i - 1].y;
      const len = Math.hypot(dx, dy) || 1;
      px = -dy / len; py = dx / len;
    }
    top.push({ x: spine[i].x + px * w, y: spine[i].y + py * w });
    bot.push({ x: spine[i].x - px * w, y: spine[i].y - py * w });
  }

  // Soft shadow beneath fish.
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.filter = "blur(6px)";
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + 4, f.length * 0.45, f.width * 0.7, f.angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tail fan first (so body overlaps the attachment).
  const tail = spine[SEG];
  const before = spine[SEG - 1];
  const tailAngle = Math.atan2(tail.y - before.y, tail.x - before.x);
  ctx.save();
  ctx.translate(tail.x, tail.y);
  ctx.rotate(tailAngle);
  ctx.fillStyle = f.color;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(f.length * 0.22, -f.width * 0.9, f.length * 0.32, -f.width * 0.5);
  ctx.quadraticCurveTo(f.length * 0.20, 0, f.length * 0.32, f.width * 0.5);
  ctx.quadraticCurveTo(f.length * 0.22, f.width * 0.9, 0, 0);
  ctx.fill();
  ctx.restore();

  // Body.
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.moveTo(top[0].x, top[0].y);
  for (let i = 1; i <= SEG; i++) ctx.lineTo(top[i].x, top[i].y);
  for (let i = SEG; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
  ctx.closePath();
  ctx.fill();

  // Dorsal sheen — a faint highlight on one side, gives roundness.
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(top[0].x, top[0].y);
  for (let i = 1; i <= SEG; i++) ctx.lineTo(top[i].x, top[i].y);
  // back along an inset curve
  for (let i = SEG; i >= 0; i--) {
    const t = i / SEG;
    const inset = 0.45;
    const x = top[i].x * (1 - inset) + spine[i].x * inset;
    const y = top[i].y * (1 - inset) + spine[i].y * inset;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Eye — a tiny dark dot, only on lighter fish (dark ones don't need it).
  if (f.color === "#E8E1D6" || f.color === "#D8CFC0" || f.color === ACCENT) {
    const eyeT = 0.12;
    const eyeAlong = (0.5 - eyeT) * f.length;
    const eyeSide = f.width * 0.4;
    const cosA = Math.cos(f.angle);
    const sinA = Math.sin(f.angle);
    const ex = f.x + eyeAlong * cosA - eyeSide * sinA;
    const ey = f.y + eyeAlong * sinA + eyeSide * cosA;
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.beginPath();
    ctx.arc(ex, ey, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRipple(ctx: CanvasRenderingContext2D, r: Ripple, now: number) {
  const age = (now - r.born) / 1000;
  const life = (now - r.born) / r.maxAge;
  if (life >= 1) return;
  const fade = 1 - life;
  const radius = age * r.speed;

  ctx.save();
  for (let i = 0; i < 3; i++) {
    const rr = radius - i * 14;
    if (rr <= 0) continue;
    const a = fade * 0.22 * (1 - i / 3);
    ctx.strokeStyle = `rgba(235, 235, 235, ${a})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  // A subtle accent inner glint at the center fades fastest.
  if (life < 0.25) {
    ctx.fillStyle = `rgba(165, 0, 68, ${(1 - life * 4) * 0.18})`;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDroplet(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsed: number,
) {
  // Match the constants in HeroPond — duplicated as args from caller's side.
  const T_DROP_START = 300;
  const T_DROP_HIT = 1100;
  const t = (elapsed - T_DROP_START) / (T_DROP_HIT - T_DROP_START);
  const eased = t * t; // accelerate downward — gravity

  const cx = width * 0.5;
  const startY = -28;
  const endY = height * 0.55;
  const y = startY + (endY - startY) * eased;

  // Teardrop stretches as it falls.
  const r = 4.5;
  const stretch = 1 + t * 1.8;

  ctx.save();
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(cx, y - r * stretch);
  ctx.bezierCurveTo(cx + r, y - r * 0.3, cx + r, y + r * 0.3, cx, y + r);
  ctx.bezierCurveTo(cx - r, y + r * 0.3, cx - r, y - r * 0.3, cx, y - r * stretch);
  ctx.closePath();
  ctx.fill();

  // Tiny soft glow underneath so it reads against the dark pond.
  const glow = ctx.createRadialGradient(cx, y, 0, cx, y, r * 4);
  glow.addColorStop(0, "rgba(165, 0, 68, 0.35)");
  glow.addColorStop(1, "rgba(165, 0, 68, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r * 4, y - r * 4, r * 8, r * 8);
  ctx.restore();
}

function drawPetal(ctx: CanvasRenderingContext2D, p: Petal) {
  ctx.save();
  ctx.translate(p.x, p.y + p.bob);
  ctx.rotate(p.rot);
  // Sakura-pink with a small per-petal hue jitter.
  const r = 245;
  const g = Math.round(195 + p.hue * 1.2);
  const b = Math.round(215 + p.hue * 0.8);

  // Petal shape — almond with a notch at the tip. Drawn at size p.size.
  const s = p.size;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.7, -s * 0.5, s * 0.7, s * 0.3, 0, s * 0.9);
  ctx.bezierCurveTo(-s * 0.7, s * 0.3, -s * 0.7, -s * 0.5, 0, -s);
  ctx.closePath();
  ctx.fill();

  // Faint vein / inner shading.
  ctx.strokeStyle = `rgba(${r - 40}, ${g - 50}, ${b - 40}, 0.4)`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.8);
  ctx.quadraticCurveTo(s * 0.15, 0, 0, s * 0.6);
  ctx.stroke();
  ctx.restore();
}

function drawPad(ctx: CanvasRenderingContext2D, p: Pad) {
  ctx.save();
  ctx.translate(p.x, p.y + p.jitter);
  ctx.rotate(p.rot);
  // Body
  ctx.fillStyle = "rgba(24, 38, 30, 0.85)";
  ctx.beginPath();
  ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Notch (lily pad split)
  ctx.fillStyle = "rgba(10, 10, 10, 1)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(p.rx * 1.05, -p.ry * 0.05);
  ctx.lineTo(p.rx * 1.05, p.ry * 0.05);
  ctx.closePath();
  ctx.fill();
  // Soft rim highlight
  ctx.strokeStyle = "rgba(60, 80, 65, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Tiny deterministic PRNG for stable seeding.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
