import { describe, expect, it } from "vitest";
import { bucketOf, formatBytes, formatMs, fps, summarize } from "@/lib/perf";

const origin = "https://rohinpat.vercel.app";
const r = (path: string, initiatorType = "link", transferSize = 100, encodedBodySize = 90) => ({
  name: path.startsWith("http") ? path : origin + path,
  initiatorType,
  transferSize,
  encodedBodySize,
});

describe("bucketOf", () => {
  it("sorts resources by what they are", () => {
    expect(bucketOf(r("/", "navigation"))).toBe("document");
    expect(bucketOf(r("/_next/static/media/a.woff2", "css"))).toBe("font");
    expect(bucketOf(r("/_next/static/css/app.css"))).toBe("style");
    expect(bucketOf(r("/_next/static/chunks/main.js", "script"))).toBe("script");
    expect(bucketOf(r("/icon.png", "img"))).toBe("image");
    expect(bucketOf(r("/api/x", "fetch"))).toBe("other");
  });
});

describe("summarize", () => {
  it("totals bytes and counts per type", () => {
    const s = summarize(
      [r("/", "navigation", 1200, 1100), r("/a.js", "script", 0, 5000), r("/b.js", "script", 3000, 2900)],
      origin,
    );
    expect(s.requests).toBe(3);
    expect(s.transferred).toBe(4200);
    expect(s.weight).toBe(9000);
    expect(s.byType.script).toEqual({ count: 2, transferred: 3000, weight: 7900 });
    expect(s.otherHosts).toEqual([]);
  });

  it("lists every other host it sees", () => {
    const s = summarize([r("https://cdn.example.com/x.js"), r("https://fonts.gstatic.com/a.woff2"), r("/ok.css")], origin);
    expect(s.otherHosts).toEqual(["cdn.example.com", "fonts.gstatic.com"]);
  });

  it("treats missing or negative sizes as zero", () => {
    const s = summarize([{ name: origin + "/x", initiatorType: "other" }, r("/y", "other", -5, -5)], origin);
    expect(s.transferred).toBe(0);
    expect(s.weight).toBe(0);
  });
});

describe("formatting", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 kB");
    expect(formatBytes(98_765)).toBe("99 kB");
    expect(formatBytes(1_860_000)).toBe("1.86 MB");
  });

  it("formats milliseconds", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(476.6)).toBe("477 ms");
    expect(formatMs(1234)).toBe("1.23 s");
  });

  it("computes fps", () => {
    expect(fps(60, 1000)).toBe(60);
    expect(fps(119, 1003)).toBe(119);
    expect(fps(10, 0)).toBe(0);
  });
});
