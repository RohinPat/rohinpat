import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

const ROUTES = [
  "",
  "/projects",
  "/experience",
  "/skills",
  "/interests",
  "/play",
  "/contact",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((path) => ({
    url: `${site.url}${path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
}
