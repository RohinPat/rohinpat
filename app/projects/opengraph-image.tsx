import { ogSize, pageCard } from "../_og";

export const runtime = "edge";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Work — Rohin Patel";

export default function OG() {
  return pageCard({ title: "Work.", kicker: "Made · Worked at", bg: "#f2ead7", fg: "#0d100e", accent: "#1d5e3f" });
}
