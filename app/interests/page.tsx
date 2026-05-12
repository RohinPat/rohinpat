import type { Metadata } from "next";
import Interests from "@/components/Interests";

export const metadata: Metadata = {
  title: "Interests",
  description:
    "Watches, cars, Barça, music, and a few other things I'd happily talk your ear off about.",
};

export default function InterestsPage() {
  return (
    <main className="relative pt-24">
      <Interests />
    </main>
  );
}
