import * as THREE from "three";
import { seeded } from "@/components/offhours/useCanvas";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { GH, GW, shapeR } from "@/components/offhours/golf/green";
import { BANK, HOLD, outsideGreen } from "@/components/offhours/golf/terrain";
import { PAD as GPAD, reliefOf } from "./relief";

// The green as the hole's scene draws it: a fine mesh (buildGreen) over a coarse terrain that is sunk beneath it
// (greenSink), a texture painted pixel by pixel from the green's own outline (the collar, the cleanup lap, the mown
// stripes, a soft hillshade), and the pin with its cup (buildPin). Everything here is render-only; the ball plays on
// the terrain's height field, which none of it changes.

/** how far the coarse terrain is sunk under the green's fine mesh, m: more than the most the 2.5 m grid can stand off the true surface */
const SINK = 0.08;

/**
 * How far to sink the terrain at a point, m: all of SINK under the green, its collar and the held ground past it, and
 * easing to nothing exactly where the green's relief does (terrain.ts's `fade`), so there is no crater wall and the
 * fine mesh meets the terrain where it ends. Never under a pond, whose cells the mesh leaves out.
 */
export function greenSink(hole: BuiltHole) {
  return (x: number, z: number) => {
    const [gx, gy] = hole.toGreen(x, z);
    if (gx < -GPAD || gx > GW + GPAD || gy < -GPAD || gy > GH + GPAD) return 0;
    const o = outsideGreen(hole, gx, gy);
    if (o >= HOLD + BANK) return 0;
    if (hole.surfaceAt(x, z) === "water") return 0;
    const u = Math.max(0, Math.min(1, (o - HOLD) / BANK));
    return SINK * (1 - u * u * (3 - 2 * u));
  };
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a: number, b: number, v: number) => {
  const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** the greenkeeper's palette: the green is bluer and brighter than the fairway's yellow-green, the collar a cut taller and deeper */
const PAINT = {
  collarIn: hex("#80c866"),
  collarOut: hex("#6fb458"),
  stripeA: hex("#8fe275"),
  stripeB: hex("#80d166"),
  lap: hex("#78c860"),
  edge: hex("#2b7f40"),
};
/** a mowing pass, m, and the angle the passes run at across the green's own axes */
const PASS = 1.25;
const PASS_ANGLE = 0.6;
/** the cleanup lap round the edge, m */
const LAP = 0.6;

/**
 * The green and its bank as a fine grid in the course's frame, lit as if its slopes were three times steeper than they
 * are, so a two per cent break shows as light and shade. Its texture repaints the green, the collar and what lies
 * around them at several times the hole texture's resolution. The mesh covers every cell the green's relief reaches
 * (so the whole green and collar footprint, and the bank), except at a pond.
 */
export function buildGreen(hole: BuiltHole, canvas: HTMLCanvasElement, main: { X0: number; Z0: number; s: number }, tier: { gcell: number; gtex: number }, disposables: { dispose: () => void }[]) {
  const relief = reliefOf(hole);
  const [ax, az] = hole.fromGreen(-GPAD, GH + GPAD);
  const [bx, bz] = hole.fromGreen(GW + GPAD, -GPAD);
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  const W = x1 - x0, L = z1 - z0;

  // ---- texture
  const T = tier.gtex;
  const cw = Math.round(W * T), ch = Math.round(L * T);
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const c = cv.getContext("2d")!;
  c.imageSmoothingEnabled = true;
  c.drawImage(canvas, (x0 - main.X0) * main.s, (z0 - main.Z0) * main.s, W * main.s, L * main.s, 0, 0, cw, ch);
  const gr = hole.world.greens[0];
  const H = hole.green;

  // the paint, pixel by pixel from the signed distance to the green's edge (e, m, negative inside) and to its collar's
  // (ec): a pixel is apron, collar, cleanup lap or mown stripe, with an anti-aliased edge between each
  {
    const img = c.getImageData(0, 0, cw, ch);
    const d = img.data;
    const ca = Math.cos(PASS_ANGLE), sa = Math.sin(PASS_ANGLE);
    const px = 0.75 / T;
    const cover = (e: number) => Math.max(0, Math.min(1, 0.5 - e / (2 * px)));
    for (let j = 0; j < ch; j++) {
      const z = z0 + (j + 0.5) / T;
      for (let i = 0; i < cw; i++) {
        const x = x0 + (i + 0.5) / T;
        const gx = GW / 2 + (x - gr.x), gy = GH / 2 - (z - gr.z);
        const dx = gx - GW / 2, dy = gy - GH / 2;
        const rho = Math.hypot(dx / (GW / 2), dy / (GH / 2));
        if (rho > 1.5 || rho < 1e-9) continue;
        // a step in rho is longer along the long axis: the collar is as wide as zone() says, about 0.5 m to 0.85 m
        const k = Math.hypot(dx, dy) / rho;
        const e = (rho - shapeR(H, Math.atan2(dy / (GH / 2), dx / (GW / 2)))) * k;
        const wc = 0.085 * k;
        const ec = e - wc;
        if (ec > px * 3) continue;
        const o = (j * cw + i) * 4;
        let col: RGB = [d[o], d[o + 1], d[o + 2]];
        // the collar: a tight first cut, deeper at its outer edge
        const inCollar = cover(ec);
        if (inCollar > 0) col = mix(col, mix(PAINT.collarIn, PAINT.collarOut, sstep(-wc, 0, ec)), inCollar);
        // the green: mown stripes in passes across it, a cleanup lap of its own colour round the edge
        const inGreen = cover(e);
        if (inGreen > 0) {
          const s = (gx * ca + gy * sa) / PASS;
          // a pass is light, the next dark, with a soft turn between (a triangle wave in s, cut at its middle)
          const tri = Math.abs((((s % 2) + 2) % 2) - 1);
          const stripe = mix(PAINT.stripeB, PAINT.stripeA, sstep(0.5 - 0.03, 0.5 + 0.03, tri));
          const lap = sstep(-LAP - 0.04, -LAP + 0.04, e);
          const g = mix(stripe, PAINT.lap, lap);
          // a thin dark line where the cut changes
          const edge = (1 - sstep(0.012, 0.04, Math.abs(e + 0.01))) * 0.5;
          col = mix(col, mix(g, PAINT.edge, edge), inGreen);
        }
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
      }
    }
    c.putImageData(img, 0, 0);
  }

  // a hillshade baked into the paint: the green lit low from one side so every slope is light on one face and shade on
  // the other, and tinted by height (higher, warmer and paler; lower, deeper and cooler), so the break reads in a still
  // frame as well as when the ball rolls. It is paint only: the ball plays on the true surface. The shading grades
  // with the slope (a soft knee, not a switch: one to three per cent is most of what a green has), and fades out
  // over the apron.
  {
    const g = 0.1;
    const nx = Math.ceil(W / g) + 1, nz = Math.ceil(L / g) + 1;
    const Hy = new Float32Array(nx * nz), Rz = new Float32Array(nx * nz), Mk = new Float32Array(nx * nz);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * g, z = z0 + j * g;
        Hy[j * nx + i] = relief.y(x, z);
        const [gx, gy] = hole.toGreen(x, z);
        const r = relief.rise(gx, gy);
        const o = outsideGreen(hole, gx, gy);
        // zone 0 is inside o = -(the collar's width), but the height tint only wants the putting surface
        const on = o < -0.85;
        Rz[j * nx + i] = on ? r : NaN;
        Mk[j * nx + i] = 1 - sstep(0, 1.2, o);
        if (on) {
          lo = Math.min(lo, r);
          hi = Math.max(hi, r);
        }
      }
    const span = Math.max(0.06, hi - lo);
    // light from the course's low-x, low-z side (the left, back of the green as the player sees it from the tee)
    const lx = -0.6, lz = 0.8;
    const ov = document.createElement("canvas");
    ov.width = nx;
    ov.height = nz;
    const oc = ov.getContext("2d")!;
    const img = oc.createImageData(nx, nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * nx + i;
        const gx = (Hy[j * nx + Math.min(nx - 1, i + 1)] - Hy[j * nx + Math.max(0, i - 1)]) / (g * (Math.min(nx - 1, i + 1) - Math.max(0, i - 1)));
        const gz = (Hy[Math.min(nz - 1, j + 1) * nx + i] - Hy[Math.max(0, j - 1) * nx + i]) / (g * (Math.min(nz - 1, j + 1) - Math.max(0, j - 1)));
        // the slope toward the light: positive where the ground faces it, so it is lit
        const sh = Math.tanh(-(gx * lx + gz * lz) * 9);
        const hgt = Rz[a] === Rz[a] ? Math.max(-1, Math.min(1, ((Rz[a] - lo) / span) * 2 - 1)) : 0;
        let r: number, gg: number, b: number, al: number;
        if (sh >= 0) [r, gg, b, al] = [255, 255, 200, sh * 0.26];
        else [r, gg, b, al] = [8, 50, 78, -sh * 0.4];
        // the height tint: a faint warm wash high up, a faint cool one low down
        const ta = Math.abs(hgt) * 0.1;
        const o = a * 4;
        const ra = al + ta * (1 - al);
        const [tr, tg, tb] = hgt >= 0 ? [255, 240, 150] : [20, 90, 120];
        r = (r * al + tr * ta * (1 - al)) / (ra || 1);
        gg = (gg * al + tg * ta * (1 - al)) / (ra || 1);
        b = (b * al + tb * ta * (1 - al)) / (ra || 1);
        img.data[o] = r;
        img.data[o + 1] = gg;
        img.data[o + 2] = b;
        img.data[o + 3] = Math.round(ra * Mk[a] * 255);
      }
    oc.putImageData(img, 0, 0);
    c.imageSmoothingQuality = "high";
    c.drawImage(ov, 0, 0, nx, nz, 0, 0, nx * g * T, nz * g * T);
  }
  // grain over everything (the contour lines are gone: they alias to dashes at a grazing angle)
  {
    const r = seeded(hole.def.n * 131 + 7);
    const count = Math.round((cw * ch) / 70);
    for (let i = 0; i < count; i++) {
      c.fillStyle = r() > 0.5 ? "rgba(255,255,230,0.05)" : "rgba(0,30,0,0.06)";
      c.fillRect(r() * cw, r() * ch, 1 + r() * 1.5, 1 + r() * 1.5);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  disposables.push(tex);

  // ---- mesh: every cell the green's relief reaches, which is the whole green and collar and the bank down to the apron
  const cell = tier.gcell;
  const nx = Math.ceil(W / cell) + 1, nz = Math.ceil(L / cell) + 1;
  const Y = new Float32Array(nx * nz);
  const R = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, z = z0 + j * cell;
      Y[j * nx + i] = relief.y(x, z);
      const [gx, gy] = hole.toGreen(x, z);
      R[j * nx + i] = relief.rise(gx, gy);
    }
  const EX = 3;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const idx = new Map<number, number>();
  const tri: number[] = [];
  const n = new THREE.Vector3();
  const vert = (i: number, j: number) => {
    const key = j * nx + i;
    const got = idx.get(key);
    if (got !== undefined) return got;
    const v = pos.length / 3;
    idx.set(key, v);
    const x = x0 + i * cell, z = z0 + j * cell;
    pos.push(x, Y[key], z);
    const yl = Y[j * nx + Math.max(0, i - 1)], yr = Y[j * nx + Math.min(nx - 1, i + 1)];
    const yd = Y[Math.max(0, j - 1) * nx + i], yu = Y[Math.min(nz - 1, j + 1) * nx + i];
    n.set((-EX * (yr - yl)) / (2 * cell), 1, (-EX * (yu - yd)) / (2 * cell)).normalize();
    nor.push(n.x, n.y, n.z);
    uv.push((x - x0) / W, (z - z0) / L);
    return v;
  };
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
      // a cell is left out only when the relief does not reach it and it lies outside the collar
      if (R[j * nx + i] <= 0 && R[j * nx + i + 1] <= 0 && R[(j + 1) * nx + i] <= 0 && R[(j + 1) * nx + i + 1] <= 0) {
        const [gx, gy] = hole.toGreen(cx, cz);
        if (outsideGreen(hole, gx, gy) > 0) continue;
      }
      // the bank stops at a pond's edge, so the water stays where it is drawn
      if (hole.surfaceAt(cx, cz) === "water") continue;
      // wound like the terrain, so the faces point up in the course's own frame
      const a = vert(i, j), b = vert(i, j + 1), cc = vert(i + 1, j), d = vert(i + 1, j + 1);
      tri.push(a, b, cc, cc, b, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(tri);
  // the terrain is sunk beneath it (greenSink), so a small constant nudge is all it needs; a slope-scaled one would
  // pull the green in front of the putting line at a grazing angle
  const m = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });
  disposables.push(g, m);
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The pin: a stout white pole, a big red cloth (it holds its colour in shade), and at its foot the cup with a pale rim
 * and a faint ring of worn turf round it, so the hole reads from the approach and at address. The cup is drawn larger
 * than its 5.4 cm radius's physics (the ball's `CUP_R` does not change). The flag group is scaled from outside so it
 * can be found from far away; the cup is not part of it.
 */
export function buildPin(hole: BuiltHole, y: (x: number, z: number) => number, group: THREE.Group, disposables: { dispose: () => void }[]) {
  const flag = new THREE.Group();
  const cloth = new THREE.Mesh();
  const [px, pz] = hole.pin;
  const py = y(px, pz);
  flag.position.set(px, py, pz);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 2.4, 8), new THREE.MeshLambertMaterial({ color: "#f7f3e8" }));
  pole.position.y = 1.2;
  pole.castShadow = true;
  const cg = new THREE.PlaneGeometry(1.0, 0.62, 8, 1);
  cg.translate(0.5, 0, 0);
  cloth.geometry = cg;
  cloth.material = new THREE.MeshLambertMaterial({ color: "#e5484d", emissive: "#e5484d", emissiveIntensity: 0.35, side: THREE.DoubleSide });
  cloth.position.y = 2.15;
  cloth.castShadow = true;
  flag.add(pole, cloth);
  group.add(flag);
  const flat = (geo: THREE.BufferGeometry, color: string, opacity: number, lift: number, off: number) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(px, py + lift, pz);
    group.add(mesh);
    disposables.push(geo, mesh.material as THREE.Material);
  };
  flat(new THREE.RingGeometry(0.11, 0.42, 28), "#1f5a2e", 0.2, 0.002, -4);
  flat(new THREE.RingGeometry(0.054, 0.11, 24), "#f4f1e0", 0.92, 0.003, -5);
  flat(new THREE.CircleGeometry(0.054, 20), "#16201a", 1, 0.004, -6);
  disposables.push(pole.geometry, pole.material as THREE.Material, cg, cloth.material as THREE.Material);
  return { flag, cloth };
}
