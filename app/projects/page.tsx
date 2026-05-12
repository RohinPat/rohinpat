import type { Metadata } from "next";
import Projects from "@/components/Projects";

export const metadata: Metadata = {
  title: "Work",
  description: "Selected work from Rohin Patel — iOS, AI/ML, web.",
};

export default function ProjectsPage() {
  return (
    <main className="relative pt-24">
      <Projects />
    </main>
  );
}
