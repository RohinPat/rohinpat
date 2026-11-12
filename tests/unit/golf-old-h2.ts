import type { HoleDef } from "@/components/offhours/golf/course";

// Hole 2 as it was before the cliff (wave 2): a short par 3 over a lobed pond, 13.5 m down a long slope. Tests of how water,
// drops and ponds work in general still want a hole like it, and a pond with a natural shore (`lobe`) lives nowhere else.

export const OLD_POND = { x: -17, z: 108, rx: 11, rz: 9, rot: 0.3, lobe: 4.5 };

export const OLD_H2: HoleDef = {
  n: 2,
  name: "Short Straw",
  par: 3,
  yards: 135,
  line: [[0, 0], [0, 137]],
  half: [10, 17],
  rough: 12,
  pin: [-3, 135],
  green: { c: [0, 137], seed: 4202, severity: 0.75 },
  bunkers: [{ x: 17, z: 134, rx: 6, rz: 8 }],
  water: [OLD_POND],
  trees: { seed: 23, edge: 6, spacing: 6 },
  wind: { speed: 2, dir: Math.PI / 2 },
  landing: [-3, 135],
  ground: { rise: [[0, 0], [24, 0], [55, -8], [95, -13], [137, -13.5]], swell: 0.3, sigma: 9 },
};
