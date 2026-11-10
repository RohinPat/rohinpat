import type { Metadata } from "next";
import Golf3D from "@/components/golf3d/Golf3D";

// The course in 3D, full screen. Built in the open but not linked yet: not in the
// nav or the sitemap, and not indexable, until it does more than the dialog's.
export const metadata: Metadata = {
  title: "Golf",
  description: "Nine holes, in 3D.",
  robots: { index: false, follow: false },
};

export default function GolfPage() {
  return <Golf3D />;
}
