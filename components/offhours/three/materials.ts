import * as THREE from "three";

// Physically based materials and procedural textures (drawn on a canvas,
// no image files) shared by the exploded models.

function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, srgb = true, repeat = 1) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  draw(c, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** brushed-metal roughness streaks */
export function brushedTex(repeat = 1) {
  return canvasTexture(
    256,
    (c, s) => {
      c.fillStyle = "#777";
      c.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i++) {
        const v = 100 + Math.random() * 80;
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(0, Math.random() * s, s, Math.random() * 1.2);
      }
    },
    false,
    repeat,
  );
}

/** Côtes de Genève: soft parallel stripes (colour map) */
export function cotesTex(base = "#d7dbe0", repeat = 1) {
  return canvasTexture(
    256,
    (c, s) => {
      for (let x = 0; x < s; x++) {
        const k = 0.5 + 0.5 * Math.cos((x / s) * Math.PI * 2 * 6);
        c.fillStyle = shade(base, -0.18 + k * 0.28);
        c.fillRect(x, 0, 1, s);
      }
    },
    true,
    repeat,
  );
}

/** perlage: overlapping circular grain */
export function perlageTex(base = "#d9b061", repeat = 1) {
  return canvasTexture(
    256,
    (c, s) => {
      c.fillStyle = base;
      c.fillRect(0, 0, s, s);
      const r = s / 10;
      for (let y = -r; y < s + r; y += r * 0.9)
        for (let x = -r; x < s + r; x += r * 0.9) {
          const g = c.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
          g.addColorStop(0, shade(base, 0.25));
          g.addColorStop(0.7, base);
          g.addColorStop(1, shade(base, -0.2));
          c.fillStyle = g;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        }
    },
    true,
    repeat,
  );
}

/** 2x2 twill carbon weave */
export function carbonTex(repeat = 1) {
  return canvasTexture(
    256,
    (c, s) => {
      const n = 16, q = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const dir = (x + y) % 4 < 2;
          const g = dir ? c.createLinearGradient(x * q, 0, x * q + q, 0) : c.createLinearGradient(0, y * q, 0, y * q + q);
          g.addColorStop(0, "#0c0d0f");
          g.addColorStop(0.5, "#2b2e33");
          g.addColorStop(1, "#0c0d0f");
          c.fillStyle = g;
          c.fillRect(x * q, y * q, q, q);
        }
    },
    true,
    repeat,
  );
}

/** open-cell foam */
export function foamTex(base: string, repeat = 1) {
  return canvasTexture(
    128,
    (c, s) => {
      c.fillStyle = base;
      c.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        c.fillStyle = shade(base, (Math.random() - 0.5) * 0.3);
        c.beginPath();
        c.arc(Math.random() * s, Math.random() * s, Math.random() * 1.6, 0, Math.PI * 2);
        c.fill();
      }
    },
    true,
    repeat,
  );
}

/** a texture you draw yourself (dials, PCBs, decals) */
export function drawnTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const t = canvasTexture(size, draw, true, 1);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

const P = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);

export const mats = () => ({
  steel: P({ color: 0xe6e6e6, metalness: 1, roughness: 0.14 }),
  brushed: P({ color: 0xd9d9d9, metalness: 1, roughness: 0.32, roughnessMap: brushedTex(2) }),
  darkSteel: P({ color: 0x5c6066, metalness: 1, roughness: 0.3 }),
  gold: P({ color: 0xd8ae5a, metalness: 1, roughness: 0.28 }),
  goldStripe: P({ color: 0xffffff, map: cotesTex("#d9b366", 3), metalness: 1, roughness: 0.3 }),
  rhodium: P({ color: 0xffffff, map: cotesTex("#d8dce2", 3), metalness: 1, roughness: 0.22 }),
  perlage: P({ color: 0xffffff, map: perlageTex("#cfa75a", 3), metalness: 1, roughness: 0.38 }),
  ruby: P({ color: 0xc0182a, metalness: 0, roughness: 0.05, transmission: 0.55, thickness: 0.4, ior: 1.76, clearcoat: 1 }),
  blued: P({ color: 0x2a4fa0, metalness: 1, roughness: 0.22 }),
  sapphire: P({ color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, thickness: 0.6, ior: 1.77, specularIntensity: 0.22, attenuationColor: new THREE.Color(0xdde8ff), attenuationDistance: 8, transparent: true }), // AR-coated: faint reflections
  glassDark: P({ color: 0x0b0d10, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 }),
  lume: P({ color: 0xe9f7ee, emissive: 0x8ad9a8, emissiveIntensity: 0.15, roughness: 0.6 }),
  black: P({ color: 0x141414, roughness: 0.55 }),
  rubber: P({ color: 0x151515, roughness: 0.92 }),
  carbon: P({ color: 0xffffff, map: carbonTex(6), metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 }),
  alu: P({ color: 0xbfc3c7, metalness: 1, roughness: 0.42, roughnessMap: brushedTex(1) }),
  titanium: P({ color: 0x9a96a8, metalness: 1, roughness: 0.3, iridescence: 0.4, iridescenceIOR: 1.5 }),
});

export function paint(hex: string) {
  return P({ color: hex, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 });
}
