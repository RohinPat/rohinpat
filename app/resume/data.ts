import { jobs, made } from "@/lib/projects";
import { site } from "@/lib/site";

// Everything the recruiter card (components/QuickCard.tsx) and /resume say.
// Rule zero: only facts already in this repo. Each line below names where it
// comes from. Anything the repo doesn't say is a PLACEHOLDER, marked
// TODO(rohin); edit this one file and both surfaces follow.

/** The card's one-sentence summary. Built from site.ts and lib/site's `pov`. */
// TODO(rohin): confirm the wording of this sentence, in your own voice.
export const cardSummary = `${site.role} on ${site.employer}'s ${site.team} team, building iOS apps and the computer-vision and backend systems behind them.`;

export type ProofPoint = {
  /** short bold lead */
  lead: string;
  text: string;
  /** optional internal link for the lead */
  href?: string;
};

const whoop = jobs.find((j) => j.slug === "whoop");

// TODO(rohin): confirm that these three are the three things you want a
// recruiter to remember. Sources are in the comments.
export const proofPoints: ProofPoint[] = [
  {
    // lib/projects.ts, the "whoop" entry
    lead: `At ${site.employer}`,
    text: whoop?.line ?? `${site.role} at ${site.employer}.`,
  },
  {
    // app/projects/closet-organizer/page.tsx, FACTS
    lead: "Closet Organizer",
    text: "Photograph a piece of clothing and the backend cuts it out, tags it and names its colours. FastAPI, CLIP and an Expo app.",
    href: "/projects/closet-organizer",
  },
  {
    // app/projects/phone-link/page.tsx
    lead: "The phone link",
    text: "Scan the QR on this site and your phone tilts the replica, unlocks it and plays the Off hours games.",
    href: "/projects/phone-link",
  },
];

// ---------------------------------------------------------------------------
// /resume
// ---------------------------------------------------------------------------

/** A placeholder shows up on the page as "[TODO(rohin): …]" so it can't ship unnoticed. */
export type Placeholder = { todo: string };

export const resumeHeader = {
  name: site.name,
  role: `${site.role}, ${site.employer}`,
  location: site.location,
  email: site.email,
  github: site.github,
  linkedin: site.linkedin,
  site: site.url,
};

/** Display form of a URL: no scheme, no trailing slash. */
export const plainUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

// TODO(rohin): lib/projects.ts holds only years ("2025 —", "2024"). Add
// start and end months, and one to three outcome bullets per role, if you
// want them on the resume. The repo has none, so none are invented here.
export const experience = jobs.map((j) => ({
  employer: j.title,
  role: j.role ?? "",
  when: j.year,
  line: j.line,
  tags: j.tags,
}));

// Extra detail for a project, only where a repo page states it.
const projectDetail: Record<string, string> = {
  // app/projects/phone-link/page.tsx, FACTS
  "phone-link":
    "A visitor's phone pairs with the site by QR code and becomes a motion controller for it: a WebSocket relay on a Vercel Function with Redis pub/sub, a direct WebRTC channel when the network allows, and gesture recognisers in plain TypeScript.",
  // app/projects/closet-organizer/page.tsx, FACTS
  "closet-organizer":
    "CLIP ViT-B/32 zero-shot tagging, rembg cutouts and per-pixel colour voting; Expo app for iOS and Android, a web app, one FastAPI backend; 136 pytest functions, plus Playwright, Jest, Bandit and ShellCheck in CI.",
};

export const projectList = made.map((p) => ({
  title: p.title,
  when: p.year,
  line: p.line,
  detail: projectDetail[p.slug],
  tags: p.tags,
  links: p.links ?? [],
  caseStudy: p.caseStudy,
}));

export const education = {
  school: site.school,
  // site.schoolShort is "NEU CS '26"
  detail: site.schoolShort,
  // TODO(rohin): the repo says only "NEU CS '26". Add degree (B.S.?), the
  // graduation month, GPA, honours and relevant coursework, or delete this.
  placeholder: {
    todo: "degree title, graduation month, GPA, honours, relevant coursework",
  } satisfies Placeholder,
};

/** Every tag used on the roles and projects above, in order, without repeats. */
export const skillsFromWork = Array.from(new Set([...jobs, ...made].flatMap((p) => p.tags)));

export const skills = {
  fromWork: skillsFromWork,
  // TODO(rohin): the repo lists no skills beyond the tags above. Add
  // languages, frameworks and tools you want to be found by, or delete this.
  placeholder: {
    todo: "languages, frameworks and tools not already tagged above",
  } satisfies Placeholder,
};

export const resumeMeta = {
  title: "Resume",
  description: `Resume of ${site.name}: ${site.role} at ${site.employer}. Experience, projects, education and skills.`,
};
