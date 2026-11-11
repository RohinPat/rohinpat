import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seeded } from "@/components/offhours/useCanvas";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import { GH, GW, greenHeight } from "@/components/offhours/golf/green";
import { terrainOf } from "@/components/offhours/golf/terrain";
import { PAD as GPAD, reliefOf } from "./relief";
import { prepareScenery, type Skin } from "./scenery";

// One hole as a three.js scene, built from what course.ts already knows about it.
// The hole's surfaces (fairway stripes, rough, sand, water, the green) are painted
// into one top-down texture, so their edges are as crisp as the outlines, and that
// texture is laid over a terrain mesh: the hole's own ground where the ball can be
// (terrain.ts, which the ball plays on), rising into wooded hills beyond the trees. The green is its own finer
// mesh on top, shaped by the putt's height field (relief.ts), with a sharper
// texture, since the putting camera looks at it from a metre or two. Trees are instanced low-poly
// shapes; water is a glossy sheet on top of the painted pond.
//
// The hole's frame: x right, z downrange, y up, metres. course.ts's frame is
// left-handed seen from three.js, so everything here sits under a parent with
// x mirrored (render3d.ts); the numbers stay the course's own.

type P = [number, number];

const COL = {
  deep: "#24502d",
  rough: "#3f7a3b",
  cut: "#5f9a47",
  fairA: "#a2d870",
  fairB: "#8cc75e",
  fringe: "#8ccb64",
  green: "#c4f092",
  greenB: "#b6e684",
  sand: "#ecdcaa",
  sandD: "#d9c58f",
  lip: "#2f6534",
  bank: "#2b5a3a",
  pond: "#3c7ea3",
  tee: "#b2e27c",
};

export type Hole3D = {
  group: THREE.Group;
  /** the ground's height as drawn (m): the hole's, and the wooded hills beyond it */
  heightAt: (x: number, z: number) => number;
  /** the height of the ground the ball plays on, m */
  surfaceY: (x: number, z: number) => number;
  /** the height of a pond's or creek's surface, m */
  waterY: (x: number, z: number) => number;
  /** the flag's group, scaled from the outside so it can be found from far away */
  flag: THREE.Group;
  cloth: THREE.Mesh;
  /** trees, so the renderer can hide the ones between the camera and the ball */
  trees: { mesh: THREE.InstancedMesh; pos: Float32Array; mats: THREE.Matrix4[] }[];
  /** the backdrop's sky, and whether it brings its own far mountains (scenery/) */
  scenery: { skin?: Skin; rings: boolean };
  dispose: () => void;
};

const smooth = (a: number, b: number, v: number) => {
  const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** how much to draw: "low" (a phone) has a smaller texture, coarser ground and half the trees in the woods; "soft" (no GPU) less again */
export type Tier = "high" | "low" | "soft";
const TIERS = {
  high: { tex: 4096, cell: 2.5, perTree: 70, gcell: 0.2, gtex: 48 },
  low: { tex: 2048, cell: 4, perTree: 140, gcell: 0.33, gtex: 30 },
  soft: { tex: 1024, cell: 6, perTree: 700, gcell: 0.6, gtex: 14 },
};

export function buildHole3D(hole: BuiltHole, opts: { tier?: Tier; reduce?: boolean; sun?: THREE.Vector3 } = {}): Hole3D {
  const tier = TIERS[opts.tier ?? "high"];
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const def = hole.def;
  const rough = def.rough * YD;
  const box = hole.shape.box;
  const PAD = 45;
  const X0 = box.x0 - PAD, X1 = box.x1 + PAD, Z0 = box.z0 - PAD, Z1 = box.z1 + PAD;
  const W = X1 - X0, L = Z1 - Z0;

  // ---------------------------------------------------------------- ground height
  // the hole's ground, and from 30 m past the rough (the trees stand there) hills rising out of it
  const ground = terrainOf(hole);
  // (scenery/ decides the hills and their colours; the same as ever for a hole without a scene)
  const scn = prepareScenery(hole, ground.y, opts.tier ?? "high", { reduce: !!opts.reduce, sun: opts.sun });
  const heightAt = scn.heightAt;

  // ---------------------------------------------------------------- the painted surfaces
  const maxTex = tier.tex;
  const s = Math.min(maxTex / Math.max(W, L), 10);
  const cw = Math.round(W * s), ch = Math.round(L * s);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const c = canvas.getContext("2d")!;
  const tx = (x: number) => (x - X0) * s;
  const tz = (z: number) => (z - Z0) * s;
  const path = (pts: P[]) => {
    c.beginPath();
    pts.forEach(([x, z], i) => (i ? c.lineTo(tx(x), tz(z)) : c.moveTo(tx(x), tz(z))));
    c.closePath();
  };
  c.fillStyle = COL.deep;
  c.fillRect(0, 0, cw, ch);
  // the rough, with a soft darker band where it meets the woods
  c.lineJoin = "round";
  path(hole.shape.rough);
  c.strokeStyle = "#356c35";
  c.lineWidth = 3.5 * s;
  c.stroke();
  c.fillStyle = COL.rough;
  c.fill();
  // the fairway: a first cut around it, then mown stripes every 10 yd
  const fw = hole.shape.fairway;
  const n = fw.length / 2;
  path(fw);
  c.strokeStyle = COL.cut;
  c.lineWidth = 2.6 * s;
  c.stroke();
  for (let i = 0; i < n - 1; i++) {
    const a = fw[i], b = fw[i + 1], d = fw[fw.length - 2 - i], e = fw[fw.length - 1 - i];
    c.beginPath();
    c.moveTo(tx(a[0]), tz(a[1]));
    c.lineTo(tx(b[0]), tz(b[1]));
    c.lineTo(tx(d[0]), tz(d[1]));
    c.lineTo(tx(e[0]), tz(e[1]));
    c.closePath();
    c.fillStyle = Math.floor(i / 2) % 2 ? COL.fairB : COL.fairA;
    c.fill();
    // a hairline of the same colour hides the seams between quads
    c.strokeStyle = c.fillStyle;
    c.lineWidth = 1;
    c.stroke();
  }
  // the tee box: a lighter pad along the first leg
  {
    const [lx, lz] = hole.line[Math.min(2, hole.line.length - 1)];
    const yaw = Math.atan2(lx, lz);
    c.save();
    c.translate(tx(0), tz(0));
    c.rotate(-yaw);
    c.fillStyle = COL.tee;
    c.fillRect(-3.5 * s, -4 * s, 7 * s, 9 * s);
    c.restore();
  }
  // sand: a dark lip, then the sand, lighter in the middle
  for (const ring of hole.world.sand ?? []) {
    path(ring);
    c.strokeStyle = COL.lip;
    c.lineWidth = 1.1 * s;
    c.stroke();
    c.fillStyle = COL.sandD;
    c.fill();
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    path(ring.map(([x, z]) => [cx + (x - cx) * 0.82, cz + (z - cz) * 0.82] as P));
    c.fillStyle = COL.sand;
    c.fill();
  }
  // water: a dark bank and deep water (the glossy sheet goes on top)
  for (const ring of hole.world.water) {
    path(ring);
    c.strokeStyle = COL.bank;
    c.lineWidth = 2.2 * s;
    c.stroke();
    c.fillStyle = COL.pond;
    c.fill();
  }
  // the green: a fringe, then the green mown in stripes
  const gr = hole.world.greens[0];
  const ring2 = (rad: number) => gr.ring(rad).map(([x, , z]) => [x, z] as P);
  path(ring2(gr.r + 1.1));
  c.fillStyle = COL.fringe;
  c.fill();
  c.save();
  path(ring2(gr.r));
  c.fillStyle = COL.green;
  c.fill();
  c.clip();
  c.fillStyle = COL.greenB;
  for (let x = gr.x - 40; x < gr.x + 40; x += 5) c.fillRect(tx(x), tz(gr.z - 40), 2.5 * s, 80 * s);
  c.restore();
  // grain: thousands of faint flecks so the grass is not flat colour up close
  {
    const r = seeded(def.n * 977 + 3);
    const count = Math.round((cw * ch) / 90);
    for (let i = 0; i < count; i++) {
      c.fillStyle = r() > 0.5 ? "rgba(255,255,230,0.05)" : "rgba(0,30,0,0.06)";
      c.fillRect(r() * cw, r() * ch, 1 + r() * 2, 1 + r() * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  disposables.push(tex);

  // ---------------------------------------------------------------- the terrain
  // a rectilinear grid: 2.5 m cells over the hole (coarser on a phone), 25 m cells out to the hills
  const cell = tier.cell;
  const axis = (a0: number, a1: number, far: number) => {
    const out: number[] = [];
    for (let v = a0 - far; v < a0; v += 25) out.push(v);
    for (let v = a0; v < a1; v += cell) out.push(v);
    for (let v = a1; v <= a1 + far; v += 25) out.push(v);
    return out;
  };
  const xs = axis(X0, X1, 900), zs = axis(Z0, Z1, 900);
  const nx = xs.length, nz = zs.length;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = heightAt(xs[i], zs[j]);
  // flat-shaded: every triangle has its own three vertices
  const tris = (nx - 1) * (nz - 1) * 2;
  const pos = new Float32Array(tris * 9), uv = new Float32Array(tris * 6), col = new Float32Array(tris * 9);
  let k = 0;
  const hill: [number, number, number] = [1, 1, 1];
  const put = (i: number, j: number) => {
    const x = xs[i], z = zs[j], y = H[j * nx + i];
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    uv[k * 2] = (x - X0) / W; uv[k * 2 + 1] = (z - Z0) / L;
    // the hills are tinted by their height over the hole's ground: brighter and yellower higher up
    scn.tint(x, z, y, ground.y(x, z), COL.deep, hill);
    col[k * 3] = hill[0]; col[k * 3 + 1] = hill[1]; col[k * 3 + 2] = hill[2];
    k++;
  };
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      // wound so the faces point up in the course's own frame (three.js handles the mirrored parent)
      put(i, j); put(i, j + 1); put(i + 1, j);
      put(i + 1, j); put(i, j + 1); put(i + 1, j + 1);
    }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  tg.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  tg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  tg.computeVertexNormals();
  // where the ball plays, the ground is lit smooth and as if four times steeper than it is, so a few per cent of slope
  // shows as light and shade; the hills beyond keep their flat facets
  {
    const SHADE = 4, e = 1;
    const gn = new Float32Array(nx * nz * 4);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = xs[i], z = zs[j], q = (j * nx + i) * 4;
        const w = 1 - smooth(18, 34, hole.margin(x, z) - rough);
        if (w <= 0) continue;
        const sx = (ground.y(x + e, z) - ground.y(x - e, z)) / (2 * e), sz = (ground.y(x, z + e) - ground.y(x, z - e)) / (2 * e);
        const l = Math.hypot(SHADE * sx, 1, SHADE * sz);
        gn[q] = (-SHADE * sx) / l;
        gn[q + 1] = 1 / l;
        gn[q + 2] = (-SHADE * sz) / l;
        gn[q + 3] = w;
      }
    const na = tg.attributes.normal as THREE.BufferAttribute;
    let v = 0;
    const set = (i: number, j: number) => {
      const q = (j * nx + i) * 4, w = gn[q + 3];
      if (w > 0) {
        const fx = na.getX(v) + (gn[q] - na.getX(v)) * w, fy = na.getY(v) + (gn[q + 1] - na.getY(v)) * w, fz = na.getZ(v) + (gn[q + 2] - na.getZ(v)) * w;
        const l = Math.hypot(fx, fy, fz) || 1;
        na.setXYZ(v, fx / l, fy / l, fz / l);
      }
      v++;
    };
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        set(i, j); set(i, j + 1); set(i + 1, j);
        set(i + 1, j); set(i, j + 1); set(i + 1, j + 1);
      }
    na.needsUpdate = true;
  }
  const tm =new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
  const terrain = new THREE.Mesh(tg, tm);
  terrain.receiveShadow = true;
  group.add(terrain);
  disposables.push(tg, tm);

  // ---------------------------------------------------------------- the green
  group.add(buildGreen(hole, canvas, { X0, Z0, s }, tier, disposables));

  // ---------------------------------------------------------------- water
  // a pond is a level sheet; a creek is a strip down its path, following the ground it is dug into
  if (hole.world.water.length) {
    const wm = new THREE.MeshPhongMaterial({ color: "#4f97c0", specular: "#e8f6ff", shininess: 90, transparent: true, opacity: 0.82, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    disposables.push(wm);
    def.water.forEach((w, wi) => {
      let g: THREE.BufferGeometry;
      if ("path" in w) {
        const path = w.path.map(([x, z]) => [x * YD, z * YD] as P);
        const hw = (w.w * YD) / 2;
        const pts: P[] = [];
        for (let i = 0; i < path.length - 1; i++) {
          const [ax, az] = path[i], [bx, bz] = path[i + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
          for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
        }
        pts.push(path[path.length - 1]);
        const pos: number[] = [], idx: number[] = [];
        pts.forEach(([x, z], i) => {
          const [ax, az] = pts[Math.max(0, i - 1)], [bx, bz] = pts[Math.min(pts.length - 1, i + 1)];
          const l = Math.hypot(bx - ax, bz - az) || 1;
          const nx = (bz - az) / l, nz = -(bx - ax) / l;
          for (const s of [-1, 1]) {
            const px = x + s * nx * hw, pz = z + s * nz * hw;
            pos.push(px, ground.waterY(px, pz), pz);
          }
          if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i, 2 * i - 1, 2 * i + 1);
        });
        g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
      } else {
        const ring = hole.world.water[wi];
        const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
        g = new THREE.ShapeGeometry(shape);
        g.rotateX(-Math.PI / 2);
        g.translate(0, ground.waterY(w.x * YD, w.z * YD), 0);
      }
      const m = new THREE.Mesh(g, wm);
      m.receiveShadow = true;
      group.add(m);
      disposables.push(g);
    });
  }

  // ---------------------------------------------------------------- trees
  const trees = buildTrees(hole, heightAt, X0, X1, Z0, Z1, disposables, tier.perTree, scn.treeKeep);
  for (const t of trees) group.add(t.mesh);

  // ---------------------------------------------------------------- the backdrop: far mountains, sea, rock
  {
    const b = scn.build();
    group.add(b.group);
    disposables.push(b);
  }

  // ---------------------------------------------------------------- yardage posts
  {
    const pc: Record<string, string> = { "100": "#e5484d", "150": "#f2ead7", "200": "#3b6fd1" };
    const pg = new THREE.CylinderGeometry(0.09, 0.11, 0.9, 6);
    pg.translate(0, 0.45, 0);
    disposables.push(pg);
    for (const m of hole.world.markers ?? []) {
      const mat = new THREE.MeshLambertMaterial({ color: pc[m.label] ?? "#f2ead7", flatShading: true });
      disposables.push(mat);
      const post = new THREE.Mesh(pg, mat);
      post.position.set(m.x, ground.y(m.x, m.z), m.z);
      post.castShadow = true;
      group.add(post);
    }
  }

  // ---------------------------------------------------------------- tee markers
  {
    const [lx, lz] = hole.line[Math.min(2, hole.line.length - 1)];
    const yaw = Math.atan2(lx, lz);
    const mg = new THREE.CylinderGeometry(0.05, 0.07, 0.14, 8);
    const mm = new THREE.MeshLambertMaterial({ color: "#3b6fd1" });
    disposables.push(mg, mm);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(mg, mm);
      const mx = Math.cos(yaw) * side * 2.6 + Math.sin(yaw) * 1.2, mz = -Math.sin(yaw) * side * 2.6 + Math.cos(yaw) * 1.2;
      m.position.set(mx, ground.y(mx, mz) + 0.07, mz);
      m.castShadow = true;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------- the flag and the cup
  const flag = new THREE.Group();
  const cloth = new THREE.Mesh();
  {
    const [px, pz] = hole.pin;
    const py = ground.y(px, pz);
    flag.position.set(px, py, pz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.4, 6), new THREE.MeshLambertMaterial({ color: "#f7f3e8" }));
    pole.position.y = 1.2;
    pole.castShadow = true;
    const cg = new THREE.PlaneGeometry(0.62, 0.4, 6, 1);
    cg.translate(0.31, 0, 0);
    cloth.geometry = cg;
    cloth.material = new THREE.MeshLambertMaterial({ color: "#e5484d", side: THREE.DoubleSide });
    cloth.position.y = 2.2;
    cloth.castShadow = true;
    flag.add(pole, cloth);
    group.add(flag);
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.054, 16), new THREE.MeshBasicMaterial({ color: "#16201a", polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    cup.rotation.x = -Math.PI / 2;
    cup.position.set(px, py + 0.004, pz);
    group.add(cup);
    disposables.push(pole.geometry, pole.material as THREE.Material, cg, cloth.material as THREE.Material, cup.geometry, cup.material as THREE.Material);
  }

  return {
    group,
    heightAt,
    surfaceY: ground.y,
    waterY: ground.waterY,
    flag,
    cloth,
    trees,
    scenery: { skin: scn.skin, rings: scn.rings },
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

// -------------------------------------------------------------------- the green

/**
 * The green and its bank as a fine grid in the course's frame, lit as if its slopes were three times steeper than they
 * are, so a two per cent break shows as light and shade. Its texture repaints the green, the fringe and what lies
 * around them at several times the hole texture's resolution, with faint contour lines on the putting surface.
 */
function buildGreen(hole: BuiltHole, canvas: HTMLCanvasElement, main: { X0: number; Z0: number; s: number }, tier: { gcell: number; gtex: number }, disposables: { dispose: () => void }[]) {
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
  const path = (rad: number) => {
    c.beginPath();
    gr.ring(rad).forEach(([x, , z], i) => (i ? c.lineTo((x - x0) * T, (z - z0) * T) : c.moveTo((x - x0) * T, (z - z0) * T)));
    c.closePath();
  };
  path(gr.r + 1.1);
  c.fillStyle = COL.fringe;
  c.fill();
  c.save();
  path(gr.r);
  c.fillStyle = COL.green;
  c.fill();
  c.clip();
  c.fillStyle = COL.greenB;
  for (let x = gr.x - 40; x < gr.x + 40; x += 5) c.fillRect((x - x0) * T, 0, 2.5 * T, ch);
  c.restore();
  // contours every 2.5 cm on the green and the fringe (marching squares, stroked smooth), then grain over everything
  {
    const g = 0.2, LV = 0.025;
    const nx = Math.ceil(W / g) + 1, nz = Math.ceil(L / g) + 1;
    const Hh = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const [gx, gy] = hole.toGreen(x0 + i * g, z0 + j * g);
        Hh[j * nx + i] = greenHeight(hole.green, gx, gy) / LV;
      }
    c.save();
    path(gr.r + 1.1);
    c.clip();
    c.beginPath();
    const P = (i: number, j: number): [number, number] => [i * g * T, j * g * T];
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = Hh[j * nx + i], b = Hh[j * nx + i + 1], cc = Hh[(j + 1) * nx + i + 1], d = Hh[(j + 1) * nx + i];
        const lo = Math.ceil(Math.min(a, b, cc, d)), hi = Math.floor(Math.max(a, b, cc, d));
        for (let lv = lo; lv <= hi; lv++) {
          // where the level crosses each edge of the cell
          const pts: [number, number][] = [];
          const edge = (p: number, q: number, A: [number, number], B: [number, number]) => {
            if ((p < lv) !== (q < lv)) {
              const u = (lv - p) / (q - p);
              pts.push([A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u]);
            }
          };
          edge(a, b, P(i, j), P(i + 1, j));
          edge(b, cc, P(i + 1, j), P(i + 1, j + 1));
          edge(cc, d, P(i + 1, j + 1), P(i, j + 1));
          edge(d, a, P(i, j + 1), P(i, j));
          for (let k = 0; k + 1 < pts.length; k += 2) {
            c.moveTo(pts[k][0], pts[k][1]);
            c.lineTo(pts[k + 1][0], pts[k + 1][1]);
          }
        }
      }
    c.strokeStyle = "rgba(20,60,20,0.08)";
    c.lineWidth = Math.max(1, T * 0.025);
    c.stroke();
    c.restore();
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

  // ---- mesh: only the cells where the green rises off its pad
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
      if (R[j * nx + i] <= 0 && R[j * nx + i + 1] <= 0 && R[(j + 1) * nx + i] <= 0 && R[(j + 1) * nx + i + 1] <= 0) continue;
      // the bank stops at a pond's edge, so the water stays where it is drawn
      if (hole.surfaceAt(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell) === "water") continue;
      // wound like the terrain, so the faces point up in the course's own frame
      const a = vert(i, j), b = vert(i, j + 1), cc = vert(i + 1, j), d = vert(i + 1, j + 1);
      tri.push(a, b, cc, cc, b, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(tri);
  // a constant nudge only: a slope-scaled one would pull the green in front of the putting line at a grazing angle
  const m = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });
  disposables.push(g, m);
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

// -------------------------------------------------------------------- trees

/** a pine (kinds 2 and 3) and a broadleaf (0 and 1), each one unit tall, coloured per vertex */
function treeGeometries() {
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const g2 = g.index ? g.toNonIndexed() : g;
    const cc = new THREE.Color(hex);
    const n = g2.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = cc.r;
      a[i * 3 + 1] = cc.g;
      a[i * 3 + 2] = cc.b;
    }
    g2.setAttribute("color", new THREE.BufferAttribute(a, 3));
    g2.deleteAttribute("uv");
    return g2;
  };
  const trunkP = new THREE.CylinderGeometry(0.025, 0.035, 0.3, 5).translate(0, 0.15, 0);
  const pine = mergeGeometries([
    paint(trunkP, "#6b4a32"),
    paint(new THREE.ConeGeometry(0.3, 0.42, 7).translate(0, 0.38, 0), "#2a6a3f"),
    paint(new THREE.ConeGeometry(0.24, 0.36, 7).translate(0, 0.58, 0), "#327a47"),
    paint(new THREE.ConeGeometry(0.16, 0.32, 7).translate(0, 0.8, 0), "#3e8a54"),
  ])!;
  const trunkB = new THREE.CylinderGeometry(0.03, 0.045, 0.45, 5).translate(0, 0.225, 0);
  const broad = mergeGeometries([
    paint(trunkB, "#6e4f36"),
    paint(new THREE.IcosahedronGeometry(0.3, 0).translate(0, 0.6, 0), "#2f7a3d"),
    paint(new THREE.IcosahedronGeometry(0.21, 0).translate(0.17, 0.52, 0.06), "#3a873f"),
    paint(new THREE.IcosahedronGeometry(0.2, 0).translate(-0.16, 0.55, -0.05), "#2c7039"),
    paint(new THREE.IcosahedronGeometry(0.19, 0).translate(0.02, 0.83, 0.02), "#4c9c4c"),
  ])!;
  pine.computeVertexNormals();
  broad.computeVertexNormals();
  return { pine, broad };
}

function buildTrees(
  hole: BuiltHole,
  heightAt: (x: number, z: number) => number,
  X0: number,
  X1: number,
  Z0: number,
  Z1: number,
  disposables: { dispose: () => void }[],
  /** one try at a tree in the woods per this many square metres */
  perTree: number,
  /** scenery's say over which of the decorative trees stay */
  keep?: (x: number, z: number, h: number) => boolean,
) {
  const rough = hole.def.rough * YD;
  type T = { x: number; z: number; h: number; pine: boolean; w: number; rot: number; tint: number };
  const list: T[] = [];
  const r = seeded(hole.def.trees.seed * 7 + 1);
  // the trees course.ts places (the copse among them: those stop balls)
  for (const t of hole.world.trees) list.push({ x: t.x, z: t.z, h: t.h, pine: t.kind >= 2, w: t.kind === 3 ? 0.62 : t.kind === 2 ? 0.75 : 0.85, rot: r() * 6.28, tint: 0.85 + r() * 0.3 });
  // and the woods behind them, thick enough to read as a forest, out onto the hills
  const area = (X1 - X0 + 300) * (Z1 - Z0 + 300);
  const tries = Math.round(area / perTree);
  for (let i = 0; i < tries; i++) {
    const x = X0 - 150 + r() * (X1 - X0 + 300), z = Z0 - 150 + r() * (Z1 - Z0 + 300);
    const m = hole.margin(x, z) - rough;
    if (m < 22 || hole.surfaceAt(x, z) !== "out") continue;
    // thinner far out, so the hills show between them
    if (r() > 1.15 - m / 220) continue;
    const pine = r() > 0.45;
    list.push({ x, z, h: 13 + r() * 14, pine, w: pine ? 0.62 + r() * 0.15 : 0.8 + r() * 0.15, rot: r() * 6.28, tint: 0.82 + r() * 0.32 });
  }
  const { pine, broad } = treeGeometries();
  const kept = keep ? list.filter((t) => keep(t.x, t.z, t.h)) : list;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  disposables.push(pine, broad, mat);
  const out: { mesh: THREE.InstancedMesh; pos: Float32Array; mats: THREE.Matrix4[] }[] = [];
  for (const kind of [true, false]) {
    const sel = kept.filter((t) => t.pine === kind);
    const mesh = new THREE.InstancedMesh(kind ? pine : broad, mat, sel.length);
    const pos = new Float32Array(sel.length * 2);
    const mats: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), cc = new THREE.Color();
    sel.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      sc.set(t.h * t.w, t.h, t.h * t.w);
      p.set(t.x, heightAt(t.x, t.z) - 0.2, t.z);
      const m4 = new THREE.Matrix4().compose(p, q, sc);
      mats.push(m4);
      mesh.setMatrixAt(i, m4);
      cc.setRGB(t.tint, t.tint * (0.97 + 0.06 * Math.sin(t.rot * 3)), t.tint * 0.95);
      mesh.setColorAt(i, cc);
      pos[i * 2] = t.x;
      pos[i * 2 + 1] = t.z;
    });
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    out.push({ mesh, pos, mats });
  }
  return out;
}
