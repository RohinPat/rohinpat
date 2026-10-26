import type { Metadata } from "next";
import LabIndex from "@/components/lab/link/LabIndex";

// Lab prototypes: not linked from the nav, not in the sitemap, not indexable.
export const metadata: Metadata = {
  title: "Lab",
  description: "Device tests for the phone-as-controller idea. Not part of the site.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <LabIndex />;
}
