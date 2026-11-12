import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seeded } from "@/components/offhours/useCanvas";
import type { BuiltHole } from "@/components/offhours/golf/course";
import { YD } from "@/components/offhours/golf/scene";
import { outsideGreen, terrainOf } from "@/components/offhours/golf/terrain";
import { buildGreen, buildPin, greenSink } from "./green3d";
import { buildProps3D } from "./props3d";
import { prepareScenery, type Skin } from "./scenery";
import { buildWater } from "./water3d";
import { paintAreas } from "./areas3d";

// One hole as a three.js scene, built from what course.ts already knows about it.
// The hole's surfaces (fairway stripes, rough, sand, water, the green) are painted
// into one top-down texture, so their edges are as crisp as the outlines, and that
// texture is laid over a terrain mesh: the hole's own ground where the ball can be
// (terrain.ts, which the ball plays on), rising into wooded hills beyond the trees. The green is its own finer
// mesh on top, shaped by the putt's height field (relief.ts), with a sharper
// texture, since the putting camera looks at it from a metre or two. Trees are instanced low-poly
// shapes; water is its own sheet (water3d.ts) on top of the painted bank.
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
  /** the range's target flags (none on a hole of the course), scaled the same way */
  targetFlags: THREE.Group[];
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
  high: { tex: 4096, cell: 2.5, perTree: 70, gcell: 0.2, gtex: 48, sub: 5, sub2: 3, gsub: 2 },
  low: { tex: 2048, cell: 4, perTree: 140, gcell: 0.33, gtex: 30, sub: 4, sub2: 2, gsub: 2 },
  soft: { tex: 1024, cell: 6, perTree: 700, gcell: 0.6, gtex: 14, sub: 3, sub2: 2, gsub: 0 },
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
  // fescue, gorse, waste and out of bounds (areas3d.ts), under the sand and the water
  paintAreas(c, hole.areas, tx, tz, s, def.n);
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
  // water: the bank (wet earth, steep faces stretch the top-down texture, so it is wide) and a pale lip at the top of it;
  // the water sheet (water3d.ts) goes on top
  for (const ring of hole.world.water) {
    path(ring);
    c.strokeStyle = "#5f5636";
    c.lineWidth = 4 * s;
    c.stroke();
    c.strokeStyle = "#c4bb86";
    c.lineWidth = 1.5 * s;
    c.stroke();
    c.fillStyle = COL.pond;
    c.fill();
  }
  // (the green and its collar are painted by green3d.ts, on its own texture, over the terrain sunk beneath it)
  // the range's targets: rounds of green in a fringe, mown in rings
  for (const tg of hole.world.greens.slice(1)) {
    const ring = (rad: number) => tg.ring(rad).map(([x, , z]) => [x, z] as P);
    path(ring(tg.r + tg.fringe));
    c.fillStyle = COL.fringe;
    c.fill();
    for (let k = 0; k < 4; k++) {
      path(ring(tg.r * (1 - k * 0.25)));
      c.fillStyle = k % 2 ? COL.greenB : COL.green;
      c.fill();
    }
  }
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
  // a rectilinear grid: 2.5 m cells over the hole (coarser on a phone), 25 m cells out to the hills. Cells round a pot, a
  // bank, a ravine or a shaped green are cut finer (`sub` x `sub`), as part of the same mesh
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
  // the terrain is sunk a hand's breadth under the green's own fine mesh (green3d.ts), so the two never fight for the pixel
  const sink = greenSink(hole);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = heightAt(xs[i], zs[j]) - sink(xs[i], zs[j]);
  const cx = nx - 1, cz = nz - 1;
  const subOf = new Uint8Array(cx * cz);
  let fineCells = 0, fineTris = 0;
  if (ground.fx.bounds.length || ground.greenShaped) {
    const reach = cell * 0.75;
    for (let j = 0; j < cz; j++)
      for (let i = 0; i < cx; i++) {
        if (Math.abs(xs[i + 1] - xs[i] - cell) > 1e-6 || Math.abs(zs[j + 1] - zs[j] - cell) > 1e-6) continue;
        const mx = (xs[i] + xs[i + 1]) / 2, mz = (zs[j] + zs[j + 1]) / 2;
        const lvl = ground.fx.fine(mx, mz, reach);
        let sb = lvl === 2 ? tier.sub : lvl === 1 ? tier.sub2 : 0;
        if (!sb && ground.greenShaped) {
          const [gx, gy] = hole.toGreen(mx, mz);
          if (outsideGreen(hole, gx, gy) < 16) sb = tier.gsub;
        }
        if (sb > 1) {
          subOf[j * cx + i] = sb;
          fineCells++;
          fineTris += 2 * sb * sb;
        }
      }
  }
  const isFine = (i: number, j: number) => i >= 0 && j >= 0 && i < cx && j < cz && subOf[j * cx + i] > 0;
  // flat-shaded: every triangle has its own three vertices
  const tris = (cx * cz - fineCells) * 2 + fineTris;
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
  for (let j = 0; j < cz; j++)
    for (let i = 0; i < cx; i++) {
      if (subOf[j * cx + i]) continue;
      // wound so the faces point up in the course's own frame (three.js handles the mirrored parent)
      put(i, j); put(i, j + 1); put(i + 1, j);
      put(i + 1, j); put(i, j + 1); put(i + 1, j + 1);
    }
  // the finer cells. Their edges shared with a coarse cell lie on the coarse cell's own edge, so the mesh has no cracks
  const fineAt: [number, number][] = [];
  const fineFirst = k;
  for (let j = 0; j < cz; j++)
    for (let i = 0; i < cx; i++) {
      const s2 = subOf[j * cx + i];
      if (!s2) continue;
      const at = (ii: number, jj: number) => H[jj * nx + ii];
      const vx = (a: number) => xs[i] + ((xs[i + 1] - xs[i]) * a) / s2;
      const vz = (b: number) => zs[j] + ((zs[j + 1] - zs[j]) * b) / s2;
      const hgt = (a: number, b: number) => {
        const edgeA = a === 0 || a === s2, edgeB = b === 0 || b === s2;
        if (edgeA && edgeB) {
          const vi = i + (a === s2 ? 1 : 0), vj = j + (b === s2 ? 1 : 0);
          if (!(isFine(vi - 1, vj - 1) && isFine(vi, vj - 1) && isFine(vi - 1, vj) && isFine(vi, vj))) return at(vi, vj);
        } else if (a === 0 && !isFine(i - 1, j)) return at(i, j) + (at(i, j + 1) - at(i, j)) * (b / s2);
        else if (a === s2 && !isFine(i + 1, j)) return at(i + 1, j) + (at(i + 1, j + 1) - at(i + 1, j)) * (b / s2);
        else if (b === 0 && !isFine(i, j - 1)) return at(i, j) + (at(i + 1, j) - at(i, j)) * (a / s2);
        else if (b === s2 && !isFine(i, j + 1)) return at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * (a / s2);
        return heightAt(vx(a), vz(b)) - sink(vx(a), vz(b));
      };
      const fput = (a: number, b: number) => {
        const x = vx(a), z = vz(b), y = hgt(a, b);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        uv[k * 2] = (x - X0) / W; uv[k * 2 + 1] = (z - Z0) / L;
        scn.tint(x, z, y, ground.y(x, z), COL.deep, hill);
        // a steep face shows bare: a warm sod and earth, in bands like stacked turf
        const [sx, sz] = ground.slope(x, z);
        const st = smooth(0.45, 1.1, Math.hypot(sx, sz));
        const band = 1 - 0.14 * st * (Math.floor(y * 3) & 1);
        col[k * 3] = hill[0] * (1 - 0.35 * st) * band; col[k * 3 + 1] = hill[1] * (1 - 0.5 * st) * band; col[k * 3 + 2] = hill[2] * (1 - 0.72 * st) * band;
        fineAt.push([x, z]);
        k++;
      };
      for (let b = 0; b < s2; b++)
        for (let a = 0; a < s2; a++) {
          fput(a, b); fput(a, b + 1); fput(a + 1, b);
          fput(a + 1, b); fput(a, b + 1); fput(a + 1, b + 1);
        }
    }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  tg.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  tg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  tg.computeVertexNormals();
  // where the ball plays, the ground is lit smooth and as if four times steeper than it is, so a few per cent of slope
  // shows as light and shade (less for a steep face, which needs no help); the hills beyond keep their flat facets
  {
    const e = 1;
    const lit = (x: number, z: number, out: Float32Array, o: number) => {
      const w = 1 - smooth(18, 34, hole.margin(x, z) - rough);
      if (w <= 0) return;
      const sx = (ground.y(x + e, z) - ground.y(x - e, z)) / (2 * e), sz = (ground.y(x, z + e) - ground.y(x, z - e)) / (2 * e);
      const SHADE = 4 - 2.7 * smooth(0.2, 0.7, Math.hypot(sx, sz));
      const l = Math.hypot(SHADE * sx, 1, SHADE * sz);
      out[o] = (-SHADE * sx) / l;
      out[o + 1] = 1 / l;
      out[o + 2] = (-SHADE * sz) / l;
      out[o + 3] = w;
    };
    const gn = new Float32Array(nx * nz * 4);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) lit(xs[i], zs[j], gn, (j * nx + i) * 4);
    const na = tg.attributes.normal as THREE.BufferAttribute;
    const blend = (v: number, n0: number, n1: number, n2: number, w: number) => {
      const fx = na.getX(v) + (n0 - na.getX(v)) * w, fy = na.getY(v) + (n1 - na.getY(v)) * w, fz = na.getZ(v) + (n2 - na.getZ(v)) * w;
      const l = Math.hypot(fx, fy, fz) || 1;
      na.setXYZ(v, fx / l, fy / l, fz / l);
    };
    let v = 0;
    const set = (i: number, j: number) => {
      const q = (j * nx + i) * 4, w = gn[q + 3];
      if (w > 0) blend(v, gn[q], gn[q + 1], gn[q + 2], w);
      v++;
    };
    for (let j = 0; j < cz; j++)
      for (let i = 0; i < cx; i++) {
        if (subOf[j * cx + i]) continue;
        set(i, j); set(i, j + 1); set(i + 1, j);
        set(i + 1, j); set(i, j + 1); set(i + 1, j + 1);
      }
    const tmp = new Float32Array(4);
    fineAt.forEach(([x, z], n) => {
      tmp[3] = 0;
      lit(x, z, tmp, 0);
      if (tmp[3] > 0) blend(fineFirst + n, tmp[0], tmp[1], tmp[2], tmp[3]);
    });
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
  if (hole.world.water.length) {
    buildWater({ hole, ground, tier: opts.tier ?? "high", sun: opts.sun ?? new THREE.Vector3(-0.4, 0.7, 0.5), reduce: !!opts.reduce, bay: scn.rec.coast?.tones, group, disposables });
  }

  // ---------------------------------------------------------------- trees
  const trees = buildTrees(hole, heightAt, X0, X1, Z0, Z1, disposables, tier.perTree, scn.treeKeep);
  for (const t of trees) group.add(t.mesh);

  // ---------------------------------------------------------------- props (walls, boulders, posts, a bridge, reeds)
  {
    const pr = buildProps3D(hole, ground, opts.tier ?? "high", disposables);
    if (pr) group.add(pr.group);
  }

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
  const targetPole = new THREE.CylinderGeometry(0.02, 0.02, 2.4, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: "#f7f3e8" });
  const targetCloth = new THREE.PlaneGeometry(0.62, 0.4).translate(0.31, 0, 0);
  const targetMat = new THREE.MeshLambertMaterial({ color: "#edbb00", side: THREE.DoubleSide });
  disposables.push(targetPole, poleMat, targetCloth, targetMat);
  const { flag, cloth } = buildPin(hole, ground.y, group, disposables);

  // a flag on each target: gold, so they are not taken for the hole's
  const targetFlags = hole.world.greens.slice(1).map((tg) => {
    const f = new THREE.Group();
    f.position.set(tg.x, ground.y(tg.x, tg.z), tg.z);
    const pole = new THREE.Mesh(targetPole, poleMat);
    pole.position.y = 1.2;
    const cl = new THREE.Mesh(targetCloth, targetMat);
    cl.position.y = 2.2;
    cl.rotation.y = -Math.PI / 2;
    f.add(pole, cl);
    group.add(f);
    return f;
  });

  return {
    group,
    targetFlags,
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
