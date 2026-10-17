import { teamLine } from "./site";

// Everything on /projects and the homepage's selected work. One line each —
// the long version lives in a case study. Deliberately no employer metrics.
//
// Every line here should be checkable against the project's own repo.

/**
 * A screenshot or screen recording. Files go in /public (e.g.
 * /public/work/closet-organizer/closet.mp4) and are referenced by their
 * public path. Nothing is fetched from another host.
 *
 * Until an entry has media, its drawing (components/home/Motif.tsx) stands
 * in as the cover, so a missing screenshot never looks like a broken one.
 */
export type Media = {
  kind: "image" | "video";
  /** public path, e.g. "/work/closet-organizer/upload.png" */
  src: string;
  /** what the image shows, for screen readers. Required. */
  alt: string;
  /** intrinsic size, so the page doesn't shift while it loads */
  width: number;
  height: number;
  /** optional still for videos */
  poster?: string;
  caption?: string;
};

export type Entry = {
  slug: string;
  title: string;
  line: string;
  year: string;
  kind: "project" | "work";
  role?: string;
  tags: string[];
  /** internal write-up, e.g. "/projects/closet-organizer" */
  caseStudy?: string;
  links?: { label: string; href: string }[];
  /** first item is the cover; see Media above */
  media?: Media[];
};

export const projects: Entry[] = [
  {
    slug: "closet-organizer",
    title: "Closet Organizer",
    line: "A wardrobe app: photograph a piece of clothing and the backend cuts it out, tags it with CLIP, names its colours and fits it into outfits.",
    year: "2025",
    kind: "project",
    tags: ["FastAPI", "CLIP", "React Native"],
    caseStudy: "/projects/closet-organizer",
    links: [{ label: "Code", href: "https://github.com/RohinPat/Closet-Org" }],
    // Drop real captures in here when they exist, e.g.
    // media: [
    //   { kind: "video", src: "/work/closet-organizer/upload.mp4",
    //     poster: "/work/closet-organizer/upload.jpg", width: 1179, height: 2556,
    //     alt: "Uploading a photo of a jacket in the iOS app; it comes back tagged Jacket, Navy, Winter." },
    // ],
  },
  {
    slug: "aimessage",
    title: "AiMessage",
    // TODO(Rohin): verify — the old line said it "notices how a conversation
    // feels and gently surfaces support", but the public repo has no
    // sentiment/NLP code. Restore that if it lives somewhere else.
    line: "Real-time messaging on Next.js: conversations, read receipts and presence over Pusher, with Prisma and NextAuth.",
    year: "2024",
    kind: "project",
    tags: ["Next.js", "Pusher", "Prisma"],
    // No links for now: the public repo holds files that shouldn't be public
    // (a SQL backup, a debug-env endpoint). Re-add the Code link once it's
    // cleaned up; the demo is a sign-in wall either way.
  },
  {
    slug: "bluebikes",
    title: "BlueBikes",
    line: "A month of Boston bike-share trips, charted by hour, day, station, route and rider type.",
    year: "2023",
    kind: "project",
    tags: ["Python", "D3", "Leaflet"],
    // Demo link removed while the live demo's data file 404s.
    links: [{ label: "Code", href: "https://github.com/RohinPat/data-visualization-bluebikes" }],
  },
  {
    slug: "whoop",
    title: "WHOOP",
    role: "Software Engineer",
    line: `${teamLine} Started as an iOS co-op on the Onboarding team.`,
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

export const made = projects.filter((p) => p.kind === "project");
export const jobs = projects.filter((p) => p.kind === "work");

export function projectBySlug(slug: string) {
  return projects.find((p) => p.slug === slug);
}
