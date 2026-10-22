"use client";

import { useEffect, useRef } from "react";

// On the home screen the mouse pointer is a symbiote: black over light
// backgrounds, white over dark ones, and when the background flips, the other
// one floods across it from the leading edge and takes over. Near an app,
// widget or button it throws tendrils to the closest; over one, it floods the
// block in the opposite colour of the block (a CSS layer under the icon, see
// .venom-on in globals.css); leaving pulls a sticky strand that snaps; a click
// splashes droplets that get reeled back in; left alone it puts out feelers.
//
// Drawing: circles on two small canvases that follow the blob, one per
// colour, each merged into liquid by an SVG filter: blur and a hard alpha
// threshold (the goo), a drifting noise displacement (the crawl), then diffuse
// and specular lighting off the goo's own alpha (the wet, solid look).
// Not on touch-first screens, and never with prefers-reduced-motion.

const SIZE = 460; // each canvas, CSS px, centred on the blob
const REACH = 170; // how far a tendril will stretch
const SNAP = 110; // how far a sticky strand stretches before it snaps
const TARGETS = "[data-tile], [data-venom]";
const FILTER_K = "url(#venom-black) drop-shadow(0 3px 4px rgba(0,0,0,0.35))";
const FILTER_W = "url(#venom-white) drop-shadow(0 3px 5px rgba(0,0,0,0.55))";

type Pt = { x: number; y: number };
type Drop = Pt & { vx: number; vy: number; r: number; age: number; life: number; home: boolean };
type Feeler = { a: number; len: number; age: number; life: number };
type Strand = Pt & { age: number };
type Wipe = { to: 0 | 1; t: number; x: number; y: number };

const lum = (c: string) => {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  if (a < 0.5) return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** 1 when what's under (x, y) is dark, so the white symbiote belongs there */
function toneAt(x: number, y: number, skip: Element[]): 0 | 1 {
  for (const el of document.elementsFromPoint(x, y)) {
    if (skip.includes(el)) continue;
    const t = (el as HTMLElement).dataset?.tone;
    if (t) return t === "dark" ? 1 : 0;
    const l = lum(getComputedStyle(el).backgroundColor);
    if (l !== null) return l < 0.45 ? 1 : 0;
  }
  return 0;
}

export default function VenomCursor({ root }: { root: React.RefObject<HTMLElement> }) {
  const black = useRef<HTMLCanvasElement>(null);
  const white = useRef<HTMLCanvasElement>(null);
  const drift = useRef<SVGFEOffsetElement>(null);
  const driftW = useRef<SVGFEOffsetElement>(null);

  useEffect(() => {
    const host = root.current;
    const cvK = black.current;
    const cvW = white.current;
    const kx = cvK?.getContext("2d");
    const wx = cvW?.getContext("2d");
    if (!host || !cvK || !cvW || !kx || !wx) return;
    // touch-first screens keep their taps; mouse-first ones get the symbiote
    if (matchMedia("(pointer: coarse)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // 1×: the goo is blurred and lit anyway, and the lighting filters run on
    // the CPU, so Retina pixels would cost 4× for nothing you'd see
    const dpr = 1;
    for (const c of [cvK, cvW]) c.width = c.height = SIZE * dpr;

    const p = { x: -999, y: -999, in: false, moved: 0 };
    const head = { x: -999, y: -999, vx: 0, vy: 0 };
    const trail: Pt[] = [0, 1, 2, 3].map(() => ({ x: -999, y: -999 }));
    const drops: Drop[] = [];
    const feelers: Feeler[] = [];
    const strands: Strand[] = [];
    const reach = new Map<Element, number>();
    let tone: 0 | 1 = 0;
    let wipe: Wipe | null = null;
    let over: HTMLElement | null = null;
    let shown = 0;
    let frameNo = 0;
    let raf = 0;
    let last = performance.now();

    const local = (el: HTMLElement, x: number, y: number) => {
      const r = el.getBoundingClientRect();
      const s = r.width / (el.offsetWidth || r.width) || 1; // tiles sit inside a scaled phone
      return { x: (x - r.left) / s, y: (y - r.top) / s, w: el.offsetWidth, h: el.offsetHeight };
    };

    // flood a block from where the blob came in, in the block's opposite colour
    const enter = (el: HTMLElement) => {
      const l = local(el, p.x, p.y);
      const own = lum(getComputedStyle(el).backgroundColor);
      el.classList.toggle("venom-white", own !== null ? own < 0.45 : tone === 1);
      el.style.setProperty("--vx", `${l.x}px`);
      el.style.setProperty("--vy", `${l.y}px`);
      el.style.setProperty("--vr", "0px");
      if (getComputedStyle(el).position === "static") el.classList.add("venom-rel");
      el.classList.add("venom-on");
      requestAnimationFrame(() => el.style.setProperty("--vr", `${Math.hypot(l.w, l.h) * 1.05}px`));
    };
    // drain toward where it left, and leave a sticky strand on the edge
    const leave = (el: HTMLElement) => {
      const l = local(el, p.x, p.y);
      el.style.setProperty("--vx", `${l.x}px`);
      el.style.setProperty("--vy", `${l.y}px`);
      el.style.setProperty("--vr", "0px");
      const r = el.getBoundingClientRect();
      strands.push({ x: Math.max(r.left, Math.min(p.x, r.right)), y: Math.max(r.top, Math.min(p.y, r.bottom)), age: 0 });
      window.setTimeout(() => {
        if (over !== el) el.classList.remove("venom-on", "venom-rel", "venom-white");
      }, 380);
    };

    const blocked = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      p.x = e.clientX;
      p.y = e.clientY;
      p.moved = 0;
      const t = e.target as Element | null;
      p.in = !!t && host.contains(t) && !blocked();
      host.classList.toggle("venom-cursorless", p.in);
      if (head.x < -900) {
        Object.assign(head, { x: p.x, y: p.y });
        trail.forEach((d) => Object.assign(d, { x: p.x, y: p.y }));
        tone = toneAt(p.x, p.y, [cvK, cvW]);
      }
      run();
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) {
        p.in = false;
        host.classList.remove("venom-cursorless");
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!p.in || e.pointerType === "touch") return;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + Math.random() * 0.4;
        const v = 240 + Math.random() * 300;
        drops.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 70, r: 4 + Math.random() * 7, age: 0, life: 0.8, home: true });
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      raf = 0;
      frameNo++;
      const live = p.in || shown > 0.01 || drops.length > 0;
      if (!live) {
        cvK.style.opacity = cvW.style.opacity = "0";
        return;
      }
      shown += ((p.in ? 1 : 0) - shown) * (1 - Math.exp(-dt * 14));
      p.moved += dt;
      // while the Duo swings open, no layout reads (they'd force the browser
      // to re-lay out mid-animation) and the flat filter: just the blob
      const flat = "swing" in document.documentElement.dataset;

      // which symbiote belongs here; a change floods in from the leading edge
      if (p.in && !flat && frameNo % 3 === 0) {
        const want = toneAt(p.x, p.y, [cvK, cvW]);
        const target = wipe ? wipe.to : tone;
        if (want !== target) wipe = { to: want, t: 0, x: p.x, y: p.y };
      }
      if (wipe) {
        wipe.t = Math.min(1, wipe.t + dt / 0.65);
        if (wipe.t >= 1) {
          tone = wipe.to;
          wipe = null;
        }
      }

      // body: a springy head, lagging droplets, stretch with speed
      const k = 1 - Math.exp(-dt * 24);
      const px = head.x;
      const py = head.y;
      head.x += (p.x - head.x) * k;
      head.y += (p.y - head.y) * k;
      head.vx += ((head.x - px) / Math.max(dt, 1e-3) - head.vx) * 0.3;
      head.vy += ((head.y - py) / Math.max(dt, 1e-3) - head.vy) * 0.3;
      trail.forEach((d, i) => {
        const lead = i ? trail[i - 1] : head;
        const kk = 1 - Math.exp(-dt * (17 - i * 3.2));
        d.x += (lead.x - d.x) * kk;
        d.y += (lead.y - d.y) * kk;
      });

      // targets: the one under the pointer, and the two closest
      let inside: HTMLElement | null = null;
      const near: { el: Element; d: number; x: number; y: number }[] = [];
      if (p.in && !flat) {
        host.querySelectorAll<HTMLElement>(TARGETS).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
          const cx = Math.max(r.left, Math.min(p.x, r.right));
          const cy = Math.max(r.top, Math.min(p.y, r.bottom));
          const d = Math.hypot(p.x - cx, p.y - cy);
          if (d === 0) inside = el;
          else if (d < REACH) near.push({ el, d, x: cx, y: cy });
        });
      }
      if (!flat && inside !== over) {
        if (over) leave(over);
        if (inside) enter(inside);
        over = inside;
      }
      near.sort((a, b) => a.d - b.d);
      const grab = inside ? [] : near.slice(0, 2);
      for (const el of Array.from(reach.keys())) if (!grab.some((g) => g.el === el)) reach.delete(el);
      for (const g of grab) reach.set(g.el, Math.min(1, (reach.get(g.el) ?? 0) + dt * 6));

      // idle: feelers go out and come back
      if (p.moved > 0.7 && !inside && feelers.length < 2 && Math.random() < dt * 1.6) {
        feelers.push({ a: Math.random() * Math.PI * 2, len: 22 + Math.random() * 26, age: 0, life: 0.9 + Math.random() * 0.6 });
      }

      // the scene, drawn once per canvas with complementary clips
      const ox = head.x - SIZE / 2;
      const oy = head.y - SIZE / 2;
      const draw = (ctx: CanvasRenderingContext2D, mine: 0 | 1) => {
        ctx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
        ctx.clearRect(ox, oy, SIZE, SIZE);
        const solo = !wipe && tone === mine;
        if (!wipe && !solo) return false;
        ctx.save();
        if (wipe) {
          // a wobbly front spreading from where the background changed
          // grows from nothing at the leading edge until it has swallowed the
          // body and whatever's reaching out from it
          const R = (1 - (1 - wipe.t) ** 2) * (Math.hypot(head.x - wipe.x, head.y - wipe.y) + 60) * 1.6;
          ctx.beginPath();
          for (let i = 0; i <= 40; i++) {
            const a = (i / 40) * Math.PI * 2;
            const rr = R * (1 + 0.1 * Math.sin(a * 5 + now / 90) + 0.06 * Math.sin(a * 9 - now / 70));
            const x = wipe.x + Math.cos(a) * rr;
            const y = wipe.y + Math.sin(a) * rr;
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          ctx.closePath();
          if (wipe.to !== mine) ctx.rect(ox + SIZE, oy, -SIZE, SIZE); // the outside, for the old colour
          ctx.clip("evenodd");
        }
        ctx.fillStyle = "#000";
        const dot = (x: number, y: number, r: number) => {
          if (r <= 0.3) return;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        };

        // body, stretched along the motion and soaked down over a block
        const sink = inside ? 0.55 : 1;
        const sp = Math.min(1, Math.hypot(head.vx, head.vy) / 1400);
        const ux = head.vx / (Math.hypot(head.vx, head.vy) || 1);
        const uy = head.vy / (Math.hypot(head.vx, head.vy) || 1);
        const breathe = 1 + 0.05 * Math.sin(now / 260);
        dot(head.x, head.y, 16 * sink * breathe * (1 - 0.15 * sp));
        for (let i = 1; i <= 3; i++) dot(head.x - ux * i * 9 * sp, head.y - uy * i * 9 * sp, (14 - i * 2.5) * sink);
        dot(head.x + ux * 7 * sp, head.y + uy * 7 * sp, 11 * sink * sp);
        trail.forEach((d, i) => dot(d.x, d.y, (11 - i * 2.2) * sink));
        // a few lumps that slide around the surface
        for (let i = 0; i < 3; i++) {
          const a = now / (700 + i * 230) + i * 2.1;
          dot(head.x + Math.cos(a) * 11 * sink, head.y + Math.sin(a * 1.3) * 10 * sink, (5 + 1.5 * Math.sin(now / 300 + i)) * sink);
        }

        // tendrils: a travelling wave, thick at both ends, thin when far
        grab.forEach((g, gi) => {
          const s = (1 - g.d / REACH) * (gi ? 0.55 : 1);
          const rch = reach.get(g.el) ?? 0;
          const tx = head.x + (g.x - head.x) * rch;
          const ty = head.y + (g.y - head.y) * rch;
          const len = Math.hypot(tx - head.x, ty - head.y) || 1;
          const nx = -(ty - head.y) / len;
          const ny = (tx - head.x) / len;
          const n = Math.max(6, Math.round(len / 6));
          for (let i = 1; i <= n; i++) {
            const u = i / n;
            const wob = Math.sin(u * Math.PI) * (Math.sin(now / 120 - u * 9 + gi) * 6 * (1 - s) + Math.sin(now / 300 + u * 3) * 3);
            const r = (2.4 + 6.5 * s) * (0.5 + 0.5 * Math.abs(2 * u - 1));
            dot(head.x + (tx - head.x) * u + nx * wob, head.y + (ty - head.y) * u + ny * wob, r);
          }
          if (rch > 0.95) {
            dot(g.x, g.y, 5 + 6 * s);
            dot(g.x + nx * 6, g.y + ny * 6, 2.5 + 3 * s); // grip
            dot(g.x - nx * 6, g.y - ny * 6, 2.5 + 3 * s);
          }
        });

        // sticky strands from a block just left, thinning until they snap
        for (const st of strands) {
          const len = Math.hypot(head.x - st.x, head.y - st.y);
          const thin = Math.max(0, 1 - len / SNAP);
          const n = Math.max(5, Math.round(len / 6));
          for (let i = 0; i <= n; i++) {
            const u = i / n;
            const sag = Math.sin(u * Math.PI) * len * 0.12;
            dot(st.x + (head.x - st.x) * u, st.y + (head.y - st.y) * u + sag, (1.2 + 5 * thin) * (0.45 + 0.55 * Math.abs(2 * u - 1)));
          }
        }

        // idle feelers
        for (const f of feelers) {
          const e = Math.sin((f.age / f.life) * Math.PI);
          const n = 7;
          for (let i = 1; i <= n; i++) {
            const u = (i / n) * e;
            const bend = Math.sin(u * 4 + now / 200) * 4 * u;
            dot(head.x + Math.cos(f.a) * (14 + f.len * u) - Math.sin(f.a) * bend, head.y + Math.sin(f.a) * (14 + f.len * u) + Math.cos(f.a) * bend, 5.5 * (1 - (i / n) * 0.7));
          }
        }

        for (const d of drops) dot(d.x, d.y, d.r);
        ctx.restore();
        return true;
      };

      // physics for the loose bits
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt;
        if (d.home && d.age > 0.24) {
          const pull = 1 - Math.exp(-dt * 13);
          d.x += (head.x - d.x) * pull;
          d.y += (head.y - d.y) * pull;
          d.r *= 1 - dt * 2.4;
        } else {
          d.vy += 900 * dt;
          d.vx *= 1 - dt * 3;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (!d.home) d.r *= 1 - dt * 2;
        }
        if (d.age > d.life) drops.splice(i, 1);
      }
      for (let i = strands.length - 1; i >= 0; i--) {
        const st = strands[i];
        st.age += dt;
        if (Math.hypot(head.x - st.x, head.y - st.y) > SNAP || st.age > 1.2) {
          // snap: the halves fall back as droplets
          const mx = (st.x + head.x) / 2;
          const my = (st.y + head.y) / 2;
          for (let k = 0; k < 4; k++) drops.push({ x: mx, y: my, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 80, r: 2 + Math.random() * 2.5, age: 0, life: 0.5, home: false });
          strands.splice(i, 1);
        }
      }
      for (let i = feelers.length - 1; i >= 0; i--) {
        feelers[i].age += dt;
        if (feelers[i].age > feelers[i].life || p.moved < 0.05) feelers.splice(i, 1);
      }

      // the surface crawls: drift the noise under the displacement
      const dx = String((now / 40) % 400);
      const dy = String((now / 55) % 400);
      for (const o of [drift.current, driftW.current]) {
        o?.setAttribute("dx", dx);
        o?.setAttribute("dy", dy);
      }

      // flat goo (no lighting pass) while the Duo swings open: same shape and
      // colour, a fraction of the cost, back to wet and glossy once it lands
      cvK.style.filter = flat ? "url(#venom-black-flat)" : FILTER_K;
      cvW.style.filter = flat ? "url(#venom-white-flat)" : FILTER_W;
      const tf = `translate(${ox}px, ${oy}px)`;
      const kOn = draw(kx, 0);
      const wOn = draw(wx, 1);
      cvK.style.transform = cvW.style.transform = tf;
      cvK.style.opacity = kOn ? String(shown) : "0";
      cvW.style.opacity = wOn ? String(shown) : "0";
      cvK.style.visibility = kOn ? "visible" : "hidden";
      cvW.style.visibility = wOn ? "visible" : "hidden";
      run();
    };
    const run = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerout", onOut);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerout", onOut);
      host.classList.remove("venom-cursorless");
      host.querySelectorAll(".venom-on").forEach((el) => el.classList.remove("venom-on", "venom-rel", "venom-white"));
    };
  }, [root]);

  // one filter per symbiote: goo, crawl, then light it as a solid wet mass
  const filter = (id: string, ref: React.RefObject<SVGFEOffsetElement>, body: string, kd: number, ks: number) => (
    <filter id={id} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="7" result="blur" />
      <feColorMatrix in="blur" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 22 -10" result="goo" />
      <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="2" seed="7" stitchTiles="stitch" result="noise" />
      <feOffset ref={ref} in="noise" dx="0" dy="0" result="crawl" />
      <feDisplacementMap in="goo" in2="crawl" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="shape" />
      <feGaussianBlur in="shape" stdDeviation="3" result="soft" />
      <feDiffuseLighting in="soft" surfaceScale="5" diffuseConstant={kd} lightingColor={body} result="lit">
        <feDistantLight azimuth="235" elevation="56" />
      </feDiffuseLighting>
      <feSpecularLighting in="soft" surfaceScale="5" specularConstant={ks} specularExponent="46" lightingColor="#ffffff" result="spec">
        <feDistantLight azimuth="235" elevation="50" />
      </feSpecularLighting>
      <feComposite in="lit" in2="shape" operator="in" result="body" />
      <feComposite in="spec" in2="shape" operator="in" result="shine" />
      <feComposite in="body" in2="shine" operator="arithmetic" k1="0" k2="1" k3="0.85" k4="0" />
    </filter>
  );

  const canvasStyle = { width: SIZE, height: SIZE, opacity: 0, visibility: "hidden", willChange: "transform" } as const;
  return (
    <>
      <svg width="0" height="0" aria-hidden="true" className="absolute">
        <defs>
          {filter("venom-black", drift, "#141716", 1, 1.35)}
          {filter("venom-white", driftW, "#f6f4ee", 1.2, 0.7)}
          {[
            ["venom-black-flat", "#0b0d0c"],
            ["venom-white-flat", "#f2f0ea"],
          ].map(([id, c]) => (
            <filter key={id} id={id} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceAlpha" stdDeviation="7" result="blur" />
              <feColorMatrix in="blur" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 22 -10" result="goo" />
              <feFlood floodColor={c} />
              <feComposite in2="goo" operator="in" />
            </filter>
          ))}
        </defs>
      </svg>
      <canvas
        ref={black}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[45]"
        style={{ ...canvasStyle, filter: FILTER_K }}
      />
      <canvas
        ref={white}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[45]"
        style={{ ...canvasStyle, filter: FILTER_W }}
      />
    </>
  );
}
