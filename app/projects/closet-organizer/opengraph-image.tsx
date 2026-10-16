import { ogSize, pageCard } from "../../_og";

export const runtime = "edge";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Closet Organizer — a case study by Rohin Patel";

export default function OG() {
  return pageCard({
    title: "Closet Organizer",
    kicker: "Case study · FastAPI · CLIP · Expo",
    bg: "#f2ead7",
    fg: "#0d100e",
    accent: "#1d5e3f",
    titleSize: 150,
  });
}
