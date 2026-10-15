import { ogSize, pageCard } from "../_og";

export const runtime = "edge";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Contact — Rohin Patel";

export default function OG() {
  return pageCard({ title: "Say hi", kicker: "Contact", bg: "#1d5e3f", fg: "#f2ead7", accent: "#8ad9a8" });
}
