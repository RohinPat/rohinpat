import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projects } from "@/lib/projects";

const root = path.resolve(__dirname, "../..");

describe("projects data", () => {
  it("has unique slugs", () => {
    const slugs = projects.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("only links case studies that exist as pages", () => {
    for (const p of projects.filter((p) => p.caseStudy)) {
      const page = path.join(root, "app", ...p.caseStudy!.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(page), `${p.slug} → ${p.caseStudy}`).toBe(true);
    }
  });

  it("every media item has alt text and a file in /public", () => {
    for (const p of projects) {
      for (const m of p.media ?? []) {
        expect(m.alt.trim().length, `${p.slug}: alt`).toBeGreaterThan(10);
        expect(existsSync(path.join(root, "public", m.src)), `${p.slug}: ${m.src}`).toBe(true);
        if (m.poster) expect(existsSync(path.join(root, "public", m.poster))).toBe(true);
      }
    }
  });

  it("external links are https", () => {
    for (const p of projects) for (const l of p.links ?? []) expect(l.href).toMatch(/^https:\/\//);
  });

  it("Closet Organizer links its code", () => {
    const co = projects.find((p) => p.slug === "closet-organizer")!;
    expect(co.links?.map((l) => l.href)).toContain("https://github.com/RohinPat/Closet-Org");
  });
});
