import { ogSize, pageCard } from "../_og";

export const runtime = "edge";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Resume — Rohin Patel";

export default function OG() {
  return pageCard({ title: "Resume", kicker: "Experience · Projects", bg: "#f2ead7", fg: "#0d100e", accent: "#1d5e3f" });
}
