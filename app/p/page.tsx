import type { Metadata } from "next";
import LinkPhone from "@/components/link/LinkPhone";

// The page a visitor's own phone opens from the QR code on the home screen's
// lock screen. Not for search engines, not in the nav.
export const metadata: Metadata = {
  title: "Phone link",
  description: "Link your phone to the replica on your laptop.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/p" },
};

export default function Page() {
  return <LinkPhone />;
}
