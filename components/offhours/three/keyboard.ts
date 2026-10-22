import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { brushedTex, drawnTex, foamTex } from "./materials";
import { fontFamilies } from "../font";
import type { Model, Part } from "./viewer";

// The 65% board in key units (1 U = 19.05 mm), Y up, rows running toward
// the viewer (+Z). Sculpted, dished PBT caps with legends; switches in four
// instanced pieces (nylon bottom, steel spring, POM stem, polycarbonate top);
// brass plate with switch and stab cutouts and flex cuts; foams; a PCB with
// a printed top (pads, traces, silkscreen), LEDs, MCU and USB-C, sockets and
// diodes underneath; anodised case and a brass weight. The page drives key
// presses and the underglow through `state`.

export type KeyboardState = { down: Set<string>; glow: boolean; onPick?: (code: string, down: boolean) => void };

type Key = { code: string; label: string; u?: number; tone?: "alpha" | "mod" | "accent" };
const ROWS: Key[][] = [
  [
    { code: "Escape", label: "esc", tone: "accent" },
    ..."1234567890".split("").map((c) => ({ code: `Digit${c}`, label: c })),
    { code: "Minus", label: "-" },
    { code: "Equal", label: "=" },
    { code: "Backspace", label: "⌫", u: 2, tone: "mod" },
    { code: "Backquote", label: "`", tone: "mod" },
  ],
  [
    { code: "Tab", label: "tab", u: 1.5, tone: "mod" },
    ..."QWERTYUIOP".split("").map((c) => ({ code: `Key${c}`, label: c })),
    { code: "BracketLeft", label: "[" },
    { code: "BracketRight", label: "]" },
    { code: "Backslash", label: "\\", u: 1.5 },
    { code: "Delete", label: "del", tone: "mod" },
  ],
  [
    { code: "CapsLock", label: "caps", u: 1.75, tone: "mod" },
    ..."ASDFGHJKL".split("").map((c) => ({ code: `Key${c}`, label: c })),
    { code: "Semicolon", label: ";" },
    { code: "Quote", label: "'" },
    { code: "Enter", label: "enter", u: 2.25, tone: "accent" },
    { code: "PageUp", label: "pgup", tone: "mod" },
  ],
  [
    { code: "ShiftLeft", label: "shift", u: 2.25, tone: "mod" },
    ..."ZXCVBNM".split("").map((c) => ({ code: `Key${c}`, label: c })),
    { code: "Comma", label: "," },
    { code: "Period", label: "." },
    { code: "Slash", label: "/" },
    { code: "ShiftRight", label: "shift", u: 1.75, tone: "mod" },
    { code: "ArrowUp", label: "↑", tone: "mod" },
    { code: "PageDown", label: "pgdn", tone: "mod" },
  ],
  [
    { code: "ControlLeft", label: "ctrl", u: 1.25, tone: "mod" },
    { code: "MetaLeft", label: "⌘", u: 1.25, tone: "mod" },
    { code: "AltLeft", label: "alt", u: 1.25, tone: "mod" },
    { code: "Space", label: "", u: 6.25 },
    { code: "AltRight", label: "alt", tone: "mod" },
    { code: "Fn", label: "fn", tone: "mod" },
    { code: "ControlRight", label: "ctrl", tone: "mod" },
    { code: "ArrowLeft", label: "←", tone: "mod" },
    { code: "ArrowDown", label: "↓", tone: "mod" },
    { code: "ArrowRight", label: "→", tone: "mod" },
  ],
];
export const KEYS = ROWS.flatMap((row, y) => {
  let x = 0;
  return row.map((k) => {
    const w = k.u ?? 1;
    const out = { ...k, w, cx: x + w / 2 - 8, cz: y + 0.5 - 2.5 };
    x += w;
    return out;
  });
});
const STABBED = KEYS.filter((k) => k.w >= 2);

const PARTS: Omit<Part, "movers" | "anchor">[] = [
  { id: "weight", label: "Brass weight", note: "A slab of brass in the bottom of the case: heft, and a deeper sound." },
  { id: "case", label: "Aluminium case", note: "CNC-milled, anodised. Everything else floats inside it on gaskets." },
  { id: "casefoam", label: "Case foam", note: "Poron between the PCB and the case. Kills the hollow ping." },
  { id: "pcb", label: "Hot-swap PCB", note: "Sockets underneath so switches pull out without soldering, a diode and LED per key, the MCU running QMK, USB-C." },
  { id: "platefoam", label: "Plate foam", note: "Thin foam between plate and PCB. Tightens up the bottom-out." },
  { id: "plate", label: "Brass plate", note: "Holds the switches. The flex cuts let it give a little under your fingers." },
  { id: "gaskets", label: "Gasket strips", note: "Rubber tabs the plate sits on. Gasket mount: soft, even, no hard metal-on-metal." },
  { id: "stabs", label: "Stabilisers", note: "Keep the long keys level. Clipped, lubed and band-aid modded so they don't rattle." },
  { id: "bottoms", label: "Switch bottoms", note: "Nylon bottom housings. Nylon is the deeper, rounder sounding half." },
  { id: "springs", label: "Springs", note: "62 g, slow-curve. Lubed so they don't ping." },
  { id: "stems", label: "Stems", note: "POM stems: smooth, self-lubricating, and the cross mount the keycap sits on." },
  { id: "tops", label: "Switch tops", note: "Polycarbonate top housings, clear so the per-key LEDs shine through." },
  { id: "caps", label: "PBT keycaps", note: "Thick PBT, doubleshot legends, sculpted rows with a dished top. Cream, ink, racing green." },
];
export const KEYBOARD_PARTS = PARTS;

const TONES = {
  alpha: { cap: "#efe6d2", text: "#14161a" },
  mod: { cap: "#2f3033", text: "#e9e4da" },
  accent: { cap: "#1d5e3f", text: "#f2ead7" },
};

// a sculpted keycap: tapered sides, rounded corners, a cylindrical dish
function keycapGeo(w: number) {
  const W = w - 0.06, D = 0.94, H = 0.42, r = 0.08;
  const s = new THREE.Shape();
  s.moveTo(-W / 2 + r, -D / 2);
  s.lineTo(W / 2 - r, -D / 2);
  s.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + r);
  s.lineTo(W / 2, D / 2 - r);
  s.quadraticCurveTo(W / 2, D / 2, W / 2 - r, D / 2);
  s.lineTo(-W / 2 + r, D / 2);
  s.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - r);
  s.lineTo(-W / 2, -D / 2 + r);
  s.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + r, -D / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 6, steps: 3 });
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = Math.max(0, Math.min(1, z / H));
    x *= 1 - (f * 0.18) / W;
    y *= 1 - f * 0.2;
    if (z >= H - 1e-4) z -= 0.045 * Math.max(0, 1 - (y / (D * 0.4)) ** 2); // dish
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2); // extrude → +Y, shape +Y → -Z
  return g;
}

class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private h: number, private turns: number) {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
  }
}

export function buildKeyboard(state: KeyboardState): Model {
  const fonts = fontFamilies();
  const P = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
  const M = {
    anodised: P({ color: 0xc4c8cc, metalness: 0.9, roughness: 0.38, roughnessMap: brushedTex(2) }),
    brass: P({ color: 0xd4ad5c, metalness: 1, roughness: 0.3, roughnessMap: brushedTex(3) }),
    brassPolished: P({ color: 0xdcb666, metalness: 1, roughness: 0.16 }),
    nylon: P({ color: 0x2a2b2f, roughness: 0.62 }),
    pc: P({ color: 0xffffff, roughness: 0.08, transmission: 0.92, thickness: 0.2, ior: 1.58, transparent: true }),
    pom: P({ color: 0xd8333b, roughness: 0.42, clearcoat: 0.3 }),
    spring: P({ color: 0xd9dde2, metalness: 1, roughness: 0.25 }),
    caseFoam: P({ map: foamTex("#5f6366", 6), roughness: 1 }),
    plateFoam: P({ map: foamTex("#ece8de", 6), roughness: 1 }),
    poron: P({ color: 0xc8333a, roughness: 0.9 }),
    black: P({ color: 0x151515, roughness: 0.5 }),
    steel: P({ color: 0xd6d9dc, metalness: 1, roughness: 0.2 }),
  };
  const root = new THREE.Group();
  const R: Record<string, THREE.Group> = {};
  const group = (id: string, y: number) => {
    const g = new THREE.Group();
    g.position.y = y;
    root.add(g);
    R[id] = g;
    return g;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const rrect = (w: number, d: number, r: number, cx = 0, cz = 0) => {
    const s = new THREE.Shape();
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = -cz - d / 2, y1 = -cz + d / 2;
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0);
    s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - r);
    s.quadraticCurveTo(x1, y1, x1 - r, y1);
    s.lineTo(x0 + r, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
    return s;
  };
  const holePath = (w: number, d: number, cx: number, cz: number) => {
    const h = new THREE.Path();
    h.moveTo(cx - w / 2, -cz - d / 2);
    h.lineTo(cx - w / 2, -cz + d / 2);
    h.lineTo(cx + w / 2, -cz + d / 2);
    h.lineTo(cx + w / 2, -cz - d / 2);
    h.closePath();
    return h;
  };
  const slab = (shape: THREE.Shape, depth: number, bevel = 0) =>
    new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 }).rotateX(-Math.PI / 2);
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, place: (k: (typeof KEYS)[number], m: THREE.Matrix4) => void) => {
    const im = new THREE.InstancedMesh(geo, mat, KEYS.length);
    const m4 = new THREE.Matrix4();
    KEYS.forEach((k, i) => {
      place(k, m4);
      im.setMatrixAt(i, m4);
    });
    parent.add(im);
    return im;
  };

  // ---------- weight + case
  {
    const g = group("weight", 0.05);
    mesh(new RoundedBoxGeometry(9, 0.12, 2.4, 2, 0.04), M.brassPolished, g, 0, 0, 0.4);
    const tex = drawnTex(512, (c, s) => {
      c.clearRect(0, 0, s, s);
      c.fillStyle = "rgba(90,66,24,0.85)";
      c.font = `600 ${s * 0.12}px ${fonts.mono}`;
      c.textAlign = "center";
      c.fillText("RP65 · 2026", s / 2, s / 2 + s * 0.04);
    });
    const plate = mesh(new THREE.PlaneGeometry(4.5, 4.5), new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: 0.8, roughness: 0.4 }), g, 0, 0.065, 0.4);
    plate.rotation.x = -Math.PI / 2;
  }
  {
    const g = group("case", 0);
    const outer = rrect(16.9, 5.9, 0.4);
    const walls = rrect(16.9, 5.9, 0.4);
    walls.holes.push(rrect(16.25, 5.25, 0.18) as unknown as THREE.Path);
    mesh(slab(outer, 0.14, 0.04), M.anodised, g);
    mesh(slab(walls, 1.0, 0.06), M.anodised, g);
    mesh(new THREE.BoxGeometry(0.5, 0.18, 0.12), M.black, g, 6.2, 0.55, -2.95); // USB-C cutout
  }
  // ---------- foams
  {
    const g = group("casefoam", 0.24);
    mesh(new THREE.BoxGeometry(16.1, 0.08, 5.1), M.caseFoam, g);
  }
  // ---------- PCB
  {
    const g = group("pcb", 0.36);
    const S = 2048;
    const tex = drawnTex(S, (c) => {
      const kx = S / 16, kz = kx; // 128 px per U; texture is 16 x 16 U, we use the top 5 U
      c.fillStyle = "#145534";
      c.fillRect(0, 0, S, S);
      c.strokeStyle = "#1f7346";
      c.lineWidth = 3;
      KEYS.forEach((k, i) => {
        const x = (k.cx + 8) * kx, y = (k.cz + 2.5) * kz;
        c.beginPath();
        c.moveTo(x + 18, y + 30);
        c.lineTo(x + 18 + 30 + (i % 3) * 8, y + 30);
        c.lineTo(x + 48 + (i % 3) * 8, y + 64);
        c.stroke();
      });
      KEYS.forEach((k) => {
        const x = (k.cx + 8) * kx, y = (k.cz + 2.5) * kz;
        c.strokeStyle = "rgba(230,240,232,0.75)";
        c.lineWidth = 2;
        c.strokeRect(x - 0.38 * kx, y - 0.38 * kz, 0.76 * kx, 0.76 * kz);
        c.fillStyle = "#d8b25c";
        for (const [dx, dy, r] of [[0, 0, 14], [-0.3, -0.17, 7], [0.3, -0.17, 7], [-0.2, 0.25, 6], [0.2, 0.25, 6]] as const) {
          c.beginPath();
          c.arc(x + dx * kx, y + dy * kz, r, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = "#0e3a23";
        c.beginPath();
        c.arc(x, y, 7, 0, Math.PI * 2);
        c.fill();
      });
      c.fillStyle = "rgba(230,240,232,0.8)";
      c.font = `600 ${kx * 0.16}px ${fonts.mono}`;
      c.fillText("RP65 · REV B · HOT-SWAP · QMK/VIA · 2026", 0.3 * kx, 4.9 * kz);
    });
    tex.repeat.set(1, 5 / 16);
    tex.offset.set(0, 1 - 5 / 16);
    const edge = new THREE.MeshPhysicalMaterial({ color: 0x0f3f26, roughness: 0.5 });
    const top = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.45, clearcoat: 0.6 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(16, 0.06, 5), [edge, edge, top, edge, edge, edge]);
    g.add(board);
    // LEDs (top), sockets + diodes (underneath)
    const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.3 });
    const leds = instanced(new THREE.BoxGeometry(0.12, 0.04, 0.08), ledMat, g, (k, m) => m.makeTranslation(k.cx, 0.05, k.cz - 0.3));
    leds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(KEYS.length * 3).fill(1), 3);
    R.leds = leds as unknown as THREE.Group;
    const sock = mergeGeometries([new THREE.BoxGeometry(0.56, 0.12, 0.2).translate(0, 0, 0.12), new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12).translate(-0.24, 0, 0.12), new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12).translate(0.24, 0, 0.12)]);
    instanced(sock, M.black, g, (k, m) => m.makeTranslation(k.cx, -0.09, k.cz));
    instanced(new THREE.BoxGeometry(0.16, 0.05, 0.07), M.black, g, (k, m) => m.makeTranslation(k.cx + 0.28, -0.06, k.cz + 0.32));
    // MCU, crystal, USB-C
    mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), M.black, g, 6.2, 0.06, -2.1);
    for (let i = 0; i < 9; i++)
      for (const [dx, dz, rx] of [[-0.24, -0.16 + i * 0.04, 0], [0.24, -0.16 + i * 0.04, 0], [-0.16 + i * 0.04, -0.24, 1], [-0.16 + i * 0.04, 0.24, 1]] as const)
        mesh(new THREE.BoxGeometry(rx ? 0.015 : 0.06, 0.02, rx ? 0.06 : 0.015), M.steel, g, 6.2 + dx, 0.04, -2.1 + dz);
    mesh(new THREE.BoxGeometry(0.16, 0.06, 0.08), M.steel, g, 5.8, 0.06, -2.1);
    mesh(new RoundedBoxGeometry(0.46, 0.17, 0.36, 2, 0.06), M.steel, g, 6.2, 0.12, -2.38);
  }
  {
    const g = group("platefoam", 0.46);
    const sh = rrect(16, 5, 0.05);
    KEYS.forEach((k) => sh.holes.push(holePath(0.76, 0.76, k.cx, k.cz)));
    mesh(slab(sh, 0.05), M.plateFoam, g);
  }
  // ---------- switches: bottoms
  {
    const g = group("bottoms", 0.5);
    instanced(new RoundedBoxGeometry(0.62, 0.2, 0.62, 2, 0.04), M.nylon, g, (k, m) => m.makeTranslation(k.cx, 0.1, k.cz));
  }
  // ---------- plate
  {
    const g = group("plate", 0.62);
    const sh = rrect(16, 5, 0.05);
    KEYS.forEach((k) => sh.holes.push(holePath(0.73, 0.73, k.cx, k.cz)));
    STABBED.forEach((k) => [-1, 1].forEach((sd) => sh.holes.push(holePath(0.18, 0.62, k.cx + sd * k.w * 0.36, k.cz + 0.02))));
    for (let r = 1; r < 5; r++) sh.holes.push(holePath(9 - r, 0.035, -1.2 + (r % 2) * 1.4, r - 2.5));
    mesh(slab(sh, 0.06, 0.008), M.brass, g);
  }
  // ---------- gaskets
  {
    const g = group("gaskets", 0.6);
    const strips: [number, number, number, number][] = [
      [-5.4, -2.58, 1.2, 0.22], [0, -2.58, 1.2, 0.22], [5.4, -2.58, 1.2, 0.22],
      [-5.4, 2.58, 1.2, 0.22], [0, 2.58, 1.2, 0.22], [5.4, 2.58, 1.2, 0.22],
      [-8.08, -1, 0.22, 1.1], [-8.08, 1, 0.22, 1.1], [8.08, -1, 0.22, 1.1], [8.08, 1, 0.22, 1.1],
    ];
    strips.forEach(([x, z, w, d]) => mesh(new RoundedBoxGeometry(w, 0.1, d, 2, 0.03), M.poron, g, x, 0, z));
  }
  // ---------- stabilisers
  {
    const g = group("stabs", 0.7);
    STABBED.forEach((k) => {
      const dx = k.w * 0.36;
      [-1, 1].forEach((sd) => {
        mesh(new RoundedBoxGeometry(0.22, 0.28, 0.5, 2, 0.04), M.black, g, k.cx + sd * dx, 0.14, k.cz);
        mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), M.pom, g, k.cx + sd * dx, 0.3, k.cz - 0.05);
      });
      const wire = new THREE.CatmullRomCurve3([
        new THREE.Vector3(k.cx - dx, 0.05, k.cz + 0.1),
        new THREE.Vector3(k.cx - dx, 0.04, k.cz + 0.3),
        new THREE.Vector3(k.cx + dx, 0.04, k.cz + 0.3),
        new THREE.Vector3(k.cx + dx, 0.05, k.cz + 0.1),
      ]);
      mesh(new THREE.TubeGeometry(wire, 32, 0.02, 6), M.steel, g);
    });
  }
  // ---------- springs, stems, tops
  {
    const g = group("springs", 0.74);
    instanced(new THREE.TubeGeometry(new Helix(0.11, 0.32, 7), 140, 0.012, 5), M.spring, g, (k, m) => m.makeTranslation(k.cx, 0, k.cz));
    R.springsIM = g.children[0] as unknown as THREE.Group;
  }
  {
    const g = group("stems", 0.86);
    const stem = mergeGeometries([
      new THREE.BoxGeometry(0.3, 0.2, 0.2),
      new THREE.BoxGeometry(0.22, 0.16, 0.06).translate(0, 0.18, 0),
      new THREE.BoxGeometry(0.06, 0.16, 0.22).translate(0, 0.18, 0),
    ]);
    instanced(stem, M.pom, g, (k, m) => m.makeTranslation(k.cx, 0, k.cz));
    R.stemsIM = g.children[0] as unknown as THREE.Group;
  }
  {
    const g = group("tops", 0.82);
    instanced(new RoundedBoxGeometry(0.66, 0.24, 0.66, 2, 0.06), M.pc, g, (k, m) => m.makeTranslation(k.cx, 0, k.cz));
  }
  // ---------- keycaps with legends (one atlas texture)
  const capGroups: Record<string, THREE.Group> = {};
  {
    const g = group("caps", 1.0);
    const cols = 9, cell = 112;
    const atlas = drawnTex(1024, (c) => {
      c.clearRect(0, 0, 1024, 1024);
      KEYS.forEach((k, i) => {
        const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
        c.fillStyle = TONES[k.tone ?? "alpha"].text;
        c.font = `600 ${k.label.length > 1 ? 34 : 56}px ${fonts.mono}`;
        c.textBaseline = "top";
        c.fillText(k.label.toUpperCase(), x + 10, y + 10);
      });
    });
    const legendMat = new THREE.MeshStandardMaterial({ map: atlas, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const capMats = {
      alpha: P({ color: TONES.alpha.cap, roughness: 0.62, sheen: 0.3 }),
      mod: P({ color: TONES.mod.cap, roughness: 0.62, sheen: 0.3 }),
      accent: P({ color: TONES.accent.cap, roughness: 0.6, sheen: 0.3 }),
    };
    const geos: Record<number, THREE.BufferGeometry> = {};
    KEYS.forEach((k, i) => {
      geos[k.w] ??= keycapGeo(k.w);
      const kg = new THREE.Group();
      kg.position.set(k.cx, 0, k.cz);
      kg.userData.code = k.code;
      g.add(kg);
      const cap = mesh(geos[k.w], capMats[k.tone ?? "alpha"], kg);
      cap.userData.code = k.code;
      if (k.label) {
        const pl = new THREE.PlaneGeometry(0.34, 0.34);
        const u0 = ((i % cols) * cell) / 1024, v0 = 1 - ((Math.floor(i / cols) + 1) * cell) / 1024, du = cell / 1024;
        pl.setAttribute("uv", new THREE.Float32BufferAttribute([u0, v0 + du, u0 + du, v0 + du, u0, v0, u0 + du, v0], 2));
        const leg = mesh(pl, legendMat, kg, -(k.w - 0.06) / 2 + 0.3, 0.452, -0.18);
        leg.rotation.x = -Math.PI / 2;
      }
      capGroups[k.code] = kg;
    });
  }

  // ---------- parts: stack by thickness for the explode
  // The four switch pieces travel as one switch (keeping their assembled
  // spacing) and only come apart near the end: on the way back, they snap
  // together first, then the layers close up.
  const SWITCH = ["bottoms", "springs", "stems", "tops"];
  const THICK: Record<string, number> = { weight: 0.15, case: 1.1, casefoam: 0.1, pcb: 0.25, platefoam: 0.06, plate: 0.08, gaskets: 0.1, stabs: 0.35, switch: 0.6, caps: 0.45 };
  const SPREAD: Record<string, number> = { bottoms: -0.75, springs: -0.15, stems: 0.45, tops: 1.05 };
  const GAP = 0.6;
  const slots = PARTS.map((p) => (SWITCH.includes(p.id) ? "switch" : p.id)).filter((id, i, a) => a.indexOf(id) === i);
  let cum = 0;
  const slotY: Record<string, number> = {};
  for (const id of slots) {
    slotY[id] = cum;
    cum += THICK[id] + GAP;
  }
  const home = Object.fromEntries(PARTS.map((p) => [p.id, R[p.id].position.y]));
  const switchBase = home.bottoms;
  const target = Object.fromEntries(PARTS.map((p) => [p.id, SWITCH.includes(p.id) ? slotY.switch + (home[p.id] - switchBase) : slotY[p.id]]));
  const shift = slots.reduce((a, id) => a + slotY[id], 0) / slots.length - Object.values(home).reduce((a, b) => a + b, 0) / PARTS.length;
  const parts: Part[] = PARTS.map((p) => {
    const anchor = new THREE.Object3D();
    anchor.position.set(8.4, 0.1, -2.2);
    R[p.id].add(anchor);
    const late = SWITCH.includes(p.id) ? new THREE.Vector3(0, SPREAD[p.id], 0) : undefined;
    return { ...p, movers: [{ obj: R[p.id], dir: new THREE.Vector3(0, target[p.id] - shift - home[p.id], 0), late }], anchor };
  });

  // ---------- presses + underglow
  const stems = R.stemsIM as unknown as THREE.InstancedMesh;
  const springs = R.springsIM as unknown as THREE.InstancedMesh;
  const leds = R.leds as unknown as THREE.InstancedMesh;
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  let prev = new Set<string>();
  let t = 0;
  const update = (dt: number) => {
    t += dt;
    const now = state.down;
    const changed = KEYS.filter((k) => now.has(k.code) !== prev.has(k.code));
    for (const k of changed) {
      const i = KEYS.indexOf(k);
      const d = now.has(k.code);
      capGroups[k.code].position.y = d ? -0.14 : 0;
      stems.setMatrixAt(i, m4.makeTranslation(k.cx, d ? -0.14 : 0, k.cz));
      springs.setMatrixAt(i, m4.compose(new THREE.Vector3(k.cx, 0, k.cz), new THREE.Quaternion(), new THREE.Vector3(1, d ? 0.6 : 1, 1)));
    }
    if (changed.length) {
      stems.instanceMatrix.needsUpdate = true;
      springs.instanceMatrix.needsUpdate = true;
    }
    prev = new Set(now);
    KEYS.forEach((k, i) => {
      if (state.glow) col.setHSL(((k.cx + 8) * 0.06 + (k.cz + 2.5) * 0.08 + t * 0.3) % 1, 0.9, 0.6);
      else col.set(now.has(k.code) ? 0x8ad9a8 : 0xffffff);
      leds.setColorAt(i, col);
    });
    leds.instanceColor!.needsUpdate = true;
    (leds.material as THREE.MeshStandardMaterial).emissiveIntensity = state.glow ? 1.6 : 0.25;
  };

  return {
    root,
    parts,
    view: { position: [1.5, 10.5, 15.5], target: [0, 0.8, 0.3], fov: 30, near: 0.5, far: 400, minDistance: 8, maxDistance: 60, fit: true },
    background: "#f2ead7",
    floorY: -4.6,
    shadowSize: 14,
    explodeZoom: 1.45,
    update,
    onPointer: (hit, kind) => {
      if (kind === "up") {
        state.onPick?.("", false);
        return;
      }
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.code) o = o.parent;
      if (o) state.onPick?.(o.userData.code as string, true);
    },
  };
}
