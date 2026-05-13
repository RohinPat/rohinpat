export const site = {
  name: "Rohin Patel",
  role: "iOS Engineer · WHOOP · NEU CS '26",
  email: "patel.rohin@northeastern.edu",
  location: "Boston, MA",
  github: "https://github.com/RohinPat",
  linkedin: "https://www.linkedin.com/in/rohinpat/",
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://rohinpat.vercel.app",
} as const;

// "Now" strip on the homepage. Edit this freely — it's meant to feel current.
export const now = [
  { label: "Status",        value: "Graduated · WHOOP full-time starts July 2026" },
  { label: "Building",      value: "Solo projects in the gap (see /projects)" },
  { label: "Wrist today",   value: "Omega × Swatch Mission to the Moon" },
  { label: "Driving",       value: "Lexus RX350 (dreaming: a W124 E-Class)" },
  { label: "On rotation",   value: "Travis Scott — CAN'T SAY" },
  { label: "Watching",      value: "Barça, like always" },
] as const;

// Featured projects for the homepage. Leans on personal / solo work first.
export const featuredProjects = [
  {
    slug: "closet-organizer",
    title: "Closet Organizer — End-to-end AI Wardrobe",
    summary:
      "Full-stack solo build. ResNet50 + color-theory recommender. One FastAPI backend powering a React Native app and a web UI.",
    role: "Solo",
    year: "2025",
    href: "/projects",
  },
  {
    slug: "aimessage",
    title: "AiMessage — Mental-health Messaging",
    summary:
      "Real-time messaging with NLP sentiment + emotional-state tracking. Public demo + GitHub.",
    role: "Solo",
    year: "2024",
    href: "/projects",
  },
  {
    slug: "bluebikes",
    title: "BlueBikes Data Visualization",
    summary:
      "Six visualization types over years of Boston bike-share data. Flask + Plotly + D3.",
    role: "Solo",
    year: "2023",
    href: "/projects",
  },
] as const;
