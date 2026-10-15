import type { Metadata } from "next";
import Interests from "@/components/Interests";

export const metadata: Metadata = {
  title: "Off hours",
  description:
    "Watches, cars, Barça, vinyl, skiing and more — each turned into a small interactive piece.",
};

export default function InterestsPage() {
  return (
    <main className="relative pt-24">
      <Interests />
    </main>
  );
}
