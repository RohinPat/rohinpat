import { pov, site } from "./site";

// The contact card behind /contact's "Save contact" (served at /rohin-patel.vcf).
// vCard 3.0, the version both phones' contact apps import cleanly. Built from
// lib/site.ts so it can't drift from the rest of the site.

/** Escape a vCard text value: backslash, comma, semicolon and newlines. */
export function vcardText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
}

export function buildVcard(): string {
  const [last, ...rest] = site.name.split(" ").reverse();
  const first = rest.reverse().join(" ");
  const [city, region] = site.location.split(",").map((s) => s.trim());
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vcardText(last)};${vcardText(first)};;;`,
    `FN:${vcardText(site.name)}`,
    `TITLE:${vcardText(site.role)}`,
    `ORG:${vcardText(site.employer)}`,
    `EMAIL;TYPE=INTERNET:${site.email}`,
    `ADR;TYPE=WORK:;;;${vcardText(city ?? "")};${vcardText(region ?? "")};;`,
    `URL:${site.url}`,
    `item1.URL:${site.github}`,
    "item1.X-ABLabel:GitHub",
    `item2.URL:${site.linkedin}`,
    "item2.X-ABLabel:LinkedIn",
    `NOTE:${vcardText(`${pov} ${site.schoolShort}.`)}`,
    "END:VCARD",
  ];
  // the format wants CRLF line ends
  return lines.join("\r\n") + "\r\n";
}
