import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cardSummary,
  education,
  experience,
  plainUrl,
  projectList,
  proofPoints,
  resumeHeader,
  skills,
} from "@/app/resume/data";
import { resumePdfExists } from "@/app/resume/pdf";
import { jobs, made } from "@/lib/projects";
import { site } from "@/lib/site";

describe("recruiter card copy", () => {
  it("is a one-sentence summary that names the role and employer", () => {
    expect(cardSummary).toContain(site.role);
    expect(cardSummary).toContain(site.employer);
    expect(cardSummary.match(/[.!?](\s|$)/g)).toHaveLength(1);
  });

  it("has exactly three proof points with real text", () => {
    expect(proofPoints).toHaveLength(3);
    for (const p of proofPoints) {
      expect(p.lead.trim().length).toBeGreaterThan(2);
      expect(p.text.trim().length).toBeGreaterThan(20);
    }
  });

  it("only links to pages that exist on this site", () => {
    for (const p of proofPoints.filter((p) => p.href)) {
      expect(p.href).toMatch(/^\/(projects\/closet-organizer|colophon)$/);
    }
  });
});

describe("resume data", () => {
  it("takes its header from site.ts", () => {
    expect(resumeHeader.email).toBe(site.email);
    expect(resumeHeader.github).toBe(site.github);
    expect(resumeHeader.linkedin).toBe(site.linkedin);
  });

  it("lists every job and every project from lib/projects, and nothing else", () => {
    expect(experience.map((e) => e.employer)).toEqual(jobs.map((j) => j.title));
    expect(projectList.map((p) => p.title)).toEqual(made.map((p) => p.title));
  });

  it("keeps education and skills placeholders marked, never invented", () => {
    expect(education.school).toBe(site.school);
    expect(education.placeholder.todo.length).toBeGreaterThan(0);
    expect(skills.placeholder.todo.length).toBeGreaterThan(0);
    // skills from the repo are exactly the tags already on the work
    expect(new Set(skills.fromWork)).toEqual(new Set([...jobs, ...made].flatMap((p) => p.tags)));
    expect(new Set(skills.fromWork).size).toBe(skills.fromWork.length);
  });

  it("displays URLs without scheme or trailing slash", () => {
    expect(plainUrl("https://www.linkedin.com/in/rohinpat/")).toBe("www.linkedin.com/in/rohinpat");
    expect(plainUrl("https://github.com/RohinPat")).toBe("github.com/RohinPat");
  });
});

describe("resumePdfExists", () => {
  it("is false until public/resume.pdf is there, then true", () => {
    const root = mkdtempSync(path.join(tmpdir(), "resume-"));
    mkdirSync(path.join(root, "public"));
    expect(resumePdfExists(root)).toBe(false);
    writeFileSync(path.join(root, "public", "resume.pdf"), "%PDF-");
    expect(resumePdfExists(root)).toBe(true);
  });
});
