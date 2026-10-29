import type { Metadata } from "next";
import PointerLab from "@/components/lab/pointer/PointerLab";

// A lab page: not linked from the nav, not in the sitemap, not indexable.
export const metadata: Metadata = {
  title: "Air pointer lab",
  description: "Tests a phone as a pointer for the laptop. Not part of the site.",
  robots: { index: false, follow: false },
};

export default function PointerLabPage() {
  return <PointerLab />;
}
