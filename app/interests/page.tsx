import type { Metadata } from "next";
import Interests from "@/components/Interests";

export const metadata: Metadata = {
  title: "Off hours",
  description:
    "Watches, a maze the machines learn, hoops, penalties, a drum machine, cars, keyboards, golf and skiing — each built into something you can play.",
};

export default function InterestsPage() {
  return (
    <main className="relative pt-24">
      <Interests />
    </main>
  );
}
