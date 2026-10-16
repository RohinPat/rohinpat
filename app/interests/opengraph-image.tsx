import { ogSize, pageCard } from "../_og";

export const runtime = "edge";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Off hours — Rohin Patel";

export default function OG() {
  return pageCard({ title: "Off hours", kicker: "Nine pieces, drawn in code", bg: "#0d100e", fg: "#f2ead7", accent: "#8ad9a8" });
}
