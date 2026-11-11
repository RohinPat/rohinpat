import type * as THREE from "three";
import type { BuiltHole } from "@/components/offhours/golf/course";
import type { SceneryRecord, Tier } from "./types";

// Phase 2: sea stacks and a lighthouse (SceneryRecord.props), placed only outside the gate.

export function buildProps(
  hole: BuiltHole,
  rec: SceneryRecord,
  heightAt: (x: number, z: number) => number,
  tier: Tier,
): { group: THREE.Group; tris: number; calls: number; dispose: () => void } | null {
  void hole;
  void heightAt;
  void tier;
  if (!rec.props) return null;
  return null;
}
