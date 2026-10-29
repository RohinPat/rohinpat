import { describe, expect, it } from "vitest";
import { site } from "@/lib/site";
import { buildVcard, vcardText } from "@/lib/vcard";

describe("contact card", () => {
  it("escapes the characters vCard text reserves", () => {
    expect(vcardText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("is one CRLF-ended vCard 3.0 built from lib/site", () => {
    const v = buildVcard();
    expect(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(v.endsWith("END:VCARD\r\n")).toBe(true);
    // no bare line breaks inside a value
    expect(v.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(v).toContain(`FN:${site.name}\r\n`);
    expect(v).toContain("N:Patel;Rohin;;;\r\n");
    expect(v).toContain(`EMAIL;TYPE=INTERNET:${site.email}\r\n`);
    expect(v).toContain(`item1.URL:${site.github}\r\n`);
    expect(v).toContain("ADR;TYPE=WORK:;;;Boston;MA;;\r\n");
  });
});
