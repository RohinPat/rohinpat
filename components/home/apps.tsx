import { site } from "@/lib/site";

// Every app on the home screen. `color` is the icon's tile; `land` is the
// destination page's first surface, which the launch animation fades into.
// External apps open normally (new tab / mail client), no launch zoom.

export type App = {
  id: string;
  name: string;
  href: string;
  external?: boolean;
  tile: string; // icon background
  ink: string; // glyph colour
  land?: string; // page colour the launch zoom lands on
  glyph: keyof typeof GLYPHS;
};

const INK = "#0d100e";
const CREAM = "#f2ead7";
const GREEN = "#1d5e3f";
const MINT = "#8ad9a8";

export const GRID: App[] = [
  { id: "closet", name: "Closet Organizer", href: "/projects/closet-organizer", tile: INK, ink: MINT, land: CREAM, glyph: "hanger" },
  { id: "colophon", name: "Colophon", href: "/colophon", tile: CREAM, ink: INK, land: CREAM, glyph: "braces" },
  { id: "github", name: "GitHub", href: site.github, external: true, tile: INK, ink: CREAM, glyph: "branch" },
  { id: "linkedin", name: "LinkedIn", href: site.linkedin, external: true, tile: GREEN, ink: CREAM, glyph: "badge" },
  { id: "privacy", name: "Privacy", href: "/privacy", tile: CREAM, ink: GREEN, land: CREAM, glyph: "shield" },
];

export const DOCK: App[] = [
  { id: "work", name: "Work", href: "/projects", tile: CREAM, ink: INK, land: CREAM, glyph: "frames" },
  { id: "offhours", name: "Off hours", href: "/interests", tile: INK, ink: CREAM, land: INK, glyph: "moon" },
  { id: "sayhi", name: "Say hi", href: "/contact", tile: GREEN, ink: CREAM, land: GREEN, glyph: "bubble" },
  { id: "mail", name: "Mail", href: `mailto:${site.email}`, external: true, tile: CREAM, ink: GREEN, glyph: "envelope" },
];

export const ALL_APPS = [...DOCK, ...GRID];

// 24×24 line glyphs, drawn to sit together like a single icon set.
export const GLYPHS = {
  frames: (
    <>
      <rect x="3.5" y="6.5" width="12" height="13" rx="2" />
      <path d="M8.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 20.5 5v11a1.5 1.5 0 0 1-1.5 1.5h-3.5" />
    </>
  ),
  hanger: (
    <>
      <path d="M12 8.5V8a2 2 0 1 0-2-2" />
      <path d="M12 8.5 3.6 15.2a1.3 1.3 0 0 0 .8 2.3h15.2a1.3 1.3 0 0 0 .8-2.3L12 8.5Z" />
    </>
  ),
  moon: (
    <>
      <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />
      <path d="M17 3.5v3M15.5 5h3" />
    </>
  ),
  braces: (
    <>
      <path d="M9 4.5H8a2 2 0 0 0-2 2v3a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 6 14.5v3a2 2 0 0 0 2 2h1" />
      <path d="M15 4.5h1a2 2 0 0 1 2 2v3a2.5 2.5 0 0 0 2.5 2.5A2.5 2.5 0 0 0 18 14.5v3a2 2 0 0 1-2 2h-1" />
    </>
  ),
  branch: (
    <>
      <circle cx="7" cy="5.5" r="2" />
      <circle cx="7" cy="18.5" r="2" />
      <circle cx="17" cy="8.5" r="2" />
      <path d="M7 7.5v9M17 10.5c0 4-10 2.5-10 6" />
    </>
  ),
  badge: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 15.5c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h3.5M14.5 13h2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6l-7-2.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  bubble: (
    <>
      <path d="M4 11.5c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7c-1 0-2-.1-2.9-.4L5 19.5l1-3.4c-1.3-1.2-2-2.8-2-4.6Z" />
    </>
  ),
  envelope: (
    <>
      <rect x="3.5" y="6" width="17" height="12.5" rx="2" />
      <path d="m4.5 7.5 7.5 6 7.5-6" />
    </>
  ),
} as const;
