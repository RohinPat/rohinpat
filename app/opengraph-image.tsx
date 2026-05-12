import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Rohin Patel — iOS Engineer at WHOOP";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#0a0a0a",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top label */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: "#a50044",
            }}
          />
          <div
            style={{
              color: "#9ca3af",
              fontSize: 26,
              textTransform: "uppercase",
              letterSpacing: 6,
              fontFamily: "monospace",
            }}
          >
            patel, rohin — boston, ma
          </div>
        </div>

        {/* Big title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            color: "#ededed",
            fontSize: 100,
            fontWeight: 600,
            lineHeight: 1.02,
            letterSpacing: -3,
          }}
        >
          <div style={{ display: "flex" }}>
            <span>iOS Engineer at&nbsp;</span>
            <span style={{ color: "#a50044" }}>WHOOP.</span>
          </div>
          <div style={{ display: "flex", color: "#9ca3af" }}>
            <span>NEU CS &apos;26 —&nbsp;</span>
            <span style={{ color: "#ededed" }}>done.</span>
          </div>
        </div>

        {/* Bottom */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "#6b7280",
            fontSize: 22,
            textTransform: "uppercase",
            letterSpacing: 5,
            fontFamily: "monospace",
          }}
        >
          <span>github.com/RohinPat</span>
          <span>2026</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
