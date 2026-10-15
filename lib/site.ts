// Everything time-sensitive about "who I am right now" lives here, so the
// homepage, metadata, structured data and contact page can't drift apart.
// When something changes, edit this file and nothing else.

export const site = {
  name: "Rohin Patel",
  role: "Software Engineer",
  employer: "WHOOP",
  employerUrl: "https://whoop.com",
  school: "Northeastern University",
  schoolShort: "NEU CS '26",
  email: "patel.rohin@northeastern.edu",
  location: "Boston, MA",
  github: "https://github.com/RohinPat",
  linkedin: "https://www.linkedin.com/in/rohinpat/",
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://rohinpat.vercel.app",
} as const;

export const headline = `${site.role} at ${site.employer}`;

export const description = `${headline}. ${site.schoolShort}. I build iOS apps, ML systems and the occasional toy.`;

// Disciplines marquee on the homepage.
export const disciplines = [
  "SwiftUI",
  "Core Bluetooth",
  "Computer Vision",
  "PyTorch",
  "TypeScript",
  "FastAPI",
  "Real-time data",
  "Design engineering",
] as const;

// Mondragon-style fact grid under the homepage hero.
export const facts = [
  { label: "Based in", value: site.location },
  { label: "Working at", value: site.employer },
  { label: "Focus", value: "iOS · ML · Web" },
  { label: "Studied", value: "CS + AI, Northeastern" },
] as const;
