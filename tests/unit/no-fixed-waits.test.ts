import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Fixed waits make e2e tests flaky: the CI runner draws WebGL in software, so any fixed delay is either too short
// (a flake) or too long (a slow suite). Tests wait on state: a data-* attribute, focus, a visible element.
// This counts `waitForTimeout(` per e2e file. The allow-list is today's count; it may only go down. When a spec
// loses a wait, lower its number here in the same change; a file that goes above its number fails.
const ALLOWED: Record<string, number> = {
  "a11y.spec.ts": 1,
  "cars-assist.spec.ts": 1,
  "cars-gearbox.spec.ts": 2,
  "cars-play.spec.ts": 1,
  "cars-polish.spec.ts": 3,
  "cars-sets.spec.ts": 6,
  "cars-tune.spec.ts": 1,
  "cars-world.spec.ts": 6,
  "easter-eggs.spec.ts": 1,
  "first-try.spec.ts": 1,
  "golf-course.spec.ts": 6,
  "golf-faster.spec.ts": 10,
  "interests-tiles.spec.ts": 5,
  "lab-handshake.spec.ts": 3,
  "lab-link.spec.ts": 3,
  "lab-mirror.spec.ts": 7,
  "lab-pointer.spec.ts": 2,
  "landscape.spec.ts": 2,
  "link-flick.spec.ts": 6,
  "link-keys.spec.ts": 2,
  "link-nightrun.spec.ts": 14,
  "link-remote.spec.ts": 4,
  "link-tilt.spec.ts": 15,
  "link-twist.spec.ts": 2,
  "link-ui.spec.ts": 12,
  "play-fixes.spec.ts": 7,
  "powder-play.spec.ts": 3,
  "resume.spec.ts": 1,
  "smoke.spec.ts": 6,
};

const E2E = path.resolve(__dirname, "../../e2e");

function specCounts(dir: string, rel = ""): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      Object.assign(out, specCounts(full, `${rel}${name}/`));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const n = (readFileSync(full, "utf8").match(/waitForTimeout\(/g) ?? []).length;
    if (n) out[`${rel}${name}`] = n;
  }
  return out;
}

describe("e2e: no new fixed waits", () => {
  const counts = specCounts(E2E);

  it("no e2e file has more waitForTimeout calls than its allow-list entry", () => {
    const over = Object.entries(counts)
      .filter(([file, n]) => n > (ALLOWED[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} > allowed ${ALLOWED[file] ?? 0}`);
    expect(over, "wait on state instead (data-* attribute, focus, visible element)").toEqual([]);
  });

  it("the allow-list is kept tight: a count that went down is recorded down", () => {
    const stale = Object.entries(ALLOWED)
      .filter(([file, n]) => (counts[file] ?? 0) < n)
      .map(([file, n]) => `${file}: now ${counts[file] ?? 0}, listed ${n}`);
    expect(stale, "lower the allow-list entry to the current count").toEqual([]);
  });
});
