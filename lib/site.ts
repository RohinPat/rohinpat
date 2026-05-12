export const site = {
  name: "Rohin Patel",
  role: "iOS Engineer · WHOOP · NEU CS '26",
  email: "patel.rohin@northeastern.edu",
  location: "Boston, MA",
  github: "https://github.com/RohinPat",
  linkedin: "https://www.linkedin.com/in/rohinpat/",
} as const;

// "Now" strip on the homepage. Edit this freely — it's meant to feel current.
export const now = [
  { label: "Status",        value: "Heading to WHOOP full-time" },
  { label: "Wrist today",   value: "Omega × Swatch Mission to the Moon" },
  { label: "Driving",       value: "Lexus RX350 (dreaming: a W124 E-Class)" },
  { label: "On rotation",   value: "Travis Scott — CAN'T SAY" },
  { label: "Watching",      value: "Barça, like always" },
] as const;

// Featured projects for the homepage. Pulled from the broader projects list.
export const featuredProjects = [
  {
    slug: "whoop-onboarding",
    title: "WHOOP — Heart-rate Onboarding",
    summary:
      "Live BLE streaming onboarding in SwiftUI. Lifted completion 15%, DAM 10%.",
    role: "iOS Engineer",
    year: "2025",
    href: "/projects",
  },
  {
    slug: "siphox-bodyscan",
    title: "SiPhox — 3D Body Scan iOS App",
    summary:
      "First iOS app generating 3D body models from video. ±3.9% median error vs. clinical.",
    role: "Software Developer",
    year: "2024",
    href: "/projects",
  },
  {
    slug: "varidx-traffic",
    title: "Varidx — Edge Traffic Analytics",
    summary:
      "YOLO at the edge tracking 50k+ vehicles/day at 95% accuracy across city dashboards.",
    role: "SWE Intern",
    year: "2024",
    href: "/projects",
  },
] as const;
