import type { Metadata } from "next";

// Test harness for the phone link's networking: not for indexing, not linked from the site.
export const metadata: Metadata = {
  title: "Link test",
  robots: { index: false, follow: false },
};

export default function LinkTestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
