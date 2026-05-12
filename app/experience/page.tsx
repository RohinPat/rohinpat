import type { Metadata } from "next";
import Experience from "@/components/Experience";

export const metadata: Metadata = {
  title: "Experience",
  description: "Where Rohin Patel has worked — WHOOP, SiPhox Health, Varidx.",
};

export default function ExperiencePage() {
  return (
    <main className="relative pt-24">
      <Experience />
    </main>
  );
}
