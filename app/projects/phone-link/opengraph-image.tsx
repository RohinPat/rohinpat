import { ogSize, pageCard } from "../../_og";

export const runtime = "edge";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "A website your phone can drive — a case study by Rohin Patel";

export default function OG() {
  return pageCard({
    title: "A website your phone can drive",
    kicker: "Case study · WebSocket · WebRTC · Redis",
    bg: "#0d100e",
    fg: "#f2ead7",
    accent: "#8ad9a8",
    titleSize: 120,
  });
}
