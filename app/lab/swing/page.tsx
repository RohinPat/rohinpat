import type { Metadata } from "next";
import SwingLab from "@/components/lab/swing/SwingLab";

// A lab page: not linked from the nav, not in the sitemap, not indexable.
export const metadata: Metadata = {
  title: "Swing recorder",
  description: "Records phone motion sensors and tests gesture recognisers. Not part of the site.",
  robots: { index: false, follow: false },
};

export default function SwingLabPage() {
  return <SwingLab />;
}
