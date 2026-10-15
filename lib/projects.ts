import { teamLine } from "./site";

// Everything on /projects and the homepage filmstrip. One line each — this
// is a portfolio, not a résumé. Deliberately no employer metrics.

export type Entry = {
  slug: string;
  title: string;
  line: string;
  year: string;
  kind: "project" | "work";
  role?: string;
  tags: string[];
  links?: { label: string; href: string }[];
};

export const projects: Entry[] = [
  {
    slug: "closet-organizer",
    title: "Closet Organizer",
    line: "An AI wardrobe that classifies your clothes and builds outfits from color theory. Runs fully offline.",
    year: "2025",
    kind: "project",
    tags: ["PyTorch", "FastAPI", "React Native"],
  },
  {
    slug: "aimessage",
    title: "AiMessage",
    line: "Real-time messaging that notices how a conversation feels and gently surfaces support.",
    year: "2024",
    kind: "project",
    tags: ["Next.js", "NLP", "Pusher"],
    links: [
      { label: "Demo", href: "https://ai-message.vercel.app" },
      { label: "Code", href: "https://github.com/RohinPat/ai-message" },
    ],
  },
  {
    slug: "bluebikes",
    title: "BlueBikes",
    line: "Years of Boston bike-share trips, mapped by place, hour and season.",
    year: "2023",
    kind: "project",
    tags: ["Python", "D3", "Plotly"],
    links: [
      { label: "Demo", href: "https://data-visualization-bluebikes.vercel.app" },
      { label: "Code", href: "https://github.com/RohinPat/data-visualization-bluebikes" },
    ],
  },
  {
    slug: "whoop",
    title: "WHOOP",
    role: "Software Engineer",
    line: `${teamLine} Started as an iOS co-op on live heart-rate onboarding.`,
    year: "2025 —",
    kind: "work",
    tags: ["SwiftUI", "iOS", "Commerce"],
  },
  {
    slug: "siphox",
    title: "SiPhox Health",
    role: "Software Developer Co-op",
    line: "Shipped the company's first iOS app: 3D body scans from a phone video.",
    year: "2024",
    kind: "work",
    tags: ["SwiftUI", "Python", "AWS"],
  },
  {
    slug: "varidx",
    title: "Varidx",
    role: "Software Engineering Intern",
    line: "Computer vision on edge hardware for city traffic dashboards.",
    year: "2024",
    kind: "work",
    tags: ["YOLO", "OpenCV", "Azure"],
  },
];
