// Single source for project data — used by /projects and the homepage filmstrip.

export type Project = {
  slug: string;
  title: string;
  description: string;
  tech: string[];
  category: "Mobile" | "AI/ML" | "Web";
  year: string;
  github: string | null;
  demo: string | null;
  details: {
    problem: string;
    approach: string;
    impact: string[];
  };
};

export const projects: Project[] = [
  {
    slug: "closet-organizer",
    title: "Closet Organizer — End-to-end AI Wardrobe",
    description:
      "Full-stack AI wardrobe. ResNet50 classifier, color-theory outfit engine, FastAPI backend serving both a React Native mobile app and a vanilla-JS web UI.",
    tech: [
      "FastAPI",
      "PyTorch",
      "ResNet50",
      "React Native",
      "TypeScript",
      "Expo",
      "SQLite",
      "JWT",
    ],
    category: "AI/ML",
    year: "2025",
    github: null,
    demo: null,
    details: {
      problem:
        "Closet apps either classify clothes badly or ship recommendations with no theory behind them — and every \"AI closet\" sends your wardrobe to a cloud you don't control. I wanted one that actually classified clothing, recommended outfits with rules, and ran entirely on-device.",
      approach:
        "One async FastAPI backend with a transfer-learned ResNet50 classifier (17+ clothing categories), k-means dominant-color extraction, and a from-scratch outfit recommender driven by color-theory compatibility math. Two clients on top of the same API: a React Native + Expo mobile app in TypeScript, and a vanilla-JS/HTML web client. JWT + bcrypt auth built from scratch — no Auth0, no Firebase. SQLite, runs offline, no cloud dependencies.",
      impact: [
        "End-to-end ML pipeline: image upload → ResNet50 inference → k-means color extraction → DB storage",
        "Cross-platform: one Python backend powering a React Native mobile app and a web UI",
        "Custom outfit recommender built on color-theory rules — not ML, real math",
        "JWT + bcrypt auth from scratch — zero third-party auth services",
        "Full wardrobe system: closet CRUD, wear tracking, laundry queue, freshness scoring, analytics",
        "Runs entirely offline — local SQLite, local model, no cloud calls",
        "TypeScript-strict mobile app with a custom typed API client layer",
      ],
    },
  },
  {
    slug: "aimessage",
    title: "AiMessage — Mental-health Messaging",
    description:
      "Full-stack real-time messaging with NLP-powered sentiment analysis, emotional-state tracking, and mental-health recommendations.",
    tech: ["Next.js", "TypeScript", "MySQL", "Prisma", "Pusher", "NLP"],
    category: "Web",
    year: "2024",
    github: "https://github.com/RohinPat/ai-message",
    demo: "https://ai-message.vercel.app",
    details: {
      problem:
        "Most messaging apps are blind to emotional context — especially for people in vulnerable moments where what they're saying matters more than what they meant to.",
      approach:
        "Built a full-stack real-time messaging platform with sentiment + emotional-state tracking woven into the message pipeline itself. When concerning patterns appear, the UI gently surfaces mental-health resources — without breaking the conversation.",
      impact: [
        "Solo: Next.js + Prisma + MySQL + Pusher + NLP layer, shipped",
        "Public demo at ai-message.vercel.app",
        "Real-time channels via Pusher, emotional-state tracking server-side",
      ],
    },
  },
  {
    slug: "bluebikes",
    title: "BlueBikes Data Visualization",
    description:
      "Interactive app analyzing Boston's bike-share patterns with heatmaps, geospatial maps, and temporal breakdowns.",
    tech: ["Python", "Flask", "Plotly", "D3.js", "Pandas"],
    category: "AI/ML",
    year: "2023",
    github: "https://github.com/RohinPat/data-visualization-bluebikes",
    demo: "https://data-visualization-bluebikes.vercel.app",
    details: {
      problem:
        "BlueBikes publishes raw trip data — millions of rides — but no one had visualized it at a city level. The interesting questions (where, when, who, why) live in the geo + temporal joins.",
      approach:
        "Built a Flask + Plotly + D3 dashboard with six visualization types: trip heatmaps, station geo-clusters, temporal breakdowns by hour/day/season, weather overlays, and route-level analytics.",
      impact: [
        "Public demo at data-visualization-bluebikes.vercel.app",
        "Six distinct visualizations over years of trip data",
        "Pandas-driven aggregation, D3/Plotly rendered on demand",
      ],
    },
  },
  {
    slug: "whoop-onboarding",
    title: "WHOOP — Heart-rate Onboarding",
    description:
      "Built live heart-rate onboarding in SwiftUI with real-time BLE streaming. Lifted onboarding completion 15% and Daily Active Members 10%.",
    tech: ["SwiftUI", "BLE", "iOS", "Real-time"],
    category: "Mobile",
    year: "2025",
    github: null,
    demo: null,
    details: {
      problem:
        "New users were dropping off during onboarding before getting any signal that the strap actually worked. The flow asked them to trust the device without showing it doing anything.",
      approach:
        "Wired CoreBluetooth straight into the SwiftUI onboarding view. The second the strap registers a pulse, the screen comes alive — a live BPM number, an animated waveform, and a haptic tick on each beat. The data is the moment.",
      impact: [
        "+15% onboarding completion across new members",
        "+10% Daily Active Members (DAM) measured downstream",
        "+25% PR throughput across 20 iOS engineers via the DInject mock generator",
      ],
    },
  },
  {
    slug: "siphox-body-scan",
    title: "SiPhox — 3D Body Scan iOS App",
    description:
      "SiPhox's first iOS app: generates 3D body models from video for body-fat analysis. ±3.9% median error vs. clinical benchmarks.",
    tech: ["SwiftUI", "Python", "3D Graphics", "Computer Vision"],
    category: "Mobile",
    year: "2024",
    github: null,
    demo: null,
    details: {
      problem:
        "Body composition tracking required clinical equipment — DEXA scans, callipers, or trained staff. SiPhox wanted that signal from a phone camera alone.",
      approach:
        "Shipped the first iOS app in the company's history: SwiftUI capture flow that walks a user through a guided video, uploads to a Python backend that reconstructs a 3D mesh and derives body-fat metrics.",
      impact: [
        "±3.9% median error vs. clinical benchmarks",
        "End-to-end ownership — capture, upload, reconstruction pipeline, results UI",
        "Backend also automated blood-test parsing via AWS Lambda + OpenAI/Textract at 95% accuracy",
      ],
    },
  },
  {
    slug: "varidx-traffic",
    title: "Varidx — Edge Traffic Analytics",
    description:
      "Edge system with YOLO and OpenCV. 95% vehicle-detection accuracy across 50k+ vehicles/day for city dashboards.",
    tech: ["Python", "YOLO", "OpenCV", "Azure", "IoT"],
    category: "AI/ML",
    year: "2024",
    github: null,
    demo: null,
    details: {
      problem:
        "Cities had traffic cameras everywhere but couldn't process video at scale on-device. Existing pipelines required sending everything to a server, which didn't work for live counts or low-bandwidth deployments.",
      approach:
        "Built a YOLO + OpenCV inference pipeline that runs on edge IoT hardware, with a real-time collision-alert system on top. Counts and events stream up to Azure where the city analytics dashboards live.",
      impact: [
        "95% vehicle-detection accuracy",
        "50,000+ vehicles/day tracked per node",
        "Live collision detection on adjacent lanes — became the dashboard headline metric",
      ],
    },
  },
];
