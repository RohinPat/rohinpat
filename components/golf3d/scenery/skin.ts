import * as THREE from "three";
import type { Skin } from "./types";

export const DEFAULT_SKIN = { skyTop: "#4f92d0", skyLow: "#a9d1ec", haze: "#d4e6e6", fogNear: 180, fogFar: 2600, glow: "#ffedc7" };

export type SkinTargets = {
  scene: THREE.Scene;
  skyMat: THREE.ShaderMaterial;
  /** the light's direction (read only) */
  sunDir: THREE.Vector3;
};

/** put a hole's sky on: every field is written each time, so nothing carries over from the last hole */
export function applySkin(t: SkinTargets, s?: Skin): void {
  const k = { ...DEFAULT_SKIN, ...s };
  const u = t.skyMat.uniforms;
  u.top.value.set(k.skyTop);
  u.low.value.set(k.skyLow);
  u.haze.value.set(k.haze);
  u.glow.value.set(k.glow);
  (t.scene.background as THREE.Color).set(k.haze);
  const f = t.scene.fog as THREE.Fog;
  f.color.set(k.haze);
  f.near = k.fogNear;
  f.far = Math.max(2200, Math.min(3000, k.fogFar));
  const d = s?.skySun ? new THREE.Vector3(...s.skySun).normalize() : t.sunDir;
  // the sky's coordinates are the world's: x is mirrored against the course's
  u.sun.value.set(-d.x, d.y, d.z);
}
