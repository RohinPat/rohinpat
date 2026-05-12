import type { Metadata } from "next";
import Play from "@/components/Play";

export const metadata: Metadata = {
  title: "Play",
  description:
    "A small lab — keyboard sounds, pose-detected goal celebrations, music on rotation.",
};

export default function PlayPage() {
  return (
    <main className="relative pt-24">
      <Play />
    </main>
  );
}
