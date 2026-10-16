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
  /** this site's own source */
  repo: "https://github.com/RohinPat/rohinpat",
  // Custom domain: set NEXT_PUBLIC_SITE_URL (e.g. https://rohinpatel.com) in
  // Vercel. Canonical URLs, the sitemap, robots and social cards follow it.
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://rohinpat.vercel.app",
} as const;

/** "rohinpat.vercel.app" — or the custom domain once it's set */
export const siteHost = new URL(site.url).host;

export const headline = `${site.role} at ${site.employer}`;

// "What I do there", in one line — used by the hero phone, /projects and metadata.
export const teamLine = `On the ${site.team} team, running the in-app shop.`;

// The point of view, in one sentence. The hero leads with it.
export const pov = "I build iOS apps and the computer-vision and backend systems behind them.";

// The hero's second sentence: the day job, plainly.
export const now = `At ${site.employer} I run the in-app shop.`;

export const description = `${headline}. ${teamLine} ${site.schoolShort}. ${pov}`;
