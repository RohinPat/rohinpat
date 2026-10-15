import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Same mark as the nav: "RP" in ink on a signal disc.
export default async function Icon() {
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
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 32,
          background: "#ff4a1c",
          color: "#0c0c0b",
          fontFamily: "Archivo",
          fontSize: 30,
          fontWeight: 900,
          letterSpacing: -2,
        }}
      >
        RP
      </div>
    ),
    { ...size, fonts: [{ name: "Archivo", data: archivo, weight: 900, style: "normal" }] },
  );
}
