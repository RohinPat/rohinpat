import { ogSize, pageCard } from "../_og";

export const runtime = "edge";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Colophon — how Rohin Patel's site is built";

export default function OG() {
  return pageCard({ title: "Colophon", kicker: "How this site is built", bg: "#f2ead7", fg: "#0d100e", accent: "#1d5e3f", titleSize: 200 });
}
