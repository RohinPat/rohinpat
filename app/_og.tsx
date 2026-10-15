import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

// Shared social card for inner pages: the page's own colour, its title set
// huge, the name underneath. Archivo is bundled (SIL OFL, app/_fonts).
export const ogSize = { width: 1200, height: 630 };

export async function pageCard({
  title,
  kicker,
  bg,
  fg,
  accent,
}: {
  title: string;
  kicker: string;
  bg: string;
  fg: string;
  accent: string;
}) {
  const archivo = await fetch(
    new URL("./_fonts/archivo-latin-900-normal.woff", import.meta.url),
  ).then((r) => r.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: bg,
          color: fg,
          fontFamily: "Archivo",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: accent }}>
          {kicker}
        </div>
        <div style={{ display: "flex", fontSize: 230, fontWeight: 900, lineHeight: 0.85, letterSpacing: -9, textTransform: "uppercase" }}>
          {title}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30, fontWeight: 900, textTransform: "uppercase" }}>
          <span>{site.name}</span>
          <span style={{ color: accent }}>rohinpat.vercel.app</span>
        </div>
      </div>
    ),
    { ...ogSize, fonts: [{ name: "Archivo", data: archivo, weight: 900, style: "normal" }] },
  );
}
