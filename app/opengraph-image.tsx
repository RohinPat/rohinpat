import { ImageResponse } from "next/og";
import { headline, site } from "@/lib/site";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${site.name} — ${headline}`;

// Social card: paper stock, giant name, one signal block — same system as the site.
// Archivo Black (SIL OFL, see app/_fonts/OFL-Archivo.txt) is bundled so the card
// doesn't depend on any font service.
export default async function OG() {
  const archivo = await fetch(
    new URL("./_fonts/archivo-latin-900-normal.woff", import.meta.url),
  ).then((r) => r.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          background: "#f2ead7",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          fontFamily: "system-ui, sans-serif",
          color: "#0d100e",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 24,
            textTransform: "uppercase",
            letterSpacing: 5,
            fontFamily: "monospace",
            color: "#5c5a4f",
          }}
        >
          <span>{site.location}</span>
          <span>{site.schoolShort}</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "Archivo",
            fontSize: 196,
            fontWeight: 900,
            lineHeight: 0.84,
            letterSpacing: -8,
            textTransform: "uppercase",
          }}
        >
          <span>Rohin</span>
          <span>Patel</span>
        </div>

        <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          <div
            style={{
              display: "flex",
              background: "#1d5e3f",
              color: "#f2ead7",
              padding: "18px 28px",
              fontFamily: "Archivo",
              fontSize: 38,
              fontWeight: 900,
            }}
          >
            {headline}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "#0d100e",
              color: "#f2ead7",
              padding: "18px 28px",
              fontSize: 26,
              fontFamily: "monospace",
              textTransform: "uppercase",
              letterSpacing: 4,
            }}
          >
            iOS · ML · Web
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Archivo", data: archivo, weight: 900, style: "normal" }] },
  );
}
