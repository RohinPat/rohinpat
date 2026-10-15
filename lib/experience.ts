// Single source for work history — used by /experience and the homepage index.

export const experiences = [
  {
    company: "WHOOP",
    role: "iOS Engineer · Co-op",
    period: "Jul 2025 — Dec 2025 · Full-time from Jul 2026",
    location: "Boston, MA",
    bullets: [
      "Improved onboarding completion by 15% with live BLE heart-rate streaming in SwiftUI.",
      "Boosted Daily Active Members by 10% via interactive onboarding visuals and haptic feedback.",
      "Lifted PR throughput 25%/release by building a DInject mock generator for 20+ iOS engineers.",
    ],
    tech: ["SwiftUI", "BLE", "iOS", "Dependency Injection", "DevTools"],
  },
  {
    company: "SiPhox Health",
    role: "Software Developer Co-op",
    period: "Jul 2024 — Dec 2024",
    location: "Boston, MA",
    bullets: [
      "Launched SiPhox's first iOS app in SwiftUI, generating 3D body models with ±3.9% median error vs. clinical.",
      "Automated blood-test parsing via AWS Lambda at 95% accuracy using OpenAI, Textract, and Comprehend.",
      "Shipped fixes across CMS, backend services, and web portal — improved data quality and reliability.",
    ],
    tech: ["SwiftUI", "Python", "AWS Lambda", "OpenAI", "Textract"],
  },
  {
    company: "Varidx",
    role: "Software Engineering Intern",
    period: "May 2024 — Jul 2024",
    location: "Remote",
    bullets: [
      "Built edge traffic analytics with YOLO at 95% accuracy monitoring 50k+ vehicles/day.",
      "Developed a real-time collision-alert system detecting vehicles in adjacent lanes.",
      "Integrated IoT devices with Azure to power analytics dashboards for city planning.",
    ],
    tech: ["Python", "YOLO", "OpenCV", "Azure", "IoT"],
  },
];
