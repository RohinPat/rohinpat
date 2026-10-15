// Everything time-sensitive about "who I am right now" lives here, so the
// homepage, metadata, structured data and contact page can't drift apart.
// When something changes, edit this file and nothing else.

export const site = {
  name: "Rohin Patel",
  role: "Software Engineer",
  employer: "WHOOP",
  team: "A&A Shop",
  employerUrl: "https://whoop.com",
  school: "Northeastern University",
  schoolShort: "NEU CS '26",
  email: "rohinp1124@gmail.com",
  location: "Boston, MA",
  github: "https://github.com/RohinPat",
  linkedin: "https://www.linkedin.com/in/rohinpat/",
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://rohinpat.vercel.app",
} as const;

export const headline = `${site.role} at ${site.employer}`;

// "What I do there", in one line — used by the hero phone, /projects and metadata.
export const teamLine = `On the ${site.team} team, running the in-app shop.`;

export const description = `${headline}. ${teamLine} ${site.schoolShort}. I build iOS apps, ML systems and the occasional toy.`;
