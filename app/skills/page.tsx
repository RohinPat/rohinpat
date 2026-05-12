import type { Metadata } from "next";
import Skills from "@/components/Skills";

export const metadata: Metadata = {
  title: "Skills",
  description: "The toolkit — iOS, ML, web, infra.",
};

export default function SkillsPage() {
  return (
    <main className="relative pt-24">
      <Skills />
    </main>
  );
}
