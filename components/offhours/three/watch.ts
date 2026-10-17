import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { brushedTex, cotesTex, drawnTex, mats, perlageTex } from "./materials";
import { fontFamilies } from "../font";
import type { Model, Part } from "./viewer";

// A 40 mm automatic, in millimetres, Y up, dial facing +Y, 12 o'clock at -Z.
// Turned parts (case, bezel, crystal, caseback) are lathe profiles; flat
// parts (wheels, bridges, hands, rotor) are extruded 2D shapes; the dial is
// a printed texture with applied indices. The model runs its own movement:
// the balance swings at 21,600 vph, the pallet fork rocks, the escape wheel
// steps, the train turns, the hands read your time while there's power, the
// rotor swings and winds. The page drives it through `state`.

export type WatchState = {
  power: number; // 0..1
  crown: number; // degrees turned
  rotorKick: number; // impulse from orbiting
  flip: boolean;
  onBeat?: (beat: number) => void;
  /** orbit motion this frame (radians), fed in by the page */
  impulse?: () => number;
};

const K = 0.14; // movement layout units → mm
const AT = {
  barrel: [-30, -34, 31],
  center: [0, 0, 22],
  third: [30, 18, 14],
  fourth: [8, 42, 13],
  escape: [-18, 54, 9],
  pallet: [-33, 52, 0],
  balance: [-52, 38, 20],
} as const;
const BEAT = 6;
const RESERVE = 75;

const PARTS: Omit<Part, "movers" | "anchor">[] = [
  { id: "caseback", label: "Caseback", note: "Screw-down steel with a sapphire window, so the movement shows." },
  { id: "rotor", label: "Rotor", note: "The oscillating weight. Every swing of your wrist winds the mainspring. Orbit the watch to swing it." },
  { id: "bridges", label: "Bridges", note: "Hold the wheels in place. Côtes de Genève stripes, blued screws, ruby jewel bearings." },
  { id: "balance", label: "Balance + hairspring", note: "The timekeeper. Swings back and forth three times a second; the hairspring sets the rate." },
  { id: "escapement", label: "Escapement", note: "The pallet fork lets the escape wheel advance one tooth per beat and kicks the balance to keep it going." },
  { id: "train", label: "Gear train", note: "Center, third and fourth wheels step the mainspring's power down to the hands." },
  { id: "barrel", label: "Barrel + mainspring", note: "The power. The spring coils tighter as you wind; the ratchet and click stop it slipping back." },
  { id: "plate", label: "Main plate", note: "The movement's foundation, finished with perlage. The winding stem and keyless works sit here." },
  { id: "case", label: "Case + crown", note: "The middle case with lugs and a screw-down crown. The crown winds the barrel through the keyless works." },
  { id: "bracelet", label: "Bracelet", note: "Five-piece links: three small polished centre links between brushed outer links." },
  { id: "dial", label: "Dial", note: "Sunburst, applied batons with lume, a double baton at 12, date at 3." },
  { id: "hour", label: "Hour hand", note: "Rides on the hour wheel, twelve times slower than the minute hand." },
  { id: "minute", label: "Minute hand", note: "Driven by the center wheel, once round an hour." },
  { id: "second", label: "Seconds hand", note: "Moves in six steps a second: the beat of the balance." },
  { id: "bezel", label: "Fluted bezel", note: "Sixty polished V-flutes cut round the bezel, catching light from every angle." },
  { id: "crystal", label: "Crystal", note: "Sapphire with a magnifier over the date, so you can read it at a glance." },
];
export const WATCH_PARTS = PARTS;

// ---------- helpers
const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2); // shape XY (+Y = 12) → dial plane
const at = (x: number, y: number) => new THREE.Vector3(x * K, 0, y * K);

function gearShape(teeth: number, r: number, depth = r * 0.12, windows = 0, inner = 0.3) {
  const s = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a = (k: number) => ((i + k) / teeth) * Math.PI * 2;
    const ri = r - depth;
    const pts: [number, number][] = [
      [Math.cos(a(0)) * ri, Math.sin(a(0)) * ri],
      [Math.cos(a(0.22)) * r, Math.sin(a(0.22)) * r],
      [Math.cos(a(0.48)) * r, Math.sin(a(0.48)) * r],
      [Math.cos(a(0.7)) * ri, Math.sin(a(0.7)) * ri],
    ];
    pts.forEach(([x, y], j) => (i === 0 && j === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  }
  s.closePath();
  for (let k = 0; k < windows; k++) {
    const a0 = (k / windows) * Math.PI * 2 + 0.25, a1 = a0 + (Math.PI * 2) / windows - 0.5;
    const ri = r * inner, ro = r * 0.72;
    const h = new THREE.Path();
    h.moveTo(Math.cos(a0) * ri, Math.sin(a0) * ri);
    h.absarc(0, 0, ro, a0, a1, false);
    h.lineTo(Math.cos(a1) * ri, Math.sin(a1) * ri);
    h.absarc(0, 0, ri, a1, a0, true);
    s.holes.push(h);
  }
  return s;
}
const extrude = (shape: THREE.Shape, depth: number, bevel = 0) =>
  flat(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 }));
const lathe = (pts: [number, number][], seg = 128) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

class Spiral extends THREE.Curve<THREE.Vector3> {
  constructor(private turns: number, private r0: number, private r1: number) {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    const r = this.r0 + (this.r1 - this.r0) * t;
    return target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
}

export function buildWatch(state: WatchState): Model & { setDial: (key: string) => void } {
  const M = mats();
  // scale the procedural textures for millimetres
  const rhodium = new THREE.MeshPhysicalMaterial({ map: cotesTex("#d6dade", 0.07), metalness: 1, roughness: 0.22 });
  rhodium.map!.rotation = 0.5;
  const goldStripe = new THREE.MeshPhysicalMaterial({ map: cotesTex("#d9b366", 0.08), metalness: 1, roughness: 0.28 });
  const perlage = new THREE.MeshPhysicalMaterial({ map: perlageTex("#cfa75a", 0.09), metalness: 1, roughness: 0.38 });
  const brushed = new THREE.MeshPhysicalMaterial({ color: 0xdedede, metalness: 1, roughness: 0.3, roughnessMap: brushedTex(1) });
  const fonts = fontFamilies();

  const root = new THREE.Group();
  const watch = new THREE.Group(); // flips as a whole
  watch.position.y = 4;
  root.add(watch);
  const R: Record<string, THREE.Object3D> = {};
  const group = (id: string, y: number) => {
    const g = new THREE.Group();
    g.position.y = y - 4;
    watch.add(g);
    R[id] = g;
    return g;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos?: THREE.Vector3) => {
    const o = new THREE.Mesh(g, m);
    if (pos) o.position.copy(pos);
    parent.add(o);
    return o;
  };
  const jewel = (parent: THREE.Object3D, p: THREE.Vector3, r = 0.38) => {
    mesh(new THREE.TorusGeometry(r * 1.25, r * 0.35, 8, 24).rotateX(Math.PI / 2), M.gold, parent, p.clone().setY(p.y + 0.05));
    mesh(new THREE.CylinderGeometry(r, r, 0.22, 24), M.ruby, parent, p.clone().setY(p.y + 0.1));
  };
  const screw = (parent: THREE.Object3D, p: THREE.Vector3, r = 0.5, mat: THREE.Material = M.blued) => {
    const s = mesh(new THREE.CylinderGeometry(r, r, 0.3, 24), mat, parent, p.clone().setY(p.y + 0.15));
    mesh(new THREE.BoxGeometry(r * 2, 0.08, r * 0.22), M.black, s, new THREE.Vector3(0, 0.16, 0)).rotation.y = Math.random() * Math.PI;
  };

  // ---------- caseback (y 0..1.2)
  {
    const g = group("caseback", 0);
    mesh(lathe([[10.6, 0.2], [17.8, 0.2], [18.6, 0.6], [18.2, 1.2], [10.6, 1.2], [10.6, 0.2]]), brushed, g);
    mesh(new THREE.CylinderGeometry(10.7, 10.7, 0.7, 96), M.sapphire, g, new THREE.Vector3(0, 0.7, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      screw(g, new THREE.Vector3(Math.cos(a) * 15.2, -0.15, Math.sin(a) * 15.2).setY(0.05), 0.55, M.steel);
    }
    // engraving on the underside
    const ring = drawnTex(1024, (c, s) => {
      c.clearRect(0, 0, s, s);
      c.translate(s / 2, s / 2);
      c.fillStyle = "rgba(40,40,40,0.75)";
      c.font = `600 ${s * 0.032}px ${fonts.mono}`;
      const txt = "RP · AUTOMATIC · 21,600 VPH · SAPPHIRE CASEBACK · 25 JEWELS · ";
      const r = s * 0.4;
      for (let i = 0; i < txt.length; i++) {
        c.save();
        c.rotate((i / txt.length) * Math.PI * 2);
        c.fillText(txt[i], 0, -r);
        c.restore();
      }
    });
    const dec = mesh(new THREE.RingGeometry(11.2, 17.6, 96), new THREE.MeshStandardMaterial({ map: ring, transparent: true, metalness: 0.6, roughness: 0.6 }), g);
    dec.rotation.x = Math.PI / 2;
    dec.position.y = 0.12;
  }

  // ---------- rotor (y 1.5)
  {
    const g = group("rotor", 1.5);
    const sh = new THREE.Shape();
    sh.moveTo(-12.8, 0);
    sh.absarc(0, 0, 12.8, Math.PI, 0, true);
    sh.lineTo(2.4, 0);
    sh.absarc(0, 0, 2.4, 0, Math.PI, false);
    const rotor = new THREE.Group();
    g.add(rotor);
    mesh(extrude(sh, 0.45, 0.08), goldStripe, rotor);
    const w = new THREE.Shape();
    w.moveTo(-12.8, 0);
    w.absarc(0, 0, 12.8, Math.PI, 0, true);
    w.lineTo(10.4, 0);
    w.absarc(0, 0, 10.4, 0, Math.PI, false);
    mesh(extrude(w, 0.9, 0.06), M.darkSteel, rotor, new THREE.Vector3(0, -0.2, 0)); // tungsten mass
    mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.8, 48), M.steel, rotor, new THREE.Vector3(0, 0.2, 0));
    screw(rotor, new THREE.Vector3(0, 0.55, 0), 0.7, M.blued);
    R.rotorSpin = rotor;
  }

  // ---------- bridges (y 2.6)
  {
    const g = group("bridges", 2.6);
    const svgPath = (cmds: (string | number)[]) => {
      // a tiny path builder for the bridge outlines (SVG coordinates)
      const s = new THREE.Shape();
      let i = 0;
      while (i < cmds.length) {
        const c = cmds[i++];
        const n = (k: number) => [Number(cmds[i + k * 2]) * K, -Number(cmds[i + k * 2 + 1]) * K] as const;
        if (c === "M") {
          s.moveTo(...n(0));
          i += 2;
        } else if (c === "L") {
          s.lineTo(...n(0));
          i += 2;
        } else if (c === "C") {
          const [a, b, d] = [n(0), n(1), n(2)];
          s.bezierCurveTo(a[0], a[1], b[0], b[1], d[0], d[1]);
          i += 6;
        }
      }
      s.closePath();
      return s;
    };
    const bridges = [
      ["M", -70, -54, "C", -66, -78, -10, -80, 4, -58, "C", 14, -40, 4, -14, -20, -6, "C", -46, 2, -74, -24, -70, -54],
      ["M", -12, 8, "C", 4, -6, 46, 0, 50, 22, "C", 54, 44, 30, 62, -4, 62, "C", -24, 62, -30, 40, -24, 26, "C", -20, 16, -18, 12, -12, 8],
      ["M", -52, 38, "L", -82, 12, "C", -88, 6, -94, 24, -88, 30, "L", -62, 52],
    ];
    for (const b of bridges) mesh(extrude(svgPath(b), 0.6, 0.12), rhodium, g);
    for (const [x, y, r] of [[AT.barrel[0], AT.barrel[1], 0.5], [AT.third[0], AT.third[1], 0.38], [AT.fourth[0], AT.fourth[1], 0.38], [AT.center[0], AT.center[1], 0.4], [AT.escape[0], AT.escape[1], 0.3], [AT.balance[0], AT.balance[1], 0.32]])
      jewel(g, at(x, y).setY(0.62), r);
    for (const [x, y] of [[-60, -60], [-8, -62], [-30, -12], [40, 8], [22, 56], [-82, 22]]) screw(g, at(x, y).setY(0.6), 0.5);
  }

  // ---------- balance (y 3.4)
  {
    const g = group("balance", 3.4);
    const b = new THREE.Group();
    b.position.copy(at(AT.balance[0], AT.balance[1]));
    g.add(b);
    const wheel = new THREE.Group();
    b.add(wheel);
    const r = AT.balance[2] * K;
    mesh(new THREE.TorusGeometry(r, 0.18, 12, 64).rotateX(Math.PI / 2), M.gold, wheel);
    for (let i = 0; i < 3; i++) {
      const arm = mesh(new THREE.BoxGeometry(0.22, 0.14, r), M.gold, wheel);
      arm.position.set(Math.sin((i * Math.PI * 2) / 3) * (r / 2), 0, Math.cos((i * Math.PI * 2) / 3) * (r / 2));
      arm.rotation.y = (i * Math.PI * 2) / 3;
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      mesh(new THREE.SphereGeometry(0.12, 10, 8), M.gold, wheel, new THREE.Vector3(Math.cos(a) * (r + 0.2), 0, Math.sin(a) * (r + 0.2)));
    }
    mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 12), M.steel, wheel);
    const spring = mesh(new THREE.TubeGeometry(new Spiral(9, 0.3, r * 0.68), 500, 0.025, 4), M.blued, b, new THREE.Vector3(0, 0.2, 0));
    R.balWheel = wheel;
    R.hairspring = spring;
  }

  // ---------- escapement (y 3.0)
  {
    const g = group("escapement", 3.0);
    const ew = new THREE.Group();
    ew.position.copy(at(AT.escape[0], AT.escape[1]));
    g.add(ew);
    const s = new THREE.Shape();
    const n = 20, ro = 1.45, ri = 0.98;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = (rr: number, da: number) => [Math.cos(a + da) * rr, Math.sin(a + da) * rr] as [number, number];
      const pts = [p(ri, 0), p(ro, 0.1), p(ro * 0.96, 0.16), p(ri, 0.2)];
      pts.forEach(([x, y], j) => (i === 0 && j === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
    }
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.75, 0, Math.PI * 2, true);
    s.holes.push(hole);
    mesh(extrude(s, 0.18), M.steel, ew);
    mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 12), M.steel, ew);
    R.escape = ew;
    const pf = new THREE.Group();
    pf.position.copy(at(AT.pallet[0], AT.pallet[1]));
    g.add(pf);
    const fork = new THREE.Shape();
    fork.moveTo(-0.15, 0);
    fork.lineTo(-1.9, 1.3);
    fork.lineTo(-2.1, 1.05);
    fork.lineTo(-0.3, -0.25);
    fork.lineTo(1.4, -0.35);
    fork.lineTo(1.5, 0.2);
    fork.lineTo(1.4, 0.95);
    fork.lineTo(1.2, 0.95);
    fork.closePath();
    mesh(extrude(fork, 0.14), M.steel, pf);
    for (const z of [-0.45, 0.85]) mesh(new THREE.BoxGeometry(0.22, 0.2, 0.32), M.ruby, pf, new THREE.Vector3(1.45, 0.1, -z));
    R.pallet = pf;
  }

  // ---------- train (y 3.9)
  {
    const g = group("train", 3.9);
    for (const [id, teeth] of [["center", 72], ["third", 56], ["fourth", 48]] as const) {
      const p = AT[id];
      const w = new THREE.Group();
      w.position.copy(at(p[0], p[1]));
      g.add(w);
      const r = p[2] * K;
      mesh(extrude(gearShape(teeth, r, r * 0.1, 4, 0.3), 0.2), M.gold, w);
      mesh(extrude(gearShape(8, r * 0.26, r * 0.07), 0.6), M.steel, w, new THREE.Vector3(0, -0.4, 0));
      mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 12), M.steel, w, new THREE.Vector3(0, -0.2, 0));
      R[id] = w;
    }
  }

  // ---------- barrel (y 3.9)
  {
    const g = group("barrel", 3.9);
    const b = new THREE.Group();
    b.position.copy(at(AT.barrel[0], AT.barrel[1]));
    g.add(b);
    const r = AT.barrel[2] * K;
    const drum = new THREE.Group();
    b.add(drum);
    mesh(extrude(gearShape(84, r, 0.32), 0.3), M.gold, drum, new THREE.Vector3(0, -0.6, 0));
    mesh(lathe([[r - 0.5, -0.6], [r - 0.2, -0.6], [r - 0.2, 0.4], [r - 0.5, 0.4], [r - 0.5, -0.6]], 96), M.gold, drum);
    mesh(new THREE.CylinderGeometry(r - 0.45, r - 0.45, 0.12, 96), M.darkSteel, drum, new THREE.Vector3(0, -0.45, 0));
    R.drum = drum;
    const spring = mesh(new THREE.TubeGeometry(new Spiral(5, 1.1, r - 0.6), 600, 0.06, 4), M.steel, b, new THREE.Vector3(0, -0.1, 0));
    spring.scale.y = 6;
    R.mainspring = spring;
    const ratchet = new THREE.Group();
    ratchet.position.y = 0.55;
    b.add(ratchet);
    mesh(extrude(gearShape(28, 1.7, 0.3), 0.35), M.steel, ratchet);
    screw(ratchet, new THREE.Vector3(0, 0.3, 0), 0.45, M.steel);
    R.ratchet = ratchet;
    const click = new THREE.Shape();
    click.moveTo(1.9, -0.8);
    click.lineTo(3.1, -2);
    click.lineTo(3.4, -1.4);
    click.closePath();
    mesh(extrude(click, 0.3), M.steel, b, new THREE.Vector3(0, 0.55, 0));
  }

  // ---------- main plate (y 4.6)
  {
    const g = group("plate", 4.6);
    mesh(new THREE.CylinderGeometry(13.4, 13.4, 0.8, 128), perlage, g);
    for (const p of Object.values(AT)) jewel(g, at(p[0], p[1]).setY(0.4), 0.3);
    mesh(new THREE.CylinderGeometry(0.4, 0.4, 7.5, 16).rotateZ(Math.PI / 2), M.steel, g, new THREE.Vector3(10.5, 0.6, 0));
    const cw = new THREE.Group();
    cw.position.set(8.7, 0.55, 1.9);
    g.add(cw);
    mesh(extrude(gearShape(20, 1.25, 0.25), 0.3), M.steel, cw);
    R.crownwheel = cw;
    const lever = new THREE.Shape();
    lever.moveTo(8.1, -1.4);
    lever.lineTo(11.2, -3.4);
    lever.lineTo(10.6, -4.2);
    lever.lineTo(7.6, -2.2);
    lever.closePath();
    mesh(extrude(lever, 0.3), M.steel, g, new THREE.Vector3(0, 0.45, 0));
  }

  // ---------- case + crown (y 0)
  {
    const g = group("case", 0);
    mesh(
      lathe([[14.6, 0.8], [19.6, 0.8], [20.4, 2], [20.6, 4.5], [20.2, 6.6], [19.2, 7.2], [15.2, 7.2], [15.2, 6.6], [14.6, 6.6], [14.6, 0.8]]),
      M.steel,
      g,
    );
    const lug = new THREE.Shape();
    lug.moveTo(17, 1.2);
    lug.lineTo(23.6, 1.6);
    lug.quadraticCurveTo(24.4, 1.7, 24.3, 2.6);
    lug.quadraticCurveTo(23, 6.4, 18, 6.8);
    lug.lineTo(17, 6.8);
    lug.closePath();
    const lg = new THREE.ExtrudeGeometry(lug, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 3 });
    for (const sz of [-1, 1])
      for (const sx of [-1, 1]) {
        const m = mesh(lg, brushed, g);
        m.rotation.y = sz < 0 ? Math.PI / 2 : -Math.PI / 2;
        m.position.x = sx * 8.6 + (sz < 0 ? -1.2 : 1.2);
        if (sz > 0) m.position.x = sx * 8.6 - 1.2 + 2.4;
      }
    // stem + knurled crown at 3 o'clock
    mesh(new THREE.CylinderGeometry(0.45, 0.45, 4, 16).rotateZ(Math.PI / 2), M.steel, g, new THREE.Vector3(21, 4, 0));
    const crown = new THREE.Group();
    crown.position.set(22.6, 4, 0);
    g.add(crown);
    mesh(new THREE.CylinderGeometry(3, 3, 2.4, 48).rotateZ(Math.PI / 2), M.steel, crown);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const rib = mesh(new THREE.BoxGeometry(2.2, 0.35, 0.3), M.steel, crown, new THREE.Vector3(0, Math.cos(a) * 3, Math.sin(a) * 3));
      rib.rotation.x = a;
    }
    mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 48).rotateZ(Math.PI / 2), M.brushed, crown, new THREE.Vector3(1.25, 0, 0));
    R.crown = crown;
  }

  // ---------- dial (y 5.8): sunburst, applied batons, double baton at 12,
  // date at 3 under a magnifier. Colour is switchable (setDial).
  const DIALS: Record<string, { light: string; dark: string; print: string }> = {
    silver: { light: "#f1efe9", dark: "#d6d3cb", print: "#1a1c1e" },
    blue: { light: "#3a63b8", dark: "#13285c", print: "#f4f4f4" },
    mint: { light: "#b5e6cf", dark: "#7bbf9f", print: "#10261d" },
    black: { light: "#3a3c40", dark: "#0c0d0e", print: "#f4f4f4" },
  };
  let dialKey = "silver";
  const today = new Date().getDate();
  const drawDial = (c: CanvasRenderingContext2D, s: number) => {
    const d = DIALS[dialKey];
    const cx = s / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    // sunburst: light sweeps round the dial as bright and dark sectors
    const sun = c.createConicGradient(0.5, cx, cx);
    for (let i = 0; i <= 8; i++) sun.addColorStop(i / 8, i % 2 ? d.dark : d.light);
    c.fillStyle = sun;
    c.fillRect(0, 0, s, s);
    const vig = c.createRadialGradient(cx, cx, s * 0.05, cx, cx, s * 0.5);
    vig.addColorStop(0, "rgba(255,255,255,0.18)");
    vig.addColorStop(0.75, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.22)");
    c.fillStyle = vig;
    c.fillRect(0, 0, s, s);
    c.translate(cx, cx);
    c.fillStyle = d.print;
    for (let i = 0; i < 60; i++) {
      c.save();
      c.rotate((i / 60) * Math.PI * 2);
      c.fillRect(-1.2, -s * 0.478, 2.4, i % 5 ? s * 0.016 : s * 0.026);
      c.restore();
    }
    c.textAlign = "center";
    c.font = `800 ${s * 0.042}px ${fonts.display}`;
    c.fillText("RP", 0, -s * 0.17);
    c.font = `${s * 0.019}px ${fonts.mono}`;
    c.fillText("AUTOMATIC", 0, -s * 0.13);
    c.fillText("DATE", 0, s * 0.2);
    c.fillStyle = "#ffffff";
    c.fillRect(s * 0.3, -s * 0.034, s * 0.1, s * 0.068);
    c.fillStyle = "#111111";
    c.font = `700 ${s * 0.052}px ${fonts.display}`;
    c.fillText(String(today), s * 0.35, s * 0.019);
  };
  const dialTex = drawnTex(1024, drawDial);
  {
    const g = group("dial", 5.8);
    mesh(new THREE.CylinderGeometry(15, 15, 0.3, 128), M.darkSteel, g);
    const faceMat = new THREE.MeshPhysicalMaterial({ map: dialTex, roughness: 0.32, metalness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.12 });
    const face = mesh(new THREE.CircleGeometry(15, 128), faceMat, g);
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.22;
    const baton = (a: number, dx = 0) => {
      const idx = new THREE.Group();
      idx.position.set(Math.sin(a) * 11.4 + Math.cos(a) * dx, 0.3, -Math.cos(a) * 11.4 + Math.sin(a) * dx);
      idx.rotation.y = -a;
      g.add(idx);
      mesh(new RoundedBoxGeometry(1.0, 0.45, 3.0, 2, 0.12), M.steel, idx);
      mesh(new THREE.BoxGeometry(0.38, 0.06, 2.3), M.lume, idx, new THREE.Vector3(0, 0.25, 0));
    };
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (i === 3) continue; // the date sits at 3
      if (i === 0) {
        baton(a, -0.75);
        baton(a, 0.75);
      } else baton(a);
    }
  }

  // ---------- hands
  const hand = (id: string, y: number, len: number, wid: number, mat: THREE.Material, lume = true) => {
    const g = group(id, y);
    const pivot = new THREE.Group();
    g.add(pivot);
    const s = new THREE.Shape();
    s.moveTo(0, len);
    s.lineTo(wid, len * 0.12);
    s.lineTo(0, -len * 0.14);
    s.lineTo(-wid, len * 0.12);
    s.closePath();
    mesh(extrude(s, 0.12, 0.05), mat, pivot);
    if (lume) {
      const l = new THREE.Shape();
      l.moveTo(0, len * 0.9);
      l.lineTo(wid * 0.35, len * 0.25);
      l.lineTo(-wid * 0.35, len * 0.25);
      l.closePath();
      mesh(extrude(l, 0.05), M.lume, pivot, new THREE.Vector3(0, 0.15, 0));
    }
    mesh(new THREE.CylinderGeometry(wid * 0.9, wid * 0.9, 0.2, 24), mat, pivot, new THREE.Vector3(0, 0.06, 0));
    R[`${id}Pivot`] = pivot;
  };
  hand("hour", 6.2, 8, 0.75, M.steel);
  hand("minute", 6.5, 12.5, 0.6, M.steel);
  {
    const g = group("second", 6.8);
    const pivot = new THREE.Group();
    g.add(pivot);
    const green = M.steel; // polished, like the other hands
    mesh(new THREE.BoxGeometry(0.16, 0.08, 16.5), green, pivot, new THREE.Vector3(0, 0, -5));
    mesh(new THREE.TorusGeometry(0.5, 0.13, 8, 24).rotateX(Math.PI / 2), green, pivot, new THREE.Vector3(0, 0, -9.6));
    mesh(new THREE.BoxGeometry(0.6, 0.1, 2.4), green, pivot, new THREE.Vector3(0, 0, 2.2));
    mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 24), green, pivot);
    R.secondPivot = pivot;
  }

  // ---------- fluted bezel, crystal with a date magnifier
  {
    const g = group("bezel", 0);
    const prof: [number, number][] = [[15.4, 7.1], [19.6, 7.1], [19.95, 7.5]];
    for (let i = 1; i < 10; i++) {
      const f = i / 10;
      prof.push([19.95 - f * 1.85, 7.5 + f * 1.1]);
    }
    prof.push([18.1, 8.6], [15.8, 8.7], [15.4, 8.4], [15.4, 7.1]);
    const bg = lathe(prof, 720);
    // flutes: a crisp V ridge every 6 degrees, cut into the sloped face
    const N = 60;
    const pos = bg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 18.15 || r > 19.9 || y < 7.45) continue;
      const th = Math.atan2(z, x);
      const tri = Math.abs(((((th / (Math.PI * 2)) * N) % 1) + 1) % 1 - 0.5) * 2; // 0 ridge, 1 groove
      const depth = 0.38 * (1 - tri) - 0.19;
      pos.setY(i, y + depth);
      const k = (r - depth * 0.6) / r;
      pos.setX(i, x * k);
      pos.setZ(i, z * k);
    }
    bg.computeVertexNormals();
    mesh(bg, M.steel, g);
    const c = group("crystal", 0);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 24; i++) {
      const f = i / 24;
      pts.push([f * 15.5, 8.9 - f * f * 1.0]);
    }
    pts.push([15.5, 7.6], [0, 7.6]);
    mesh(lathe(pts, 96), M.sapphire, c);
    // the magnifier over the date
    const lens = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0, transmission: 1, thickness: 2.2, ior: 1.52, specularIntensity: 0.5, transparent: true });
    mesh(new RoundedBoxGeometry(6.2, 1.3, 4.6, 5, 0.62), lens, c, new THREE.Vector3(10.5, 8.95, 0));
  }

  // ---------- bracelet: five-piece links, polished centres, brushed outers
  {
    const g = group("bracelet", 0);
    const outer: THREE.Matrix4[] = [];
    const inner: THREE.Matrix4[] = [];
    const rows = 18, R = 21, step = 0.15;
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
    for (const side of [-1, 1]) {
      const cz = side * 23.6, cy = 3.2 - R;
      for (let k = 0; k < rows; k++) {
        const ph = k * step + 0.04;
        const y = cy + R * Math.cos(ph), z = cz + side * R * Math.sin(ph);
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), side * ph);
        const W = 19.6 - (4 * k) / rows;
        if (k === 0) {
          outer.push(new THREE.Matrix4().compose(p3.set(0, y, z), q, sc.set(W, 1, 1)));
          continue;
        }
        for (const sx of [-1, 1]) outer.push(new THREE.Matrix4().compose(p3.set(sx * (W / 2 - W * 0.14), y, z), q, sc.set(W * 0.27, 1, 1)));
        for (const ix of [-1, 0, 1]) inner.push(new THREE.Matrix4().compose(p3.set(ix * W * 0.15, y + 0.15, z + (ix ? side * 0.4 : 0)), q, sc.set(W * 0.12, 1, 0.8)));
      }
    }
    const link = new RoundedBoxGeometry(1, 2.3, 3.0, 3, 0.45);
    const io = new THREE.InstancedMesh(link, brushed, outer.length);
    outer.forEach((mm, i) => io.setMatrixAt(i, mm));
    const ii = new THREE.InstancedMesh(link, M.steel, inner.length);
    inner.forEach((mm, i) => ii.setMatrixAt(i, mm));
    g.add(io, ii);
  }

  // ---------- parts, explode vectors, label anchors
  // Exploded, the parts stack by their real thickness with an even gap, the
  // whole column centred on where the assembled watch sits.
  const THICK: Record<string, number> = {
    caseback: 1.2, rotor: 1.1, bridges: 1.0, balance: 0.8, escapement: 0.6, train: 1.2, barrel: 1.6, plate: 1.0,
    case: 7.2, bracelet: 0, dial: 0.6, hour: 0.4, minute: 0.4, second: 0.4, bezel: 1.4, crystal: 1.4,
  };
  const GAP = 3.6;
  let cum = 0;
  const target = PARTS.map((p) => {
    if (p.id === "bracelet") return cum - THICK.case - GAP; // travels with the case
    const y = cum;
    cum += THICK[p.id] + GAP;
    return y;
  });
  const home = PARTS.map((p) => R[p.id].position.y);
  const shift = target.reduce((a, b) => a + b, 0) / target.length - home.reduce((a, b) => a + b, 0) / home.length;
  const parts: Part[] = PARTS.map((p, i) => {
    const anchor = new THREE.Object3D();
    const g = R[p.id];
    const rad = p.id === "bracelet" ? 10 : p.id === "case" ? 20.5 : p.id === "bezel" ? 19.5 : p.id === "crystal" ? 14 : p.id === "caseback" ? 17.5 : ["hour", "minute", "second"].includes(p.id) ? 4 : 12;
    if (p.id === "bracelet") anchor.position.set(rad, -1, 34);
    else anchor.position.set(rad, 0.5, 0);
    g.add(anchor);
    // the bracelet slides out of the way at the end, clear of the movement
    const late = p.id === "bracelet" ? new THREE.Vector3(-52, 0, 0) : undefined;
    return { ...p, movers: [{ obj: g, dir: new THREE.Vector3(0, target[i] - shift - home[i], 0), late }], anchor };
  });

  // ---------- the movement, running
  let wt = (() => {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  })();
  let amp = 0;
  let barrel = 0;
  let rotor = 0.6;
  let rotorV = 0;
  let lastBeat = -1;
  let springPower = -1;
  let flipA = 0;

  const update = (dt: number) => {
    const s = state;
    const running = s.power > 0;
    if (running) {
      wt += dt;
      s.power = Math.max(0, s.power - dt / RESERVE);
      barrel += dt * 0.06;
    }
    rotorV += s.rotorKick + (s.impulse?.() ?? 0) * 8;
    s.rotorKick = 0;
    rotorV += -Math.sin(rotor) * 3.2 * dt;
    rotorV *= 1 - 0.9 * dt;
    rotor += rotorV * dt;
    if (Math.abs(rotorV) > 0.2) s.power = Math.min(1, s.power + Math.abs(rotorV) * dt * 0.006);
    amp += ((running ? 0.45 + 0.55 * Math.sqrt(s.power) : 0) - amp) * Math.min(1, dt * (running ? 3 : 1.2));
    const bal = Math.sin(wt * Math.PI * BEAT) * amp * 4.3;
    const beat = Math.floor(wt * BEAT);
    if (running && beat !== lastBeat) {
      lastBeat = beat;
      s.onBeat?.(beat);
    }
    const sec = (beat / BEAT) % 60;
    const min = (wt / 60) % 60;
    const hr = (wt / 3600) % 12;
    const deg = Math.PI / 180;
    R.secondPivot.rotation.y = -sec * 6 * deg;
    R.minutePivot.rotation.y = -min * 6 * deg;
    R.hourPivot.rotation.y = -hr * 30 * deg;
    R.balWheel.rotation.y = bal;
    R.hairspring.rotation.y = bal * 0.22;
    R.escape.rotation.y = beat * 18 * deg;
    R.pallet.rotation.y = running ? (beat % 2 ? 0.16 : -0.16) * Math.min(1, amp * 2) : 0;
    R.fourth.rotation.y = -sec * 6 * deg;
    R.third.rotation.y = min * 40 * deg;
    R.center.rotation.y = -min * 6 * deg;
    R.drum.rotation.y = barrel;
    R.ratchet.rotation.y = -s.crown * 0.5 * deg;
    R.crownwheel.rotation.y = s.crown * 0.9 * deg;
    R.crown.rotation.x = s.crown * deg;
    R.rotorSpin.rotation.y = rotor;
    // the mainspring coils tighter as it's wound
    if (Math.abs(s.power - springPower) > 0.03) {
      springPower = s.power;
      const m = R.mainspring as THREE.Mesh;
      m.geometry.dispose();
      const r = AT.barrel[2] * K;
      m.geometry = new THREE.TubeGeometry(new Spiral(3.5 + s.power * 6, 0.9 + s.power * 0.5, r - 0.6 - s.power * 0.3), 600, 0.05, 4);
    }
    flipA += ((s.flip ? Math.PI : 0) - flipA) * Math.min(1, dt * 5);
    watch.rotation.z = flipA;
  };

  return {
    root,
    parts,
    view: { position: [0, 66, 106], target: [0, 5, 0], fov: 30, near: 4, far: 1500, minDistance: 45, maxDistance: 300 },
    background: "#f2ead7",
    floorY: -46,
    explodeZoom: 1.9,
    shadowSize: 60,
    update,
    setDial: (key: string) => {
      if (!DIALS[key]) return;
      dialKey = key;
      const cv = dialTex.image as HTMLCanvasElement;
      drawDial(cv.getContext("2d")!, cv.width);
      dialTex.needsUpdate = true;
    },
  };
}
