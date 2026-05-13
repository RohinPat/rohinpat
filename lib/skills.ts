// Single source of truth for the /skills page. Each skill is tagged with a
// category and the projects (slugs) where it was actually shipped.

export type ProjectSlug =
  | "closet"
  | "aimessage"
  | "bluebikes"
  | "whoop"
  | "siphox"
  | "varidx";

export type SkillCategory =
  | "Mobile"
  | "AI / ML"
  | "Languages"
  | "Web / Backend"
  | "Data"
  | "Cloud / DevOps";

export type Skill = {
  name: string;
  category: SkillCategory;
  projects: readonly ProjectSlug[];
};

export const PROJECTS: Record<ProjectSlug, { name: string; short: string; year: string; kind: "solo" | "co-op" }> = {
  closet:    { name: "Closet Organizer",   short: "Closet",  year: "2025", kind: "solo"  },
  aimessage: { name: "AiMessage",          short: "AiMsg",   year: "2024", kind: "solo"  },
  bluebikes: { name: "BlueBikes Viz",      short: "BlueBks", year: "2023", kind: "solo"  },
  whoop:     { name: "WHOOP",              short: "WHOOP",   year: "2025", kind: "co-op" },
  siphox:    { name: "SiPhox",             short: "SiPhox",  year: "2024", kind: "co-op" },
  varidx:    { name: "Varidx",             short: "Varidx",  year: "2024", kind: "co-op" },
};

// Column order in the matrix (solo first to match /projects)
export const PROJECT_ORDER: readonly ProjectSlug[] = [
  "closet", "aimessage", "bluebikes", "whoop", "siphox", "varidx",
];

// The three skills that go in the hero. Edit freely.
export const HEADLINE_SKILLS: readonly [string, string, string] = [
  "SwiftUI", "PyTorch", "TypeScript",
];

export const CATEGORY_ORDER: readonly SkillCategory[] = [
  "Mobile",
  "AI / ML",
  "Languages",
  "Web / Backend",
  "Data",
  "Cloud / DevOps",
];

export const SKILLS: readonly Skill[] = [
  // -------- Mobile
  { name: "SwiftUI",       category: "Mobile",         projects: ["whoop", "siphox"] },
  { name: "iOS",           category: "Mobile",         projects: ["whoop", "siphox"] },
  { name: "BLE",           category: "Mobile",         projects: ["whoop"] },
  { name: "Haptics",       category: "Mobile",         projects: ["whoop"] },
  { name: "React Native",  category: "Mobile",         projects: ["closet"] },
  { name: "Expo",          category: "Mobile",         projects: ["closet"] },

  // -------- AI / ML
  { name: "PyTorch",          category: "AI / ML",     projects: ["closet"] },
  { name: "ResNet50",         category: "AI / ML",     projects: ["closet"] },
  { name: "YOLO",             category: "AI / ML",     projects: ["varidx"] },
  { name: "OpenCV",           category: "AI / ML",     projects: ["varidx"] },
  { name: "Computer Vision",  category: "AI / ML",     projects: ["siphox", "varidx", "closet"] },
  { name: "NLP",              category: "AI / ML",     projects: ["aimessage"] },
  { name: "TensorFlow",       category: "AI / ML",     projects: [] },
  { name: "Scikit-Learn",     category: "AI / ML",     projects: [] },

  // -------- Languages
  { name: "Python",      category: "Languages",        projects: ["siphox", "varidx", "closet", "bluebikes"] },
  { name: "Swift",       category: "Languages",        projects: ["whoop", "siphox"] },
  { name: "TypeScript",  category: "Languages",        projects: ["closet", "aimessage"] },
  { name: "JavaScript",  category: "Languages",        projects: ["bluebikes"] },
  { name: "SQL",         category: "Languages",        projects: ["closet", "aimessage", "bluebikes"] },
  { name: "Java",        category: "Languages",        projects: [] },
  { name: "Go",          category: "Languages",        projects: [] },
  { name: "C++",         category: "Languages",        projects: [] },

  // -------- Web / Backend
  { name: "Next.js",    category: "Web / Backend",     projects: ["aimessage"] },
  { name: "React",      category: "Web / Backend",     projects: ["aimessage"] },
  { name: "FastAPI",    category: "Web / Backend",     projects: ["closet"] },
  { name: "Flask",      category: "Web / Backend",     projects: ["bluebikes"] },
  { name: "REST",       category: "Web / Backend",     projects: ["closet", "aimessage", "varidx"] },
  { name: "Pusher",     category: "Web / Backend",     projects: ["aimessage"] },
  { name: "JWT",        category: "Web / Backend",     projects: ["closet"] },
  { name: "Node",       category: "Web / Backend",     projects: [] },
  { name: "gRPC",       category: "Web / Backend",     projects: [] },

  // -------- Data
  { name: "SQLite",     category: "Data",              projects: ["closet"] },
  { name: "MySQL",      category: "Data",              projects: ["aimessage"] },
  { name: "Prisma",     category: "Data",              projects: ["aimessage"] },
  { name: "Pandas",     category: "Data",              projects: ["bluebikes"] },
  { name: "NumPy",      category: "Data",              projects: ["closet", "bluebikes"] },
  { name: "Plotly",     category: "Data",              projects: ["bluebikes"] },
  { name: "D3.js",      category: "Data",              projects: ["bluebikes"] },
  { name: "PostgreSQL", category: "Data",              projects: [] },
  { name: "MongoDB",    category: "Data",              projects: [] },
  { name: "Supabase",   category: "Data",              projects: [] },

  // -------- Cloud / DevOps
  { name: "AWS Lambda",   category: "Cloud / DevOps",  projects: ["siphox"] },
  { name: "AWS Textract", category: "Cloud / DevOps",  projects: ["siphox"] },
  { name: "Azure",        category: "Cloud / DevOps",  projects: ["varidx"] },
  { name: "Docker",       category: "Cloud / DevOps",  projects: [] },
  { name: "Kubernetes",   category: "Cloud / DevOps",  projects: [] },
  { name: "CI/CD",        category: "Cloud / DevOps",  projects: [] },
  { name: "Redis",        category: "Cloud / DevOps",  projects: [] },
];
